import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerRightAssetsPanel from './CustomerRightAssetsPanel.vue';

const api = vi.hoisted(() => ({
  listRightAssets: vi.fn(),
  getRightAsset: vi.fn(),
  createRightAsset: vi.fn(),
  reviseRightAsset: vi.fn(),
  withdrawRightAsset: vi.fn(),
}));
const holders = vi.hoisted(() => ({ listCustomerRightsHolders: vi.fn() }));
vi.mock('../../api/right-assets', () => api);
vi.mock('../../api/rights-holders', () => holders);

const holder = { id: 'holder-1', name: '主体甲' };
const fields = {
  id: 'version-1',
  version: 1,
  action: 'CREATE',
  type: 'TRADEMARK',
  name: '测试商标',
  number: null,
  category: '商标权',
  holderId: holder.id,
  ownerText: null,
  trademarkClass: null,
  validFrom: null,
  validTo: null,
  validityMode: 'UNKNOWN',
  withdrawReason: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-08T01:00:00.000Z',
};
const asset = {
  assetId: 'asset-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  withdrawn: false,
  fields,
};
function setup() {
  api.listRightAssets.mockResolvedValue({
    items: [asset],
    total: 1,
    page: 1,
    pageSize: 20,
    capabilities: { create: true },
  });
  api.getRightAsset.mockResolvedValue({
    ...asset,
    history: [fields],
    capabilities: { revise: true, withdraw: true },
  });
  holders.listCustomerRightsHolders.mockResolvedValue({
    items: [holder],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  return mount(CustomerRightAssetsPanel, {
    props: { customerId: 'customer-1', customerVersion: 2, canEdit: true },
  });
}
afterEach(() => vi.resetAllMocks());

describe('CustomerRightAssetsPanel', () => {
  it('shows unknown term without claiming present legal validity and retains history', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('截止日期未知，未核验法律效力');
    expect(wrapper.text()).toContain('历史版本 · 1 条');
  });

  it('keeps the exact command key and body after unknown outcome', async () => {
    const wrapper = setup();
    await flushPromises();
    api.createRightAsset
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...asset, customerVersion: 3 });
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('新商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('请求结果未知');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createRightAsset.mock.calls[1][1]).toEqual(
      api.createRightAsset.mock.calls[0][1],
    );
    expect(api.createRightAsset.mock.calls[1][2]).toBe(
      api.createRightAsset.mock.calls[0][2],
    );
    expect(wrapper.emitted('version-updated')?.[0]).toEqual(['customer-1', 3]);
  });

  it('keeps a conflict draft until the user explicitly refreshes', async () => {
    const wrapper = setup();
    await flushPromises();
    api.createRightAsset.mockRejectedValue(
      new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
    );
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('新商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('input[required]').element).toHaveProperty(
      'value',
      '新商标',
    );
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    expect(wrapper.emitted('refresh-requested')?.[0]).toEqual(['customer-1']);
  });
});
