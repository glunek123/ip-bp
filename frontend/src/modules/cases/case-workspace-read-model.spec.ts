import { describe, expect, it } from 'vitest';
import type { CaseDetail, CaseFile } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import {
  buildCaseWorkspaceEvents,
  buildCaseWorkspaceSections,
  workspaceDate,
} from './case-workspace-read-model';

function caseFixture(): CaseDetail {
  return {
    id: 'case-1',
    businessNo: 'CA-1',
    stage: 'PENDING_MATCH',
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    owner: { id: 'owner-1', displayName: '负责人甲' },
    department: { id: 'department-1', name: '部门甲' },
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'holder-1', name: '权利人甲' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'notary-1', businessNo: 'NZ-1' },
    canMatch: false,
    canSubmitComplaint: false,
    canConfirmComplaint: false,
    canMailComplaint: false,
    canSubmitFiling: false,
    canRegisterAcceptance: false,
    canUploadAcceptanceMaterials: false,
    canScheduleHearing: false,
    canCorrectHearing: false,
    canRegisterJudgment: false,
    canCorrectJudgment: false,
    canChooseJudgmentNextStep: false,
    canRevokeJudgmentNextStep: false,
    canSaveSecondInstance: false,
    canRegisterSecondInstanceResult: false,
    canRevokeSecondInstanceResult: false,
    canSubmitExecution: false,
    canConfirmExecution: false,
    canMailExecution: false,
    canSubmitExecutionFiling: false,
    canFinishExecution: false,
    canRecordClosure: false,
    canCorrectClosure: false,
    canArchive: false,
    canCorrectArchive: false,
    courtCaseNo: null,
    matchedAt: null,
    matchedOn: null,
    defendants: [],
    lawyers: [],
    fees: [],
    certificate: {
      certificateNo: 'Z-1',
      certificateDate: '2026-10-01',
      issuedAt: '2026-10-01T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
    complaint: null,
    complaintConfirmation: null,
    complaintMailing: null,
    filingSubmission: null,
    acceptance: null,
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
    judgment: { current: null, history: [], availableFiles: [] },
    judgmentNextStep: { current: null, history: [], revocations: [] },
    acceptances: [],
    secondInstance: {
      currentTrialRoundId: null,
      currentProgress: null,
      currentResult: null,
      rounds: [],
      progresses: [],
      results: [],
      revocations: [],
    },
    executionSubmission: { current: null, submissions: [], availableFiles: [] },
    executionConfirmation: null,
    executionMailing: null,
    executionFiling: null,
    executionFinish: null,
    closure: null,
    archive: null,
  };
}
function leadFixture(): LeadDetail {
  return {
    id: 'lead-1',
    businessNo: 'LD-1',
    departmentId: 'department-1',
    customerId: 'customer-1',
    rightsHolderId: 'holder-1',
    responsibleUserId: 'owner-1',
    teamId: null,
    status: 'TRANSFERRED_TO_NOTARY',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-09-01',
    shopName: '真实店铺',
    shopExternalId: null,
    needDisclose: false,
    remark: null,
    creationChannel: 'INTERNAL',
    externalSourceRef: null,
    products: [],
    leadScreenshotContentVersionIds: [],
    version: 3,
    pushedAt: null,
    pushedByUserId: null,
    pushedByDisplayName: null,
    reviewDecision: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    displayNames: {
      customerName: '客户甲',
      rightsHolderName: '权利人甲',
      responsibleUserName: '负责人甲',
    },
    capabilities: {
      edit: false,
      push: false,
      withdrawApply: false,
      evidenceDecide: false,
      transferToNotary: false,
      createEvidenceBatch: false,
    },
    evidenceDecision: null,
    pendingWithdrawalApplication: null,
    history: [],
    notaryMatters: [],
  };
}
const file: CaseFile = {
  materialId: 'material-1',
  contentVersionId: 'exact-version-1',
  originalFilename: '真实文件.pdf',
  mimeType: 'application/pdf',
};
const recordedAt = '2026-10-02T00:00:00Z';

describe('case workspace read model', () => {
  it.each(['CHANGE', 'AFFIRM'] as const)(
    'projects a current %s result amount while omitting unreturned audit fields',
    (result) => {
      const item = caseFixture();
      item.secondInstance.currentResult = {
        id: 'result-1',
        trialRoundId: 'round-1',
        choiceId: 'choice-1',
        judgmentId: 'judgment-1',
        progressId: null,
        result,
        resultReceivedAt: '2026-10-01',
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '0.00',
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        fromVersion: 1,
        toVersion: 2,
        recordedAt,
        files: [file],
        childTrialRoundId: null,
        revocationId: null,
      };
      item.secondInstance.revocations = [
        {
          id: 'revoke-old',
          resultId: 'old-result',
          fromVersion: 1,
          toVersion: 2,
          recordedAt,
        },
      ];
      const events = buildCaseWorkspaceEvents(item);
      expect(
        events.find((event) => event.source === 'second-result')?.fields,
      ).toContainEqual({ label: '判决金额', value: '0.00 元' });
      expect(
        events
          .find((event) => event.source === 'second-revocation')
          ?.fields.map((field) => field.label),
      ).not.toContain('撤销原因');
      expect(
        events
          .find((event) => event.source === 'second-result')
          ?.fields.map((field) => field.label),
      ).not.toContain('记录人');
      expect(
        JSON.stringify(buildCaseWorkspaceSections(item, null, 'idle')[3]),
      ).toContain('二审结果登记（当前）');
    },
  );
  it('projects exactly seven ordered sections and missing facts without stage inference', () => {
    const item = caseFixture();
    item.stage = 'ARCHIVED';
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(sections.map((value) => value.key)).toEqual([
      'case-info',
      'lead-info',
      'first-instance',
      'second-instance',
      'judgment',
      'execution',
      'timeline',
    ]);
    expect(sections[0]?.groups[0]?.fields).toContainEqual({
      label: '法院案号',
      value: '未登记',
    });
    expect(sections[0]?.groups[0]?.fields).toContainEqual({
      label: '实际匹配日期',
      value: '未记录',
    });
    expect(sections[2]?.message).toBe('尚未登记相关资料');
    expect(sections[4]?.groups[0]?.fields).toContainEqual({
      label: '登记状态',
      value: '未登记',
    });
    expect(sections[6]?.message).toBeNull();
    expect(buildCaseWorkspaceEvents(item)).toHaveLength(1);
  });

  it('keeps null business dates separate from known recordedAt and formats instants in Shanghai', () => {
    const item = caseFixture();
    item.matchedAt = recordedAt;
    const events = buildCaseWorkspaceEvents(item);
    expect(events.find((value) => value.source === 'match')).toMatchObject({
      businessAt: null,
      recordedAt,
    });
    expect(workspaceDate(null)).toBe('未记录');
    expect(workspaceDate('2026-10-02')).toBe('2026-10-02');
    expect(workspaceDate('2026-10-01T18:00:00Z')).toBe('2026/10/02 02:00:00');
  });

  it('distinguishes lead access states and rejects stale or mismatched source projection', () => {
    const lead = leadFixture();
    for (const state of ['idle', 'loading', 'denied', 'failed'] as const) {
      const section = buildCaseWorkspaceSections(
        caseFixture(),
        lead,
        state,
      )[1]!;
      expect(section.message).not.toBeNull();
      expect(section.groups).toHaveLength(1);
      expect(JSON.stringify(section)).not.toContain('真实店铺');
    }
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'denied')[1]?.message,
    ).toContain('无来源线索读取权限');
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'failed')[1]?.message,
    ).toContain('加载失败');
    lead.id = 'other-lead';
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'ready')[1]?.groups,
    ).toHaveLength(1);
  });

  it('projects actual source fields and zero values, with capability-specific help', () => {
    const lead = leadFixture();
    lead.products = [
      {
        id: 'product-1',
        position: 0,
        title: null,
        url: null,
        quantity: 0,
        unitPrice: '0.00',
        commentCount: 0,
        estimatedAmount: '0.00',
      },
    ];
    const section = buildCaseWorkspaceSections(
      caseFixture(),
      lead,
      'ready',
    )[1]!;
    expect(section.message).toBeNull();
    expect(JSON.stringify(section)).toContain('真实店铺');
    expect(JSON.stringify(section)).toContain('0.00 元');
    expect(section.help).toContain('来源线索只读');
    lead.capabilities.edit = true;
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'ready')[1]?.help,
    ).toContain('既有表单');
  });

  it('preserves all first-instance facts, exact files, current deduplication and corrections', () => {
    const item = caseFixture();
    item.complaint = {
      amountState: 'KNOWN',
      amount: '0.00',
      pendingReason: null,
      submittedAt: recordedAt,
      submittedByUserId: 'user-1',
      complaintFiles: [file],
      authorizationFiles: [],
    };
    item.complaintConfirmation = {
      confirmedComplaintContentVersionId: file.contentVersionId,
      amountState: 'PENDING',
      amount: null,
      pendingReason: '待核实',
      changeNote: null,
      confirmDisclose: false,
      confirmedAt: recordedAt,
      confirmedByUserId: 'user-1',
      complaintFile: file,
    };
    item.complaintMailing = {
      mailedAt: '2026-09-30',
      recordedAt,
      recordedByUserId: 'user-1',
      actorType: 'INTERNAL',
      receiptFiles: [file],
    };
    item.filingSubmission = {
      court: { id: 'court-1', name: '法院甲' },
      submittedAt: '2026-10-01',
      recordedAt,
      recordedByUserId: 'user-1',
      mediationNo: null,
      evidenceFiles: [file],
      screenshotFiles: [],
    };
    item.acceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-10-01',
      courtCaseNo: '真实案号',
      recordedAt,
      files: [{ ...file, category: 'ACCEPTANCE_NOTICE' }],
    };
    item.acceptances = [item.acceptance];
    item.acceptanceMaterials.PAYMENT_LIST.later = [file];
    item.hearing.currentArrangement = {
      id: 'hearing-1',
      trialRoundId: 'round-1',
      hearingAt: null,
      source: 'SCHEDULE',
      recordedAt,
    };
    item.hearing.arrangements = [item.hearing.currentArrangement];
    item.hearing.currentAdvance = {
      id: 'advance-1',
      trialRoundId: 'round-1',
      arrangementId: 'hearing-1',
      dueAt: recordedAt,
      executedAt: recordedAt,
    };
    item.hearing.advances = [item.hearing.currentAdvance];
    item.hearing.corrections = [
      {
        id: 'correction-1',
        priorArrangementId: 'hearing-1',
        priorAdvanceId: 'advance-1',
        newArrangementId: 'hearing-2',
        resultStage: 'WAITING_HEARING',
        recordedAt,
        reason: '真实更正原因',
      },
    ];
    const before = structuredClone(item);
    const events = buildCaseWorkspaceEvents(item);
    expect(
      events.filter((value) => value.source === 'acceptance'),
    ).toHaveLength(1);
    expect(events.filter((value) => value.source === 'hearing')).toHaveLength(
      1,
    );
    expect(
      events.find((value) => value.source === 'complaint')?.fields,
    ).toContainEqual({ label: '诉请金额', value: '0.00 元' });
    expect(
      events.find((value) => value.source === 'complaint-confirmation')?.fields,
    ).toContainEqual({ label: '确认诉请金额', value: '待确认' });
    const section = buildCaseWorkspaceSections(item, null, 'idle')[2]!;
    expect(JSON.stringify(section)).toContain('exact-version-1');
    expect(JSON.stringify(section)).toContain('缴费清单（后补）');
    expect(JSON.stringify(section)).toContain('真实更正原因');
    expect(item).toEqual(before);
  });

  it('keeps judgment and second-instance current facts, original history and revocations', () => {
    const item = caseFixture();
    item.judgment.current = {
      id: 'judgment-2',
      trialRoundId: 'round-1',
      kind: 'CORRECT',
      priorFactId: 'judgment-1',
      judgmentReceivedAt: '2026-10-01',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 2,
      toVersion: 3,
      recordedAt,
      files: [file],
      reason: '金额更正',
    };
    item.judgment.history = [
      {
        ...item.judgment.current,
        id: 'judgment-1',
        kind: 'REGISTER',
        priorFactId: null,
      },
      item.judgment.current,
    ];
    item.judgmentNextStep.current = {
      id: 'choice-1',
      trialRoundId: 'round-1',
      judgmentId: 'judgment-2',
      next: 'APPEAL',
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      defendants: [],
      executionReadinessConfirmed: false,
      fromVersion: 3,
      toVersion: 4,
      recordedAt,
    };
    item.judgmentNextStep.history = [item.judgmentNextStep.current];
    item.judgmentNextStep.revocations = [
      {
        id: 'choice-revocation',
        choiceId: 'choice-old',
        fromVersion: 4,
        toVersion: 5,
        recordedAt,
        reason: '选择撤销原因',
      },
    ];
    item.secondInstance.currentProgress = {
      id: 'progress-1',
      trialRoundId: 'round-1',
      choiceId: 'choice-1',
      priorProgressId: null,
      hearingAt: null,
      hearingPlace: null,
      judgeName: null,
      fromVersion: 5,
      toVersion: 6,
      recordedAt,
      documentFiles: [file],
      serviceFiles: [],
    };
    item.secondInstance.progresses = [item.secondInstance.currentProgress];
    item.secondInstance.results = [
      {
        id: 'result-1',
        trialRoundId: 'round-1',
        choiceId: 'choice-1',
        judgmentId: 'judgment-2',
        progressId: 'progress-1',
        result: 'REMAND',
        resultReceivedAt: '2026-10-01',
        judgmentAmountState: null,
        judgmentAmount: null,
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        fromVersion: 6,
        toVersion: 7,
        recordedAt,
        files: [file],
        childTrialRoundId: 'round-2',
        revocationId: 'revocation-1',
      },
    ];
    item.secondInstance.revocations = [
      {
        id: 'revocation-1',
        resultId: 'result-1',
        fromVersion: 7,
        toVersion: 8,
        recordedAt,
        reason: '结果撤销原因',
      },
    ];
    item.secondInstance.rounds = [
      {
        id: 'round-2',
        sequence: 2,
        sourceResultId: 'result-1',
        revokedAt: recordedAt,
      },
    ];
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(JSON.stringify(sections[4])).toContain('判决更正（当前）');
    expect(JSON.stringify(sections[4])).toContain('判决登记（历史）');
    expect(JSON.stringify(sections[4])).toContain('选择撤销原因');
    expect(JSON.stringify(sections[3])).toContain('不适用（发回重审）');
    expect(JSON.stringify(sections[3])).toContain('已撤销');
    expect(JSON.stringify(sections[3])).toContain('结果撤销原因');
    expect(
      buildCaseWorkspaceEvents(item).filter(
        (value) => value.source === 'second-progress',
      ),
    ).toHaveLength(1);
  });

  it('projects execution, null closure business day, immutable version history and archive without settlement inference', () => {
    const item = caseFixture();
    item.executionSubmission.current = {
      id: 'submission-2',
      trialRoundId: 'round-1',
      judgmentNextStepId: 'choice-1',
      secondInstanceResultId: null,
      priorSubmissionId: 'submission-1',
      changeReason: '材料更正',
      fromVersion: 1,
      toVersion: 2,
      submittedAt: recordedAt,
      files: [{ ...file, uploadedAt: recordedAt }],
    };
    item.executionSubmission.submissions = [
      {
        ...item.executionSubmission.current,
        id: 'submission-1',
        priorSubmissionId: null,
        changeReason: null,
      },
      item.executionSubmission.current,
    ];
    item.executionConfirmation = {
      id: 'confirmation-1',
      submissionId: 'submission-2',
      confirmedAt: recordedAt,
      confirmedByUserId: 'user-1',
      files: item.executionSubmission.current.files,
    };
    item.executionMailing = {
      id: 'mailing-1',
      confirmationId: 'confirmation-1',
      mailedAt: '2026-10-01',
      recordedAt,
      files: [file],
    };
    item.executionFiling = {
      id: 'filing-1',
      mailingId: 'mailing-1',
      submittedAt: '2026-10-01',
      recordedAt,
      files: [file],
    };
    item.executionFinish = {
      id: 'finish-1',
      filingId: 'filing-1',
      finishedAt: '2026-10-01',
      reason: '终结执行',
      basisNote: null,
      recordedAt,
      files: [file],
    };
    const closure = {
      id: 'closure-version-2',
      kind: 'CORRECT',
      priorVersionId: 'closure-version-1',
      finishId: 'finish-1',
      fromVersion: 4,
      toVersion: 5,
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: null,
      correctionReason: '结案更正原因',
      recordedAt,
      recordedByUserId: 'user-1',
      files: [file],
    } satisfies NonNullable<CaseDetail['closure']>['current'];
    item.closure = {
      id: 'closure-1',
      finishId: 'finish-1',
      current: closure,
      history: [
        {
          ...closure,
          id: 'closure-version-1',
          kind: 'REGISTER',
          priorVersionId: null,
          correctionReason: null,
        },
        closure,
      ],
    };
    const archive = {
      id: 'archive-version-1',
      kind: 'ARCHIVE',
      priorVersionId: null,
      closureVersionId: closure.id,
      fromVersion: 5,
      toVersion: 6,
      archiveAt: '2026-10-01',
      archiveType: 'EXECUTION_CLOSED',
      archiveReason: '归档原因',
      correctionReason: null,
      recordedAt,
      recordedByUserId: 'user-1',
    } satisfies NonNullable<CaseDetail['archive']>['current'];
    item.archive = {
      id: 'archive-1',
      closureId: 'closure-1',
      closureVersionId: closure.id,
      current: archive,
      history: [archive],
    };
    const events = buildCaseWorkspaceEvents(item);
    expect(
      events.filter((value) => value.source === 'execution-submission'),
    ).toHaveLength(2);
    expect(events.filter((value) => value.source === 'closure')).toHaveLength(
      2,
    );
    expect(events.find((value) => value.id === closure.id)).toMatchObject({
      businessAt: null,
      recordedAt,
    });
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(JSON.stringify(sections[5])).toContain('结案更正原因');
    expect(JSON.stringify(sections[0])).toContain('归档原因');
    expect(JSON.stringify(sections)).not.toContain('已结清');
    expect(
      events
        .filter((value) => value.source.startsWith('execution-'))
        .map((value) => value.source),
    ).toEqual(
      expect.arrayContaining([
        'execution-confirmation',
        'execution-mailing',
        'execution-filing',
        'execution-finish',
      ]),
    );
  });

  it('sorts by actual record time with deterministic source/id tie breaks, irrespective of business dates', () => {
    const item = caseFixture();
    item.matchedOn = '2020-01-01';
    item.hearing.arrangements = ['b', 'a'].map((id) => ({
      id,
      trialRoundId: 'round-1',
      hearingAt: '2030-01-01T00:00:00Z',
      source: 'SCHEDULE',
      recordedAt: item.createdAt,
    }));
    const events = buildCaseWorkspaceEvents(item);
    expect(events.map((value) => `${value.source}:${value.id}`)).toEqual([
      'case:case-1',
      'hearing:a',
      'hearing:b',
      'match:case-1',
    ]);
    expect(events.at(-1)?.recordedAt).toBeNull();
  });
});
