import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CaseHandlingGroupAttempt,
  CaseHandlingGroupCommandOutcome,
  CaseHandlingGroupMember,
  PrepareCaseHandlingGroupSelection,
  SubmitCaseHandlingGroupAttempt,
} from '../../api/case-handling-groups';
import CaseHandlingGroupCreatePanel from './CaseHandlingGroupCreatePanel.vue';
const first = '33333333-3333-4333-8333-333333333333';
const second = '44444444-4444-4444-8444-444444444444';
const groupId = '55555555-5555-4555-8555-555555555555';
const actorKey = 'actor:INTERNAL:dept';
const members: CaseHandlingGroupMember[] = [
  {
    caseId: first,
    businessNo: 'CA-合成001',
    customerId: 'customer',
    customerName: '合成客户',
    stage: 'WAITING_ARCHIVE',
  },
  {
    caseId: second,
    businessNo: 'CA-合成002',
    customerId: 'customer',
    customerName: '合成客户',
    stage: 'WAITING_COMPLAINT',
  },
];
const prepareSelection = vi.fn<PrepareCaseHandlingGroupSelection>();
const submitAttempt = vi.fn<SubmitCaseHandlingGroupAttempt>();
const wrappers: ReturnType<typeof mount>[] = [];
function panel(
  pending?: Extract<CaseHandlingGroupAttempt, { kind: 'CREATE' }>,
  candidates = members,
) {
  const wrapper = mount(CaseHandlingGroupCreatePanel, {
    props: {
      candidates,
      actorKey,
      contextKey: 'session1:route1',
      pending,
      prepareSelection,
      submitAttempt,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function prepare(wrapper: ReturnType<typeof mount>) {
  for (const member of members)
    await wrapper
      .get(`[data-test="select-group-case-${member.caseId}"]`)
      .setValue(true);
  await wrapper.get('[data-test="prepare-group"]').trigger('click');
  await flushPromises();
}
describe('handling group create panel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prepareSelection.mockResolvedValue({
      allowed: true,
      members: structuredClone(members),
    });
    submitAttempt.mockResolvedValue({ kind: 'unknown', message: '原请求保留' });
  });
  afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
  it('cancels without issuing a command or auto-selecting cases', async () => {
    const wrapper = panel();
    expect(wrapper.get('h2').text()).toBe('建立案件系列');
    expect(wrapper.findAll('input:checked')).toHaveLength(0);
    await wrapper.get('[data-test="close-create-group"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(submitAttempt).not.toHaveBeenCalled();
    expect(prepareSelection).not.toHaveBeenCalled();
  });
  it('freshly prepares explicitly selected same-customer cases across different stages', async () => {
    const wrapper = panel();
    await prepare(wrapper);
    expect(prepareSelection).toHaveBeenCalledExactlyOnceWith([first, second], {
      signal: expect.any(AbortSignal),
    });
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(submitAttempt).toHaveBeenCalledExactlyOnceWith(
      {
        kind: 'CREATE',
        actorKey,
        input: {
          groupId: expect.any(String),
          caseIds: [first, second],
          idempotencyKey: expect.any(String),
        },
      },
      {
        actorKey,
        contextKey: 'session1:route1',
        signal: expect.any(AbortSignal),
      },
    );
    expect(members.map((member) => member.stage)).toEqual([
      'WAITING_ARCHIVE',
      'WAITING_COMPLAINT',
    ]);
    expect(wrapper.text()).toContain('CA-合成001');
    expect(wrapper.text()).toContain('合成客户');
  });
  it.each(['cross customer', 'partial scope', 'no action'])(
    'blocks the whole selection on %s',
    async (kind) => {
      prepareSelection.mockResolvedValue({
        allowed: kind !== 'no action',
        members:
          kind === 'partial scope'
            ? [members[0]!]
            : members.map((member, index) => ({
                ...member,
                customerId:
                  kind === 'cross customer' && index === 1
                    ? 'other'
                    : member.customerId,
              })),
      });
      const wrapper = panel();
      await prepare(wrapper);
      expect(wrapper.find('[data-test="confirm-create-group"]').exists()).toBe(
        false,
      );
      expect(wrapper.get('[role="alert"]').text()).toContain('未提交');
      expect(submitAttempt).not.toHaveBeenCalled();
    },
  );
  it('retains the same full body and key through uncertainty and explicit retry', async () => {
    const wrapper = panel();
    await prepare(wrapper);
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    const original = structuredClone(submitAttempt.mock.calls[0]![0]);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(submitAttempt.mock.calls[1]![0]).toEqual(original);
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1);
  });
  it('emits confirmed only after the injected host confirms the same request', async () => {
    submitAttempt.mockImplementation(async (attempt) => ({
      kind: 'confirmed',
      result: {
        id: attempt.kind === 'CREATE' ? attempt.input.groupId : attempt.groupId,
        revision: 1,
        status: 'ACTIVE',
        recordedAt: '2026-10-20T00:00:00.000Z',
      },
    }));
    const wrapper = panel();
    await prepare(wrapper);
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('confirmed')?.[0]?.[1]).toEqual(
      submitAttempt.mock.calls[0]?.[0],
    );
  });
  it('replays a pending create without a new eligibility gate or exposing unread member IDs/counts', async () => {
    const pending = {
      kind: 'CREATE' as const,
      actorKey,
      input: {
        groupId,
        caseIds: [first, second],
        idempotencyKey: 'original-key',
      },
    };
    const wrapper = panel(pending, [members[0]!]);
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(submitAttempt.mock.calls[0]![0]).toEqual(pending);
    expect(prepareSelection).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain(second);
    expect(wrapper.text()).not.toContain('CA-合成002');
  });
  it('blocks duplicate clicks and ignores late success after full-route/session invalidation', async () => {
    let resolve!: (value: CaseHandlingGroupCommandOutcome) => void;
    submitAttempt.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = panel();
    await prepare(wrapper);
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    const signal = submitAttempt.mock.calls[0]![1].signal;
    await wrapper.setProps({
      contextKey: 'same-actor:new-session:route#changed',
    });
    expect(signal.aborted).toBe(true);
    resolve({
      kind: 'confirmed',
      result: {
        id: groupId,
        revision: 1,
        status: 'ACTIVE',
        recordedAt: '2026-10-20T00:00:00.000Z',
      },
    });
    await flushPromises();
    expect(wrapper.emitted('confirmed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('CA-合成001');
  });
  it('ignores a stale preparation after an authorization context change', async () => {
    let resolve!: (value: {
      allowed: boolean;
      members: CaseHandlingGroupMember[];
    }) => void;
    prepareSelection.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = panel();
    await prepare(wrapper);
    const signal = prepareSelection.mock.calls[0]![1].signal;
    await wrapper.setProps({
      actorKey: 'other:INTERNAL:dept',
      contextKey: 'revision2',
    });
    resolve({ allowed: true, members });
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    expect(wrapper.find('[data-test="confirm-create-group"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('合成客户');
  });
});
