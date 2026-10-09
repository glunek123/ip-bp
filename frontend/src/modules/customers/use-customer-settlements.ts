import { computed, ref, watch, type Ref } from 'vue';
import {
  listCustomerSettlements,
  type CustomerSettlementPage,
} from '../../api/customer-settlements';

export type SettlementListStatus = 'idle' | 'loading' | 'ready' | 'failed';

export function useCustomerSettlements(
  customerId: Ref<string>,
  actorKey: Ref<string>,
  canRead: Ref<boolean>,
) {
  const data = ref<CustomerSettlementPage>();
  const status = ref<SettlementListStatus>('idle');
  const stale = ref(false);
  const error = ref('');
  const page = ref(1);
  const pageSize = 20;
  const kpis = computed(() => data.value?.stats);
  let generation = 0;
  let controller: AbortController | undefined;

  function clearPrivateState(): void {
    data.value = undefined;
    error.value = '';
  }

  function invalidate(): void {
    generation += 1;
    controller?.abort();
    controller = undefined;
    clearPrivateState();
    stale.value = true;
    status.value = 'failed';
    error.value = '结算资料需要只读刷新。';
  }

  async function refresh(nextPage = page.value): Promise<void> {
    if (!canRead.value || !customerId.value || !actorKey.value) return;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const requestGeneration = ++generation;
    const requestCustomer = customerId.value;
    const requestActor = actorKey.value;
    page.value = nextPage;
    status.value = 'loading';
    stale.value = false;
    error.value = '';
    try {
      const result = await listCustomerSettlements(
        requestCustomer,
        nextPage,
        pageSize,
        {
          signal: requestController.signal,
        },
      );
      if (
        requestController.signal.aborted ||
        requestGeneration !== generation ||
        requestCustomer !== customerId.value ||
        requestActor !== actorKey.value ||
        !canRead.value
      )
        return;
      data.value = result;
      status.value = 'ready';
    } catch {
      if (
        requestController.signal.aborted ||
        requestGeneration !== generation ||
        requestCustomer !== customerId.value ||
        requestActor !== actorKey.value ||
        !canRead.value
      )
        return;
      clearPrivateState();
      stale.value = true;
      status.value = 'failed';
      error.value = '结算资料读取失败。请只读重试。';
    } finally {
      if (requestGeneration === generation && controller === requestController)
        controller = undefined;
    }
  }

  function resetContext(): void {
    generation += 1;
    controller?.abort();
    controller = undefined;
    clearPrivateState();
    stale.value = false;
    page.value = 1;
    status.value = 'idle';
  }

  watch(customerId, resetContext, { flush: 'sync' });
  watch(actorKey, resetContext, { flush: 'sync' });
  watch(
    canRead,
    (read) => {
      resetContext();
      if (read) void refresh(1);
    },
    { immediate: true, flush: 'sync' },
  );

  return {
    data,
    kpis,
    page,
    pageSize,
    status,
    stale,
    error,
    refresh,
    setPage: (nextPage: number) => refresh(nextPage),
    invalidate,
    dispose: () => {
      generation += 1;
      controller?.abort();
      controller = undefined;
      clearPrivateState();
    },
  };
}
