import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getCustomerSettlement: vi.fn(),
  listCustomerSettlementVersions: vi.fn(),
  registerCustomerSettlement: vi.fn(),
  correctCustomerSettlement: vi.fn(),
}));
vi.mock('../../api/customer-settlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/customer-settlements')>()),
  ...api,
}));

import CustomerSettlementsPanel from './CustomerSettlementsPanel.vue';
import type {
  CustomerSettlementPage,
  CustomerSettlementVersion,
} from '../../api/customer-settlements';

const version = (
  id: string,
  recordId: string,
  amount: string,
  received: string | null,
): CustomerSettlementVersion => ({
  id,
  recordId,
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  action: 'REGISTER',
  settlementDate: '2026-10-01',
  settlementAmount: amount,
  invoiceAmount: null,
  receivedAmount: received,
  receivedDate: null,
  correctionReason: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-01T03:00:00.000Z',
  auditEventId: `audit-${id}`,
});

const page: CustomerSettlementPage = {
  items: [
    {
      id: 'record-1',
      version: 1,
      currentVersion: version('version-1', 'record-1', '100.00', null),
    },
    {
      id: 'record-2',
      version: 1,
      currentVersion: version('version-2', 'record-2', '50.00', '0.00'),
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  stats: {
    recordCount: 2,
    totalSettlement: '150.00',
    invoiceKnownSubtotal: '0.00',
    invoiceUnknownCount: 2,
    receivedKnownSubtotal: '0.00',
    receivedUnknownCount: 1,
    pendingAmount: null,
    recoveryRate: null,
  },
  capabilities: { read: true, register: true, correct: true },
  customerVersion: 2,
};

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(CustomerSettlementsPanel, {
    props: {
      customerId: 'customer-1',
      customerVersion: 2,
      actor: { userId: 'user-1', departmentId: 'department-1' },
      actorKey: 'user-1:department-1:1',
      canRead: true,
      canRegister: true,
      canCorrect: true,
      data: page,
      status: 'ready',
      stale: false,
      error: '',
      page: 1,
      pageSize: 20,
      blockedByOtherMaintenance: false,
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  sessionStorage.clear();
});

describe('CustomerSettlementsPanel', () => {
  it('keeps two same-month records separate and distinguishes unknown from known zero', () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll('[data-test="settlement-record"]')).toHaveLength(2);
    expect(
      wrapper.get('[data-test="settlement-received-record-1"]').text(),
    ).toContain('未录入');
    expect(
      wrapper.get('[data-test="settlement-received-record-2"]').text(),
    ).toContain('¥0.00');
    expect(wrapper.text()).toContain('已知回款小计');
    expect(wrapper.text()).toContain('1 笔未录入');
  });

  it('shows correction controls only when read and correct are both granted', async () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll('[data-test^="correct-settlement-"]')).toHaveLength(
      2,
    );
    await wrapper.setProps({ canCorrect: false });
    expect(
      wrapper.find('[data-test="correct-settlement-record-1"]').exists(),
    ).toBe(false);
  });

  it('opens immutable version history with reason, actor and recorded time', async () => {
    api.listCustomerSettlementVersions.mockResolvedValue({
      items: [
        {
          ...version('version-1', 'record-1', '100.00', null),
          version: 2,
          action: 'CORRECT',
          correctionReason: '原始凭据核对',
          recordedByUserId: 'user-2',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="settlement-history-record-1"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('原始凭据核对');
    expect(wrapper.text()).toContain('user-2');
    expect(api.getCustomerSettlement).not.toHaveBeenCalled();
  });

  it('provides register-only with a blank form and performs no discovery GET', async () => {
    const wrapper = mountPanel({
      canRead: false,
      canRegister: true,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    expect(
      wrapper.find('[data-test="settlement-register-form"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="settlement-records"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-test="settlement-kpi-projection"]').exists(),
    ).toBe(false);
    expect(api.getCustomerSettlement).not.toHaveBeenCalled();
    expect(api.listCustomerSettlementVersions).not.toHaveBeenCalled();
  });

  it('does not post when saving the original request fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const wrapper = mountPanel({
      canRead: false,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    await wrapper
      .get('[data-test="settlement-date-input"]')
      .setValue('2026-10-02');
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('0.00');
    expect(
      wrapper
        .get('[data-test="settlement-register-submit"]')
        .attributes('disabled'),
    ).toBeUndefined();
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.registerCustomerSettlement).not.toHaveBeenCalled();
  });

  it('keeps the exact unknown request for retry and clears old facts after 403', async () => {
    const { ApiError } = await import('../../api/http');
    api.registerCustomerSettlement.mockRejectedValue(
      new ApiError('forbidden', 403, 'FORBIDDEN'),
    );
    const wrapper = mountPanel({
      canRead: false,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    await wrapper
      .get('[data-test="settlement-date-input"]')
      .setValue('2026-10-02');
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('0.00');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(
      sessionStorage.getItem(
        'customer-settlement:user-1:department-1:customer-1:settlement',
      ),
    ).not.toBeNull();
    expect(api.registerCustomerSettlement).toHaveBeenCalledTimes(1);
    const firstCall = api.registerCustomerSettlement.mock.calls[0];
    const persisted = JSON.parse(
      sessionStorage.getItem(
        'customer-settlement:user-1:department-1:customer-1:settlement',
      )!,
    );
    expect(persisted.body).toEqual(firstCall[1]);
    expect(persisted.key).toBe(firstCall[2]);
    expect(
      wrapper.get('[data-test="settlement-private-retry-note"]').text(),
    ).toContain('原请求已保留');
    expect(
      wrapper.find('[data-test="settlement-register-form"]').exists(),
    ).toBe(false);
    expect(wrapper.emitted('private-read-failed')).toHaveLength(1);
    await wrapper
      .get('[data-test="settlement-retry-original-private"]')
      .trigger('click');
    await flushPromises();
    const retryCall = api.registerCustomerSettlement.mock.calls[1];
    expect(retryCall[1]).toEqual(firstCall[1]);
    expect(retryCall[2]).toBe(firstCall[2]);
  });

  it('restores the unchanged pending request across an authorization revision', async () => {
    api.registerCustomerSettlement.mockRejectedValueOnce(new Error('network'));
    api.registerCustomerSettlement.mockResolvedValueOnce({
      recordId: 'record-new',
      version: 1,
      customerVersion: 3,
      snapshot: version('version-new', 'record-new', '0.00', null),
    });
    const wrapper = mountPanel({
      canRead: false,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    await wrapper
      .get('[data-test="settlement-date-input"]')
      .setValue('2026-10-02');
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('0.00');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    const firstCall = api.registerCustomerSettlement.mock.calls[0];

    await wrapper.setProps({ actorKey: 'user-1:department-1:2' });
    expect(
      wrapper.find('[data-test="settlement-retry-original-private"]').exists(),
    ).toBe(true);
    await wrapper
      .get('[data-test="settlement-retry-original-private"]')
      .trigger('click');
    await flushPromises();
    const retryCall = api.registerCustomerSettlement.mock.calls[1];
    expect(retryCall[1]).toEqual(firstCall[1]);
    expect(retryCall[2]).toBe(firstCall[2]);
  });

  it('blocks another command after confirmed success until the parent version refresh arrives', async () => {
    api.registerCustomerSettlement.mockResolvedValueOnce({
      recordId: 'record-new',
      version: 1,
      customerVersion: 3,
      snapshot: version('version-new', 'record-new', '0.00', null),
    });
    const wrapper = mountPanel({
      canRead: false,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    await wrapper
      .get('[data-test="settlement-date-input"]')
      .setValue('2026-10-02');
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('0.00');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('command-confirmed')).toHaveLength(1);
    expect(
      wrapper
        .get('[data-test="settlement-register-submit"]')
        .attributes('disabled'),
    ).toBeDefined();

    await wrapper.setProps({ customerVersion: 3 });
    expect(
      wrapper
        .get('[data-test="settlement-register-submit"]')
        .attributes('disabled'),
    ).toBeUndefined();
  });
});
