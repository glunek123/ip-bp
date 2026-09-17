import { flushPromises, mount } from '@vue/test-utils';
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
    api.listCustomerRightsHolders.mockResolvedValue(listResult());
    api.findLinkableRightsHolders.mockResolvedValue({
      items: [{ ...holder, id: 'holder-2', name: '主体乙' }],
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
