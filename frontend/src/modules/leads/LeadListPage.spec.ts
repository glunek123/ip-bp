import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import type {
  Lead,
  LeadPushResult,
  LeadDetail,
  LeadFormContext,
} from '../../api/leads';
import {
  readPendingLeadBatchPush,
  savePendingLeadBatchPush,
} from './lead-batch-push-recovery';
import {
  readPendingLeadCsvImports,
  savePendingLeadCsvImports,
  type FrozenLeadCsvImport,
} from './lead-csv-import-recovery';
import { defineComponent, h, type PropType } from 'vue';
import { readPendingLeadCommands } from './LeadListWorkflowPanel.vue';
import { ApiError } from '../../api/http';
import LeadQuickActionsPanel from './LeadQuickActionsPanel.vue';
import LeadListPage from './LeadListPage.vue';
import * as leadCsvAdapter from './lead-csv-adapter';
import {
  readPendingLeadNoEvidenceBatches,
  savePendingLeadNoEvidenceBatches,
} from './lead-no-evidence-batch-recovery';

const api = vi.hoisted(() => ({
  listLeads: vi.fn(),
  getLead: vi.fn(),
  getLeadFormContext: vi.fn(),
  importLeadCsvBatch: vi.fn(),
  pushLead: vi.fn(),
  pushLeadsBatch: vi.fn(),
  decideNoEvidenceBatch: vi.fn(),
}));
vi.mock('../../api/leads', () => api);
vi.mock('../../api/lead-no-evidence-batch', async (original) => ({
  ...(await original<typeof import('../../api/lead-no-evidence-batch')>()),
  decideLeadNoEvidenceBatch: api.decideNoEvidenceBatch,
}));

const result = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  counts: {
    WAITING_PUSH: 7,
    WAITING_REVIEW: 3,
    WAITING_EVIDENCE_DECISION: 2,
    TRANSFERRED_TO_NOTARY: 0,
    ARCHIVED: 1,
  },
  capabilities: { create: true },
};

const summary = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  departmentId: 'department-1',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  responsibleUserId: 'operator-1',
  teamId: null,
  shopName: '测试店铺',
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  needDisclose: false,
  remark: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
  leadScreenshotContentVersionIds: [],
  version: 1,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  createdAt: '2026-09-21T04:00:00Z',
  shopExternalId: 'shop-真实-001',
  displayNames: {
    customerName: '客户甲',
    rightsHolderName: '主体甲',
    responsibleUserName: '运营甲',
  },
  foundAt: '2026-09-20T03:00:00Z',
  products: [
    {
      id: 'product-1',
      position: 1,
      url: 'https://example.com/product-1',
      title: '测试商品',
      quantity: 1,
      unitPrice: '10.00',
      commentCount: 0,
      estimatedAmount: '10.00',
    },
  ],
  updatedAt: '2026-09-21T04:00:00Z',
} satisfies Lead;
const batchSummary: Lead = {
  ...summary,
  id: '33333333-3333-4333-8333-333333333333',
};

const csvFormContext: LeadFormContext = {
  customers: [
    {
      id: 'customer-1',
      name: '客户甲',
      rightsHolders: [{ id: 'holder-1', name: '主体甲' }],
    },
  ],
  dictionaries: {
    caseTypes: [{ value: 'CIVIL', label: '民事' }],
    infringementTypes: [{ value: 'TRADEMARK', label: '商标权' }],
    sources: [{ value: 'ONLINE', label: '线上' }],
    platforms: {
      ONLINE: [{ value: 'TAOBAO', label: '淘宝' }],
      OFFLINE: [],
    },
  },
};
const validCsv = [
  '客户,权利主体,案件类型,运营,线索来源,平台,侵权类型,线索发现日期,店铺名,店铺ID,是否需要披露,线索备注,商品链接,商品名称,销量,单价,评论数',
  '客户甲,,民事,,线上,淘宝,商标权,2026-10-19 10:00,甲店铺,,否,,,商品甲,0,1.50,0',
].join('\r\n');

function pendingCsvImport(
  actorIdentity = 'operator-1:INTERNAL:department-1',
): FrozenLeadCsvImport {
  return {
    actorIdentity,
    idempotencyKey: 'original-csv-key',
    uncertain: true,
    items: [
      {
        rowNumber: 2,
        input: {
          customerId: 'customer-1',
          rightsHolderId: 'holder-1',
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-01T00:00:00.000Z',
          shopName: '测试店铺',
          needDisclose: false,
          products: [
            {
              url: 'https://example.com',
              quantity: 1,
              unitPrice: '1.00',
              commentCount: 0,
            },
          ],
          leadScreenshotContentVersionIds: [],
        },
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function uploadAndSelectCsv(wrapper: ReturnType<typeof mount>) {
  const fileInput = wrapper.get('[data-test="csv-file-input"]');
  Object.defineProperty(fileInput.element, 'files', {
    configurable: true,
    value: [new globalThis.File([validCsv], 'leads.csv', { type: 'text/csv' })],
  });
  await fileInput.trigger('change');
  await flushPromises();
  await vi.waitFor(() =>
    expect(wrapper.find('[data-test="csv-row-2"]').exists()).toBe(true),
  );
  await wrapper.get('[data-test="csv-row-2"] input').setValue(true);
}

function detail(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    ...summary,
    capabilities: {
      edit: true,
      push: true,
      withdrawApply: false,
      evidenceDecide: false,
      transferToNotary: false,
      createEvidenceBatch: false,
    },
    evidenceDecision: null,
    pendingWithdrawalApplication: null,
    history: [],
    notaryMatters: [],
    ...overrides,
  };
}

function pushResult(leadId: string, expectedVersion: number): LeadPushResult {
  return {
    id: `push-${leadId}`,
    businessNo: leadId === summary.id ? summary.businessNo : 'LD-B',
    status: 'WAITING_REVIEW',
    version: expectedVersion + 1,
    pushedAt: '2026-10-15T00:00:00.000Z',
    pushedByUserId: 'operator-1',
    pushedByDisplayName: '运营员',
  };
}

const DrawerStub = defineComponent({
  props: {
    modelValue: Boolean,
    beforeClose: Function as PropType<(done: () => void) => void>,
  },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h('section', { role: 'dialog' }, [
            h(
              'button',
              {
                'data-test': 'close-drawer',
                onClick: () => props.beforeClose?.(() => {}),
              },
              '关闭',
            ),
            slots.default?.(),
            slots.footer?.(),
          ])
        : null;
  },
});

const cleanups: Array<() => void> = [];
async function mountWithRoute(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'operator-1', displayName: '运营甲', username: 'operator' },
    department: { id: 'department-1', name: '知产部' },
    departments: [{ id: 'department-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00.000Z',
    csrfToken: 'test-csrf',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads', component: LeadListPage },
      { path: '/leads/new', component: { template: '<div />' } },
      { path: '/leads/:id', component: { template: '<div />' } },
      { path: '/leads/:id/edit', component: { template: '<div />' } },
      { path: '/customers', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(
    { components: { RouterView }, template: '<RouterView />' },
    { global: { plugins: [pinia, router], stubs: { ElDrawer: DrawerStub } } },
  );
  cleanups.push(() => wrapper.unmount());
  await flushPromises();
  return { router, wrapper, auth };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.resetAllMocks();
  sessionStorage.removeItem('dev-cor:lead-workflow:pending');
  sessionStorage.removeItem('dev-cor:lead-quick-actions:pending-push');
  localStorage.removeItem('lead-batch-push-pending-v1');
  localStorage.removeItem('lead-csv-import-pending-v1');
  localStorage.removeItem('lead-no-evidence-batch-pending-v1');
});

describe('LeadListPage', () => {
  it('applies and clears a keyword while preserving stage and resetting page', async () => {
    api.listLeads.mockImplementation(async (page: number) => ({
      ...result,
      page,
      total: 41,
    }));
    const { wrapper, router } = await mountWithRoute(
      '/leads?status=WAITING_PUSH&page=2',
    );
    await wrapper.get('[data-test="lead-query"]').setValue(' 商品甲 ');
    await wrapper.get('form[aria-label="线索关键词查询"]').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      status: 'WAITING_PUSH',
      page: '1',
      q: '商品甲',
    });
    expect(api.listLeads).toHaveBeenLastCalledWith(
      1,
      20,
      expect.anything(),
      'WAITING_PUSH',
      'LIBRARY',
      '商品甲',
    );
    await router.push('/leads?status=WAITING_PUSH&page=2&q=商品甲');
    await flushPromises();
    expect(api.listLeads).toHaveBeenLastCalledWith(
      2,
      20,
      expect.anything(),
      'WAITING_PUSH',
      'LIBRARY',
      '商品甲',
    );
    await wrapper.get('[data-test="lead-clear"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      status: 'WAITING_PUSH',
      page: '1',
    });
  });

  it('rejects repeated keyword values and fences a late response', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    api.listLeads.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { wrapper, router } = await mountWithRoute('/leads');
    const signal = api.listLeads.mock.calls[0]?.[2].signal as AbortSignal;
    await router.push('/leads?q=a&q=b');
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolveOld?.({ ...result, items: [batchSummary], total: 1 });
    await flushPromises();
    expect(wrapper.text()).toContain('线索关键词无效');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    api.listLeads.mockResolvedValue(result);
    await router.push('/leads?q=');
    await flushPromises();
    expect(wrapper.text()).not.toContain('线索关键词无效');
  });
  it('freshly checks selected no-evidence leads, submits one batch and preserves list filter', async () => {
    const selected: Lead = {
      ...batchSummary,
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '客户甲',
        decidedAt: '2026-10-20T00:00:00.000Z',
      },
    };
    api.listLeads.mockResolvedValue({ ...result, items: [selected], total: 1 });
    api.getLead.mockResolvedValue(
      detail({
        ...selected,
        version: 4,
        capabilities: { ...detail().capabilities, evidenceDecide: true },
      }),
    );
    api.decideNoEvidenceBatch.mockResolvedValue({ items: [] });
    const { wrapper } = await mountWithRoute(
      '/leads?status=WAITING_EVIDENCE_DECISION&page=1',
    );
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-no-evidence-batch"]').trigger('click');
    await flushPromises();
    expect(api.getLead).toHaveBeenCalledExactlyOnceWith(selected.id, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.text()).toContain('客户甲');
    await wrapper
      .get('[data-test="no-evidence-reason-0"]')
      .setValue(' 原始原因 ');
    await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.decideNoEvidenceBatch).toHaveBeenCalledExactlyOnceWith(
      {
        items: [
          { leadId: selected.id, expectedVersion: 4, reason: ' 原始原因 ' },
        ],
      },
      expect.objectContaining({
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    );
    expect(api.listLeads).toHaveBeenLastCalledWith(
      1,
      20,
      expect.anything(),
      'WAITING_EVIDENCE_DECISION',
      'LIBRARY',
    );
    expect(readPendingLeadNoEvidenceBatches()).toEqual({});
    expect(wrapper.find('[data-test="no-evidence-submit"]').exists()).toBe(
      false,
    );
  });

  it('blocks all other write entries after an unknown no-evidence batch', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLead.mockResolvedValue(
      detail({
        ...batchSummary,
        status: 'WAITING_EVIDENCE_DECISION',
        reviewDecision: {
          result: 'INFRINGEMENT',
          reviewerDisplayName: '客户',
          decidedAt: '2026-10-20T00:00:00.000Z',
        },
        capabilities: { ...detail().capabilities, evidenceDecide: true },
      }),
    );
    api.decideNoEvidenceBatch.mockRejectedValue(new Error('unknown'));
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-no-evidence-batch"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="no-evidence-reason-0"]').setValue('原因');
    await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="no-evidence-close"]').trigger('click');
    expect(
      wrapper.get('[data-test="pending-no-evidence-batch"]').text(),
    ).toContain('原始原因');
    for (const selector of [
      '[data-test="lead-query"]',
      '[data-test="lead-search"]',
      '[data-test="lead-clear"]',
      '[data-test="open-batch-push"]',
      '[data-test="open-csv-import"]',
      '[data-test="lead-quick-action"]',
      'input[type="checkbox"]',
    ])
      expect(wrapper.get(selector).attributes('disabled')).toBeDefined();
    expect(api.pushLeadsBatch).not.toHaveBeenCalled();
    expect(api.importLeadCsvBatch).not.toHaveBeenCalled();
  });

  it('explicitly recovers an archived batch with original body/key and preserves pending after 403', async () => {
    const identity = 'operator-1:INTERNAL:department-1';
    const pending = {
      identity,
      idempotencyKey: 'original-no-evidence',
      input: {
        items: [
          { leadId: batchSummary.id, expectedVersion: 1, reason: ' 原因原文 ' },
        ],
      },
    };
    savePendingLeadNoEvidenceBatches({ [identity]: pending });
    api.listLeads.mockResolvedValue(result);
    api.getLead.mockResolvedValue(
      detail({ ...batchSummary, status: 'ARCHIVED', version: 2 }),
    );
    api.decideNoEvidenceBatch
      .mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'))
      .mockResolvedValueOnce({ items: [] });
    const { wrapper } = await mountWithRoute('/leads');
    expect(api.getLead).not.toHaveBeenCalled();
    await wrapper
      .get('[data-test="recover-no-evidence-batch"]')
      .trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(readPendingLeadNoEvidenceBatches()?.[identity]).toEqual(pending);
    expect(api.listLeads).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(
      api.decideNoEvidenceBatch.mock.calls.every(
        ([body, options]) =>
          JSON.stringify(body) === JSON.stringify(pending.input) &&
          options.headers['Idempotency-Key'] === pending.idempotencyKey,
      ),
    ).toBe(true);
    expect(readPendingLeadNoEvidenceBatches()).toEqual({});
    expect(api.listLeads).toHaveBeenCalledTimes(2);
  });

  it('keeps late no-evidence success pending after hash-only navigation', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLead.mockResolvedValue(
      detail({
        ...batchSummary,
        status: 'WAITING_EVIDENCE_DECISION',
        reviewDecision: {
          result: 'INFRINGEMENT',
          reviewerDisplayName: '客户',
          decidedAt: '2026-10-20T00:00:00.000Z',
        },
        capabilities: { ...detail().capabilities, evidenceDecide: true },
      }),
    );
    const post = deferred<unknown>();
    api.decideNoEvidenceBatch.mockReturnValue(post.promise);
    const { wrapper, router } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-no-evidence-batch"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="no-evidence-reason-0"]').setValue('原因');
    await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    const signal = api.decideNoEvidenceBatch.mock.calls[0]![1].signal;
    await router.push('/leads#changed');
    await flushPromises();
    expect(signal.aborted).toBe(true);
    const readsAfterNavigation = api.listLeads.mock.calls.length;
    post.resolve({ items: [] });
    await flushPromises();
    expect(api.listLeads).toHaveBeenCalledTimes(readsAfterNavigation);
    expect(
      readPendingLeadNoEvidenceBatches()?.['operator-1:INTERNAL:department-1'],
    ).toBeDefined();
  });
  it('blocks a prepared no-evidence batch if another CSV request becomes pending before submit', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLead.mockResolvedValue(
      detail({
        ...batchSummary,
        status: 'WAITING_EVIDENCE_DECISION',
        reviewDecision: {
          result: 'INFRINGEMENT',
          reviewerDisplayName: '客户',
          decidedAt: '2026-10-20T00:00:00.000Z',
        },
        capabilities: { ...detail().capabilities, evidenceDecide: true },
      }),
    );
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-no-evidence-batch"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="no-evidence-reason-0"]').setValue('原因');
    await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
    const csv = pendingCsvImport();
    savePendingLeadCsvImports({ [csv.actorIdentity]: csv });
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.decideNoEvidenceBatch).not.toHaveBeenCalled();
    expect(readPendingLeadNoEvidenceBatches()).toEqual({});
    expect(wrapper.text()).toContain('批次未发送');
  });
  it('does not create a no-evidence batch around an old authorization revision single pending request', async () => {
    const oldIdentity = 'operator-1:INTERNAL:department-1:0';
    sessionStorage.setItem(
      'dev-cor:lead-workflow:pending',
      JSON.stringify({
        [oldIdentity]: {
          identity: oldIdentity,
          leadId: batchSummary.id,
          expectedVersion: 1,
          idempotencyKey: 'old-single',
          action: 'push',
          body: { expectedVersion: 1 },
        },
      }),
    );
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(
      wrapper
        .get('[data-test="open-no-evidence-batch"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="open-no-evidence-batch"]').trigger('click');
    expect(api.getLead).not.toHaveBeenCalled();
    expect(api.decideNoEvidenceBatch).not.toHaveBeenCalled();
  });
  it('blocks single and batch workflow entry after an unknown CSV outcome', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLeadFormContext.mockResolvedValue(csvFormContext);
    api.importLeadCsvBatch.mockRejectedValue(new Error('network timeout'));
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    await uploadAndSelectCsv(wrapper);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="csv-unknown"]').exists()).toBe(true);
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');

    const batchButton = wrapper.get('[data-test="open-batch-push"]');
    const workflowButton = wrapper.get('[data-test="lead-quick-action"]');
    expect(batchButton.attributes('disabled')).toBeDefined();
    expect(workflowButton.attributes('disabled')).toBeDefined();
    expect(wrapper.get('input[type="checkbox"]').element).toHaveProperty(
      'disabled',
      true,
    );
    await batchButton.trigger('click');
    await workflowButton.trigger('click');
    expect(api.getLead).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="submit-lead-workflow"]').exists()).toBe(
      false,
    );
  });

  it('blocks CSV import when a single-lead request remains pending after close', async () => {
    const identity = 'operator-1:INTERNAL:department-1:1';
    sessionStorage.setItem(
      'dev-cor:lead-workflow:pending',
      JSON.stringify({
        [identity]: {
          identity,
          leadId: summary.id,
          expectedVersion: 1,
          idempotencyKey: 'pending-single-lead',
          action: 'push',
          body: { expectedVersion: 1 },
        },
      }),
    );
    api.listLeads.mockResolvedValue(result);
    api.getLead.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountWithRoute('/leads');
    await flushPromises();
    await wrapper.get('[data-test="close-drawer"]').trigger('click');
    const button = wrapper.get('[data-test="open-csv-import"]');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(api.getLeadFormContext).not.toHaveBeenCalled();
    expect(api.importLeadCsvBatch).not.toHaveBeenCalled();
  });

  it('blocks CSV import when single-lead recovery storage is unreadable', async () => {
    sessionStorage.setItem('dev-cor:lead-workflow:pending', '{invalid');
    api.listLeads.mockResolvedValue(result);
    const { wrapper } = await mountWithRoute('/leads');
    const button = wrapper.get('[data-test="open-csv-import"]');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(api.getLeadFormContext).not.toHaveBeenCalled();
    expect(api.importLeadCsvBatch).not.toHaveBeenCalled();
  });

  it('reports the actual created count for a new CSV import', async () => {
    api.listLeads.mockResolvedValue(result);
    api.getLeadFormContext.mockResolvedValue(csvFormContext);
    api.importLeadCsvBatch.mockResolvedValue({ items: [{}, {}, {}] });
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    await uploadAndSelectCsv(wrapper);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="csv-success"]').text()).toContain(
      '已导入 3 条线索',
    );
  });

  it('keeps an original CSV attempt when a known rejection arrives after auth changes', async () => {
    api.listLeads.mockResolvedValue(result);
    api.getLeadFormContext.mockResolvedValue(csvFormContext);
    const request = deferred<{ items: [] }>();
    api.importLeadCsvBatch.mockReturnValue(request.promise);
    const { wrapper, auth } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    await uploadAndSelectCsv(wrapper);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    const actorIdentity = 'operator-1:INTERNAL:department-1';
    const original = readPendingLeadCsvImports()?.[actorIdentity];
    expect(original).toBeDefined();

    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    request.reject(new ApiError('请求超出限制', 400, 'VALIDATION_ERROR'));
    await flushPromises();

    expect(readPendingLeadCsvImports()?.[actorIdentity]).toEqual(original);
    expect(wrapper.find('[data-test="csv-import-panel"]').exists()).toBe(false);
  });

  it('keeps a late CSV success pending and skips its refresh after a route change', async () => {
    api.listLeads.mockImplementation(async (page = 1) => ({
      ...result,
      items: [batchSummary],
      total: 21,
      page,
    }));
    api.getLeadFormContext.mockResolvedValue(csvFormContext);
    const request = deferred<{ items: [] }>();
    api.importLeadCsvBatch.mockReturnValue(request.promise);
    const { wrapper, router } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    await uploadAndSelectCsv(wrapper);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    const actorIdentity = 'operator-1:INTERNAL:department-1';
    const original = readPendingLeadCsvImports()?.[actorIdentity];
    expect(original).toBeDefined();

    await router.push('/leads?page=2');
    await flushPromises();
    const listCallsAfterRouteChange = api.listLeads.mock.calls.length;
    request.resolve({ items: [] });
    await flushPromises();

    expect(readPendingLeadCsvImports()?.[actorIdentity]).toEqual(original);
    expect(api.listLeads).toHaveBeenCalledTimes(listCallsAfterRouteChange);
    expect(wrapper.find('[data-test="csv-import-panel"]').exists()).toBe(false);
  });

  it('does not accept parser output that settles after a route change', async () => {
    api.listLeads.mockImplementation(async (page = 1) => ({
      ...result,
      items: [batchSummary],
      total: 21,
      page,
    }));
    api.getLeadFormContext.mockResolvedValue(csvFormContext);
    const parsedRows = leadCsvAdapter.parseLeadCsvPreview(
      new globalThis.TextEncoder().encode(validCsv),
      { formContext: csvFormContext, operatorDisplayName: '运营甲' },
    );
    const parser = deferred<typeof parsedRows>();
    const parseSpy = vi
      .spyOn(leadCsvAdapter, 'parseLeadCsvPreview')
      .mockImplementation(() => parser.promise as never);
    const { wrapper, router } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    const fileInput = wrapper.get('[data-test="csv-file-input"]');
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [
        new globalThis.File([validCsv], 'leads.csv', { type: 'text/csv' }),
      ],
    });
    await fileInput.trigger('change');
    await vi.waitFor(() => expect(parseSpy).toHaveBeenCalledOnce());

    await router.push('/leads?page=2');
    await flushPromises();
    parser.resolve(parsedRows);
    await flushPromises();

    expect(parseSpy).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-test="csv-row-2"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="csv-import-panel"]').exists()).toBe(false);
  });

  it('loads a fresh form context before opening CSV import', async () => {
    api.listLeads.mockResolvedValue(result);
    const formContext = {
      customers: [],
      dictionaries: {
        caseTypes: [],
        infringementTypes: [],
        sources: [],
        platforms: { ONLINE: [], OFFLINE: [] },
      },
    };
    api.getLeadFormContext.mockResolvedValue(formContext);
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();

    expect(api.getLeadFormContext).toHaveBeenCalledExactlyOnceWith({
      signal: expect.any(AbortSignal),
    });
    const panel = wrapper.findComponent({ name: 'LeadCsvImportPanel' });
    expect(panel.exists()).toBe(true);
    expect(panel.props('formContext')).toEqual(formContext);
    expect(panel.props('actorIdentity')).toBe(
      'operator-1:INTERNAL:department-1',
    );
    expect(panel.props('operatorDisplayName')).toBe('运营甲');
  });

  it('clears loading on route change and opens again with a fresh context', async () => {
    api.listLeads.mockResolvedValue(result);
    const oldContext = deferred<LeadFormContext>();
    const freshContext: LeadFormContext = {
      ...csvFormContext,
      customers: [
        {
          id: 'customer-new',
          name: '新客户',
          rightsHolders: [{ id: 'holder-new', name: '新主体' }],
        },
      ],
    };
    api.getLeadFormContext
      .mockReturnValueOnce(oldContext.promise)
      .mockResolvedValueOnce(freshContext);
    const { wrapper, router } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="open-csv-import"]').text()).toContain(
      '读取导入配置',
    );

    await router.push('/leads?status=WAITING_PUSH');
    await flushPromises();
    expect(wrapper.find('[data-test="csv-import-panel"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="open-csv-import"]').attributes('disabled'),
    ).toBeUndefined();

    oldContext.resolve(csvFormContext);
    await flushPromises();
    expect(wrapper.find('[data-test="csv-import-panel"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="open-csv-import"]').attributes('disabled'),
    ).toBeUndefined();

    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    expect(api.getLeadFormContext).toHaveBeenCalledTimes(2);
    expect(
      wrapper
        .findComponent({ name: 'LeadCsvImportPanel' })
        .props('formContext'),
    ).toEqual(freshContext);
  });

  it('explicitly replays a pending CSV import with the same items and key', async () => {
    const actorIdentity = 'operator-1:INTERNAL:department-1';
    const pending: FrozenLeadCsvImport = {
      actorIdentity,
      idempotencyKey: 'original-csv-key',
      uncertain: true,
      items: [
        {
          rowNumber: 2,
          input: {
            customerId: 'customer-1',
            rightsHolderId: 'holder-1',
            caseType: 'CIVIL',
            infringementTypes: ['TRADEMARK'],
            source: 'ONLINE',
            platform: 'TAOBAO',
            foundAt: '2026-10-01T00:00:00.000Z',
            shopName: '测试店铺',
            needDisclose: false,
            products: [
              {
                url: 'https://example.com',
                quantity: 1,
                unitPrice: '1.00',
                commentCount: 0,
              },
            ],
            leadScreenshotContentVersionIds: [],
          },
        },
      ],
    };
    savePendingLeadCsvImports({ [actorIdentity]: pending });
    api.importLeadCsvBatch.mockResolvedValue({ items: [{}, {}] });
    api.listLeads.mockResolvedValue(result);
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="recover-csv-import"]').trigger('click');
    await flushPromises();

    expect(api.importLeadCsvBatch).toHaveBeenCalledExactlyOnceWith(
      pending.items,
      pending.idempotencyKey,
      { signal: expect.any(AbortSignal) },
    );
    expect(readPendingLeadCsvImports()?.[actorIdentity]).toBeUndefined();
    expect(wrapper.get('[data-test="csv-success"]').text()).toContain(
      '已导入 2 条线索',
    );
  });

  it('retains the original body and key when uncertain recovery is rejected, then settles only on success', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLeadFormContext.mockResolvedValue(csvFormContext);
    api.importLeadCsvBatch
      .mockRejectedValueOnce(new Error('original response lost'))
      .mockRejectedValueOnce(
        new ApiError('当前范围不可访问', 409, 'CSV_IMPORT_REJECTED'),
      )
      .mockResolvedValueOnce({ items: [{}, {}] });
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-csv-import"]').trigger('click');
    await flushPromises();
    await uploadAndSelectCsv(wrapper);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');
    const actorIdentity = 'operator-1:INTERNAL:department-1';
    const original = readPendingLeadCsvImports()?.[actorIdentity];
    expect(original).toBeDefined();

    await wrapper.get('[data-test="recover-csv-import"]').trigger('click');
    await flushPromises();
    expect(readPendingLeadCsvImports()?.[actorIdentity]).toEqual(original);
    expect(api.importLeadCsvBatch).toHaveBeenCalledTimes(2);
    expect(api.listLeads).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('[data-test="open-csv-import"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="open-batch-push"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="lead-quick-action"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.get('input[type="checkbox"]').element).toHaveProperty(
      'disabled',
      true,
    );
    for (const [items, idempotencyKey] of api.importLeadCsvBatch.mock.calls) {
      expect(items).toEqual(original?.items);
      expect(idempotencyKey).toBe(original?.idempotencyKey);
    }

    await wrapper.get('[data-test="recover-csv-import"]').trigger('click');
    await flushPromises();
    expect(api.importLeadCsvBatch).toHaveBeenCalledTimes(3);
    expect(readPendingLeadCsvImports()?.[actorIdentity]).toBeUndefined();
    expect(api.listLeads).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="csv-success"]').text()).toContain(
      '已导入 2 条线索',
    );
    expect(wrapper.find('[data-test="recover-csv-import"]').exists()).toBe(
      false,
    );
    for (const [items, idempotencyKey] of api.importLeadCsvBatch.mock.calls) {
      expect(items).toEqual(original?.items);
      expect(idempotencyKey).toBe(original?.idempotencyKey);
    }
  });

  it.each([
    [400, 'VALIDATION_ERROR'],
    [403, 'FORBIDDEN'],
    [409, 'CSV_IMPORT_REJECTED'],
    [500, 'INTERNAL_ERROR'],
  ] as const)(
    'retains an uncertain CSV recovery after HTTP %i %s',
    async (status, code) => {
      const actorIdentity = 'operator-1:INTERNAL:department-1';
      const pending = pendingCsvImport(actorIdentity);
      expect(savePendingLeadCsvImports({ [actorIdentity]: pending })).toBe(
        true,
      );
      api.listLeads.mockResolvedValue(result);
      api.importLeadCsvBatch.mockRejectedValue(
        new ApiError('恢复请求未确认', status, code),
      );
      const { wrapper } = await mountWithRoute('/leads');
      await wrapper.get('[data-test="recover-csv-import"]').trigger('click');
      await flushPromises();

      expect(readPendingLeadCsvImports()?.[actorIdentity]).toEqual(pending);
      expect(api.importLeadCsvBatch).toHaveBeenCalledExactlyOnceWith(
        pending.items,
        pending.idempotencyKey,
        { signal: expect.any(AbortSignal) },
      );
      expect(wrapper.find('[data-test="recover-csv-import"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="csv-success"]').exists()).toBe(false);
    },
  );

  it.each(['identity', 'authorization', 'route'] as const)(
    'retains a late CSV recovery success after %s changes',
    async (change) => {
      const actorIdentity = 'operator-1:INTERNAL:department-1';
      const pending = pendingCsvImport(actorIdentity);
      expect(savePendingLeadCsvImports({ [actorIdentity]: pending })).toBe(
        true,
      );
      api.listLeads.mockImplementation(async (page = 1) => ({
        ...result,
        items: [],
        total: 21,
        page,
      }));
      const request = deferred<{ items: [] }>();
      api.importLeadCsvBatch.mockReturnValue(request.promise);
      const { wrapper, auth, router } = await mountWithRoute('/leads');
      await wrapper.get('[data-test="recover-csv-import"]').trigger('click');
      await flushPromises();
      expect(api.importLeadCsvBatch).toHaveBeenCalledOnce();

      if (change === 'identity') {
        auth.session = {
          ...auth.session!,
          user: { ...auth.session!.user, id: 'operator-B' },
          authorizationRevision: 2,
        };
      } else if (change === 'authorization') {
        auth.session = {
          ...auth.session!,
          authorizationRevision: 2,
        };
      } else {
        await router.push('/leads?page=2');
      }
      await flushPromises();
      const listCallsAfterContextChange = api.listLeads.mock.calls.length;
      request.resolve({ items: [] });
      await flushPromises();

      expect(readPendingLeadCsvImports()?.[actorIdentity]).toEqual(pending);
      expect(api.listLeads).toHaveBeenCalledTimes(listCallsAfterContextChange);
      expect(wrapper.find('[data-test="csv-success"]').exists()).toBe(false);
    },
  );

  it('refreshes selected lead authorization and version before opening batch push', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLead.mockResolvedValue(detail({ ...batchSummary, version: 4 }));
    api.pushLeadsBatch.mockResolvedValue({ items: [] });
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-batch-push"]').trigger('click');
    await flushPromises();
    expect(api.getLead).toHaveBeenCalledExactlyOnceWith(
      batchSummary.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.findAll('[data-test="batch-submit"]')).toHaveLength(1);
    await wrapper.get('[data-test="batch-submit"]').trigger('click');
    await flushPromises();
    expect(api.pushLeadsBatch.mock.calls[0]?.[0]).toEqual([
      { leadId: batchSummary.id, expectedVersion: 4 },
    ]);
  });

  it.each(['success', 'explicit rejection'] as const)(
    'allows a second batch after the first %s settles',
    async (firstOutcome) => {
      api.listLeads.mockResolvedValue({
        ...result,
        items: [batchSummary],
        total: 1,
      });
      api.getLead.mockResolvedValue(detail(batchSummary));
      if (firstOutcome === 'success') {
        api.pushLeadsBatch
          .mockResolvedValueOnce({ items: [pushResult(batchSummary.id, 1)] })
          .mockResolvedValueOnce({ items: [pushResult(batchSummary.id, 1)] });
      } else {
        api.pushLeadsBatch
          .mockRejectedValueOnce(
            new ApiError('rejected', 409, 'BATCH_PUSH_REJECTED', undefined, {
              failures: [{ index: 0, code: 'INVALID_STATE' }],
            }),
          )
          .mockResolvedValueOnce({ items: [pushResult(batchSummary.id, 1)] });
      }

      const { wrapper } = await mountWithRoute('/leads');
      await wrapper.get('input[type="checkbox"]').setValue(true);
      await wrapper.get('[data-test="open-batch-push"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-test="batch-submit"]').trigger('click');
      await flushPromises();

      expect(
        readPendingLeadBatchPush()?.['operator-1:INTERNAL:department-1'],
      ).toBe(undefined);
      await wrapper.get('input[type="checkbox"]').setValue(true);
      await wrapper.get('[data-test="open-batch-push"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-test="batch-submit"]').exists()).toBe(true);
      await wrapper.get('[data-test="batch-submit"]').trigger('click');
      await flushPromises();

      expect(api.pushLeadsBatch).toHaveBeenCalledTimes(2);
      expect(api.pushLeadsBatch.mock.calls[0]?.[1]).not.toBe(
        api.pushLeadsBatch.mock.calls[1]?.[1],
      );
    },
  );

  it('replays a recovered batch with its original body and key after fresh detail reads', async () => {
    const batchIdentity = 'operator-1:INTERNAL:department-1';
    const pending = {
      identity: batchIdentity,
      idempotencyKey: 'frozen-original-key',
      items: [{ leadId: batchSummary.id, expectedVersion: 1 }],
      uncertain: true,
    };
    expect(savePendingLeadBatchPush({ [batchIdentity]: pending })).toBe(true);
    api.listLeads.mockResolvedValue({ ...result, items: [], total: 0 });
    api.getLead.mockResolvedValue(
      detail({ ...batchSummary, version: 9, status: 'WAITING_REVIEW' }),
    );
    api.pushLeadsBatch.mockResolvedValue({ items: [] });
    const { wrapper } = await mountWithRoute('/leads');
    await flushPromises();
    expect(wrapper.findAll('[data-test="batch-submit"]')).toHaveLength(1);
    await wrapper.get('[data-test="batch-submit"]').trigger('click');
    await flushPromises();
    expect(api.pushLeadsBatch).toHaveBeenCalledExactlyOnceWith(
      pending.items,
      pending.idempotencyKey,
    );
  });

  it('does not open or submit when the fresh lead detail denies push permission', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLead.mockResolvedValue(
      detail({ capabilities: { ...detail().capabilities, push: false } }),
    );
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-batch-push"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="batch-submit"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-test="batch-refresh-error"]')).toHaveLength(
      1,
    );
    expect(api.pushLeadsBatch).not.toHaveBeenCalled();
  });

  it('ignores a late batch response after identity change without clearing the next actor request', async () => {
    let resolveActorA!: (value: { items: [] }) => void;
    const actorBIdentity = 'operator-B:INTERNAL:department-1';
    const actorBPending = {
      identity: actorBIdentity,
      idempotencyKey: 'actor-b-key',
      items: [{ leadId: batchSummary.id, expectedVersion: 1 }],
      uncertain: true,
    };
    expect(savePendingLeadBatchPush({ [actorBIdentity]: actorBPending })).toBe(
      true,
    );
    api.listLeads.mockResolvedValue({
      ...result,
      items: [batchSummary],
      total: 1,
    });
    api.getLead.mockResolvedValue(detail(batchSummary));
    api.pushLeadsBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveActorA = resolve;
        }),
    );
    const { wrapper, auth } = await mountWithRoute('/leads');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="open-batch-push"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="batch-submit"]').trigger('click');
    await flushPromises();
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'operator-B' },
      authorizationRevision: 2,
    };
    await flushPromises();
    resolveActorA({ items: [] });
    await flushPromises();
    expect(readPendingLeadBatchPush()?.[actorBIdentity]).toEqual(actorBPending);
  });

  it('reopens the original pending request after a failed fresh read and user close', async () => {
    const identity = 'operator-1:INTERNAL:department-1:1';
    sessionStorage.setItem(
      'dev-cor:lead-workflow:pending',
      JSON.stringify({
        [identity]: {
          identity,
          leadId: summary.id,
          expectedVersion: 1,
          idempotencyKey: 'original-read-recovery',
          action: 'push',
          body: { expectedVersion: 1 },
        },
      }),
    );
    api.listLeads.mockResolvedValue({ ...result, items: [], total: 0 });
    api.getLead
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(detail({ status: 'WAITING_REVIEW', version: 2 }));
    api.pushLead.mockResolvedValue(pushResult(summary.id, 1));
    const { wrapper } = await mountWithRoute('/leads?status=WAITING_PUSH');
    expect(wrapper.text()).toContain('资料加载失败');
    await wrapper.get('[data-test="close-drawer"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).not.toHaveBeenCalled();
    await wrapper.get('[data-test="reopen-pending-lead"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="retry-unknown-lead"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).toHaveBeenCalledExactlyOnceWith(
      summary.id,
      1,
      'original-read-recovery',
    );
    expect(readPendingLeadCommands()).toEqual({});
  });
  it('uses an explicit next-node title, opens fresh detail, and never advances just by opening', async () => {
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    api.getLead.mockResolvedValue(detail());
    const { wrapper, router } = await mountWithRoute('/leads');
    expect(wrapper.get('[data-test="lead-quick-action"]').text()).toBe(
      '推送给客户审核',
    );
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    expect(api.getLead).toHaveBeenCalledExactlyOnceWith(
      summary.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.find('[data-test="submit-lead-workflow"]').exists()).toBe(
      true,
    );
    expect(api.pushLead).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/leads');
    await wrapper.get('[data-test="close-drawer"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="lead-workflow-form"]').exists()).toBe(
      false,
    );
  });
  it('refreshes once after confirmed push and preserves page/filter while the row leaves the filter', async () => {
    let settled = false;
    api.listLeads.mockImplementation(async (page: number) => ({
      ...result,
      page,
      items: settled ? [] : [summary],
      total: 41,
    }));
    api.getLead.mockResolvedValue(detail());
    api.pushLead.mockImplementation(async (id: string, version: number) => {
      settled = true;
      return pushResult(id, version);
    });
    const { wrapper, router } = await mountWithRoute(
      '/leads?page=2&status=WAITING_PUSH',
    );
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    const button = wrapper.get('[data-test="submit-lead-workflow"]');
    await Promise.all([button.trigger('click'), button.trigger('click')]);
    await flushPromises();
    expect(api.pushLead).toHaveBeenCalledOnce();
    expect(api.listLeads).toHaveBeenCalledTimes(2);
    expect(api.listLeads).toHaveBeenLastCalledWith(
      2,
      20,
      expect.any(Object),
      'WAITING_PUSH',
      'LIBRARY',
    );
    expect(router.currentRoute.value.query).toEqual({
      page: '2',
      status: 'WAITING_PUSH',
    });
    expect(wrapper.find('[data-test="lead-row"]').exists()).toBe(false);
  });
  it('corrects an empty last page to the new last page while preserving the filter', async () => {
    let settled = false;
    api.listLeads.mockImplementation(async (page: number) => ({
      ...result,
      page,
      items: settled ? [] : [summary],
      total: settled ? 40 : 41,
    }));
    api.getLead.mockResolvedValue(detail());
    api.pushLead.mockImplementation(async () => {
      settled = true;
      return pushResult(summary.id, 1);
    });
    const { wrapper, router } = await mountWithRoute(
      '/leads?page=3&status=WAITING_PUSH',
    );
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      page: '2',
      status: 'WAITING_PUSH',
    });
    expect(api.listLeads).toHaveBeenLastCalledWith(
      2,
      20,
      expect.any(Object),
      'WAITING_PUSH',
      'LIBRARY',
    );
  });
  it('restores unknown original request after refresh even if its row has left the filter', async () => {
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    api.getLead.mockResolvedValue(detail());
    api.pushLead
      .mockRejectedValueOnce(new ApiError('lost', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce(pushResult(summary.id, 1));
    const first = await mountWithRoute('/leads?status=WAITING_PUSH');
    await first.wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await first.wrapper
      .get('[data-test="submit-lead-workflow"]')
      .trigger('click');
    await flushPromises();
    const frozen = readPendingLeadCommands();
    expect(Object.values(frozen ?? {})).toHaveLength(1);
    first.wrapper.unmount();
    cleanups.pop();
    api.listLeads.mockResolvedValue({ ...result, items: [], total: 0 });
    api.getLead.mockResolvedValue(
      detail({
        status: 'WAITING_REVIEW',
        version: 2,
        capabilities: { ...detail().capabilities, push: false },
      }),
    );
    const reopened = await mountWithRoute('/leads?status=WAITING_PUSH');
    expect(
      reopened.wrapper.find('[data-test="retry-unknown-lead"]').exists(),
    ).toBe(true);
    await reopened.wrapper
      .get('[data-test="retry-unknown-lead"]')
      .trigger('click');
    await flushPromises();
    expect(api.pushLead.mock.calls[1]).toEqual(api.pushLead.mock.calls[0]);
    expect(readPendingLeadCommands()).toEqual({});
  });
  it('settles a late response only for its original identity without refreshing the new actor list', async () => {
    let resolveA!: (value: LeadPushResult) => void;
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    api.getLead.mockResolvedValue(detail());
    api.pushLead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    const { wrapper, auth } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    api.listLeads.mockResolvedValue({
      ...result,
      items: [{ ...summary, id: 'lead-B', businessNo: 'LD-B' }],
      total: 1,
    });
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'operator-B' },
      authorizationRevision: 2,
    };
    await flushPromises();
    const readCount = api.listLeads.mock.calls.length;
    expect(wrapper.text()).toContain('LD-B');
    resolveA(pushResult(summary.id, 1));
    await flushPromises();
    expect(api.listLeads).toHaveBeenCalledTimes(readCount);
    expect(wrapper.text()).toContain('LD-B');
    expect(readPendingLeadCommands()).toEqual({});
  });
  it('rejects stale success when a newer stored command belongs to the same identity/target', async () => {
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    api.getLead.mockResolvedValue(detail());
    api.pushLead.mockRejectedValueOnce(
      new ApiError('lost', 0, 'NETWORK_ERROR'),
    );
    const { wrapper } = await mountWithRoute('/leads');
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    const original = Object.values(readPendingLeadCommands()!)[0]!;
    sessionStorage.setItem(
      'dev-cor:lead-workflow:pending',
      JSON.stringify({
        [original.identity]: { ...original, idempotencyKey: 'newer-key' },
      }),
    );
    wrapper
      .findComponent(LeadQuickActionsPanel)
      .vm.$emit('succeeded', original);
    await flushPromises();
    expect(api.listLeads).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-test="retry-unknown-lead"]').exists()).toBe(
      true,
    );
  });
  it('keeps independent edit route and exact return query without a workflow command', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [summary],
      total: 41,
      page: 2,
    });
    api.getLead.mockResolvedValue(detail());
    const { wrapper, router } = await mountWithRoute(
      '/leads?page=2&status=WAITING_PUSH',
    );
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    const edit = wrapper.get('[data-test="quick-edit-lead"]');
    expect(
      new URL(
        edit.attributes('href')!,
        'https://internal.invalid',
      ).searchParams.get('returnTo'),
    ).toBe('/leads?page=2&status=WAITING_PUSH');
    await edit.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/leads/lead-1/edit');
    expect(api.pushLead).not.toHaveBeenCalled();
  });

  it.each(['user', 'department', 'revision'] as const)(
    'clears old projections and rejects late responses after %s changes',
    async (change) => {
      let resolveOld!: (
        value: Omit<typeof result, 'items'> & { items: Lead[] },
      ) => void;
      api.listLeads
        .mockResolvedValueOnce({ ...result, items: [summary], total: 1 })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve;
            }),
        )
        .mockResolvedValueOnce({
          ...result,
          items: [],
          total: 0,
          capabilities: { create: false },
        });
      const { router, wrapper, auth } = await mountWithRoute('/leads');
      expect(wrapper.text()).toContain(summary.businessNo);
      await router.push('/leads?page=2');
      await flushPromises();
      const oldSignal = api.listLeads.mock.calls[1]![2].signal as AbortSignal;
      auth.session = {
        ...auth.session!,
        ...(change === 'revision'
          ? { authorizationRevision: 2 }
          : change === 'user'
            ? { user: { ...auth.session!.user, id: 'operator-2' } }
            : { department: { id: 'department-2', name: '另一部门' } }),
      };
      expect(wrapper.text()).not.toContain(summary.businessNo);
      await flushPromises();
      expect(oldSignal.aborted).toBe(true);
      resolveOld({ ...result, items: [summary], total: 1 });
      await flushPromises();
      expect(wrapper.text()).not.toContain(summary.businessNo);
      expect(wrapper.find('[data-test="create-lead"]').exists()).toBe(false);
      wrapper.unmount();
    },
  );
  it('leaves workflow counters to the shared shell and keeps an empty state', async () => {
    api.listLeads.mockResolvedValue(result);
    const { wrapper } = await mountWithRoute('/leads');
    expect(wrapper.findAll('[data-test="lead-counter"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('还没有线索记录');
  });

  it('explains a filtered empty state without suggesting a new lead belongs there', async () => {
    api.listLeads.mockResolvedValue(result);
    const { wrapper } = await mountWithRoute('/leads?status=ARCHIVED');
    expect(wrapper.text()).toContain('「线索已归档」暂无记录');
    expect(wrapper.text()).toContain('可在侧栏切换其他状态');
    expect(wrapper.text()).not.toContain(
      '有创建权限时，可从右上角新建待推送线索',
    );
  });

  it('renders the Demo columns with real product totals and exact detail navigation', async () => {
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    const { wrapper } = await mountWithRoute('/leads');

    expect(wrapper.get('[data-test="lead-row"]').text()).toContain(
      'LD-20260921-001',
    );
    expect(wrapper.get('[data-test="lead-row"]').text()).toContain('淘宝');
    expect(wrapper.get('[data-test="lead-quantity-total"]').text()).toBe('1');
    expect(wrapper.get('[data-test="lead-comment-total"]').text()).toBe('0');
    expect(wrapper.get('[data-test="lead-first-unit-price"]').text()).toBe(
      '10.00',
    );
    expect(wrapper.get('[data-test="lead-estimated-amount"]').text()).toBe(
      '10.00',
    );
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '选择',
      '操作／线索编号',
      '案件进展',
      '平台',
      '店铺名',
      '店铺ID',
      '商品链接',
      '销量',
      '单价（元）',
      '评论数',
      '销售总额（估算／元）',
      '线索发现日期',
    ]);
    expect(wrapper.get('[data-test="lead-row"] a').attributes('href')).toBe(
      '/leads/lead-1',
    );
    expect(wrapper.get('.business-list-scroll').attributes('tabindex')).toBe(
      '0',
    );
    expect(wrapper.findAll('colgroup col')).toHaveLength(12);
    expect(wrapper.text()).toContain('shop-真实-001');
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.find('table.demo-table').exists()).toBe(true);
  });

  it('sums actual sales, comments and decimal estimates without using product count or floating point', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      total: 1,
      items: [
        {
          ...summary,
          products: [
            {
              ...summary.products[0],
              id: 'second',
              position: 2,
              quantity: 2,
              commentCount: 7,
              unitPrice: '4503599627370496.51',
              estimatedAmount: '9007199254740993.02',
            },
            {
              ...summary.products[0],
              id: 'first',
              position: 1,
              quantity: 0,
              commentCount: 3,
              unitPrice: '0.10',
              estimatedAmount: '0.30',
            },
            {
              ...summary.products[0],
              id: 'third',
              position: 3,
              quantity: 3,
              commentCount: 0,
              unitPrice: '0.01',
              estimatedAmount: '0.03',
            },
          ],
        },
      ],
    });
    const { wrapper } = await mountWithRoute('/leads');
    expect(wrapper.get('[data-test="lead-quantity-total"]').text()).toBe('5');
    expect(wrapper.get('[data-test="lead-comment-total"]').text()).toBe('10');
    expect(wrapper.get('[data-test="lead-first-unit-price"]').text()).toBe(
      '0.10',
    );
    expect(wrapper.get('[data-test="lead-estimated-amount"]').text()).toBe(
      '9007199254740993.35',
    );
    expect(wrapper.text()).toContain('3 件商品');
  });

  it('makes product names accessible and only links actual HTTP(S) URLs', async () => {
    const longTitle = '很长的真实商品名称'.repeat(40);
    api.listLeads.mockResolvedValue({
      ...result,
      total: 1,
      items: [
        {
          ...summary,
          products: [
            {
              ...summary.products[0],
              id: 'safe',
              position: 1,
              title: longTitle,
            },
            {
              ...summary.products[0],
              id: 'unsafe',
              position: 2,
              title: null,
              url: 'javascript:alert(1)',
            },
            {
              ...summary.products[0],
              id: 'missing',
              position: 3,
              title: '只有名称',
              url: null,
            },
          ],
        },
      ],
    });
    const { wrapper } = await mountWithRoute('/leads');
    const products = wrapper.get('.lead-list-products');
    expect(products.text()).toContain(longTitle);
    expect(products.findAll('a')).toHaveLength(1);
    expect(products.get('a').attributes('href')).toBe(
      'https://example.com/product-1',
    );
    expect(products.get('a').attributes('rel')).toBe('noopener noreferrer');
    expect(products.text()).toContain('无有效商品链接');
    expect(products.text()).not.toContain('javascript:');
    expect(wrapper.findAll('summary')).toHaveLength(2);
  });

  it('shows unrecorded products and price explicitly', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      total: 1,
      items: [{ ...summary, shopExternalId: null, products: [] }],
    });
    const { wrapper } = await mountWithRoute('/leads');
    expect(wrapper.get('[data-test="lead-first-unit-price"]').text()).toBe(
      '未登记',
    );
    expect(wrapper.text()).toContain('未登记商品');
    expect(wrapper.find('.lead-list-products').exists()).toBe(false);
  });

  it('ignores a late response after a page or status change and hides unavailable creation', async () => {
    let resolveOld!: (value: unknown) => void;
    api.listLeads
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...result,
        items: [{ ...summary, businessNo: 'LD-新范围' }],
        total: 1,
        capabilities: { create: false },
      });
    const { router, wrapper } = await mountWithRoute('/leads');
    const oldSignal = api.listLeads.mock.calls[0]?.[2].signal as AbortSignal;
    await router.push('/leads?status=ARCHIVED');
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    resolveOld({ ...result, items: [summary], total: 1 });
    await flushPromises();
    expect(wrapper.text()).toContain('LD-新范围');
    expect(wrapper.text()).not.toContain(summary.businessNo);
    expect(wrapper.find('[data-test="create-lead"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps failure distinct from empty and retries', async () => {
    api.listLeads
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...result,
        items: [summary],
        total: 1,
      });
    const { wrapper } = await mountWithRoute('/leads');
    expect(wrapper.text()).toContain('线索列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('LD-20260921-001');
  });

  it('paginates beyond 20 records and preserves the status filter in the route', async () => {
    api.listLeads.mockImplementation(
      async (
        page: number,
        pageSize: number,
        _options: unknown,
        status?: string,
      ) => ({
        ...result,
        items: [summary],
        total: 41,
        page,
        pageSize,
        counts: { ...result.counts, WAITING_PUSH: 41 },
        status,
      }),
    );
    const { router, wrapper } = await mountWithRoute(
      '/leads?page=2&status=WAITING_PUSH',
    );

    expect(api.listLeads).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'WAITING_PUSH',
      'LIBRARY',
    );
    expect(wrapper.text()).toContain('第 2 / 3 页');
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      page: '3',
      status: 'WAITING_PUSH',
    });
    expect(api.listLeads).toHaveBeenLastCalledWith(
      3,
      20,
      expect.any(Object),
      'WAITING_PUSH',
      'LIBRARY',
    );
  });

  it('retries and remounts the exact page restored from route query', async () => {
    api.listLeads
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...result,
        items: [summary],
        total: 21,
        page: 2,
      });
    const { wrapper } = await mountWithRoute('/leads?page=2');
    expect(wrapper.text()).toContain('线索列表暂时无法加载');

    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(api.listLeads).toHaveBeenNthCalledWith(
      2,
      2,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      undefined,
      'LIBRARY',
    );
    expect(wrapper.text()).toContain('第 2 / 2 页');
  });
});
