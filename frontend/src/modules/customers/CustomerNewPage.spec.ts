import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerNewPage from './CustomerNewPage.vue';
import { ApiError } from '../../api/http';

const api = vi.hoisted(() => ({
  createCustomerDraft: vi.fn(),
  findCustomerDuplicates: vi.fn(),
}));
vi.mock('../../api/customers', () => api);

afterEach(() => vi.resetAllMocks());

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/new', component: CustomerNewPage },
      { path: '/customers/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/customers/new');
  await router.isReady();
  return {
    wrapper: mount(CustomerNewPage, { global: { plugins: [router] } }),
    router,
  };
}

describe('CustomerNewPage', () => {
  it('marks the only unconditional field as required', async () => {
    const { wrapper } = await mountPage();

    expect(
      wrapper.get('label[for="customer-name"] .required-mark').text(),
    ).toBe('*必填');
  });

  it('shows a field error for a blank name without calling the API', async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.text()).toContain('请输入客户名称');
    expect(api.createCustomerDraft).not.toHaveBeenCalled();
  });

  it('trims a name-only draft and prevents a duplicate submit', async () => {
    let resolve!: (value: unknown) => void;
    api.createCustomerDraft.mockReturnValue(
      new Promise((done) => (resolve = done)),
    );
    const { wrapper, router } = await mountPage();
    await wrapper.get('input[name="name"]').setValue('  客户甲  ');
    await wrapper.get('form').trigger('submit');
    expect(api.createCustomerDraft).toHaveBeenCalledOnce();
    expect(api.createCustomerDraft).toHaveBeenCalledWith({ name: '客户甲' });
    expect(
      wrapper.get('button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(api.createCustomerDraft).toHaveBeenCalledOnce();
    resolve({ id: 'customer-1' });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
  });

  it('keeps entered text when saving fails', async () => {
    api.createCustomerDraft.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountPage();
    const input = wrapper.get('input[name="name"]');
    await input.setValue('客户甲');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('草稿没有保存成功');
    expect((input.element as HTMLInputElement).value).toBe('客户甲');
  });

  it('saves one phone-only admission contact and keeps it after a failure', async () => {
    api.createCustomerDraft
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'customer-1' });
    const { wrapper } = await mountPage();
    await wrapper.get('input[name="name"]').setValue('客户甲');
    await wrapper.get('input[name="admissionContactName"]').setValue(' 张三 ');
    await wrapper
      .get('input[name="admissionContactPhone"]')
      .setValue(' 13800138000 ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('草稿没有保存成功');
    expect(
      (
        wrapper.get('input[name="admissionContactName"]')
          .element as HTMLInputElement
      ).value,
    ).toBe(' 张三 ');
    expect(api.createCustomerDraft).toHaveBeenLastCalledWith({
      name: '客户甲',
      admissionContactName: '张三',
      admissionContactPhone: '13800138000',
    });
  });

  it('requires a contact method when a contact name is entered', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.text()).not.toContain('准入联系人（可选）');
    expect(
      wrapper
        .find('label[for="admission-contact-name"] .required-mark')
        .exists(),
    ).toBe(false);
    await wrapper.get('input[name="name"]').setValue('客户甲');
    await wrapper.get('input[name="admissionContactName"]').setValue('张三');
    expect(
      wrapper
        .find('label[for="admission-contact-name"] .required-mark')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .get('[data-test="admission-contact-channel-requirement"]')
        .find('.required-mark')
        .exists(),
    ).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.text()).toContain('联系人至少填写电话或邮箱');
    expect(api.createCustomerDraft).not.toHaveBeenCalled();
  });

  it('asks for one reason after a same-name conflict and reuses the form', async () => {
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [
        { id: 'customer-1', name: '客户甲', category: null, region: null },
      ],
    });
    api.createCustomerDraft
      .mockRejectedValueOnce(
        new ApiError(
          '本部门已有同名客户，请说明继续原因',
          409,
          'CUSTOMER_NAME_REASON_REQUIRED',
        ),
      )
      .mockResolvedValueOnce({ id: 'customer-2' });
    const { wrapper, router } = await mountPage();
    await wrapper.get('input[name="name"]').setValue('客户甲');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('本部门已有同名客户');
    expect(api.findCustomerDuplicates).toHaveBeenCalledWith({ name: '客户甲' });
    expect(wrapper.text()).toContain('打开已有客户');
    await wrapper
      .get('textarea[name="duplicateNameReason"]')
      .setValue('不同业务主体，经核对后继续');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerDraft).toHaveBeenLastCalledWith({
      name: '客户甲',
      duplicateNameReason: '不同业务主体，经核对后继续',
    });
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-2');
  });
});
