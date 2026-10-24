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

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

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
  it('keeps an embedded draft when close confirmation is declined', async () => {
    const { wrapper } = await mountPage();
    await wrapper.setProps({ embedded: true });
    await wrapper.get('input[name="name"]').setValue('客户甲');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await wrapper.get('[data-test="customer-new-cancel"]').trigger('click');
    expect(confirm).toHaveBeenCalledOnce();
    expect(wrapper.get('input[name="name"]').element).toHaveProperty(
      'value',
      '客户甲',
    );
    expect(wrapper.emitted('closeRequested')).toBeUndefined();
    wrapper.unmount();
  });

  it('emits close from the embedded cancel button when the form is clean', async () => {
    const { wrapper } = await mountPage();
    await wrapper.setProps({ embedded: true });
    const confirm = vi.spyOn(window, 'confirm');
    await wrapper.get('[data-test="customer-new-cancel"]').trigger('click');
    expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.emitted('closeRequested')).toHaveLength(1);
    wrapper.unmount();
  });

  it('emits an embedded save result without navigating away from the list', async () => {
    api.createCustomerDraft.mockResolvedValue({ id: 'customer-1' });
    const { wrapper, router } = await mountPage();
    await wrapper.setProps({ embedded: true });
    await wrapper.get('input[name="name"]').setValue('客户甲');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('saved')).toEqual([['customer-1']]);
    expect(router.currentRoute.value.fullPath).toBe('/customers/new');
    wrapper.unmount();
  });

  it('blocks drawer closure while creation is pending and emits the eventual save', async () => {
    let resolveCreate!: (value: { id: string }) => void;
    api.createCustomerDraft.mockReturnValue(
      new Promise((resolve) => (resolveCreate = resolve)),
    );
    const { wrapper } = await mountPage();
    await wrapper.setProps({ embedded: true });
    await wrapper.get('input[name="name"]').setValue('客户甲');
    await wrapper.get('form').trigger('submit');
    expect(
      wrapper.get('[data-test="customer-new-cancel"]').attributes('disabled'),
    ).toBeDefined();
    let closeDoneCalled = false;
    (
      wrapper.vm as unknown as {
        requestClose: (done: () => void) => void;
      }
    ).requestClose(() => {
      closeDoneCalled = true;
    });
    expect(closeDoneCalled).toBe(false);
    expect(wrapper.emitted('closeRequested')).toBeUndefined();
    resolveCreate({ id: 'customer-1' });
    await flushPromises();
    expect(wrapper.emitted('saved')).toEqual([['customer-1']]);
    wrapper.unmount();
  });

  it('creates an independently entered manager and rejects overlong names', async () => {
    api.createCustomerDraft.mockResolvedValue({ id: 'customer-1' });
    const { wrapper } = await mountPage();
    await wrapper.get('input[name="name"]').setValue('客户甲');
    await wrapper
      .get('input[name="customerManagerName"]')
      .setValue('长'.repeat(101));
    await wrapper.get('form').trigger('submit');
    expect(api.createCustomerDraft).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('客户经理最多100字');
    await wrapper.get('input[name="customerManagerName"]').setValue(' 经理乙 ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerDraft).toHaveBeenCalledWith({
      name: '客户甲',
      customerManagerName: '经理乙',
    });
    wrapper.unmount();
  });
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
