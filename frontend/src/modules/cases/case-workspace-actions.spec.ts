import { describe, expect, it } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import {
  parseCaseActionIntent,
  primaryCaseAction,
  resolveCaseDetailActions,
} from './case-workspace-actions';

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
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
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
  executionSubmission: { current: null, submissions: [], availableFiles: [] },
  canConfirmExecution: false,
  executionConfirmation: null,
  executionMailing: null,
  executionFiling: null,
  executionFinish: null,
  closure: null,
  archive: null,
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
    files: [],
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
};

function withJudgment(): CaseDetail {
  const item = structuredClone(baseItem);
  item.judgment.current = {
    id: 'judgment-1',
    trialRoundId: 'round-1',
    kind: 'REGISTER',
    priorFactId: null,
    judgmentReceivedAt: '2026-10-01',
    judgmentAmountState: 'PENDING',
    judgmentAmount: null,
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
    fromVersion: 6,
    toVersion: 7,
    recordedAt: '2026-10-01T00:00:00Z',
    files: [],
  };
  return item;
}
function external(stage: CaseDetail['stage']): CaseDetail {
  return {
    ...structuredClone(baseItem),
    stage,
    sourceLead: null,
    sourceNotaryMatter: null,
    certificate: null,
    fees: [],
    origin: {
      kind: 'EXTERNAL_ENTRY',
      entryId: 'entry-1',
      entryKind: 'HISTORICAL_BACKFILL',
      initialStage: stage,
      stageReachedOn: '2026-10-01',
      source: '合成历史来源',
      reason: '测试',
      recordedAt: '2026-10-01T00:00:00Z',
      recordedByUserId: 'user-1',
      known: {
        courtId: null,
        courtCaseNo: null,
        acceptedOn: null,
        secondInstanceAcceptedOn: null,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
    },
  };
}
const intents = (item: CaseDetail) =>
  resolveCaseDetailActions(item).map((action) => action.intent);

describe('case workspace action resolution', () => {
  it.each([
    undefined,
    null,
    '',
    'toString',
    '__proto__',
    'jump-stage',
    ['archive'],
    { action: 'archive' },
  ])('rejects a non-whitelisted scalar intent %s', (value) =>
    expect(parseCaseActionIntent(value)).toBeUndefined(),
  );
  it('keeps registration, correction, next-step choice and revocation distinct', () => {
    const item = {
      ...structuredClone(baseItem),
      canRegisterJudgment: true,
      canCorrectJudgment: true,
      canChooseJudgmentNextStep: true,
    };
    expect(intents(item)).toEqual(['register-judgment']);
    const registered = {
      ...withJudgment(),
      canRegisterJudgment: true,
      canCorrectJudgment: true,
      canChooseJudgmentNextStep: true,
    };
    expect(intents(registered)).toEqual([
      'correct-judgment',
      'choose-next-step',
    ]);
    expect(
      primaryCaseAction(registered.stage, resolveCaseDetailActions(registered))
        ?.intent,
    ).toBe('correct-judgment');
    registered.judgmentNextStep.current = {
      id: 'choice-1',
      trialRoundId: 'round-1',
      judgmentId: 'judgment-1',
      next: 'EXECUTION',
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      defendants: [],
      executionReadinessConfirmed: true,
      fromVersion: 7,
      toVersion: 8,
      recordedAt: '2026-10-01T00:00:00Z',
    };
    registered.stage = 'WAITING_EXECUTION_DOCUMENTS';
    registered.canRevokeJudgmentNextStep = true;
    expect(intents(registered)).toEqual(['revoke-next-step']);
    registered.canRevokeJudgmentNextStep = false;
    expect(intents(registered)).toEqual([]);
  });
  it('requires the active appeal round and handles an explicit historical second-instance root', () => {
    const item = external('SECOND_INSTANCE');
    item.canSaveSecondInstance = true;
    item.canRegisterSecondInstanceResult = true;
    expect(intents(item)).toEqual([]);
    item.secondInstance.currentTrialRoundId = 'round-1';
    item.secondInstance.rounds = [
      { id: 'round-1', sequence: 1, sourceResultId: null, revokedAt: null },
    ];
    expect(intents(item)).toEqual(['second-instance']);
    item.secondInstance.rounds[0]!.sourceResultId = 'another-result';
    expect(intents(item)).toEqual([]);
  });
  it('allows historical root successors only with the corresponding capability', () => {
    const item = external('EXECUTING');
    item.canFinishExecution = true;
    expect(intents(item)).toEqual(['finish']);
    item.canFinishExecution = false;
    expect(intents(item)).toEqual([]);
    const hearing = external('WAITING_HEARING');
    hearing.canScheduleHearing = true;
    expect(intents(hearing)).toEqual(['hearing']);
    // Mutate through the discriminated root rather than invent a predecessor.
    if (hearing.origin?.kind === 'EXTERNAL_ENTRY')
      hearing.origin.initialStage = 'WAITING_JUDGMENT';
    expect(intents(hearing)).toEqual([]);
  });
  it('requires a closure fact before archive and keeps archive correction separate', () => {
    const item = external('WAITING_ARCHIVE');
    item.canArchive = true;
    item.canRecordClosure = true;
    expect(intents(item)).toEqual(['record-closure']);
    item.closure = {
      id: 'closure-1',
      finishId: null,
      history: [],
      current: {
        id: 'closure-version-1',
        kind: 'REGISTER',
        priorVersionId: null,
        finishId: null,
        fromVersion: 1,
        toVersion: 2,
        closeAt: '2026-10-01',
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        correctionReason: null,
        recordedAt: '2026-10-01T00:00:00Z',
        recordedByUserId: 'user-1',
        files: [],
      },
    };
    item.canCorrectClosure = true;
    expect(intents(item)).toEqual(['correct-closure', 'archive']);
    expect(
      primaryCaseAction(item.stage, resolveCaseDetailActions(item))?.intent,
    ).toBe('archive');
    item.stage = 'ARCHIVED';
    item.canCorrectArchive = true;
    expect(intents(item)).toEqual([]);
    item.archive = {
      id: 'archive-1',
      closureId: 'closure-1',
      closureVersionId: 'closure-version-1',
      history: [],
      current: {
        id: 'archive-version-1',
        kind: 'ARCHIVE',
        priorVersionId: null,
        closureVersionId: 'closure-version-1',
        fromVersion: 2,
        toVersion: 3,
        archiveAt: '2026-10-01',
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: '合成原因',
        correctionReason: null,
        recordedAt: '2026-10-01T00:00:00Z',
        recordedByUserId: 'user-1',
      },
    };
    expect(intents(item)).toEqual(['correct-archive']);
  });
});
