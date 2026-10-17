import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import type { Lead, LeadPushResult, LeadDetail } from '../../api/leads';
import {
  readPendingLeadBatchPush,
  savePendingLeadBatchPush,
} from './lead-batch-push-recovery';
import { defineComponent, h, type PropType } from 'vue';
import { readPendingLeadCommands } from './LeadListWorkflowPanel.vue';
import { ApiError } from '../../api/http';
import LeadQuickActionsPanel from './LeadQuickActionsPanel.vue';
import LeadListPage from './LeadListPage.vue';

const api = vi.hoisted(() => ({
  listLeads: vi.fn(),
  getLead: vi.fn(),
  pushLead: vi.fn(),
  pushLeadsBatch: vi.fn(),
}));
vi.mock('../../api/leads', () => api);

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
});

describe('LeadListPage', () => {
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
