import { effectScope, shallowRef, watch } from 'vue';
import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type { LeadPlatform } from './leads';

export type CaseStage =
  | 'PENDING_MATCH'
  | 'WAITING_COMPLAINT'
  | 'WAITING_COMPLAINT_CONFIRMATION'
  | 'WAITING_COMPLAINT_STAMP'
  | 'WAITING_FILING'
  | 'WAITING_FORMAL_ACCEPTANCE'
  | 'WAITING_HEARING'
  | 'WAITING_JUDGMENT'
  | 'SECOND_INSTANCE'
  | 'WAITING_EXECUTION_DOCUMENTS'
  | 'WAITING_EXECUTION_CONFIRMATION'
  | 'WAITING_EXECUTION_STAMP'
  | 'WAITING_EXECUTION_FILING'
  | 'EXECUTING'
  | 'WAITING_ARCHIVE'
  | 'ARCHIVED';
export type CaseView = 'mine' | 'department';
export type CaseStageFilter = CaseStage | 'all';
export type CaseStageGroup = 'COMPLAINT_PREPARATION' | 'EXECUTION_PREPARATION';
export type CaseSummary = {
  id: string;
  businessNo: string;
  stage: CaseStage;
  createdAt: string;
  version: number;
  owner: { id: string; displayName: string };
  canMatch: boolean;
  canSubmitExecution: boolean;
  canConfirmExecution: boolean;
  canMailExecution: boolean;
  canSubmitExecutionFiling: boolean;
  canFinishExecution: boolean;
  canRecordClosure: boolean;
  canCorrectClosure: boolean;
  canArchive: boolean;
  canCorrectArchive: boolean;
  displaySummary: CaseDisplaySummary;
  canSubmitComplaint: boolean;
  canConfirmComplaint: boolean;
  canMailComplaint: boolean;
  canSubmitFiling: boolean;
  canRegisterAcceptance: boolean;
  canUploadAcceptanceMaterials: boolean;
  canScheduleHearing: boolean;
  canCorrectHearing: boolean;
  canRegisterJudgment: boolean;
  canCorrectJudgment: boolean;
  canChooseJudgmentNextStep: boolean;
  canRevokeJudgmentNextStep: boolean;
  canSaveSecondInstance: boolean;
  canRegisterSecondInstanceResult: boolean;
  canRevokeSecondInstanceResult: boolean;
  sourceLead: { id: string; businessNo: string };
  sourceNotaryMatter: { id: string; businessNo: string };
};
export type CaseList = {
  items: CaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CaseStage, number>;
};
export type CaseDefendant = {
  id: string;
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string | null;
  phone: string | null;
  address: string | null;
};
export type CaseLawyer = {
  id: string;
  fullName: string;
  lawFirm: string | null;
  phone: string | null;
  role: 'PRIMARY';
  assignedAt: string;
};
export type CaseDetail = Omit<CaseSummary, 'displaySummary'> & {
  courtCaseNo: string | null;
  department: { id: string; name: string };
  customer: { id: string; name: string };
  rightsHolder: { id: string; name: string };
  certificate: {
    certificateNo: string;
    certificateDate: string;
    issuedAt: string;
    needDisclose: boolean;
    files: CaseFile[];
    disclosureFiles: CaseFile[];
  };
  fees: Array<{
    category: 'NOTARY' | 'SAMPLE' | 'INVESTIGATION' | 'DISCLOSURE';
    state: 'KNOWN' | 'PENDING';
    amount: string | null;
    sourceType: 'NOTARY_CERTIFICATE_FEE' | 'NOTARY_MATTER_EVIDENCE';
    sourceId: string;
  }>;
  defendants: CaseDefendant[];
  lawyers: CaseLawyer[];
  matchedAt: string | null;
  matchedOn: string | null;
  complaint: ComplaintSubmission | null;
  complaintConfirmation: ComplaintConfirmation | null;
  complaintMailing: CaseComplaintMailing | null;
  filingSubmission: CaseFilingSubmission | null;
  acceptance: CaseAcceptance | null;
  acceptanceMaterials: AcceptanceMaterials;
  hearing: CaseHearing;
  judgment: CaseJudgment;
  judgmentNextStep: CaseJudgmentNextStep;
  acceptances: Array<CaseAcceptanceHistory>;
  secondInstance: CaseSecondInstance;
  executionSubmission: ExecutionSubmissionState;
  canConfirmExecution: boolean;
  executionConfirmation: ExecutionConfirmation | null;
  executionMailing: ExecutionMailing | null;
  executionFiling: ExecutionFiling | null;
  executionFinish: ExecutionFinish | null;
  closure: CaseClosure | null;
  archive: CaseArchive | null;
};
export type ExecutionSubmissionFile = CaseFile & { uploadedAt: string };
export type ExecutionSubmissionSummary = {
  id: string;
  trialRoundId: string;
  judgmentNextStepId: string;
  secondInstanceResultId: string | null;
  priorSubmissionId: string | null;
  changeReason: string | null;
  fromVersion: number;
  toVersion: number;
  submittedAt: string;
  files: ExecutionSubmissionFile[];
};
export type ExecutionSubmissionState = {
  current: ExecutionSubmissionSummary | null;
  submissions: ExecutionSubmissionSummary[];
  availableFiles: ExecutionSubmissionFile[];
};
export type ExecutionConfirmation = {
  id: string;
  submissionId: string;
  confirmedAt: string;
  confirmedByUserId: string;
  files: ExecutionSubmissionFile[];
};
export type ExecutionMailing = {
  id: string;
  confirmationId: string;
  mailedAt: string;
  recordedAt: string;
  files: CaseFile[];
};
export type ExecutionFiling = {
  id: string;
  mailingId: string;
  submittedAt: string;
  recordedAt: string;
  files: CaseFile[];
};
export type ExecutionFinish = {
  id: string;
  filingId: string;
  finishedAt: string;
  reason: string;
  basisNote: string | null;
  recordedAt: string;
  files: CaseFile[];
};
export type FinishCaseExecutionInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedFilingId: string;
  finishedAt: string;
  reason: string;
  basisNote: string | null;
  basisContentVersionIds: string[];
};
export type FinishCaseExecutionResult = {
  id: string;
  finishId: string;
  filingId: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  finishedAt: string;
  recordedAt: string;
};
export type CaseDisplayAmount<Source extends string> = {
  state: 'UNRECORDED' | 'PENDING' | 'KNOWN';
  amount: string | null;
  sourceType: Source | null;
  sourceId: string | null;
};
export type CaseDisplaySummary = {
  customerName: string;
  rightsHolderName: string;
  source: {
    platform: LeadPlatform;
    shopName: string;
    shopExternalId: string | null;
  };
  defendants: Array<{ id: string; name: string }>;
  lawyers: Array<{ id: string; fullName: string }>;
  court: { id: string; name: string } | null;
  courtCaseNo: string | null;
  claimAmount: CaseDisplayAmount<
    'COMPLAINT_CONFIRMATION' | 'COMPLAINT_SUBMISSION'
  >;
  judgmentAmount: CaseDisplayAmount<
    'FIRST_INSTANCE_JUDGMENT' | 'SECOND_INSTANCE_RESULT'
  >;
  closureAmount: CaseDisplayAmount<'CASE_CLOSURE_VERSION'>;
};
export type RecordCaseClosureInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedFinishId: string;
  closeAt: string | null;
  closeAmountState: 'KNOWN' | 'PENDING';
  closeAmt: string | null;
  note: string | null;
  closeContentVersionIds: string[];
};
export type CorrectCaseClosureInput = RecordCaseClosureInput & {
  expectedClosureVersionId: string;
  correctionReason: string;
};
export type CaseClosureResult = {
  id: string;
  closureId: string;
  closureVersionId: string;
  finishId: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  recordedAt: string;
};
export type CaseClosureVersion = {
  id: string;
  kind: 'REGISTER' | 'CORRECT';
  priorVersionId: string | null;
  finishId: string;
  fromVersion: number;
  toVersion: number;
  closeAt: string | null;
  closeAmountState: 'KNOWN' | 'PENDING';
  closeAmt: string | null;
  note: string | null;
  correctionReason: string | null;
  recordedAt: string;
  recordedByUserId: string;
  files: CaseFile[];
};
export type LawyerCaseClosureVersion = Omit<
  CaseClosureVersion,
  'correctionReason' | 'recordedByUserId'
>;
export type CaseClosure = {
  id: string;
  finishId: string;
  current: CaseClosureVersion;
  history: CaseClosureVersion[];
};
export type LawyerCaseClosure = Omit<CaseClosure, 'current' | 'history'> & {
  current: LawyerCaseClosureVersion;
  history: LawyerCaseClosureVersion[];
};
export type CaseClosurePendingRequest =
  | { command: 'RECORD'; input: RecordCaseClosureInput }
  | { command: 'CORRECT'; input: CorrectCaseClosureInput };
export type CaseArchiveType =
  | 'VOIDED'
  | 'SETTLEMENT'
  | 'MEDIATION'
  | 'JUDGMENT_PERFORMED'
  | 'EXECUTION_COLLECTED'
  | 'EXECUTION_CLOSED';
export type ArchiveCaseInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedClosureVersionId: string;
  archiveAt: string;
  archiveType: CaseArchiveType;
  archiveReason: string;
};
export type CorrectCaseArchiveInput = ArchiveCaseInput & {
  expectedArchiveVersionId: string;
  correctionReason: string;
};
export type CaseArchiveResult = {
  id: string;
  archiveId: string;
  archiveVersionId: string;
  closureId: string;
  closureVersionId: string;
  stage: 'ARCHIVED';
  version: number;
  recordedAt: string;
};
export type CaseArchiveVersion = {
  id: string;
  kind: 'ARCHIVE' | 'CORRECT';
  priorVersionId: string | null;
  closureVersionId: string;
  fromVersion: number;
  toVersion: number;
  archiveAt: string;
  archiveType: CaseArchiveType;
  archiveReason: string;
  correctionReason: string | null;
  recordedAt: string;
  recordedByUserId: string;
};
export type LawyerCaseArchiveVersion = Omit<
  CaseArchiveVersion,
  'correctionReason' | 'recordedByUserId'
>;
export type CaseArchive = {
  id: string;
  closureId: string;
  closureVersionId: string;
  current: CaseArchiveVersion;
  history: CaseArchiveVersion[];
};
export type LawyerCaseArchive = Omit<CaseArchive, 'current' | 'history'> & {
  current: LawyerCaseArchiveVersion;
  history: LawyerCaseArchiveVersion[];
};
export type CaseArchivePendingRequest =
  | { command: 'ARCHIVE'; input: ArchiveCaseInput }
  | { command: 'CORRECT'; input: CorrectCaseArchiveInput };
export type CaseHearingArrangement = {
  id: string;
  trialRoundId: string;
  hearingAt: string | null;
  source: 'SCHEDULE' | 'CORRECTION';
  recordedAt: string;
  recordedByUserId?: string;
};
export type CaseHearingAdvance = {
  id: string;
  trialRoundId: string;
  arrangementId: string;
  dueAt: string;
  executedAt: string;
};
export type InternalCaseHearingCorrection = {
  id: string;
  priorArrangementId: string;
  priorAdvanceId: string;
  newArrangementId: string;
  resultStage: 'WAITING_HEARING' | 'WAITING_JUDGMENT';
  recordedAt: string;
  recordedByUserId?: string;
  reason?: string | null;
};
export type LawyerCaseHearingCorrection = Omit<
  InternalCaseHearingCorrection,
  'recordedByUserId' | 'reason'
>;
export type CaseHearing = {
  currentArrangement: CaseHearingArrangement | null;
  currentAdvance: CaseHearingAdvance | null;
  arrangements: CaseHearingArrangement[];
  advances: CaseHearingAdvance[];
  corrections: InternalCaseHearingCorrection[];
};
export type LawyerCaseHearing = Omit<CaseHearing, 'corrections'> & {
  corrections: LawyerCaseHearingCorrection[];
};
export type CaseJudgmentFact = {
  id: string;
  trialRoundId: string;
  kind: 'REGISTER' | 'CORRECT';
  priorFactId: string | null;
  judgmentReceivedAt: string;
  judgmentAmountState: 'KNOWN' | 'PENDING';
  judgmentAmount: string | null;
  paidLitigationFeeState: 'KNOWN' | 'PENDING';
  paidLitigationFee: string | null;
  fromVersion: number;
  toVersion: number;
  recordedAt: string;
  reason?: string | null;
  recordedByUserId?: string;
  files: CaseFile[];
};
export type LawyerCaseJudgmentFact = Omit<
  CaseJudgmentFact,
  'reason' | 'recordedByUserId'
>;
export type CaseJudgment = {
  current: CaseJudgmentFact | null;
  history: CaseJudgmentFact[];
  availableFiles: CaseFile[];
};
export type LawyerCaseJudgment = {
  current: LawyerCaseJudgmentFact | null;
  history: LawyerCaseJudgmentFact[];
  availableFiles: CaseFile[];
};
export type CaseJudgmentNextStepChoice = {
  id: string;
  trialRoundId: string;
  judgmentId: string;
  next: 'APPEAL' | 'EXECUTION';
  plaintiffRightsHolderId: string | null;
  plaintiffName: string | null;
  defendants: Array<{ defendantId: string; nameSnapshot: string }>;
  executionReadinessConfirmed: boolean;
  fromVersion: number;
  toVersion: number;
  recordedAt: string;
  recordedByUserId?: string;
};
export type CaseJudgmentNextStepRevocation = {
  id: string;
  choiceId: string;
  fromVersion: number;
  toVersion: number;
  recordedAt: string;
  reason?: string;
  recordedByUserId?: string;
};
export type CaseJudgmentNextStep = {
  current: CaseJudgmentNextStepChoice | null;
  history: CaseJudgmentNextStepChoice[];
  revocations: CaseJudgmentNextStepRevocation[];
};
export type LawyerCaseJudgmentNextStep = {
  current: Omit<CaseJudgmentNextStepChoice, 'recordedByUserId'> | null;
  history: Array<Omit<CaseJudgmentNextStepChoice, 'recordedByUserId'>>;
  revocations: Array<
    Omit<CaseJudgmentNextStepRevocation, 'reason' | 'recordedByUserId'>
  >;
};
export type FilingCourt = { id: string; name: string };
export type CaseFilingSubmission = {
  court: FilingCourt;
  submittedAt: string;
  recordedAt: string;
  recordedByUserId: string;
  mediationNo: string | null;
  evidenceFiles: CaseFile[];
  screenshotFiles: CaseFile[];
};
export type CaseComplaintMailing = {
  mailedAt: string;
  recordedAt: string;
  recordedByUserId: string;
  actorType: 'INTERNAL' | 'CLIENT' | 'LAWYER';
  receiptFiles: CaseFile[];
};
export type ComplaintSubmission = {
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  submittedAt: string;
  submittedByUserId: string;
  complaintFiles: CaseFile[];
  authorizationFiles: CaseFile[];
};
export type ComplaintConfirmation = {
  confirmedComplaintContentVersionId: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  changeNote: string | null;
  confirmDisclose: boolean;
  confirmedAt: string;
  confirmedByUserId: string;
  complaintFile: CaseFile | null;
};
export type CaseFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};
export type AcceptanceMaterialGroup = {
  available: CaseFile[];
  frozen: CaseFile[];
  later: CaseFile[];
};
export type CaseAcceptance = {
  id: string;
  trialRoundId: string;
  acceptedAt: string;
  courtCaseNo: string;
  recordedAt: string;
  recordedByUserId?: string;
  files: Array<CaseFile & { category: 'ACCEPTANCE_NOTICE' }>;
};
export type AcceptanceMaterials = {
  ACCEPTANCE_NOTICE: AcceptanceMaterialGroup;
  PAYMENT_LIST: AcceptanceMaterialGroup;
  SERVICE_DOCUMENT: AcceptanceMaterialGroup;
};
export type MatchCaseInput = {
  expectedVersion: number;
  idempotencyKey: string;
  matchedOn: string;
  defendants: Array<{
    kind: 'PERSON' | 'ORGANIZATION';
    name: string;
    idNo?: string;
    phone?: string;
    address?: string;
  }>;
  lawyerAccountId: string;
  lawyerProfileId?: string;
};
export type CaseWorkflowItem = {
  id: string;
  stage: CaseStage;
  version: number;
  canSubmitComplaint: boolean;
  canConfirmComplaint: boolean;
  canMailComplaint: boolean;
  canMailExecution: boolean;
  canSubmitExecutionFiling: boolean;
  canFinishExecution: boolean;
  canSubmitFiling: boolean;
  canRegisterAcceptance: boolean;
  canUploadAcceptanceMaterials: boolean;
  acceptance: Omit<CaseAcceptance, 'recordedByUserId'> | null;
  acceptanceMaterials: AcceptanceMaterials;
  complaint: {
    amountState: 'KNOWN' | 'PENDING';
    amount: string | null;
    pendingReason: string | null;
    submittedAt: string;
    complaintFiles: CaseFile[];
    authorizationFiles: CaseFile[];
  } | null;
  complaintConfirmation: {
    confirmedComplaintContentVersionId: string;
    amountState: 'KNOWN' | 'PENDING';
    amount: string | null;
    pendingReason: string | null;
    changeNote: string | null;
    confirmDisclose: boolean;
    confirmedAt: string;
    complaintFile: CaseFile | null;
  } | null;
  complaintMailing: {
    mailedAt: string;
    recordedAt: string;
    receiptFiles: CaseFile[];
  } | null;
  pendingReceiptFiles?: CaseFile[];
};
export type LawyerCaseSummary = {
  id: string;
  businessNo: string;
  stage: CaseStage;
  version: number;
  canMatch: false;
  canSubmitExecution: boolean;
  canConfirmExecution: boolean;
  canMailExecution: boolean;
  canSubmitExecutionFiling: boolean;
  canFinishExecution: boolean;
  canRecordClosure: boolean;
  canCorrectClosure: false;
  canArchive: boolean;
  canCorrectArchive: false;
  canSubmitComplaint: boolean;
  canConfirmComplaint: boolean;
  canMailComplaint: boolean;
  canSubmitFiling: boolean;
  canRegisterAcceptance: boolean;
  canUploadAcceptanceMaterials: boolean;
  canScheduleHearing: boolean;
  canCorrectHearing: false;
  canRegisterJudgment: boolean;
  canCorrectJudgment: false;
  canChooseJudgmentNextStep: boolean;
  canRevokeJudgmentNextStep: false;
  canSaveSecondInstance: boolean;
  canRegisterSecondInstanceResult: boolean;
  canRevokeSecondInstanceResult: false;
  createdAt: string;
};
export type LawyerCaseList = {
  items: LawyerCaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CaseStage, number>;
};
export type LawyerMatchCandidate = {
  lawyerAccountId: string;
  username: string;
  displayName: string;
  lawyerProfileId: string;
};
export type LawyerCaseDetail = CaseWorkflowItem &
  LawyerCaseSummary & {
    matchedAt: string | null;
    matchedOn: string | null;
    defendants: CaseDefendant[];
    lawyers: CaseLawyer[];
    customer: { id: string; name: string };
    rightsHolder: { id: string; name: string };
    certificate: CaseDetail['certificate'];
    complaint: Omit<ComplaintSubmission, 'submittedByUserId'> | null;
    complaintConfirmation: Omit<
      ComplaintConfirmation,
      'confirmedByUserId'
    > | null;
    complaintMailing: {
      mailedAt: string;
      recordedAt: string;
      actorType: 'INTERNAL' | 'CLIENT' | 'LAWYER';
      receiptFiles: CaseFile[];
    } | null;
    filingSubmission: Omit<CaseFilingSubmission, 'recordedByUserId'> | null;
    courtCaseNo: string | null;
    acceptance: Omit<CaseAcceptance, 'recordedByUserId'> | null;
    acceptanceMaterials: AcceptanceMaterials;
    hearing: LawyerCaseHearing;
    judgment: LawyerCaseJudgment;
    judgmentNextStep: LawyerCaseJudgmentNextStep;
    acceptances: Array<LawyerCaseAcceptanceHistory>;
    secondInstance: LawyerCaseSecondInstance;
    executionSubmission: ExecutionSubmissionState;
    canConfirmExecution: boolean;
    executionConfirmation: ExecutionConfirmation | null;
    executionMailing: ExecutionMailing | null;
    executionFiling: ExecutionFiling | null;
    executionFinish: ExecutionFinish | null;
    closure: LawyerCaseClosure | null;
    archive: LawyerCaseArchive | null;
  };

export type SubmitExecutionInput = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  judgmentNextStepId: string;
  secondInstanceResultId: string | null;
  expectedSubmissionId: string | null;
  executionApplicationContentVersionIds: string[];
  changeReason?: string;
};
export type SubmitExecutionResult = {
  id: string;
  submissionId: string;
  stage: 'WAITING_EXECUTION_CONFIRMATION';
  version: number;
  submittedAt: string;
};
export type ConfirmExecutionInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedSubmissionId: string;
};
export type ConfirmExecutionResult = {
  id: string;
  confirmationId: string;
  submissionId: string;
  stage: 'WAITING_EXECUTION_STAMP';
  version: number;
  confirmedAt: string;
};
export type MailCaseExecutionInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedConfirmationId: string;
  mailedAt: string;
  mailReceiptContentVersionIds: string[];
};
export type SubmitCaseExecutionFilingInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedMailingId: string;
  submittedAt: string;
  executionFilingProofContentVersionIds: string[];
};
export type MailCaseExecutionResult = {
  id: string;
  mailingId: string;
  confirmationId: string;
  stage: 'WAITING_EXECUTION_FILING';
  version: number;
  mailedAt: string;
  recordedAt: string;
};
export type SubmitCaseExecutionFilingResult = {
  id: string;
  filingId: string;
  mailingId: string;
  stage: 'EXECUTING';
  version: number;
  submittedAt: string;
  recordedAt: string;
};

export type SecondInstanceProgressInput = {
  hearingAt: string | null;
  hearingPlace: string | null;
  judgeName: string | null;
  documentContentVersionIds: string[];
  serviceContentVersionIds: string[];
};
export type SaveSecondInstanceInput = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  choiceId: string;
  expectedProgressId: string | null;
  progress: SecondInstanceProgressInput;
};
export type RegisterSecondInstanceResultInput = SaveSecondInstanceInput & {
  result: 'REMAND' | 'CHANGE' | 'AFFIRM';
  resultReceivedAt: string;
  judgmentContentVersionIds: string[];
  paidLitigationFee: { state: 'KNOWN' | 'PENDING'; amount: string | null };
  judgmentAmount?: { state: 'KNOWN' | 'PENDING'; amount: string | null };
};
export type RevokeSecondInstanceResultInput = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  resultId: string;
  reason: string;
};
export type SecondInstanceCommandResult = {
  id: string;
  stage: CaseStage;
  version: number;
  currentTrialRoundId: string | null;
  progressId: string | null;
  resultId: string | null;
  recordedAt: string;
  revocationId?: string;
};
export type CaseSecondInstanceRound = {
  id: string;
  sequence: number;
  sourceResultId: string | null;
  revokedAt: string | null;
};
type SecondInstanceProgressBase = {
  id: string;
  trialRoundId: string;
  choiceId: string;
  priorProgressId: string | null;
  hearingAt: string | null;
  hearingPlace: string | null;
  judgeName: string | null;
  fromVersion: number;
  toVersion: number;
  recordedAt: string;
  documentFiles: CaseFile[];
  serviceFiles: CaseFile[];
};
export type CaseSecondInstanceProgress = SecondInstanceProgressBase & {
  recordedByUserId?: string;
};
export type LawyerSecondInstanceProgress = SecondInstanceProgressBase;
type SecondInstanceResultBase = {
  id: string;
  trialRoundId: string;
  choiceId: string;
  judgmentId: string;
  progressId: string | null;
  resultReceivedAt: string;
  paidLitigationFeeState: 'KNOWN' | 'PENDING';
  paidLitigationFee: string | null;
  fromVersion: number;
  toVersion: number;
  recordedAt: string;
  files: CaseFile[];
  childTrialRoundId: string | null;
  revocationId: string | null;
} & (
  | { result: 'REMAND'; judgmentAmountState: null; judgmentAmount: null }
  | {
      result: 'CHANGE' | 'AFFIRM';
      judgmentAmountState: 'KNOWN' | 'PENDING';
      judgmentAmount: string | null;
    }
);
export type CaseSecondInstanceResult = SecondInstanceResultBase & {
  recordedByUserId?: string;
};
export type LawyerSecondInstanceResult = SecondInstanceResultBase;
export type CaseSecondInstanceRevocation = {
  id: string;
  resultId: string;
  fromVersion: number;
  toVersion: number;
  recordedAt: string;
  reason?: string;
  recordedByUserId?: string;
};
export type LawyerSecondInstanceRevocation = Omit<
  CaseSecondInstanceRevocation,
  'reason' | 'recordedByUserId'
>;
export type CaseSecondInstance = {
  currentTrialRoundId: string | null;
  currentProgress: CaseSecondInstanceProgress | null;
  currentResult: CaseSecondInstanceResult | null;
  rounds: CaseSecondInstanceRound[];
  progresses: CaseSecondInstanceProgress[];
  results: CaseSecondInstanceResult[];
  revocations: CaseSecondInstanceRevocation[];
};
export type LawyerCaseSecondInstance = {
  currentTrialRoundId: string | null;
  currentProgress: LawyerSecondInstanceProgress | null;
  currentResult: LawyerSecondInstanceResult | null;
  rounds: CaseSecondInstanceRound[];
  progresses: LawyerSecondInstanceProgress[];
  results: LawyerSecondInstanceResult[];
  revocations: LawyerSecondInstanceRevocation[];
};
export type CaseAcceptanceHistory = CaseAcceptance;
export type LawyerCaseAcceptanceHistory = Omit<
  CaseAcceptanceHistory,
  'recordedByUserId'
>;
export type SubmitComplaintInput = {
  expectedVersion: number;
  idempotencyKey: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  complaintContentVersionIds: string[];
  authorizationContentVersionIds: string[];
};
export type ConfirmCaseComplaintInput = {
  expectedVersion: number;
  idempotencyKey: string;
  confirmedComplaintContentVersionId: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  changeNote?: string;
  confirmDisclose: boolean;
};
export type MailCaseComplaintInput = {
  expectedVersion: number;
  idempotencyKey: string;
  mailedAt: string;
  mailReceiptContentVersionIds: string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function businessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function todayShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function validStage(value: unknown): value is CaseStage {
  return (
    value === 'PENDING_MATCH' ||
    value === 'WAITING_COMPLAINT' ||
    value === 'WAITING_COMPLAINT_CONFIRMATION' ||
    value === 'WAITING_COMPLAINT_STAMP' ||
    value === 'WAITING_FILING' ||
    value === 'WAITING_FORMAL_ACCEPTANCE' ||
    value === 'WAITING_HEARING' ||
    value === 'WAITING_JUDGMENT' ||
    value === 'SECOND_INSTANCE' ||
    value === 'WAITING_EXECUTION_DOCUMENTS' ||
    value === 'WAITING_EXECUTION_CONFIRMATION' ||
    value === 'WAITING_EXECUTION_STAMP' ||
    value === 'WAITING_EXECUTION_FILING' ||
    value === 'EXECUTING' ||
    value === 'WAITING_ARCHIVE' ||
    value === 'ARCHIVED'
  );
}
function source(value: unknown): value is { id: string; businessNo: string } {
  return (
    record(value) &&
    exact(value, ['id', 'businessNo']) &&
    nonempty(value.id) &&
    nonempty(value.businessNo)
  );
}
function named(value: unknown, lastKey: 'name' | 'displayName'): boolean {
  return (
    record(value) &&
    exact(value, ['id', lastKey]) &&
    nonempty(value.id) &&
    nonempty(value[lastKey])
  );
}
function summary(value: unknown): value is CaseSummary {
  if (!record(value)) return false;
  const { displaySummary: projection, ...fields } = value;
  return summaryFields(fields) && displaySummary(projection);
}

function summaryFields(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'id',
      'businessNo',
      'stage',
      'createdAt',
      'version',
      'owner',
      'canMatch',
      'canSubmitExecution',
      'canConfirmExecution',
      'canMailExecution',
      'canSubmitExecutionFiling',
      'canFinishExecution',
      'canRecordClosure',
      'canCorrectClosure',
      'canArchive',
      'canCorrectArchive',
      'canSubmitComplaint',
      'canConfirmComplaint',
      'canMailComplaint',
      'canSubmitFiling',
      'canRegisterAcceptance',
      'canUploadAcceptanceMaterials',
      'canScheduleHearing',
      'canCorrectHearing',
      'canRegisterJudgment',
      'canCorrectJudgment',
      'canChooseJudgmentNextStep',
      'canRevokeJudgmentNextStep',
      'canSaveSecondInstance',
      'canRegisterSecondInstanceResult',
      'canRevokeSecondInstanceResult',
      'sourceLead',
      'sourceNotaryMatter',
    ]) &&
    nonempty(value.id) &&
    nonempty(value.businessNo) &&
    validStage(value.stage) &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    named(value.owner, 'displayName') &&
    typeof value.canMatch === 'boolean' &&
    typeof value.canSubmitExecution === 'boolean' &&
    typeof value.canConfirmExecution === 'boolean' &&
    typeof value.canMailExecution === 'boolean' &&
    typeof value.canSubmitExecutionFiling === 'boolean' &&
    typeof value.canFinishExecution === 'boolean' &&
    typeof value.canRecordClosure === 'boolean' &&
    typeof value.canCorrectClosure === 'boolean' &&
    archiveCapabilities(value) &&
    typeof value.canSubmitComplaint === 'boolean' &&
    typeof value.canConfirmComplaint === 'boolean' &&
    typeof value.canMailComplaint === 'boolean' &&
    typeof value.canSubmitFiling === 'boolean' &&
    typeof value.canRegisterAcceptance === 'boolean' &&
    typeof value.canUploadAcceptanceMaterials === 'boolean' &&
    typeof value.canScheduleHearing === 'boolean' &&
    typeof value.canCorrectHearing === 'boolean' &&
    typeof value.canRegisterJudgment === 'boolean' &&
    typeof value.canCorrectJudgment === 'boolean' &&
    typeof value.canChooseJudgmentNextStep === 'boolean' &&
    typeof value.canRevokeJudgmentNextStep === 'boolean' &&
    typeof value.canSaveSecondInstance === 'boolean' &&
    typeof value.canRegisterSecondInstanceResult === 'boolean' &&
    typeof value.canRevokeSecondInstanceResult === 'boolean' &&
    source(value.sourceLead) &&
    source(value.sourceNotaryMatter)
  );
}
function decimalAmount(value: unknown, canonical: boolean): value is string {
  return (
    typeof value === 'string' &&
    (canonical ? /^\d{1,14}\.\d{2}$/u : /^\d{1,14}(?:\.\d{1,2})?$/u).test(value)
  );
}
function displayAmount(value: unknown, sources: readonly string[]): boolean {
  if (
    !record(value) ||
    !exact(value, ['state', 'amount', 'sourceType', 'sourceId'])
  )
    return false;
  if (value.state === 'UNRECORDED')
    return (
      value.amount === null &&
      value.sourceType === null &&
      value.sourceId === null
    );
  return (
    typeof value.sourceType === 'string' &&
    sources.includes(value.sourceType) &&
    uuidV4(value.sourceId) &&
    (value.state === 'PENDING'
      ? value.amount === null
      : value.state === 'KNOWN' && decimalAmount(value.amount, true))
  );
}
function displaySummary(value: unknown): value is CaseDisplaySummary {
  return (
    record(value) &&
    exact(value, [
      'customerName',
      'rightsHolderName',
      'source',
      'defendants',
      'lawyers',
      'court',
      'courtCaseNo',
      'claimAmount',
      'judgmentAmount',
      'closureAmount',
    ]) &&
    nonempty(value.customerName) &&
    nonempty(value.rightsHolderName) &&
    record(value.source) &&
    exact(value.source, ['platform', 'shopName', 'shopExternalId']) &&
    [
      'TAOBAO',
      'TMALL',
      'PINDUODUO',
      'JD',
      'DOUYIN',
      'ALIBABA_1688',
      'XIAOHONGSHU',
      'KUAISHOU',
      'XIANYU',
      'WECHAT',
      'MEITUAN',
      'DIANPING',
      'MAP',
      'OTHER',
    ].includes(String(value.source.platform)) &&
    nonempty(value.source.shopName) &&
    (value.source.shopExternalId === null ||
      nonempty(value.source.shopExternalId)) &&
    Array.isArray(value.defendants) &&
    value.defendants.every((item) => named(item, 'name')) &&
    Array.isArray(value.lawyers) &&
    value.lawyers.every(
      (item) =>
        record(item) &&
        exact(item, ['id', 'fullName']) &&
        nonempty(item.id) &&
        nonempty(item.fullName),
    ) &&
    (value.court === null || named(value.court, 'name')) &&
    (value.courtCaseNo === null || nonempty(value.courtCaseNo)) &&
    displayAmount(value.claimAmount, [
      'COMPLAINT_CONFIRMATION',
      'COMPLAINT_SUBMISSION',
    ]) &&
    displayAmount(value.judgmentAmount, [
      'FIRST_INSTANCE_JUDGMENT',
      'SECOND_INSTANCE_RESULT',
    ]) &&
    displayAmount(value.closureAmount, ['CASE_CLOSURE_VERSION'])
  );
}
function archiveType(value: unknown): value is CaseArchiveType {
  return [
    'VOIDED',
    'SETTLEMENT',
    'MEDIATION',
    'JUDGMENT_PERFORMED',
    'EXECUTION_COLLECTED',
    'EXECUTION_CLOSED',
  ].includes(String(value));
}
function archiveCapabilities(value: Record<string, unknown>): boolean {
  return (
    typeof value.canArchive === 'boolean' &&
    typeof value.canCorrectArchive === 'boolean' &&
    (!value.canArchive || value.stage === 'WAITING_ARCHIVE') &&
    (!value.canCorrectArchive || value.stage === 'ARCHIVED') &&
    (value.stage !== 'ARCHIVED' ||
      (value.canRecordClosure === false && value.canCorrectClosure === false))
  );
}
function archiveVersion(
  value: unknown,
  internal: boolean,
): value is CaseArchiveVersion | LawyerCaseArchiveVersion {
  return (
    record(value) &&
    exact(value, [
      'id',
      'kind',
      'priorVersionId',
      'closureVersionId',
      'fromVersion',
      'toVersion',
      'archiveAt',
      'archiveType',
      'archiveReason',
      'recordedAt',
      ...(internal ? ['correctionReason', 'recordedByUserId'] : []),
    ]) &&
    uuidV4(value.id) &&
    uuidV4(value.closureVersionId) &&
    Number.isSafeInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isSafeInteger(value.toVersion) &&
    value.toVersion === Number(value.fromVersion) + 1 &&
    (value.kind === 'ARCHIVE'
      ? value.priorVersionId === null &&
        (!internal || value.correctionReason === null)
      : value.kind === 'CORRECT' &&
        uuidV4(value.priorVersionId) &&
        (!internal ||
          (nonempty(value.correctionReason) &&
            value.correctionReason.length <= 500))) &&
    businessDate(value.archiveAt) &&
    archiveType(value.archiveType) &&
    finishText(value.archiveReason) &&
    utcTimestamp(value.recordedAt) &&
    (!internal || uuidV4(value.recordedByUserId))
  );
}
function closureTerminalVersion(value: Record<string, unknown>): unknown {
  if (
    record(value.archive) &&
    Array.isArray(value.archive.history) &&
    record(value.archive.history[0])
  )
    return value.archive.history[0].fromVersion;
  return value.version;
}
function archiveMatches(
  value: Record<string, unknown>,
  internal: boolean,
): boolean {
  const archive = value.archive;
  if (archive === null)
    return (
      value.stage !== 'ARCHIVED' &&
      value.canCorrectArchive === false &&
      (!value.canArchive ||
        (record(value.closure) &&
          record(value.closure.current) &&
          value.closure.current.toVersion === value.version))
    );
  if (
    value.stage !== 'ARCHIVED' ||
    value.canArchive !== false ||
    !record(archive) ||
    !exact(archive, [
      'id',
      'closureId',
      'closureVersionId',
      'current',
      'history',
    ]) ||
    !uuidV4(archive.id) ||
    !uuidV4(archive.closureId) ||
    !uuidV4(archive.closureVersionId) ||
    !record(value.closure) ||
    archive.closureId !== value.closure.id ||
    !record(value.closure.current) ||
    archive.closureVersionId !== value.closure.current.id ||
    !archiveVersion(archive.current, internal) ||
    !Array.isArray(archive.history) ||
    archive.history.length === 0 ||
    !archive.history.every((entry) => archiveVersion(entry, internal))
  )
    return false;
  const history = archive.history as Array<
    CaseArchiveVersion | LawyerCaseArchiveVersion
  >;
  const last = history[history.length - 1]!;
  const current: unknown = archive.current;
  return (
    record(current) &&
    new Set(history.map((entry) => entry.id)).size === history.length &&
    last.toVersion === value.version &&
    history[0]!.fromVersion === value.closure.current.toVersion &&
    Object.entries(last).every(([key, field]) => current[key] === field) &&
    history.every(
      (entry, index) =>
        entry.closureVersionId === archive.closureVersionId &&
        (index === 0
          ? entry.kind === 'ARCHIVE'
          : entry.kind === 'CORRECT' &&
            entry.priorVersionId === history[index - 1]!.id &&
            entry.fromVersion === history[index - 1]!.toVersion),
    )
  );
}
function closureVersion(
  value: unknown,
  internal: boolean,
): value is CaseClosureVersion | LawyerCaseClosureVersion {
  if (
    !record(value) ||
    !exact(value, [
      'id',
      'kind',
      'priorVersionId',
      'finishId',
      'fromVersion',
      'toVersion',
      'closeAt',
      'closeAmountState',
      'closeAmt',
      'note',
      'recordedAt',
      'files',
      ...(internal ? ['correctionReason', 'recordedByUserId'] : []),
    ])
  )
    return false;
  return (
    uuidV4(value.id) &&
    uuidV4(value.finishId) &&
    Number.isSafeInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isSafeInteger(value.toVersion) &&
    value.toVersion === Number(value.fromVersion) + 1 &&
    (value.kind === 'REGISTER'
      ? value.priorVersionId === null &&
        (!internal || value.correctionReason === null)
      : value.kind === 'CORRECT' &&
        uuidV4(value.priorVersionId) &&
        (!internal ||
          (nonempty(value.correctionReason) &&
            value.correctionReason.length <= 500))) &&
    (value.closeAt === null || businessDate(value.closeAt)) &&
    (value.closeAmountState === 'PENDING'
      ? value.closeAmt === null
      : value.closeAmountState === 'KNOWN' &&
        decimalAmount(value.closeAmt, true)) &&
    (value.note === null || finishText(value.note)) &&
    utcTimestamp(value.recordedAt) &&
    (!internal || uuidV4(value.recordedByUserId)) &&
    Array.isArray(value.files) &&
    value.files.length <= 10 &&
    value.files.every(
      (file) =>
        caseFile(file) &&
        uuidV4(file.materialId) &&
        uuidV4(file.contentVersionId),
    ) &&
    new Set(value.files.map((file) => (file as CaseFile).materialId)).size ===
      value.files.length &&
    new Set(value.files.map((file) => (file as CaseFile).contentVersionId))
      .size === value.files.length
  );
}
function sameClosureVersion(
  left: CaseClosureVersion | LawyerCaseClosureVersion,
  right: CaseClosureVersion | LawyerCaseClosureVersion,
): boolean {
  const rightValue: unknown = right;
  if (!record(rightValue)) return false;
  return Object.entries(left).every(([key, value]) =>
    key === 'files'
      ? left.files.length === right.files.length &&
        left.files.every((file, i) => {
          const other = right.files[i];
          return (
            other !== undefined &&
            file.materialId === other.materialId &&
            file.contentVersionId === other.contentVersionId &&
            file.originalFilename === other.originalFilename &&
            file.mimeType === other.mimeType
          );
        })
      : rightValue[key] === value,
  );
}
function closureMatches(
  value: unknown,
  finish: unknown,
  stage: unknown,
  version: unknown,
  canRecord: unknown,
  canCorrect: unknown,
  internal: boolean,
): boolean {
  if (value === null)
    return (
      canCorrect === false &&
      (canRecord !== true ||
        (stage === 'WAITING_ARCHIVE' && executionFinish(finish)))
    );
  if (
    stage !== 'WAITING_ARCHIVE' ||
    canRecord !== false ||
    !executionFinish(finish) ||
    !record(value) ||
    !exact(value, ['id', 'finishId', 'current', 'history']) ||
    !uuidV4(value.id) ||
    value.finishId !== finish.id ||
    !closureVersion(value.current, internal) ||
    !Array.isArray(value.history) ||
    value.history.length === 0 ||
    !value.history.every((entry) => closureVersion(entry, internal))
  )
    return false;
  const history = value.history as Array<
    CaseClosureVersion | LawyerCaseClosureVersion
  >;
  const last = history[history.length - 1]!;
  return (
    new Set(history.map((entry) => entry.id)).size === history.length &&
    last.toVersion === version &&
    sameClosureVersion(value.current, last) &&
    history.every(
      (entry, index) =>
        entry.finishId === finish.id &&
        (index === 0
          ? entry.kind === 'REGISTER'
          : entry.kind === 'CORRECT' &&
            entry.priorVersionId === history[index - 1]!.id &&
            entry.fromVersion === history[index - 1]!.toVersion),
    )
  );
}
function caseFile(value: unknown): value is CaseFile {
  return (
    record(value) &&
    exact(value, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'mimeType',
    ]) &&
    ['materialId', 'contentVersionId', 'originalFilename', 'mimeType'].every(
      (key) => nonempty(value[key]),
    )
  );
}
function executionMailing(value: unknown): value is ExecutionMailing {
  return (
    record(value) &&
    exact(value, ['id', 'confirmationId', 'mailedAt', 'recordedAt', 'files']) &&
    uuidV4(value.id) &&
    uuidV4(value.confirmationId) &&
    businessDate(value.mailedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.length <= 10 &&
    value.files.every(caseFile) &&
    new Set(value.files.map((file) => (file as CaseFile).contentVersionId))
      .size === value.files.length
  );
}
function executionFiling(value: unknown): value is ExecutionFiling {
  return (
    record(value) &&
    exact(value, ['id', 'mailingId', 'submittedAt', 'recordedAt', 'files']) &&
    uuidV4(value.id) &&
    uuidV4(value.mailingId) &&
    businessDate(value.submittedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.length <= 10 &&
    value.files.every(caseFile) &&
    new Set(value.files.map((file) => (file as CaseFile).contentVersionId))
      .size === value.files.length
  );
}
function finishText(value: unknown): value is string {
  return nonempty(value) && value.length <= 2000;
}
function utcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function executionFinish(value: unknown): value is ExecutionFinish {
  return (
    record(value) &&
    exact(value, [
      'id',
      'filingId',
      'finishedAt',
      'reason',
      'basisNote',
      'recordedAt',
      'files',
    ]) &&
    uuidV4(value.id) &&
    uuidV4(value.filingId) &&
    businessDate(value.finishedAt) &&
    finishText(value.reason) &&
    (value.basisNote === null || finishText(value.basisNote)) &&
    utcTimestamp(value.recordedAt) &&
    Array.isArray(value.files) &&
    value.files.length <= 10 &&
    value.files.every(
      (file) =>
        caseFile(file) &&
        uuidV4(file.materialId) &&
        uuidV4(file.contentVersionId),
    ) &&
    new Set(value.files.map((file) => (file as CaseFile).contentVersionId))
      .size === value.files.length &&
    (value.basisNote !== null || value.files.length > 0)
  );
}
function executionFinishMatches(
  finish: unknown,
  filing: unknown,
  stage: unknown,
  canFinish: unknown,
): boolean {
  if (finish === null)
    return (
      stage !== 'WAITING_ARCHIVE' &&
      stage !== 'ARCHIVED' &&
      (canFinish !== true || (stage === 'EXECUTING' && executionFiling(filing)))
    );
  return (
    executionFinish(finish) &&
    executionFiling(filing) &&
    finish.filingId === filing.id &&
    (stage === 'WAITING_ARCHIVE' || stage === 'ARCHIVED') &&
    canFinish === false
  );
}
function executionFactsMatch(
  mailing: unknown,
  filing: unknown,
  confirmation: unknown,
): boolean {
  if (
    mailing !== null &&
    (!executionMailing(mailing) ||
      !record(confirmation) ||
      confirmation.id !== mailing.confirmationId)
  ) {
    return false;
  }
  if (
    filing !== null &&
    (!executionFiling(filing) ||
      !executionMailing(mailing) ||
      filing.mailingId !== mailing.id)
  ) {
    return false;
  }
  return true;
}
function executionSubmissionFile(
  value: unknown,
): value is ExecutionSubmissionFile {
  return (
    record(value) &&
    exact(value, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'mimeType',
      'uploadedAt',
    ]) &&
    caseFile({
      materialId: value.materialId,
      contentVersionId: value.contentVersionId,
      originalFilename: value.originalFilename,
      mimeType: value.mimeType,
    }) &&
    typeof value.uploadedAt === 'string' &&
    !Number.isNaN(Date.parse(value.uploadedAt))
  );
}
function executionSubmissionSummary(
  value: unknown,
): value is ExecutionSubmissionSummary {
  return (
    record(value) &&
    exact(value, [
      'id',
      'trialRoundId',
      'judgmentNextStepId',
      'secondInstanceResultId',
      'priorSubmissionId',
      'changeReason',
      'fromVersion',
      'toVersion',
      'submittedAt',
      'files',
    ]) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    uuidV4(value.judgmentNextStepId) &&
    (value.secondInstanceResultId === null ||
      uuidV4(value.secondInstanceResultId)) &&
    (value.priorSubmissionId === null || uuidV4(value.priorSubmissionId)) &&
    (value.changeReason === null ||
      (typeof value.changeReason === 'string' &&
        value.changeReason.trim() === value.changeReason &&
        value.changeReason.length >= 1 &&
        value.changeReason.length <= 500)) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    value.toVersion === Number(value.fromVersion) + 1 &&
    typeof value.submittedAt === 'string' &&
    !Number.isNaN(Date.parse(value.submittedAt)) &&
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.length <= 10 &&
    value.files.every(executionSubmissionFile) &&
    new Set(
      value.files.map(
        (file) => (file as ExecutionSubmissionFile).contentVersionId,
      ),
    ).size === value.files.length
  );
}
function executionSubmissionState(
  value: unknown,
): value is ExecutionSubmissionState {
  return (
    record(value) &&
    exact(value, ['current', 'submissions', 'availableFiles']) &&
    (value.current === null || executionSubmissionSummary(value.current)) &&
    Array.isArray(value.submissions) &&
    value.submissions.every(executionSubmissionSummary) &&
    (value.current === null ||
      value.submissions.some(
        (submission) =>
          (submission as ExecutionSubmissionSummary).id ===
          (value.current as ExecutionSubmissionSummary).id,
      )) &&
    Array.isArray(value.availableFiles) &&
    value.availableFiles.every(executionSubmissionFile) &&
    new Set(
      value.availableFiles.map(
        (file) => (file as ExecutionSubmissionFile).contentVersionId,
      ),
    ).size === value.availableFiles.length
  );
}
function executionConfirmation(value: unknown): value is ExecutionConfirmation {
  return (
    record(value) &&
    exact(value, [
      'id',
      'submissionId',
      'confirmedAt',
      'confirmedByUserId',
      'files',
    ]) &&
    uuidV4(value.id) &&
    uuidV4(value.submissionId) &&
    typeof value.confirmedAt === 'string' &&
    !Number.isNaN(Date.parse(value.confirmedAt)) &&
    nonempty(value.confirmedByUserId) &&
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.length <= 10 &&
    value.files.every(executionSubmissionFile) &&
    new Set(
      value.files.map(
        (file) => (file as ExecutionSubmissionFile).contentVersionId,
      ),
    ).size === value.files.length
  );
}
function executionConfirmationMatchesSubmission(
  confirmation: unknown,
  state: unknown,
): boolean {
  if (confirmation === null) return true;
  if (!executionConfirmation(confirmation) || !executionSubmissionState(state))
    return false;
  const current = state.current;
  if (!current || confirmation.submissionId !== current.id) return false;
  const confirmedFiles = new Map<string, ExecutionSubmissionFile>(
    confirmation.files.map((file) => [file.contentVersionId, file]),
  );
  return (
    current.files.length === confirmedFiles.size &&
    current.files.every((file) => {
      const confirmedFile = confirmedFiles.get(file.contentVersionId);
      return (
        confirmedFile !== undefined &&
        confirmedFile.materialId === file.materialId &&
        confirmedFile.originalFilename === file.originalFilename &&
        confirmedFile.mimeType === file.mimeType &&
        confirmedFile.uploadedAt === file.uploadedAt
      );
    })
  );
}
function validJudgmentFact(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = [
    'id',
    'trialRoundId',
    'kind',
    'priorFactId',
    'judgmentReceivedAt',
    'judgmentAmountState',
    'judgmentAmount',
    'paidLitigationFeeState',
    'paidLitigationFee',
    'fromVersion',
    'toVersion',
    'recordedAt',
    'files',
  ];
  const optional = internal ? ['reason', 'recordedByUserId'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    (value.kind === 'REGISTER' || value.kind === 'CORRECT') &&
    (value.priorFactId === null || uuidV4(value.priorFactId)) &&
    (value.kind === 'REGISTER'
      ? value.priorFactId === null
      : uuidV4(value.priorFactId)) &&
    businessDate(value.judgmentReceivedAt) &&
    (value.judgmentAmountState === 'KNOWN' ||
      value.judgmentAmountState === 'PENDING') &&
    (value.paidLitigationFeeState === 'KNOWN' ||
      value.paidLitigationFeeState === 'PENDING') &&
    (value.judgmentAmountState === 'KNOWN'
      ? typeof value.judgmentAmount === 'string' &&
        /^(0|[1-9]\d{0,13})\.\d{2}$/u.test(value.judgmentAmount)
      : value.judgmentAmount === null) &&
    (value.paidLitigationFeeState === 'KNOWN'
      ? typeof value.paidLitigationFee === 'string' &&
        /^(0|[1-9]\d{0,13})\.\d{2}$/u.test(value.paidLitigationFee)
      : value.paidLitigationFee === null) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    Number(value.toVersion) === Number(value.fromVersion) + 1 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('reason' in value) ||
      (internal &&
        (value.kind === 'REGISTER'
          ? value.reason === null
          : typeof value.reason === 'string' &&
            value.reason.trim().length > 0 &&
            value.reason.length <= 500))) &&
    (!('recordedByUserId' in value) ||
      (internal && uuidV4(value.recordedByUserId))) &&
    (value.kind !== 'CORRECT' ||
      !internal ||
      (internal &&
        typeof value.reason === 'string' &&
        value.reason.trim().length > 0 &&
        value.reason.length <= 500)) &&
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.length <= 10 &&
    value.files.every(caseFile)
  );
}
function validJudgment(value: unknown, internal: boolean): boolean {
  return (
    record(value) &&
    exact(value, ['current', 'history', 'availableFiles']) &&
    (value.current === null || validJudgmentFact(value.current, internal)) &&
    Array.isArray(value.history) &&
    value.history.every((fact) => validJudgmentFact(fact, internal)) &&
    Array.isArray(value.availableFiles) &&
    value.availableFiles.every(caseFile)
  );
}
function validNextStepChoice(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = [
    'id',
    'trialRoundId',
    'judgmentId',
    'next',
    'plaintiffRightsHolderId',
    'plaintiffName',
    'defendants',
    'executionReadinessConfirmed',
    'fromVersion',
    'toVersion',
    'recordedAt',
  ];
  const optional = internal ? ['recordedByUserId'] : [];
  if (!exactWithOptional(value, required, optional)) return false;
  const defendants = value.defendants;
  const validDefendants =
    Array.isArray(defendants) &&
    defendants.every(
      (entry) =>
        record(entry) &&
        exact(entry, ['defendantId', 'nameSnapshot']) &&
        uuidV4(entry.defendantId) &&
        nonempty(entry.nameSnapshot) &&
        entry.nameSnapshot.trim() === entry.nameSnapshot,
    );
  if (
    !validDefendants ||
    new Set(
      (defendants as Array<{ defendantId: string }>).map(
        (entry) => entry.defendantId,
      ),
    ).size !== defendants.length
  )
    return false;
  const baseValid =
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    uuidV4(value.judgmentId) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    Number(value.toVersion) === Number(value.fromVersion) + 1 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('recordedByUserId' in value) || uuidV4(value.recordedByUserId));
  if (!baseValid) return false;
  const plaintiffValid =
    (value.plaintiffRightsHolderId === null && value.plaintiffName === null) ||
    (uuidV4(value.plaintiffRightsHolderId) &&
      nonempty(value.plaintiffName) &&
      value.plaintiffName.trim() === value.plaintiffName);
  return value.next === 'APPEAL'
    ? plaintiffValid &&
        (value.plaintiffRightsHolderId !== null || defendants.length > 0) &&
        value.executionReadinessConfirmed === false
    : value.next === 'EXECUTION' &&
        value.plaintiffRightsHolderId === null &&
        value.plaintiffName === null &&
        defendants.length === 0 &&
        value.executionReadinessConfirmed === true;
}
function validNextStepRevocation(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = ['id', 'choiceId', 'fromVersion', 'toVersion', 'recordedAt'];
  const optional = internal ? ['reason', 'recordedByUserId'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.choiceId) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    Number(value.toVersion) === Number(value.fromVersion) + 1 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('reason' in value) ||
      (typeof value.reason === 'string' &&
        value.reason.trim() === value.reason &&
        value.reason.length >= 1 &&
        value.reason.length <= 500)) &&
    (!('recordedByUserId' in value) || uuidV4(value.recordedByUserId))
  );
}
function validNextStep(value: unknown, internal: boolean): boolean {
  return (
    record(value) &&
    exact(value, ['current', 'history', 'revocations']) &&
    (value.current === null || validNextStepChoice(value.current, internal)) &&
    Array.isArray(value.history) &&
    value.history.every((choice) => validNextStepChoice(choice, internal)) &&
    Array.isArray(value.revocations) &&
    value.revocations.every((revocation) =>
      validNextStepRevocation(revocation, internal),
    )
  );
}
function validAcceptance(value: unknown, internal: boolean): boolean {
  if (value === null) return true;
  return (
    validAcceptanceHistory(value, internal) &&
    (!internal || (record(value) && uuidV4(value.recordedByUserId)))
  );
}
function courtCaseNoMatchesAcceptance(
  courtCaseNo: unknown,
  acceptance: unknown,
): boolean {
  if (acceptance === null) return courtCaseNo === null;
  return record(acceptance) && courtCaseNo === acceptance.courtCaseNo;
}
function validAcceptanceMaterials(
  value: unknown,
): value is AcceptanceMaterials {
  if (
    !record(value) ||
    !exact(value, ['ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT'])
  )
    return false;
  const seen = new Set<string>();
  for (const category of [
    'ACCEPTANCE_NOTICE',
    'PAYMENT_LIST',
    'SERVICE_DOCUMENT',
  ]) {
    const group = value[category];
    if (
      !record(group) ||
      !exact(group, ['available', 'frozen', 'later']) ||
      !Array.isArray(group.available) ||
      !Array.isArray(group.frozen) ||
      !Array.isArray(group.later)
    )
      return false;
    for (const files of [group.available, group.frozen, group.later]) {
      if (!files.every(caseFile)) return false;
      for (const file of files) {
        if (seen.has(file.contentVersionId)) return false;
        seen.add(file.contentVersionId);
      }
    }
  }
  return true;
}
function defendant(value: unknown): value is CaseDefendant {
  return (
    record(value) &&
    exact(value, ['id', 'kind', 'name', 'idNo', 'phone', 'address']) &&
    nonempty(value.id) &&
    (value.kind === 'PERSON' || value.kind === 'ORGANIZATION') &&
    nonempty(value.name) &&
    [value.idNo, value.phone, value.address].every(
      (field) => field === null || typeof field === 'string',
    )
  );
}
function lawyer(value: unknown): value is CaseLawyer {
  return (
    record(value) &&
    exact(value, [
      'id',
      'fullName',
      'lawFirm',
      'phone',
      'role',
      'assignedAt',
    ]) &&
    nonempty(value.id) &&
    nonempty(value.fullName) &&
    (value.lawFirm === null || nonempty(value.lawFirm)) &&
    (value.phone === null || typeof value.phone === 'string') &&
    value.role === 'PRIMARY' &&
    typeof value.assignedAt === 'string' &&
    !Number.isNaN(Date.parse(value.assignedAt))
  );
}
function exactWithOptional(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => key in value) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}
function validHearingArrangement(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = ['id', 'trialRoundId', 'hearingAt', 'source', 'recordedAt'];
  const optional = internal ? ['recordedByUserId'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    (value.hearingAt === null || businessDate(value.hearingAt)) &&
    (value.source === 'SCHEDULE' || value.source === 'CORRECTION') &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('recordedByUserId' in value) || uuidV4(value.recordedByUserId))
  );
}
function validHearingAdvance(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'id',
      'trialRoundId',
      'arrangementId',
      'dueAt',
      'executedAt',
    ]) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    uuidV4(value.arrangementId) &&
    typeof value.dueAt === 'string' &&
    !Number.isNaN(Date.parse(value.dueAt)) &&
    typeof value.executedAt === 'string' &&
    !Number.isNaN(Date.parse(value.executedAt))
  );
}
function validHearingCorrection(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = [
    'id',
    'priorArrangementId',
    'priorAdvanceId',
    'newArrangementId',
    'resultStage',
    'recordedAt',
  ];
  const optional = internal ? ['recordedByUserId', 'reason'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.priorArrangementId) &&
    uuidV4(value.priorAdvanceId) &&
    uuidV4(value.newArrangementId) &&
    (value.resultStage === 'WAITING_HEARING' ||
      value.resultStage === 'WAITING_JUDGMENT') &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('recordedByUserId' in value) || uuidV4(value.recordedByUserId)) &&
    (!('reason' in value) ||
      (typeof value.reason === 'string' &&
        value.reason.trim() === value.reason &&
        value.reason.length >= 1 &&
        value.reason.length <= 500))
  );
}
function validHearing(value: unknown, internal: boolean): boolean {
  return (
    record(value) &&
    exact(value, [
      'currentArrangement',
      'currentAdvance',
      'arrangements',
      'advances',
      'corrections',
    ]) &&
    (value.currentArrangement === null ||
      validHearingArrangement(value.currentArrangement, internal)) &&
    (value.currentAdvance === null ||
      validHearingAdvance(value.currentAdvance)) &&
    Array.isArray(value.arrangements) &&
    value.arrangements.every((item) =>
      validHearingArrangement(item, internal),
    ) &&
    Array.isArray(value.advances) &&
    value.advances.every(validHearingAdvance) &&
    Array.isArray(value.corrections) &&
    value.corrections.every((item) => validHearingCorrection(item, internal))
  );
}
function validCaseDetail(value: unknown, id: string): value is CaseDetail {
  if (!record(value)) return false;
  return (
    exact(value, [
      'id',
      'businessNo',
      'stage',
      'createdAt',
      'version',
      'owner',
      'canMatch',
      'sourceLead',
      'sourceNotaryMatter',
      'courtCaseNo',
      'department',
      'customer',
      'rightsHolder',
      'certificate',
      'fees',
      'defendants',
      'lawyers',
      'matchedAt',
      'matchedOn',
      'canSubmitComplaint',
      'complaint',
      'canConfirmComplaint',
      'canMailComplaint',
      'canSubmitFiling',
      'canRegisterAcceptance',
      'canUploadAcceptanceMaterials',
      'canScheduleHearing',
      'canCorrectHearing',
      'canRegisterJudgment',
      'canCorrectJudgment',
      'canChooseJudgmentNextStep',
      'canRevokeJudgmentNextStep',
      'canSaveSecondInstance',
      'canRegisterSecondInstanceResult',
      'canRevokeSecondInstanceResult',
      'complaintConfirmation',
      'complaintMailing',
      'filingSubmission',
      'acceptance',
      'acceptanceMaterials',
      'hearing',
      'judgment',
      'judgmentNextStep',
      'acceptances',
      'secondInstance',
      'canSubmitExecution',
      'executionSubmission',
      'canConfirmExecution',
      'executionConfirmation',
      'canMailExecution',
      'canSubmitExecutionFiling',
      'canFinishExecution',
      'canRecordClosure',
      'canCorrectClosure',
      'canArchive',
      'canCorrectArchive',
      'executionMailing',
      'executionFiling',
      'executionFinish',
      'closure',
      'archive',
    ]) &&
    value.id === id &&
    summaryFields({
      id: value.id,
      businessNo: value.businessNo,
      stage: value.stage,
      createdAt: value.createdAt,
      version: value.version,
      owner: value.owner,
      canMatch: value.canMatch,
      canSubmitExecution: value.canSubmitExecution,
      canConfirmExecution: value.canConfirmExecution,
      canMailExecution: value.canMailExecution,
      canSubmitExecutionFiling: value.canSubmitExecutionFiling,
      canFinishExecution: value.canFinishExecution,
      canRecordClosure: value.canRecordClosure,
      canCorrectClosure: value.canCorrectClosure,
      canArchive: value.canArchive,
      canCorrectArchive: value.canCorrectArchive,
      canSubmitComplaint: value.canSubmitComplaint,
      canConfirmComplaint: value.canConfirmComplaint,
      canMailComplaint: value.canMailComplaint,
      canSubmitFiling: value.canSubmitFiling,
      canRegisterAcceptance: value.canRegisterAcceptance,
      canUploadAcceptanceMaterials: value.canUploadAcceptanceMaterials,
      canScheduleHearing: value.canScheduleHearing,
      canCorrectHearing: value.canCorrectHearing,
      canRegisterJudgment: value.canRegisterJudgment,
      canCorrectJudgment: value.canCorrectJudgment,
      canChooseJudgmentNextStep: value.canChooseJudgmentNextStep,
      canRevokeJudgmentNextStep: value.canRevokeJudgmentNextStep,
      canSaveSecondInstance: value.canSaveSecondInstance,
      canRegisterSecondInstanceResult: value.canRegisterSecondInstanceResult,
      canRevokeSecondInstanceResult: value.canRevokeSecondInstanceResult,
      sourceLead: value.sourceLead,
      sourceNotaryMatter: value.sourceNotaryMatter,
    }) &&
    courtCaseNoMatchesAcceptance(value.courtCaseNo, value.acceptance) &&
    named(value.department, 'name') &&
    named(value.customer, 'name') &&
    named(value.rightsHolder, 'name') &&
    record(value.certificate) &&
    exact(value.certificate, [
      'certificateNo',
      'certificateDate',
      'issuedAt',
      'needDisclose',
      'files',
      'disclosureFiles',
    ]) &&
    nonempty(value.certificate.certificateNo) &&
    typeof value.certificate.certificateDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.certificate.certificateDate) &&
    typeof value.certificate.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(value.certificate.issuedAt)) &&
    typeof value.certificate.needDisclose === 'boolean' &&
    Array.isArray(value.certificate.files) &&
    value.certificate.files.length > 0 &&
    value.certificate.files.every(caseFile) &&
    Array.isArray(value.certificate.disclosureFiles) &&
    value.certificate.disclosureFiles.every(caseFile) &&
    (!value.certificate.needDisclose ||
      value.certificate.disclosureFiles.length > 0) &&
    Array.isArray(value.fees) &&
    value.fees.every(
      (fee) =>
        record(fee) &&
        exact(fee, ['category', 'state', 'amount', 'sourceType', 'sourceId']) &&
        ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].includes(
          String(fee.category),
        ) &&
        (fee.state === 'KNOWN' || fee.state === 'PENDING') &&
        (fee.amount === null ||
          (typeof fee.amount === 'string' &&
            /^\d+\.\d{2}$/u.test(fee.amount))) &&
        (fee.state === 'KNOWN' ? fee.amount !== null : fee.amount === null) &&
        ['NOTARY_CERTIFICATE_FEE', 'NOTARY_MATTER_EVIDENCE'].includes(
          String(fee.sourceType),
        ) &&
        nonempty(fee.sourceId),
    ) &&
    Array.isArray(value.defendants) &&
    value.defendants.every(defendant) &&
    Array.isArray(value.lawyers) &&
    value.lawyers.every(lawyer) &&
    (value.matchedAt === null ||
      (typeof value.matchedAt === 'string' &&
        !Number.isNaN(Date.parse(value.matchedAt)))) &&
    (value.matchedOn === null || businessDate(value.matchedOn)) &&
    typeof value.canSubmitComplaint === 'boolean' &&
    typeof value.canConfirmComplaint === 'boolean' &&
    typeof value.canMailComplaint === 'boolean' &&
    typeof value.canSubmitFiling === 'boolean' &&
    typeof value.canRegisterAcceptance === 'boolean' &&
    typeof value.canUploadAcceptanceMaterials === 'boolean' &&
    typeof value.canRegisterJudgment === 'boolean' &&
    typeof value.canCorrectJudgment === 'boolean' &&
    typeof value.canChooseJudgmentNextStep === 'boolean' &&
    typeof value.canRevokeJudgmentNextStep === 'boolean' &&
    typeof value.canSaveSecondInstance === 'boolean' &&
    typeof value.canRegisterSecondInstanceResult === 'boolean' &&
    typeof value.canRevokeSecondInstanceResult === 'boolean' &&
    (value.complaint === null || validComplaint(value.complaint)) &&
    (value.complaintConfirmation === null ||
      validComplaintConfirmation(value.complaintConfirmation)) &&
    (value.complaintMailing === null ||
      validCaseComplaintMailing(value.complaintMailing)) &&
    (value.filingSubmission === null ||
      validCaseFilingSubmission(value.filingSubmission)) &&
    validAcceptance(value.acceptance, true) &&
    validAcceptanceMaterials(value.acceptanceMaterials) &&
    validHearing(value.hearing, true) &&
    validJudgment(value.judgment, true) &&
    validNextStep(value.judgmentNextStep, true) &&
    Array.isArray(value.acceptances) &&
    value.acceptances.every((item) => validAcceptanceHistory(item, true)) &&
    validSecondInstance(value.secondInstance, true) &&
    typeof value.canSubmitExecution === 'boolean' &&
    executionSubmissionState(value.executionSubmission) &&
    typeof value.canConfirmExecution === 'boolean' &&
    typeof value.canMailExecution === 'boolean' &&
    typeof value.canSubmitExecutionFiling === 'boolean' &&
    typeof value.canFinishExecution === 'boolean' &&
    typeof value.canRecordClosure === 'boolean' &&
    typeof value.canCorrectClosure === 'boolean' &&
    archiveCapabilities(value) &&
    (value.executionMailing === null ||
      executionMailing(value.executionMailing)) &&
    (value.executionFiling === null ||
      executionFiling(value.executionFiling)) &&
    archiveMatches(value, true) &&
    closureMatches(
      value.closure,
      value.executionFinish,
      value.stage === 'ARCHIVED' ? 'WAITING_ARCHIVE' : value.stage,
      closureTerminalVersion(value),
      value.canRecordClosure,
      value.canCorrectClosure,
      true,
    ) &&
    executionFinishMatches(
      value.executionFinish,
      value.executionFiling,
      value.stage,
      value.canFinishExecution,
    ) &&
    executionFactsMatch(
      value.executionMailing,
      value.executionFiling,
      value.executionConfirmation,
    ) &&
    executionConfirmationMatchesSubmission(
      value.executionConfirmation,
      value.executionSubmission,
    )
  );
}
function validRoundId(value: unknown): boolean {
  return value === null || uuidV4(value);
}
function validSecondInstanceRound(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ['id', 'sequence', 'sourceResultId', 'revokedAt']) &&
    uuidV4(value.id) &&
    Number.isInteger(value.sequence) &&
    Number(value.sequence) >= 1 &&
    (value.sourceResultId === null || uuidV4(value.sourceResultId)) &&
    (value.revokedAt === null ||
      (typeof value.revokedAt === 'string' &&
        !Number.isNaN(Date.parse(value.revokedAt))))
  );
}
function validSecondInstanceProgress(
  value: unknown,
  internal: boolean,
): boolean {
  if (!record(value)) return false;
  const required = [
    'id',
    'trialRoundId',
    'choiceId',
    'priorProgressId',
    'hearingAt',
    'hearingPlace',
    'judgeName',
    'fromVersion',
    'toVersion',
    'recordedAt',
    'documentFiles',
    'serviceFiles',
  ];
  const optional = internal ? ['recordedByUserId'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    uuidV4(value.choiceId) &&
    (value.priorProgressId === null || uuidV4(value.priorProgressId)) &&
    (value.hearingAt === null || businessDate(value.hearingAt)) &&
    (value.hearingPlace === null ||
      (typeof value.hearingPlace === 'string' &&
        value.hearingPlace === value.hearingPlace.trim() &&
        value.hearingPlace.length <= 500)) &&
    (value.judgeName === null ||
      (typeof value.judgeName === 'string' &&
        value.judgeName === value.judgeName.trim() &&
        value.judgeName.length <= 200)) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    Number(value.toVersion) === Number(value.fromVersion) + 1 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('recordedByUserId' in value) ||
      (internal && uuidV4(value.recordedByUserId))) &&
    Array.isArray(value.documentFiles) &&
    value.documentFiles.every(caseFile) &&
    Array.isArray(value.serviceFiles) &&
    value.serviceFiles.every(caseFile)
  );
}
function validSecondInstanceResult(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = [
    'id',
    'trialRoundId',
    'choiceId',
    'judgmentId',
    'progressId',
    'result',
    'resultReceivedAt',
    'judgmentAmountState',
    'judgmentAmount',
    'paidLitigationFeeState',
    'paidLitigationFee',
    'fromVersion',
    'toVersion',
    'recordedAt',
    'files',
    'childTrialRoundId',
    'revocationId',
  ];
  const optional = internal ? ['recordedByUserId'] : [];
  const amountValid = (state: unknown, amount: unknown) =>
    state === 'PENDING'
      ? amount === null
      : state === 'KNOWN' &&
        typeof amount === 'string' &&
        /^(0|[1-9]\d{0,13})\.\d{2}$/u.test(amount);
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    uuidV4(value.choiceId) &&
    uuidV4(value.judgmentId) &&
    (value.progressId === null || uuidV4(value.progressId)) &&
    ['REMAND', 'CHANGE', 'AFFIRM'].includes(String(value.result)) &&
    businessDate(value.resultReceivedAt) &&
    (value.result === 'REMAND'
      ? value.judgmentAmountState === null && value.judgmentAmount === null
      : amountValid(value.judgmentAmountState, value.judgmentAmount)) &&
    amountValid(value.paidLitigationFeeState, value.paidLitigationFee) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    Number(value.toVersion) === Number(value.fromVersion) + 1 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('recordedByUserId' in value) ||
      (internal && uuidV4(value.recordedByUserId))) &&
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.every(caseFile) &&
    (value.childTrialRoundId === null || uuidV4(value.childTrialRoundId)) &&
    (value.revocationId === null || uuidV4(value.revocationId)) &&
    (value.result === 'REMAND'
      ? uuidV4(value.childTrialRoundId)
      : value.childTrialRoundId === null)
  );
}
function validSecondInstanceRevocation(
  value: unknown,
  internal: boolean,
): boolean {
  if (!record(value)) return false;
  const required = ['id', 'resultId', 'fromVersion', 'toVersion', 'recordedAt'];
  const optional = internal ? ['reason', 'recordedByUserId'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.resultId) &&
    Number.isInteger(value.fromVersion) &&
    Number(value.fromVersion) >= 1 &&
    Number.isInteger(value.toVersion) &&
    Number(value.toVersion) === Number(value.fromVersion) + 1 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('reason' in value) ||
      (internal &&
        typeof value.reason === 'string' &&
        value.reason.trim() === value.reason &&
        value.reason.length >= 1 &&
        value.reason.length <= 500)) &&
    (!('recordedByUserId' in value) ||
      (internal && uuidV4(value.recordedByUserId)))
  );
}
function validSecondInstance(value: unknown, internal: boolean): boolean {
  if (
    !record(value) ||
    !exact(value, [
      'currentTrialRoundId',
      'currentProgress',
      'currentResult',
      'rounds',
      'progresses',
      'results',
      'revocations',
    ])
  )
    return false;
  return (
    validRoundId(value.currentTrialRoundId) &&
    (value.currentProgress === null ||
      validSecondInstanceProgress(value.currentProgress, internal)) &&
    (value.currentResult === null ||
      validSecondInstanceResult(value.currentResult, internal)) &&
    Array.isArray(value.rounds) &&
    value.rounds.every(validSecondInstanceRound) &&
    Array.isArray(value.progresses) &&
    value.progresses.every((item) =>
      validSecondInstanceProgress(item, internal),
    ) &&
    Array.isArray(value.results) &&
    value.results.every((item) => validSecondInstanceResult(item, internal)) &&
    Array.isArray(value.revocations) &&
    value.revocations.every((item) =>
      validSecondInstanceRevocation(item, internal),
    )
  );
}
function validAcceptanceHistory(value: unknown, internal: boolean): boolean {
  if (!record(value)) return false;
  const required = [
    'id',
    'trialRoundId',
    'acceptedAt',
    'courtCaseNo',
    'recordedAt',
    'files',
  ];
  const optional = internal ? ['recordedByUserId'] : [];
  return (
    exactWithOptional(value, required, optional) &&
    uuidV4(value.id) &&
    uuidV4(value.trialRoundId) &&
    businessDate(value.acceptedAt) &&
    nonempty(value.courtCaseNo) &&
    value.courtCaseNo.trim() === value.courtCaseNo &&
    value.courtCaseNo.length <= 100 &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (!('recordedByUserId' in value) ||
      (internal && uuidV4(value.recordedByUserId))) &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        record(file) &&
        exact(file, [
          'category',
          'materialId',
          'contentVersionId',
          'originalFilename',
          'mimeType',
        ]) &&
        file.category === 'ACCEPTANCE_NOTICE' &&
        caseFile({
          materialId: file.materialId,
          contentVersionId: file.contentVersionId,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
        }),
    )
  );
}
function validFilingCourt(value: unknown): value is FilingCourt {
  return (
    record(value) &&
    exact(value, ['id', 'name']) &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.id,
    ) &&
    nonempty(value.name) &&
    value.name.trim() === value.name &&
    value.name.length <= 200
  );
}
function validCaseFilingSubmission(
  value: unknown,
): value is CaseFilingSubmission {
  return (
    record(value) &&
    exact(value, [
      'court',
      'submittedAt',
      'recordedAt',
      'recordedByUserId',
      'mediationNo',
      'evidenceFiles',
      'screenshotFiles',
    ]) &&
    validFilingCourt(value.court) &&
    businessDate(value.submittedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    typeof value.recordedByUserId === 'string' &&
    value.recordedByUserId.length > 0 &&
    (value.mediationNo === null ||
      (typeof value.mediationNo === 'string' &&
        value.mediationNo.length >= 1 &&
        value.mediationNo.length <= 100)) &&
    Array.isArray(value.evidenceFiles) &&
    value.evidenceFiles.length >= 1 &&
    value.evidenceFiles.length <= 50 &&
    value.evidenceFiles.every(caseFile) &&
    Array.isArray(value.screenshotFiles) &&
    value.screenshotFiles.length <= 10 &&
    value.screenshotFiles.every(caseFile)
  );
}
function validCaseComplaintMailing(
  value: unknown,
): value is CaseComplaintMailing {
  return (
    record(value) &&
    exact(value, [
      'mailedAt',
      'recordedAt',
      'recordedByUserId',
      'actorType',
      'receiptFiles',
    ]) &&
    businessDate(value.mailedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    nonempty(value.recordedByUserId) &&
    (value.actorType === 'INTERNAL' ||
      value.actorType === 'CLIENT' ||
      value.actorType === 'LAWYER') &&
    Array.isArray(value.receiptFiles) &&
    value.receiptFiles.length > 0 &&
    value.receiptFiles.every(caseFile)
  );
}
function validComplaint(value: unknown): value is ComplaintSubmission {
  return (
    record(value) &&
    exact(value, [
      'amountState',
      'amount',
      'pendingReason',
      'submittedAt',
      'submittedByUserId',
      'complaintFiles',
      'authorizationFiles',
    ]) &&
    (value.amountState === 'KNOWN' || value.amountState === 'PENDING') &&
    (value.amount === null ||
      (typeof value.amount === 'string' &&
        /^\d+(\.\d+)?$/u.test(value.amount))) &&
    (value.amountState === 'KNOWN'
      ? value.amount !== null && value.pendingReason === null
      : value.amount === null && nonempty(value.pendingReason)) &&
    typeof value.submittedAt === 'string' &&
    !Number.isNaN(Date.parse(value.submittedAt)) &&
    nonempty(value.submittedByUserId) &&
    Array.isArray(value.complaintFiles) &&
    value.complaintFiles.every(caseFile) &&
    Array.isArray(value.authorizationFiles) &&
    value.authorizationFiles.every(caseFile)
  );
}
function validComplaintConfirmation(
  value: unknown,
): value is ComplaintConfirmation {
  return (
    record(value) &&
    exact(value, [
      'confirmedComplaintContentVersionId',
      'amountState',
      'amount',
      'pendingReason',
      'changeNote',
      'confirmDisclose',
      'confirmedAt',
      'confirmedByUserId',
      'complaintFile',
    ]) &&
    nonempty(value.confirmedComplaintContentVersionId) &&
    (value.amountState === 'KNOWN' || value.amountState === 'PENDING') &&
    (value.amount === null ||
      (typeof value.amount === 'string' &&
        /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(value.amount))) &&
    (value.amountState === 'KNOWN'
      ? value.amount !== null && value.pendingReason === null
      : value.amount === null && nonempty(value.pendingReason)) &&
    (value.changeNote === null ||
      (typeof value.changeNote === 'string' &&
        value.changeNote.trim().length >= 1 &&
        value.changeNote.length <= 500)) &&
    typeof value.confirmDisclose === 'boolean' &&
    typeof value.confirmedAt === 'string' &&
    !Number.isNaN(Date.parse(value.confirmedAt)) &&
    nonempty(value.confirmedByUserId) &&
    (value.complaintFile === null || caseFile(value.complaintFile))
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的案件数据', 200, 'INVALID_RESPONSE');
}

const caseStages: CaseStage[] = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
  'WAITING_ARCHIVE',
  'ARCHIVED',
];
function validLawyerSummary(value: unknown): value is LawyerCaseSummary {
  return (
    record(value) &&
    exact(value, [
      'id',
      'businessNo',
      'stage',
      'version',
      'canMatch',
      'canSubmitExecution',
      'canConfirmExecution',
      'canMailExecution',
      'canSubmitExecutionFiling',
      'canFinishExecution',
      'canRecordClosure',
      'canCorrectClosure',
      'canArchive',
      'canCorrectArchive',
      'canSubmitComplaint',
      'canConfirmComplaint',
      'canMailComplaint',
      'canSubmitFiling',
      'canRegisterAcceptance',
      'canUploadAcceptanceMaterials',
      'canScheduleHearing',
      'canCorrectHearing',
      'canRegisterJudgment',
      'canCorrectJudgment',
      'canChooseJudgmentNextStep',
      'canRevokeJudgmentNextStep',
      'canSaveSecondInstance',
      'canRegisterSecondInstanceResult',
      'canRevokeSecondInstanceResult',
      'createdAt',
    ]) &&
    nonempty(value.id) &&
    nonempty(value.businessNo) &&
    caseStages.includes(value.stage as CaseStage) &&
    Number.isInteger(value.version) &&
    Number(value.version) > 0 &&
    value.canMatch === false &&
    typeof value.canSubmitExecution === 'boolean' &&
    typeof value.canConfirmExecution === 'boolean' &&
    typeof value.canMailExecution === 'boolean' &&
    typeof value.canSubmitExecutionFiling === 'boolean' &&
    typeof value.canFinishExecution === 'boolean' &&
    typeof value.canRecordClosure === 'boolean' &&
    value.canCorrectClosure === false &&
    archiveCapabilities(value) &&
    value.canCorrectArchive === false &&
    typeof value.canSubmitComplaint === 'boolean' &&
    typeof value.canConfirmComplaint === 'boolean' &&
    typeof value.canMailComplaint === 'boolean' &&
    typeof value.canSubmitFiling === 'boolean' &&
    typeof value.canRegisterAcceptance === 'boolean' &&
    typeof value.canUploadAcceptanceMaterials === 'boolean' &&
    typeof value.canScheduleHearing === 'boolean' &&
    value.canCorrectHearing === false &&
    typeof value.canRegisterJudgment === 'boolean' &&
    value.canCorrectJudgment === false &&
    typeof value.canChooseJudgmentNextStep === 'boolean' &&
    value.canRevokeJudgmentNextStep === false &&
    typeof value.canSaveSecondInstance === 'boolean' &&
    typeof value.canRegisterSecondInstanceResult === 'boolean' &&
    value.canRevokeSecondInstanceResult === false &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}
function lawyerCounts(value: unknown): value is Record<CaseStage, number> {
  return (
    record(value) &&
    exact(value, caseStages) &&
    caseStages.every(
      (stage) => Number.isInteger(value[stage]) && Number(value[stage]) >= 0,
    )
  );
}
function lawyerComplaint(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'amountState',
      'amount',
      'pendingReason',
      'submittedAt',
      'complaintFiles',
      'authorizationFiles',
    ]) &&
    (value.amountState === 'KNOWN' || value.amountState === 'PENDING') &&
    (value.amount === null ||
      (typeof value.amount === 'string' &&
        /^\d+(\.\d+)?$/u.test(value.amount))) &&
    (value.amountState === 'KNOWN'
      ? value.amount !== null && value.pendingReason === null
      : value.amount === null && nonempty(value.pendingReason)) &&
    typeof value.submittedAt === 'string' &&
    !Number.isNaN(Date.parse(value.submittedAt)) &&
    Array.isArray(value.complaintFiles) &&
    value.complaintFiles.every(caseFile) &&
    Array.isArray(value.authorizationFiles) &&
    value.authorizationFiles.every(caseFile)
  );
}
function lawyerComplaintConfirmation(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'confirmedComplaintContentVersionId',
      'amountState',
      'amount',
      'pendingReason',
      'changeNote',
      'confirmDisclose',
      'confirmedAt',
      'complaintFile',
    ]) &&
    nonempty(value.confirmedComplaintContentVersionId) &&
    (value.amountState === 'KNOWN' || value.amountState === 'PENDING') &&
    (value.amount === null ||
      (typeof value.amount === 'string' &&
        /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(value.amount))) &&
    (value.amountState === 'KNOWN'
      ? value.amount !== null && value.pendingReason === null
      : value.amount === null && nonempty(value.pendingReason)) &&
    (value.changeNote === null ||
      (typeof value.changeNote === 'string' &&
        value.changeNote.trim().length > 0 &&
        value.changeNote.length <= 500)) &&
    typeof value.confirmDisclose === 'boolean' &&
    typeof value.confirmedAt === 'string' &&
    !Number.isNaN(Date.parse(value.confirmedAt)) &&
    (value.complaintFile === null || caseFile(value.complaintFile))
  );
}
function lawyerMailing(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ['mailedAt', 'recordedAt', 'actorType', 'receiptFiles']) &&
    businessDate(value.mailedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (value.actorType === 'INTERNAL' ||
      value.actorType === 'CLIENT' ||
      value.actorType === 'LAWYER') &&
    Array.isArray(value.receiptFiles) &&
    value.receiptFiles.length > 0 &&
    value.receiptFiles.every(caseFile)
  );
}
function lawyerFiling(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'court',
      'submittedAt',
      'recordedAt',
      'mediationNo',
      'evidenceFiles',
      'screenshotFiles',
    ]) &&
    validFilingCourt(value.court) &&
    businessDate(value.submittedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    (value.mediationNo === null ||
      (typeof value.mediationNo === 'string' &&
        value.mediationNo.length > 0 &&
        value.mediationNo.length <= 100)) &&
    Array.isArray(value.evidenceFiles) &&
    value.evidenceFiles.length > 0 &&
    value.evidenceFiles.every(caseFile) &&
    Array.isArray(value.screenshotFiles) &&
    value.screenshotFiles.every(caseFile)
  );
}
function lawyerCertificate(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'certificateNo',
      'certificateDate',
      'issuedAt',
      'needDisclose',
      'files',
      'disclosureFiles',
    ]) &&
    nonempty(value.certificateNo) &&
    businessDate(value.certificateDate) &&
    typeof value.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(value.issuedAt)) &&
    typeof value.needDisclose === 'boolean' &&
    Array.isArray(value.files) &&
    value.files.length > 0 &&
    value.files.every(caseFile) &&
    Array.isArray(value.disclosureFiles) &&
    value.disclosureFiles.every(caseFile) &&
    (!value.needDisclose || value.disclosureFiles.length > 0)
  );
}

export async function listLawyerCases(
  page = 1,
  pageSize = 20,
  stage?: CaseStage,
  options: RequestOptions & { stageGroup?: CaseStageGroup } = {},
): Promise<LawyerCaseList> {
  if (stage && options.stageGroup)
    throw new ApiError('案件阶段和阶段组不能同时筛选', 400, 'VALIDATION_ERROR');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (stage) query.set('stage', stage);
  if (options.stageGroup) query.set('stageGroup', options.stageGroup);
  const result = await getJson(`/lawyer/cases?${query}`, options);
  if (
    !record(result) ||
    !exact(result, ['items', 'total', 'page', 'pageSize', 'counts']) ||
    !Array.isArray(result.items) ||
    !result.items.every(validLawyerSummary) ||
    !Number.isInteger(result.total) ||
    Number(result.total) < 0 ||
    result.page !== page ||
    result.pageSize !== pageSize ||
    !lawyerCounts(result.counts)
  )
    throw invalidResponse();
  return result as LawyerCaseList;
}

export async function getLawyerCase(
  id: string,
  options: RequestOptions = {},
): Promise<LawyerCaseDetail> {
  const result = await getJson(
    `/lawyer/cases/${encodeURIComponent(id)}`,
    options,
  );
  if (
    !record(result) ||
    !exact(result, [
      'id',
      'businessNo',
      'stage',
      'version',
      'canMatch',
      'canSubmitComplaint',
      'canConfirmComplaint',
      'canMailComplaint',
      'canSubmitFiling',
      'canRegisterAcceptance',
      'canUploadAcceptanceMaterials',
      'canScheduleHearing',
      'canCorrectHearing',
      'canRegisterJudgment',
      'canCorrectJudgment',
      'canChooseJudgmentNextStep',
      'canRevokeJudgmentNextStep',
      'canSaveSecondInstance',
      'canRegisterSecondInstanceResult',
      'canRevokeSecondInstanceResult',
      'createdAt',
      'matchedAt',
      'matchedOn',
      'defendants',
      'lawyers',
      'customer',
      'rightsHolder',
      'certificate',
      'complaint',
      'complaintConfirmation',
      'complaintMailing',
      'filingSubmission',
      'courtCaseNo',
      'acceptance',
      'acceptanceMaterials',
      'hearing',
      'judgment',
      'judgmentNextStep',
      'acceptances',
      'secondInstance',
      'canSubmitExecution',
      'executionSubmission',
      'canConfirmExecution',
      'executionConfirmation',
      'canMailExecution',
      'canSubmitExecutionFiling',
      'canFinishExecution',
      'canRecordClosure',
      'canCorrectClosure',
      'canArchive',
      'canCorrectArchive',
      'executionMailing',
      'executionFiling',
      'executionFinish',
      'closure',
      'archive',
    ]) ||
    result.id !== id ||
    !validLawyerSummary({
      id: result.id,
      businessNo: result.businessNo,
      stage: result.stage,
      version: result.version,
      canMatch: result.canMatch,
      canSubmitExecution: result.canSubmitExecution,
      canConfirmExecution: result.canConfirmExecution,
      canMailExecution: result.canMailExecution,
      canSubmitExecutionFiling: result.canSubmitExecutionFiling,
      canFinishExecution: result.canFinishExecution,
      canRecordClosure: result.canRecordClosure,
      canCorrectClosure: result.canCorrectClosure,
      canArchive: result.canArchive,
      canCorrectArchive: result.canCorrectArchive,
      canSubmitComplaint: result.canSubmitComplaint,
      canConfirmComplaint: result.canConfirmComplaint,
      canMailComplaint: result.canMailComplaint,
      canSubmitFiling: result.canSubmitFiling,
      canRegisterAcceptance: result.canRegisterAcceptance,
      canUploadAcceptanceMaterials: result.canUploadAcceptanceMaterials,
      canScheduleHearing: result.canScheduleHearing,
      canCorrectHearing: result.canCorrectHearing,
      canRegisterJudgment: result.canRegisterJudgment,
      canCorrectJudgment: result.canCorrectJudgment,
      canChooseJudgmentNextStep: result.canChooseJudgmentNextStep,
      canRevokeJudgmentNextStep: result.canRevokeJudgmentNextStep,
      canSaveSecondInstance: result.canSaveSecondInstance,
      canRegisterSecondInstanceResult: result.canRegisterSecondInstanceResult,
      canRevokeSecondInstanceResult: result.canRevokeSecondInstanceResult,
      createdAt: result.createdAt,
    }) ||
    (result.matchedAt !== null &&
      (typeof result.matchedAt !== 'string' ||
        Number.isNaN(Date.parse(result.matchedAt)))) ||
    (result.matchedOn !== null && !businessDate(result.matchedOn)) ||
    !Array.isArray(result.defendants) ||
    !result.defendants.every(defendant) ||
    !Array.isArray(result.lawyers) ||
    !result.lawyers.every(lawyer) ||
    !named(result.customer, 'name') ||
    !named(result.rightsHolder, 'name') ||
    !lawyerCertificate(result.certificate) ||
    (result.complaint !== null && !lawyerComplaint(result.complaint)) ||
    (result.complaintConfirmation !== null &&
      !lawyerComplaintConfirmation(result.complaintConfirmation)) ||
    (result.complaintMailing !== null &&
      !lawyerMailing(result.complaintMailing)) ||
    (result.filingSubmission !== null &&
      !lawyerFiling(result.filingSubmission)) ||
    !courtCaseNoMatchesAcceptance(result.courtCaseNo, result.acceptance) ||
    !validAcceptance(result.acceptance, false) ||
    !validAcceptanceMaterials(result.acceptanceMaterials) ||
    !validHearing(result.hearing, false) ||
    !validJudgment(result.judgment, false) ||
    !validNextStep(result.judgmentNextStep, false) ||
    !Array.isArray(result.acceptances) ||
    !result.acceptances.every((item) => validAcceptanceHistory(item, false)) ||
    !validSecondInstance(result.secondInstance, false) ||
    typeof result.canSubmitExecution !== 'boolean' ||
    !executionSubmissionState(result.executionSubmission) ||
    typeof result.canConfirmExecution !== 'boolean' ||
    typeof result.canMailExecution !== 'boolean' ||
    typeof result.canSubmitExecutionFiling !== 'boolean' ||
    typeof result.canFinishExecution !== 'boolean' ||
    (result.executionMailing !== null &&
      !executionMailing(result.executionMailing)) ||
    (result.executionFiling !== null &&
      !executionFiling(result.executionFiling)) ||
    !archiveMatches(result, false) ||
    !closureMatches(
      result.closure,
      result.executionFinish,
      result.stage === 'ARCHIVED' ? 'WAITING_ARCHIVE' : result.stage,
      closureTerminalVersion(result),
      result.canRecordClosure,
      result.canCorrectClosure,
      false,
    ) ||
    !executionFinishMatches(
      result.executionFinish,
      result.executionFiling,
      result.stage,
      result.canFinishExecution,
    ) ||
    !executionFactsMatch(
      result.executionMailing,
      result.executionFiling,
      result.executionConfirmation,
    ) ||
    !executionConfirmationMatchesSubmission(
      result.executionConfirmation,
      result.executionSubmission,
    )
  )
    throw invalidResponse();
  return result as unknown as LawyerCaseDetail;
}

export async function listLawyerMatchCandidates(
  id: string,
  q = '',
  options: RequestOptions = {},
): Promise<LawyerMatchCandidate[]> {
  const result = await getJson(
    `/cases/${encodeURIComponent(id)}/lawyer-accounts?q=${encodeURIComponent(q.trim())}`,
    options,
  );
  if (
    !record(result) ||
    !exact(result, ['items']) ||
    !Array.isArray(result.items) ||
    result.items.length > 50 ||
    !result.items.every(
      (item) =>
        record(item) &&
        exact(item, [
          'lawyerAccountId',
          'username',
          'displayName',
          'lawyerProfileId',
        ]) &&
        nonempty(item.lawyerAccountId) &&
        nonempty(item.username) &&
        nonempty(item.displayName) &&
        nonempty(item.lawyerProfileId),
    )
  )
    throw invalidResponse();
  const ids = result.items.map(
    (item) => (item as LawyerMatchCandidate).lawyerAccountId,
  );
  if (new Set(ids).size !== ids.length) throw invalidResponse();
  return result.items as LawyerMatchCandidate[];
}

export async function listCases(
  page = 1,
  pageSize = 20,
  options: RequestOptions & {
    view?: CaseView;
    stage?: CaseStageFilter;
    stageGroup?: CaseStageGroup;
  } = {},
): Promise<CaseList> {
  if (options.stage && options.stage !== 'all' && options.stageGroup)
    throw new ApiError('案件阶段和阶段组不能同时筛选', 400, 'VALIDATION_ERROR');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    view: options.view ?? 'mine',
  });
  if (options.stage && options.stage !== 'all')
    query.set('stage', options.stage);
  if (options.stageGroup) query.set('stageGroup', options.stageGroup);
  const response = await getJson(`/cases?${query}`, options);
  if (
    !record(response) ||
    !exact(response, ['items', 'total', 'page', 'pageSize', 'counts']) ||
    !Array.isArray(response.items) ||
    !response.items.every(summary) ||
    !Number.isInteger(response.total) ||
    (response.total as number) < 0 ||
    response.page !== page ||
    response.pageSize !== pageSize ||
    !record(response.counts) ||
    !exact(response.counts, [
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'WAITING_FORMAL_ACCEPTANCE',
      'WAITING_HEARING',
      'WAITING_JUDGMENT',
      'SECOND_INSTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
      'WAITING_EXECUTION_FILING',
      'EXECUTING',
      'WAITING_ARCHIVE',
      'ARCHIVED',
    ]) ||
    !Number.isInteger(response.counts.PENDING_MATCH) ||
    (response.counts.PENDING_MATCH as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT) ||
    (response.counts.WAITING_COMPLAINT as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT_CONFIRMATION) ||
    (response.counts.WAITING_COMPLAINT_CONFIRMATION as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT_STAMP) ||
    (response.counts.WAITING_COMPLAINT_STAMP as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_FILING) ||
    (response.counts.WAITING_FILING as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_FORMAL_ACCEPTANCE) ||
    (response.counts.WAITING_FORMAL_ACCEPTANCE as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_HEARING) ||
    (response.counts.WAITING_HEARING as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_JUDGMENT) ||
    (response.counts.WAITING_JUDGMENT as number) < 0 ||
    !Number.isInteger(response.counts.SECOND_INSTANCE) ||
    (response.counts.SECOND_INSTANCE as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_EXECUTION_DOCUMENTS) ||
    (response.counts.WAITING_EXECUTION_DOCUMENTS as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_EXECUTION_CONFIRMATION) ||
    (response.counts.WAITING_EXECUTION_CONFIRMATION as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_EXECUTION_STAMP) ||
    (response.counts.WAITING_EXECUTION_STAMP as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_EXECUTION_FILING) ||
    (response.counts.WAITING_EXECUTION_FILING as number) < 0 ||
    !Number.isInteger(response.counts.ARCHIVED) ||
    Number(response.counts.ARCHIVED) < 0 ||
    !Number.isInteger(response.counts.WAITING_ARCHIVE) ||
    Number(response.counts.WAITING_ARCHIVE) < 0 ||
    !Number.isInteger(response.counts.EXECUTING) ||
    (response.counts.EXECUTING as number) < 0
  )
    throw invalidResponse();
  return response as unknown as CaseList;
}

export type SubmitCaseFilingInput = {
  expectedVersion: number;
  idempotencyKey: string;
  courtId: string;
  submittedAt: string;
  filingEvidenceContentVersionIds: string[];
  filingScreenshotContentVersionIds?: string[];
  mediationNo?: string;
};
export type SubmitCaseFilingResult = {
  id: string;
  stage: 'WAITING_FORMAL_ACCEPTANCE';
  version: number;
  submittedAt: string;
  recordedAt: string;
};
export type RegisterCaseAcceptanceInput = {
  expectedVersion: number;
  idempotencyKey: string;
  acceptedAt: string;
  courtCaseNo: string;
  acceptanceNoticeContentVersionIds?: string[];
  paymentListContentVersionIds?: string[];
  serviceDocumentContentVersionIds?: string[];
};
export type RegisterCaseAcceptanceResult = {
  id: string;
  stage: 'WAITING_HEARING';
  version: number;
  acceptedAt: string;
  courtCaseNo: string;
  recordedAt: string;
};
export type SaveCaseHearingInput = {
  expectedVersion: number;
  idempotencyKey: string;
  hearingAt: string | null;
};
export type CorrectCaseHearingInput = SaveCaseHearingInput & {
  reason: string;
};
export type CaseHearingCommandResult = {
  id: string;
  stage: 'WAITING_HEARING' | 'WAITING_JUDGMENT';
  version: number;
  arrangementId: string;
  hearingAt: string | null;
  recordedAt: string;
};
export type RegisterCaseJudgmentInput = {
  expectedVersion: number;
  idempotencyKey: string;
  judgmentReceivedAt: string;
  judgmentAmountState: 'KNOWN' | 'PENDING';
  judgmentAmount: string | null;
  paidLitigationFeeState: 'KNOWN' | 'PENDING';
  paidLitigationFee: string | null;
  judgmentContentVersionIds: string[];
};
export type CorrectCaseJudgmentInput = RegisterCaseJudgmentInput & {
  reason: string;
};
export type CaseJudgmentCommandResult = {
  id: string;
  stage: 'WAITING_JUDGMENT';
  version: number;
  judgmentId: string;
  recordedAt: string;
};
type JudgmentNextStepBaseInput = {
  expectedVersion: number;
  idempotencyKey: string;
  judgmentId: string;
};
export type ChooseCaseJudgmentNextStepInput = JudgmentNextStepBaseInput &
  (
    | { next: 'EXECUTION'; executionReadinessConfirmed: true }
    | { next: 'APPEAL'; plaintiffAppeals: boolean; defendantIds: string[] }
  );
export type RevokeCaseJudgmentNextStepInput = {
  expectedVersion: number;
  idempotencyKey: string;
  choiceId: string;
  reason: string;
};
export type CaseJudgmentNextStepCommandResult = {
  id: string;
  stage: 'SECOND_INSTANCE' | 'WAITING_EXECUTION_DOCUMENTS';
  version: number;
  choiceId: string;
  judgmentId: string;
  recordedAt: string;
};
export type CaseJudgmentNextStepRevokeResult = {
  id: string;
  stage: 'WAITING_JUDGMENT';
  version: number;
  choiceId: string;
  revocationId: string;
  judgmentId: string;
  recordedAt: string;
};
function validCommandBase(value: JudgmentNextStepBaseInput): boolean {
  return (
    Number.isInteger(value.expectedVersion) &&
    value.expectedVersion >= 1 &&
    typeof value.idempotencyKey === 'string' &&
    value.idempotencyKey.trim() === value.idempotencyKey &&
    value.idempotencyKey.length >= 1 &&
    value.idempotencyKey.length <= 128 &&
    uuidV4(value.judgmentId)
  );
}
function validChoiceInput(value: ChooseCaseJudgmentNextStepInput): boolean {
  if (!validCommandBase(value)) return false;
  if (value.next === 'EXECUTION')
    return (
      exact(value, [
        'expectedVersion',
        'idempotencyKey',
        'judgmentId',
        'next',
        'executionReadinessConfirmed',
      ]) && value.executionReadinessConfirmed === true
    );
  return (
    value.next === 'APPEAL' &&
    exact(value, [
      'expectedVersion',
      'idempotencyKey',
      'judgmentId',
      'next',
      'plaintiffAppeals',
      'defendantIds',
    ]) &&
    typeof value.plaintiffAppeals === 'boolean' &&
    Array.isArray(value.defendantIds) &&
    value.defendantIds.every(uuidV4) &&
    new Set(value.defendantIds).size === value.defendantIds.length &&
    (value.plaintiffAppeals || value.defendantIds.length > 0)
  );
}
function validNextStepResult(
  value: unknown,
  id: string,
  input: ChooseCaseJudgmentNextStepInput,
): value is CaseJudgmentNextStepCommandResult {
  const stage =
    input.next === 'APPEAL' ? 'SECOND_INSTANCE' : 'WAITING_EXECUTION_DOCUMENTS';
  return (
    record(value) &&
    exact(value, [
      'id',
      'stage',
      'version',
      'choiceId',
      'judgmentId',
      'recordedAt',
    ]) &&
    value.id === id &&
    value.stage === stage &&
    Number.isInteger(value.version) &&
    Number(value.version) === input.expectedVersion + 1 &&
    uuidV4(value.choiceId) &&
    value.judgmentId === input.judgmentId &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt))
  );
}
function validIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <= 128
  );
}
function normalizeSecondInstanceProgress(
  value: SecondInstanceProgressInput,
): SecondInstanceProgressInput | null {
  const validIds = (ids: unknown) =>
    Array.isArray(ids) &&
    ids.length <= 10 &&
    ids.every(uuidV4) &&
    new Set(ids).size === ids.length;
  if (
    !record(value) ||
    !exact(value, [
      'hearingAt',
      'hearingPlace',
      'judgeName',
      'documentContentVersionIds',
      'serviceContentVersionIds',
    ]) ||
    !(value.hearingAt === null || businessDate(value.hearingAt)) ||
    !(
      value.hearingPlace === null ||
      (typeof value.hearingPlace === 'string' &&
        value.hearingPlace.trim().length <= 500)
    ) ||
    !(
      value.judgeName === null ||
      (typeof value.judgeName === 'string' &&
        value.judgeName.trim().length <= 200)
    ) ||
    !validIds(value.documentContentVersionIds) ||
    !validIds(value.serviceContentVersionIds)
  )
    return null;
  return {
    hearingAt: value.hearingAt,
    hearingPlace:
      typeof value.hearingPlace === 'string' && value.hearingPlace.trim()
        ? value.hearingPlace.trim()
        : null,
    judgeName:
      typeof value.judgeName === 'string' && value.judgeName.trim()
        ? value.judgeName.trim()
        : null,
    documentContentVersionIds: value.documentContentVersionIds,
    serviceContentVersionIds: value.serviceContentVersionIds,
  };
}
function validSecondInstanceCommandResult(
  value: unknown,
  id: string,
  expectedVersion: number,
  expectedStage: CaseStage | readonly CaseStage[],
  command:
    | { kind: 'SAVE' | 'RESULT'; expectedProgressId: string | null }
    | { kind: 'REVOKE' },
): value is SecondInstanceCommandResult {
  const stages = Array.isArray(expectedStage) ? expectedStage : [expectedStage];
  if (!record(value)) return false;
  const keys = [
    'id',
    'stage',
    'version',
    'currentTrialRoundId',
    'progressId',
    'resultId',
    'recordedAt',
  ];
  if (command.kind === 'REVOKE') keys.push('revocationId');
  const versionIncrement =
    command.kind === 'REVOKE'
      ? 1
      : value.progressId === command.expectedProgressId
        ? command.kind === 'SAVE'
          ? 0
          : 1
        : value.progressId !== null && uuidV4(value.progressId)
          ? command.kind === 'SAVE'
            ? 1
            : 2
          : null;
  return (
    exact(value, keys) &&
    value.id === id &&
    stages.includes(value.stage as CaseStage) &&
    versionIncrement !== null &&
    Number(value.version) === expectedVersion + versionIncrement &&
    validRoundId(value.currentTrialRoundId) &&
    (value.progressId === null || uuidV4(value.progressId)) &&
    (value.resultId === null || uuidV4(value.resultId)) &&
    (command.kind !== 'REVOKE' || uuidV4(value.revocationId)) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt))
  );
}
function validateSecondInstanceCommon(
  input: Pick<
    SaveSecondInstanceInput,
    'expectedVersion' | 'idempotencyKey' | 'trialRoundId' | 'choiceId'
  >,
): boolean {
  return (
    Number.isInteger(input.expectedVersion) &&
    input.expectedVersion >= 1 &&
    validIdempotencyKey(input.idempotencyKey) &&
    uuidV4(input.trialRoundId) &&
    uuidV4(input.choiceId)
  );
}
export async function saveSecondInstance(
  id: string,
  input: SaveSecondInstanceInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<SecondInstanceCommandResult> {
  const progress = normalizeSecondInstanceProgress(input.progress);
  if (
    !validateSecondInstanceCommon(input) ||
    (input.expectedProgressId !== null && !uuidV4(input.expectedProgressId)) ||
    !progress
  )
    throw new ApiError(
      '二审进展无效，请检查日期、文本和材料。',
      400,
      'VALIDATION_ERROR',
    );
  const body = { ...input, progress };
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/second-instance-save`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  if (
    !validSecondInstanceCommandResult(
      response,
      id,
      input.expectedVersion,
      'SECOND_INSTANCE',
      { kind: 'SAVE', expectedProgressId: input.expectedProgressId },
    )
  )
    throw invalidResponse();
  return response;
}
export async function registerSecondInstanceResult(
  id: string,
  input: RegisterSecondInstanceResultInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<SecondInstanceCommandResult> {
  const progress = normalizeSecondInstanceProgress(input.progress);
  const amountValid = (amount: {
    state: 'KNOWN' | 'PENDING';
    amount: string | null;
  }) =>
    amount.state === 'PENDING'
      ? amount.amount === null
      : typeof amount.amount === 'string' &&
        /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(amount.amount);
  const resultShape =
    input.result === 'CHANGE'
      ? input.judgmentAmount !== undefined && amountValid(input.judgmentAmount)
      : input.judgmentAmount === undefined;
  if (
    !validateSecondInstanceCommon(input) ||
    (input.expectedProgressId !== null && !uuidV4(input.expectedProgressId)) ||
    !progress ||
    !['REMAND', 'CHANGE', 'AFFIRM'].includes(input.result) ||
    !businessDate(input.resultReceivedAt) ||
    input.resultReceivedAt > todayShanghai() ||
    !Array.isArray(input.judgmentContentVersionIds) ||
    input.judgmentContentVersionIds.length < 1 ||
    input.judgmentContentVersionIds.length > 10 ||
    !input.judgmentContentVersionIds.every(uuidV4) ||
    new Set(input.judgmentContentVersionIds).size !==
      input.judgmentContentVersionIds.length ||
    !record(input.paidLitigationFee) ||
    !exact(input.paidLitigationFee, ['state', 'amount']) ||
    !amountValid(input.paidLitigationFee) ||
    !resultShape
  )
    throw new ApiError(
      '二审结果无效，请检查结果、日期、金额和材料。',
      400,
      'VALIDATION_ERROR',
    );
  const body = { ...input, progress };
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/second-instance-result`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  const stage =
    input.result === 'REMAND'
      ? 'WAITING_FORMAL_ACCEPTANCE'
      : 'WAITING_EXECUTION_DOCUMENTS';
  if (
    !validSecondInstanceCommandResult(
      response,
      id,
      input.expectedVersion,
      stage,
      { kind: 'RESULT', expectedProgressId: input.expectedProgressId },
    )
  )
    throw invalidResponse();
  return response;
}
export async function revokeSecondInstanceResult(
  id: string,
  input: RevokeSecondInstanceResultInput,
): Promise<SecondInstanceCommandResult> {
  const reason = input.reason.trim();
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.trialRoundId) ||
    !uuidV4(input.resultId) ||
    reason.length < 1 ||
    reason.length > 500
  )
    throw new ApiError(
      '撤销二审结果无效，请填写原因。',
      400,
      'VALIDATION_ERROR',
    );
  const body = { ...input, reason };
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/second-instance-result-revoke`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  if (
    !validSecondInstanceCommandResult(
      response,
      id,
      input.expectedVersion,
      'SECOND_INSTANCE',
      { kind: 'REVOKE' },
    )
  )
    throw invalidResponse();
  return response;
}
export async function chooseCaseJudgmentNextStep(
  id: string,
  input: ChooseCaseJudgmentNextStepInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<CaseJudgmentNextStepCommandResult> {
  if (!validChoiceInput(input))
    throw new ApiError(
      '判决后续选择无效，请检查选择分支。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/judgment-next-step`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (!validNextStepResult(response, id, input)) throw invalidResponse();
  return response;
}
export async function revokeCaseJudgmentNextStep(
  id: string,
  input: RevokeCaseJudgmentNextStepInput,
): Promise<CaseJudgmentNextStepRevokeResult> {
  const reason = input.reason.trim();
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    input.idempotencyKey.length < 1 ||
    input.idempotencyKey.length > 128 ||
    !uuidV4(input.choiceId) ||
    reason.length < 1 ||
    reason.length > 500
  )
    throw new ApiError(
      '撤销判决后续选择无效，请填写原因。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/judgment-next-step-revoke`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: { ...input, reason },
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'stage',
      'version',
      'choiceId',
      'revocationId',
      'judgmentId',
      'recordedAt',
    ]) ||
    response.id !== id ||
    response.stage !== 'WAITING_JUDGMENT' ||
    !Number.isInteger(response.version) ||
    Number(response.version) !== input.expectedVersion + 1 ||
    response.choiceId !== input.choiceId ||
    !uuidV4(response.revocationId) ||
    !uuidV4(response.judgmentId) ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as CaseJudgmentNextStepRevokeResult;
}
function uuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
function uniqueVersions(values: string[], minimum: number, maximum: number) {
  return (
    values.length >= minimum &&
    values.length <= maximum &&
    new Set(values).size === values.length &&
    values.every(uuidV4)
  );
}
function validCaseHearingInput(input: SaveCaseHearingInput): boolean {
  return (
    Number.isInteger(input.expectedVersion) &&
    input.expectedVersion >= 1 &&
    typeof input.idempotencyKey === 'string' &&
    input.idempotencyKey === input.idempotencyKey.trim() &&
    input.idempotencyKey.length >= 1 &&
    input.idempotencyKey.length <= 128 &&
    (input.hearingAt === null || businessDate(input.hearingAt))
  );
}
function validJudgmentAmount(
  state: 'KNOWN' | 'PENDING',
  amount: string | null,
): boolean {
  return state === 'KNOWN'
    ? typeof amount === 'string' &&
        /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(amount)
    : amount === null;
}
function validCaseJudgmentInput(input: RegisterCaseJudgmentInput): boolean {
  return (
    Number.isInteger(input.expectedVersion) &&
    input.expectedVersion >= 1 &&
    typeof input.idempotencyKey === 'string' &&
    input.idempotencyKey === input.idempotencyKey.trim() &&
    input.idempotencyKey.length >= 1 &&
    input.idempotencyKey.length <= 128 &&
    businessDate(input.judgmentReceivedAt) &&
    input.judgmentReceivedAt <= todayShanghai() &&
    (input.judgmentAmountState === 'KNOWN' ||
      input.judgmentAmountState === 'PENDING') &&
    validJudgmentAmount(input.judgmentAmountState, input.judgmentAmount) &&
    (input.paidLitigationFeeState === 'KNOWN' ||
      input.paidLitigationFeeState === 'PENDING') &&
    validJudgmentAmount(
      input.paidLitigationFeeState,
      input.paidLitigationFee,
    ) &&
    Array.isArray(input.judgmentContentVersionIds) &&
    uniqueVersions(input.judgmentContentVersionIds, 1, 10)
  );
}
function validCaseJudgmentCommandResult(
  value: unknown,
  id: string,
  expectedVersion: number,
): value is CaseJudgmentCommandResult {
  return (
    record(value) &&
    exact(value, ['id', 'stage', 'version', 'judgmentId', 'recordedAt']) &&
    value.id === id &&
    value.stage === 'WAITING_JUDGMENT' &&
    Number.isInteger(value.version) &&
    Number(value.version) === expectedVersion + 1 &&
    uuidV4(value.judgmentId) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt))
  );
}
export async function registerCaseJudgment(
  id: string,
  input: RegisterCaseJudgmentInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<CaseJudgmentCommandResult> {
  if (!validCaseJudgmentInput(input))
    throw new ApiError(
      '判决登记信息无效，请检查日期、金额状态和判决书。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/judgment-register`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (!validCaseJudgmentCommandResult(response, id, input.expectedVersion))
    throw invalidResponse();
  return response;
}
export async function correctCaseJudgment(
  id: string,
  input: CorrectCaseJudgmentInput,
): Promise<CaseJudgmentCommandResult> {
  const reason = input.reason.trim();
  if (
    !validCaseJudgmentInput(input) ||
    reason.length < 1 ||
    reason.length > 500
  )
    throw new ApiError(
      '判决更正信息无效，请检查日期、金额、判决书和更正原因。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/judgment-correct`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: { ...input, reason },
    },
  );
  if (!validCaseJudgmentCommandResult(response, id, input.expectedVersion))
    throw invalidResponse();
  return response;
}
function validCaseHearingCommandResult(
  value: unknown,
  id: string,
  expectedVersion: number,
): value is CaseHearingCommandResult {
  return (
    record(value) &&
    exact(value, [
      'id',
      'stage',
      'version',
      'arrangementId',
      'hearingAt',
      'recordedAt',
    ]) &&
    value.id === id &&
    (value.stage === 'WAITING_HEARING' || value.stage === 'WAITING_JUDGMENT') &&
    Number.isInteger(value.version) &&
    Number(value.version) === expectedVersion + 1 &&
    uuidV4(value.arrangementId) &&
    (value.hearingAt === null || businessDate(value.hearingAt)) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt))
  );
}
export async function scheduleCaseHearing(
  id: string,
  input: SaveCaseHearingInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<CaseHearingCommandResult> {
  if (!validCaseHearingInput(input))
    throw new ApiError(
      '开庭安排无效，请检查日期和请求版本。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/hearing-schedule`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (!validCaseHearingCommandResult(response, id, input.expectedVersion))
    throw invalidResponse();
  return response;
}
export async function correctCaseHearing(
  id: string,
  input: CorrectCaseHearingInput,
): Promise<CaseHearingCommandResult> {
  const reason = input.reason.trim();
  if (!validCaseHearingInput(input) || reason.length < 1 || reason.length > 500)
    throw new ApiError(
      '开庭纠错信息无效，请填写 1～500 个字符的原因。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/hearing-correct`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: { ...input, reason },
    },
  );
  if (!validCaseHearingCommandResult(response, id, input.expectedVersion))
    throw invalidResponse();
  return response;
}
export async function listFilingCourts(
  id: string,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<FilingCourt[]> {
  const response = await getJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/filing-courts`,
  );
  if (
    !record(response) ||
    !exact(response, ['items']) ||
    !Array.isArray(response.items) ||
    !response.items.every(validFilingCourt)
  )
    throw invalidResponse();
  return response.items;
}
export async function createFilingCourt(
  id: string,
  input: { name: string },
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<FilingCourt> {
  const name = input.name.trim();
  if (!name || name.length > 200)
    throw new ApiError(
      '请输入真实法院名称（1～200 个字符）。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/filing-courts`,
    { method: 'POST', body: { name } },
  );
  if (!validFilingCourt(response) || response.name !== name)
    throw invalidResponse();
  return response;
}
export async function submitCaseFiling(
  id: string,
  input: SubmitCaseFilingInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<SubmitCaseFilingResult> {
  const screenshots = input.filingScreenshotContentVersionIds ?? [];
  const mediationNo = input.mediationNo?.trim();
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey !== input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    !uuidV4(input.courtId) ||
    !businessDate(input.submittedAt) ||
    input.submittedAt > todayShanghai() ||
    !uniqueVersions(input.filingEvidenceContentVersionIds, 1, 50) ||
    !uniqueVersions(screenshots, 0, 10) ||
    (input.mediationNo !== undefined &&
      (!mediationNo || mediationNo.length > 100))
  )
    throw new ApiError(
      '提交立案信息无效，请检查日期、法院和材料。',
      400,
      'VALIDATION_ERROR',
    );
  const body = {
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    courtId: input.courtId,
    submittedAt: input.submittedAt,
    filingEvidenceContentVersionIds: input.filingEvidenceContentVersionIds,
    ...(input.filingScreenshotContentVersionIds === undefined
      ? {}
      : { filingScreenshotContentVersionIds: screenshots }),
    ...(mediationNo === undefined ? {} : { mediationNo }),
  };
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/filing-submit`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'submittedAt', 'recordedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_FORMAL_ACCEPTANCE' ||
    response.version !== input.expectedVersion + 1 ||
    response.submittedAt !== input.submittedAt ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as SubmitCaseFilingResult;
}

export async function registerCaseAcceptance(
  id: string,
  input: RegisterCaseAcceptanceInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<RegisterCaseAcceptanceResult> {
  const categoryIds = [
    input.acceptanceNoticeContentVersionIds ?? [],
    input.paymentListContentVersionIds ?? [],
    input.serviceDocumentContentVersionIds ?? [],
  ];
  const selectedIds = categoryIds.flat();
  const courtCaseNo = input.courtCaseNo.trim();
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey !== input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    !businessDate(input.acceptedAt) ||
    input.acceptedAt > todayShanghai() ||
    courtCaseNo.length < 1 ||
    courtCaseNo.length > 100 ||
    categoryIds.some((ids) => !uniqueVersions(ids, 0, 10)) ||
    new Set(selectedIds).size !== selectedIds.length
  ) {
    throw new ApiError(
      '正式立案信息无效，请检查日期、法院案号和所选材料。',
      400,
      'VALIDATION_ERROR',
    );
  }
  const body = {
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    acceptedAt: input.acceptedAt,
    courtCaseNo,
    ...(input.acceptanceNoticeContentVersionIds === undefined
      ? {}
      : { acceptanceNoticeContentVersionIds: categoryIds[0] }),
    ...(input.paymentListContentVersionIds === undefined
      ? {}
      : { paymentListContentVersionIds: categoryIds[1] }),
    ...(input.serviceDocumentContentVersionIds === undefined
      ? {}
      : { serviceDocumentContentVersionIds: categoryIds[2] }),
  };
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/acceptance-register`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'stage',
      'version',
      'acceptedAt',
      'courtCaseNo',
      'recordedAt',
    ]) ||
    response.id !== id ||
    response.stage !== 'WAITING_HEARING' ||
    response.version !== input.expectedVersion + 1 ||
    response.acceptedAt !== input.acceptedAt ||
    response.courtCaseNo !== courtCaseNo ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as RegisterCaseAcceptanceResult;
}

export async function mailCaseComplaint(
  id: string,
  input: MailCaseComplaintInput,
  audience: 'internal' | 'client' | 'lawyer' = 'internal',
): Promise<{
  id: string;
  stage: 'WAITING_FILING';
  version: number;
  mailedAt: string;
  recordedAt: string;
}> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    !businessDate(input.mailedAt) ||
    input.mailedAt > todayShanghai() ||
    input.mailReceiptContentVersionIds.length < 1 ||
    input.mailReceiptContentVersionIds.length > 10 ||
    new Set(input.mailReceiptContentVersionIds).size !==
      input.mailReceiptContentVersionIds.length ||
    input.mailReceiptContentVersionIds.some((versionId) => !nonempty(versionId))
  ) {
    throw new ApiError(
      '邮寄信息无效，请检查日期和凭证',
      400,
      'VALIDATION_ERROR',
    );
  }
  const path =
    audience === 'client'
      ? `/client/cases/${encodeURIComponent(id)}/complaint-mail`
      : `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/complaint-mail`;
  const response = await requestJson(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body: input,
  });
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'mailedAt', 'recordedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_FILING' ||
    response.version !== input.expectedVersion + 1 ||
    response.mailedAt !== input.mailedAt ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as {
    id: string;
    stage: 'WAITING_FILING';
    version: number;
    mailedAt: string;
    recordedAt: string;
  };
}

export async function mailCaseExecution(
  id: string,
  input: MailCaseExecutionInput,
  audience: 'internal' | 'client' | 'lawyer' = 'internal',
): Promise<MailCaseExecutionResult> {
  const versions = input.mailReceiptContentVersionIds;
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.expectedConfirmationId) ||
    !businessDate(input.mailedAt) ||
    input.mailedAt > todayShanghai() ||
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 10 ||
    !versions.every(uuidV4) ||
    new Set(versions).size !== versions.length
  )
    throw new ApiError('执行邮寄登记信息无效', 400, 'VALIDATION_ERROR');

  const path =
    audience === 'client'
      ? `/client/cases/${encodeURIComponent(id)}/execution-mail`
      : `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/execution-mail`;
  const response = await requestJson(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body: input,
  });
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'mailingId',
      'confirmationId',
      'stage',
      'version',
      'mailedAt',
      'recordedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.mailingId) ||
    response.confirmationId !== input.expectedConfirmationId ||
    response.stage !== 'WAITING_EXECUTION_FILING' ||
    response.version !== input.expectedVersion + 1 ||
    response.mailedAt !== input.mailedAt ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as MailCaseExecutionResult;
}

export async function submitCaseExecutionFiling(
  id: string,
  input: SubmitCaseExecutionFilingInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<SubmitCaseExecutionFilingResult> {
  const versions = input.executionFilingProofContentVersionIds;
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.expectedMailingId) ||
    !businessDate(input.submittedAt) ||
    input.submittedAt > todayShanghai() ||
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 10 ||
    !versions.every(uuidV4) ||
    new Set(versions).size !== versions.length
  )
    throw new ApiError('执行立案登记信息无效', 400, 'VALIDATION_ERROR');

  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/execution-filing-submit`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'filingId',
      'mailingId',
      'stage',
      'version',
      'submittedAt',
      'recordedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.filingId) ||
    response.mailingId !== input.expectedMailingId ||
    response.stage !== 'EXECUTING' ||
    response.version !== input.expectedVersion + 1 ||
    response.submittedAt !== input.submittedAt ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as SubmitCaseExecutionFilingResult;
}

export async function finishCaseExecution(
  id: string,
  input: FinishCaseExecutionInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<FinishCaseExecutionResult> {
  if (
    !record(input) ||
    !exact(input, [
      'expectedVersion',
      'idempotencyKey',
      'expectedFilingId',
      'finishedAt',
      'reason',
      'basisNote',
      'basisContentVersionIds',
    ]) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.expectedFilingId) ||
    !businessDate(input.finishedAt) ||
    input.finishedAt > todayShanghai() ||
    !finishText(input.reason) ||
    (input.basisNote !== null && !finishText(input.basisNote)) ||
    !Array.isArray(input.basisContentVersionIds) ||
    input.basisContentVersionIds.length > 10 ||
    !input.basisContentVersionIds.every(uuidV4) ||
    new Set(input.basisContentVersionIds).size !==
      input.basisContentVersionIds.length ||
    (input.basisNote === null && input.basisContentVersionIds.length === 0) ||
    (audience !== 'internal' && audience !== 'lawyer')
  )
    throw new ApiError('执行结束登记信息无效', 400, 'VALIDATION_ERROR');
  const response = await requestJson(
    '/' +
      (audience === 'lawyer' ? 'lawyer/cases' : 'cases') +
      '/' +
      encodeURIComponent(id) +
      '/execution-finish',
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'finishId',
      'filingId',
      'stage',
      'version',
      'finishedAt',
      'recordedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.finishId) ||
    response.filingId !== input.expectedFilingId ||
    response.stage !== 'WAITING_ARCHIVE' ||
    !Number.isSafeInteger(response.version) ||
    response.version !== input.expectedVersion + 1 ||
    response.finishedAt !== input.finishedAt ||
    !utcTimestamp(response.recordedAt)
  )
    throw invalidResponse();
  return response as FinishCaseExecutionResult;
}

// A detached session watcher also clears requests after the details have unmounted.
// No request body is persisted outside memory or inferred from a later GET.
type FinishSessionState = {
  pending: (caseId: string) => FinishCaseExecutionInput | null;
  setPending: (caseId: string, input: FinishCaseExecutionInput | null) => void;
  markChanged: (finishId: string) => boolean;
  clear: () => void;
};
const finishSessions = new WeakMap<object, FinishSessionState>();
export function executionFinishSession(
  owner: object,
  context: () => string,
): FinishSessionState {
  const existing = finishSessions.get(owner);
  if (existing) return existing;
  const requests = shallowRef(new Map<string, FinishCaseExecutionInput>());
  const notified = new Set<string>();
  const state: FinishSessionState = {
    pending: (caseId) => {
      const input = requests.value.get(caseId);
      return input
        ? {
            ...input,
            basisContentVersionIds: [...input.basisContentVersionIds],
          }
        : null;
    },
    setPending: (caseId, input) => {
      const next = new Map(requests.value);
      if (input)
        next.set(caseId, {
          ...input,
          basisContentVersionIds: [...input.basisContentVersionIds],
        });
      else next.delete(caseId);
      requests.value = next;
    },
    markChanged: (finishId) => {
      if (notified.has(finishId)) return false;
      notified.add(finishId);
      return true;
    },
    clear: () => {
      requests.value = new Map();
      notified.clear();
    },
  };
  effectScope(true).run(() => watch(context, state.clear, { flush: 'sync' }));
  finishSessions.set(owner, state);
  return state;
}

async function submitClosure(
  id: string,
  input: RecordCaseClosureInput | CorrectCaseClosureInput,
  command: 'RECORD' | 'CORRECT',
  audience: 'internal' | 'lawyer',
): Promise<CaseClosureResult> {
  if (
    !record(input) ||
    !exact(input, [
      'expectedVersion',
      'idempotencyKey',
      'expectedFinishId',
      'closeAt',
      'closeAmountState',
      'closeAmt',
      'note',
      'closeContentVersionIds',
      ...(command === 'CORRECT'
        ? ['expectedClosureVersionId', 'correctionReason']
        : []),
    ]) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.expectedFinishId) ||
    (input.closeAt !== null &&
      (!businessDate(input.closeAt) || input.closeAt > todayShanghai())) ||
    !(input.closeAmountState === 'PENDING'
      ? input.closeAmt === null
      : input.closeAmountState === 'KNOWN' &&
        decimalAmount(input.closeAmt, false)) ||
    (input.note !== null && !finishText(input.note)) ||
    !Array.isArray(input.closeContentVersionIds) ||
    input.closeContentVersionIds.length > 10 ||
    !input.closeContentVersionIds.every(uuidV4) ||
    new Set(input.closeContentVersionIds).size !==
      input.closeContentVersionIds.length ||
    (command === 'CORRECT' &&
      (!('expectedClosureVersionId' in input) ||
        !('correctionReason' in input) ||
        !uuidV4(input.expectedClosureVersionId) ||
        !nonempty(input.correctionReason) ||
        input.correctionReason.length > 500)) ||
    (audience !== 'internal' && audience !== 'lawyer') ||
    (command === 'CORRECT' && audience !== 'internal')
  )
    throw new ApiError('结案登记信息无效', 400, 'VALIDATION_ERROR');
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/${command === 'CORRECT' ? 'closure-correction' : 'closure'}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'closureId',
      'closureVersionId',
      'finishId',
      'stage',
      'version',
      'recordedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.closureId) ||
    !uuidV4(response.closureVersionId) ||
    response.finishId !== input.expectedFinishId ||
    response.stage !== 'WAITING_ARCHIVE' ||
    !Number.isSafeInteger(response.version) ||
    response.version !== input.expectedVersion + 1 ||
    !utcTimestamp(response.recordedAt)
  )
    throw invalidResponse();
  return response as CaseClosureResult;
}
export function recordCaseClosure(
  id: string,
  input: RecordCaseClosureInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<CaseClosureResult> {
  return submitClosure(id, input, 'RECORD', audience);
}
export function correctCaseClosure(
  id: string,
  input: CorrectCaseClosureInput,
): Promise<CaseClosureResult> {
  return submitClosure(id, input, 'CORRECT', 'internal');
}
type ClosureSessionState = {
  pending: (caseId: string) => CaseClosurePendingRequest | null;
  setPending: (
    caseId: string,
    request: CaseClosurePendingRequest | null,
  ) => void;
  markChanged: (versionId: string) => boolean;
  clear: () => void;
};
function copyClosureRequest(
  request: CaseClosurePendingRequest,
): CaseClosurePendingRequest {
  return request.command === 'RECORD'
    ? {
        command: 'RECORD',
        input: {
          ...request.input,
          closeContentVersionIds: [...request.input.closeContentVersionIds],
        },
      }
    : {
        command: 'CORRECT',
        input: {
          ...request.input,
          closeContentVersionIds: [...request.input.closeContentVersionIds],
        },
      };
}
const closureSessions = new WeakMap<object, ClosureSessionState>();
export function caseClosureSession(
  owner: object,
  context: () => string,
): ClosureSessionState {
  const existing = closureSessions.get(owner);
  if (existing) return existing;
  const requests = shallowRef(new Map<string, CaseClosurePendingRequest>());
  const notified = new Set<string>();
  const state: ClosureSessionState = {
    pending: (caseId) => {
      const request = requests.value.get(caseId);
      return request ? copyClosureRequest(request) : null;
    },
    setPending: (caseId, request) => {
      const next = new Map(requests.value);
      if (request) next.set(caseId, copyClosureRequest(request));
      else next.delete(caseId);
      requests.value = next;
    },
    markChanged: (versionId) => {
      if (notified.has(versionId)) return false;
      notified.add(versionId);
      return true;
    },
    clear: () => {
      requests.value = new Map();
      notified.clear();
    },
  };
  effectScope(true).run(() => watch(context, state.clear, { flush: 'sync' }));
  closureSessions.set(owner, state);
  return state;
}

export async function getCase(
  id: string,
  options: RequestOptions = {},
): Promise<CaseDetail> {
  const response = await getJson(`/cases/${encodeURIComponent(id)}`, options);
  if (!validCaseDetail(response, id)) throw invalidResponse();
  return response;
}

export async function matchCase(
  id: string,
  input: MatchCaseInput,
): Promise<void> {
  const body = {
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    matchedOn: input.matchedOn,
    defendants: input.defendants.map(
      ({ kind, name, idNo, phone, address }) => ({
        kind,
        name: name.trim(),
        ...(idNo?.trim() ? { idNo: idNo.trim() } : {}),
        ...(phone?.trim() ? { phone: phone.trim() } : {}),
        ...(address?.trim() ? { address: address.trim() } : {}),
      }),
    ),
    lawyerAccountId: input.lawyerAccountId.trim(),
    ...(input.lawyerProfileId
      ? { lawyerProfileId: input.lawyerProfileId }
      : {}),
  };
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey.trim() ||
    !businessDate(input.matchedOn) ||
    input.matchedOn > todayShanghai() ||
    body.defendants.length === 0 ||
    body.defendants.length > 20 ||
    body.defendants.some((entry) => !entry.name) ||
    !body.lawyerAccountId
  )
    throw new ApiError('匹配信息无效', 400, 'VALIDATION_ERROR');
  const result = await requestJson(`/cases/${encodeURIComponent(id)}/match`, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body,
  });
  if (
    !record(result) ||
    !exact(result, ['id', 'stage', 'version', 'matchedAt', 'matchedOn']) ||
    result.id !== id ||
    result.stage !== 'WAITING_COMPLAINT' ||
    result.version !== input.expectedVersion + 1 ||
    typeof result.matchedAt !== 'string' ||
    Number.isNaN(Date.parse(result.matchedAt)) ||
    result.matchedOn !== input.matchedOn
  )
    throw invalidResponse();
}

export async function submitComplaint(
  id: string,
  input: SubmitComplaintInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<{
  id: string;
  stage: 'WAITING_COMPLAINT_CONFIRMATION';
  version: number;
  submittedAt: string;
}> {
  const idsValid = (ids: string[]) =>
    ids.length >= 1 && ids.length <= 10 && ids.every(nonempty);
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey.trim() ||
    !idsValid(input.complaintContentVersionIds) ||
    !idsValid(input.authorizationContentVersionIds) ||
    (input.amountState === 'KNOWN'
      ? input.amount === null ||
        !/^\d+(\.\d+)?$/u.test(input.amount) ||
        input.pendingReason !== null
      : input.amount !== null || !input.pendingReason?.trim())
  ) {
    throw new ApiError('起诉材料信息无效', 400, 'VALIDATION_ERROR');
  }
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/complaint-submit`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'submittedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_COMPLAINT_CONFIRMATION' ||
    response.version !== input.expectedVersion + 1 ||
    typeof response.submittedAt !== 'string' ||
    Number.isNaN(Date.parse(response.submittedAt))
  ) {
    throw invalidResponse();
  }
  return response as unknown as {
    id: string;
    stage: 'WAITING_COMPLAINT_CONFIRMATION';
    version: number;
    submittedAt: string;
  };
}

export async function submitExecution(
  id: string,
  input: SubmitExecutionInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<SubmitExecutionResult> {
  const reason = input.changeReason?.trim();
  const versions = input.executionApplicationContentVersionIds;
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.trialRoundId) ||
    !uuidV4(input.judgmentNextStepId) ||
    (input.secondInstanceResultId !== null &&
      !uuidV4(input.secondInstanceResultId)) ||
    (input.expectedSubmissionId !== null &&
      !uuidV4(input.expectedSubmissionId)) ||
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 10 ||
    !versions.every(uuidV4) ||
    new Set(versions).size !== versions.length ||
    (input.expectedSubmissionId === null
      ? input.changeReason !== undefined
      : !reason || reason.length > 500)
  ) {
    throw new ApiError('执行材料提交信息无效', 400, 'VALIDATION_ERROR');
  }
  const body: SubmitExecutionInput =
    input.changeReason === undefined
      ? input
      : { ...input, changeReason: reason };
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/execution-submit`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'submissionId',
      'stage',
      'version',
      'submittedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.submissionId) ||
    response.stage !== 'WAITING_EXECUTION_CONFIRMATION' ||
    !Number.isInteger(response.version) ||
    Number(response.version) !== input.expectedVersion + 1 ||
    typeof response.submittedAt !== 'string' ||
    Number.isNaN(Date.parse(response.submittedAt))
  )
    throw invalidResponse();
  return response as unknown as SubmitExecutionResult;
}

export async function confirmCaseExecution(
  id: string,
  input: ConfirmExecutionInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<ConfirmExecutionResult> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    input.idempotencyKey.length > 128 ||
    !uuidV4(input.expectedSubmissionId)
  ) {
    throw new ApiError(
      '\u6267\u884c\u6750\u6599\u786e\u8ba4\u4fe1\u606f\u65e0\u6548',
      400,
      'VALIDATION_ERROR',
    );
  }
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/execution-confirm`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'confirmationId',
      'submissionId',
      'stage',
      'version',
      'confirmedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.confirmationId) ||
    response.submissionId !== input.expectedSubmissionId ||
    response.stage !== 'WAITING_EXECUTION_STAMP' ||
    response.version !== input.expectedVersion + 1 ||
    typeof response.confirmedAt !== 'string' ||
    Number.isNaN(Date.parse(response.confirmedAt))
  ) {
    throw invalidResponse();
  }
  return response as unknown as ConfirmExecutionResult;
}

export async function confirmCaseComplaint(
  id: string,
  input: ConfirmCaseComplaintInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<{
  id: string;
  stage: 'WAITING_COMPLAINT_STAMP';
  version: number;
  confirmedAt: string;
}> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    input.idempotencyKey.length > 128 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.confirmedComplaintContentVersionId,
    ) ||
    typeof input.confirmDisclose !== 'boolean' ||
    (input.amountState === 'KNOWN'
      ? input.amount === null ||
        !/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(input.amount) ||
        input.pendingReason !== null
      : input.amount !== null ||
        typeof input.pendingReason !== 'string' ||
        !input.pendingReason ||
        input.pendingReason.trim() !== input.pendingReason ||
        input.pendingReason.length > 500) ||
    (input.changeNote !== undefined &&
      (!input.changeNote ||
        input.changeNote.trim() !== input.changeNote ||
        input.changeNote.length > 500))
  ) {
    throw new ApiError('诉状确认信息无效', 400, 'VALIDATION_ERROR');
  }
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/complaint-confirm`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'confirmedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_COMPLAINT_STAMP' ||
    response.version !== input.expectedVersion + 1 ||
    typeof response.confirmedAt !== 'string' ||
    Number.isNaN(Date.parse(response.confirmedAt))
  ) {
    throw invalidResponse();
  }
  return response as {
    id: string;
    stage: 'WAITING_COMPLAINT_STAMP';
    version: number;
    confirmedAt: string;
  };
}

async function submitArchive(
  id: string,
  input: ArchiveCaseInput | CorrectCaseArchiveInput,
  command: 'ARCHIVE' | 'CORRECT',
  audience: 'internal' | 'lawyer',
): Promise<CaseArchiveResult> {
  if (
    !uuidV4(id) ||
    !record(input) ||
    !exact(input, [
      'expectedVersion',
      'idempotencyKey',
      'expectedClosureVersionId',
      'archiveAt',
      'archiveType',
      'archiveReason',
      ...(command === 'CORRECT'
        ? ['expectedArchiveVersionId', 'correctionReason']
        : []),
    ]) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.expectedVersion >= Number.MAX_SAFE_INTEGER ||
    !validIdempotencyKey(input.idempotencyKey) ||
    !uuidV4(input.expectedClosureVersionId) ||
    !businessDate(input.archiveAt) ||
    input.archiveAt > todayShanghai() ||
    !archiveType(input.archiveType) ||
    !finishText(input.archiveReason) ||
    (command === 'CORRECT' &&
      (!('expectedArchiveVersionId' in input) ||
        !uuidV4(input.expectedArchiveVersionId) ||
        !('correctionReason' in input) ||
        !nonempty(input.correctionReason) ||
        input.correctionReason.length > 500)) ||
    (audience !== 'internal' && audience !== 'lawyer') ||
    (command === 'CORRECT' && audience !== 'internal')
  )
    throw new ApiError('归档信息无效', 400, 'VALIDATION_ERROR');
  const response = await requestJson(
    `/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${encodeURIComponent(id)}/${command === 'CORRECT' ? 'archive-correction' : 'archive'}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'archiveId',
      'archiveVersionId',
      'closureId',
      'closureVersionId',
      'stage',
      'version',
      'recordedAt',
    ]) ||
    response.id !== id ||
    !uuidV4(response.archiveId) ||
    !uuidV4(response.archiveVersionId) ||
    !uuidV4(response.closureId) ||
    response.closureVersionId !== input.expectedClosureVersionId ||
    response.stage !== 'ARCHIVED' ||
    !Number.isSafeInteger(response.version) ||
    response.version !== input.expectedVersion + 1 ||
    !utcTimestamp(response.recordedAt)
  )
    throw invalidResponse();
  return response as CaseArchiveResult;
}
export function archiveCase(
  id: string,
  input: ArchiveCaseInput,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<CaseArchiveResult> {
  return submitArchive(id, input, 'ARCHIVE', audience);
}
export function correctCaseArchive(
  id: string,
  input: CorrectCaseArchiveInput,
): Promise<CaseArchiveResult> {
  return submitArchive(id, input, 'CORRECT', 'internal');
}
type ArchiveSessionState = {
  pending: (caseId: string) => CaseArchivePendingRequest | null;
  setPending: (
    caseId: string,
    request: CaseArchivePendingRequest | null,
  ) => void;
  markChanged: (versionId: string) => boolean;
  clear: () => void;
};
function copyArchiveRequest(
  request: CaseArchivePendingRequest,
): CaseArchivePendingRequest {
  return request.command === 'ARCHIVE'
    ? { command: 'ARCHIVE', input: { ...request.input } }
    : { command: 'CORRECT', input: { ...request.input } };
}
const archiveSessions = new WeakMap<object, ArchiveSessionState>();
export function caseArchiveSession(
  owner: object,
  context: () => string,
): ArchiveSessionState {
  const existing = archiveSessions.get(owner);
  if (existing) return existing;
  const requests = shallowRef(new Map<string, CaseArchivePendingRequest>());
  const notified = new Set<string>();
  const state: ArchiveSessionState = {
    pending: (caseId) => {
      const request = requests.value.get(caseId);
      return request ? copyArchiveRequest(request) : null;
    },
    setPending: (caseId, request) => {
      const next = new Map(requests.value);
      if (request) next.set(caseId, copyArchiveRequest(request));
      else next.delete(caseId);
      requests.value = next;
    },
    markChanged: (versionId) => {
      if (notified.has(versionId)) return false;
      notified.add(versionId);
      return true;
    },
    clear: () => {
      requests.value = new Map();
      notified.clear();
    },
  };
  effectScope(true).run(() => watch(context, state.clear, { flush: 'sync' }));
  archiveSessions.set(owner, state);
  return state;
}
