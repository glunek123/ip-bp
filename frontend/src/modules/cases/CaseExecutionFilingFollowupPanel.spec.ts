import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { CaseDetail, LawyerCaseDetail } from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseExecutionFilingFollowupPanel from './CaseExecutionFilingFollowupPanel.vue';

const api = vi.hoisted(() => ({
  recordCaseExecutionFilingFeedback: vi.fn(),
  recordLawyerCaseExecutionFilingFeedback: vi.fn(),
  correctCaseExecutionFilingFeedback: vi.fn(),
  correctLawyerCaseExecutionFilingFeedback: vi.fn(),
  submitCaseExecutionFilingSupplement: vi.fn(),
  submitLawyerCaseExecutionFilingSupplement: vi.fn(),
  correctCaseExecutionFilingSupplement: vi.fn(),
  correctLawyerCaseExecutionFilingSupplement: vi.fn(),
  getCase: vi.fn(),
  getLawyerCase: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original()),
  ...api,
}));
const materialApi = vi.hoisted(() => ({
  downloadMaterialVersion: vi.fn(),
  uploadCaseExecutionFilingSupplementFile: vi.fn(),
  uploadLawyerCaseExecutionFilingSupplementFile: vi.fn(),
}));
vi.mock('../../api/materials', () => materialApi);
const caseId = '11111111-1111-4111-8111-111111111111';
const filingId = '22222222-2222-4222-8222-222222222222';
const feedbackId = '33333333-3333-4333-8333-333333333333';
function item(): CaseDetail | LawyerCaseDetail {
  return {
    id: caseId,
    stage: 'EXECUTING',
    executionFiling: { id: filingId },
    executionFilingFollowups: {
      filingId,
      canRecordFeedback: true,
      canSubmitSupplement: true,
      feedbacks: [],
      supplements: [],
    },
  } as unknown as CaseDetail | LawyerCaseDetail;
}
function wrapper(lawyer = false) {
  return mount(CaseExecutionFilingFollowupPanel, {
    props: {
      item: item(),
      actorKey: `${lawyer ? 'LAWYER' : 'INTERNAL'}:user:dept:1`,
      lawyer,
    },
  });
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('execution filing followup panel', () => {
  it('does not turn an absent response into an empty successful history', () => {
    const legacy = {
      ...item(),
      executionFilingFollowups: undefined,
    } as CaseDetail;
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: legacy, actorKey: 'INTERNAL:user:dept:1' },
    });
    expect(view.text()).toContain('后续资料尚未提供');
    expect(view.find('[data-test="followup-submit"]').exists()).toBe(false);
  });

  it('shows the external source without inventing a local filing or feedback', () => {
    const external = {
      ...item(),
      origin: { kind: 'EXTERNAL_ENTRY', initialStage: 'EXECUTING' },
      executionFiling: null,
      executionFilingFollowups: null,
    } as unknown as CaseDetail;
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: external, actorKey: 'INTERNAL:user:dept:1' },
    });
    expect(view.text()).toContain('没有本地执行申请记录');
    expect(view.find('[data-test="followup-submit"]').exists()).toBe(false);
  });

  it('shows exact supplement history files and hides internal reasons for lawyer projection', async () => {
    const originalName = `${'a'.repeat(43)}.pdf`;
    const newName = `${'b'.repeat(39)}.pdf`;
    const originalFile = {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: originalName,
      mimeType: 'application/pdf',
    };
    const newFile = {
      ...originalFile,
      contentVersionId: '66666666-6666-4666-8666-666666666666',
      originalFilename: newName,
    };
    const original = {
      id: feedbackId,
      revision: 1,
      recordedAt: '2026-10-16T00:00:00Z',
      submittedOn: null,
      note: null,
      files: [originalFile],
    };
    const corrected = {
      ...original,
      id: '77777777-7777-4777-8777-777777777777',
      revision: 2,
      files: [newFile],
    };
    const lawyer = item() as LawyerCaseDetail;
    lawyer.executionFilingFollowups!.supplements = [
      {
        supplementId: feedbackId,
        canCorrect: false,
        current: corrected,
        history: [original, corrected],
      },
    ];
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: lawyer, actorKey: 'LAWYER:user:dept:1', lawyer: true },
    });
    expect(view.text()).toContain(originalName);
    expect(view.text()).toContain(newName);
    expect(view.text()).not.toContain('更正原因');
    const fileLinks = view.findAll('button.followup-file-link');
    expect(fileLinks.map((link) => link.text())).toEqual([
      newName,
      originalName,
      newName,
    ]);
    await fileLinks[1]!.trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      originalFile.materialId,
      originalFile.contentVersionId,
      expect.any(AbortSignal),
    );
    await fileLinks[0]!.trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      newFile.materialId,
      newFile.contentVersionId,
      expect.any(AbortSignal),
    );
  });

  it('sends the fixed internal body once and keeps it after an unknown result', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(feedbackId)
      .mockReturnValueOnce(feedbackId);
    api.recordCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new Error('network'),
    );
    const view = wrapper();
    await view
      .find('[data-test="followup-content"]')
      .setValue('法院要求补充说明');
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    expect(api.recordCaseExecutionFilingFeedback).toHaveBeenCalledTimes(1);
    const first = api.recordCaseExecutionFilingFeedback.mock.calls[0]!;
    expect(first[0]).toBe(caseId);
    expect(first[1]).toBe(filingId);
    expect(first[2]).toMatchObject({
      expectedRevision: 0,
      feedbackOn: null,
      courtCaseNo: null,
      content: '法院要求补充说明',
    });
    expect(view.text()).toContain('提交结果尚未确认');
    await view.find('[data-test="followup-pending"] button').trigger('click');
    await flushPromises();
    expect(api.recordCaseExecutionFilingFeedback.mock.calls[1]![2]).toEqual(
      first[2],
    );
  });

  it('routes lawyer feedback only to the lawyer API and requires a fresh read', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(feedbackId)
      .mockReturnValueOnce(feedbackId);
    api.recordLawyerCaseExecutionFilingFeedback.mockResolvedValueOnce({
      id: caseId,
      filingId,
      feedbackId,
      revision: 1,
      recordedAt: new Date().toISOString(),
    });
    api.getLawyerCase.mockResolvedValueOnce({
      ...item(),
      executionFilingFollowups: {
        ...item().executionFilingFollowups,
        feedbacks: [
          {
            feedbackId,
            canCorrect: true,
            current: {
              id: feedbackId,
              revision: 1,
              recordedAt: new Date().toISOString(),
              feedbackOn: null,
              courtCaseNo: null,
              content: '回执',
            },
            history: [
              {
                id: feedbackId,
                revision: 1,
                recordedAt: new Date().toISOString(),
                feedbackOn: null,
                courtCaseNo: null,
                content: '回执',
              },
            ],
          },
        ],
      },
    });
    const view = wrapper(true);
    await view.find('[data-test="followup-content"]').setValue('回执');
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    expect(api.recordLawyerCaseExecutionFilingFeedback).toHaveBeenCalledTimes(
      1,
    );
    expect(api.recordCaseExecutionFilingFeedback).not.toHaveBeenCalled();
    expect(api.getLawyerCase).toHaveBeenCalledTimes(1);
    expect(view.text()).toContain('已登记并回读');
    expect(sessionStorage.length).toBe(0);
  });

  it('corrects the exact latest root with a reason and cancel writes nothing', async () => {
    const original = {
      id: feedbackId,
      revision: 2,
      recordedAt: '2026-10-16T00:00:00.000Z',
      feedbackOn: null,
      courtCaseNo: null,
      content: '原反馈',
      correctionReason: null,
    };
    const current = item();
    current.executionFilingFollowups!.feedbacks = [
      {
        feedbackId,
        canCorrect: true,
        current: original,
        history: [
          { ...original, revision: 1, correctionReason: null },
          { ...original, correctionReason: '原更正原因' },
        ],
      },
    ];
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: current, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view
      .findAll('button')
      .find((button) => button.text().includes('更正这条反馈'))!
      .trigger('click');
    expect(view.text()).toContain('原值：原反馈');
    await view
      .findAll('button')
      .find((button) => button.text().includes('取消更正'))!
      .trigger('click');
    expect(api.correctCaseExecutionFilingFeedback).not.toHaveBeenCalled();
    await view
      .findAll('button')
      .find((button) => button.text().includes('更正这条反馈'))!
      .trigger('click');
    await view.find('[data-test="followup-content"]').setValue('更正后的反馈');
    await view.find('[data-test="followup-reason"]').setValue('法院通知有误');
    api.correctCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new Error('unknown'),
    );
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseExecutionFilingFeedback).toHaveBeenCalledWith(
      caseId,
      filingId,
      feedbackId,
      expect.objectContaining({
        expectedRevision: 2,
        content: '更正后的反馈',
        correctionReason: '法院通知有误',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('blocks an opened feedback correction when the current revision advances', async () => {
    const original = {
      id: feedbackId,
      revision: 1,
      recordedAt: '2026-10-16T00:00:00Z',
      feedbackOn: null,
      courtCaseNo: null,
      content: '原反馈',
      correctionReason: null,
    };
    const detail = item();
    detail.executionFilingFollowups!.feedbacks = [
      { feedbackId, canCorrect: true, current: original, history: [original] },
    ];
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: detail, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view
      .findAll('button')
      .find((button) => button.text().includes('更正这条反馈'))!
      .trigger('click');
    await view.find('[data-test="followup-content"]').setValue('旧表单内容');
    await view.find('[data-test="followup-reason"]').setValue('更正原因');
    await view.setProps({
      item: {
        ...(detail as CaseDetail),
        executionFilingFollowups: {
          ...(detail as CaseDetail).executionFilingFollowups!,
          feedbacks: [
            {
              feedbackId,
              canCorrect: true,
              current: { ...original, revision: 2, content: '新反馈' },
              history: [original],
            },
          ],
        },
      },
    });
    expect(view.text()).toContain('这条反馈已更新');
    expect(
      view.find('[data-test="followup-submit"]').attributes('disabled'),
    ).toBeDefined();
    await view.find('[data-test="followup-submit"]').trigger('click');
    expect(api.correctCaseExecutionFilingFeedback).not.toHaveBeenCalled();
  });

  it('retries an unknown feedback correction with its original revision and body', async () => {
    const original = {
      id: feedbackId,
      revision: 1,
      recordedAt: '2026-10-16T00:00:00Z',
      feedbackOn: null,
      courtCaseNo: null,
      content: '原反馈',
      correctionReason: null,
    };
    const detail = item();
    detail.executionFilingFollowups!.feedbacks = [
      { feedbackId, canCorrect: true, current: original, history: [original] },
    ];
    api.correctCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new Error('network'),
    );
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: detail, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view
      .findAll('button')
      .find((button) => button.text().includes('更正这条反馈'))!
      .trigger('click');
    await view.find('[data-test="followup-content"]').setValue('更正反馈');
    await view.find('[data-test="followup-reason"]').setValue('更正原因');
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    const first = api.correctCaseExecutionFilingFeedback.mock.calls[0]!;
    expect(first[3]).toMatchObject({
      expectedRevision: 1,
      content: '更正反馈',
    });
    await view.setProps({
      item: {
        ...(detail as CaseDetail),
        executionFilingFollowups: {
          ...(detail as CaseDetail).executionFilingFollowups!,
          feedbacks: [
            {
              feedbackId,
              canCorrect: true,
              current: { ...original, revision: 2, content: '并发更新' },
              history: [original],
            },
          ],
        },
      },
    });
    await view.find('[data-test="followup-pending"] button').trigger('click');
    await flushPromises();
    const retry = api.correctCaseExecutionFilingFeedback.mock.calls[1]!;
    expect(retry[3]).toEqual(first[3]);
  });

  it('does not apply a late response after the actor changes', async () => {
    let resolvePost: (value: unknown) => void = () => {
      throw new Error('resolver missing');
    };
    api.recordCaseExecutionFilingFeedback.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );
    const view = wrapper();
    await view.find('[data-test="followup-content"]').setValue('真实反馈');
    await view.find('[data-test="followup-submit"]').trigger('click');
    expect(sessionStorage.length).toBe(1);
    await view.setProps({ actorKey: 'INTERNAL:other:dept:2' });
    resolvePost({
      id: feedbackId,
      filingId,
      feedbackId,
      revision: 1,
      recordedAt: new Date().toISOString(),
    });
    await flushPromises();
    expect(api.getCase).not.toHaveBeenCalled();
    expect(view.emitted('refresh')).toBeUndefined();
    expect(sessionStorage.length).toBe(1);
  });

  it('clears a deterministic revision conflict and waits for a refreshed snapshot', async () => {
    api.recordCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new ApiError('版本冲突', 409, 'VERSION_CONFLICT'),
    );
    const view = wrapper();
    await view.find('[data-test="followup-content"]').setValue('真实反馈');
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    expect(sessionStorage.length).toBe(0);
    expect(view.text()).toContain('记录版本或状态已变化');
    expect(
      view.find('[data-test="followup-submit"]').attributes('disabled'),
    ).toBeDefined();
    expect(view.emitted('refresh')).toHaveLength(1);
  });

  it('prepares a dedicated file, then separately submits and reads back the supplement', async () => {
    materialApi.uploadCaseExecutionFilingSupplementFile.mockImplementationOnce(
      async (
        _caseId: string,
        target: {
          filingId: string;
          supplementId: string;
          expectedRevision: number;
        },
      ) => ({
        materialId: '44444444-4444-4444-8444-444444444444',
        contentVersionId: '55555555-5555-4555-8555-555555555555',
        originalFilename: '补交.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
        sha256: 'a'.repeat(64),
        purpose: 'EXECUTION_SUPPLEMENT',
        executionSupplement: target,
      }),
    );
    const view = wrapper();
    await view.find('[data-test="supplement-open"]').trigger('click');
    const input = view.find('[data-test="supplement-upload"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '补交.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();
    expect(
      materialApi.uploadCaseExecutionFilingSupplementFile,
    ).toHaveBeenCalledTimes(1);
    const target =
      materialApi.uploadCaseExecutionFilingSupplementFile.mock.calls[0]![1];
    expect(target).toMatchObject({ filingId, expectedRevision: 0 });
    expect(api.submitCaseExecutionFilingSupplement).not.toHaveBeenCalled();
    const uploaded = {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: '补交.pdf',
      mimeType: 'application/pdf',
    };
    api.submitCaseExecutionFilingSupplement.mockResolvedValueOnce({
      id: target.supplementId,
      filingId,
      supplementId: target.supplementId,
      revision: 1,
      recordedAt: '2026-10-16T00:00:00Z',
    });
    api.getCase.mockResolvedValueOnce({
      ...item(),
      executionFilingFollowups: {
        ...item().executionFilingFollowups,
        supplements: [
          {
            supplementId: target.supplementId,
            canCorrect: true,
            current: {
              id: target.supplementId,
              revision: 1,
              recordedAt: '2026-10-16T00:00:00Z',
              submittedOn: null,
              note: null,
              files: [uploaded],
            },
            history: [
              {
                id: target.supplementId,
                revision: 1,
                recordedAt: '2026-10-16T00:00:00Z',
                submittedOn: null,
                note: null,
                files: [uploaded],
              },
            ],
          },
        ],
      },
    });
    await view.find('[data-test="supplement-submit"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseExecutionFilingSupplement).toHaveBeenCalledWith(
      caseId,
      filingId,
      expect.objectContaining({
        supplementId: target.supplementId,
        expectedRevision: 0,
        submittedOn: null,
        contentVersionIds: [uploaded.contentVersionId],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sessionStorage.length).toBe(0);
    expect(view.text()).toContain('已登记并回读');
  });

  it('corrects the exact supplement root and preserves its selected old file', async () => {
    const file = {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: '原补交.pdf',
      mimeType: 'application/pdf',
    };
    const original = {
      id: feedbackId,
      revision: 2,
      recordedAt: '2026-10-16T00:00:00Z',
      submittedOn: null,
      note: '原说明',
      files: [file],
    };
    const detail = item();
    detail.executionFilingFollowups!.supplements = [
      {
        supplementId: feedbackId,
        canCorrect: true,
        current: original,
        history: [original],
      },
    ];
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: detail, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view.find('[data-test="supplement-correct"]').trigger('click');
    await view.find('[data-test="supplement-note"]').setValue('更正说明');
    await view.find('[data-test="supplement-reason"]').setValue('登记有误');
    api.correctCaseExecutionFilingSupplement.mockRejectedValueOnce(
      new Error('unknown'),
    );
    await view.find('[data-test="supplement-submit"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseExecutionFilingSupplement).toHaveBeenCalledWith(
      caseId,
      filingId,
      feedbackId,
      expect.objectContaining({
        expectedRevision: 2,
        correctionReason: '登记有误',
        contentVersionIds: [file.contentVersionId],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      materialApi.uploadCaseExecutionFilingSupplementFile,
    ).not.toHaveBeenCalled();
  });

  it('keeps unknown upload outside business pending and cancels with zero writes', async () => {
    materialApi.uploadLawyerCaseExecutionFilingSupplementFile.mockRejectedValueOnce(
      new Error('unknown'),
    );
    const view = wrapper(true);
    await view.find('[data-test="supplement-open"]').trigger('click');
    const input = view.find('[data-test="supplement-upload"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '补交.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();
    expect(view.text()).toContain('本次上传未确认');
    expect(view.text()).toContain('尚无已确认的补交文件');
    expect(sessionStorage.length).toBe(0);
    await view.find('[data-test="supplement-cancel"]').trigger('click');
    expect(
      api.submitLawyerCaseExecutionFilingSupplement,
    ).not.toHaveBeenCalled();
    expect(
      api.correctLawyerCaseExecutionFilingSupplement,
    ).not.toHaveBeenCalled();
  });

  it('uses lawyer upload and submit with the same new root and original retry body', async () => {
    const versionId = '55555555-5555-4555-8555-555555555555';
    materialApi.uploadLawyerCaseExecutionFilingSupplementFile.mockImplementationOnce(
      async (
        _caseId: string,
        target: {
          filingId: string;
          supplementId: string;
          expectedRevision: number;
        },
      ) => ({
        materialId: '44444444-4444-4444-8444-444444444444',
        contentVersionId: versionId,
        originalFilename: '律师补交.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
        sha256: 'a'.repeat(64),
        purpose: 'EXECUTION_SUPPLEMENT',
        executionSupplement: target,
      }),
    );
    api.submitLawyerCaseExecutionFilingSupplement.mockRejectedValueOnce(
      new Error('network'),
    );
    const view = wrapper(true);
    await view.find('[data-test="supplement-open"]').trigger('click');
    const input = view.find('[data-test="supplement-upload"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '律师补交.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();
    const target =
      materialApi.uploadLawyerCaseExecutionFilingSupplementFile.mock
        .calls[0]![1];
    expect(
      materialApi.uploadCaseExecutionFilingSupplementFile,
    ).not.toHaveBeenCalled();
    await view.find('[data-test="supplement-submit"]').trigger('click');
    await flushPromises();
    const first =
      api.submitLawyerCaseExecutionFilingSupplement.mock.calls[0]![2];
    expect(first).toMatchObject({
      supplementId: target.supplementId,
      expectedRevision: 0,
      contentVersionIds: [versionId],
    });
    expect(api.submitCaseExecutionFilingSupplement).not.toHaveBeenCalled();
    await view.find('[data-test="followup-pending"] button').trigger('click');
    await flushPromises();
    expect(
      api.submitLawyerCaseExecutionFilingSupplement.mock.calls[1]![2],
    ).toEqual(first);
  });

  it('anchors correction upload to the exact root and head revision', async () => {
    const oldFile = {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: '原文件.pdf',
      mimeType: 'application/pdf',
    };
    const newVersion = '66666666-6666-4666-8666-666666666666';
    const original = {
      id: feedbackId,
      revision: 2,
      recordedAt: '2026-10-16T00:00:00Z',
      submittedOn: null,
      note: '原说明',
      files: [oldFile],
      correctionReason: null,
    };
    const detail = item();
    detail.executionFilingFollowups!.supplements = [
      {
        supplementId: feedbackId,
        canCorrect: true,
        current: original,
        history: [original],
      },
    ];
    materialApi.uploadCaseExecutionFilingSupplementFile.mockImplementationOnce(
      async (
        _caseId: string,
        target: {
          filingId: string;
          supplementId: string;
          expectedRevision: number;
        },
      ) => ({
        materialId: '77777777-7777-4777-8777-777777777777',
        contentVersionId: newVersion,
        originalFilename: '新文件.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
        sha256: 'a'.repeat(64),
        purpose: 'EXECUTION_SUPPLEMENT',
        executionSupplement: target,
      }),
    );
    api.correctCaseExecutionFilingSupplement.mockRejectedValueOnce(
      new Error('network'),
    );
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: detail, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view.find('[data-test="supplement-correct"]').trigger('click');
    await view.find('[data-test="supplement-reason"]').setValue('更正材料');
    const input = view.find('[data-test="supplement-upload"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '新文件.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();
    expect(
      materialApi.uploadCaseExecutionFilingSupplementFile.mock.calls[0]![1],
    ).toEqual({
      filingId,
      supplementId: feedbackId,
      expectedRevision: 2,
    });
    const preparedLink = view
      .findAll('[data-test="supplement-form"] button.followup-file-link')
      .find((link) => link.text() === '新文件.pdf');
    expect(preparedLink).toBeDefined();
    await preparedLink!.trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      newVersion,
      expect.any(AbortSignal),
    );
    await view.find('[data-test="supplement-submit"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseExecutionFilingSupplement).toHaveBeenCalledWith(
      caseId,
      filingId,
      feedbackId,
      expect.objectContaining({
        expectedRevision: 2,
        contentVersionIds: [oldFile.contentVersionId, newVersion],
        correctionReason: '更正材料',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('blocks an opened supplement correction and upload after its revision advances', async () => {
    const oldFile = {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: '原文件.pdf',
      mimeType: 'application/pdf',
    };
    const original = {
      id: feedbackId,
      revision: 1,
      recordedAt: '2026-10-16T00:00:00Z',
      submittedOn: null,
      note: '原说明',
      files: [oldFile],
      correctionReason: null,
    };
    const detail = item();
    detail.executionFilingFollowups!.supplements = [
      {
        supplementId: feedbackId,
        canCorrect: true,
        current: original,
        history: [original],
      },
    ];
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: detail, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view.find('[data-test="supplement-correct"]').trigger('click');
    await view.find('[data-test="supplement-reason"]').setValue('更正原因');
    await view.setProps({
      item: {
        ...(detail as CaseDetail),
        executionFilingFollowups: {
          ...(detail as CaseDetail).executionFilingFollowups!,
          supplements: [
            {
              supplementId: feedbackId,
              canCorrect: true,
              current: { ...original, revision: 2, note: '新说明' },
              history: [original],
            },
          ],
        },
      },
    });
    expect(view.text()).toContain('这条补交记录已更新');
    expect(
      view.find('[data-test="supplement-submit"]').attributes('disabled'),
    ).toBeDefined();
    const input = view.find('[data-test="supplement-upload"]');
    expect(input.attributes('disabled')).toBeDefined();
    await input.trigger('change');
    await view.find('[data-test="supplement-submit"]').trigger('click');
    expect(
      materialApi.uploadCaseExecutionFilingSupplementFile,
    ).not.toHaveBeenCalled();
    expect(api.correctCaseExecutionFilingSupplement).not.toHaveBeenCalled();
  });

  it('offers only the original pending retry after the case leaves EXECUTING', async () => {
    api.recordCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new Error('unknown'),
    );
    const view = wrapper();
    await view.find('[data-test="followup-content"]').setValue('法院反馈');
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    const old = api.recordCaseExecutionFilingFeedback.mock.calls[0]![2];
    const changed = {
      ...item(),
      stage: 'WAITING_ARCHIVE',
      executionFilingFollowups: {
        ...item().executionFilingFollowups,
        canRecordFeedback: false,
        canSubmitSupplement: false,
      },
    } as CaseDetail;
    await view.setProps({ item: changed });
    expect(view.find('[data-test="followup-submit"]').exists()).toBe(false);
    expect(view.find('[data-test="supplement-open"]').exists()).toBe(false);
    expect(
      view.find('[data-test="followup-pending"] button').attributes('disabled'),
    ).toBeUndefined();
    api.recordCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new Error('still unknown'),
    );
    await view.find('[data-test="followup-pending"] button').trigger('click');
    await flushPromises();
    expect(api.recordCaseExecutionFilingFeedback.mock.calls[1]![2]).toEqual(
      old,
    );
  });

  it('ignores an upload response after cancelling and opening another form', async () => {
    let resolveUpload: (value: unknown) => void = () => {
      throw new Error('resolver missing');
    };
    materialApi.uploadCaseExecutionFilingSupplementFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    const view = wrapper();
    await view.find('[data-test="supplement-open"]').trigger('click');
    const firstTarget = view.find('[data-test="supplement-upload"]');
    Object.defineProperty(firstTarget.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '首次.pdf', { type: 'application/pdf' })],
    });
    await firstTarget.trigger('change');
    const target =
      materialApi.uploadCaseExecutionFilingSupplementFile.mock.calls[0]![1];
    await view.find('[data-test="supplement-cancel"]').trigger('click');
    await view.find('[data-test="supplement-open"]').trigger('click');
    resolveUpload({
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: '首次.pdf',
      mimeType: 'application/pdf',
      executionSupplement: target,
    });
    await flushPromises();
    expect(view.text()).toContain('尚无已确认的补交文件');
    expect(api.submitCaseExecutionFilingSupplement).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('rejects unsupported files before the upload API', async () => {
    const view = wrapper();
    await view.find('[data-test="supplement-open"]').trigger('click');
    const input = view.find('[data-test="supplement-upload"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['text'], '不支持.txt', { type: 'text/plain' })],
    });
    await input.trigger('change');
    expect(view.text()).toContain('仅支持单个不超过 50 MiB');
    expect(
      materialApi.uploadCaseExecutionFilingSupplementFile,
    ).not.toHaveBeenCalled();
  });

  it('does not enable a supplement correction that only adds a reason', async () => {
    const file = {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      originalFilename: '旧文件.pdf',
      mimeType: 'application/pdf',
    };
    const current = {
      id: feedbackId,
      revision: 1,
      recordedAt: '2026-10-16T00:00:00Z',
      submittedOn: null,
      note: '原说明',
      files: [file],
    };
    const detail = item();
    detail.executionFilingFollowups!.supplements = [
      {
        supplementId: feedbackId,
        canCorrect: true,
        current,
        history: [current],
      },
    ];
    const view = mount(CaseExecutionFilingFollowupPanel, {
      props: { item: detail, actorKey: 'INTERNAL:user:dept:1' },
    });
    await view.find('[data-test="supplement-correct"]').trigger('click');
    await view.find('[data-test="supplement-reason"]').setValue('仅填写原因');
    expect(
      view.find('[data-test="supplement-submit"]').attributes('disabled'),
    ).toBeDefined();
  });
  it('stops writes after permission loss while retaining the original request', async () => {
    api.recordCaseExecutionFilingFeedback.mockRejectedValueOnce(
      new ApiError('权限不足', 403, 'FORBIDDEN'),
    );
    const view = wrapper();
    await view.find('[data-test="followup-content"]').setValue('真实反馈');
    await view.find('[data-test="followup-submit"]').trigger('click');
    await flushPromises();
    expect(sessionStorage.length).toBe(1);
    expect(
      view.find('[data-test="followup-pending"] button').attributes('disabled'),
    ).toBeDefined();
    expect(view.find('[data-test="supplement-open"]').exists()).toBe(false);
    expect(view.emitted('refresh')).toHaveLength(1);
  });
});
