import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CaseHandlingGroupAttempt,
  CaseHandlingGroupDetail,
  CaseHandlingGroupCommandOutcome,
  SubmitCaseHandlingGroupAttempt,
} from '../../api/case-handling-groups';
import CaseHandlingGroupDetailPanel from './CaseHandlingGroupDetailPanel.vue';
const actorKey = 'actor:INTERNAL:dept';
const id = '55555555-5555-4555-8555-555555555555';
const detail: CaseHandlingGroupDetail = {
  id,
  revision: 1,
  status: 'ACTIVE',
  createdAt: '2026-10-20T00:00:00.000Z',
  canDissolve: true,
  members: [
    {
      caseId: '33333333-3333-4333-8333-333333333333',
      businessNo: 'CA-合成001',
      customerId: 'customer',
      customerName: '合成客户',
      stage: 'WAITING_ARCHIVE',
    },
  ],
};
const submitAttempt = vi.fn<SubmitCaseHandlingGroupAttempt>();
const wrappers: ReturnType<typeof mount>[] = [];
function panel(
  value = detail,
  pending?: Extract<CaseHandlingGroupAttempt, { kind: 'DISSOLVE' }>,
) {
  const wrapper = mount(CaseHandlingGroupDetailPanel, {
    props: {
      detail: value,
      actorKey,
      contextKey: 'session1:route1',
      pending,
      submitAttempt,
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
describe('handling group detail panel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    submitAttempt.mockResolvedValue({
      kind: 'unknown',
      message: '403或结果待核对，原请求保留',
    });
  });
  afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
  it('shows only supplied readable source cases and requires explicit dissolution confirmation', async () => {
    const wrapper = panel();
    expect(wrapper.text()).toContain('CA-合成001');
    expect(wrapper.text()).toContain('材料和费用归属');
    await wrapper.get('[data-test="close-group-detail"]').trigger('click');
    expect(submitAttempt).not.toHaveBeenCalled();
    await wrapper.get('[data-test="confirm-dissolve-group"]').setValue(true);
    await wrapper.get('[data-test="dissolve-group"]').trigger('click');
    await flushPromises();
    expect(submitAttempt).toHaveBeenCalledExactlyOnceWith(
      {
        kind: 'DISSOLVE',
        actorKey,
        groupId: id,
        input: { expectedRevision: 1, idempotencyKey: expect.any(String) },
      },
      expect.objectContaining({ actorKey, contextKey: 'session1:route1' }),
    );
  });
  it('does not offer a new dissolve command without current capability', () => {
    const wrapper = panel({ ...detail, canDissolve: false });
    expect(wrapper.find('[data-test="dissolve-group"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('隐藏');
  });
  it('allows the exact pending dissolve after an earlier successful commit is already visible', async () => {
    const pending = {
      kind: 'DISSOLVE' as const,
      actorKey,
      groupId: id,
      input: { expectedRevision: 1, idempotencyKey: 'original-key' },
    };
    const wrapper = panel(
      { ...detail, status: 'DISSOLVED', revision: 2, canDissolve: false },
      pending,
    );
    await wrapper.get('[data-test="confirm-dissolve-group"]').setValue(true);
    await wrapper.get('[data-test="dissolve-group"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="dissolve-group"]').trigger('click');
    await flushPromises();
    expect(submitAttempt.mock.calls.map(([attempt]) => attempt)).toEqual([
      pending,
      pending,
    ]);
  });
  it('does not disclose old source members or emit a late result after identity/context changes', async () => {
    let resolve!: (outcome: CaseHandlingGroupCommandOutcome) => void;
    submitAttempt.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = panel();
    await wrapper.get('[data-test="confirm-dissolve-group"]').setValue(true);
    await wrapper.get('[data-test="dissolve-group"]').trigger('click');
    await wrapper.get('[data-test="dissolve-group"]').trigger('click');
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    const signal = submitAttempt.mock.calls[0]![1].signal;
    await wrapper.setProps({ contextKey: 'revision2:route?unknown=1' });
    expect(signal.aborted).toBe(true);
    resolve({
      kind: 'confirmed',
      result: {
        id,
        revision: 2,
        status: 'DISSOLVED',
        recordedAt: '2026-10-20T00:00:00.000Z',
      },
    });
    await flushPromises();
    expect(wrapper.emitted('confirmed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('合成客户');
  });
});
