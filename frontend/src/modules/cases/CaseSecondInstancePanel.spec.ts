import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseSecondInstancePanel from './CaseSecondInstancePanel.vue';

const api = vi.hoisted(() => ({
  saveSecondInstance: vi.fn(),
  registerSecondInstanceResult: vi.fn(),
  revokeSecondInstanceResult: vi.fn(),
  uploadMaterialFile: vi.fn(),
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  saveSecondInstance: api.saveSecondInstance,
  registerSecondInstanceResult: api.registerSecondInstanceResult,
  revokeSecondInstanceResult: api.revokeSecondInstanceResult,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  uploadMaterialFile: api.uploadMaterialFile,
  listOwnerMaterials: api.listOwnerMaterials,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

const id = (last: string) =>
  `70000000-0000-4000-8000-${last.padStart(12, '0')}`;
const round1 = id('1');
const round2 = id('2');
const choice1 = id('3');
const choice2 = id('4');
const result1 = id('5');
const resultFile = {
  materialId: id('6'),
  contentVersionId: id('7'),
  originalFilename: '二审裁判.pdf',
  mimeType: 'application/pdf',
};

function item(stage: CaseDetail['stage'] = 'SECOND_INSTANCE') {
  return {
    id: id('20'),
    stage,
    version: 9,
    canSaveSecondInstance: true,
    canRegisterSecondInstanceResult: true,
    canRevokeSecondInstanceResult: true,
    acceptance: {
      acceptedAt: '2026-10-01',
      courtCaseNo: '甲字1号',
      recordedAt: '2026-10-01T01:00:00Z',
      recordedByUserId: id('21'),
    },
    hearing: {
      currentArrangement: null,
      currentAdvance: null,
      arrangements: [],
      advances: [],
      corrections: [],
    },
    judgment: {
      current: {
        id: id('22'),
        trialRoundId: round1,
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '88.00',
      },
      history: [],
      availableFiles: [],
    },
    judgmentNextStep: {
      current: {
        id: choice2,
        trialRoundId: round2,
        judgmentId: id('22'),
        next: 'APPEAL',
      },
      history: [
        {
          id: choice1,
          trialRoundId: round1,
          judgmentId: id('22'),
          next: 'APPEAL',
        },
        {
          id: choice2,
          trialRoundId: round2,
          judgmentId: id('22'),
          next: 'APPEAL',
        },
      ],
      revocations: [],
    },
    acceptances: [
      {
        id: id('23'),
        trialRoundId: round1,
        acceptedAt: '2026-10-01',
        courtCaseNo: '甲字1号',
        recordedAt: '2026-10-01T01:00:00Z',
        recordedByUserId: id('21'),
        files: [{ ...resultFile, category: 'ACCEPTANCE_NOTICE' }],
      },
    ],
    secondInstance: {
      currentTrialRoundId: round2,
      currentProgress: null,
      currentResult: null,
      rounds: [
        { id: round1, sequence: 1, sourceResultId: null, revokedAt: null },
        { id: round2, sequence: 2, sourceResultId: result1, revokedAt: null },
      ],
      progresses: [],
      results: [
        {
          id: result1,
          trialRoundId: round1,
          choiceId: choice1,
          judgmentId: id('22'),
          progressId: null,
          result: 'CHANGE',
          resultReceivedAt: '2026-10-03',
          judgmentAmountState: 'KNOWN',
          judgmentAmount: '0.00',
          paidLitigationFeeState: 'PENDING',
          paidLitigationFee: null,
          fromVersion: 5,
          toVersion: 6,
          recordedAt: '2026-10-03T01:00:00Z',
          recordedByUserId: id('21'),
          files: [resultFile],
          childTrialRoundId: round2,
          revocationId: null,
        },
      ],
      revocations: [],
    },
  } as unknown as CaseDetail;
}

function mountPanel(
  overrides: { item?: unknown; contextKey?: string; lawyer?: boolean } = {},
) {
  return mount(CaseSecondInstancePanel, {
    props: {
      item: item(),
      contextKey: 'internal:user-a:1',
      ...overrides,
    } as never,
  });
}

describe('CaseSecondInstancePanel', () => {
  it('groups history by trial round and distinguishes a real zero from pending', () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('第1轮办理');
    expect(wrapper.text()).toContain('第2轮办理（当前）');
    expect(wrapper.text()).toContain('¥ 0.00');
    expect(wrapper.text()).toContain('诉讼费：待确认');
    expect(wrapper.text()).not.toContain(round1);
    expect(wrapper.text()).not.toContain('三审');
  });

  it('requires explicit result and fee states and explains the target stage before submit', async () => {
    const wrapper = mountPanel();
    expect(
      wrapper.findAll('[data-test="second-instance-result-option"]'),
    ).toHaveLength(3);
    expect(
      wrapper
        .find('[data-test="second-instance-result-option"]:checked')
        .exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="second-instance-fee-state"]:checked').exists(),
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-test="second-instance-result-submit"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper
      .get('[data-test="second-instance-result-option"][value="REMAND"]')
      .setValue();
    expect(wrapper.text()).toContain('同一案件将转入待正式立案');
  });

  it('saves explicit current-round anchors and empty progress arrays', async () => {
    api.saveSecondInstance.mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.saveSecondInstance).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        expectedVersion: 9,
        trialRoundId: round2,
        choiceId: choice2,
        expectedProgressId: null,
        progress: {
          hearingAt: null,
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
      }),
      'internal',
    );
  });

  it('registers a REMAND with selected file versions and explicit empty progress', async () => {
    api.registerSecondInstanceResult.mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-result-option"][value="REMAND"]')
      .setValue();
    await wrapper
      .get('[data-test="second-instance-received-at"]')
      .setValue('2026-10-10');
    await wrapper
      .get('[data-test="second-instance-fee-state"][value="PENDING"]')
      .setValue();
    await wrapper
      .get('[data-test="second-instance-result-file-choice"]')
      .setValue(true);
    await wrapper
      .get('[data-test="second-instance-result-form"]')
      .trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('待正式立案');
    await wrapper
      .get('[data-test="second-instance-confirm-result"]')
      .trigger('click');
    await flushPromises();
    expect(api.registerSecondInstanceResult).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        expectedVersion: 9,
        trialRoundId: round2,
        choiceId: choice2,
        result: 'REMAND',
        judgmentContentVersionIds: [resultFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
        progress: {
          hearingAt: null,
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
      }),
      'internal',
    );
  });

  it('never offers result revocation to a lawyer', () => {
    const wrapper = mountPanel({ lawyer: true, contextKey: 'lawyer:active' });
    expect(wrapper.find('[data-test="second-instance-revoke"]').exists()).toBe(
      false,
    );
  });

  it('requires reason and explicit impact confirmation before internal revoke', async () => {
    const detail = item('WAITING_EXECUTION_DOCUMENTS');
    detail.secondInstance.currentTrialRoundId = round1;
    detail.secondInstance.currentResult = detail.secondInstance.results[0]!;
    api.revokeSecondInstanceResult.mockResolvedValueOnce({});
    const wrapper = mountPanel({ item: detail });
    const revoke = wrapper.get('[data-test="second-instance-revoke"]');
    expect((revoke.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('textarea').setValue('  裁判结果录入错误  ');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect((revoke.element as HTMLButtonElement).disabled).toBe(false);
    await revoke.trigger('click');
    expect(wrapper.text()).toContain('发回子轮次不会重新启用');
    await wrapper
      .get('[data-test="second-instance-confirm-revoke"]')
      .trigger('click');
    await flushPromises();
    expect(api.revokeSecondInstanceResult).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        trialRoundId: round1,
        resultId: result1,
        reason: '裁判结果录入错误',
      }),
    );
  });

  it('retries an unknown result with the original body and key', async () => {
    api.registerSecondInstanceResult
      .mockRejectedValueOnce(new ApiError('unknown', 503, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-result-option"][value="REMAND"]')
      .setValue();
    await wrapper
      .get('[data-test="second-instance-received-at"]')
      .setValue('2026-10-10');
    await wrapper
      .get('[data-test="second-instance-fee-state"][value="PENDING"]')
      .setValue();
    await wrapper
      .get('[data-test="second-instance-result-file-choice"]')
      .setValue(true);
    await wrapper
      .get('[data-test="second-instance-result-form"]')
      .trigger('submit');
    await wrapper
      .get('[data-test="second-instance-confirm-result"]')
      .trigger('click');
    await flushPromises();
    const original = api.registerSecondInstanceResult.mock.calls[0];
    await wrapper
      .get('[data-test="second-instance-result-retry"]')
      .trigger('click');
    await flushPromises();
    expect(api.registerSecondInstanceResult.mock.calls[1]).toEqual(original);
  });

  it('keeps a 409 conflict visible and blocks commands until the refreshed detail is acknowledged', async () => {
    api.saveSecondInstance.mockRejectedValueOnce(
      new ApiError('conflict', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-hearing-at"]')
      .setValue('2026-10-08');
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(wrapper.text()).toContain('案件版本或轮次已变化');
    await wrapper.setProps({ item: { ...item(), version: 10 } as CaseDetail });
    expect(
      (
        wrapper.get('[data-test="second-instance-progress-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(wrapper.text()).toContain('案件版本或轮次已变化');
    await wrapper
      .get('[data-test="second-instance-conflict-acknowledge"]')
      .trigger('click');
    expect(
      (
        wrapper.get('[data-test="second-instance-progress-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('clears sensitive drafts and disables actions after a 403', async () => {
    api.saveSecondInstance.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-hearing-at"]')
      .setValue('2026-10-08');
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(wrapper.text()).toContain('敏感内容已清除');
    expect(wrapper.find('[data-test="second-instance-round-1"]').exists()).toBe(
      false,
    );
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('下载')),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="second-instance-progress-form"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="second-instance-result-form"]').exists(),
    ).toBe(false);
  });

  it('ignores a late response after the case identity changes', async () => {
    let resolveSave!: (value: unknown) => void;
    api.saveSecondInstance.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    expect(api.saveSecondInstance).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ contextKey: 'internal:user-b:2' });
    resolveSave({});
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('二审进展已登记');
  });

  it('ignores a late response after the case id changes', async () => {
    let resolveSave!: (value: unknown) => void;
    api.saveSecondInstance.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    await wrapper.setProps({ item: { ...item(), id: id('99') } as CaseDetail });
    resolveSave({});
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('二审进展已登记');
  });

  it('resets the ordinary draft when the same case version changes', async () => {
    const wrapper = mountPanel();
    const hearingDate = wrapper.get('[data-test="second-instance-hearing-at"]');
    await hearingDate.setValue('2026-10-08');
    await wrapper.setProps({ item: { ...item(), version: 10 } as CaseDetail });
    expect(
      (
        wrapper.get('[data-test="second-instance-hearing-at"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('');
  });
});
