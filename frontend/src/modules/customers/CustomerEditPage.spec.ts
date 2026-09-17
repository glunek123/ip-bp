import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerEditPage from './CustomerEditPage.vue';

const api = vi.hoisted(() => ({
  getCustomer: vi.fn(),
  updateCustomerDraft: vi.fn(),
  findCustomerDuplicates: vi.fn(),
}));
vi.mock('../../api/customers', () => api);

afterEach(() => vi.resetAllMocks());

const customer = {
  id: 'customer-1',
  name: '客户甲',
  customerType: null,
  identityType: null,
  identityNumber: null,
  issuingCountryOrRegion: null,
  category: null,
  region: null,
  profileStatus: 'draft',
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-17T01:00:00.000Z',
  capabilities: { editRoutine: true },
  history: [],
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/:id/edit', component: CustomerEditPage },
      { path: '/customers/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/customers/customer-1/edit');
  await router.isReady();
  return {
    wrapper: mount(CustomerEditPage, { global: { plugins: [router] } }),
    router,
  };
}

describe('CustomerEditPage', () => {
  it('loads the current draft and saves the full editable snapshot', async () => {
    api.getCustomer.mockResolvedValue(customer);
    api.updateCustomerDraft.mockResolvedValue({
      ...customer,
      name: '客户甲（更新）',
      version: 2,
    });
    const { wrapper, router } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('客户甲（更新）');
    await wrapper.get('input[name="customerType"]').setValue('enterprise');
    await wrapper.get('input[name="identityType"]').setValue('credit-code');
    await wrapper
      .get('input[name="identityNumber"]')
      .setValue('91310000abc123');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenCalledWith('customer-1', {
      expectedVersion: 1,
      name: '客户甲（更新）',
      customerType: 'enterprise',
      identityType: 'credit-code',
      identityNumber: '91310000abc123',
      issuingCountryOrRegion: '',
      category: '',
      region: '',
    });
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
  });

  it('shows one same-name reason field and retains input for retry', async () => {
    api.getCustomer.mockResolvedValue(customer);
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [
        {
          id: 'customer-2',
          name: '同名客户',
          category: '重点',
          region: '上海',
        },
      ],
    });
    api.updateCustomerDraft
      .mockRejectedValueOnce(
        new ApiError(
          '本部门已有同名客户，请说明继续原因',
          409,
          'CUSTOMER_NAME_REASON_REQUIRED',
        ),
      )
      .mockResolvedValueOnce({ ...customer, name: '同名客户', version: 2 });
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('同名客户');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('本部门已有同名客户');
    expect(api.findCustomerDuplicates).toHaveBeenCalledWith({
      name: '同名客户',
      excludeCustomerId: 'customer-1',
    });
    expect(wrapper.text()).toContain('重点 · 上海');
    expect(wrapper.text()).toContain('打开已有客户');
    await wrapper
      .get('textarea[name="duplicateNameReason"]')
      .setValue('不同业务主体，经核对后继续');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenLastCalledWith(
      'customer-1',
      expect.objectContaining({
        name: '同名客户',
        duplicateNameReason: '不同业务主体，经核对后继续',
      }),
    );
  });

  it('shows an actionable identity duplicate error', async () => {
    api.getCustomer.mockResolvedValue(customer);
    api.updateCustomerDraft.mockRejectedValue(
      new ApiError(
        '本部门已有相同证件号码的客户',
        409,
        'CUSTOMER_IDENTITY_DUPLICATE',
      ),
    );
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('本部门已有相同证件号码的客户');
    expect(
      (wrapper.get('input[name="name"]').element as HTMLInputElement).value,
    ).toBe('客户甲');
  });

  it('reloads the latest version, preserves the draft, and retries only after user choice', async () => {
    api.getCustomer
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce({ ...customer, name: '服务端新名称', version: 2 });
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [],
    });
    api.updateCustomerDraft
      .mockRejectedValueOnce(
        new ApiError('客户资料已被他人更新', 409, 'CUSTOMER_VERSION_CONFLICT'),
      )
      .mockResolvedValueOnce({ ...customer, name: '我的草稿', version: 3 });
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('我的草稿');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.getCustomer).toHaveBeenCalledTimes(2);
    expect(api.findCustomerDuplicates).toHaveBeenCalledWith({
      name: '我的草稿',
      identityType: '',
      identityNumber: '',
      excludeCustomerId: 'customer-1',
    });
    expect(wrapper.text()).toContain('已读取最新版本');
    expect(
      (wrapper.get('input[name="name"]').element as HTMLInputElement).value,
    ).toBe('我的草稿');
    expect(api.updateCustomerDraft).toHaveBeenCalledTimes(1);

    await wrapper.get('button[name="retryLatest"]').trigger('click');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenLastCalledWith(
      'customer-1',
      expect.objectContaining({ expectedVersion: 2, name: '我的草稿' }),
    );
  });

  it('can discard the local draft and load the latest version after a conflict', async () => {
    api.getCustomer.mockResolvedValueOnce(customer).mockResolvedValueOnce({
      ...customer,
      name: '服务端新名称',
      category: '最新类别',
      region: '北京',
      version: 2,
    });
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [],
    });
    api.updateCustomerDraft.mockRejectedValueOnce(
      new ApiError('客户资料已被他人更新', 409, 'CUSTOMER_VERSION_CONFLICT'),
    );
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('我的草稿');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    await wrapper.get('button[name="useLatest"]').trigger('click');

    expect(
      (wrapper.get('input[name="name"]').element as HTMLInputElement).value,
    ).toBe('服务端新名称');
    expect(
      (wrapper.get('input[name="category"]').element as HTMLInputElement).value,
    ).toBe('最新类别');
    expect(
      (wrapper.get('input[name="region"]').element as HTMLInputElement).value,
    ).toBe('北京');
    expect(wrapper.find('button[name="useLatest"]').exists()).toBe(false);
    expect(api.updateCustomerDraft).toHaveBeenCalledTimes(1);
  });

  it('does not show an editable form if capability is absent', async () => {
    api.getCustomer.mockResolvedValue({
      ...customer,
      capabilities: { editRoutine: false },
    });
    const { wrapper } = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号没有编辑此客户的权限');
    expect(wrapper.find('form').exists()).toBe(false);
  });
});
