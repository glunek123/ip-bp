import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import {
  createListWorkflowContext,
  type ListWorkflowContext,
} from './list-workflow-context';

const context: ListWorkflowContext = {
  recordId: 'record-1',
  actorKey: 'INTERNAL:user-1:dept-1:3',
  actionKey: 'approved-action',
  title: '填写资料',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('list workflow context', () => {
  it('cancels its GET on close and ignores a loader that does not respect abort', async () => {
    const pending = deferred<{ id: string }>();
    let signal: AbortSignal | undefined;
    const workflow = createListWorkflowContext((request) => {
      signal = request.signal;
      return pending.promise;
    });
    const loading = workflow.sync(context);
    expect(workflow.state.value.status).toBe('loading');
    expect(workflow.requestClose()).toBe(true);
    expect(signal?.aborted).toBe(true);
    pending.resolve({ id: context.recordId });
    await loading;
    expect(workflow.state.value.status).toBe('closed');
    expect(workflow.state.value.detail).toBeNull();
  });

  it('fetches fresh detail on every opening and rejects the wrong object', async () => {
    const load = vi.fn().mockResolvedValue({ id: 'wrong' });
    const workflow = createListWorkflowContext<{ id: string }>(load);
    await workflow.sync(context);
    expect(workflow.state.value.status).toBe('error');
    expect(workflow.state.value.session).toBeNull();
    load.mockResolvedValue({ id: context.recordId });
    await workflow.retry();
    expect(workflow.state.value.status).toBe('ready');
    workflow.requestClose();
    await workflow.sync(context);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404])(
    'renders inaccessible state for HTTP %s without detail',
    async (status) => {
      const workflow = createListWorkflowContext(async () => {
        throw new ApiError('inaccessible', status, 'DENIED');
      });
      await workflow.sync(context);
      expect(workflow.state.value.status).toBe('denied');
      expect(workflow.state.value.detail).toBeNull();
    },
  );

  it('exposes a retryable loading failure without converting it to success', async () => {
    const success = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ id: context.recordId });
    const workflow = createListWorkflowContext<{ id: string }>(load, {
      success,
    });
    await workflow.sync(context);
    expect(workflow.state.value.status).toBe('error');
    await workflow.retry();
    expect(workflow.state.value.status).toBe('ready');
    expect(success).not.toHaveBeenCalled();
  });

  it.each([
    { recordId: 'record-2' },
    { actorKey: 'INTERNAL:user-2:dept-1:3' },
    { actorKey: 'INTERNAL:user-1:dept-1:4' },
    { actionKey: 'other-action' },
  ])(
    'discards a late GET after controlled context changes: %j',
    async (change) => {
      const first = deferred<{ id: string }>();
      const load = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockImplementation(async (request) => ({
          id: request.context.recordId,
        }));
      const workflow = createListWorkflowContext<{ id: string }>(load);
      const loading = workflow.sync(context);
      const next = { ...context, ...change };
      await workflow.sync(next);
      const generation = workflow.state.value.generation;
      first.resolve({ id: context.recordId });
      await loading;
      expect(workflow.state.value.context).toEqual(next);
      expect(workflow.state.value.generation).toBe(generation);
      expect(workflow.state.value.detail?.id).toBe(next.recordId);
    },
  );

  it('synchronously guards double submit and emits success/close exactly once', async () => {
    const success = vi.fn();
    const closed = vi.fn();
    const workflow = createListWorkflowContext(
      async () => ({ id: context.recordId }),
      { success, closed },
    );
    await workflow.sync(context);
    const session = workflow.state.value.session!;
    expect(session.beginSubmit()).toBe(true);
    expect(session.beginSubmit()).toBe(false);
    expect(workflow.requestClose()).toBe(false);
    expect(session.endSubmit('success')).toBe(true);
    expect(session.endSubmit('success')).toBe(false);
    expect(success).toHaveBeenCalledExactlyOnceWith({
      context,
      generation: session.generation,
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(session.isCurrent()).toBe(false);
  });

  it('keeps the unknown panel and module-owned body/key, admits only explicit recovery', async () => {
    const frozen = Object.freeze({
      idempotencyKey: 'original',
      expectedVersion: 2,
      field: 'original input',
    });
    const command = vi
      .fn()
      .mockRejectedValueOnce(new Error('unknown'))
      .mockResolvedValueOnce({ id: 'ok' });
    const workflow = createListWorkflowContext(async () => ({
      id: context.recordId,
    }));
    await workflow.sync(context);
    const session = workflow.state.value.session!;
    if (session.beginSubmit()) {
      try {
        await command(frozen);
      } catch {
        session.endSubmit('unknown');
      }
    }
    expect(workflow.requestClose()).toBe(false);
    expect(workflow.canLeave()).toBe(false);
    expect(session.beginSubmit()).toBe(false);
    await workflow.retry();
    expect(workflow.state.value.session).toBe(session);
    if (session.beginSubmit({ recovery: true })) {
      await command(frozen);
      session.endSubmit('success');
    }
    expect(command.mock.calls).toEqual([[frozen], [frozen]]);
    expect(command.mock.calls[1]?.[0]).toBe(frozen);
  });

  it.each(['submitting', 'unknown'] as const)(
    'forced changes invalidate %s rather than blocking another context',
    async (requestState) => {
      const success = vi.fn();
      const invalidated = vi.fn();
      const workflow = createListWorkflowContext(
        async ({ context: item }) => ({ id: item.recordId }),
        { success, invalidated },
      );
      await workflow.sync(context);
      const old = workflow.state.value.session!;
      old.beginSubmit();
      if (requestState === 'unknown') old.endSubmit('unknown');
      const next = {
        ...context,
        actorKey: 'INTERNAL:other:dept-2:1',
        recordId: 'record-2',
      };
      const opening = workflow.sync(next);
      expect(old.isCurrent()).toBe(false);
      expect(workflow.state.value.detail).toBeNull();
      expect(old.endSubmit('success')).toBe(false);
      await opening;
      expect(workflow.state.value.context).toEqual(next);
      expect(invalidated).toHaveBeenCalledWith({
        context,
        generation: old.generation,
        requestState,
      });
      expect(success).not.toHaveBeenCalled();
    },
  );

  it('restores unknown from module storage and clears sensitive content when revoked or disposed', async () => {
    const workflow = createListWorkflowContext(async () => ({
      id: context.recordId,
      private: 'detail',
    }));
    await workflow.sync(context);
    const session = workflow.state.value.session!;
    expect(session.beginSubmit({ recovery: true })).toBe(false);
    expect(session.restoreUnknown()).toBe(true);
    expect(session.restoreUnknown()).toBe(false);
    session.deny();
    expect(session.isCurrent()).toBe(false);
    expect(workflow.state.value.status).toBe('denied');
    expect(workflow.state.value.detail).toBeNull();
    await workflow.retry();
    const renewed = workflow.state.value.session!;
    workflow.dispose();
    expect(renewed.isCurrent()).toBe(false);
    expect(workflow.state.value.detail).toBeNull();
  });

  it('returns to idle after a known failed command and invalidates on externally forced close', async () => {
    const workflow = createListWorkflowContext(async () => ({
      id: context.recordId,
    }));
    await workflow.sync(context);
    const session = workflow.state.value.session!;
    session.beginSubmit();
    session.endSubmit('failed');
    expect(workflow.canLeave()).toBe(true);
    session.beginSubmit();
    await workflow.sync(null);
    expect(workflow.state.value.status).toBe('closed');
    expect(session.endSubmit('success')).toBe(false);
  });
});
