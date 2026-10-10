import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDefendant, CaseJudgmentFact } from '../../api/cases';
import CaseJudgmentNextStepPanel from './CaseJudgmentNextStepPanel.vue';
import { ApiError } from '../../api/http';

const api = vi.hoisted(() => ({
  chooseCaseJudgmentNextStep: vi.fn(),
  revokeCaseJudgmentNextStep: vi.fn(),
}));
vi.mock('../../api/cases', () => api);
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

const caseId = '70000000-0000-4000-8000-000000000001';
const judgmentId = '70000000-0000-4000-8000-000000000002';
const judgment = {
  id: judgmentId,
  kind: 'REGISTER',
  priorFactId: null,
  judgmentReceivedAt: '2026-10-09',
  judgmentAmountState: 'KNOWN',
  judgmentAmount: '0.00',
  paidLitigationFeeState: 'KNOWN',
  paidLitigationFee: '0.00',
  fromVersion: 2,
  toVersion: 3,
  recordedAt: '2026-10-10T03:00:00Z',
  recordedByUserId: '70000000-0000-4000-8000-000000000007',
  files: [],
} satisfies CaseJudgmentFact;
const defendants: CaseDefendant[] = [
  {
    id: '70000000-0000-4000-8000-000000000003',
    kind: 'PERSON',
    name: '同名被告甲',
    idNo: null,
    phone: null,
    address: null,
  },
  {
    id: '70000000-0000-4000-8000-000000000004',
    kind: 'PERSON',
    name: '同名被告甲',
    idNo: null,
    phone: null,
    address: null,
  },
];
const item = {
  id: caseId,
  stage: 'WAITING_JUDGMENT' as const,
  version: 3,
  canChooseJudgmentNextStep: true,
  canRevokeJudgmentNextStep: false,
  rightsHolder: {
    id: '70000000-0000-4000-8000-000000000005',
    name: '权利人甲',
  },
  defendants,
  judgment: { current: judgment, history: [judgment], availableFiles: [] },
  judgmentNextStep: { current: null, history: [], revocations: [] },
};
function mountPanel(props = {}) {
  return mount(CaseJudgmentNextStepPanel, {
    props: { item, contextKey: 'internal:user-1:1', ...props },
  });
}

describe('CaseJudgmentNextStepPanel', () => {
  it('requires an explicit path and explicit execution readiness confirmation', async () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
    expect(wrapper.findAll('input[type="radio"]:checked')).toHaveLength(0);
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    await wrapper.get('input[value="EXECUTION"]').setValue();
    expect(
      (wrapper.find('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(wrapper.text()).toContain('只进入材料准备，不代表已申请执行');
    expect(
      (wrapper.get('button[type="submit"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('submits both appeal sides by stable defendant ID and reuses the original key after an unknown result', async () => {
    api.chooseCaseJudgmentNextStep.mockRejectedValueOnce(
      new ApiError('network failure', 503, 'NETWORK_ERROR'),
    );
    api.chooseCaseJudgmentNextStep.mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper.get('input[value="APPEAL"]').setValue();
    await wrapper
      .get('input[data-defendant-id="70000000-0000-4000-8000-000000000003"]')
      .setValue();
    await wrapper
      .get('input[data-defendant-id="70000000-0000-4000-8000-000000000004"]')
      .setValue();
    await wrapper.get('input[data-plaintiff-appeals="true"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('[data-confirm-choice]').trigger('click');
    await flushPromises();
    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(1);
    const first = api.chooseCaseJudgmentNextStep.mock.calls[0]![1];
    expect(first).toMatchObject({
      next: 'APPEAL',
      plaintiffAppeals: true,
      defendantIds: defendants.map((defendant) => defendant.id),
    });
    expect(wrapper.text()).toContain('结果未知');
    const committedChoice = {
      id: '70000000-0000-4000-8000-000000000006',
      judgmentId,
      next: 'APPEAL' as const,
      plaintiffRightsHolderId: item.rightsHolder.id,
      plaintiffName: item.rightsHolder.name,
      defendants: defendants.map((defendant) => ({
        defendantId: defendant.id,
        nameSnapshot: defendant.name,
      })),
      executionReadinessConfirmed: false,
      fromVersion: 3,
      toVersion: 4,
      recordedAt: '2026-10-10T03:00:00Z',
    };
    await wrapper.setProps({
      item: {
        ...item,
        stage: 'SECOND_INSTANCE',
        version: 4,
        canChooseJudgmentNextStep: false,
        judgmentNextStep: {
          current: committedChoice,
          history: [committedChoice],
          revocations: [],
        },
      },
    });
    expect(wrapper.text()).toContain('原请求仍待核对');
    await wrapper.get('[data-retry-choice]').trigger('click');
    await flushPromises();
    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(2);
    expect(api.chooseCaseJudgmentNextStep.mock.calls[1]![1]).toEqual(first);
    expect(
      api.chooseCaseJudgmentNextStep.mock.calls[1]![1].expectedVersion,
    ).toBe(3);
  });

  it.each(['SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS'] as const)(
    'explains the effect before an authorized internal revocation from %s',
    async (stage) => {
      const current = {
        id: '70000000-0000-4000-8000-000000000006',
        judgmentId,
        next: 'APPEAL',
        plaintiffRightsHolderId: null,
        plaintiffName: null,
        defendants: [
          { defendantId: defendants[0]!.id, nameSnapshot: defendants[0]!.name },
        ],
        executionReadinessConfirmed: false,
        fromVersion: 3,
        toVersion: 4,
        recordedAt: '2026-10-10T03:00:00Z',
        recordedByUserId: '70000000-0000-4000-8000-000000000007',
      };
      const wrapper = mountPanel({
        item: {
          ...item,
          stage,
          version: 4,
          canChooseJudgmentNextStep: false,
          canRevokeJudgmentNextStep: true,
          judgmentNextStep: { current, history: [current], revocations: [] },
        },
      });
      expect(wrapper.text()).toContain('案件将退回“待判决”');
      await wrapper.get('[data-revoke-reason]').setValue('复核后确认误选');
      await wrapper.get('[data-revoke-choice]').trigger('click');
      expect(api.revokeCaseJudgmentNextStep).not.toHaveBeenCalled();
      await wrapper.get('[data-confirm-revoke]').trigger('click');
      await flushPromises();
      expect(api.revokeCaseJudgmentNextStep).toHaveBeenCalledWith(
        caseId,
        expect.objectContaining({
          expectedVersion: 4,
          choiceId: current.id,
          reason: '复核后确认误选',
        }),
      );
    },
  );

  it('does not expose revocation to lawyers or read-only viewers and cancellation sends nothing', async () => {
    const current = {
      id: '70000000-0000-4000-8000-000000000006',
      judgmentId,
      next: 'EXECUTION',
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      defendants: [],
      executionReadinessConfirmed: true,
      fromVersion: 3,
      toVersion: 4,
      recordedAt: '2026-10-10T03:00:00Z',
    };
    const protectedItem = {
      ...item,
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 4,
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: true,
      judgmentNextStep: { current, history: [current], revocations: [] },
    };
    const lawyer = mountPanel({ item: protectedItem, lawyer: true });
    expect(lawyer.find('[data-revoke-choice]').exists()).toBe(false);
    const readonly = mountPanel({
      item: { ...protectedItem, canRevokeJudgmentNextStep: false },
    });
    expect(readonly.find('[data-revoke-choice]').exists()).toBe(false);
    expect(readonly.find('input[type="radio"]').exists()).toBe(false);

    const editable = mountPanel();
    await editable.get('input[value="EXECUTION"]').setValue();
    await editable.get('input[type="checkbox"]').setValue(true);
    await editable.get('form').trigger('submit');
    expect(editable.get('[role="dialog"]').text()).toContain(
      '不代表已经申请强制执行',
    );
    await editable.get('[role="dialog"] button:last-child').trigger('click');
    expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
  });

  it('does not rebase an old version after conflict and ignores a late response after switching cases', async () => {
    api.chooseCaseJudgmentNextStep.mockRejectedValueOnce(
      new ApiError('冲突', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = mountPanel();
    await wrapper.get('input[value="EXECUTION"]').setValue();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('[data-confirm-choice]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('旧请求未自动改用新版本');
    expect(wrapper.find('[data-retry-choice]').exists()).toBe(false);
    expect(wrapper.emitted('refresh')).toHaveLength(1);

    let rejectRequest!: (reason: unknown) => void;
    api.chooseCaseJudgmentNextStep.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    await wrapper.get('input[value="APPEAL"]').setValue();
    await wrapper
      .get('input[data-defendant-id="70000000-0000-4000-8000-000000000003"]')
      .setValue(true);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('[data-confirm-choice]').trigger('click');
    await wrapper.setProps({
      item: { ...item, id: '70000000-0000-4000-8000-000000000008' },
    });
    rejectRequest(new ApiError('unknown', 503, 'NETWORK_ERROR'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('[data-retry-choice]').exists()).toBe(false);
  });

  it('ignores an unknown late response after the authenticated identity changes', async () => {
    let rejectRequest!: (reason: unknown) => void;
    api.chooseCaseJudgmentNextStep.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    const wrapper = mountPanel();
    await wrapper.get('input[value="APPEAL"]').setValue();
    await wrapper
      .get('input[data-defendant-id="70000000-0000-4000-8000-000000000003"]')
      .setValue(true);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('[data-confirm-choice]').trigger('click');
    await wrapper.setProps({ contextKey: 'internal:user-1:2' });
    rejectRequest(new ApiError('unknown', 503, 'NETWORK_ERROR'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('[data-retry-choice]').exists()).toBe(false);
  });
});
