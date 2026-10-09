import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listCustomerSettlements: vi.fn() }));
vi.mock('../../api/customer-settlements', () => api);

import { useCustomerSettlements } from './use-customer-settlements';

const page = (customerId: string, requestedPage = 1) => ({
  items: [],
  total: 0,
  page: requestedPage,
  pageSize: 20,
  stats: {
    recordCount: 0,
    totalSettlement: '0.00',
    invoiceKnownSubtotal: '0.00',
    invoiceUnknownCount: 0,
    receivedKnownSubtotal: '0.00',
    receivedUnknownCount: 0,
    pendingAmount: '0.00',
    recoveryRate: null,
  },
  capabilities: { read: true, register: true, correct: true },
  customerVersion: 1,
});

beforeEach(() => vi.resetAllMocks());

describe('useCustomerSettlements single list owner', () => {
  it('issues one authorized initial list request and refreshes through the same owner', async () => {
    api.listCustomerSettlements.mockResolvedValue(page('customer-1'));
    const customerId = ref('customer-1');
    const actorKey = ref('user-1:department-1:1');
    const canRead = ref(true);
    const owner = useCustomerSettlements(customerId, actorKey, canRead);
    await flushPromises();
    expect(api.listCustomerSettlements).toHaveBeenCalledTimes(1);
    await owner.refresh();
    expect(api.listCustomerSettlements).toHaveBeenCalledTimes(2);
    expect(owner.data.value?.stats.totalSettlement).toBe('0.00');
  });

  it('makes no list request for register-only and clears data immediately when read is lost', async () => {
    api.listCustomerSettlements.mockResolvedValue(page('customer-1'));
    const canRead = ref(false);
    const owner = useCustomerSettlements(
      ref('customer-1'),
      ref('actor-1'),
      canRead,
    );
    await flushPromises();
    expect(api.listCustomerSettlements).not.toHaveBeenCalled();
    canRead.value = true;
    await flushPromises();
    expect(owner.data.value).toBeDefined();
    canRead.value = false;
    expect(owner.data.value).toBeUndefined();
  });

  it('aborts and ignores a late response after the customer or actor generation changes', async () => {
    let resolveFirst!: (value: ReturnType<typeof page>) => void;
    api.listCustomerSettlements
      .mockImplementationOnce(
        (
          _id: string,
          _page: number,
          _size: number,
          options: { signal: AbortSignal },
        ) => {
          expect(options.signal).toBeDefined();
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        },
      )
      .mockResolvedValueOnce(page('customer-2'));
    const customerId = ref('customer-1');
    const actorKey = ref('user-1:department-1:1');
    const canRead = ref(true);
    const owner = useCustomerSettlements(customerId, actorKey, canRead);
    await flushPromises();
    canRead.value = false;
    customerId.value = 'customer-2';
    canRead.value = true;
    await flushPromises();
    resolveFirst(page('customer-1'));
    await flushPromises();
    expect(owner.data.value?.items).toEqual([]);
    expect(api.listCustomerSettlements).toHaveBeenCalledTimes(2);
    canRead.value = false;
    actorKey.value = 'user-1:department-1:2';
    canRead.value = true;
    await flushPromises();
    expect(api.listCustomerSettlements).toHaveBeenCalledTimes(3);
  });

  it('shows a failed state with no zero fallback and allows a read-only retry', async () => {
    api.listCustomerSettlements
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page('customer-1'));
    const owner = useCustomerSettlements(
      ref('customer-1'),
      ref('actor-1'),
      ref(true),
    );
    await flushPromises();
    expect(owner.status.value).toBe('failed');
    expect(owner.data.value).toBeUndefined();
    await owner.refresh();
    expect(owner.status.value).toBe('ready');
  });

  it('invalidates private history failures without creating another list source', async () => {
    api.listCustomerSettlements.mockResolvedValue(page('customer-1'));
    const owner = useCustomerSettlements(
      ref('customer-1'),
      ref('actor-1'),
      ref(true),
    );
    await flushPromises();
    owner.invalidate();
    expect(owner.data.value).toBeUndefined();
    expect(owner.stale.value).toBe(true);
    expect(api.listCustomerSettlements).toHaveBeenCalledTimes(1);
    expect(computed(() => owner.kpis.value?.recordCount).value).toBeUndefined();
  });
});
