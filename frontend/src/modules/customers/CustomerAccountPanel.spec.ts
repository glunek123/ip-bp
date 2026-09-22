import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerAccountPanel from './CustomerAccountPanel.vue';

const api = vi.hoisted(() => ({
  listClientAccounts: vi.fn(),
  createClientAccount: vi.fn(),
  setClientAccountStatus: vi.fn(),
}));
vi.mock('../../api/client-accounts', () => api);

beforeEach(() => {
  vi.resetAllMocks();
  api.listClientAccounts.mockResolvedValue([]);
});

describe('CustomerAccountPanel', () => {
  it('explains account requirements and confirms immediate revocation', async () => {
    const activeAccount = {
      id: 'user-1',
      displayName: '客户审核人',
      username: 'client.a',
      accountActive: true,
      bindingActive: true,
      bindingVersion: 1,
    };
    api.listClientAccounts.mockResolvedValue([activeAccount]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = mount(CustomerAccountPanel, {
      props: { customerId: 'customer-1', admitted: true },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('用户名至少 3 个字符');
    expect(wrapper.text()).toContain('初始密码至少 12 个字符');
    expect(wrapper.text()).toContain('客户侧使用人姓名');
    expect(wrapper.text()).not.toContain('Client access');

    await wrapper.get('[data-test="toggle-client-user-1"]').trigger('click');

    expect(api.setClientAccountStatus).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('现有登录会立即失效'),
    );
  });

  it('creates and reloads a real enterprise-bound credential', async () => {
    api.createClientAccount.mockResolvedValue({ id: 'user-1' });
    api.listClientAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'user-1',
        displayName: '客户审核人',
        username: 'client.a',
        accountActive: true,
        bindingActive: true,
        bindingVersion: 1,
      },
    ]);
    const wrapper = mount(CustomerAccountPanel, {
      props: { customerId: 'customer-1', admitted: true },
    });
    await flushPromises();

    await wrapper.get('input[name="clientDisplayName"]').setValue('客户审核人');
    await wrapper.get('input[name="clientUsername"]').setValue('client.a');
    await wrapper
      .get('input[name="clientPassword"]')
      .setValue('correct horse battery staple');
    await wrapper.get('[data-test="create-client-account"]').trigger('click');
    await flushPromises();

    expect(api.createClientAccount).toHaveBeenCalledWith('customer-1', {
      displayName: '客户审核人',
      username: 'client.a',
      password: 'correct horse battery staple',
    });
    expect(wrapper.text()).toContain('client.a');
    expect(wrapper.text()).toContain('账号已创建并绑定');
  });

  it('does not offer creation for a customer that is not admitted', async () => {
    const wrapper = mount(CustomerAccountPanel, {
      props: { customerId: 'customer-1', admitted: false },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('客户准入后才可创建客户账号');
    expect(wrapper.find('[data-test="create-client-account"]').exists()).toBe(
      false,
    );
  });
});
