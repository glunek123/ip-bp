import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const api = vi.hoisted(() => ({
  listCustomerSettlements: vi.fn(),
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
import { useCustomerSettlements } from './use-customer-settlements';
import type {
  CustomerSettlementPage,
  CustomerSettlementDetail,
  CustomerSettlementCommandResult,
  CustomerSettlementVersion,
} from '../../api/customer-settlements';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  it('connects register, the shared list refresh, record source, correction and immutable history', async () => {
    const first = version(
      'version-new-1',
      'record-new',
      '9999999999999999.99',
      null,
    );
    const corrected: CustomerSettlementVersion = {
      ...first,
      id: 'version-new-2',
      version: 2,
      action: 'CORRECT',
      receivedAmount: '0.00',
      correctionReason: '核对到账凭据',
      auditEventId: 'audit-new-2',
    };
    const firstPage: CustomerSettlementPage = {
      ...page,
      items: [{ id: first.recordId, version: 1, currentVersion: first }],
      total: 1,
      customerVersion: 3,
    };
    const correctedPage: CustomerSettlementPage = {
      ...firstPage,
      items: [
        { id: corrected.recordId, version: 2, currentVersion: corrected },
      ],
      customerVersion: 4,
    };
    api.listCustomerSettlements
      .mockResolvedValueOnce({ ...page, items: [], total: 0 })
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(correctedPage);
    api.registerCustomerSettlement.mockResolvedValue({
      recordId: first.recordId,
      version: 1,
      customerVersion: 3,
      snapshot: first,
    });
    api.correctCustomerSettlement.mockResolvedValue({
      recordId: corrected.recordId,
      version: 2,
      customerVersion: 4,
      snapshot: corrected,
    });
    api.getCustomerSettlement.mockResolvedValue({
      record: firstPage.items[0],
      customerVersion: 3,
      capabilities: page.capabilities,
    });
    api.listCustomerSettlementVersions.mockResolvedValue({
      items: [corrected, first],
      total: 2,
      page: 1,
      pageSize: 20,
    });

    const Harness = defineComponent({
      components: { CustomerSettlementsPanel },
      setup() {
        const customerVersion = ref(2);
        const owner = useCustomerSettlements(
          ref('customer-1'),
          ref('user-1:department-1:1'),
          ref(true),
        );
        const stale = ref(false);
        async function confirmed(
          _customerId: string,
          _actorKey: string,
          result: CustomerSettlementCommandResult,
        ) {
          stale.value = true;
          customerVersion.value = result.customerVersion;
          await owner.refresh();
          stale.value = false;
        }
        return { customerVersion, owner, stale, confirmed };
      },
      template: `<CustomerSettlementsPanel customer-id="customer-1" :customer-version="customerVersion"
        :actor="{ userId: 'user-1', departmentId: 'department-1' }" actor-key="user-1:department-1:1"
        :can-read="true" :can-register="true" :can-correct="true" :data="owner.data.value"
        :status="owner.status.value" :stale="stale" :error="owner.error.value" :page="owner.page.value"
        :page-size="owner.pageSize" :blocked-by-other-maintenance="false" @command-confirmed="confirmed" />`,
    });
    const wrapper = mount(Harness);
    await flushPromises();
    expect(wrapper.get('[data-test="ledger-empty"]').text()).toContain('暂无');
    await wrapper
      .get('[data-test="settlement-date-input"]')
      .setValue('2026-10-01');
    await wrapper
      .get('[data-test="settlement-amount-input"]')
      .setValue(first.settlementAmount);
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.registerCustomerSettlement.mock.calls[0]![1]).toEqual({
      expectedCustomerVersion: 2,
      settlementDate: first.settlementDate,
      settlementAmount: first.settlementAmount,
      invoiceAmount: null,
      receivedAmount: null,
      receivedDate: null,
    });
    expect(wrapper.get('[data-test="ledger-settlement"]').text()).toBe(
      '¥9,999,999,999,999,999.99',
    );
    expect(
      wrapper.get('[data-test="settlement-amount-input"]').element,
    ).toHaveProperty('value', '');

    await wrapper.get('[data-test="ledger-open-record"]').trigger('click');
    await flushPromises();
    const source = wrapper.get('[data-test="settlement-detail"]');
    expect(source.text()).toContain(first.auditEventId);
    expect(source.text()).toContain(first.recordedByUserId);
    expect(source.text()).toContain(first.recordedAt);
    expect(source.text()).toContain(first.id);
    await source
      .get('[data-test="settlement-detail-correct"]')
      .trigger('click');
    await wrapper.get('[data-test="settlement-received-known"]').setValue(true);
    await wrapper
      .get('[data-test="settlement-received-input"]')
      .setValue('0.00');
    await wrapper
      .get('[data-test="settlement-correction-reason"]')
      .setValue('核对到账凭据');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.correctCustomerSettlement.mock.calls[0]!.slice(0, 3)).toEqual([
      'customer-1',
      'record-new',
      {
        expectedCustomerVersion: 3,
        expectedRecordVersion: 1,
        settlementDate: first.settlementDate,
        settlementAmount: first.settlementAmount,
        invoiceAmount: null,
        receivedAmount: '0.00',
        receivedDate: null,
        reason: '核对到账凭据',
      },
    ]);
    expect(api.listCustomerSettlements).toHaveBeenCalledTimes(3);
    expect(wrapper.get('[data-test="ledger-received"]').text()).toBe('¥0.00');
    expect(wrapper.find('[data-test="settlement-detail"]').exists()).toBe(
      false,
    );
    await wrapper
      .get('[data-test="settlement-history-record-new"]')
      .trigger('click');
    await flushPromises();
    const histories = wrapper.get(
      '[data-test="settlement-history-list-record-new"]',
    );
    expect(histories.findAll('li')).toHaveLength(2);
    expect(histories.text()).toContain('核对到账凭据');
    expect(histories.text()).toContain('audit-new-2');
    expect(histories.text()).toContain(first.auditEventId);
    expect(histories.text()).toContain('¥0.00');
    expect(histories.text()).toContain('未录入');
    wrapper.unmount();
  });

  it('reads a record once during duplicate clicks and hides all source facts on loss of read permission', async () => {
    const request = deferred<CustomerSettlementDetail>();
    api.getCustomerSettlement.mockReturnValue(request.promise);
    const wrapper = mountPanel();
    const button = wrapper.findAll('[data-test="ledger-open-record"]')[0]!;
    await button.trigger('click');
    await button.trigger('click');
    expect(api.getCustomerSettlement).toHaveBeenCalledTimes(1);
    expect(api.getCustomerSettlement.mock.calls[0]!.slice(0, 2)).toEqual([
      'customer-1',
      'record-1',
    ]);
    request.resolve({
      record: page.items[0]!,
      customerVersion: 2,
      capabilities: page.capabilities,
    });
    await flushPromises();
    expect(wrapper.get('[data-test="settlement-detail"]').text()).toContain(
      'audit-version-1',
    );
    await wrapper.setProps({
      canRead: false,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    expect(wrapper.find('[data-test="settlement-detail"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('audit-version-1');
    await button.trigger('click');
    expect(api.getCustomerSettlement).toHaveBeenCalledTimes(1);
  });

  it('ignores a late source response after switching away and back to the same customer', async () => {
    const request = deferred<CustomerSettlementDetail>();
    api.getCustomerSettlement.mockReturnValue(request.promise);
    const wrapper = mountPanel();
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[0]!
      .trigger('click');
    await wrapper.setProps({
      customerId: 'customer-2',
      data: undefined,
      status: 'loading',
    });
    await wrapper.setProps({
      customerId: 'customer-1',
      data: page,
      status: 'ready',
    });
    request.resolve({
      record: page.items[0]!,
      customerVersion: 2,
      capabilities: page.capabilities,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="settlement-detail"]').exists()).toBe(
      false,
    );
    expect(wrapper.emitted('private-read-failed')).toBeUndefined();
  });

  it('aborts a closed record source and does not display its late response', async () => {
    const request = deferred<CustomerSettlementDetail>();
    api.getCustomerSettlement.mockReturnValue(request.promise);
    const wrapper = mountPanel();
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[0]!
      .trigger('click');
    const options = api.getCustomerSettlement.mock.calls[0]![2];
    await wrapper.get('[data-test="settlement-detail-close"]').trigger('click');
    expect(options.signal.aborted).toBe(true);
    request.resolve({
      record: page.items[0]!,
      customerVersion: 2,
      capabilities: page.capabilities,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="settlement-detail"]').exists()).toBe(
      false,
    );
  });

  it('keeps record read failures distinct from empty data and retries only the GET', async () => {
    api.getCustomerSettlement
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        record: page.items[0],
        customerVersion: 2,
        capabilities: page.capabilities,
      });
    const wrapper = mountPanel();
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[0]!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="settlement-detail"]').text()).toContain(
      '记录读取失败',
    );
    expect(wrapper.find('[data-test="ledger-empty"]').exists()).toBe(false);
    await wrapper.get('[data-test="settlement-detail-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="settlement-detail"]').text()).toContain(
      'audit-version-1',
    );
    expect(api.getCustomerSettlement).toHaveBeenCalledTimes(2);
    expect(api.registerCustomerSettlement).not.toHaveBeenCalled();
    expect(api.correctCustomerSettlement).not.toHaveBeenCalled();
  });

  it.each([403, 404])(
    'clears all private facts after a record source %s',
    async (status) => {
      const { ApiError } = await import('../../api/http');
      api.getCustomerSettlement.mockRejectedValue(
        new ApiError('private', status, 'FORBIDDEN'),
      );
      const wrapper = mountPanel();
      const button = wrapper.findAll('[data-test="ledger-open-record"]')[0]!;
      await button.trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-test="settlement-records"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="settlement-kpi-projection"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="settlement-register-form"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain('¥100.00');
      expect(wrapper.emitted('private-read-failed')).toHaveLength(1);
      await button.trigger('click');
      expect(api.getCustomerSettlement).toHaveBeenCalledTimes(1);
    },
  );

  it('honors the current detail capability denial and never reveals an unapproved read', async () => {
    api.getCustomerSettlement
      .mockResolvedValueOnce({
        record: page.items[0],
        customerVersion: 2,
        capabilities: { read: true, register: false, correct: false },
      })
      .mockResolvedValueOnce({
        record: page.items[1],
        customerVersion: 2,
        capabilities: { read: false, register: false, correct: false },
      });
    const wrapper = mountPanel();
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[0]!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="settlement-detail-correct"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="correct-settlement-record-1"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="settlement-register-form"]').exists(),
    ).toBe(false);
    await wrapper.get('[data-test="settlement-detail-close"]').trigger('click');
    expect(
      wrapper.find('[data-test="correct-settlement-record-1"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="settlement-register-form"]').exists(),
    ).toBe(false);
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[1]!
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="settlement-records"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('audit-version-2');
  });

  it('requires list refresh when the source version has advanced', async () => {
    api.getCustomerSettlement.mockResolvedValue({
      record: {
        ...page.items[0],
        version: 2,
        currentVersion: { ...page.items[0]!.currentVersion, version: 2 },
      },
      customerVersion: 3,
      capabilities: page.capabilities,
    });
    const wrapper = mountPanel();
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[0]!
      .trigger('click');
    await flushPromises();
    expect(wrapper.emitted('settlement-state')).toContainEqual([
      'customer-1',
      'user-1:department-1:1',
      'stale',
      true,
    ]);
    expect(wrapper.find('[data-test="settlement-detail"]').exists()).toBe(
      false,
    );
    expect(api.correctCustomerSettlement).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="settlement-records"]').exists()).toBe(
      false,
    );
    expect(
      wrapper
        .get('[data-test="settlement-register-submit"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper.setProps({
      data: { ...page, customerVersion: 3 },
      customerVersion: 3,
    });
    expect(wrapper.find('[data-test="settlement-records"]').exists()).toBe(
      true,
    );
  });

  it('uses the refreshed authorized list version and capabilities when ordinary customer detail is older', async () => {
    const current = {
      ...page.items[0]!,
      version: 2,
      currentVersion: {
        ...page.items[0]!.currentVersion,
        version: 2 as const,
        action: 'CORRECT' as const,
        correctionReason: '票据复核',
      },
    };
    const currentPage: CustomerSettlementPage = {
      ...page,
      items: [current],
      customerVersion: 3,
    };
    api.getCustomerSettlement.mockResolvedValue({
      record: current,
      customerVersion: 3,
      capabilities: page.capabilities,
    });
    api.correctCustomerSettlement.mockRejectedValueOnce(new Error('network'));
    const wrapper = mountPanel({ data: currentPage, customerVersion: 2 });
    await wrapper.get('[data-test="ledger-open-record"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="settlement-detail"]').text()).toContain(
      '第 2 版',
    );
    await wrapper
      .get('[data-test="settlement-detail-correct"]')
      .trigger('click');
    await wrapper
      .get('[data-test="settlement-correction-reason"]')
      .setValue('再次核对');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.correctCustomerSettlement.mock.calls[0]![2]).toMatchObject({
      expectedCustomerVersion: 3,
      expectedRecordVersion: 2,
    });
    wrapper.unmount();
    sessionStorage.clear();
    const denied = mountPanel({
      data: {
        ...currentPage,
        capabilities: { read: true, register: false, correct: false },
      },
    });
    expect(
      denied.find('[data-test="correct-settlement-record-1"]').exists(),
    ).toBe(false);
    expect(denied.find('[data-test="settlement-register-form"]').exists()).toBe(
      false,
    );
  });

  it('keeps old command results isolated after switching away and back to the same customer', async () => {
    const request = deferred<CustomerSettlementCommandResult>();
    api.registerCustomerSettlement.mockReturnValue(request.promise);
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="settlement-date-input"]')
      .setValue('2026-10-02');
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('0.00');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    const first = api.registerCustomerSettlement.mock.calls[0]!;
    await wrapper.setProps({
      customerId: 'customer-2',
      data: undefined,
      status: 'idle',
    });
    await wrapper.setProps({
      customerId: 'customer-1',
      data: page,
      status: 'ready',
    });
    request.resolve({
      recordId: 'record-new',
      version: 1,
      customerVersion: 3,
      snapshot: version('new-version', 'record-new', '0.00', null),
    });
    await flushPromises();
    expect(wrapper.emitted('command-confirmed')).toBeUndefined();
    expect(
      wrapper.find('[data-test="settlement-retry-original"]').exists(),
    ).toBe(true);
    const stored = JSON.parse(
      sessionStorage.getItem(
        'customer-settlement:user-1:department-1:customer-1:settlement',
      )!,
    );
    expect(stored.key).toBe(first[2]);
    expect(stored.body).toEqual(first[1]);
  });

  it('does not carry a private failure into another customer with register-only permission', async () => {
    const { ApiError } = await import('../../api/http');
    api.getCustomerSettlement.mockRejectedValueOnce(
      new ApiError('private', 403, 'FORBIDDEN'),
    );
    const wrapper = mountPanel();
    await wrapper
      .findAll('[data-test="ledger-open-record"]')[0]!
      .trigger('click');
    await flushPromises();
    await wrapper.setProps({
      customerId: 'customer-2',
      canRead: false,
      canCorrect: false,
      data: undefined,
      status: 'idle',
    });
    expect(
      wrapper.find('[data-test="settlement-register-form"]').exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-test="settlement-register-submit"]')
        .attributes('disabled'),
    ).toBeUndefined();
    expect(wrapper.text()).not.toContain('audit-version-1');
    expect(api.getCustomerSettlement).toHaveBeenCalledTimes(1);
  });

  it('pages immutable history with the same customer and record and exact prior facts', async () => {
    const old = {
      ...page.items[0]!.currentVersion,
      invoiceAmount: '0.00',
      receivedDate: '2026-10-01',
    };
    api.listCustomerSettlementVersions
      .mockResolvedValueOnce({ items: [old], total: 21, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({
        items: [old],
        total: 21,
        page: 2,
        pageSize: 20,
      });
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="settlement-history-record-1"]')
      .trigger('click');
    await flushPromises();
    const history = wrapper.get(
      '[data-test="settlement-history-list-record-1"]',
    );
    expect(history.text()).toContain('¥0.00');
    expect(history.text()).toContain('未录入');
    expect(history.text()).toContain('audit-version-1');
    const historyRow = history.element.closest('tr')!;
    const buttons = wrapper
      .findAll('button')
      .filter((button) => historyRow.contains(button.element));
    await buttons
      .find((button) => button.text() === '下一页')!
      .trigger('click');
    await flushPromises();
    expect(
      api.listCustomerSettlementVersions.mock.calls[1]!.slice(0, 4),
    ).toEqual(['customer-1', 'record-1', 2, 20]);
    expect(api.correctCustomerSettlement).not.toHaveBeenCalled();
  });

  it('blocks duplicate corrections and replays the unchanged original after an unknown result', async () => {
    const response = deferred<CustomerSettlementCommandResult>();
    api.correctCustomerSettlement
      .mockReturnValueOnce(response.promise)
      .mockRejectedValueOnce(new Error('network'));
    const wrapper = mountPanel();
    const otherCorrection = wrapper.get(
      '[data-test="correct-settlement-record-2"]',
    );
    await wrapper
      .get('[data-test="correct-settlement-record-1"]')
      .trigger('click');
    await wrapper
      .get('[data-test="settlement-correction-reason"]')
      .setValue('核对原始票据');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await otherCorrection.trigger('click');
    await otherCorrection.trigger('click');
    expect(api.correctCustomerSettlement).toHaveBeenCalledTimes(1);
    const firstCall = api.correctCustomerSettlement.mock.calls[0]!;
    await wrapper.setProps({ actorKey: 'user-1:department-1:2' });
    response.resolve({
      recordId: 'record-1',
      version: 2,
      customerVersion: 3,
      snapshot: { ...page.items[0]!.currentVersion, version: 2 },
    });
    await flushPromises();
    expect(wrapper.emitted('command-confirmed')).toBeUndefined();
    await wrapper
      .get('[data-test="settlement-retry-original"]')
      .trigger('click');
    await flushPromises();
    const replay = api.correctCustomerSettlement.mock.calls[1]!;
    expect(replay).toEqual(firstCall);
    expect(replay[2]).toMatchObject({
      expectedRecordVersion: 1,
      receivedAmount: null,
      reason: '核对原始票据',
    });
  });

  it('does not load history twice during duplicate clicks and hides it during a stale refresh', async () => {
    const request = deferred<{
      items: CustomerSettlementVersion[];
      total: number;
      page: number;
      pageSize: number;
    }>();
    api.listCustomerSettlementVersions.mockReturnValue(request.promise);
    const wrapper = mountPanel();
    const button = wrapper.get('[data-test="settlement-history-record-1"]');
    await button.trigger('click');
    await button.trigger('click');
    expect(api.listCustomerSettlementVersions).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ stale: true });
    request.resolve({
      items: [page.items[0]!.currentVersion],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="settlement-records"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('audit-version-1');
  });

  it('keeps two same-month records separate and distinguishes unknown from known zero', () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll('[data-test="settlement-record"]')).toHaveLength(2);
    expect(
      wrapper.findAll('[data-test="ledger-received"]')[0]!.text(),
    ).toContain('未录入');
    expect(
      wrapper.findAll('[data-test="ledger-received"]')[1]!.text(),
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

  it('keeps the original key for a bounded BUSY response', async () => {
    const { ApiError } = await import('../../api/http');
    api.registerCustomerSettlement.mockRejectedValueOnce(
      new ApiError('busy', 409, 'BUSY'),
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
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('1.00');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    expect(
      wrapper.find('[data-test="settlement-retry-original-private"]').exists(),
    ).toBe(true);
    expect(sessionStorage.length).toBe(1);
  });

  it('does not offer a new POST when clearing a confirmed request fails', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    api.registerCustomerSettlement.mockResolvedValueOnce({
      recordId: 'record-new',
      version: 1,
      customerVersion: 3,
      snapshot: version('version-new', 'record-new', '1.00', null),
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
    await wrapper.get('[data-test="settlement-amount-input"]').setValue('1.00');
    await wrapper
      .get('[data-test="settlement-register-form"]')
      .trigger('submit');
    await flushPromises();
    await wrapper.setProps({ customerVersion: 3 });
    expect(
      wrapper
        .get('[data-test="settlement-register-submit"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(api.registerCustomerSettlement).toHaveBeenCalledTimes(1);
  });
});
