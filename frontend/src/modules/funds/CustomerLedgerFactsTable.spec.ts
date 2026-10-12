import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type {
  CustomerSettlementRecord,
  CustomerSettlementVersion,
} from '../../api/customer-settlements';
import CustomerLedgerFactsTable from './CustomerLedgerFactsTable.vue';

function settlement(
  id: string,
  facts: Partial<CustomerSettlementVersion> = {},
): CustomerSettlementRecord {
  const currentVersion: CustomerSettlementVersion = {
    id: `version-${id}`,
    recordId: id,
    customerId: 'customer-1',
    departmentId: 'department-1',
    version: 1,
    action: 'REGISTER',
    settlementDate: '2026-10-01',
    settlementAmount: '100.00',
    invoiceAmount: null,
    receivedAmount: null,
    receivedDate: null,
    correctionReason: null,
    recordedByUserId: 'user-1',
    recordedAt: '2026-10-01T03:00:00.000Z',
    auditEventId: `audit-${id}`,
    ...facts,
  };
  return { id, version: currentVersion.version, currentVersion };
}

function mountTable(
  overrides: Partial<{
    customerId: string;
    records: CustomerSettlementRecord[];
    canRead: boolean;
    loading: boolean;
    error: string;
  }> = {},
) {
  return mount(CustomerLedgerFactsTable, {
    props: {
      customerId: 'customer-1',
      records: [settlement('record-1')],
      canRead: true,
      loading: false,
      error: '',
      ...overrides,
    },
  });
}

describe('CustomerLedgerFactsTable', () => {
  it('keeps same-month facts separate and distinguishes null from real zero', () => {
    const wrapper = mountTable({
      records: [
        settlement('unknown'),
        settlement('zero', {
          settlementDate: '2026-10-02',
          settlementAmount: '0.00',
          invoiceAmount: '0.00',
          receivedAmount: '0.00',
        }),
      ],
    });
    const rows = wrapper.findAll('[data-test="ledger-record"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].get('[data-test="ledger-date"]').text()).toBe('2026-10-01');
    expect(rows[0].get('[data-test="ledger-invoice"]').text()).toBe('未录入');
    expect(rows[0].get('[data-test="ledger-received"]').text()).toBe('未录入');
    expect(rows[1].get('[data-test="ledger-date"]').text()).toBe('2026-10-02');
    for (const field of ['settlement', 'invoice', 'received']) {
      expect(rows[1].get(`[data-test="ledger-${field}"]`).text()).toBe('¥0.00');
    }
  });

  it('renders all Decimal strings exactly beyond safe integer precision', () => {
    const wrapper = mountTable({
      records: [
        settlement('large', {
          settlementAmount: '9999999999999999.99',
          invoiceAmount: '9007199254740993.01',
          receivedAmount: '9999999999999999.98',
        }),
      ],
    });
    expect(wrapper.get('[data-test="ledger-settlement"]').text()).toBe(
      '¥9,999,999,999,999,999.99',
    );
    expect(wrapper.get('[data-test="ledger-invoice"]').text()).toBe(
      '¥9,007,199,254,740,993.01',
    );
    expect(wrapper.get('[data-test="ledger-received"]').text()).toBe(
      '¥9,999,999,999,999,999.98',
    );
  });

  it('displays the supplied immutable correction without mutating the facts', async () => {
    const record = settlement('corrected', {
      version: 2,
      action: 'CORRECT',
      correctionReason: '凭据核对',
      settlementAmount: '123.45',
    });
    Object.freeze(record.currentVersion);
    Object.freeze(record);
    const wrapper = mountTable({ records: [record] });
    expect(wrapper.get('[data-test="ledger-settlement"]').text()).toBe(
      '¥123.45',
    );
    await wrapper.get('[data-test="ledger-open-record"]').trigger('click');
    expect(wrapper.emitted('openRecord')).toEqual([
      ['customer-1', 'corrected'],
    ]);
    expect(record.currentVersion.version).toBe(2);
    expect(record.currentVersion.settlementAmount).toBe('123.45');
  });

  it('hides facts and errors without read permission, including after revocation', async () => {
    const wrapper = mountTable();
    const previousButton = wrapper.get('[data-test="ledger-open-record"]');
    await wrapper.setProps({
      canRead: false,
      error: '敏感客户信息',
    });
    expect(wrapper.get('[data-test="ledger-forbidden"]').text()).toBe(
      '无权查看客户结算记录。',
    );
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('¥100.00');
    expect(wrapper.text()).not.toContain('敏感客户信息');
    await previousButton.trigger('click');
    expect(wrapper.emitted('openRecord')).toBeUndefined();
    const initiallyForbidden = mountTable({ canRead: false });
    expect(initiallyForbidden.find('table').exists()).toBe(false);
  });

  it.each([
    ['loading', { loading: true }, 'ledger-loading'],
    ['failure', { error: '结算记录加载失败，请稍后重试。' }, 'ledger-error'],
  ])(
    'hides old facts and blocks old actions during %s',
    async (_, state, test) => {
      const wrapper = mountTable();
      const previousButton = wrapper.get('[data-test="ledger-open-record"]');
      await wrapper.setProps(state);
      expect(wrapper.get(`[data-test="${test}"]`).attributes('role')).toBe(
        test === 'ledger-error' ? 'alert' : 'status',
      );
      expect(wrapper.find('table').exists()).toBe(false);
      expect(wrapper.find('[data-test="ledger-empty"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('¥100.00');
      await previousButton.trigger('click');
      expect(wrapper.emitted('openRecord')).toBeUndefined();
    },
  );

  it('shows an explicit empty state only after a successful empty read', () => {
    const wrapper = mountTable({ records: [] });
    expect(wrapper.get('[data-test="ledger-empty"]').text()).toBe(
      '暂无人工结算记录。',
    );
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('hides another customer and never emits an old record after switching customers', async () => {
    const record1 = settlement('record-1');
    const record2 = settlement('record-2', { customerId: 'customer-2' });
    const wrapper = mountTable({ records: [record1, record2] });
    expect(wrapper.findAll('[data-test="ledger-record"]')).toHaveLength(1);
    const previousButton = wrapper.get('[data-test="ledger-open-record"]');
    await wrapper.setProps({ customerId: 'customer-2', records: [record1] });
    expect(wrapper.find('table').exists()).toBe(false);
    await previousButton.trigger('click');
    expect(wrapper.emitted('openRecord')).toBeUndefined();
    await wrapper.setProps({ records: [record1, record2] });
    expect(wrapper.findAll('[data-test="ledger-record"]')).toHaveLength(1);
    await wrapper.get('[data-test="ledger-open-record"]').trigger('click');
    expect(wrapper.emitted('openRecord')).toEqual([['customer-2', 'record-2']]);
  });

  it('ignores an old detached action when the customer records are replaced', async () => {
    const wrapper = mountTable();
    const previousButton = wrapper.get('[data-test="ledger-open-record"]');
    await wrapper.setProps({ records: [settlement('replacement')] });
    await previousButton.trigger('click');
    expect(wrapper.emitted('openRecord')).toBeUndefined();
    await wrapper.get('[data-test="ledger-open-record"]').trigger('click');
    expect(wrapper.emitted('openRecord')).toEqual([
      ['customer-1', 'replacement'],
    ]);
  });
});
