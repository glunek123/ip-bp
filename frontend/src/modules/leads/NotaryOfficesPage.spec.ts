import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import NotaryOfficesPage from './NotaryOfficesPage.vue';

const api = vi.hoisted(() => ({
  listNotaryOffices: vi.fn(),
  createNotaryOffice: vi.fn(),
}));
const accountsApi = vi.hoisted(() => ({
  listNotaryOfficeAccounts: vi.fn(),
  createNotaryOfficeAccount: vi.fn(),
  setNotaryOfficeAccountActive: vi.fn(),
}));
vi.mock('../../api/notary', () => api);
vi.mock('../../api/notary-office-accounts', () => accountsApi);

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/notary-offices', component: NotaryOfficesPage }],
  });
  await router.push('/notary-offices');
  await router.isReady();
  const wrapper = mount(NotaryOfficesPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listNotaryOffices.mockResolvedValue({
    items: [
      { id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' },
      { id: 'office-2', name: '深圳市深圳公证处', status: 'ACTIVE' },
    ],
    capabilities: { create: true },
  });
  api.createNotaryOffice.mockResolvedValue({
    id: 'office-3',
    name: '东莞市东莞公证处',
    status: 'ACTIVE',
  });
  accountsApi.listNotaryOfficeAccounts.mockResolvedValue([]);
  accountsApi.createNotaryOfficeAccount.mockResolvedValue({
    id: 'user-1',
    displayName: '办理员',
    username: 'office.user',
    accountActive: true,
    bindingActive: true,
    bindingVersion: 1,
  });
  accountsApi.setNotaryOfficeAccountActive.mockResolvedValue({
    id: 'user-1',
    displayName: '办理员',
    username: 'office.user',
    accountActive: false,
    bindingActive: true,
    bindingVersion: 2,
  });
});

describe('NotaryOfficesPage', () => {
  it('lists current active offices and creates one only when allowed', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('main h1').exists()).toBe(false);
    expect(wrapper.text()).toContain('公证处');
    expect(wrapper.text()).toContain('广州市南方公证处');
    expect(wrapper.text()).toContain('深圳市深圳公证处');
    expect(wrapper.text()).toContain('后续移交线索时可从本部门公证处中选择');
    expect(
      wrapper.get('[data-test="create-notary-office"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.findAll('.required-mark')).toHaveLength(1);

    await wrapper
      .get('[data-test="new-notary-office-name"]')
      .setValue(' 东莞市东莞公证处 ');
    await wrapper.get('[data-test="create-notary-office"]').trigger('click');
    await flushPromises();

    expect(api.createNotaryOffice).toHaveBeenCalledWith('东莞市东莞公证处');
    expect(wrapper.text()).toContain('公证处已新增');
    expect(wrapper.text()).toContain('东莞市东莞公证处');
  });

  it('shows offices without a create form when create capability is absent', async () => {
    api.listNotaryOffices.mockResolvedValueOnce({
      items: [{ id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' }],
      capabilities: { create: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('广州市南方公证处');
    expect(wrapper.text()).toContain('如需新增公证处，请联系部门管理员');
    expect(
      wrapper.find('[data-test="notary-office-create-form"]').exists(),
    ).toBe(false);
  });

  it('renders clear forbidden and recoverable failure states', async () => {
    api.listNotaryOffices.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const forbidden = await mountPage();
    expect(forbidden.text()).toContain('当前账号无权查看公证处');

    api.listNotaryOffices.mockRejectedValueOnce(new Error('offline'));
    const failed = await mountPage();
    expect(failed.text()).toContain('公证处列表暂时无法加载');
    await failed.get('[data-test="refresh-notary-offices"]').trigger('click');
    await flushPromises();
    expect(api.listNotaryOffices).toHaveBeenCalledTimes(3);
  });

  it('explains duplicate and denied office creation errors', async () => {
    api.createNotaryOffice.mockRejectedValueOnce(
      new ApiError('duplicate', 409, 'OFFICE_EXISTS'),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="new-notary-office-name"]')
      .setValue('已存在公证处');
    await wrapper.get('[data-test="create-notary-office"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('该公证处已存在，请检查名称或联系管理员');
  });

  it('creates a bound account and lets administrators disable it', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-test="select-office-office-1"]').setValue();
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="notary-account-display-name"]')
      .setValue('办理员');
    await wrapper
      .get('[data-test="notary-account-username"]')
      .setValue('office.user');
    await wrapper
      .get('[data-test="notary-account-password"]')
      .setValue('correct horse battery staple');
    await wrapper
      .get('[data-test="notary-office-account-create"]')
      .trigger('submit');
    await flushPromises();
    expect(accountsApi.createNotaryOfficeAccount).toHaveBeenCalledWith(
      'office-1',
      {
        displayName: '办理员',
        username: 'office.user',
        password: 'correct horse battery staple',
      },
    );
    expect(wrapper.text()).toContain('公证处账号已创建');
    await wrapper.get('[data-test="select-notary-account-user-1"]').setValue();
    await wrapper
      .get('[data-test="toggle-selected-notary-account"]')
      .trigger('click');
    await flushPromises();
    expect(accountsApi.setNotaryOfficeAccountActive).toHaveBeenCalledWith(
      'office-1',
      'user-1',
      false,
    );
    expect(wrapper.text()).toContain('账号已停用');
  });

  it('keeps account actions bound to the selected office and account', async () => {
    accountsApi.listNotaryOfficeAccounts.mockImplementation(
      async (officeId: string) => [
        {
          id: `user-${officeId}`,
          displayName: officeId,
          username: officeId,
          accountActive: true,
          bindingActive: true,
          bindingVersion: 1,
        },
      ],
    );
    const wrapper = await mountPage();
    expect(
      wrapper
        .get('[data-test="manage-selected-office-accounts"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="select-office-office-1"]').setValue();
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper
        .get('[data-test="toggle-selected-notary-account"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .get('[data-test="select-notary-account-user-office-1"]')
      .setValue();
    await wrapper.get('[data-test="select-office-office-2"]').setValue();
    expect(wrapper.find('[data-test="notary-office-accounts"]').exists()).toBe(
      false,
    );
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('深圳市深圳公证处 · 公证处账号');
    expect(
      wrapper
        .find('[data-test="select-notary-account-user-office-1"]')
        .exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('[data-test="toggle-selected-notary-account"]')
        .attributes('disabled'),
    ).toBeDefined();
  });

  it('ignores a late account response after selecting another office', async () => {
    let finishFirst!: (accounts: unknown[]) => void;
    accountsApi.listNotaryOfficeAccounts.mockImplementation(
      (officeId: string) =>
        officeId === 'office-1'
          ? new Promise((resolve) => {
              finishFirst = resolve;
            })
          : Promise.resolve([]),
    );
    const wrapper = await mountPage();
    await wrapper.get('[data-test="select-office-office-1"]').setValue();
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await wrapper.get('[data-test="select-office-office-2"]').setValue();
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await flushPromises();
    finishFirst([
      {
        id: 'stale',
        displayName: '旧账号',
        username: 'stale',
        accountActive: true,
        bindingActive: true,
        bindingVersion: 1,
      },
    ]);
    await flushPromises();
    expect(wrapper.text()).not.toContain('旧账号');
    expect(wrapper.text()).toContain('深圳市深圳公证处 · 公证处账号');
  });

  it('denies account actions when the account list is forbidden', async () => {
    accountsApi.listNotaryOfficeAccounts.mockResolvedValueOnce([
      {
        id: 'user-1',
        displayName: '办理员',
        username: 'office.user',
        accountActive: true,
        bindingActive: true,
        bindingVersion: 1,
      },
    ]);
    const wrapper = await mountPage();
    await wrapper.get('[data-test="select-office-office-1"]').setValue();
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await flushPromises();
    accountsApi.listNotaryOfficeAccounts.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    await wrapper
      .get('[data-test="manage-selected-office-accounts"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号没有维护该公证处账号的权限');
    expect(
      wrapper.find('[data-test="select-notary-account-user-1"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('[data-test="toggle-selected-notary-account"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.find('[data-test="notary-office-account-create"]').exists(),
    ).toBe(false);
  });
});
