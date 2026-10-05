import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import LawyerAccountsPage from './LawyerAccountsPage.vue';

const api = vi.hoisted(() => ({
  bindLawyerProfile: vi.fn(),
  createLawyerAccount: vi.fn(),
  listLawyerAccounts: vi.fn(),
  listUnboundLawyerProfiles: vi.fn(),
  resetLawyerPassword: vi.fn(),
  setLawyerAccountStatus: vi.fn(),
  setLawyerBindingStatus: vi.fn(),
}));
vi.mock('../../api/lawyer-accounts', () => api);

const account = {
  id: 'account-1',
  displayName: '律师甲',
  username: 'lawyer.a',
  active: true,
  authorizationRevision: 3,
  profiles: [
    {
      bindingId: 'binding-1',
      bindingActive: true,
      bindingVersion: 2,
      profileId: 'profile-1',
      fullName: '律师甲',
      lawFirm: '甲律所',
      phone: null,
    },
  ],
};
const secondAccount = {
  ...account,
  id: 'account-2',
  displayName: '律师乙',
  username: 'lawyer.b',
};
const profile = {
  profileId: 'profile-old',
  fullName: '律师乙',
  lawFirm: '乙律所',
  phone: '13900000000',
  caseBusinessNos: ['CA-44'],
  historicalAssignmentCount: 2,
};
function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'admin-1', displayName: '管理员甲', username: 'admin.a' },
    department: { id: 'dept-1', name: '知识产权部' },
    departments: [],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2026-10-06T00:00:00Z',
    csrfToken: 'csrf',
  };
  const wrapper = mount(LawyerAccountsPage, {
    global: { plugins: [pinia] },
  });
  return { wrapper, auth };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listLawyerAccounts.mockResolvedValue({
    items: [account],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  api.listUnboundLawyerProfiles.mockResolvedValue([profile]);
});
afterEach(() => vi.restoreAllMocks());

describe('LawyerAccountsPage', () => {
  it('explains account and binding effects and creates an account without echoing its password', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('历史案件关联');
    expect(wrapper.text()).toContain('CA-44');
    expect(wrapper.text()).toContain('13900000000');
    await wrapper.get('input').setValue('律师丙');
    await wrapper.findAll('input').at(1)!.setValue('lawyer.c');
    await wrapper
      .findAll('input')
      .at(2)!
      .setValue('correct horse battery staple');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '创建并绑定新档案')!
      .trigger('click');
    await flushPromises();
    expect(api.createLawyerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: '律师丙',
        username: 'lawyer.c',
        password: 'correct horse battery staple',
      }),
    );
    expect(wrapper.text()).not.toContain('correct horse battery staple');
    expect(wrapper.text()).toContain('账号已创建');
  });

  it('uses server revision and version values for account and binding changes', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    const buttons = wrapper.findAll('button');
    const stopAccount = buttons.find((button) => button.text() === '停用账号');
    expect(stopAccount).toBeDefined();
    await stopAccount!.trigger('click');
    await flushPromises();
    expect(api.setLawyerAccountStatus).toHaveBeenCalledWith(
      'account-1',
      false,
      3,
    );

    const stopBinding = wrapper
      .findAll('button')
      .find((button) => button.text() === '停用绑定');
    await stopBinding!.trigger('click');
    await flushPromises();
    expect(api.setLawyerBindingStatus).toHaveBeenCalledWith(
      'account-1',
      'binding-1',
      false,
      2,
    );
  });

  it('shows the stable permission error instead of account controls', async () => {
    api.listLawyerAccounts.mockRejectedValue(
      new ApiError('Forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const { wrapper } = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('没有管理律师账号的权限');
    expect(wrapper.find('h2.form-section-title').exists()).toBe(false);
  });

  it('clears the old profile choice immediately and prevents binding after search failure', async () => {
    api.listUnboundLawyerProfiles.mockImplementation((query: string) =>
      query === 'new query'
        ? Promise.reject(new Error('search failed'))
        : Promise.resolve([profile]),
    );
    const { wrapper } = mountPage();
    await flushPromises();

    const labels = wrapper.findAll('label');
    const profileSearch = labels
      .find((label) => label.text().includes('搜索历史档案'))!
      .get('input');
    const profileSelect = labels
      .find((label) => label.text().includes('承办档案'))!
      .get('select');
    const accountSelect = labels
      .find((label) => label.text().includes('律师账号'))!
      .get('select');
    const bindButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '确认绑定')!;

    await accountSelect.setValue('account-1');
    await profileSelect.setValue(profile.profileId);
    await profileSearch.setValue('new query');

    expect(profileSelect.element.value).toBe('');
    expect(bindButton.attributes('disabled')).toBeDefined();
    await flushPromises();
    expect(wrapper.text()).toContain('操作未完成，请检查连接后重试。');
    await bindButton.trigger('click');
    expect(api.bindLawyerProfile).not.toHaveBeenCalled();
  });

  it('keeps the latest query results when an older request returns last', async () => {
    let resolveA!: (value: (typeof profile)[]) => void;
    let resolveB!: (value: (typeof profile)[]) => void;
    const oldProfile = {
      ...profile,
      profileId: 'profile-a',
      fullName: '档案甲',
    };
    const newProfile = {
      ...profile,
      profileId: 'profile-b',
      fullName: '档案乙',
    };
    const requestA = new Promise<(typeof profile)[]>((resolve) => {
      resolveA = resolve;
    });
    const requestB = new Promise<(typeof profile)[]>((resolve) => {
      resolveB = resolve;
    });
    api.listUnboundLawyerProfiles.mockImplementation((query: string) =>
      query === 'A'
        ? requestA
        : query === 'B'
          ? requestB
          : Promise.resolve([profile]),
    );
    const { wrapper } = mountPage();
    await flushPromises();
    const search = wrapper
      .findAll('label')
      .find((label) => label.text().includes('搜索历史档案'))!
      .get('input');

    await search.setValue('A');
    await search.setValue('B');
    resolveB([newProfile]);
    await flushPromises();
    expect(wrapper.text()).toContain('档案乙');
    resolveA([oldProfile]);
    await flushPromises();
    expect(wrapper.text()).toContain('档案乙');
    expect(wrapper.text()).not.toContain('档案甲');
  });

  it('does not apply a pending search after the administrator identity changes', async () => {
    let resolveOld!: (value: (typeof profile)[]) => void;
    const oldProfile = {
      ...profile,
      profileId: 'profile-old-admin',
      fullName: '旧身份档案',
    };
    const newProfile = {
      ...profile,
      profileId: 'profile-new-admin',
      fullName: '新身份档案',
    };
    const oldRequest = new Promise<(typeof profile)[]>((resolve) => {
      resolveOld = resolve;
    });
    let calls = 0;
    api.listUnboundLawyerProfiles.mockImplementation(() => {
      calls += 1;
      return calls === 2 ? oldRequest : Promise.resolve([newProfile]);
    });
    const { wrapper, auth } = mountPage();
    await flushPromises();
    const search = wrapper
      .findAll('label')
      .find((label) => label.text().includes('搜索历史档案'))!
      .get('input');
    await search.setValue('pending');
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'admin-2' },
      authorizationRevision: 2,
    };
    await flushPromises();
    resolveOld([oldProfile]);
    await flushPromises();
    expect(wrapper.text()).toContain('新身份档案');
    expect(wrapper.text()).not.toContain('旧身份档案');
  });

  it('clears the selected profile and rejects a late search after switching target accounts', async () => {
    api.listLawyerAccounts.mockResolvedValue({
      items: [account, secondAccount],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    let resolvePending!: (value: (typeof profile)[]) => void;
    const pendingProfile = {
      ...profile,
      profileId: 'profile-pending',
      fullName: '迟到档案',
    };
    const currentProfile = {
      ...profile,
      profileId: 'profile-current',
      fullName: '当前档案',
    };
    const pending = new Promise<(typeof profile)[]>((resolve) => {
      resolvePending = resolve;
    });
    let pendingCalls = 0;
    api.listUnboundLawyerProfiles.mockImplementation((query: string) => {
      if (query !== 'pending') return Promise.resolve([currentProfile]);
      pendingCalls += 1;
      return pendingCalls === 1 ? pending : Promise.resolve([currentProfile]);
    });
    const { wrapper } = mountPage();
    await flushPromises();
    const labels = wrapper.findAll('label');
    const profileSearch = labels
      .find((label) => label.text().includes('搜索历史档案'))!
      .get('input');
    const profileSelect = labels
      .find((label) => label.text().includes('承办档案'))!
      .get('select');
    const accountSelect = labels
      .find((label) => label.text().includes('律师账号'))!
      .get('select');
    const bindButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '确认绑定')!;

    await accountSelect.setValue('account-1');
    await flushPromises();
    await profileSelect.setValue(currentProfile.profileId);
    expect(bindButton.attributes('disabled')).toBeUndefined();
    await profileSearch.setValue('pending');
    expect(profileSelect.element.value).toBe('');
    await accountSelect.setValue('account-2');
    await flushPromises();
    resolvePending([pendingProfile]);
    await flushPromises();

    expect(wrapper.text()).toContain('当前档案');
    expect(wrapper.text()).not.toContain('迟到档案');
    expect(profileSelect.element.value).toBe('');
    expect(bindButton.attributes('disabled')).toBeDefined();
    await bindButton.trigger('click');
    expect(api.bindLawyerProfile).not.toHaveBeenCalled();
  });

  it('provides a server-backed next page for lawyer accounts', async () => {
    const secondPageAccount = {
      ...account,
      id: 'account-21',
      username: 'lawyer.21',
    };
    api.listLawyerAccounts
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, index) => ({
          ...account,
          id: `account-${index + 1}`,
          username: `lawyer.${index + 1}`,
        })),
        total: 21,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [secondPageAccount],
        total: 21,
        page: 2,
        pageSize: 20,
      });
    const { wrapper } = mountPage();
    await flushPromises();
    const nextPage = wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')!;
    expect(nextPage).toBeDefined();
    await nextPage.trigger('click');
    await flushPromises();
    expect(api.listLawyerAccounts).toHaveBeenLastCalledWith(2, 20, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.text()).toContain('lawyer.21');
  });

  it('resets account pagination and ignores a late response after the department identity changes', async () => {
    let resolveOldPage!: (result: {
      items: (typeof account)[];
      total: number;
      page: number;
      pageSize: number;
    }) => void;
    const oldPageRequest = new Promise<{
      items: (typeof account)[];
      total: number;
      page: number;
      pageSize: number;
    }>((resolve) => {
      resolveOldPage = resolve;
    });
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...account,
      id: `account-${index + 1}`,
      username: `lawyer.${index + 1}`,
    }));
    const lateAccount = {
      ...account,
      id: 'late-account',
      username: 'late.scope',
    };
    const currentAccount = {
      ...account,
      id: 'new-scope-account',
      username: 'new.scope',
    };
    let calls = 0;
    api.listLawyerAccounts.mockImplementation((page: number) => {
      calls += 1;
      if (calls === 1)
        return Promise.resolve({
          items: firstPage,
          total: 21,
          page: 1,
          pageSize: 20,
        });
      if (calls === 2) return oldPageRequest;
      return Promise.resolve({
        items: [currentAccount],
        total: 1,
        page,
        pageSize: 20,
      });
    });
    const { wrapper, auth } = mountPage();
    await flushPromises();
    const next = wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')!;
    await next.trigger('click');
    auth.session = {
      ...auth.session!,
      department: { id: 'dept-2', name: '其他部门' },
      authorizationRevision: 2,
    };
    await flushPromises();
    expect(api.listLawyerAccounts).toHaveBeenLastCalledWith(1, 20, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.text()).toContain('new.scope');
    resolveOldPage({
      items: [lateAccount],
      total: 21,
      page: 2,
      pageSize: 20,
    });
    await flushPromises();
    expect(wrapper.text()).toContain('new.scope');
    expect(wrapper.text()).not.toContain('late.scope');
  });
});
