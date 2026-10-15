import { computed, shallowRef } from 'vue';
import { ApiError } from '../api/http';

export type ListWorkflowContext = Readonly<{
  recordId: string;
  /** Include principal, user, department/scope and authorization revision. */
  actorKey: string;
  actionKey: string;
  title: string;
}>;
export type ListWorkflowRequestState = 'idle' | 'submitting' | 'unknown';
export type ListWorkflowReceipt = Readonly<{
  context: ListWorkflowContext;
  generation: number;
}>;
export type ListWorkflowLoad = ListWorkflowReceipt & { signal: AbortSignal };
export type ListWorkflowSession = ListWorkflowReceipt & {
  contextKey: string;
  isCurrent: () => boolean;
  /** Recovery admits ONLY the module's original frozen body/key, never a new command. */
  beginSubmit: (options?: { recovery?: boolean }) => boolean;
  endSubmit: (outcome: 'failed' | 'unknown' | 'success') => boolean;
  /** Register a module-owned pending request restored before mounting this panel. */
  restoreUnknown: () => boolean;
  deny: () => void;
};
export type ListWorkflowState<T> = {
  status: 'closed' | 'loading' | 'ready' | 'error' | 'denied';
  context: ListWorkflowContext | null;
  generation: number;
  detail: T | null;
  session: ListWorkflowSession | null;
  error: unknown;
  requestState: ListWorkflowRequestState;
};

/** Owns GET cancellation only. Modules own POST, its frozen body/key and pending storage. */
export function createListWorkflowContext<T extends { id: string }>(
  loadDetail: (request: ListWorkflowLoad) => Promise<T>,
  events: {
    success?: (receipt: ListWorkflowReceipt) => void;
    closed?: (receipt: ListWorkflowReceipt) => void;
    invalidated?: (
      receipt: ListWorkflowReceipt & {
        requestState: ListWorkflowRequestState;
      },
    ) => void;
    blocked?: (state: ListWorkflowRequestState) => void;
  } = {},
) {
  let generation = 0;
  let controller: AbortController | null = null;
  const empty = (): ListWorkflowState<T> => ({
    status: 'closed',
    context: null,
    generation,
    detail: null,
    session: null,
    error: null,
    requestState: 'idle',
  });
  const state = shallowRef<ListWorkflowState<T>>(empty());

  function invalidate() {
    const previous = state.value;
    generation += 1;
    controller?.abort();
    controller = null;
    state.value = empty();
    if (previous.context)
      events.invalidated?.({
        context: previous.context,
        generation: previous.generation,
        requestState: previous.requestState,
      });
  }

  function canLeave() {
    return state.value.requestState === 'idle';
  }

  function requestClose() {
    if (!canLeave()) {
      events.blocked?.(state.value.requestState);
      return false;
    }
    const previous = state.value;
    invalidate();
    if (previous.context)
      events.closed?.({
        context: previous.context,
        generation: previous.generation,
      });
    return true;
  }

  /** Controlled props are authoritative, even while busy/unknown. Never retain old content. */
  async function sync(context: ListWorkflowContext | null): Promise<void> {
    invalidate();
    if (!context) return;
    const frozen = Object.freeze({ ...context });
    const receipt = Object.freeze({ context: frozen, generation });
    const current = () =>
      generation === receipt.generation && state.value.status !== 'closed';
    const session: ListWorkflowSession = Object.freeze({
      ...receipt,
      contextKey: JSON.stringify([
        frozen.actorKey,
        frozen.recordId,
        frozen.actionKey,
        generation,
      ]),
      isCurrent: current,
      beginSubmit(options?: { recovery?: boolean }) {
        if (!current() || state.value.status !== 'ready') return false;
        const expected = options?.recovery ? 'unknown' : 'idle';
        if (state.value.requestState !== expected) return false;
        state.value = { ...state.value, requestState: 'submitting' };
        return true;
      },
      endSubmit(outcome: 'failed' | 'unknown' | 'success') {
        if (!current() || state.value.requestState !== 'submitting')
          return false;
        if (outcome === 'success') {
          // Invalidate before notifying callers: reentrant/duplicate completions cannot succeed.
          invalidate();
          events.success?.(receipt);
          events.closed?.(receipt);
        } else {
          state.value = {
            ...state.value,
            requestState: outcome === 'unknown' ? 'unknown' : 'idle',
          };
        }
        return true;
      },
      restoreUnknown() {
        if (!current() || state.value.status !== 'ready' || !canLeave())
          return false;
        state.value = { ...state.value, requestState: 'unknown' };
        return true;
      },
      deny() {
        if (!current()) return;
        invalidate();
        state.value = { ...empty(), status: 'denied', context: frozen };
      },
    });
    controller = new AbortController();
    const signal = controller.signal;
    state.value = { ...empty(), status: 'loading', context: frozen };
    try {
      const detail = await loadDetail({ ...receipt, signal });
      if (!current()) return;
      if (detail.id !== frozen.recordId)
        throw new Error('Detail record does not match workflow context');
      state.value = { ...state.value, status: 'ready', detail, session };
    } catch (error) {
      if (!current()) return;
      const denied =
        error instanceof ApiError && [401, 403, 404].includes(error.status);
      state.value = {
        ...state.value,
        status: denied ? 'denied' : 'error',
        error,
      };
    }
  }

  async function retry() {
    if (!canLeave()) {
      events.blocked?.(state.value.requestState);
      return;
    }
    if (state.value.context) await sync(state.value.context);
  }

  return {
    state: computed(() => state.value),
    sync,
    retry,
    requestClose,
    canLeave,
    dispose: invalidate,
  };
}
