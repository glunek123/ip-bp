import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerRightsHolderPanel from './CustomerRightsHolderPanel.vue';

const api = vi.hoisted(() => ({
  listCustomerRightsHolders: vi.fn(),
  findLinkableRightsHolders: vi.fn(),
  createCustomerRightsHolder: vi.fn(),
  linkCustomerRightsHolder: vi.fn(),
}));
vi.mock('../../api/rights-holders', () => api);

const holder = {
  id: 'holder-1',
  name: '主体甲',
  credit: null,
  address: null,
  legalRepresentative: null,
  duty: null,
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

  it('renders read-only rows without any out-of-scope controls', async () => {
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

  it('validates the required name and submits every optional CU03 field', async () => {
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
    expect(wrapper.emitted('version-updated')).toEqual([[2]]);
    expect(api.listCustomerRightsHolders).toHaveBeenCalledTimes(2);
  });

  it('prevents concurrent submits, preserves input, and reuses one key only for the failed command', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.createCustomerRightsHolder
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ holder, linkId: 'link-1', customerVersion: 2 })
      .mockResolvedValueOnce({
        holder: { ...holder, id: 'holder-2', name: '主体乙' },
        linkId: 'link-2',
        customerVersion: 3,
      });
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('uuid-first')
      .mockReturnValueOnce('uuid-second');
    vi.stubGlobal('crypto', { randomUUID });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体甲');
    const submit = wrapper.get('[data-test="submit-create-holder"]');
    await Promise.all([submit.trigger('click'), submit.trigger('click')]);
    await flushPromises();
    expect(api.createCustomerRightsHolder).toHaveBeenCalledTimes(1);
    expect(
      (wrapper.get('[name="name"]').element as HTMLInputElement).value,
    ).toBe('主体甲');
    expect(wrapper.text()).toContain('创建失败');

    await submit.trigger('click');
    await flushPromises();
    expect(api.createCustomerRightsHolder.mock.calls[0]?.[2]).toBe(
      'uuid-first',
    );
    expect(api.createCustomerRightsHolder.mock.calls[1]?.[2]).toBe(
      'uuid-first',
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-test="open-create-holder"]').trigger('click');
    await wrapper.get('[name="name"]').setValue('主体乙');
    await wrapper.get('[data-test="submit-create-holder"]').trigger('click');
    await flushPromises();
    expect(api.createCustomerRightsHolder.mock.calls[2]?.[2]).toBe(
      'uuid-second',
    );
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('opens a scoped linkable selector and links the chosen holder', async () => {
    api.listCustomerRightsHolders
      .mockResolvedValueOnce(listResult())
      .mockResolvedValueOnce(listResult({ items: [holderB] }));
    api.findLinkableRightsHolders.mockResolvedValue({
      items: [holderB],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    api.linkCustomerRightsHolder.mockResolvedValue({
      holder,
      linkId: 'link-2',
      customerVersion: 2,
    });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-link') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('主体乙');
    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();
    expect(api.linkCustomerRightsHolder).toHaveBeenCalledWith(
      'customer-1',
      { expectedCustomerVersion: 1, rightsHolderId: 'holder-2' },
      'uuid-link',
    );
    expect(api.listCustomerRightsHolders).toHaveBeenLastCalledWith(
      'customer-1',
      1,
      20,
      expect.any(Object),
    );
    expect(wrapper.text()).toContain('主体乙');
  });

  it('clears a selection when search results no longer contain it', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.findLinkableRightsHolders
      .mockResolvedValueOnce({
        items: [holder, holderB],
        total: 2,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [holderB],
        total: 1,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();

    await wrapper.get('[value="holder-1"]').setValue();
    await wrapper.get('[name="query"]').setValue('乙');
    await wrapper.get('[data-test="search-linkable"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[value="holder-1"]').exists()).toBe(false);
    expect(
      (
        wrapper.get('[data-test="submit-link-holder"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[name="query"]').setValue('不存在');
    await wrapper.get('[data-test="search-linkable"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('没有可关联的权利主体');
    expect(
      (
        wrapper.get('[data-test="submit-link-holder"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('clears a selection when paging to a different candidate set', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.findLinkableRightsHolders
      .mockResolvedValueOnce({
        items: [holder],
        total: 21,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [holderB],
        total: 21,
        page: 2,
        pageSize: 20,
      });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-1"]').setValue();

    (
      wrapper.findComponent('[data-test="linkable-pagination"]') as VueWrapper
    ).vm.$emit('current-change', 2);
    await flushPromises();

    expect(wrapper.text()).toContain('主体乙');
    expect(
      (
        wrapper.get('[data-test="submit-link-holder"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('keeps only the latest linkable response when searches resolve out of order', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    const oldSearch = deferred<{
      items: (typeof holder)[];
      total: number;
      page: number;
      pageSize: number;
    }>();
    const newSearch = deferred<{
      items: (typeof holder)[];
      total: number;
      page: number;
      pageSize: number;
    }>();
    api.findLinkableRightsHolders
      .mockReturnValueOnce(oldSearch.promise)
      .mockReturnValueOnce(newSearch.promise);
    api.linkCustomerRightsHolder.mockResolvedValue({
      holder: holderB,
      linkId: 'link-2',
      customerVersion: 2,
    });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'latest-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await wrapper.get('[name="query"]').setValue('乙');
    await wrapper.get('[data-test="search-linkable"]').trigger('click');

    newSearch.resolve({
      items: [holderB],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    oldSearch.resolve({
      items: [holder],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await flushPromises();

    expect(wrapper.find('[value="holder-2"]').exists()).toBe(true);
    expect(wrapper.find('[value="holder-1"]').exists()).toBe(false);
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();
    expect(api.linkCustomerRightsHolder).toHaveBeenCalledWith(
      'customer-1',
      { expectedCustomerVersion: 1, rightsHolderId: 'holder-2' },
      'latest-key',
    );
  });

  it('refuses a selected holder id that is not in the visible candidate set', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.findLinkableRightsHolders.mockResolvedValue({
      items: [holderB],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    const radio = wrapper.get('[value="holder-2"]');
    const radioElement = radio.element as HTMLInputElement & {
      _value?: string;
    };
    radioElement.value = 'hidden-holder';
    radioElement._value = 'hidden-holder';
    await radio.setValue();

    expect(
      (
        wrapper.get('[data-test="submit-link-holder"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    expect(api.linkCustomerRightsHolder).not.toHaveBeenCalled();
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

  it('ignores an old link success after cancel and reopen', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.findLinkableRightsHolders.mockResolvedValue({
      items: [holderB],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const oldCommand = deferred<{
      holder: typeof holderB;
      linkId: string;
      customerVersion: number;
    }>();
    api.linkCustomerRightsHolder.mockReturnValueOnce(oldCommand.promise);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'old-link-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');

    await wrapper.get('[data-test="cancel-link-holder"]').trigger('click');
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    oldCommand.resolve({
      holder: holderB,
      linkId: 'link-old',
      customerVersion: 2,
    });
    await flushPromises();

    expect(wrapper.find('[aria-label="关联已有权利主体"]').exists()).toBe(true);
    expect(
      (wrapper.get('[value="holder-2"]').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(wrapper.emitted('version-updated')).toBeUndefined();
    expect(api.listCustomerRightsHolders).toHaveBeenCalledTimes(1);
  });

  it('uses a new create key after cancel and reopen while preserving direct retry identity', async () => {
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

  it('uses a new link key after cancel and reopen while preserving direct retry identity', async () => {
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.findLinkableRightsHolders.mockResolvedValue({
      items: [holderB],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    api.linkCustomerRightsHolder.mockRejectedValue(new Error('offline'));
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('link-first')
      .mockReturnValueOnce('link-reopened');
    vi.stubGlobal('crypto', { randomUUID });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();
    expect(api.linkCustomerRightsHolder.mock.calls[1]?.[2]).toBe('link-first');

    await wrapper.get('[data-test="cancel-link-holder"]').trigger('click');
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();
    expect(api.linkCustomerRightsHolder.mock.calls[2]?.[2]).toBe(
      'link-reopened',
    );
  });

  it('removes write actions immediately after authorization is revoked', async () => {
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

  it('refreshes both lists when an existing holder was linked concurrently', async () => {
    api.listCustomerRightsHolders
      .mockResolvedValueOnce(listResult())
      .mockResolvedValueOnce(
        listResult({ items: [holder, holderB], total: 2 }),
      );
    api.findLinkableRightsHolders
      .mockResolvedValueOnce({
        items: [holderB],
        total: 1,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    api.linkCustomerRightsHolder.mockRejectedValue(
      new ApiError('已关联', 409, 'RIGHTS_HOLDER_ALREADY_LINKED'),
    );
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'already-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();

    expect(api.listCustomerRightsHolders).toHaveBeenCalledTimes(2);
    expect(api.findLinkableRightsHolders).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('主体乙');
    expect(wrapper.text()).toContain('没有可关联的权利主体');
    expect(
      (
        wrapper.get('[data-test="submit-link-holder"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('does not surface an old duplicate-link refresh after cancel and reopen', async () => {
    const oldListRefresh = deferred<ReturnType<typeof listResult>>();
    const oldLinkableRefresh = deferred<{
      items: (typeof holder)[];
      total: number;
      page: number;
      pageSize: number;
    }>();
    api.listCustomerRightsHolders
      .mockResolvedValueOnce(listResult())
      .mockReturnValueOnce(oldListRefresh.promise);
    api.findLinkableRightsHolders
      .mockResolvedValueOnce({
        items: [holderB],
        total: 1,
        page: 1,
        pageSize: 20,
      })
      .mockReturnValueOnce(oldLinkableRefresh.promise)
      .mockResolvedValueOnce({
        items: [holderB],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    api.linkCustomerRightsHolder.mockRejectedValue(
      new ApiError('已关联', 409, 'RIGHTS_HOLDER_ALREADY_LINKED'),
    );
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'already-key') });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    await wrapper.get('[value="holder-2"]').setValue();
    await wrapper.get('[data-test="submit-link-holder"]').trigger('click');
    await flushPromises();

    await wrapper.get('[data-test="cancel-link-holder"]').trigger('click');
    await wrapper.get('[data-test="open-link-holder"]').trigger('click');
    await flushPromises();
    oldListRefresh.resolve(listResult({ items: [holder, holderB], total: 2 }));
    oldLinkableRefresh.resolve({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    await flushPromises();

    expect(wrapper.find('[aria-label="关联已有权利主体"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('该权利主体已关联，列表已刷新');
    expect(wrapper.find('[value="holder-2"]').exists()).toBe(true);
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
