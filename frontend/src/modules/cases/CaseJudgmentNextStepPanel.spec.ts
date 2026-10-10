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
const activeChoice = {
  id: '70000000-0000-4000-8000-000000000006',
  judgmentId,
  next: 'APPEAL' as const,
  plaintiffRightsHolderId: item.rightsHolder.id,
  plaintiffName: item.rightsHolder.name,
  defendants: [],
  executionReadinessConfirmed: false,
  fromVersion: 3,
  toVersion: 4,
  recordedAt: '2026-10-10T03:00:00Z',
};
const revocableItem = {
  ...item,
  stage: 'SECOND_INSTANCE' as const,
  version: 4,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: true,
  judgmentNextStep: {
    current: activeChoice,
    history: [activeChoice],
    revocations: [],
  },
};

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

  it.each([
    ['version', { version: 4 }],
    [
      'current judgment',
      {
        judgment: {
          ...item.judgment,
          current: { ...judgment, id: '70000000-0000-4000-8000-000000000009' },
        },
      },
    ],
  ])(
    'clears an unsubmitted choice when the same case %s changes',
    async (_label, change) => {
      const wrapper = mountPanel();
      await wrapper.get('input[value="APPEAL"]').setValue();
      await wrapper.get('input[data-plaintiff-appeals="true"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

      await wrapper.setProps({ item: { ...item, ...change } });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.findAll('input[type="radio"]:checked')).toHaveLength(0);
      expect(
        (wrapper.get('button[type="submit"]').element as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['version', { version: 5 }],
    [
      'current choice',
      {
        judgmentNextStep: {
          ...revocableItem.judgmentNextStep,
          current: {
            ...activeChoice,
            id: '70000000-0000-4000-8000-000000000010',
          },
        },
      },
    ],
  ])(
    'clears an unsubmitted revocation when the same case %s changes',
    async (_label, change) => {
      const wrapper = mountPanel({ item: revocableItem });
      await wrapper.get('[data-revoke-reason]').setValue('旧选择的撤销原因');
      await wrapper.get('[data-revoke-choice]').trigger('click');
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

      await wrapper.setProps({ item: { ...revocableItem, ...change } });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(
        (wrapper.get('[data-revoke-reason]').element as HTMLTextAreaElement)
          .value,
      ).toBe('');
      expect(
        (wrapper.get('[data-revoke-choice]').element as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(api.revokeCaseJudgmentNextStep).not.toHaveBeenCalled();
    },
  );

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

  it('keeps an in-flight choice when detail refreshes before an unknown response', async () => {
    let rejectRequest!: (reason: unknown) => void;
    api.chooseCaseJudgmentNextStep.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    api.chooseCaseJudgmentNextStep.mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper.get('input[value="EXECUTION"]').setValue();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('[data-confirm-choice]').trigger('click');
    const first = api.chooseCaseJudgmentNextStep.mock.calls[0]![1];
    const committedChoice = {
      ...activeChoice,
      next: 'EXECUTION' as const,
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      executionReadinessConfirmed: true,
    };

    await wrapper.setProps({
      item: {
        ...item,
        stage: 'WAITING_EXECUTION_DOCUMENTS',
        version: 4,
        canChooseJudgmentNextStep: false,
        judgmentNextStep: {
          current: committedChoice,
          history: [committedChoice],
          revocations: [],
        },
      },
    });
    rejectRequest(new ApiError('unknown', 503, 'NETWORK_ERROR'));
    await flushPromises();
    expect(wrapper.find('[data-retry-choice]').exists()).toBe(true);
    await wrapper.get('[data-retry-choice]').trigger('click');
    await flushPromises();
    expect(api.chooseCaseJudgmentNextStep.mock.calls[1]![1]).toEqual(first);
  });

  it('keeps an in-flight revocation through a refreshed target stage and retries the original body and key', async () => {
    let rejectRequest!: (reason: unknown) => void;
    api.revokeCaseJudgmentNextStep.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    api.revokeCaseJudgmentNextStep.mockResolvedValueOnce({});
    const wrapper = mountPanel({ item: revocableItem });
    await wrapper.get('[data-revoke-reason]').setValue('原撤销原因');
    await wrapper.get('[data-revoke-choice]').trigger('click');
    await wrapper.get('[data-confirm-revoke]').trigger('click');
    const first = api.revokeCaseJudgmentNextStep.mock.calls[0]![1];

    await wrapper.setProps({
      item: {
        ...revocableItem,
        stage: 'WAITING_JUDGMENT',
        version: 5,
        canRevokeJudgmentNextStep: false,
        judgmentNextStep: {
          current: null,
          history: [activeChoice],
          revocations: [],
        },
      },
    });
    rejectRequest(new ApiError('unknown', 503, 'NETWORK_ERROR'));
    await flushPromises();
    expect(wrapper.find('[data-retry-choice]').exists()).toBe(true);
    await wrapper.get('[data-retry-choice]').trigger('click');
    await flushPromises();
    expect(api.revokeCaseJudgmentNextStep.mock.calls[1]![1]).toEqual(first);
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

    await wrapper.setProps({ item: { ...item, version: 4 } });
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '案件版本或状态已变化。旧请求未自动改用新版本，请刷新并核对后重新填写。',
    );
    expect(wrapper.findAll('input[type="radio"]:checked')).toHaveLength(0);
    expect(wrapper.findAll('input[type="checkbox"]:checked')).toHaveLength(0);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(
      (wrapper.get('button[type="submit"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);

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
