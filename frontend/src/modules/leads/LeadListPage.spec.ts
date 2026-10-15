import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import type { Lead } from '../../api/leads';
import { ApiError } from '../../api/http';
import LeadListPage from './LeadListPage.vue';

const api = vi.hoisted(() => ({
  listLeads: vi.fn(),
  getLead: vi.fn(),
  pushLead: vi.fn(),
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
  const wrapper = mount(LeadListPage, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return { router, wrapper, auth };
}

afterEach(() => {
  vi.resetAllMocks();
  sessionStorage.removeItem('dev-cor:lead-quick-actions:pending-push');
});

describe('LeadListPage', () => {
  it('restores an unresolved push after refresh even when its filtered row disappeared', async () => {
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    api.getLead.mockResolvedValue({
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
    });
    api.pushLead
      .mockRejectedValueOnce(new ApiError('network', 0, 'NETWORK_ERROR'))
      .mockResolvedValue({ id: 'push-1' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const first = await mountWithRoute('/leads');
    await first.wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await first.wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    const storedMap = JSON.parse(
      sessionStorage.getItem('dev-cor:lead-quick-actions:pending-push') ??
        'null',
    ) as Record<
      string,
      {
        leadId: string;
        expectedVersion: number;
        idempotencyKey: string;
        identity: string;
        status: string;
      }
    >;
    const stored = Object.values(storedMap).find(
      (attempt) => attempt.status === 'PENDING',
    );
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({
      leadId: summary.id,
      expectedVersion: summary.version,
    });
    expect(stored.idempotencyKey).toEqual(expect.any(String));
    expect(
      first.wrapper
        .get('[data-test="lead-quick-action"]')
        .attributes('disabled'),
    ).toBeDefined();
    first.wrapper.unmount();

    const readCount = api.getLead.mock.calls.length;
    api.listLeads.mockResolvedValue({ ...result, items: [], total: 0 });
    const reopened = await mountWithRoute('/leads');
    expect(api.getLead).toHaveBeenCalledTimes(readCount);
    expect(
      reopened.wrapper.findAll('[data-test="lead-quick-actions-panel"]'),
    ).toHaveLength(1);
    expect(
      reopened.wrapper.findAll('[data-test="retry-unknown-push"]'),
    ).toHaveLength(1);
    expect(
      reopened.wrapper.findAll('[data-test="lead-quick-action"]'),
    ).toHaveLength(0);
    reopened.wrapper.unmount();
  });

  it('isolates pending pushes by identity and replays only that identity’s frozen request', async () => {
    let activeUserId = 'operator-1';
    const summaryB: Lead = {
      ...summary,
      id: 'lead-b',
      businessNo: 'LD-B',
      departmentId: 'department-2',
      responsibleUserId: 'operator-2',
      displayNames: {
        customerName: '客户B',
        rightsHolderName: '权利主体B',
        responsibleUserName: '经办人B',
      },
    };
    api.listLeads.mockImplementation(async () => ({
      ...result,
      items: [activeUserId === 'operator-1' ? summary : summaryB],
      total: 1,
    }));
    api.getLead.mockImplementation(async (id: string) => ({
      ...summary,
      id,
      businessNo: id === 'lead-b' ? 'LD-B' : summary.businessNo,
      version: id === 'lead-b' ? 9 : summary.version,
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
    }));
    api.pushLead
      .mockRejectedValueOnce(
        new ApiError('lost A response', 0, 'NETWORK_ERROR'),
      )
      .mockRejectedValueOnce(
        new ApiError('lost B response', 0, 'NETWORK_ERROR'),
      )
      .mockResolvedValue({ id: 'push-result' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { auth, wrapper } = await mountWithRoute('/leads');
    const identityA = auth.session!;
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    const requestA = api.pushLead.mock.calls[0] as [string, number, string];
    expect(requestA[0]).toBe(summary.id);

    activeUserId = 'operator-2';
    auth.session = {
      ...identityA,
      user: { ...identityA.user, id: 'operator-2', displayName: '经办人B' },
      department: { id: 'department-2', name: '部门B' },
      departments: [{ id: 'department-2', name: '部门B' }],
      authorizationRevision: 2,
    };
    await flushPromises();
    expect(
      wrapper.findAll('[data-test="lead-quick-actions-panel"]'),
    ).toHaveLength(0);
    expect(wrapper.text()).not.toContain(summary.businessNo);
    expect(
      wrapper.get('[data-test="lead-quick-action"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('LD-B');
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    const requestB = api.pushLead.mock.calls[1] as [string, number, string];
    expect(requestB[0]).toBe('lead-b');
    expect(requestB[1]).toBe(9);
    const storedAfterB = JSON.parse(
      sessionStorage.getItem('dev-cor:lead-quick-actions:pending-push') ??
        'null',
    ) as Record<string, { idempotencyKey: string; status: string }>;
    expect(
      Object.values(storedAfterB).filter(
        (attempt) => attempt.status === 'PENDING',
      ),
    ).toHaveLength(2);

    activeUserId = 'operator-1';
    auth.session = identityA;
    await flushPromises();
    expect(wrapper.findAll('[data-test="retry-unknown-push"]')).toHaveLength(1);
    await wrapper.get('[data-test="retry-unknown-push"]').trigger('click');
    await flushPromises();
    expect(api.pushLead.mock.calls[2]).toEqual(requestA);
    const afterLateASettlement = JSON.parse(
      sessionStorage.getItem('dev-cor:lead-quick-actions:pending-push') ??
        'null',
    ) as Record<string, { leadId: string; status: string }>;
    expect(
      Object.values(afterLateASettlement).some(
        (attempt) => attempt.leadId === requestA[0],
      ),
    ).toBe(false);
    expect(
      Object.values(afterLateASettlement).find(
        (attempt) => attempt.leadId === requestB[0],
      )?.status,
    ).toBe('PENDING');
    expect(
      Object.values(afterLateASettlement).filter(
        (attempt) => attempt.status === 'PENDING',
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('settles a late response only for its original identity', async () => {
    let activeUserId = 'operator-1';
    let resolveA!: (value: { id: string }) => void;
    const summaryB: Lead = {
      ...summary,
      id: 'lead-b',
      businessNo: 'LD-B',
      departmentId: 'department-2',
      responsibleUserId: 'operator-2',
    };
    api.listLeads.mockImplementation(async () => ({
      ...result,
      items: [activeUserId === 'operator-1' ? summary : summaryB],
      total: 1,
    }));
    api.getLead.mockImplementation(async (id: string) => ({
      ...summary,
      id,
      businessNo: id === 'lead-b' ? 'LD-B' : summary.businessNo,
      version: id === 'lead-b' ? 9 : summary.version,
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
    }));
    api.pushLead
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockRejectedValueOnce(
        new ApiError('lost B response', 0, 'NETWORK_ERROR'),
      );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { auth, wrapper } = await mountWithRoute('/leads');
    const identityA = auth.session!;
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    expect(api.pushLead.mock.calls[0]?.[0]).toBe(summary.id);

    activeUserId = 'operator-2';
    auth.session = {
      ...identityA,
      user: { ...identityA.user, id: 'operator-2', displayName: '经办人B' },
      department: { id: 'department-2', name: '部门B' },
      departments: [{ id: 'department-2', name: '部门B' }],
      authorizationRevision: 2,
    };
    await flushPromises();
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    const requestB = api.pushLead.mock.calls[1] as [string, number, string];
    expect(requestB[0]).toBe('lead-b');

    resolveA({ id: 'push-a' });
    await flushPromises();
    expect(wrapper.findAll('[data-test="retry-unknown-push"]')).toHaveLength(1);
    const stored = JSON.parse(
      sessionStorage.getItem('dev-cor:lead-quick-actions:pending-push') ??
        'null',
    ) as Record<
      string,
      { leadId: string; idempotencyKey: string; status: string }
    >;
    expect(
      stored[identityA.user.id + ':INTERNAL:department-1:1'],
    ).toBeUndefined();
    expect(Object.values(stored)).toContainEqual({
      leadId: requestB[0],
      expectedVersion: requestB[1],
      idempotencyKey: requestB[2],
      identity: 'operator-2:INTERNAL:department-2:2',
      status: 'PENDING',
    });
    wrapper.unmount();
  });

  it('opens one-row actions from a fresh detail and keeps page/status after push', async () => {
    api.listLeads.mockResolvedValue({
      ...result,
      items: [summary],
      page: 2,
      total: 21,
    });
    api.getLead.mockResolvedValue({
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
    });
    api.pushLead.mockResolvedValue({
      id: 'push-1',
      businessNo: summary.businessNo,
      status: 'WAITING_REVIEW',
      version: 2,
      pushedAt: '2026-10-15T00:00:00.000Z',
      pushedByUserId: 'operator-1',
      pushedByDisplayName: '运营人',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { router, wrapper } = await mountWithRoute(
      '/leads?page=2&status=WAITING_PUSH',
    );
    await wrapper.get('[data-test="lead-quick-action"]').trigger('click');
    await flushPromises();
    expect(api.getLead).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const editUrl = new URL(
      wrapper.get('[data-test="quick-edit-lead"]').attributes('href')!,
      'https://internal.invalid',
    );
    expect(editUrl.searchParams.get('returnTo')).toBe(
      '/leads?page=2&status=WAITING_PUSH',
    );
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).toHaveBeenCalledOnce();
    expect(
      sessionStorage.getItem('dev-cor:lead-quick-actions:pending-push'),
    ).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe(
      '/leads?page=2&status=WAITING_PUSH',
    );
    expect(api.listLeads).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'WAITING_PUSH',
      'LIBRARY',
    );
    wrapper.unmount();
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
    expect(wrapper.findAll('colgroup col')).toHaveLength(11);
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
