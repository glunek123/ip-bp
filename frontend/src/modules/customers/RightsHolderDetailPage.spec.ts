import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RightsHolderDetailPage from './RightsHolderDetailPage.vue';

const api = vi.hoisted(() => ({ getCustomerRightsHolder: vi.fn() }));
vi.mock('../../api/rights-holders', () => api);
enableAutoUnmount(afterEach);
afterEach(() => vi.resetAllMocks());

function holder(id: string, name: string) {
  return {
    id,
    name,
    credit: null,
    address: null,
    legalRepresentative: null,
    duty: null,
    updatedAt: '2026-09-17T01:00:00.000Z',
  };
}

async function mountRoutedPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/customers/:customerId/rights-holders/:rightsHolderId',
        component: RightsHolderDetailPage,
      },
      { path: '/customers', component: { template: '<div />' } },
      { path: '/customers/:customerId', component: { template: '<div />' } },
    ],
  });
  await router.push('/customers/customer-1/rights-holders/holder-1');
  await router.isReady();
  const wrapper = mount(RouterView, { global: { plugins: [router] } });
  return { router, wrapper };
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/customers/:customerId/rights-holders/:rightsHolderId',
        component: RightsHolderDetailPage,
      },
    ],
  });
  await router.push('/customers/customer-1/rights-holders/holder-1');
  await router.isReady();
  return mount(RightsHolderDetailPage, { global: { plugins: [router] } });
}

describe('RightsHolderDetailPage', () => {
  it.each([
    ['customer-2', 'holder-1'],
    ['customer-1', 'holder-2'],
    ['customer-2', 'holder-2'],
  ])(
    'reloads the reused RouterView when the anchor becomes %s/%s',
    async (customerId, holderId) => {
      let resolve!: (value: unknown) => void;
      api.getCustomerRightsHolder
        .mockResolvedValueOnce(holder('holder-1', '旧锚点主体'))
        .mockReturnValueOnce(new Promise((done) => (resolve = done)));
      const { router, wrapper } = await mountRoutedPage();
      await flushPromises();
      expect(wrapper.text()).toContain('旧锚点主体');
      await router.push(`/customers/${customerId}/rights-holders/${holderId}`);
      await flushPromises();
      expect(api.getCustomerRightsHolder).toHaveBeenLastCalledWith(
        customerId,
        holderId,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(wrapper.text()).toContain('正在读取权利人');
      expect(wrapper.text()).not.toContain('旧锚点主体');
      resolve(holder(holderId, '新锚点主体'));
      await flushPromises();
      expect(wrapper.text()).toContain('新锚点主体');
      wrapper.unmount();
    },
  );

  it('ignores an obsolete response after navigating the real RouterView', async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    api.getCustomerRightsHolder
      .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
      .mockReturnValueOnce(new Promise((done) => (resolveNew = done)));
    const { router, wrapper } = await mountRoutedPage();
    const oldSignal: AbortSignal =
      api.getCustomerRightsHolder.mock.calls[0]![2].signal;
    await router.push('/customers/customer-2/rights-holders/holder-2');
    await flushPromises();
    expect(api.getCustomerRightsHolder).toHaveBeenCalledTimes(2);
    expect(oldSignal.aborted).toBe(true);
    resolveNew(holder('holder-2', '新请求主体'));
    await flushPromises();
    resolveOld(holder('holder-1', '过期请求主体'));
    await flushPromises();
    expect(wrapper.text()).toContain('新请求主体');
    expect(wrapper.text()).not.toContain('过期请求主体');
    wrapper.unmount();
  });

  it('shows a new-anchor 404 and clears it when navigating again', async () => {
    let resolveThird!: (value: unknown) => void;
    api.getCustomerRightsHolder
      .mockResolvedValueOnce(holder('holder-1', '旧锚点主体'))
      .mockRejectedValueOnce({ code: 'CUSTOMER_NOT_FOUND' })
      .mockReturnValueOnce(new Promise((done) => (resolveThird = done)));
    const { router, wrapper } = await mountRoutedPage();
    await flushPromises();
    await router.push('/customers/hidden-customer/rights-holders/holder-1');
    await flushPromises();
    expect(wrapper.text()).toContain('权利人不存在或当前不可访问');
    expect(wrapper.text()).not.toContain('旧锚点主体');
    await router.push('/customers/customer-3/rights-holders/holder-3');
    await flushPromises();
    expect(wrapper.text()).toContain('正在读取权利人');
    expect(wrapper.text()).not.toContain('权利人不存在或当前不可访问');
    resolveThird(holder('holder-3', '第三锚点主体'));
    await flushPromises();
    expect(wrapper.text()).toContain('第三锚点主体');
    wrapper.unmount();
  });
  it('shows loading then the read-only CU03 fields', async () => {
    let resolve!: (value: unknown) => void;
    api.getCustomerRightsHolder.mockReturnValue(
      new Promise((done) => (resolve = done)),
    );
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('正在读取权利人');
    resolve({
      id: 'holder-1',
      name: '主体甲',
      credit: '91310000',
      address: '上海',
      legalRepresentative: '张三',
      duty: '执行董事',
      updatedAt: '2026-09-17T01:00:00.000Z',
    });
    await flushPromises();
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.text()).toContain('91310000');
    expect(wrapper.text()).toContain('执行董事');
    expect(wrapper.text()).not.toMatch(/编辑|删除|解除|默认主体/u);
  });

  it.each(['RIGHTS_HOLDER_NOT_FOUND', 'CUSTOMER_NOT_FOUND'])(
    'shows a non-leaking nested 404 for %s',
    async (code) => {
      api.getCustomerRightsHolder.mockRejectedValue({ code });
      const wrapper = await mountPage();
      await flushPromises();
      expect(wrapper.text()).toContain('权利人不存在或当前不可访问');
    },
  );
});
