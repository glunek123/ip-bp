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
const customers = vi.hoisted(() => ({ getCustomer: vi.fn() }));
vi.mock('../../api/right-assets', () => api);
vi.mock('../../api/rights-holders', () => holders);
vi.mock('../../api/customers', () => customers);

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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup(items = [asset]) {
  customers.getCustomer.mockResolvedValue({
    version: 2,
    capabilities: { editRoutine: true },
  });
  api.listRightAssets.mockResolvedValue({
    items,
    total: items.length,
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
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
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

  it('keeps revised fields through a completed 409 refresh and retries only after an explicit submit', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('草稿号码');
    api.reviseRightAsset.mockRejectedValueOnce(
      new ApiError('版本冲突', 409, 'RIGHT_ASSET_VERSION_CONFLICT'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const latest = {
      ...asset,
      version: 2,
      fields: { ...fields, id: 'version-2', version: 2, number: '他人号码' },
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    };
    api.getRightAsset.mockResolvedValueOnce(latest);
    customers.getCustomer.mockResolvedValueOnce({
      version: 4,
      capabilities: { editRoutine: true },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('input[placeholder="未知可留空"]').element,
    ).toHaveProperty('value', '草稿号码');
    expect(wrapper.text()).toContain('他人号码');
    expect(wrapper.text()).toContain('草稿来源');
    expect(api.reviseRightAsset).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.setProps({ customerVersion: 4 });
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeUndefined();
    api.reviseRightAsset.mockResolvedValueOnce({
      ...latest,
      customerVersion: 5,
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[1][2]).toMatchObject({
      number: '草稿号码',
      expectedCustomerVersion: 4,
      expectedAssetVersion: 2,
    });
  });

  it('unlocks a refreshed asset conflict when the authoritative customer version stays the same', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('新号码');
    api.reviseRightAsset.mockRejectedValueOnce(
      new ApiError('资产版本冲突', 409, 'RIGHT_ASSET_VERSION_CONFLICT'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    api.getRightAsset.mockResolvedValueOnce({
      ...asset,
      version: 2,
      fields: { ...fields, version: 2 },
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(customers.getCustomer).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeUndefined();
    api.reviseRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[1][2]).toMatchObject({
      expectedCustomerVersion: 2,
      expectedAssetVersion: 2,
      number: '新号码',
    });
  });

  it('keeps a new create draft when an older detail request resolves late', async () => {
    const wrapper = setup();
    const slow = deferred<unknown>();
    api.getRightAsset.mockReturnValueOnce(slow.promise);
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('新登记草稿');
    slow.resolve({
      ...asset,
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    });
    await flushPromises();
    expect(wrapper.get('input[required]').element).toHaveProperty(
      'value',
      '新登记草稿',
    );
    expect(wrapper.find('.right-assets-panel__detail').exists()).toBe(false);
  });

  it.each([
    new ApiError('服务暂时不可用', 500, 'HTTP_ERROR'),
    new ApiError('数据无效', 200, 'INVALID_RESPONSE'),
  ])(
    'freezes an unknown create request through edits, parent version changes and retry: %s',
    async (failure) => {
      const wrapper = setup();
      await flushPromises();
      api.createRightAsset
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ ...asset, customerVersion: 3 });
      await wrapper.get('.right-assets-panel__header button').trigger('click');
      await wrapper.get('input[required]').setValue('原始商标');
      await wrapper.findAll('input')[2]!.setValue('商标权');
      await wrapper.get('select[required]').setValue(holder.id);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      await wrapper.setProps({ customerVersion: 9 });
      expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
      expect(
        wrapper
          .get('.right-assets-panel__header button')
          .attributes('disabled'),
      ).toBeDefined();
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '取消')!
        .trigger('click');
      expect(wrapper.find('form').exists()).toBe(true);
      expect(
        wrapper
          .findAll('button')
          .some((button) => button.text().includes('原请求重试')),
      ).toBe(true);
      await wrapper
        .findAll('button')
        .find((button) => button.text().includes('原请求重试'))!
        .trigger('click');
      await flushPromises();
      expect(api.createRightAsset.mock.calls[1][1]).toEqual(
        api.createRightAsset.mock.calls[0][1],
      );
      expect(api.createRightAsset.mock.calls[1][2]).toBe(
        api.createRightAsset.mock.calls[0][2],
      );
    },
  );

  it('keeps the latest detail selection when an earlier detail resolves late', async () => {
    const another = {
      ...asset,
      assetId: 'asset-2',
      fields: { ...fields, name: '商标 B' },
    };
    const wrapper = setup([asset, another]);
    const slowA = deferred<unknown>();
    const fastB = deferred<unknown>();
    api.getRightAsset
      .mockReset()
      .mockReturnValueOnce(slowA.promise)
      .mockReturnValueOnce(fastB.promise);
    await flushPromises();
    const buttons = wrapper.findAll('.right-assets-panel__list button');
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    fastB.resolve({
      ...another,
      history: [another.fields],
      capabilities: { revise: true, withdraw: true },
    });
    await flushPromises();
    slowA.resolve({
      ...asset,
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    });
    await flushPromises();
    expect(wrapper.get('.right-assets-panel__detail h3').text()).toContain(
      '商标 B',
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    api.reviseRightAsset.mockResolvedValueOnce({
      ...another,
      customerVersion: 3,
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[0][1]).toBe('asset-2');
  });

  it('retries an unknown revision with its frozen body after the parent version changes', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('原始修订号');
    api.reviseRightAsset
      .mockRejectedValueOnce(new ApiError('无效响应', 200, 'INVALID_RESPONSE'))
      .mockResolvedValueOnce({ ...asset, customerVersion: 3 });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.setProps({ customerVersion: 10 });
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(
      wrapper.get('.right-assets-panel__list button').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[1].slice(0, 4)).toEqual(
      api.reviseRightAsset.mock.calls[0].slice(0, 4),
    );
  });

  it('holds an unknown withdrawal, then respects a known 403 on the same-key retry', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '撤下资产')!
      .trigger('click');
    await wrapper.get('input[maxlength="500"]').setValue('原始撤下原因');
    api.withdrawRightAsset
      .mockRejectedValueOnce(new ApiError('服务错误', 500, 'HTTP_ERROR'))
      .mockRejectedValueOnce(new ApiError('已撤权', 403, 'FORBIDDEN'));
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认撤下')!
      .trigger('click');
    await flushPromises();
    await wrapper.setProps({ customerVersion: 9 });
    expect(
      wrapper.get('input[maxlength="500"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.withdrawRightAsset.mock.calls[1].slice(0, 4)).toEqual(
      api.withdrawRightAsset.mock.calls[0].slice(0, 4),
    );
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('原请求重试')),
    ).toBe(false);
    expect(wrapper.text()).toContain('已撤权');
  });

  it('treats a successful command as committed even if the following read refresh fails', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('已登记商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    api.listRightAssets.mockRejectedValueOnce(
      new ApiError('读取失败', 500, 'HTTP_ERROR'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('version-updated')?.[0]).toEqual(['customer-1', 3]);
    expect(api.createRightAsset).toHaveBeenCalledTimes(1);
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('原请求重试')),
    ).toBe(false);
  });

  it('keeps a withdrawn latest revision draft inspectable but blocks resubmit', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('保留的草稿');
    api.reviseRightAsset.mockRejectedValueOnce(
      new ApiError('版本冲突', 409, 'RIGHT_ASSET_VERSION_CONFLICT'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    api.getRightAsset.mockResolvedValueOnce({
      ...asset,
      version: 2,
      withdrawn: true,
      history: [fields],
      capabilities: { revise: false, withdraw: false },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('input[placeholder="未知可留空"]').element,
    ).toHaveProperty('value', '保留的草稿');
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    expect(api.reviseRightAsset).toHaveBeenCalledTimes(1);
  });
});
