import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
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
const profile = {
  profileId: 'profile-old',
  fullName: '律师乙',
  lawFirm: '乙律所',
  phone: null,
  caseBusinessNos: ['CA-44'],
  historicalAssignmentCount: 2,
};
function mountPage() {
  return mount(LawyerAccountsPage);
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
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('历史案件关联');
    expect(wrapper.text()).toContain('CA-44');
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
    const wrapper = mountPage();
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
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('没有管理律师账号的权限');
    expect(wrapper.find('h2.form-section-title').exists()).toBe(false);
  });
});
