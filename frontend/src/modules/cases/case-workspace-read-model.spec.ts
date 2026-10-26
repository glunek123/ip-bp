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
  it('keeps exact screenshot versions in technical details and shows an honest reference count', () => {
    const lead = leadFixture();
    lead.leadScreenshotContentVersionIds = [
      'screenshot-version-1',
      'screenshot-version-2',
    ];
    const section = buildCaseWorkspaceSections(
      caseFixture(),
      lead,
      'ready',
    ).find((entry) => entry.key === 'lead-info')!;
    const fields = section.groups.flatMap((group) => group.fields);
    expect(fields).toContainEqual(
      expect.objectContaining({ label: '来源截图', value: '2 个文件版本引用' }),
    );
    expect(fields).toContainEqual(
      expect.objectContaining({
        label: '来源截图版本标识',
        value: 'screenshot-version-1、screenshot-version-2',
        technical: true,
      }),
    );
    expect(
      JSON.stringify(fields.filter((field) => !field.technical)),
    ).not.toContain('screenshot-version-1');
  });
  it.each([
    ['ARCHIVED', '已归档'],
    ['WAITING_ARCHIVE', '待归档'],
    ['EXECUTING', '强制执行中'],
    ['WAITING_EXECUTION_FILING', '待申请执行'],
    ['WAITING_HEARING', '待开庭'],
    ['SECOND_INSTANCE', '二审'],
    ['PENDING_MATCH', '待匹配'],
  ] as const)(
    'uses the real %s stage without inventing current-step facts for missing information',
    (stage, label) => {
      const item = caseFixture();
      item.stage = stage;
      const sections = buildCaseWorkspaceSections(item, null, 'idle');
      expect(sections[0]?.groups[0]?.fields).toContainEqual({
        label: '当前阶段',
        value: label,
      });
      expect(
        sections
          .flatMap((section) => section.groups)
          .map((group) => group.title)
          .join(' '),
      ).not.toContain('（当前）');
      expect(sections[5]?.groups).toEqual([]);
      expect(sections[5]?.message).toBe('尚未登记相关资料');
    },
  );
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
      const sections = buildCaseWorkspaceSections(item, null, 'idle');
      expect(JSON.stringify(sections[4])).toContain('二审结果登记');
      expect(JSON.stringify(sections[3])).not.toContain('二审结果登记');
    },
  );
  it('projects eight ordered sections and keeps archived cases readable without stage inference', () => {
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
      'closure-info',
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
    expect(sections[6]?.groups[0]?.title).toBe('收款与结清状态');
    expect(sections[6]?.message).toBe('结案及归档尚未登记');
    expect(sections[7]?.message).toBeNull();
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
      expect(section.groups).toHaveLength(2);
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
    ).toHaveLength(2);
  });

  it('projects actual source fields and zero values, with capability-specific help', () => {
    const lead = leadFixture();
    lead.caseType = 'HEARING_REPRESENTATION';
    lead.infringementTypes = ['TRADEMARK', 'ART_COPYRIGHT', 'INVENTION_PATENT'];
    lead.products = [
      {
        id: 'product-1',
        position: 1,
        title: '合成商品',
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
    expect(section.groups.find((group) => group.id === 'lead')?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '案件类型', value: '代开庭' }),
        expect.objectContaining({
          label: '侵权类型',
          value: '商标权、美术作品著作权、发明专利权',
        }),
        expect.objectContaining({ label: '来源', value: '线上' }),
        expect.objectContaining({ label: '平台', value: '淘宝' }),
      ]),
    );
    expect(
      section.groups.find((group) => group.id === 'product:product-1')?.title,
    ).toBe('商品 1');
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
      court: null,
      recordedAt,
      files: [{ ...file, category: 'ACCEPTANCE_NOTICE' }],
    };
    item.acceptances = [item.acceptance];
    item.secondInstance.rounds = [
      { id: 'round-1', sequence: 1, sourceResultId: null, revokedAt: null },
    ];
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
    expect(JSON.stringify(section)).toContain('初次一审');
    expect(JSON.stringify(section)).not.toContain('发回重审');
    item.secondInstance.rounds[0]!.sourceResultId = 'remand-result';
    expect(
      JSON.stringify(buildCaseWorkspaceSections(item, null, 'idle')[2]),
    ).toContain('发回重审第 1 轮');
    item.secondInstance.rounds[0]!.sourceResultId = null;
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
    expect(JSON.stringify(sections[4])).toContain('判决更正');
    expect(JSON.stringify(sections[4])).toContain('判决登记（历史）');
    expect(JSON.stringify(sections[4])).toContain('选择撤销原因');
    expect(JSON.stringify(sections[4])).toContain('不适用（发回重审）');
    expect(JSON.stringify(sections[4])).toContain('已撤销');
    expect(JSON.stringify(sections[4])).toContain('结果撤销原因');
    expect(JSON.stringify(sections[2])).toContain('发回重审第 2 轮');
    expect(JSON.stringify(sections[2])).toContain(
      '尚未返回本轮正式立案或开庭资料',
    );
    expect(JSON.stringify(sections[3])).not.toContain('判决金额');
    expect(
      buildCaseWorkspaceEvents(item).filter(
        (value) => value.source === 'second-progress',
      ),
    ).toHaveLength(1);
  });

  it('assigns acceptance, hearing and judgments to their own first or remand round', () => {
    const item = caseFixture();
    item.secondInstance.rounds = [
      { id: 'round-1', sequence: 1, sourceResultId: null, revokedAt: null },
      {
        id: 'round-2',
        sequence: 2,
        sourceResultId: 'result-1',
        revokedAt: null,
      },
    ];
    const firstAcceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-01-10',
      courtCaseNo: '初审案号',
      court: null,
      recordedAt,
      files: [{ ...file, category: 'ACCEPTANCE_NOTICE' as const }],
    };
    const remandAcceptance = {
      ...firstAcceptance,
      id: 'acceptance-2',
      trialRoundId: 'round-2',
      acceptedAt: '2026-05-10',
      courtCaseNo: '重审案号',
      court: null,
    };
    item.acceptances = [firstAcceptance, remandAcceptance];
    item.acceptance = remandAcceptance;
    item.hearing.arrangements = [
      {
        id: 'hearing-1',
        trialRoundId: 'round-1',
        hearingAt: '2026-02-10',
        source: 'SCHEDULE',
        recordedAt,
      },
      {
        id: 'hearing-2',
        trialRoundId: 'round-2',
        hearingAt: '2026-06-10',
        source: 'SCHEDULE',
        recordedAt,
      },
    ];
    item.hearing.currentArrangement = item.hearing.arrangements[1]!;
    item.judgment.current = {
      id: 'judgment-2',
      trialRoundId: 'round-2',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: '2026-07-10',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 2,
      toVersion: 3,
      recordedAt,
      files: [file],
    };
    item.judgment.history = [item.judgment.current];
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    const firstInstance = JSON.stringify(sections[2]);
    const judgment = JSON.stringify(sections[4]);
    expect(firstInstance).toContain('初次一审');
    expect(firstInstance).toContain('正式立案日期');
    expect(firstInstance).toContain('初审案号');
    expect(firstInstance).toContain('开庭日期');
    expect(firstInstance).toContain('发回重审第 2 轮');
    expect(firstInstance).toContain('重审案号');
    expect(firstInstance).toContain('2026-06-10');
    expect(judgment).toContain('发回重审第 2 轮');
    expect(judgment).toContain('2026-07-10');
  });

  it('projects execution, null closure business day, immutable version history and archive without settlement inference', () => {
    const item = caseFixture();
    item.stage = 'ARCHIVED';
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
    expect(JSON.stringify(sections[5])).not.toContain('结案更正原因');
    expect(
      sections[5]?.groups
        .filter((group) => !group.historical)
        .map((group) => group.title)
        .sort(),
    ).toEqual(
      [
        '执行材料重新提交',
        '执行材料确认',
        '执行材料邮寄',
        '执行立案',
        '执行结束',
      ].sort(),
    );
    expect(
      sections[5]?.groups.some(
        (group) => group.title === '执行材料提交（历史）',
      ),
    ).toBe(true);
    expect(
      sections[5]?.groups.map((group) => group.title).join(' '),
    ).not.toContain('（当前）');
    expect(JSON.stringify(sections[6])).toContain('结案更正原因');
    expect(JSON.stringify(sections[6])).toContain('案件实收');
    expect(JSON.stringify(sections[6])).toContain('尚未接入案件级实收来源');
    expect(JSON.stringify(sections[6])).toContain('归档日期');
    expect(JSON.stringify(sections[6])).toContain('执行终本');
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

  it('projects contact changes and acceptance corrections with before and after values', () => {
    const item = caseFixture();
    item.defendants = [
      {
        id: 'defendant-1',
        kind: 'PERSON',
        name: '被告甲',
        idNo: null,
        phone: '222',
        address: '新地址',
      },
    ];
    const acceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-10-06',
      courtCaseNo: 'CN-2',
      court: null,
      recordedAt: '2026-10-05T01:00:00Z',
      recordedByUserId: 'operator-1',
      files: [],
    };
    item.acceptance = acceptance;
    item.acceptances = [acceptance];
    item.courtCaseNo = acceptance.courtCaseNo;
    item.judgmentNextStep.current = {
      id: 'choice-2',
      trialRoundId: 'round-2',
      judgmentId: 'judgment-2',
      next: 'APPEAL',
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      defendants: [],
      executionReadinessConfirmed: false,
      fromVersion: 1,
      toVersion: 2,
      recordedAt: '2026-10-05T00:30:00Z',
    };
    item.judgmentNextStep.history = [item.judgmentNextStep.current];
    item.secondInstance.acceptances = [
      {
        choiceId: 'choice-2',
        trialRoundId: 'round-2',
        acceptedAt: '2026-10-08',
        courtCaseNo: 'CN-SECOND-2',
        recordedAt: '2026-10-08T01:00:00Z',
      },
    ];
    item.recordEdits = {
      canUpdateDefendantContact: true,
      canCorrectAcceptance: true,
      defendantContacts: [
        {
          defendantId: 'defendant-1',
          contactRevision: 1,
          history: [
            {
              id: 'contact-change-1',
              fromRevision: 0,
              toRevision: 1,
              beforePhone: '111',
              beforeAddress: '旧地址',
              phone: '222',
              address: '新地址',
              recordedAt: '2026-10-05T02:00:00Z',
              recordedByUserId: 'operator-1',
            },
          ],
        },
      ],
      acceptanceCorrections: [
        {
          acceptanceId: 'acceptance-1',
          trialRoundId: 'round-1',
          acceptanceRevision: 1,
          originalAcceptedAt: '2026-10-05',
          originalCourtCaseNo: 'CN-1',
          history: [
            {
              id: 'acceptance-correction-1',
              priorCorrectionId: null,
              fromRevision: 0,
              toRevision: 1,
              acceptedAt: '2026-10-06',
              courtCaseNo: 'CN-2',
              reason: '登记信息订正',
              recordedAt: '2026-10-05T03:00:00Z',
              recordedByUserId: 'operator-1',
            },
          ],
        },
      ],
      canSaveSecondInstanceAcceptance: true,
      secondInstanceAcceptances: [
        {
          choiceId: 'choice-2',
          trialRoundId: 'round-2',
          acceptanceRevision: 2,
          acceptedAt: '2026-10-08',
          courtCaseNo: 'CN-SECOND-2',
          canEdit: true,
          history: [
            {
              id: 'second-acceptance-change-1',
              priorChangeId: null,
              fromRevision: 0,
              toRevision: 1,
              acceptedAt: '2026-10-07',
              courtCaseNo: 'CN-SECOND-1',
              reason: null,
              recordedAt: '2026-10-07T01:00:00Z',
              recordedByUserId: 'operator-1',
            },
            {
              id: 'second-acceptance-change-2',
              priorChangeId: 'second-acceptance-change-1',
              fromRevision: 1,
              toRevision: 2,
              acceptedAt: '2026-10-08',
              courtCaseNo: 'CN-SECOND-2',
              reason: '更正案号',
              recordedAt: '2026-10-08T01:00:00Z',
              recordedByUserId: 'operator-1',
            },
          ],
        },
      ],
    };

    const events = buildCaseWorkspaceEvents(item);
    const originalAcceptance = events.find(
      (event) => event.source === 'acceptance' && event.id === 'acceptance-1',
    );
    expect(originalAcceptance?.businessAt).toBe('2026-10-05');
    expect(originalAcceptance?.fields.map((field) => field.value)).toContain(
      'CN-1',
    );
    expect(
      originalAcceptance?.fields.map((field) => field.value),
    ).not.toContain('CN-2');
    expect(
      events.find((event) => event.id === 'acceptance-correction-1')
        ?.businessAt,
    ).toBe('2026-10-06');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'defendant-contact',
          id: 'contact-change-1',
          fields: expect.arrayContaining([
            expect.objectContaining({ label: '更正前电话', value: '111' }),
            expect.objectContaining({ label: '更正后电话', value: '222' }),
            expect.objectContaining({ label: '更正前地址', value: '旧地址' }),
            expect.objectContaining({ label: '更正后地址', value: '新地址' }),
          ]),
        }),
        expect.objectContaining({
          source: 'acceptance-correction',
          id: 'acceptance-correction-1',
          fields: expect.arrayContaining([
            expect.objectContaining({
              label: '更正前受理日期',
              value: '2026-10-05',
            }),
            expect.objectContaining({ label: '更正前法院案号', value: 'CN-1' }),
            expect.objectContaining({
              label: '更正后受理日期',
              value: '2026-10-06',
            }),
            expect.objectContaining({
              label: '更正原因',
              value: '登记信息订正',
            }),
          ]),
        }),
        expect.objectContaining({
          source: 'second-instance-acceptance',
          id: 'second-acceptance-change-2',
          fields: expect.arrayContaining([
            expect.objectContaining({
              label: '二审受理日期',
              value: '2026-10-08',
            }),
            expect.objectContaining({
              label: '二审案号',
              value: 'CN-SECOND-2',
            }),
            expect.objectContaining({ label: '更正原因', value: '更正案号' }),
          ]),
        }),
      ]),
    );
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(
      JSON.stringify(
        sections.find((section) => section.key === 'second-instance'),
      ),
    ).toContain('CN-SECOND-2');
    item.secondInstance.acceptances = [
      {
        choiceId: 'second-choice-1',
        trialRoundId: 'round-1',
        acceptedAt: null,
        courtCaseNo: null,
        recordedAt: '2026-10-09T03:00:00Z',
      },
    ];
    const clearedSection = buildCaseWorkspaceSections(item, null, 'idle').find(
      (section) => section.key === 'second-instance',
    );
    expect(clearedSection?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: '二审受理信息',
          fields: expect.arrayContaining([
            expect.objectContaining({ label: '二审受理日期', value: '未确定' }),
            expect.objectContaining({ label: '二审案号', value: '未提供' }),
          ]),
        }),
      ]),
    );
    expect(
      JSON.stringify(
        sections.find((section) => section.key === 'first-instance'),
      ),
    ).toContain('CN-2');
    expect(
      sections.find((section) => section.key === 'first-instance')?.groups,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'first-instance-round:round-1:acceptance-correction-1',
        }),
      ]),
    );
  });
});
