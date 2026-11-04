import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import { readLawyerAssignmentBatch } from './case-lawyer-assignment-batch-recovery';
import CaseLawyerAssignmentBatchPanel from './CaseLawyerAssignmentBatchPanel.vue';
const api = vi.hoisted(() => ({
  getLawyerAssignmentCapability: vi.fn(),
  assignCaseLawyer: vi.fn(),
  listLawyerMatchCandidates: vi.fn(),
  notifyWorkflowChanged: vi.fn(),
}));
vi.mock('../../api/case-lawyer-assignment', async (original) => ({
  ...(await original<typeof import('../../api/case-lawyer-assignment')>()),
  getLawyerAssignmentCapability: api.getLawyerAssignmentCapability,
  assignCaseLawyer: api.assignCaseLawyer,
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  listLawyerMatchCandidates: api.listLawyerMatchCandidates,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: api.notifyWorkflowChanged,
}));
const caseId = '11111111-1111-4111-8111-111111111111';
const lawyerAccountId = '22222222-2222-4222-8222-222222222222';
const lawyerProfileId = '33333333-3333-4333-8333-333333333333';
const assignment = {
  id: '44444444-4444-4444-8444-444444444444',
  lawyerAccountId,
  lawyerProfileId,
  assignedAt: '2026-11-04T01:00:00Z',
};
const selectedCases = [
  { id: caseId, businessNo: 'A-1', stage: 'PENDING_MATCH', version: 1 },
] as CaseSummary[];
const actorKey = 'user-1:INTERNAL:department-1:1';
function panel() {
  return mount(CaseLawyerAssignmentBatchPanel, {
    props: { selectedCases, actorKey },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  globalThis.localStorage.clear();
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn((_name, _opts, callback) => callback({ name: 'lock' })),
    },
  });
  api.getLawyerAssignmentCapability.mockResolvedValue({
    canAssign: true,
    caseVersion: 1,
    currentAssignment: null,
  });
  api.listLawyerMatchCandidates.mockResolvedValue([
    {
      lawyerAccountId,
      lawyerProfileId,
      displayName: '张律师',
      username: 'zhang',
    },
  ]);
  api.assignCaseLawyer.mockImplementation(async (_id, input) => ({
    id: caseId,
    stage: 'PENDING_MATCH',
    version: 2,
    outcome: 'ASSIGNED',
    requestedLawyerAccountId: lawyerAccountId,
    previousAssignment: null,
    currentAssignment: assignment,
    input,
  }));
});
describe('CaseLawyerAssignmentBatchPanel', () => {
  it('does not let a late old lock callback release the new actor lock', async () => {
    let oldCallback: ((lock: { name: string }) => Promise<void>) | undefined;
    let newReleased = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn((name: string, _options, callback) => {
          if (name.endsWith('user-1:INTERNAL:department-1')) {
            oldCallback = callback;
            return Promise.resolve();
          }
          return callback({ name: 'new' }).then(() => {
            newReleased = true;
          });
        }),
      },
    });
    const wrapper = panel();
    await wrapper.setProps({ actorKey: 'user-2:INTERNAL:department-1:1' });
    await flushPromises();
    void oldCallback?.({ name: 'old' });
    await flushPromises();
    expect(newReleased).toBe(false);
    expect(wrapper.find('[data-test="assignment-preflight"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
    await flushPromises();
    expect(newReleased).toBe(true);
  });
  it('prechecks independent permission and persists body/key before submitting', async () => {
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="assignment-preflight"]').trigger('click');
    await flushPromises();
    expect(api.getLawyerAssignmentCapability).toHaveBeenCalledWith(caseId);
    await wrapper
      .get('[data-test="assignment-target"]')
      .setValue(lawyerAccountId);
    expect(wrapper.get('[data-test="assignment-preview"]').text()).toContain(
      '可分配',
    );
    await wrapper.get('[data-test="assignment-prepare"]').trigger('click');
    expect(api.assignCaseLawyer).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="assignment-results"]').text()).toContain(
      '待确认',
    );
    expect(
      wrapper.get('[data-test="assignment-results"]').text(),
    ).not.toContain('PREPARED');
    const saved = readLawyerAssignmentBatch('user-1:INTERNAL:department-1');
    expect(saved.state).toBe('valid');
    await wrapper.get('[data-test="assignment-confirm"]').trigger('click');
    await flushPromises();
    expect(api.assignCaseLawyer).toHaveBeenCalledWith(
      caseId,
      saved.state === 'valid' ? saved.batch.items[0]!.input : undefined,
    );
    expect(
      readLawyerAssignmentBatch('user-1:INTERNAL:department-1'),
    ).toMatchObject({
      state: 'valid',
      batch: { items: [{ state: 'ASSIGNED' }] },
    });
    expect(wrapper.text()).toContain('案件仍待匹配');
    expect(wrapper.get('[data-test="assignment-results"]').text()).toContain(
      '已成功',
    );
    expect(
      wrapper.get('[data-test="assignment-results"]').text(),
    ).not.toContain('ASSIGNED');
    expect(wrapper.get('[data-test="assignment-results"]').text()).toContain(
      '当前承办律师 张律师（zhang）',
    );
    expect(
      wrapper.get('[data-test="assignment-results"]').text(),
    ).not.toContain(lawyerAccountId);
    expect(wrapper.text()).toContain('办理结果见逐案列表');
    expect(wrapper.text()).not.toContain('批次已保存');
    wrapper.unmount();
  });
  it('shows a clear permission reason when the capability check is denied', async () => {
    api.getLawyerAssignmentCapability.mockRejectedValueOnce(
      new ApiError('internal service message', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="assignment-preflight"]').trigger('click');
    await flushPromises();
    const reason = wrapper.get(`[data-test="assignment-status-${caseId}"]`);
    expect(reason.text()).toContain('当前账号无此案的分配权限');
    expect(reason.text()).not.toContain('internal service message');
    wrapper.unmount();
  });
  it('distinguishes phase, relationship, and capability-read failures per case', async () => {
    const blockedReasons = [
      {
        capability: {
          canAssign: false,
          reason: 'INVALID_STATE',
          caseVersion: 1,
          currentAssignment: null,
        },
        expected: '当前案件阶段不支持律师分配',
      },
      {
        capability: {
          canAssign: false,
          reason: 'LAWYER_ASSIGNMENT_CONFLICT',
          caseVersion: 1,
          currentAssignment: null,
        },
        expected: '案件承办关系存在冲突',
      },
    ] as const;
    for (const { capability, expected } of blockedReasons) {
      api.getLawyerAssignmentCapability.mockResolvedValueOnce(capability);
      const wrapper = panel();
      await flushPromises();
      await wrapper.get('[data-test="assignment-preflight"]').trigger('click');
      await flushPromises();
      expect(
        wrapper.get(`[data-test="assignment-status-${caseId}"]`).text(),
      ).toContain(expected);
      wrapper.unmount();
    }

    api.getLawyerAssignmentCapability.mockRejectedValueOnce(
      new ApiError('internal service message', 0, 'NETWORK_ERROR'),
    );
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="assignment-preflight"]').trigger('click');
    await flushPromises();
    const reason = wrapper.get(`[data-test="assignment-status-${caseId}"]`);
    expect(reason.text()).toContain('权限读取超时或网络失败');
    expect(reason.text()).not.toContain('internal service message');
    wrapper.unmount();
  });
  it('keeps a 403 after sending as UNKNOWN and does not create a new key', async () => {
    api.assignCaseLawyer.mockRejectedValueOnce(
      new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="assignment-preflight"]').trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="assignment-target"]')
      .setValue(lawyerAccountId);
    await wrapper.get('[data-test="assignment-prepare"]').trigger('click');
    const before = readLawyerAssignmentBatch('user-1:INTERNAL:department-1');
    await wrapper.get('[data-test="assignment-confirm"]').trigger('click');
    await flushPromises();
    expect(
      readLawyerAssignmentBatch('user-1:INTERNAL:department-1'),
    ).toMatchObject({
      state: 'valid',
      batch: { items: [{ state: 'UNKNOWN' }] },
    });
    expect(wrapper.get('[data-test="assignment-results"]').text()).toContain(
      '待核对',
    );
    expect(
      wrapper.get('[data-test="assignment-results"]').text(),
    ).not.toContain('UNKNOWN');
    expect(wrapper.find('[data-test="assignment-prepare"]').exists()).toBe(
      false,
    );
    expect(
      before.state === 'valid' &&
        readLawyerAssignmentBatch('user-1:INTERNAL:department-1').state ===
          'valid',
    ).toBe(true);
    wrapper.unmount();
  });
  it('blocks a damaged actor recovery record before a new request', async () => {
    globalThis.localStorage.setItem(
      `case-lawyer-assignment-batch-v1:${encodeURIComponent('user-1:INTERNAL:department-1')}`,
      '{bad',
    );
    const wrapper = panel();
    await flushPromises();
    expect(wrapper.text()).toContain('恢复记录损坏');
    expect(api.getLawyerAssignmentCapability).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="assignment-prepare"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
});
