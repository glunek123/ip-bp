import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerRightsHolderPanel from './CustomerRightsHolderPanel.vue';

const api = vi.hoisted(() => ({
  listCustomerRightsHolders: vi.fn(),
  createCustomerRightsHolder: vi.fn(),
}));
vi.mock('../../api/rights-holders', () => api);

const holder = {
  id: 'holder-1',
  name: '主体甲',
  credit: '91310000',
  address: '上海市浦东新区',
  legalRepresentative: '张三',
  duty: '执行董事',
  updatedAt: '2026-09-17T01:00:00.000Z',
};
const holderB = { ...holder, id: 'holder-2', name: '主体乙' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function listResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [holder],
    total: 1,
    page: 1,
    pageSize: 20,
    capabilities: { create: true, link: true },
    ...overrides,
  };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function mountPanel(canEdit = true) {
  return mount(CustomerRightsHolderPanel, {
    props: { customerId: 'customer-1', customerVersion: 1, canEdit },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
}

describe('CustomerRightsHolderPanel', () => {
  it('shows loading then the empty state', async () => {
    let resolveList!: (value: unknown) => void;
    api.listCustomerRightsHolders.mockReturnValueOnce(
      new Promise((resolve) => (resolveList = resolve)),
    );
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('正在读取权利主体');
    resolveList(listResult({ items: [], total: 0 }));
    await flushPromises();
    expect(wrapper.text()).toContain('尚未关联权利主体');
  });

  it('shows a retryable failure state', async () => {
    api.listCustomerRightsHolders
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(listResult());
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain('权利主体暂时无法加载');
    await wrapper.get('[data-test="reload-holders"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('主体甲');
  });

  it('returns to the customer list when the anchor disappears during list loading', async () => {
    api.listCustomerRightsHolders.mockRejectedValue(
      new ApiError('客户不存在', 404, 'CUSTOMER_NOT_FOUND'),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.emitted('customer-not-found')).toHaveLength(1);
  });

  it('renders six holder columns, placeholders, details, and no link entry', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(
      listResult({
        items: [
          holder,
          {
            ...holderB,
            credit: null,
            address: null,
            legalRepresentative: null,
            duty: null,
          },
        ],
        total: 2,
      }),
    );
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '权利主体',
      '统一社会信用代码',
      '住所地',
      '法定代表人',
      '职务',
      '操作',
    ]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('91310000');
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('上海市浦东新区');
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('张三');
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('执行董事');
    expect(
      wrapper
        .findAll('tbody tr')[1]
        ?.findAll('td')
        .map((cell) => cell.text()),
    ).toEqual(['主体乙', '—', '—', '—', '—', '查看详情']);
    expect(wrapper.findAll('a').map((link) => link.text())).toEqual([
      '查看详情',
      '查看详情',
    ]);
    expect(wrapper.find('[data-test="open-link-holder"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/搜索可关联|确认关联|取消关联/u);
  });

  it('pages through every linked holder instead of stranding records after page one', async () => {
    api.listCustomerRightsHolders
      .mockResolvedValueOnce(listResult({ total: 21 }))
      .mockResolvedValueOnce(
        listResult({ items: [holderB], total: 21, page: 2 }),
      );
    const wrapper = mountPanel();
    await flushPromises();
    (
      wrapper.findComponent('[data-test="holder-pagination"]') as VueWrapper
    ).vm.$emit('current-change', 2);
    await flushPromises();
    expect(api.listCustomerRightsHolders).toHaveBeenLastCalledWith(
      'customer-1',
      2,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain('主体乙');
  });

  it('renders read-only rows without write actions', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    const wrapper = mountPanel(false);
    await flushPromises();
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.find('[data-test="open-create-holder"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="open-link-holder"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/编辑|删除|解除|默认主体/u);
  });

  it('validates the required name and submits every optional holder field', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.createCustomerRightsHolder.mockResolvedValue({
      holder,
      linkId: 'link-1',
      customerVersion: 2,
    });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-create') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    expect(
      wrapper.find('label[for="holder-name"] .required-mark').exists(),
    ).toBe(true);
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    expect(wrapper.text()).toContain('请填写权利主体名称');
    for (const [selector, value] of [
      ['name', '主体甲'],
      ['credit', '91310000'],
      ['address', '上海'],
      ['legalRepresentative', '张三'],
      ['duty', '执行董事'],
    ] as const) {
      await wrapper.get(`[name="${selector}"]`).setValue(value);
    }
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(api.createCustomerRightsHolder).toHaveBeenCalledWith(
      'customer-1',
      {
        expectedCustomerVersion: 1,
        name: '主体甲',
        credit: '91310000',
        address: '上海',
        legalRepresentative: '张三',
        duty: '执行董事',
      },
      'uuid-create',
    );
    expect(wrapper.emitted('version-updated')).toEqual([['customer-1', 2]]);
    expect(api.listCustomerRightsHolders).toHaveBeenCalledTimes(2);
  });

  it('prevents concurrent create submits and preserves the failed command identity', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    const command = deferred<{
      holder: typeof holder;
      linkId: string;
      customerVersion: number;
    }>();
    api.createCustomerRightsHolder.mockReturnValueOnce(command.promise);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'create-command-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    const submit = wrapper.get('[data-test="submit-create-holder"]');
    await Promise.all([submit.trigger('click'), submit.trigger('click')]);
    expect(api.createCustomerRightsHolder).toHaveBeenCalledTimes(1);
    command.reject(new Error('offline'));
    await flushPromises();
    await submit.trigger('click');
    expect(api.createCustomerRightsHolder).toHaveBeenCalledTimes(2);
    expect(
      api.createCustomerRightsHolder.mock.calls.map((call) => call[2]),
    ).toEqual(['create-command-key', 'create-command-key']);
  });

  it('keeps the create command key for a direct retry and rotates it after closing', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.createCustomerRightsHolder.mockRejectedValue(new Error('offline'));
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('create-first')
      .mockReturnValueOnce('create-reopened');
    vi.stubGlobal('crypto', { randomUUID });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(api.createCustomerRightsHolder.mock.calls[1]?.[2]).toBe(
      'create-first',
    );
    await wrapper.get('[data-test="cancel-create-holder"]').trigger('click');
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(api.createCustomerRightsHolder.mock.calls[2]?.[2]).toBe(
      'create-reopened',
    );
  });

  it('removes create actions immediately after authorization is revoked', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.createCustomerRightsHolder.mockRejectedValue(
      new ApiError('无权操作', 403, 'CUSTOMER_ACTION_FORBIDDEN'),
    );
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'forbidden-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号没有编辑此客户的权限');
    expect(wrapper.find('[data-test="open-create-holder"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="open-link-holder"]').exists()).toBe(false);
  });

  it('ignores an old create failure after cancel and reopen', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    const oldCommand = deferred<never>();
    const newCommand = deferred<never>();
    api.createCustomerRightsHolder
      .mockReturnValueOnce(oldCommand.promise)
      .mockReturnValueOnce(newCommand.promise)
      .mockResolvedValueOnce({ holder, linkId: 'link-1', customerVersion: 2 });
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('old-create-key')
      .mockReturnValueOnce('new-create-key');
    vi.stubGlobal('crypto', { randomUUID });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');

    await wrapper.get('[data-test="cancel-create-holder"]').trigger('click');
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    expect(api.createCustomerRightsHolder).toHaveBeenCalledTimes(2);

    newCommand.reject(new Error('new failure'));
    await flushPromises();
    expect(wrapper.text()).toContain('创建失败');
    oldCommand.reject(new Error('old failure'));
    await flushPromises();
    expect(
      (wrapper.get('[name="name"]').element as HTMLInputElement).value,
    ).toBe('主体甲');

    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(
      api.createCustomerRightsHolder.mock.calls.map((call) => call[2]),
    ).toEqual(['old-create-key', 'new-create-key', 'new-create-key']);
  });

  it('asks the customer page to return to the list when the anchor customer disappears', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.createCustomerRightsHolder.mockRejectedValue(
      new ApiError('客户不存在', 404, 'CUSTOMER_NOT_FOUND'),
    );
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'missing-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('customer-not-found')).toHaveLength(1);
  });

  it('keeps input and asks for a customer refresh on version conflict', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.createCustomerRightsHolder.mockRejectedValue(
      new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
    );
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-conflict') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('客户资料已被他人更新');
    expect(
      (wrapper.get('[name="name"]').element as HTMLInputElement).value,
    ).toBe('主体甲');
    await wrapper
      .get('[data-test="refresh-customer-version"]')
      .trigger('click');
    expect(wrapper.emitted('refresh-requested')).toHaveLength(1);
  });
});
