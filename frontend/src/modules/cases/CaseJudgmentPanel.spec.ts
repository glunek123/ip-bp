import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseDetail } from '../../api/cases';
import CaseJudgmentPanel from './CaseJudgmentPanel.vue';

const api = vi.hoisted(() => ({
  registerCaseJudgment: vi.fn(),
  correctCaseJudgment: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-08'),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  registerCaseJudgment: api.registerCaseJudgment,
  correctCaseJudgment: api.correctCaseJudgment,
  todayShanghai: api.todayShanghai,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

const file = {
  materialId: '70000000-0000-4000-8000-000000000001',
  contentVersionId: '70000000-0000-4000-8000-000000000002',
  originalFilename: '判决书.pdf',
  mimeType: 'application/pdf',
};
const fact = {
  id: '70000000-0000-4000-8000-000000000003',
  kind: 'REGISTER' as const,
  priorFactId: null,
  judgmentReceivedAt: '2026-10-07',
  judgmentAmountState: 'KNOWN' as const,
  judgmentAmount: '0.00',
  paidLitigationFeeState: 'PENDING' as const,
  paidLitigationFee: null,
  fromVersion: 7,
  toVersion: 8,
  recordedAt: '2026-10-07T01:00:00.000Z',
  recordedByUserId: '70000000-0000-4000-8000-000000000004',
  files: [file],
};
const frozenFiles = Array.from({ length: 10 }, (_, index) => ({
  ...file,
  contentVersionId: `70000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
  originalFilename: `历史判决书-${index + 1}.pdf`,
}));
const frozenFacts = frozenFiles.map((frozenFile, index) => ({
  ...fact,
  id: `70000000-0000-4000-8000-${String(index + 40).padStart(12, '0')}`,
  priorFactId:
    index === 0
      ? null
      : `70000000-0000-4000-8000-${String(index + 39).padStart(12, '0')}`,
  fromVersion: index + 7,
  toVersion: index + 8,
  files: [frozenFile],
}));
const baseItem: CaseDetail = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_JUDGMENT',
  createdAt: '2026-09-28T00:00:00.000Z',
  version: 7,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: false,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canRegisterJudgment: true,
  canCorrectJudgment: false,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: false,
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
  courtCaseNo: '（2026）甲0101民初1号',
  department: { id: 'department-1', name: '知产部' },
  customer: { id: 'customer-1', name: '客户甲' },
  rightsHolder: { id: 'holder-1', name: '权利人甲' },
  certificate: {
    certificateNo: 'Z-100',
    certificateDate: '2026-09-28',
    issuedAt: '2026-09-28T00:00:00.000Z',
    needDisclose: false,
    files: [file],
    disclosureFiles: [],
  },
  fees: [],
  defendants: [],
  lawyers: [],
  matchedAt: null,
  matchedOn: null,
  complaint: null,
  complaintConfirmation: null,
  complaintMailing: null,
  filingSubmission: null,
  acceptance: {
    acceptedAt: '2026-10-01',
    courtCaseNo: '（2026）甲0101民初1号',
    recordedAt: '2026-10-01T01:00:00.000Z',
    recordedByUserId: '70000000-0000-4000-8000-000000000005',
  },
  acceptanceMaterials: {
    ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
    PAYMENT_LIST: { available: [], frozen: [], later: [] },
    SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
  },
  hearing: {
    currentArrangement: null,
    currentAdvance: null,
    arrangements: [],
    advances: [],
    corrections: [],
  },
  judgment: { current: null, history: [], availableFiles: [file] },
  judgmentNextStep: { current: null, history: [], revocations: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.todayShanghai.mockReturnValue('2026-10-08');
  api.registerCaseJudgment.mockResolvedValue({
    id: 'case-1',
    stage: 'WAITING_JUDGMENT',
    version: 8,
    judgmentId: fact.id,
    recordedAt: fact.recordedAt,
  });
  api.correctCaseJudgment.mockResolvedValue({
    id: 'case-1',
    stage: 'WAITING_JUDGMENT',
    version: 9,
    judgmentId: '70000000-0000-4000-8000-000000000006',
    recordedAt: '2026-10-08T01:00:00.000Z',
  });
});
afterEach(() => vi.unstubAllGlobals());

function mountPanel(
  item: CaseDetail = baseItem,
  lawyer = false,
  contextKey = 'INTERNAL:user-1:1',
) {
  return mount(CaseJudgmentPanel, { props: { item, lawyer, contextKey } });
}

describe('case judgment panel', () => {
  it('requires explicit amount states and auto-selects the only available judgment file', async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('收到判决日期');
    expect(wrapper.text()).toContain('判决金额');
    expect(wrapper.text()).toContain('实缴诉讼费');
    expect(wrapper.text()).toContain('登记后案件仍为待判决');
    expect(wrapper.text()).toContain('只记录事实，不会发起支付');
    expect(
      (
        wrapper.get(
          '[data-test="judgment-file-70000000-0000-4000-8000-000000000002"]',
        ).element as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        wrapper.get('[data-test="judgment-submit"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await wrapper.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await wrapper.get('[data-test="judgment-amount-state"]').setValue('KNOWN');
    await wrapper.get('[data-test="judgment-amount"]').setValue('0.00');
    await wrapper.get('[data-test="paid-fee-state"]').setValue('PENDING');
    expect(
      (
        wrapper.get('[data-test="judgment-submit"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      wrapper.get('[data-test="judgment-review-summary"]').text(),
    ).toContain('登记后案件仍为待判决');
    expect(
      wrapper.get('[data-test="judgment-review-summary"]').text(),
    ).toContain('判决金额：已知 0.00 元');
    expect(
      wrapper.get('[data-test="judgment-review-summary"]').text(),
    ).toContain('实缴诉讼费：待定');

    await wrapper.get('[data-test="judgment-submit"]').trigger('click');
    await flushPromises();
    expect(api.registerCaseJudgment).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        judgmentReceivedAt: '2026-10-07',
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '0.00',
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [file.contentVersionId],
      }),
      'internal',
    );
  });

  it.each([
    ['代理502', 502, 'BAD_GATEWAY'],
    ['未知代码503', 503, 'UPSTREAM_FAILURE'],
  ] as const)(
    'keeps the exact command after %s and retries with the same key and body',
    async (_label, status, code) => {
      api.registerCaseJudgment
        .mockRejectedValueOnce(new ApiError('Gateway error', status, code))
        .mockResolvedValueOnce({
          id: 'case-1',
          stage: 'WAITING_JUDGMENT',
          version: 8,
          judgmentId: fact.id,
          recordedAt: fact.recordedAt,
        });
      const wrapper = mountPanel();
      await wrapper.get('[data-test="judgment-date"]').setValue('2026-10-07');
      await wrapper
        .get('[data-test="judgment-amount-state"]')
        .setValue('PENDING');
      await wrapper.get('[data-test="paid-fee-state"]').setValue('KNOWN');
      await wrapper.get('[data-test="paid-fee-amount"]').setValue('12.30');
      await wrapper.get('[data-test="judgment-submit"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('使用相同请求安全重试');
      const firstInput = api.registerCaseJudgment.mock.calls[0]?.[1];
      expect(firstInput).toMatchObject({
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFee: '12.30',
      });

      await wrapper.get('[data-test="judgment-retry"]').trigger('click');
      await flushPromises();
      expect(api.registerCaseJudgment).toHaveBeenCalledTimes(2);
      expect(api.registerCaseJudgment.mock.calls[1]).toEqual(
        api.registerCaseJudgment.mock.calls[0],
      );
    },
  );

  it('shows correction only to an authorized internal user and requires its reason', async () => {
    const correctable = {
      ...baseItem,
      canRegisterJudgment: false,
      canCorrectJudgment: true,
      judgment: { current: fact, history: [fact], availableFiles: [file] },
    };
    const operator = mountPanel(correctable);
    expect(
      operator.find('[data-test="judgment-correction-form"]').exists(),
    ).toBe(true);
    expect(
      (
        operator.get('[data-test="judgment-correct"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await operator
      .get('[data-test="judgment-correction-reason"]')
      .setValue('判决日期录入错误');
    await operator.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseJudgment).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        reason: '判决日期录入错误',
        judgmentContentVersionIds: [file.contentVersionId],
      }),
    );

    const lawyer = mountPanel(correctable, true, 'LAWYER:lawyer-1:1');
    expect(lawyer.find('[data-test="judgment-correction-form"]').exists()).toBe(
      false,
    );
  });

  it('does not apply a command result after the case context changes', async () => {
    let resolveCommand!: (value: unknown) => void;
    api.registerCaseJudgment.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await wrapper
      .get('[data-test="judgment-amount-state"]')
      .setValue('PENDING');
    await wrapper.get('[data-test="paid-fee-state"]').setValue('PENDING');
    await wrapper.get('[data-test="judgment-submit"]').trigger('click');
    const nextCase = {
      ...baseItem,
      id: 'case-2',
      canRegisterJudgment: false,
      judgment: { current: fact, history: [fact], availableFiles: [file] },
    };
    await wrapper.setProps({ item: nextCase, contextKey: 'INTERNAL:user-1:2' });
    resolveCommand({
      id: 'case-1',
      stage: 'WAITING_JUDGMENT',
      version: 8,
      judgmentId: fact.id,
      recordedAt: fact.recordedAt,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('判决命令已受理');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('requires a choice when more than one valid judgment file is available', async () => {
    const secondFile = {
      ...file,
      materialId: '70000000-0000-4000-8000-000000000007',
      contentVersionId: '70000000-0000-4000-8000-000000000008',
      originalFilename: '补充判决书.pdf',
    };
    const wrapper = mountPanel({
      ...baseItem,
      judgment: {
        current: null,
        history: [],
        availableFiles: [file, secondFile],
      },
    });
    expect(
      (
        wrapper.get(`[data-test="judgment-file-${file.contentVersionId}"]`)
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        wrapper.get(
          `[data-test="judgment-file-${secondFile.contentVersionId}"]`,
        ).element as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it('clears an automatic selection when a new upload makes the file set ambiguous', async () => {
    const addedFile = {
      materialId: '70000000-0000-4000-8000-000000000009',
      contentVersionId: '70000000-0000-4000-8000-000000000010',
      originalFilename: '补充判决书.pdf',
      mimeType: 'application/pdf',
    };
    api.uploadMaterialFile.mockResolvedValueOnce(addedFile);
    const wrapper = mountPanel();
    const existingInput = wrapper.get(
      `[data-test="judgment-file-${file.contentVersionId}"]`,
    ).element as HTMLInputElement;
    expect(existingInput.checked).toBe(true);
    const upload = wrapper.get('[data-test="judgment-file-input"]');
    Object.defineProperty(upload.element, 'files', {
      configurable: true,
      value: [
        new File(['supplement'], addedFile.originalFilename, {
          type: addedFile.mimeType,
        }),
      ],
    });

    await upload.trigger('change');
    await flushPromises();

    expect(
      (
        wrapper.get(`[data-test="judgment-file-${file.contentVersionId}"]`)
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        wrapper.get(`[data-test="judgment-file-${addedFile.contentVersionId}"]`)
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it('allows a new correction upload after ten historical versions are frozen', async () => {
    const addedFile = {
      materialId: '70000000-0000-4000-8000-000000000090',
      contentVersionId: '70000000-0000-4000-8000-000000000091',
      originalFilename: '补正文书.pdf',
      mimeType: 'application/pdf',
    };
    api.uploadMaterialFile.mockResolvedValueOnce(addedFile);
    const correctable = {
      ...baseItem,
      canRegisterJudgment: false,
      canCorrectJudgment: true,
      judgment: {
        current: frozenFacts.at(-1)!,
        history: frozenFacts,
        availableFiles: frozenFiles,
      },
    };
    const wrapper = mountPanel(correctable);
    const input = wrapper.get('[data-test="judgment-file-input"]')
      .element as HTMLInputElement;
    expect(input.disabled).toBe(false);
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File(['supplement'], addedFile.originalFilename, {
          type: 'application/pdf',
        }),
      ],
    });

    await wrapper.get('[data-test="judgment-file-input"]').trigger('change');
    await flushPromises();

    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(api.uploadMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'JUDGMENT', purpose: 'JUDGMENT' }),
    );
    expect(
      wrapper
        .find(`[data-test="judgment-file-${addedFile.contentVersionId}"]`)
        .exists(),
    ).toBe(true);
    for (const historicalFile of frozenFiles)
      await wrapper
        .get(`[data-test="judgment-file-${historicalFile.contentVersionId}"]`)
        .setValue(true);
    expect(
      (
        wrapper.get(`[data-test="judgment-file-${addedFile.contentVersionId}"]`)
          .element as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it('preserves a valid draft when an upload refresh keeps the case version', async () => {
    const addedFile = {
      materialId: '70000000-0000-4000-8000-000000000095',
      contentVersionId: '70000000-0000-4000-8000-000000000096',
      originalFilename: '待选补充判决书.pdf',
      mimeType: 'application/pdf',
    };
    api.uploadMaterialFile.mockResolvedValueOnce(addedFile);
    const correctable = {
      ...baseItem,
      canRegisterJudgment: false,
      canCorrectJudgment: true,
      judgment: { current: fact, history: [fact], availableFiles: [file] },
    };
    const wrapper = mountPanel(correctable);
    await wrapper.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await wrapper
      .get('[data-test="judgment-correction-reason"]')
      .setValue('保留仍有效的待提交草稿');
    const input = wrapper.get('[data-test="judgment-file-input"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        new File(['supplement'], addedFile.originalFilename, {
          type: 'application/pdf',
        }),
      ],
    });

    await input.trigger('change');
    await flushPromises();
    await wrapper.setProps({
      item: {
        ...correctable,
        judgment: {
          current: fact,
          history: [fact],
          availableFiles: [file, addedFile],
        },
      },
    });

    expect(
      (
        wrapper.get('[data-test="judgment-correction-reason"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe('保留仍有效的待提交草稿');
    expect(
      (wrapper.get('[data-test="judgment-date"]').element as HTMLInputElement)
        .value,
    ).toBe('2026-10-07');
    expect(
      (wrapper.get('[data-test="judgment-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('0.00');
    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
  });

  it('discards a stale correction draft after a known conflict and newer case read', async () => {
    api.correctCaseJudgment.mockRejectedValueOnce(
      new ApiError('Changed', 409, 'VERSION_CONFLICT'),
    );
    const before = {
      ...baseItem,
      canRegisterJudgment: false,
      canCorrectJudgment: true,
      judgment: { current: fact, history: [fact], availableFiles: [file] },
    };
    const wrapper = mountPanel(before);
    await wrapper
      .get('[data-test="judgment-correction-reason"]')
      .setValue('旧草稿原因');
    await wrapper.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();

    const newerFact = {
      ...fact,
      kind: 'CORRECT' as const,
      id: '70000000-0000-4000-8000-000000000092',
      priorFactId: fact.id,
      judgmentAmount: '42.50',
      fromVersion: 8,
      toVersion: 9,
      reason: '其他操作者已确认的更正',
    };
    await wrapper.setProps({
      item: {
        ...before,
        version: 8,
        judgment: {
          current: newerFact,
          history: [fact, newerFact],
          availableFiles: [file],
        },
      },
    });

    expect(
      (
        wrapper.get('[data-test="judgment-correction-reason"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe('');
    expect(
      (wrapper.get('[data-test="judgment-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('42.50');
    await wrapper.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseJudgment).toHaveBeenCalledTimes(1);

    await wrapper
      .get('[data-test="judgment-correction-reason"]')
      .setValue('已核对其他操作者的新事实后重新填写');
    await wrapper.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseJudgment).toHaveBeenCalledTimes(2);
    expect(api.correctCaseJudgment.mock.calls[1]?.[1]).toMatchObject({
      expectedVersion: 8,
      judgmentAmount: '42.50',
      reason: '已核对其他操作者的新事实后重新填写',
    });
  });

  it('keeps the accepted-command feedback when its refreshed case has a newer version', async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await wrapper
      .get('[data-test="judgment-amount-state"]')
      .setValue('PENDING');
    await wrapper.get('[data-test="paid-fee-state"]').setValue('PENDING');
    await wrapper.get('[data-test="judgment-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('判决命令已受理');

    await wrapper.setProps({
      item: {
        ...baseItem,
        version: 8,
        canRegisterJudgment: false,
        canCorrectJudgment: true,
        judgment: { current: fact, history: [fact], availableFiles: [file] },
      },
    });

    expect(wrapper.get('[role="status"]').text()).toContain('判决命令已受理');
  });

  it('retains the original unknown command when a newer case version is read', async () => {
    api.correctCaseJudgment
      .mockRejectedValueOnce(new ApiError('Gateway error', 502, 'BAD_GATEWAY'))
      .mockResolvedValueOnce({
        id: 'case-1',
        stage: 'WAITING_JUDGMENT',
        version: 9,
        judgmentId: '70000000-0000-4000-8000-000000000093',
        recordedAt: '2026-10-08T01:00:00.000Z',
      });
    const before = {
      ...baseItem,
      canRegisterJudgment: false,
      canCorrectJudgment: true,
      judgment: { current: fact, history: [fact], availableFiles: [file] },
    };
    const wrapper = mountPanel(before);
    await wrapper
      .get('[data-test="judgment-correction-reason"]')
      .setValue('本次请求的固定原因');
    await wrapper.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();
    const originalCall = api.correctCaseJudgment.mock.calls[0];

    const newerFact = {
      ...fact,
      kind: 'CORRECT' as const,
      id: '70000000-0000-4000-8000-000000000094',
      priorFactId: fact.id,
      judgmentAmount: '88.00',
      fromVersion: 8,
      toVersion: 9,
      reason: '刷新读取到的新事实',
    };
    await wrapper.setProps({
      item: {
        ...before,
        version: 8,
        judgment: {
          current: newerFact,
          history: [fact, newerFact],
          availableFiles: [file],
        },
      },
    });
    expect(wrapper.find('[data-test="judgment-retry"]').exists()).toBe(true);
    await wrapper.get('[data-test="judgment-retry"]').trigger('click');
    await flushPromises();

    expect(api.correctCaseJudgment).toHaveBeenCalledTimes(2);
    expect(api.correctCaseJudgment.mock.calls[1]).toEqual(originalCall);
    expect(originalCall?.[1]).toMatchObject({
      expectedVersion: 7,
      reason: '本次请求的固定原因',
    });
  });

  it('rejects uploads from both the input and handler while a command is submitting', async () => {
    let resolveCommand!: (value: unknown) => void;
    api.registerCaseJudgment.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await wrapper
      .get('[data-test="judgment-amount-state"]')
      .setValue('PENDING');
    await wrapper.get('[data-test="paid-fee-state"]').setValue('PENDING');
    await wrapper.get('[data-test="judgment-submit"]').trigger('click');
    await flushPromises();

    const input = wrapper.get('[data-test="judgment-file-input"]')
      .element as HTMLInputElement;
    expect(input.disabled).toBe(true);
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File(['unexpected'], 'extra.pdf', { type: 'application/pdf' }),
      ],
    });
    await wrapper.get('[data-test="judgment-file-input"]').trigger('change');
    await flushPromises();
    expect(api.uploadMaterialFile).not.toHaveBeenCalled();

    resolveCommand({
      id: 'case-1',
      stage: 'WAITING_JUDGMENT',
      version: 8,
      judgmentId: fact.id,
      recordedAt: fact.recordedAt,
    });
    await flushPromises();
  });

  it('rejects forbidden commands and refreshes after a version conflict', async () => {
    api.registerCaseJudgment.mockRejectedValueOnce(
      new ApiError('Forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const forbidden = mountPanel();
    await forbidden.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await forbidden
      .get('[data-test="judgment-amount-state"]')
      .setValue('PENDING');
    await forbidden.get('[data-test="paid-fee-state"]').setValue('PENDING');
    await forbidden.get('[data-test="judgment-submit"]').trigger('click');
    await flushPromises();
    expect(forbidden.get('[role="alert"]').text()).toContain('无权');
    expect(forbidden.find('[data-test="judgment-retry"]').exists()).toBe(false);

    api.registerCaseJudgment.mockRejectedValueOnce(
      new ApiError('Changed', 409, 'VERSION_CONFLICT'),
    );
    const stale = mountPanel();
    await stale.get('[data-test="judgment-date"]').setValue('2026-10-07');
    await stale.get('[data-test="judgment-amount-state"]').setValue('PENDING');
    await stale.get('[data-test="paid-fee-state"]').setValue('PENDING');
    await stale.get('[data-test="judgment-submit"]').trigger('click');
    await flushPromises();
    expect(stale.emitted('refresh')).toHaveLength(1);
    expect(stale.find('[data-test="judgment-retry"]').exists()).toBe(false);
  });
});
