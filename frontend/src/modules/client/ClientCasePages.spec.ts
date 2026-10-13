import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import ClientCaseDetailPage from './ClientCaseDetailPage.vue';
import ClientCaseListPage from './ClientCaseListPage.vue';
const api = vi.hoisted(() => ({
  listClientCases: vi.fn(),
  getClientCase: vi.fn(),
}));
vi.mock('../../api/client-cases', () => api);
vi.mock('../../api/materials', () => ({ downloadMaterialVersion: vi.fn() }));
vi.mock('../cases', () => ({
  CaseComplaintMailingPanel: {
    props: ['item', 'client'],
    template:
      '<div data-test="mail-panel">{{ item.stage }} {{ item.canMailComplaint ? "办理" : "只读" }}</div>',
  },
}));
const list = {
  items: [
    {
      id: 'case-1',
      businessNo: 'CA-001',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 2,
      canMailComplaint: false,
      canMailExecution: false,
      rightsHolderName: '权利人甲',
      defendantNames: ['被告甲'],
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};
const detail = {
  ...list.items[0],
  confirmedAmountState: 'KNOWN',
  confirmedAmount: '123.45',
  confirmedAt: '2026-10-02T00:00:00Z',
  complaintFile: {
    materialId: 'm-1',
    contentVersionId: 'v-1',
    originalFilename: '诉状.pdf',
    mimeType: 'application/pdf',
  },
  authorizationFiles: [],
  pendingReceiptFiles: [],
  complaintMailing: null,
};
let pinia = createPinia();
const mountedPages: VueWrapper[] = [];
afterEach(() => {
  mountedPages.splice(0).forEach((wrapper) => wrapper.unmount());
});
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore(pinia).session = {
    principalType: 'CLIENT',
    authorizationRevision: 1,
    user: { id: 'client-1' },
  } as never;
  api.listClientCases.mockResolvedValue(list);
  api.getClientCase.mockImplementation(async () => detail);
});
async function mountPage(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/cases', component: ClientCaseListPage },
      { path: '/client/cases/:id', component: ClientCaseDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RouterView, {
    global: { plugins: [pinia, router] },
  });
  mountedPages.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function paginatedList(page: number, total = 21) {
  return {
    ...list,
    page,
    total,
    items: Array.from(
      { length: Math.min(20, Math.max(0, total - (page - 1) * 20)) },
      (_, index) => {
        const number = (page - 1) * 20 + index + 1;
        return {
          ...list.items[0],
          id: `case-${number}`,
          businessNo: `CA-${String(number).padStart(3, '0')}`,
        };
      },
    ),
  };
}
function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
describe('client case pages', () => {
  it('loads the default pending enterprise queue and identifies each case', async () => {
    const { wrapper } = await mountPage('/client/cases');
    expect(api.listClientCases).toHaveBeenCalledWith(
      1,
      20,
      'PENDING',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.get('[data-test="client-case-list"]').text()).toContain(
      '权利人甲',
    );
    expect(wrapper.get('[data-test="client-case-list"]').text()).toContain(
      '被告甲',
    );
    expect(
      wrapper.get('[data-test="client-case-list"] a').attributes('href'),
    ).toBe('/client/cases/case-1');
  });
  it('shows only the minimal client facts and no mailing action for a read-only case', async () => {
    const { wrapper } = await mountPage('/client/cases/case-1');
    expect(wrapper.text()).toContain('¥ 123.45');
    expect(wrapper.text()).toContain('只读');
    expect(wrapper.text()).not.toContain('负责人');
    expect(wrapper.find('[data-test="mailing-submit"]').exists()).toBe(false);
  });
  it('paginates 21 cases with exact detail IDs and first/last page boundaries', async () => {
    api.listClientCases.mockImplementation(async (page: number) =>
      paginatedList(page),
    );
    const { wrapper, router } = await mountPage('/client/cases?view=PENDING');
    expect(wrapper.findAll('.notary-offices-list li')).toHaveLength(20);
    expect(button(wrapper, '上一页').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '下一页').attributes('disabled')).toBeUndefined();
    await button(wrapper, '下一页').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'PENDING',
      page: '2',
    });
    expect(api.listClientCases).toHaveBeenLastCalledWith(
      2,
      20,
      'PENDING',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.findAll('.notary-offices-list li')).toHaveLength(1);
    expect(
      wrapper.get('[data-test="client-case-list"] a').attributes('href'),
    ).toBe('/client/cases/case-21');
    expect(wrapper.text()).toContain('第 2 页 · 共 21 项');
    expect(button(wrapper, '下一页').attributes('disabled')).toBeDefined();
    await button(wrapper, '上一页').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe('1');
    expect(wrapper.findAll('.notary-offices-list li')).toHaveLength(20);
  });
  it('resets the page when switching views and preserves other query parameters', async () => {
    api.listClientCases.mockImplementation(async (page: number) =>
      paginatedList(page),
    );
    const { wrapper, router } = await mountPage(
      '/client/cases?view=PENDING&page=2&source=calendar',
    );
    await button(wrapper, '已登记').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'RECORDED',
      source: 'calendar',
    });
    expect(api.listClientCases).toHaveBeenLastCalledWith(
      1,
      20,
      'RECORDED',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it('returns from the exact case detail to the same list page and view', async () => {
    api.listClientCases.mockImplementation(async (page: number) =>
      paginatedList(page),
    );
    api.getClientCase.mockResolvedValueOnce({
      ...detail,
      id: 'case-21',
      businessNo: 'CA-021',
    });
    const { wrapper, router } = await mountPage(
      '/client/cases?view=RECORDED&page=2',
    );
    await wrapper.get('[data-test="client-case-list"] a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/client/cases/case-21');
    expect(api.getClientCase).toHaveBeenCalledWith(
      'case-21',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'RECORDED',
      page: '2',
    });
    expect(wrapper.get('[data-test="client-case-list"]').text()).toContain(
      'CA-021',
    );
    expect(api.listClientCases.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      2,
      20,
      'RECORDED',
    ]);
  });
  it('restores page and view from the URL on remount, refresh and browser back', async () => {
    api.listClientCases.mockImplementation(async (page: number) =>
      paginatedList(page),
    );
    const { wrapper, router } = await mountPage(
      '/client/cases?view=RECORDED&page=2',
    );
    expect(api.listClientCases).toHaveBeenLastCalledWith(
      2,
      20,
      'RECORDED',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    expect(api.listClientCases.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      2,
      20,
      'RECORDED',
    ]);
    await button(wrapper, '待盖章').trigger('click');
    await flushPromises();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'RECORDED',
      page: '2',
    });
    expect(wrapper.text()).toContain('CA-021');
    const reloaded = await mountPage(router.currentRoute.value.fullPath);
    expect(reloaded.wrapper.text()).toContain('第 2 页');
    expect(api.listClientCases.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      2,
      20,
      'RECORDED',
    ]);
  });
  it.each(['0', '-1', '1.5', 'abc', '1e2', '9007199254740992', '2&page=3'])(
    'requests the first page for invalid URL page %s',
    async (value) => {
      await mountPage(`/client/cases?page=${value}&view=invalid`);
      expect(api.listClientCases.mock.calls.at(-1)?.slice(0, 3)).toEqual([
        1,
        20,
        'PENDING',
      ]);
    },
  );
  it('shows an empty list and lets an empty out-of-range page return to a populated page', async () => {
    const empty = await mountPage('/client/cases');
    api.listClientCases.mockResolvedValueOnce({ ...list, items: [], total: 0 });
    await button(empty.wrapper, '刷新').trigger('click');
    await flushPromises();
    expect(empty.wrapper.text()).toContain('当前没有案件。');
    expect(
      empty.wrapper.find('[data-test="client-case-pagination"]').exists(),
    ).toBe(false);
    api.listClientCases.mockImplementation(async (page: number) =>
      paginatedList(page, 20),
    );
    const { wrapper } = await mountPage('/client/cases?page=2');
    expect(wrapper.text()).toContain('当前页没有案件，请返回上一页。');
    expect(button(wrapper, '下一页').attributes('disabled')).toBeDefined();
    await button(wrapper, '上一页').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-001');
    expect(wrapper.findAll('.notary-offices-list li')).toHaveLength(20);
  });
  it('clears the old page while loading and discards a late successful page response', async () => {
    const late = deferred<typeof list>();
    const latest = deferred<typeof list>();
    api.listClientCases
      .mockResolvedValueOnce(paginatedList(1))
      .mockReturnValueOnce(late.promise)
      .mockReturnValueOnce(latest.promise);
    const { wrapper, router } = await mountPage('/client/cases');
    await button(wrapper, '下一页').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('正在读取案件');
    expect(wrapper.text()).not.toContain('CA-001');
    expect(wrapper.find('[data-test="client-case-pagination"]').exists()).toBe(
      false,
    );
    await router.push('/client/cases?view=RECORDED');
    await flushPromises();
    latest.resolve({
      ...list,
      items: [{ ...list.items[0], businessNo: 'RECORDED-001' }],
    });
    await flushPromises();
    late.resolve(paginatedList(2));
    await flushPromises();
    expect(wrapper.text()).toContain('RECORDED-001');
    expect(wrapper.text()).not.toContain('CA-021');
    expect(api.listClientCases.mock.calls[1]?.[3].signal.aborted).toBe(true);
  });
  it('does not let a late failure overwrite the current page', async () => {
    const late = deferred<typeof list>();
    api.listClientCases
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(paginatedList(2));
    const { wrapper, router } = await mountPage('/client/cases');
    await router.push('/client/cases?page=2');
    await flushPromises();
    late.reject(new ApiError('forbidden', 403, 'FORBIDDEN'));
    await flushPromises();
    expect(wrapper.text()).toContain('CA-021');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it.each([401, 403, 500])(
    'clears old cases and pagination on HTTP %s and can retry the same page',
    async (status) => {
      api.listClientCases
        .mockResolvedValueOnce(paginatedList(2))
        .mockRejectedValueOnce(new ApiError('failed', status, 'FAILED'))
        .mockResolvedValueOnce(paginatedList(2));
      const { wrapper, router } = await mountPage('/client/cases?page=2');
      await button(wrapper, '刷新').trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain(
        status === 403
          ? '当前账号无权读取案件。'
          : '案件列表暂时无法加载，请重试。',
      );
      expect(wrapper.text()).not.toContain('CA-021');
      expect(wrapper.find('[data-test="client-case-list"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="client-case-pagination"]').exists(),
      ).toBe(false);
      await button(wrapper, '重新加载').trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query.page).toBe('2');
      expect(wrapper.text()).toContain('CA-021');
      expect(api.listClientCases.mock.calls.at(-1)?.slice(0, 3)).toEqual([
        2,
        20,
        'PENDING',
      ]);
    },
  );
  it('clears an old identity projection after revocation and ignores its late refresh', async () => {
    const late = deferred<typeof list>();
    api.listClientCases
      .mockResolvedValueOnce(paginatedList(2))
      .mockReturnValueOnce(late.promise)
      .mockRejectedValueOnce(new ApiError('forbidden', 403, 'FORBIDDEN'));
    const { wrapper } = await mountPage('/client/cases?page=2');
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    useAuthStore(pinia).session = {
      principalType: 'CLIENT',
      authorizationRevision: 2,
      user: { id: 'client-1' },
    } as never;
    await flushPromises();
    late.resolve(paginatedList(2));
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-021');
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '当前账号无权读取案件。',
    );
    expect(api.listClientCases).toHaveBeenCalledTimes(3);
  });
  it('does not retain a different client or logged-out projection', async () => {
    const late = deferred<typeof list>();
    api.listClientCases
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({
        ...list,
        items: [{ ...list.items[0], businessNo: 'OTHER-CLIENT' }],
      });
    const { wrapper } = await mountPage('/client/cases');
    const auth = useAuthStore(pinia);
    auth.session = {
      principalType: 'CLIENT',
      authorizationRevision: 1,
      user: { id: 'client-2' },
    } as never;
    await flushPromises();
    late.resolve(list);
    await flushPromises();
    expect(wrapper.text()).toContain('OTHER-CLIENT');
    expect(wrapper.text()).not.toContain('CA-001');
    api.listClientCases.mockRejectedValueOnce(
      new ApiError('unauthorized', 401, 'UNAUTHORIZED'),
    );
    auth.clear();
    await flushPromises();
    expect(wrapper.text()).not.toContain('OTHER-CLIENT');
    expect(wrapper.find('[data-test="client-case-list"]').exists()).toBe(false);
  });
  it('keeps internal amounts, audit and contact fields out of every list page', async () => {
    api.listClientCases.mockResolvedValueOnce({
      ...paginatedList(2),
      items: [
        {
          ...paginatedList(2).items[0],
          confirmedAmount: '987654.32',
          internalFee: '876543.21',
          audit: 'INTERNAL-AUDIT',
          lawyerPhone: 'INTERNAL-PHONE',
          storageKey: 'PRIVATE-KEY',
        },
      ],
    });
    const { wrapper } = await mountPage('/client/cases?page=2');
    expect(wrapper.text()).toContain('权利人甲');
    expect(wrapper.text()).toContain('被告甲');
    for (const hidden of [
      '987654.32',
      '876543.21',
      'INTERNAL-AUDIT',
      'INTERNAL-PHONE',
      'PRIVATE-KEY',
    ]) {
      expect(wrapper.text()).not.toContain(hidden);
    }
  });
  it('shows the new stage label while keeping internal filing facts out of the client page', async () => {
    api.listClientCases.mockResolvedValueOnce({
      ...list,
      items: [{ ...list.items[0], stage: 'WAITING_FORMAL_ACCEPTANCE' }],
    });
    const listPage = await mountPage('/client/cases');
    expect(listPage.wrapper.text()).toContain('待正式立案');

    api.getClientCase.mockResolvedValueOnce({
      ...detail,
      stage: 'WAITING_FORMAL_ACCEPTANCE',
    });
    const detailPage = await mountPage('/client/cases/case-1');
    expect(detailPage.wrapper.text()).toContain('待正式立案');
    expect(detailPage.wrapper.text()).not.toContain('提交立案记录');
    expect(detailPage.wrapper.text()).not.toContain('甲市中级人民法院');
  });
  it('shows WAITING_HEARING in the existing client projection only', async () => {
    api.listClientCases.mockResolvedValueOnce({
      ...list,
      items: [{ ...list.items[0], stage: 'WAITING_HEARING' }],
    });
    const listPage = await mountPage('/client/cases');
    expect(listPage.wrapper.text()).toContain('待开庭');
    api.getClientCase.mockResolvedValueOnce({
      ...detail,
      stage: 'WAITING_HEARING',
    });
    const detailPage = await mountPage('/client/cases/case-1');
    expect(detailPage.wrapper.text()).toContain('待开庭');
    expect(detailPage.wrapper.text()).not.toContain('正式立案登记');
    expect(detailPage.wrapper.text()).not.toContain('法院案号');
  });
  it('shows execution confirmation as a client stage without internal execution facts', async () => {
    api.listClientCases.mockResolvedValueOnce({
      ...list,
      items: [{ ...list.items[0], stage: 'WAITING_EXECUTION_CONFIRMATION' }],
    });
    const listPage = await mountPage('/client/cases');
    expect(listPage.wrapper.text()).toContain('执行材料待确认');

    api.getClientCase.mockResolvedValueOnce({
      ...detail,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
    });
    const detailPage = await mountPage('/client/cases/case-1');
    expect(detailPage.wrapper.text()).toContain('执行材料待确认');
    expect(detailPage.wrapper.text()).not.toContain('执行提交');
    expect(detailPage.wrapper.text()).not.toContain('执行申请书');
  });
  it('ignores a late detail response after changing cases and reloads after an authorization revision change', async () => {
    let finish!: (value: typeof detail) => void;
    api.getClientCase.mockImplementation((id: string) =>
      id === 'case-1'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ...detail, id: 'case-2', businessNo: 'CA-002' }),
    );
    const { wrapper, router } = await mountPage('/client/cases/case-1');
    await router.push('/client/cases/case-2');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-002');
    finish(detail);
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-001');
    const auth = useAuthStore(pinia);
    auth.session = {
      principalType: 'CLIENT',
      authorizationRevision: 2,
      user: { id: 'client-2' },
    } as never;
    await flushPromises();
    expect(api.getClientCase).toHaveBeenCalledTimes(3);
  });
});

it('shows only WAITING_ARCHIVE in the client recorded list and detail, without an internal finish form or inferred financial completion', async () => {
  const archived = {
    ...list.items[0],
    stage: 'WAITING_ARCHIVE',
    canMailComplaint: false,
    canMailExecution: false,
  };
  api.listClientCases.mockResolvedValue({ ...list, items: [archived] });
  api.getClientCase.mockResolvedValue({
    ...detail,
    ...archived,
    confirmedAmountState: 'PENDING',
    confirmedAmount: null,
    executionConfirmationId: null,
    executionMailing: null,
  });
  const { wrapper, router } = await mountPage('/client/cases?view=RECORDED');
  expect(wrapper.text()).toContain('待归档');
  await router.push('/client/cases/case-1');
  await flushPromises();
  expect(wrapper.text()).toContain('待归档');
  expect(wrapper.text()).toContain('确认标的额：待确认');
  expect(wrapper.find('[data-test="execution-finish-panel"]').exists()).toBe(
    false,
  );
  for (const forbidden of [
    '结束原因',
    '依据说明',
    '执行结束',
    '已结清',
    '已结算',
    '操作者',
  ])
    expect(wrapper.text()).not.toContain(forbidden);
});
