import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RightsHolderDetailPage from './RightsHolderDetailPage.vue';

const api = vi.hoisted(() => ({ getCustomerRightsHolder: vi.fn() }));
vi.mock('../../api/rights-holders', () => api);
afterEach(() => vi.clearAllMocks());

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
  it('shows loading then the read-only CU03 fields', async () => {
    let resolve!: (value: unknown) => void;
    api.getCustomerRightsHolder.mockReturnValue(
      new Promise((done) => (resolve = done)),
    );
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('正在读取权利主体');
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
      expect(wrapper.text()).toContain('权利主体不存在或当前不可访问');
    },
  );
});
