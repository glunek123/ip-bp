import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Panel from './CaseSettlementActualPanel.vue';
import Form from './CaseSettlementActualForm.vue';
import { ApiError } from '../../api/http';
import {
  createListWorkflowContext,
  type ListWorkflowSession,
} from '../../app/list-workflow-context';
const register = vi.hoisted(() => vi.fn());
const sendCommand = vi.hoisted(() => vi.fn());
const readCandidates = vi.hoisted(() => vi.fn());
vi.mock('../../api/settlement-actual-registration', () => ({
  registerCaseSettlementActual: register,
  sendSettlementActualCommand: sendCommand,
  settlementActualCandidates: readCandidates,
}));
const caseId = '10000000-0000-4000-8000-000000000001';
const otherCase = '20000000-0000-4000-8000-000000000002';
const lawyerId = '30000000-0000-4000-8000-000000000003';
let sequence = 0;
function panel(extra: Record<string, unknown> = {}) {
  return mount(Panel, {
    props: {
      actorKey: `actual-actor-${++sequence}`,
      caseId,
      actualRegistrationLawyers: [{ id: lawyerId, fullName: '真实律师' }],
      ...extra,
    },
  });
}
const result = {
  id: otherCase,
  amount: '1.01',
  allocatedAmount: '1.01',
  allocationId: lawyerId,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
async function fill(wrapper: ReturnType<typeof panel>, side = 'CUSTOMER') {
  await wrapper.get('[data-test="side"]').setValue(side);
  await wrapper.get('[data-test="occurred-on"]').setValue('2020-01-02');
  await wrapper.get('[data-test="actual-amount"]').setValue('1.01');
}
async function submit(wrapper: ReturnType<typeof panel>) {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}
beforeEach(() => {
  register.mockReset();
  sendCommand.mockReset();
  sendCommand.mockImplementation((command) => register(command.input));
  readCandidates.mockReset();
  readCandidates.mockResolvedValue([]);
  register.mockResolvedValue(result);
});
describe('independent actual registration panel', () => {
  it.each([false, true])(
    'retains a confirmed receipt when completion is refused (restored=%s)',
    async (restored) => {
      const actorKey = `refused-actual-${restored}-${++sequence}`;
      const workflow = createListWorkflowContext(async () => ({ id: caseId }));
      const context = {
        recordId: caseId,
        actorKey,
        actionKey: 'settlement-update',
        title: '结算更新',
      };
      await workflow.sync(context);
      let liveSession = workflow.state.value.session!;
      const rejectingSession = {
        ...liveSession,
        endSubmit: vi.fn(() => {
          workflow.dispose();
          return false;
        }),
      };
      const response = deferred<typeof result>();
      register.mockReturnValueOnce(response.promise);
      let wrapper = panel({
        actorKey,
        session: restored ? liveSession : rejectingSession,
      });
      await fill(wrapper);
      await submit(wrapper);
      if (restored) {
        wrapper.unmount();
        workflow.dispose();
        response.resolve(result);
        await flushPromises();
        await workflow.sync(context);
        liveSession = workflow.state.value.session!;
        wrapper = panel({
          actorKey,
          session: {
            ...liveSession,
            endSubmit: vi.fn(
              (outcome: Parameters<ListWorkflowSession['endSubmit']>[0]) => {
                if (outcome === 'completed') {
                  workflow.dispose();
                  return false;
                }
                return liveSession.endSubmit(outcome);
              },
            ),
          },
        });
        await flushPromises();
      } else {
        response.resolve(result);
        await flushPromises();
      }
      expect(wrapper.emitted('registered')).toBeUndefined();
      wrapper.unmount();
      await workflow.sync(context);
      wrapper = panel({ actorKey, session: workflow.state.value.session! });
      await flushPromises();
      expect(wrapper.emitted('registered')).toEqual([[result]]);
      expect(workflow.state.value.status).toBe('ready');
      expect(workflow.state.value.requestState).toBe('idle');
      expect(register).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );
  it('retains a receipt when completion synchronously invalidates the old context despite returning true', async () => {
    const actorKey = `invalidated-actual-${++sequence}`;
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    const context = {
      recordId: caseId,
      actorKey,
      actionKey: 'settlement-update',
      title: '结算更新',
    };
    await workflow.sync(context);
    const originalSession = workflow.state.value.session!;
    const wrapper = panel({
      actorKey,
      session: {
        ...originalSession,
        endSubmit: vi.fn(() => {
          workflow.dispose();
          return true;
        }),
      },
    });
    await fill(wrapper);
    await submit(wrapper);
    expect(wrapper.emitted('registered')).toBeUndefined();
    wrapper.unmount();
    await workflow.sync(context);
    const recovered = panel({
      actorKey,
      session: workflow.state.value.session!,
    });
    await flushPromises();
    expect(recovered.emitted('registered')).toEqual([[result]]);
    expect(register).toHaveBeenCalledTimes(1);
    recovered.unmount();
  });
  it('delivers an in-flight predecessor receipt once after remount without closing the session', async () => {
    const actorKey = `inflight-${++sequence}`;
    const response = deferred<typeof result>();
    register.mockReturnValueOnce(response.promise);
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    await workflow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'settlement-update',
      title: '结算更新',
    });
    const session = workflow.state.value.session!;
    const first = panel({ actorKey, session });
    await fill(first);
    await submit(first);
    first.unmount();
    const second = panel({ actorKey, session });
    expect(workflow.state.value.requestState).toBe('unknown');
    response.resolve(result);
    await flushPromises();
    expect(first.emitted('registered')).toBeUndefined();
    expect(second.emitted('registered')).toEqual([[result]]);
    expect(workflow.state.value.requestState).toBe('idle');
    expect(workflow.state.value.status).toBe('ready');
    expect(register).toHaveBeenCalledTimes(1);
    second.unmount();
  });
  it('keeps an uncertain lawyer request frozen when current assignments change', async () => {
    register.mockRejectedValueOnce(
      new ApiError('invalid receipt', 200, 'INVALID_RESPONSE'),
    );
    const wrapper = panel();
    await wrapper.get('[data-test="lawyer"]').setValue(lawyerId);
    await fill(wrapper, 'LAWYER');
    await submit(wrapper);
    const original = register.mock.calls[0][0];
    await wrapper.setProps({ actualRegistrationLawyers: [] });
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(register.mock.calls[1][0]).toBe(original);
    expect(original.lawyerId).toBe(lawyerId);
    expect(wrapper.emitted('registered')).toHaveLength(1);
    wrapper.unmount();
  });
  it('keeps a replay rejection unknown rather than silently starting a new financial fact', async () => {
    register.mockRejectedValueOnce(
      new ApiError('uncertain', 503, 'UNAVAILABLE'),
    );
    register.mockRejectedValueOnce(new ApiError('revoked', 403, 'FORBIDDEN'));
    const wrapper = panel();
    await fill(wrapper);
    await submit(wrapper);
    const original = register.mock.calls[0][0];
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(register.mock.calls[1][0]).toBe(original);
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.emitted('registered')).toBeUndefined();
    wrapper.unmount();
  });
  it('allows correction after a definitive first-request refusal', async () => {
    register.mockRejectedValueOnce(
      new ApiError('invalid', 400, 'VALIDATION_ERROR'),
    );
    const wrapper = panel();
    await fill(wrapper);
    await submit(wrapper);
    const firstKey = register.mock.calls[0][0].idempotencyKey;
    expect(wrapper.find('form').exists()).toBe(true);
    await fill(wrapper);
    await submit(wrapper);
    expect(register.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
    expect(wrapper.emitted('registered')).toHaveLength(1);
    wrapper.unmount();
  });
  it('requires explicit current lawyer selection and preserves its real profile ID', async () => {
    const wrapper = panel();
    await fill(wrapper, 'LAWYER');
    expect(
      wrapper.get('[data-test="submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="lawyer"]').setValue(lawyerId);
    await submit(wrapper);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId,
        side: 'LAWYER',
        lawyerId,
        amount: '1.01',
        occurredOn: '2020-01-02',
      }),
    );
    expect(wrapper.emitted('registered')).toEqual([[result]]);
    wrapper.unmount();
  });
  it('registers customer receipts without lawyers and uses a separate key for each payment', async () => {
    const wrapper = panel({ actualRegistrationLawyers: [] });
    await fill(wrapper);
    await submit(wrapper);
    await fill(wrapper);
    await submit(wrapper);
    expect(register).toHaveBeenCalledTimes(2);
    const first = register.mock.calls[0][0];
    const second = register.mock.calls[1][0];
    expect(first).not.toHaveProperty('lawyerId');
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(Object.isFrozen(first)).toBe(true);
    expect(wrapper.emitted('registered')).toHaveLength(2);
    wrapper.unmount();
  });
  it('blocks double submission and retries only the frozen unknown request after remount', async () => {
    register.mockRejectedValueOnce(new ApiError('offline', 0, 'NETWORK_ERROR'));
    const actorKey = `recovery-${++sequence}`;
    const wrapper = panel({ actorKey });
    await fill(wrapper);
    const form = wrapper.getComponent(Form);
    const input = {
      caseId,
      side: 'CUSTOMER',
      amount: '1.01',
      occurredOn: '2020-01-02',
      idempotencyKey: form.props('idempotencyKey'),
    };
    form.vm.$emit('submit', input);
    form.vm.$emit('submit', input);
    await flushPromises();
    expect(register).toHaveBeenCalledTimes(1);
    const frozen = register.mock.calls[0][0];
    wrapper.unmount();
    const restored = panel({ actorKey });
    expect(restored.find('form').exists()).toBe(false);
    await restored.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(register.mock.calls[1][0]).toBe(frozen);
    expect(restored.emitted('registered')).toHaveLength(1);
    restored.unmount();
  });
  it.each([{ caseId: otherCase }, { actorKey: 'different-principal' }])(
    'isolates late receipts across context switches %o',
    async (change) => {
      const response = deferred<typeof result>();
      register.mockReturnValueOnce(response.promise);
      const wrapper = panel();
      await fill(wrapper);
      await submit(wrapper);
      await wrapper.setProps(change);
      response.resolve(result);
      await flushPromises();
      expect(wrapper.emitted('registered')).toBeUndefined();
      expect(wrapper.find('[data-test="retry"]').exists()).toBe(false);
      expect(wrapper.get('[data-test="actual-amount"]').element).toHaveProperty(
        'value',
        '',
      );
      wrapper.unmount();
    },
  );
  it('releases only the independent command lock and keeps the outer workflow open for multiple payments', async () => {
    const actorKey = `session-${++sequence}`;
    const success = vi.fn();
    const closed = vi.fn();
    const workflow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
      closed,
    });
    await workflow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'settlement-update',
      title: '结算更新',
    });
    const wrapper = panel({ actorKey, session: workflow.state.value.session! });
    await fill(wrapper);
    await submit(wrapper);
    expect(workflow.state.value.status).toBe('ready');
    expect(workflow.state.value.requestState).toBe('idle');
    expect(success).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    await fill(wrapper);
    await submit(wrapper);
    expect(wrapper.emitted('registered')).toHaveLength(2);
    wrapper.unmount();
  });
  it('does not submit while the outer workflow is busy', async () => {
    const actorKey = `busy-${++sequence}`;
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    await workflow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'settlement-update',
      title: '结算更新',
    });
    const session = workflow.state.value.session!;
    session.beginSubmit();
    const wrapper = panel({ actorKey, session });
    await fill(wrapper);
    await submit(wrapper);
    expect(register).not.toHaveBeenCalled();
    expect(wrapper.find('form').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('actual amount allocation modes', () => {
  it('records the total without silently allocating in a second command', async () => {
    const wrapper = panel();
    await wrapper.get('[data-test="mode"]').setValue('create');
    await fill(wrapper);
    await submit(wrapper);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand.mock.calls[0][0].kind).toBe('create');
  });
  it('selects an authorized fact and freezes the allocation command for retry', async () => {
    readCandidates.mockResolvedValue([
      {
        id: otherCase,
        side: 'CUSTOMER',
        amount: '200.00',
        remainingAmount: '100.00',
        occurredOn: '2020-01-02',
        sourceReference: '交易200',
      },
    ]);
    sendCommand
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({
        id: lawyerId,
        factId: otherCase,
        caseId,
        amount: '100.00',
      });
    const actorKey = `allocation-recovery-${++sequence}`;
    let wrapper = panel({ actorKey });
    await wrapper.get('[data-test="mode"]').setValue('allocate');
    await flushPromises();
    await wrapper.get('[data-test="fact"]').setValue(otherCase);
    await wrapper.get('[data-test="allocation-amount"]').setValue('100');
    await wrapper.get('[data-test="allocate"]').trigger('click');
    await flushPromises();
    const frozen = sendCommand.mock.calls[0][0];
    expect(frozen).toEqual({
      kind: 'allocate',
      input: {
        factId: otherCase,
        caseId,
        amount: '100',
        idempotencyKey: expect.any(String),
      },
    });
    expect(wrapper.find('[data-test="mode"]').exists()).toBe(false);
    wrapper.unmount();
    wrapper = panel({ actorKey });
    await flushPromises();
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(sendCommand.mock.calls[1][0]).toBe(frozen);
    expect(register).not.toHaveBeenCalled();
  });
  it('does not accept an old candidate response after case identity changes', async () => {
    const response = deferred<unknown[]>();
    readCandidates.mockReturnValueOnce(response.promise);
    const wrapper = panel();
    await wrapper.get('[data-test="mode"]').setValue('allocate');
    await wrapper.setProps({ caseId: otherCase });
    response.resolve([
      {
        id: caseId,
        side: 'CUSTOMER',
        amount: '200.00',
        remainingAmount: '200.00',
        occurredOn: '2020-01-02',
        sourceReference: null,
      },
    ]);
    await flushPromises();
    await wrapper.get('[data-test="mode"]').setValue('allocate');
    await flushPromises();
    expect(wrapper.find('[data-test="fact"]').text()).not.toContain('200.00');
  });
});
