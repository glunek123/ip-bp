import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { defineComponent, h, type PropType } from 'vue';
import { ApiError } from '../../api/http';
import type { LeadDetail } from '../../api/leads';
import LeadDetailPage from './LeadDetailPage.vue';

const leadApi = vi.hoisted(() => ({
  getLead: vi.fn(),
  pushLead: vi.fn(),
  applyLeadWithdrawal: vi.fn(),
  decideLeadNoEvidence: vi.fn(),
}));
const customerApi = vi.hoisted(() => ({ getCustomer: vi.fn() }));
const holderApi = vi.hoisted(() => ({ getCustomerRightsHolder: vi.fn() }));
const materialApi = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
const notaryApi = vi.hoisted(() => ({
  listNotaryOffices: vi.fn(),
  createNotaryOffice: vi.fn(),
  createNotaryMatter: vi.fn(),
}));
vi.mock('../../api/leads', () => leadApi);
vi.mock('../../api/customers', () => customerApi);
vi.mock('../../api/rights-holders', () => holderApi);
vi.mock('../../api/materials', () => materialApi);
vi.mock('../../api/notary', () => notaryApi);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  displayNames: {
    customerName: '客户甲',
    rightsHolderName: '主体甲',
    responsibleUserName: '运营甲',
  },
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-21T04:00:00Z',
  shopName: '测试店铺',
  shopExternalId: null,
  needDisclose: true,
  remark: '备注',
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 2,
      unitPrice: '3.00',
      commentCount: 0,
      estimatedAmount: '6.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  version: 1,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  createdAt: '2026-09-21T04:00:00Z',
  updatedAt: '2026-09-21T04:00:00Z',
  capabilities: {
    edit: true,
    push: true,
    withdrawApply: false,
    evidenceDecide: false,
    transferToNotary: false,
    createEvidenceBatch: false,
  },
  notaryMatters: [],
  pendingWithdrawalApplication: null,
  evidenceDecision: null,
  history: [],
  departmentId: 'd',
  responsibleUserId: 'u',
  teamId: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
} satisfies LeadDetail;

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
async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().session = {
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
      { path: '/leads/:id', component: LeadDetailPage },
      { path: '/leads/:id/edit', component: { template: '<div />' } },
      { path: '/leads', component: { template: '<div />' } },
    ],
  });
  await router.push('/leads/lead-1');
  await router.isReady();
  const wrapper = mount(
    { components: { RouterView }, template: '<RouterView />' },
    {
      global: { plugins: [pinia, router], stubs: { ElDrawer: DrawerStub } },
    },
  );
  cleanups.push(() => wrapper.unmount());
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  leadApi.getLead.mockResolvedValue(lead);
  notaryApi.listNotaryOffices.mockResolvedValue({
    items: [{ id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' }],
    capabilities: { create: false },
  });
  notaryApi.createNotaryMatter.mockResolvedValue({
    id: 'matter-1',
    businessNo: 'NT-20260924-001',
    leadId: 'lead-1',
    leadStatus: 'TRANSFERRED_TO_NOTARY',
    leadVersion: 4,
    stage: 'PENDING_EVIDENCE',
    notaryOffice: { id: 'office-1', name: '广州市南方公证处' },
    selectedProductIds: ['p'],
    selectedContentVersionIds: ['version-1'],
    evidenceMode: 'ONLINE_PURCHASE',
    batchPurpose: '首批线上取证',
    createdAt: '2026-09-24T01:00:00.000Z',
  });
  customerApi.getCustomer.mockResolvedValue({
    id: 'customer-1',
    name: '客户甲',
  });
  holderApi.getCustomerRightsHolder.mockResolvedValue({
    id: 'holder-1',
    name: '主体甲',
  });
  materialApi.listOwnerMaterials.mockResolvedValue({
    items: [
      {
        id: 'material-1',
        status: 'ACTIVE',
        currentVersionId: 'version-1',
        contentVersions: [
          { id: 'version-1', originalFilename: '侵权截图.png' },
        ],
      },
    ],
    total: 1,
  });
  materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
  leadApi.pushLead.mockResolvedValue({
    id: lead.id,
    businessNo: lead.businessNo,
    status: 'WAITING_REVIEW',
    version: 2,
    pushedAt: '2026-09-22T02:00:00.000Z',
    pushedByUserId: 'u',
    pushedByDisplayName: '运营甲',
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
const waiting: LeadDetail = {
  ...lead,
  status: 'WAITING_EVIDENCE_DECISION',
  version: 3,
  capabilities: {
    ...lead.capabilities,
    edit: false,
    push: false,
    evidenceDecide: true,
    transferToNotary: true,
  },
};
async function openTransfer(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  await wrapper.get('[data-test="open-lead-workflow"]').trigger('click');
  await flushPromises();
  await wrapper.get('[data-test="choose-transfer"]').setValue();
  await wrapper.get('[data-test="select-product-p"]').setValue(true);
  await wrapper.get('[data-test="select-evidence-version-1"]').setValue(true);
  await wrapper.get('[data-test="notary-office"]').setValue('office-1');
  await wrapper.get('[data-test="batch-purpose"]').setValue('首批线上取证');
}
describe('LeadDetailPage', () => {
  it('reopens a pending push after the server advanced and the drawer fresh read failed', async () => {
    const identity = 'operator-1:INTERNAL:department-1:1';
    sessionStorage.setItem(
      'dev-cor:lead-workflow:pending',
      JSON.stringify({
        [identity]: {
          identity,
          leadId: lead.id,
          expectedVersion: 1,
          idempotencyKey: 'detail-original-recovery',
          action: 'push',
          body: { expectedVersion: 1 },
        },
      }),
    );
    const current: LeadDetail = {
      ...lead,
      status: 'WAITING_REVIEW',
      version: 2,
      capabilities: { ...lead.capabilities, push: false, edit: false },
    };
    leadApi.getLead
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(current);
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('资料加载失败');
    await wrapper.get('[data-test="close-drawer"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="reopen-pending-lead"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="retry-unknown-lead"]').trigger('click');
    await flushPromises();
    expect(leadApi.pushLead).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      1,
      'detail-original-recovery',
    );
    expect(wrapper.find('[data-test="reopen-pending-lead"]').exists()).toBe(
      false,
    );
  });
  it.each(['user', 'department', 'revision'] as const)(
    'clears sensitive detail and ignores late reads after %s changes',
    async (change) => {
      let resolveOld!: (value: LeadDetail) => void;
      leadApi.getLead
        .mockResolvedValueOnce(lead)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve;
            }),
        )
        .mockRejectedValueOnce(
          new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
        );
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain('客户甲');
      await wrapper.get('[data-test="refresh"]').trigger('click');
      const oldSignal = leadApi.getLead.mock.calls[1]![1].signal as AbortSignal;
      const auth = useAuthStore();
      auth.session = {
        ...auth.session!,
        ...(change === 'revision'
          ? { authorizationRevision: 2 }
          : change === 'user'
            ? { user: { ...auth.session!.user, id: 'operator-2' } }
            : { department: { id: 'department-2', name: '另一部门' } }),
      };
      await flushPromises();
      expect(oldSignal.aborted).toBe(true);
      resolveOld(lead);
      await flushPromises();
      expect(wrapper.text()).not.toContain('客户甲');
      expect(wrapper.text()).not.toContain('测试店铺');
      expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="download-screenshot-version-1"]').exists(),
      ).toBe(false);
      wrapper.unmount();
    },
  );

  it('reloads a reused detail route without keeping the prior source', async () => {
    const wrapper = await mountPage();
    leadApi.getLead.mockResolvedValueOnce({
      ...lead,
      id: 'lead-2',
      shopName: '另一来源店铺',
    });
    await wrapper.vm.$router.push('/leads/lead-2');
    await flushPromises();
    expect(leadApi.getLead).toHaveBeenLastCalledWith(
      'lead-2',
      expect.any(Object),
    );
    expect(wrapper.text()).toContain('另一来源店铺');
    expect(wrapper.text()).not.toContain('测试店铺');
    wrapper.unmount();
  });

  it('assigns waiting review to the client without an internal confirmation action', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_REVIEW',
      capabilities: { ...lead.capabilities, push: false, edit: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="lead-workflow"]').text()).toContain(
      '下一步由客户',
    );
    expect(wrapper.get('[data-test="lead-workflow"]').text()).toContain(
      '不能代客户确认',
    );
    expect(wrapper.find('[data-test="handoff-form-link"]').exists()).toBe(
      false,
    );
    expect(notaryApi.createNotaryMatter).not.toHaveBeenCalled();
  });

  it('uses the Demo detail grid, product table and attachment section', async () => {
    const wrapper = await mountPage();

    expect(wrapper.get('[data-test="lead-facts"]').classes()).toContain(
      'demo-detail-grid',
    );
    expect(
      wrapper.get('[data-test="lead-products-table"]').find('table').exists(),
    ).toBe(true);
    expect(wrapper.get('[data-test="lead-attachments"]').text()).toContain(
      '侵权截图.png',
    );
  });

  it('renders real detail fields, record information and push action', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('权利主体');
    expect(wrapper.text()).toContain('案件类型');
    expect(wrapper.text()).toContain('运营甲');
    expect(customerApi.getCustomer).not.toHaveBeenCalled();
    expect(holderApi.getCustomerRightsHolder).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.text()).toContain('测试店铺');
    expect(wrapper.text()).toContain('商品甲');
    expect(wrapper.text()).toContain('6.00');
    expect(wrapper.text()).toContain('侵权截图.png');
    expect(wrapper.text()).toContain('版本 1');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(true);
    expect(materialApi.listOwnerMaterials).toHaveBeenCalledWith(
      'LEAD',
      'lead-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await wrapper
      .get('[data-test="download-screenshot-version-1"]')
      .trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'version-1',
      expect.any(AbortSignal),
    );
  });

  it('shows edit only from the server capability and supports refresh', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(true);
    leadApi.getLead.mockResolvedValueOnce({
      ...lead,
      capabilities: { edit: false, push: false },
    });
    await wrapper.get('[data-test="refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });

  it('shows only authorized names even when master data cannot be read', async () => {
    customerApi.getCustomer.mockRejectedValue(
      new ApiError('禁止读取', 403, 'FORBIDDEN'),
    );
    holderApi.getCustomerRightsHolder.mockRejectedValue(
      new ApiError('禁止读取', 403, 'FORBIDDEN'),
    );
    leadApi.getLead.mockResolvedValue({
      ...lead,
      displayNames: {
        customerName: '客户名称不可见',
        rightsHolderName: '权利主体名称不可见',
        responsibleUserName: '负责人名称不可见',
      },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('客户名称不可见');
    expect(wrapper.text()).toContain('权利主体名称不可见');
    expect(wrapper.text()).toContain('负责人名称不可见');
    expect(wrapper.get('[data-test="lead-facts"]').text()).not.toContain(
      'customer-1',
    );
    expect(wrapper.get('[data-test="lead-facts"]').text()).not.toContain(
      'holder-1',
    );
    expect(customerApi.getCustomer).not.toHaveBeenCalled();
    expect(holderApi.getCustomerRightsHolder).not.toHaveBeenCalled();
  });

  it('keeps transferred source read-only and displays exact product totals and safe links', async () => {
    const longTitle = '完整商品名称'.repeat(50);
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'TRANSFERRED_TO_NOTARY',
      capabilities: {
        edit: false,
        push: false,
        withdrawApply: false,
        evidenceDecide: false,
        transferToNotary: false,
        createEvidenceBatch: true,
      },
      products: [
        {
          ...lead.products[0],
          id: 'p2',
          position: 2,
          title: longTitle,
          url: 'https://example.com/product',
          quantity: 2,
          commentCount: 7,
          unitPrice: '4503599627370496.51',
          estimatedAmount: '9007199254740993.02',
        },
        {
          ...lead.products[0],
          position: 1,
          title: '评论估算商品',
          quantity: 0,
          commentCount: 3,
          unitPrice: '0.10',
          estimatedAmount: '0.30',
          url: 'javascript:alert(1)',
        },
      ],
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="open-lead-workflow"]').exists()).toBe(
      true,
    );
    const table = wrapper.get('[data-test="lead-products-table"]');
    expect(table.findAll('thead th').map((cell) => cell.text())).toEqual([
      '商品名称',
      '商品链接',
      '销量',
      '单价（元）',
      '评论数',
      '销售总额（估算／元）',
    ]);
    expect(table.get('tbody tr').text()).toContain('评论估算商品');
    expect(table.text()).toContain(longTitle);
    expect(table.findAll('a')).toHaveLength(1);
    expect(table.get('a').attributes('href')).toBe(
      'https://example.com/product',
    );
    expect(table.text()).toContain('无有效商品链接');
    expect(table.text()).not.toContain('javascript:');
    expect(
      table
        .get('[data-test="lead-product-summary"]')
        .findAll('td')
        .map((cell) => cell.text()),
    ).toEqual(['2', '—', '10', '9007199254740993.32']);
  });

  it('aborts pending detail reads when the account context unmounts the page', async () => {
    let resolveOld!: (value: unknown) => void;
    leadApi.getLead.mockReturnValue(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = await mountPage();
    const signal = leadApi.getLead.mock.calls[0]?.[1].signal as AbortSignal;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    resolveOld(lead);
    await flushPromises();
    expect(materialApi.listOwnerMaterials).not.toHaveBeenCalled();
    expect(notaryApi.listNotaryOffices).not.toHaveBeenCalled();
  });

  it('shows a human operator name in the push record', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_REVIEW',
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'user-uuid',
      pushedByDisplayName: '运营甲',
      capabilities: { edit: false, push: false },
    });

    const wrapper = await mountPage();

    expect(wrapper.get('[data-test="push-record"]').text()).toContain('运营甲');
    expect(wrapper.get('[data-test="push-record"]').text()).not.toContain(
      'user-uuid',
    );
  });

  it('shows the formal client decision read-only using the reviewer snapshot', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'operator-uuid',
      pushedByDisplayName: '运营甲',
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('线索待确认');
    const record = wrapper.get('[data-test="client-review-record"]');
    expect(record.text()).toContain('客户审核记录');
    expect(record.text()).toContain('确认侵权');
    expect(record.text()).toContain('企业审核员');
    expect(record.text()).toContain('2026');
    expect(record.text()).not.toContain('reviewer-uuid');
    expect(wrapper.text()).not.toContain('确认取证');
    expect(wrapper.text()).not.toContain('不取证');
    expect(wrapper.text()).not.toContain('移交公证');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });

  it('shows archived no-infringement reason and archive time without an operator review action', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'ARCHIVED',
      version: 3,
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'operator-uuid',
      pushedByDisplayName: '运营甲',
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '经核对未使用我司标识',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false },
    });
    const wrapper = await mountPage();
    const record = wrapper.get('[data-test="client-review-record"]');
    expect(record.text()).toContain('判定不侵权并归档');
    expect(record.text()).toContain('经核对未使用我司标识');
    expect(record.text()).toContain('归档时间');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });

  it('does not infer a client decision from the lead status alone', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: null,
      capabilities: { edit: false, push: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="client-review-record"]').exists()).toBe(
      false,
    );
  });

  it('shows only the exact screenshot versions referenced by the Lead', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      leadScreenshotContentVersionIds: ['version-b'],
    });
    materialApi.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: 'material-a',
          status: 'ACTIVE',
          currentVersionId: 'version-a',
          contentVersions: [
            { id: 'version-a', originalFilename: '旧截图.png' },
          ],
        },
        {
          id: 'material-b',
          status: 'ACTIVE',
          currentVersionId: 'version-b',
          contentVersions: [
            { id: 'version-b', originalFilename: '当前截图.png' },
          ],
        },
      ],
      total: 2,
    });

    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('当前截图.png');
    expect(wrapper.text()).not.toContain('旧截图.png');
    expect(
      wrapper.find('[data-test="download-screenshot-version-a"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="download-screenshot-version-b"]').exists(),
    ).toBe(true);
  });
  it('reuses the exact transfer form and shows only its verified receipt, clearing a stale direct link on refresh', async () => {
    leadApi.getLead.mockResolvedValue(waiting);
    const transferred: LeadDetail = {
      ...waiting,
      status: 'TRANSFERRED_TO_NOTARY',
      version: 4,
      capabilities: {
        ...waiting.capabilities,
        transferToNotary: false,
        evidenceDecide: false,
      },
      notaryMatters: [
        {
          id: 'matter-1',
          businessNo: 'NT-20260924-001',
          stage: 'PENDING_EVIDENCE',
          notaryOfficeName: '公证处',
          batchPurpose: '首批线上取证',
          createdAt: '2026-10-15T00:00:00Z',
        },
      ],
    };
    notaryApi.createNotaryMatter.mockImplementationOnce(async () => {
      leadApi.getLead.mockResolvedValue(transferred);
      return { id: 'matter-1', businessNo: 'NT-20260924-001' };
    });
    const wrapper = await mountPage();
    await openTransfer(wrapper);
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(notaryApi.createNotaryMatter).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      {
        selectedProductIds: ['p'],
        selectedContentVersionIds: ['version-1'],
        notaryOfficeId: 'office-1',
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '首批线上取证',
        expectedVersion: 3,
      },
      expect.any(String),
    );
    expect(
      wrapper.get('[data-test="handoff-matter-link"]').attributes('href'),
    ).toBe('/notary-matters/matter-1');
    leadApi.getLead.mockResolvedValue({ ...transferred, notaryMatters: [] });
    await wrapper.get('[data-test="refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="handoff-matter-link"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="matter-link-matter-1"]').exists()).toBe(
      false,
    );
  });
  it.each([503, 403, 404])(
    'does not retain a receipt link when formal read returns %s',
    async (status) => {
      leadApi.getLead.mockResolvedValue(waiting);
      notaryApi.createNotaryMatter.mockImplementationOnce(async () => {
        leadApi.getLead.mockRejectedValue(
          new ApiError(
            'unavailable',
            status,
            status === 404 ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN',
          ),
        );
        return { id: 'matter-1', businessNo: 'NT-1' };
      });
      const wrapper = await mountPage();
      await openTransfer(wrapper);
      await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-test="handoff-matter-link"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="lead-workflow-form"]').exists()).toBe(
        false,
      );
    },
  );
  it('reuses no-evidence form and reloads the real immutable decision instead of guessing the new stage', async () => {
    leadApi.getLead.mockResolvedValue(waiting);
    leadApi.decideLeadNoEvidence.mockImplementationOnce(async () => {
      leadApi.getLead.mockResolvedValue({
        ...waiting,
        status: 'ARCHIVED',
        version: 4,
        capabilities: {
          ...waiting.capabilities,
          evidenceDecide: false,
          transferToNotary: false,
        },
        evidenceDecision: {
          result: 'NO_EVIDENCE',
          reason: '现阶段不取证',
          decidedAt: '2026-10-15T00:00:00Z',
          decidedByDisplayName: '运营甲',
          archiveType: 'NO_EVIDENCE',
          archivedAt: '2026-10-15T00:00:00Z',
        },
      });
      return { status: 'ARCHIVED' };
    });
    const wrapper = await mountPage();
    await wrapper.get('[data-test="open-lead-workflow"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="choose-no-evidence"]').setValue();
    await wrapper
      .get('[data-test="no-evidence-reason"]')
      .setValue('  现阶段不取证  ');
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(leadApi.decideLeadNoEvidence).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      '现阶段不取证',
      3,
      expect.any(String),
    );
    const record = wrapper.get('[data-test="evidence-decision-record"]');
    expect(record.text()).toContain('现阶段不取证');
    expect(record.text()).toContain('运营甲');
    expect(wrapper.find('[data-test="lead-workflow-form"]').exists()).toBe(
      false,
    );
  });
  it('reuses withdrawal form and retains archived status plus the returned pending application', async () => {
    const archived: LeadDetail = {
      ...lead,
      status: 'ARCHIVED',
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        withdrawApply: true,
      },
    };
    leadApi.getLead.mockResolvedValue(archived);
    leadApi.applyLeadWithdrawal.mockImplementationOnce(async () => {
      leadApi.getLead.mockResolvedValue({
        ...archived,
        version: 2,
        capabilities: { ...archived.capabilities, withdrawApply: false },
        pendingWithdrawalApplication: {
          id: 'application-1',
          reason: '客户结论误录',
          appliedAt: '2026-10-15T00:00:00Z',
          applicantDisplayName: '运营甲',
        },
      });
      return { status: 'ARCHIVED' };
    });
    const wrapper = await mountPage();
    await wrapper.get('[data-test="open-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('只有原客户企业确认后才回到待审核');
    await wrapper
      .get('[data-test="withdrawal-reason"]')
      .setValue('客户结论误录');
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(leadApi.applyLeadWithdrawal).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      '客户结论误录',
      1,
      expect.any(String),
    );
    expect(wrapper.get('[data-test="withdrawal-pending"]').text()).toContain(
      '线索仍保持归档',
    );
  });
  it('cancels a push drawer without a command and uses the shared form for a confirmed push', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-test="push-lead"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="close-drawer"]').trigger('click');
    await flushPromises();
    expect(leadApi.pushLead).not.toHaveBeenCalled();
    await wrapper.get('[data-test="push-lead"]').trigger('click');
    await flushPromises();
    leadApi.pushLead.mockImplementationOnce(async () => {
      leadApi.getLead.mockResolvedValue({
        ...lead,
        version: 2,
        status: 'WAITING_REVIEW',
        capabilities: { ...lead.capabilities, push: false, edit: false },
      });
      return { id: 'receipt' };
    });
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(leadApi.pushLead).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      1,
      expect.any(String),
    );
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });
  it('aborts downloads and hides late shared-form success after identity change', async () => {
    let resolvePush!: () => void, rejectDownload!: (error: Error) => void;
    leadApi.pushLead.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve;
        }),
    );
    materialApi.downloadMaterialVersion.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDownload = reject;
        }),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="download-screenshot-version-1"]')
      .trigger('click');
    const signal = materialApi.downloadMaterialVersion.mock
      .calls[0]![2] as AbortSignal;
    await wrapper.get('[data-test="push-lead"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    leadApi.getLead.mockRejectedValue(
      new ApiError('denied', 403, 'ACTION_FORBIDDEN'),
    );
    const auth = useAuthStore();
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    resolvePush();
    rejectDownload(new Error('late'));
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.text()).not.toContain('截图下载失败');
    expect(wrapper.find('[data-test="handoff-success"]').exists()).toBe(false);
  });
});
