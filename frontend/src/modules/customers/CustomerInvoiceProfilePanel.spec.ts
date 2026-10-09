import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerInvoiceProfilePanel from './CustomerInvoiceProfilePanel.vue';

const api = vi.hoisted(() => ({
  createCustomerInvoiceProfile: vi.fn(),
  getCustomerInvoiceProfile: vi.fn(),
  listCustomerInvoiceVersions: vi.fn(),
  reviseCustomerInvoiceProfile: vi.fn(),
}));
vi.mock('../../api/customer-agreements-invoice', () => api);

afterEach(() => {
  vi.resetAllMocks();
  globalThis.sessionStorage.clear();
});

const invoiceVersion = {
  id: 'invoice-version-1',
  profileId: 'invoice-profile-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  invoiceType: null,
  invoiceSubject: null,
  taxNo: null,
  bank: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-09T00:00:00.000Z',
  auditEventId: 'audit-1',
};
const allUnknownProfile = {
  profile: {
    id: 'invoice-profile-1',
    version: 1,
    currentVersion: invoiceVersion,
  },
  canEdit: true,
  customerVersion: 2,
};

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(CustomerInvoiceProfilePanel, {
    props: {
      customerId: 'customer-1',
      customerVersion: 1,
      canRead: true,
      canEdit: true,
      actor: { userId: 'user-1', departmentId: 'department-1' },
      actorKey: 'user-1:department-1:8',
      blockedByOtherMaintenance: false,
      ...overrides,
    },
  });
}

describe('CustomerInvoiceProfilePanel', () => {
  it('does not fetch or show invoice fields without the read capability', async () => {
    const wrapper = mountPanel({ canRead: false });
    await flushPromises();

    expect(api.getCustomerInvoiceProfile).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="invoice-no-read"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('开户银行及账号');
  });

  it('distinguishes a missing profile from a recorded version with all fields unknown', async () => {
    api.getCustomerInvoiceProfile
      .mockResolvedValueOnce({
        profile: null,
        canEdit: true,
        customerVersion: 1,
      })
      .mockResolvedValueOnce(allUnknownProfile);
    api.createCustomerInvoiceProfile.mockResolvedValue(allUnknownProfile);
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain('尚未建立开票档案');

    await wrapper.get('[data-test="invoice-edit"]').trigger('click');
    await wrapper.get('[data-test="invoice-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('当前第 1 版');
    expect(wrapper.text()).toContain('发票抬头');
    expect(wrapper.text()).toContain('未知');
  });

  it('does not resubmit a known successful write when the current read fails', async () => {
    api.getCustomerInvoiceProfile
      .mockResolvedValueOnce({
        profile: null,
        canEdit: true,
        customerVersion: 1,
      })
      .mockRejectedValueOnce(new Error('read unavailable'))
      .mockResolvedValueOnce(allUnknownProfile);
    api.createCustomerInvoiceProfile.mockResolvedValue(allUnknownProfile);
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="invoice-edit"]').trigger('click');
    await wrapper.get('textarea').setValue('甲银行 123');
    await wrapper.get('[data-test="invoice-form"]').trigger('submit');
    await flushPromises();

    expect(api.createCustomerInvoiceProfile).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('已提交');
    expect(wrapper.find('[data-test="invoice-submit"]').exists()).toBe(false);
    await wrapper.get('[data-test="invoice-refresh"]').trigger('click');
    await flushPromises();
    expect(api.createCustomerInvoiceProfile).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('当前第 1 版');
  });

  it('retains the original command body and key for an unknown invoice result', async () => {
    api.getCustomerInvoiceProfile.mockResolvedValue({
      profile: null,
      canEdit: true,
      customerVersion: 1,
    });
    api.createCustomerInvoiceProfile
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce(allUnknownProfile);
    const wrapper = mountPanel();
    await flushPromises();
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'invoice-original-key',
    });
    await wrapper.get('[data-test="invoice-edit"]').trigger('click');
    await wrapper.get('textarea').setValue('甲银行 123');
    await wrapper.get('[data-test="invoice-form"]').trigger('submit');
    await flushPromises();
    const body = api.createCustomerInvoiceProfile.mock.calls[0]?.[1];
    expect(globalThis.sessionStorage.length).toBe(1);

    await wrapper.get('[data-test="invoice-form"]').trigger('submit');
    await flushPromises();
    expect(api.createCustomerInvoiceProfile).toHaveBeenNthCalledWith(
      2,
      'customer-1',
      body,
      'invoice-original-key',
    );
  });
});
