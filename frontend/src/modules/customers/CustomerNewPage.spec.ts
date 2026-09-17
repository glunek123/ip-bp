import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerNewPage from './CustomerNewPage.vue';

const api = vi.hoisted(() => ({ createCustomerDraft: vi.fn() }));
vi.mock('../../api/customers', () => api);

afterEach(() => vi.clearAllMocks());

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
});
