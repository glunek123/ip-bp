import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import NotaryMatterListPage from './NotaryMatterListPage.vue';

const api = vi.hoisted(() => ({ listNotaryMatters: vi.fn() }));
const preferenceApi = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../api/notary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/notary')>()),
  listNotaryMatters: api.listNotaryMatters,
}));
vi.mock('../../api/notary-list-preference', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../api/notary-list-preference')
  >()),
  getNotaryListPreference: preferenceApi.get,
  saveNotaryListPreference: preferenceApi.save,
}));

const result = {
  items: [
    {
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'PENDING_EVIDENCE',
      createdAt: '2026-09-24T01:00:00.000Z',
      sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
      notaryOffice: { id: 'office-1', name: '测试公证处' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  counts: {
    PENDING_EVIDENCE: 1,
    WAITING_UNBOX: 0,
    UNBOX_REVIEW: 0,
    ISSUANCE_DECISION: 0,
    ARCHIVED: 0,
  },
};

async function mountPage(path: string) {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'user-1', displayName: '运营', username: 'operator' },
    department: { id: 'department-1', name: '知产部' },
    departments: [{ id: 'department-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00.000Z',
    csrfToken: 'csrf-token',
  };
  auth.restored = true;
  preferenceApi.get.mockResolvedValue({
    order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'createdAt'],
    hidden: [],
  });
  preferenceApi.save.mockImplementation((preference) =>
    Promise.resolve(preference),
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-matters', component: NotaryMatterListPage },
      { path: '/notary-matters/:id', component: { template: '<div />' } },
      { path: '/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(NotaryMatterListPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrapper, router, auth };
}

afterEach(() => vi.resetAllMocks());

describe('NotaryMatterListPage', () => {
  it('keeps the transfer hint when no stage is selected', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, items: [], total: 0 });
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.text()).toContain('当前没有公证事项');
    expect(wrapper.text()).toContain('线索确认取证并移交后');
  });

  it('explains the selected empty stage without repeating the transfer hint', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, items: [], total: 0 });
    const { wrapper } = await mountPage('/notary-matters?stage=WAITING_RETURN');
    expect(wrapper.text()).toContain('「待退货」暂无记录');
    expect(wrapper.text()).toContain('可在侧栏切换其他阶段');
    expect(wrapper.text()).not.toContain('线索确认取证并移交后');
  });

  it('uses the sidebar stage filter without repeating it above the list', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );

    expect(wrapper.find('nav[aria-label="公证阶段筛选"]').exists()).toBe(false);
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'PENDING_EVIDENCE',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('待取证');
  });

  it('shows each matter separately and preserves its source lead link', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'PENDING_EVIDENCE',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('NT-001');
    expect(wrapper.get('[data-test="matter-link"]').attributes('href')).toBe(
      '/notary-matters/matter-1',
    );
    expect(
      wrapper.get('[data-test="source-lead-link"]').attributes('href'),
    ).toBe('/leads/lead-1');
  });

  it('does not disguise a failed query as an empty list', async () => {
    api.listNotaryMatters
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result);
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.text()).toContain('公证事项列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="matter-row"]')).toHaveLength(1);
  });

  it('keeps the stage filter while paging through matters', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, total: 21, page: 1 });
    const { wrapper, router } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      stage: 'PENDING_EVIDENCE',
      page: '2',
    });
    expect(api.listNotaryMatters).toHaveBeenLastCalledWith(
      2,
      20,
      expect.any(Object),
      'PENDING_EVIDENCE',
    );
  });

  it('filters and labels the newly added archived stage', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], stage: 'ARCHIVED' }],
      counts: { ...result.counts, ARCHIVED: 1 },
    });
    const { wrapper } = await mountPage('/notary-matters?stage=ARCHIVED');
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'ARCHIVED',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('已归档');
  });

  it('opens the personal column settings while keeping the two fixed columns visible', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage('/notary-matters');

    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    expect(wrapper.text()).toContain('始终显示');
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '公证事项编号',
      '阶段',
      '来源线索',
      '公证处',
      '创建时间',
    ]);
    expect(wrapper.findAll('[data-test="column-option"]')).toHaveLength(3);
  });

  it('applies a reordered and hidden column only after saving', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="sourceLead"]').setValue(false);
    await wrapper.get('[aria-label="上移公证处"]').trigger('click');

    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '公证事项编号',
      '阶段',
      '来源线索',
      '公证处',
      '创建时间',
    ]);
    await wrapper.get('[data-test="save-columns"]').trigger('click');
    await flushPromises();

    expect(preferenceApi.save).toHaveBeenCalledWith(
      {
        order: [
          'businessNo',
          'stage',
          'notaryOffice',
          'sourceLead',
          'createdAt',
        ],
        hidden: ['sourceLead'],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '公证事项编号',
      '阶段',
      '公证处',
      '创建时间',
    ]);
  });

  it('cancels a draft without making a preference request', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="createdAt"]').setValue(false);
    await wrapper.get('[data-test="cancel-columns"]').trigger('click');

    expect(preferenceApi.save).not.toHaveBeenCalled();
    expect(wrapper.findAll('thead th')).toHaveLength(5);
  });

  it('keeps the saved columns and draft after a save failure', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.save.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="createdAt"]').setValue(false);
    await wrapper.get('[data-test="save-columns"]').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('thead th')).toHaveLength(5);
    expect(wrapper.get('[data-column-key="createdAt"]').element).toMatchObject({
      checked: false,
    });
    expect(
      wrapper.get('[data-test="column-preference-status"]').text(),
    ).toContain('草稿仍保留');
  });

  it('persists restore-defaults through the preference API', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.get.mockResolvedValue({
      order: ['businessNo', 'stage', 'createdAt', 'notaryOffice', 'sourceLead'],
      hidden: ['sourceLead'],
    });
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-test="reset-columns"]').trigger('click');
    await flushPromises();

    expect(preferenceApi.save).toHaveBeenCalledWith(
      {
        order: [
          'businessNo',
          'stage',
          'sourceLead',
          'notaryOffice',
          'createdAt',
        ],
        hidden: [],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '公证事项编号',
      '阶段',
      '来源线索',
      '公证处',
      '创建时间',
    ]);
  });

  it('keeps the default list usable and locks editing when preference loading fails', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.get.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage('/notary-matters');

    expect(wrapper.findAll('[data-test="matter-row"]')).toHaveLength(1);
    expect(wrapper.findAll('thead th')).toHaveLength(5);
    expect(
      wrapper
        .get('[data-test="column-settings-toggle"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="column-preference-status"]').text(),
    ).toContain('读取失败');

    preferenceApi.get.mockResolvedValueOnce({
      order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'createdAt'],
      hidden: [],
    });
    await wrapper.get('[data-test="retry-preference"]').trigger('click');
    await flushPromises();
    expect(
      wrapper
        .get('[data-test="column-settings-toggle"]')
        .attributes('disabled'),
    ).toBeUndefined();
  });

  it('ignores a delayed preference response from the previous account', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    let resolveFirst: ((value: unknown) => void) | undefined;
    preferenceApi.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        order: [
          'businessNo',
          'stage',
          'createdAt',
          'notaryOffice',
          'sourceLead',
        ],
        hidden: ['sourceLead'],
      });
    const { wrapper, auth } = await mountPage('/notary-matters');
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
    };
    await flushPromises();
    resolveFirst?.({
      order: ['businessNo', 'stage', 'sourceLead', 'createdAt', 'notaryOffice'],
      hidden: ['notaryOffice'],
    });
    await flushPromises();

    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '公证事项编号',
      '阶段',
      '创建时间',
      '公证处',
    ]);
    expect(api.listNotaryMatters).toHaveBeenCalledTimes(2);
  });

  it('aborts and ignores a save response after the signed-in account changes', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper, auth } = await mountPage('/notary-matters');
    let resolveSave: ((value: unknown) => void) | undefined;
    preferenceApi.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    preferenceApi.get.mockResolvedValueOnce({
      order: ['businessNo', 'stage', 'createdAt', 'sourceLead', 'notaryOffice'],
      hidden: ['sourceLead'],
    });

    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="createdAt"]').setValue(false);
    await wrapper.get('[data-test="save-columns"]').trigger('click');
    await flushPromises();
    const saveOptions = preferenceApi.save.mock.calls[0]?.[1] as
      { signal: AbortSignal } | undefined;

    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
    };
    await flushPromises();
    resolveSave?.({
      order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'createdAt'],
      hidden: ['createdAt'],
    });
    await flushPromises();

    expect(saveOptions?.signal.aborted).toBe(true);
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '公证事项编号',
      '阶段',
      '创建时间',
      '公证处',
    ]);
    expect(
      wrapper.get('[data-test="column-preference-status"]').text(),
    ).toContain('个人列设置已加载');
  });
});
