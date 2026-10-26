<script lang="ts">
import * as api from '../../api/cases';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  parseCaseActionIntent,
  type CaseActionIntent,
} from './case-workspace-actions';
import {
  caseSectionRecordStorageKey,
  decodeCaseSectionRecordRequest,
  sectionRecordTargetId,
  readCaseSectionRecordRequests,
  type CaseSectionRecordKind,
  type CaseSectionRecordRequest,
} from './CaseSectionRecordCorrectionPanel.vue';

export type CaseListAction = CaseActionIntent | 'edit-section-records';
export type CaseListRecordRecovery = {
  caseId: string;
  kind: CaseSectionRecordKind;
  targetId: string;
};
export function readCaseListRecordRecoveries(
  actor: string,
): CaseListRecordRecovery[] {
  if (!actor) return [];
  const prefix = `case-section-record:v1:${encodeURIComponent(actor)}:`;
  const result: CaseListRecordRecovery[] = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    const key = globalThis.sessionStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = globalThis.sessionStorage.getItem(key);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    const stored = decodeCaseSectionRecordRequest(value);
    if (
      !stored ||
      stored.actor !== actor ||
      caseSectionRecordStorageKey(actor, stored.caseId, stored.request) !== key
    )
      throw new Error('Invalid section correction recovery record');
    result.push({
      caseId: stored.caseId,
      kind: stored.request.kind,
      targetId: sectionRecordTargetId(stored.request),
    });
  }
  return result;
}

type Inputs = {
  match: api.MatchCaseInput;
  complaint: api.SubmitComplaintInput;
  confirmation: api.ConfirmCaseComplaintInput;
  mailing: api.MailCaseComplaintInput;
  filing: api.SubmitCaseFilingInput;
  acceptance: api.RegisterCaseAcceptanceInput;
  hearing: api.SaveCaseHearingInput;
  'hearing-correction': api.CorrectCaseHearingInput;
  judgment: api.RegisterCaseJudgmentInput;
  'judgment-correction': api.CorrectCaseJudgmentInput;
  choice: api.ChooseCaseJudgmentNextStepInput;
  'choice-revoke': api.RevokeCaseJudgmentNextStepInput;
  progress: api.SaveSecondInstanceInput;
  result: api.RegisterSecondInstanceResultInput;
  'result-revoke': api.RevokeSecondInstanceResultInput;
  execution: api.SubmitExecutionInput;
  'execution-confirmation': api.ConfirmExecutionInput;
  'execution-mailing': api.MailCaseExecutionInput;
  'execution-filing': api.SubmitCaseExecutionFilingInput;
  finish: api.FinishCaseExecutionInput;
  closure: api.RecordCaseClosureInput;
  'closure-correction': api.CorrectCaseClosureInput;
  archive: api.ArchiveCaseInput;
  'archive-correction': api.CorrectCaseArchiveInput;
};
export type CaseListRequest = {
  [K in keyof Inputs]: { kind: K; input: Inputs[K] };
}[keyof Inputs];
type StoredRequest = {
  version: 1;
  actor: string;
  caseId: string;
  action: CaseActionIntent;
  command: CaseListRequest;
};
type Validator = (value: unknown) => boolean;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const string: Validator = (value) => typeof value === 'string';
const boolean: Validator = (value) => typeof value === 'boolean';
const nullable =
  (check: Validator): Validator =>
  (value) =>
    value === null || check(value);
const optional =
  (check: Validator): Validator =>
  (value) =>
    value === undefined || check(value);
const strings: Validator = (value) =>
  Array.isArray(value) && value.every(string);
const oneOf =
  (...values: unknown[]): Validator =>
  (value) =>
    values.includes(value);
const shape =
  (schema: Record<string, Validator>): Validator =>
  (value) =>
    record(value) &&
    Object.keys(value).every((key) => Object.hasOwn(schema, key)) &&
    Object.entries(schema).every(([key, validate]) => validate(value[key]));
const money = shape({
  state: oneOf('KNOWN', 'PENDING'),
  amount: nullable(string),
});
const progressFields = {
  trialRoundId: string,
  choiceId: nullable(string),
  expectedProgressId: nullable(string),
  progress: shape({
    hearingAt: nullable(string),
    hearingPlace: nullable(string),
    judgeName: nullable(string),
    documentContentVersionIds: strings,
    serviceContentVersionIds: strings,
  }),
};
const judgmentFields = {
  judgmentReceivedAt: string,
  judgmentAmountState: oneOf('KNOWN', 'PENDING'),
  judgmentAmount: nullable(string),
  paidLitigationFeeState: oneOf('KNOWN', 'PENDING'),
  paidLitigationFee: nullable(string),
  judgmentContentVersionIds: strings,
};
const closureFields = {
  expectedFinishId: nullable(string),
  closeAt: nullable(string),
  closeAmountState: oneOf('KNOWN', 'PENDING'),
  closeAmt: nullable(string),
  note: nullable(string),
  closeContentVersionIds: strings,
};
const archiveFields = {
  expectedClosureVersionId: string,
  archiveAt: string,
  archiveType: oneOf(
    'VOIDED',
    'SETTLEMENT',
    'MEDIATION',
    'JUDGMENT_PERFORMED',
    'EXECUTION_COLLECTED',
    'EXECUTION_CLOSED',
  ),
  archiveReason: string,
};
const common = {
  expectedVersion: (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
  idempotencyKey: (value: unknown) =>
    typeof value === 'string' && value.length > 0,
};
const schema = {
  match: {
    matchedOn: string,
    defendants: (value: unknown) =>
      Array.isArray(value) &&
      value.every(
        shape({
          kind: oneOf('PERSON', 'ORGANIZATION'),
          name: string,
          idNo: optional(string),
          phone: optional(string),
          address: optional(string),
        }),
      ),
    lawyerAccountId: string,
    lawyerProfileId: optional(string),
  },
  complaint: {
    amountState: oneOf('KNOWN', 'PENDING'),
    amount: nullable(string),
    pendingReason: nullable(string),
    complaintContentVersionIds: strings,
    authorizationContentVersionIds: strings,
  },
  confirmation: {
    confirmedComplaintContentVersionId: string,
    amountState: oneOf('KNOWN', 'PENDING'),
    amount: nullable(string),
    pendingReason: nullable(string),
    changeNote: optional(string),
    confirmDisclose: boolean,
  },
  mailing: { mailedAt: string, mailReceiptContentVersionIds: strings },
  filing: {
    courtId: string,
    submittedAt: string,
    filingEvidenceContentVersionIds: strings,
    filingScreenshotContentVersionIds: optional(strings),
    mediationNo: optional(string),
  },
  acceptance: {
    acceptedAt: string,
    paymentDueAt: optional(nullable(string)),
    courtCaseNo: string,
    courtId: optional(string),
    acceptanceNoticeContentVersionIds: optional(strings),
    paymentListContentVersionIds: optional(strings),
    serviceDocumentContentVersionIds: optional(strings),
  },
  hearing: {
    hearingAt: nullable(string),
    hearingPlace: optional(nullable(string)),
    judgeName: optional(nullable(string)),
  },
  'hearing-correction': {
    hearingAt: nullable(string),
    hearingPlace: optional(nullable(string)),
    judgeName: optional(nullable(string)),
    reason: string,
  },
  judgment: judgmentFields,
  'judgment-correction': { ...judgmentFields, reason: string },
  choice: {
    judgmentId: string,
    next: oneOf('APPEAL', 'EXECUTION'),
    executionReadinessConfirmed: optional(oneOf(true)),
    plaintiffAppeals: optional(boolean),
    defendantIds: optional(strings),
  },
  'choice-revoke': { choiceId: string, reason: string },
  progress: progressFields,
  result: {
    ...progressFields,
    result: oneOf('REMAND', 'CHANGE', 'AFFIRM'),
    resultReceivedAt: string,
    judgmentContentVersionIds: strings,
    paidLitigationFee: money,
    judgmentAmount: optional(money),
  },
  'result-revoke': { trialRoundId: string, resultId: string, reason: string },
  execution: {
    trialRoundId: string,
    judgmentNextStepId: nullable(string),
    secondInstanceResultId: nullable(string),
    expectedSubmissionId: nullable(string),
    executionApplicationContentVersionIds: strings,
    changeReason: optional(string),
  },
  'execution-confirmation': {
    expectedSubmissionId: nullable(string),
    executionApplicationContentVersionIds: optional(strings),
  },
  'execution-mailing': {
    expectedConfirmationId: nullable(string),
    mailedAt: string,
    mailReceiptContentVersionIds: strings,
  },
  'execution-filing': {
    expectedMailingId: nullable(string),
    submittedAt: string,
    executionFilingProofContentVersionIds: strings,
  },
  finish: {
    expectedFilingId: nullable(string),
    finishedAt: string,
    reason: string,
    basisNote: nullable(string),
    basisContentVersionIds: strings,
  },
  closure: closureFields,
  'closure-correction': {
    ...closureFields,
    expectedClosureVersionId: string,
    correctionReason: string,
  },
  archive: archiveFields,
  'archive-correction': {
    ...archiveFields,
    expectedArchiveVersionId: string,
    correctionReason: string,
  },
} satisfies Record<keyof Inputs, Record<string, Validator>>;
function command(value: unknown): value is CaseListRequest {
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.kind !== 'string' ||
    !record(value.input)
  )
    return false;
  const entry = Object.entries(schema).find(([kind]) => kind === value.kind);
  if (!entry || !shape({ ...common, ...entry[1] })(value.input)) return false;
  if (value.kind === 'choice')
    return value.input.next === 'EXECUTION'
      ? value.input.executionReadinessConfirmed === true &&
          !('plaintiffAppeals' in value.input) &&
          !('defendantIds' in value.input)
      : typeof value.input.plaintiffAppeals === 'boolean' &&
          strings(value.input.defendantIds) &&
          !('executionReadinessConfirmed' in value.input);
  return true;
}
export function decodeCaseListRequest(value: unknown): StoredRequest | null {
  if (
    !record(value) ||
    Object.keys(value).length !== 5 ||
    value.version !== 1 ||
    typeof value.actor !== 'string' ||
    typeof value.caseId !== 'string' ||
    !parseCaseActionIntent(value.action) ||
    !command(value.command)
  )
    return null;
  // Construct the envelope only; the command is retained verbatim, including its original key.
  const action = parseCaseActionIntent(value.action);
  return action
    ? {
        version: 1,
        actor: value.actor,
        caseId: value.caseId,
        action,
        command: value.command,
      }
    : null;
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import { ApiError } from '../../api/http';
import type {
  ListWorkflowSession,
  ListWorkflowRequestState,
} from '../../app/list-workflow-context';
import { resolveCaseDetailActions } from './case-workspace-actions';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type MaterialCategory,
  type CaseSectionRecordUploadTarget,
} from '../../api/materials';
import CaseComplaintSubmissionForm from './CaseComplaintSubmissionForm.vue';
import CaseComplaintConfirmationPanel from './CaseComplaintConfirmationPanel.vue';
import CaseComplaintMailingPanel from './CaseComplaintMailingPanel.vue';
import CaseFilingPanel from './CaseFilingPanel.vue';
import CaseAcceptancePanel from './CaseAcceptancePanel.vue';
import CaseHearingPanel from './CaseHearingPanel.vue';
import CaseJudgmentPanel from './CaseJudgmentPanel.vue';
import CaseJudgmentNextStepPanel from './CaseJudgmentNextStepPanel.vue';
import CaseSecondInstancePanel from './CaseSecondInstancePanel.vue';
import CaseExecutionSubmissionPanel from './CaseExecutionSubmissionPanel.vue';
import CaseExecutionConfirmationPanel from './CaseExecutionConfirmationPanel.vue';
import CaseExecutionMailingPanel from './CaseExecutionMailingPanel.vue';
import CaseExecutionFilingPanel from './CaseExecutionFilingPanel.vue';
import CaseExecutionFinishPanel from './CaseExecutionFinishPanel.vue';
import CaseClosurePanel from './CaseClosurePanel.vue';
import CaseArchivePanel from './CaseArchivePanel.vue';
import CaseSectionRecordCorrectionPanel from './CaseSectionRecordCorrectionPanel.vue';
import {
  resolveCaseSectionEdits,
  sectionRecordCommands,
} from './case-workspace-section-edits';
import { clearSecondInstanceCommand } from './case-second-instance-recovery';
import {
  clearExecutionCommand,
  pendingExecutionCommand,
} from './case-execution-recovery';

const props = defineProps<{
  item: api.CaseDetail;
  action: CaseListAction;
  recordActorKey?: string;
  recordRecovery?: CaseListRecordRecovery | null;
  session: ListWorkflowSession;
  requestState: ListWorkflowRequestState;
}>();
const item = shallowRef(props.item);
const ownedSession = props.session;
const detailRequest = new AbortController();
const allowed = computed(() =>
  resolveCaseDetailActions(item.value).some(
    (action) => action.intent === props.action,
  ),
);
const storageKey = `case-list-workflow:v1:${encodeURIComponent(props.session.context.actorKey)}:${encodeURIComponent(item.value.id)}`;
const pending = shallowRef<StoredRequest | null>(null);
const error = ref('');
const storageBlocked = ref(false);
const busy = computed(() => props.requestState !== 'idle');
const recordMode = props.action === 'edit-section-records';
const retainedRecords = shallowRef<
  ReturnType<typeof readCaseSectionRecordRequests>
>([]);
const recordSelection = shallowRef<CaseListRecordRecovery | null>(
  props.recordRecovery ?? null,
);
const recordCommands = computed(() => {
  const available = resolveCaseSectionEdits(item.value);
  return sectionRecordCommands.filter(
    (command) =>
      available.some((entry) => entry.id === command.id) ||
      retainedRecords.value.some(
        (entry) => entry.request.kind === command.kind,
      ),
  );
});
let recordAdmitted = false;
let ownedPrepSession: ListWorkflowSession | null = null;
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
  detailRequest.abort();
});
function current() {
  return mounted && props.session === ownedSession && ownedSession.isCurrent();
}
try {
  const raw = globalThis.sessionStorage.getItem(storageKey);
  if (raw !== null) {
    const parsed: unknown = JSON.parse(raw);
    const stored = decodeCaseListRequest(parsed);
    if (
      !stored ||
      stored.caseId !== item.value.id ||
      stored.actor !== props.session.context.actorKey
    )
      throw new Error('invalid recovery');
    pending.value = stored;
    props.session.restoreUnknown();
  }
} catch {
  storageBlocked.value = true;
  error.value =
    '无法读取原请求恢复记录。请保留当前会话并联系管理员核查，尚未发送新请求。';
}
if (recordMode) {
  try {
    if (!props.recordActorKey) throw new Error('Missing record actor');
    retainedRecords.value = readCaseSectionRecordRequests(
      props.recordActorKey,
      item.value.id,
    );
    if (pending.value)
      throw new Error('Resolve original workflow request first');
    if (retainedRecords.value.length) {
      const first = retainedRecords.value[0]!;
      recordSelection.value ??= {
        caseId: first.caseId,
        kind: first.request.kind,
        targetId: sectionRecordTargetId(first.request),
      };
      ownedSession.restoreUnknown();
    }
    if (recordSelection.value && recordSelection.value.caseId !== item.value.id)
      throw new Error('Record recovery case mismatch');
  } catch {
    storageBlocked.value = true;
    error.value =
      '无法核对资料更正的原请求恢复记录。请保留当前会话并联系管理员，尚未发送新更正请求。';
  }
}
function selectRecordKind(event: globalThis.Event) {
  if (!current() || storageBlocked.value || busy.value) return;
  const kind = (event.target as globalThis.HTMLSelectElement).value;
  const command = recordCommands.value.find((entry) => entry.kind === kind);
  if (
    !command ||
    (retainedRecords.value.length &&
      !retainedRecords.value.some((entry) => entry.request.kind === kind))
  )
    return;
  const retained = retainedRecords.value.find(
    (entry) => entry.request.kind === kind,
  );
  recordSelection.value = {
    caseId: item.value.id,
    kind: command.kind,
    targetId: retained ? sectionRecordTargetId(retained.request) : '',
  };
}
function selectRecordRecovery(recovery: CaseListRecordRecovery) {
  if (!current() || storageBlocked.value || busy.value) return;
  recordSelection.value = recovery;
}
function beforeRecordUpload(input: {
  caseId: string;
  target: CaseSectionRecordUploadTarget;
}): boolean {
  const kinds = {
    EXECUTION_MAILING: 'execution-mailing',
    EXECUTION_FILING: 'execution-filing',
    EXECUTION_FINISH: 'execution-finish',
    JUDGMENT: 'judgment',
    CLOSURE: 'closure',
  } as const;
  if (
    !current() ||
    !recordMode ||
    storageBlocked.value ||
    pending.value ||
    recordAdmitted ||
    ownedPrepSession ||
    input.caseId !== item.value.id ||
    kinds[input.target.kind] !== recordSelection.value?.kind ||
    (recordSelection.value.targetId &&
      recordSelection.value.targetId !== input.target.targetId)
  )
    return false;
  try {
    readCaseListRecordRecoveries(props.recordActorKey ?? '');
    if (
      readCaseSectionRecordRequests(props.recordActorKey ?? '', item.value.id)
        .length
    )
      return false;
  } catch {
    storageBlocked.value = true;
    error.value = '无法核对资料更正的原请求恢复记录，尚未上传文件。';
    return false;
  }
  const session = props.session;
  if (!session.beginSubmit({ recovery: false })) return false;
  ownedPrepSession = session;
  return true;
}
function recordUploadStateChanged(state: 'uploading' | 'idle') {
  if (state !== 'idle' || !ownedPrepSession) return;
  const session = ownedPrepSession;
  ownedPrepSession = null;
  // Preparation never completes a business command or refreshes the list.
  session.endSubmit('failed');
}
function beforeRecordSubmit(input: {
  caseId: string;
  request: CaseSectionRecordRequest;
  recovery: boolean;
}): boolean {
  if (
    !current() ||
    storageBlocked.value ||
    pending.value ||
    recordAdmitted ||
    ownedPrepSession ||
    input.caseId !== item.value.id ||
    input.request.kind !== recordSelection.value?.kind ||
    (!!recordSelection.value.targetId &&
      sectionRecordTargetId(input.request) !== recordSelection.value.targetId)
  )
    return false;
  try {
    readCaseListRecordRecoveries(props.recordActorKey ?? '');
    const retained = readCaseSectionRecordRequests(
      props.recordActorKey ?? '',
      item.value.id,
    );
    if (input.recovery) {
      if (
        !retained.some(
          (entry) =>
            JSON.stringify(entry.request) === JSON.stringify(input.request),
        )
      )
        return false;
    } else if (retained.length) {
      error.value =
        '当前案件另有资料更正原请求待核对，请返回列表选择该原请求。';
      return false;
    }
    recordAdmitted = ownedSession.beginSubmit({ recovery: input.recovery });
    if (recordAdmitted) error.value = '';
    return recordAdmitted;
  } catch {
    storageBlocked.value = true;
    error.value = '无法核对资料更正的原请求恢复记录，尚未发送请求。';
    return false;
  }
}
function recordStateChanged(state: ListWorkflowRequestState) {
  if (!current() || ownedPrepSession) return;
  if (state === 'submitting') return;
  try {
    retainedRecords.value = readCaseSectionRecordRequests(
      props.recordActorKey ?? '',
      item.value.id,
    );
  } catch {
    storageBlocked.value = true;
    error.value =
      '无法核对资料更正的原请求恢复记录，请保留当前会话并联系管理员。';
  }
  if (recordAdmitted) {
    const activePending = retainedRecords.value.some(
      (entry) =>
        entry.request.kind === recordSelection.value?.kind &&
        (!recordSelection.value.targetId ||
          sectionRecordTargetId(entry.request) ===
            recordSelection.value.targetId),
    );
    ownedSession.endSubmit(
      state === 'unknown' || activePending || storageBlocked.value
        ? 'unknown'
        : 'failed',
    );
    recordAdmitted = false;
  } else if (state === 'unknown') ownedSession.restoreUnknown();
}
function recordChanged() {
  if (!current() || !recordAdmitted) return;
  recordAdmitted = false;
  ownedSession.endSubmit('success');
}
function recordAccessLost() {
  if (current()) ownedSession.deny();
}
async function refreshRecord() {
  // A version conflict requests a fresh read before the panel's finally settles W.
  await nextTick();
  await refresh();
}
function recordCancel() {
  // The drawer owns navigation and only admits a cancel while idle.
  if (current() && props.requestState === 'idle') emit('cancel');
}
const emit = defineEmits<{ cancel: [] }>();
function unknown(reason: unknown) {
  return (
    !(reason instanceof ApiError) ||
    reason.status === 0 ||
    reason.status >= 500 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(
      reason.code,
    )
  );
}
async function transport(id: string, request: CaseListRequest) {
  switch (request.kind) {
    case 'match':
      return api.matchCase(id, request.input);
    case 'complaint':
      return api.submitComplaint(id, request.input);
    case 'confirmation':
      return api.confirmCaseComplaint(id, request.input);
    case 'mailing':
      return api.mailCaseComplaint(id, request.input);
    case 'filing':
      return api.submitCaseFiling(id, request.input);
    case 'acceptance':
      return api.registerCaseAcceptance(id, request.input);
    case 'hearing':
      return api.scheduleCaseHearing(id, request.input);
    case 'hearing-correction':
      return api.correctCaseHearing(id, request.input);
    case 'judgment':
      return api.registerCaseJudgment(id, request.input);
    case 'judgment-correction':
      return api.correctCaseJudgment(id, request.input);
    case 'choice':
      return api.chooseCaseJudgmentNextStep(id, request.input);
    case 'choice-revoke':
      return api.revokeCaseJudgmentNextStep(id, request.input);
    case 'progress':
      return api.saveSecondInstance(id, request.input);
    case 'result':
      return api.registerSecondInstanceResult(id, request.input);
    case 'result-revoke':
      return api.revokeSecondInstanceResult(id, request.input);
    case 'execution':
      return api.submitExecution(id, request.input);
    case 'execution-confirmation':
      return api.confirmCaseExecution(id, request.input);
    case 'execution-mailing':
      return api.mailCaseExecution(id, request.input);
    case 'execution-filing':
      return api.submitCaseExecutionFiling(id, request.input);
    case 'finish':
      return api.finishCaseExecution(id, request.input);
    case 'closure':
      return api.recordCaseClosure(id, request.input);
    case 'closure-correction':
      return api.correctCaseClosure(id, request.input);
    case 'archive':
      return api.archiveCase(id, request.input);
    case 'archive-correction':
      return api.correctCaseArchive(id, request.input);
  }
}
async function submit(request: CaseListRequest, recovery = false) {
  const session = props.session;
  if (
    !current() ||
    storageBlocked.value ||
    (!recovery && (!allowed.value || pending.value))
  )
    throw new ApiError('请先核对原请求及当前操作权限', 409, 'INVALID_STATE');
  const stored = recovery
    ? pending.value
    : decodeCaseListRequest(
        JSON.parse(
          JSON.stringify({
            version: 1,
            actor: session.context.actorKey,
            caseId: item.value.id,
            action: props.action,
            command: request,
          }),
        ),
      );
  if (!stored || !session.beginSubmit({ recovery }))
    throw new ApiError('原请求仍待核对', 409, 'INVALID_STATE');
  try {
    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(stored));
    pending.value = stored;
  } catch {
    session.endSubmit('failed');
    throw new ApiError(
      '无法保存原请求恢复记录，尚未发送请求',
      400,
      'RECOVERY_STORAGE_UNAVAILABLE',
    );
  }
  error.value = '';
  try {
    const result = await transport(stored.caseId, stored.command);
    clearCommandSession(stored);
    // Complete durable bookkeeping even if this UI was invalidated; never refresh another session.
    if (
      globalThis.sessionStorage.getItem(storageKey) === JSON.stringify(stored)
    )
      globalThis.sessionStorage.removeItem(storageKey);
    if (current()) {
      pending.value = null;
      notifyWorkflowChanged();
    }
    session.endSubmit('success');
    return result;
  } catch (reason) {
    if (unknown(reason)) {
      session.endSubmit('unknown');
      if (current())
        error.value =
          '提交结果未知。原请求及请求键已保存，只能核对并重试原请求。';
    } else {
      clearCommandSession(stored);
      try {
        if (
          globalThis.sessionStorage.getItem(storageKey) ===
          JSON.stringify(stored)
        )
          globalThis.sessionStorage.removeItem(storageKey);
      } catch {
        session.endSubmit('unknown');
        if (current())
          error.value =
            '请求未完成且恢复记录无法清除，请保留原请求并联系管理员核查。';
        throw reason;
      }
      if (current()) pending.value = null;
      session.endSubmit('failed');
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status))
        session.deny();
      else if (current())
        error.value =
          '提交未完成，填写内容已保留。请核对错误；状态冲突时重新读取资料。';
    }
    throw reason;
  }
}
function clearCommandSession(stored: StoredRequest) {
  const identity = { actor: stored.actor, caseId: stored.caseId };
  const request = stored.command;
  if (request.kind === 'progress' || request.kind === 'result')
    clearSecondInstanceCommand(identity, request);
  else if (request.kind === 'result-revoke')
    clearSecondInstanceCommand(identity, {
      kind: 'revoke',
      input: request.input,
    });
  else if (
    request.kind === 'execution' &&
    pendingExecutionCommand(identity)?.idempotencyKey ===
      request.input.idempotencyKey
  )
    clearExecutionCommand(identity);
}
async function send(request: CaseListRequest) {
  await submit(request);
}
async function retryOriginal() {
  if (!pending.value) return;
  try {
    await submit(pending.value.command, true);
  } catch {
    /* shown by this panel */
  }
}
async function refresh() {
  if (
    !current() ||
    props.requestState === 'submitting' ||
    (!recordMode && (busy.value || pending.value))
  )
    return;
  try {
    const fresh = await api.getCase(item.value.id, {
      signal: detailRequest.signal,
    });
    if (fresh.id !== item.value.id)
      throw new ApiError('资料对象不匹配', 502, 'INVALID_RESPONSE');
    if (current()) item.value = fresh;
  } catch (reason) {
    if (!current()) return;
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status))
      ownedSession.deny();
    else error.value = '最新资料暂时无法读取，当前填写内容已保留，请重试。';
  }
}
const actorKey = computed(() => props.session.context.actorKey);
const judgmentSubmit = async (
  request:
    | { kind: 'register'; input: api.RegisterCaseJudgmentInput }
    | { kind: 'correct'; input: api.CorrectCaseJudgmentInput },
) => {
  if (request.kind === 'register')
    await send({ kind: 'judgment', input: request.input });
  else await send({ kind: 'judgment-correction', input: request.input });
};
const choiceSubmit = async (
  request:
    | { kind: 'choose'; input: api.ChooseCaseJudgmentNextStepInput }
    | { kind: 'revoke'; input: api.RevokeCaseJudgmentNextStepInput },
) => {
  if (request.kind === 'choose')
    await send({ kind: 'choice', input: request.input });
  else await send({ kind: 'choice-revoke', input: request.input });
};
const hearingSubmit = async (
  request:
    | { kind: 'schedule'; input: api.SaveCaseHearingInput }
    | { kind: 'correct'; input: api.CorrectCaseHearingInput },
) => {
  if (request.kind === 'schedule')
    await send({ kind: 'hearing', input: request.input });
  else await send({ kind: 'hearing-correction', input: request.input });
};
const secondSubmit = async (
  request:
    | { kind: 'progress'; input: api.SaveSecondInstanceInput }
    | { kind: 'result'; input: api.RegisterSecondInstanceResultInput }
    | { kind: 'revoke'; input: api.RevokeSecondInstanceResultInput },
) => {
  if (request.kind === 'revoke')
    await send({ kind: 'result-revoke', input: request.input });
  else await send(request);
};
// Existing callback-based panels retain their own form behavior and typed result contracts.
async function finishSubmit(
  id: string,
  input: api.FinishCaseExecutionInput,
): Promise<api.FinishCaseExecutionResult> {
  checkId(id);
  const result = await submit({ kind: 'finish', input });
  if (!result || !('filingId' in result) || !('finishedAt' in result))
    throw new ApiError('回执不匹配', 502, 'INVALID_RESPONSE');
  return result;
}
async function closureSubmit(
  id: string,
  input: api.RecordCaseClosureInput,
): Promise<api.CaseClosureResult> {
  checkId(id);
  const result = await submit({ kind: 'closure', input });
  if (!result || !('closureVersionId' in result) || !('finishId' in result))
    throw new ApiError('回执不匹配', 502, 'INVALID_RESPONSE');
  return result;
}
async function closureCorrect(
  id: string,
  input: api.CorrectCaseClosureInput,
): Promise<api.CaseClosureResult> {
  checkId(id);
  const result = await submit({ kind: 'closure-correction', input });
  if (!result || !('closureVersionId' in result) || !('finishId' in result))
    throw new ApiError('回执不匹配', 502, 'INVALID_RESPONSE');
  return result;
}
async function archiveSubmit(
  id: string,
  input: api.ArchiveCaseInput,
): Promise<api.CaseArchiveResult> {
  checkId(id);
  const result = await submit({ kind: 'archive', input });
  if (!result || !('archiveVersionId' in result))
    throw new ApiError('回执不匹配', 502, 'INVALID_RESPONSE');
  return result;
}
async function archiveCorrect(
  id: string,
  input: api.CorrectCaseArchiveInput,
): Promise<api.CaseArchiveResult> {
  checkId(id);
  const result = await submit({ kind: 'archive-correction', input });
  if (!result || !('archiveVersionId' in result))
    throw new ApiError('回执不匹配', 502, 'INVALID_RESPONSE');
  return result;
}
function checkId(id: string) {
  if (!current() || id !== item.value.id)
    throw new ApiError('办理对象已变化', 409, 'INVALID_STATE');
}
async function files(
  id: string,
  category: MaterialCategory,
): Promise<api.CaseFile[]> {
  checkId(id);
  const result = await listOwnerMaterials('CASE', id);
  checkId(id);
  return result.items
    .filter((entry) => entry.status === 'ACTIVE' && entry.category === category)
    .flatMap((entry) => {
      const version = entry.contentVersions.find(
        (version) => version.id === entry.currentVersionId,
      );
      return version
        ? [
            {
              materialId: entry.id,
              contentVersionId: version.id,
              originalFilename: version.originalFilename,
              mimeType: version.mimeType,
            },
          ]
        : [];
    });
}
async function upload(
  id: string,
  file: globalThis.File,
  category: Extract<
    MaterialCategory,
    'EXECUTION_FINISH_BASIS' | 'CASE_CLOSURE_DOCUMENT'
  >,
): Promise<api.CaseFile> {
  checkId(id);
  const result = await uploadMaterialFile({
    ownerType: 'CASE',
    ownerId: id,
    category,
    purpose: category,
    file,
  });
  checkId(id);
  return result;
}
async function download(
  id: string,
  file: api.CaseFile,
  signal: globalThis.AbortSignal,
) {
  checkId(id);
  await downloadMaterialVersion(file.materialId, file.contentVersionId, signal);
}

const candidates = ref<api.LawyerMatchCandidate[]>([]);
const candidatesError = ref('');
const lawyerQuery = ref('');
let candidateRevision = 0;
const lawyer = ref('');
const matchedOn = ref(api.todayShanghai());
const defendants = ref<api.MatchCaseInput['defendants']>([
  { kind: 'PERSON', name: '', idNo: '', phone: '', address: '' },
]);
function loadCandidates() {
  if (!current() || busy.value || pending.value || props.action !== 'match')
    return;
  const revision = ++candidateRevision;
  void api
    .listLawyerMatchCandidates(item.value.id, lawyerQuery.value, {
      signal: detailRequest.signal,
    })
    .then((result) => {
      if (current() && revision === candidateRevision) {
        candidates.value = result;
        candidatesError.value = '';
      }
    })
    .catch(() => {
      if (current() && revision === candidateRevision)
        candidatesError.value = '律师候选暂时无法读取，请重新读取资料。';
    });
}
if (props.action === 'match' && allowed.value && !pending.value)
  loadCandidates();
async function match() {
  const selected = candidates.value.find(
    (entry) => entry.lawyerAccountId === lawyer.value,
  );
  if (
    !selected ||
    defendants.value.some((entry) => !entry.name.trim()) ||
    !matchedOn.value ||
    matchedOn.value > api.todayShanghai()
  ) {
    error.value = '请填写真实匹配日期、每位被告名称并选择承办律师。';
    return;
  }
  try {
    await send({
      kind: 'match',
      input: {
        expectedVersion: item.value.version,
        idempotencyKey: globalThis.crypto.randomUUID(),
        matchedOn: matchedOn.value,
        defendants: defendants.value.map((entry) => ({ ...entry })),
        lawyerAccountId: selected.lawyerAccountId,
        lawyerProfileId: selected.lawyerProfileId,
      },
    });
  } catch {
    /* shown above */
  }
}
const complaintFiles = ref<api.CaseFile[]>([]);
const authorizationFiles = ref<api.CaseFile[]>([]);
const amountState = ref<'KNOWN' | 'PENDING'>('PENDING');
const complaintAmountChoice = ref<'' | 'KNOWN' | 'PENDING'>('');
function chooseComplaintAmount() {
  if (complaintAmountChoice.value)
    amountState.value = complaintAmountChoice.value;
}
const amount = ref('');
const pendingReason = ref('');
const uploadLoading = ref<
  Partial<Record<'COMPLAINT' | 'AUTHORIZATION', boolean>>
>({});
const uploadErrors = ref<
  Partial<Record<'COMPLAINT' | 'AUTHORIZATION', string>>
>({});
const complaintUploadUnknown = ref(false);
const complaintPreloading = ref(false);
async function loadComplaintMaterials() {
  if (!current() || busy.value || pending.value || props.action !== 'complaint')
    return;
  complaintPreloading.value = true;
  try {
    const result = await listOwnerMaterials('CASE', item.value.id, {
      signal: detailRequest.signal,
    });
    if (!current()) return;
    const selected = (category: 'COMPLAINT' | 'AUTHORIZATION') =>
      result.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' && material.category === category,
        )
        .flatMap((material) => {
          const version = material.contentVersions.find(
            (version) => version.id === material.currentVersionId,
          );
          return version
            ? [
                {
                  materialId: material.id,
                  contentVersionId: version.id,
                  originalFilename: version.originalFilename,
                  mimeType: version.mimeType,
                },
              ]
            : [];
        });
    complaintFiles.value = selected('COMPLAINT');
    authorizationFiles.value = selected('AUTHORIZATION');
    complaintUploadUnknown.value = false;
    uploadErrors.value = {};
  } catch (reason) {
    if (current()) {
      if (
        reason instanceof ApiError &&
        [401, 403, 404].includes(reason.status)
      ) {
        ownedSession.deny();
        return;
      }
      complaintUploadUnknown.value = true;
      error.value = '本案上传池暂不可读取。请重新读取材料并核对后提交。';
    }
  } finally {
    if (current()) complaintPreloading.value = false;
  }
}
if (props.action === 'complaint' && allowed.value && !pending.value)
  void loadComplaintMaterials();
async function complaintUpload(
  category: 'COMPLAINT' | 'AUTHORIZATION',
  event: globalThis.Event,
) {
  if (
    !current() ||
    busy.value ||
    pending.value ||
    !allowed.value ||
    complaintUploadUnknown.value ||
    complaintPreloading.value ||
    !(event.target instanceof globalThis.HTMLInputElement)
  )
    return;
  const picked = Array.from(event.target.files ?? []);
  event.target.value = '';
  const target = category === 'COMPLAINT' ? complaintFiles : authorizationFiles;
  if (target.value.length + picked.length > 10) {
    uploadErrors.value[category] = '最多选择10份材料。';
    return;
  }
  uploadLoading.value[category] = true;
  try {
    for (const file of picked) {
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: item.value.id,
        category,
        purpose: category,
        file,
      });
      if (!current()) return;
      target.value = [...target.value, result];
    }
  } catch (reason) {
    if (current()) {
      if (
        reason instanceof ApiError &&
        [401, 403, 404].includes(reason.status)
      ) {
        ownedSession.deny();
        return;
      }
      complaintUploadUnknown.value = unknown(reason);
      uploadErrors.value[category] =
        '上传结果未确认，请重新读取材料并核对，勿直接重复上传。';
    }
  } finally {
    if (current()) uploadLoading.value[category] = false;
  }
}
async function complaint() {
  if (!complaintAmountChoice.value) return;
  if (
    complaintUploadUnknown.value ||
    complaintPreloading.value ||
    uploadLoading.value.COMPLAINT ||
    uploadLoading.value.AUTHORIZATION
  )
    return;
  if (
    !complaintFiles.value.length ||
    !authorizationFiles.value.length ||
    (amountState.value === 'PENDING'
      ? !pendingReason.value.trim()
      : !/^\d{1,14}(\.\d{1,2})?$/.test(amount.value))
  ) {
    error.value = '请补齐起诉状、授权材料及金额或待补充原因。';
    return;
  }
  try {
    await send({
      kind: 'complaint',
      input: {
        expectedVersion: item.value.version,
        idempotencyKey: globalThis.crypto.randomUUID(),
        amountState: amountState.value,
        amount: amountState.value === 'KNOWN' ? amount.value : null,
        pendingReason:
          amountState.value === 'PENDING' ? pendingReason.value.trim() : null,
        complaintContentVersionIds: complaintFiles.value.map(
          (file) => file.contentVersionId,
        ),
        authorizationContentVersionIds: authorizationFiles.value.map(
          (file) => file.contentVersionId,
        ),
      },
    });
  } catch {
    /* shown above */
  }
}
</script>

<template>
  <section class="workflow-panel" data-test="case-list-workflow">
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      v-if="error && !storageBlocked"
      type="button"
      :disabled="busy || !!pending"
      @click="refresh"
    >
      重新读取资料
    </button>
    <div
      v-if="pending && requestState === 'unknown'"
      role="status"
      data-test="case-list-original-request"
    >
      <p>
        原办理请求尚待确认（{{
          pending.action
        }}）。刷新或重新登录不会生成新请求。
      </p>
      <button type="button" data-test="retry-original" @click="retryOriginal">
        使用原请求和请求键重试
      </button>
    </div>
    <template v-if="recordMode && !storageBlocked">
      <p>仅更正已登记资料，保存不会推进案件阶段。</p>
      <label
        >资料类型
        <select
          data-test="case-list-record-kind"
          :value="recordSelection?.kind ?? ''"
          :disabled="busy"
          @change="selectRecordKind"
        >
          <option value="" disabled>请选择已登记资料</option>
          <option
            v-for="command in recordCommands"
            :key="command.id"
            :value="command.kind"
            :disabled="
              retainedRecords.length > 0 &&
              !retainedRecords.some(
                (entry) => entry.request.kind === command.kind,
              )
            "
          >
            {{ command.label }}
          </option>
        </select>
      </label>
      <p
        v-if="recordCommands.length === 0"
        data-test="case-list-record-unavailable"
        role="status"
      >
        当前没有可更正的已登记资料。请核对最新资料及权限。
      </p>
      <div v-if="retainedRecords.length" aria-label="当前案件资料更正原请求">
        <button
          v-for="(retained, index) in retainedRecords"
          :key="
            caseSectionRecordStorageKey(
              retained.actor,
              retained.caseId,
              retained.request,
            )
          "
          type="button"
          :disabled="busy"
          @click="
            selectRecordRecovery({
              caseId: retained.caseId,
              kind: retained.request.kind,
              targetId: sectionRecordTargetId(retained.request),
            })
          "
        >
          核对原请求 {{ index + 1 }} ·
          {{
            sectionRecordCommands.find(
              (command) => command.kind === retained.request.kind,
            )?.label
          }}
        </button>
      </div>
      <CaseSectionRecordCorrectionPanel
        v-if="recordSelection && recordActorKey"
        :key="`${recordSelection.kind}:${recordSelection.targetId}`"
        :item="item"
        :kind="recordSelection.kind"
        :actor-key="recordActorKey"
        :context-key="session.contextKey"
        :initial-target-id="recordSelection.targetId || undefined"
        :before-submit="beforeRecordSubmit"
        :before-upload="beforeRecordUpload"
        @upload-state-change="recordUploadStateChanged"
        @state-change="recordStateChanged"
        @changed="recordChanged"
        @access-lost="recordAccessLost"
        @refresh="refreshRecord"
        @cancel="recordCancel"
      />
    </template>
    <p v-if="!recordMode && !allowed && !pending" role="alert">
      该操作当前不可办理，请重新读取资料并核对权限及阶段。
    </p>
    <fieldset
      v-if="!recordMode && !storageBlocked && allowed"
      class="workflow-form-scope"
      :disabled="busy || !!pending"
      :inert="busy || !!pending"
    >
      <legend class="sr-only">{{ session.context.title }}</legend>
      <label v-if="action === 'complaint' && !complaintAmountChoice"
        >金额状态<select
          data-test="complaint-amount-choice"
          v-model="complaintAmountChoice"
          @change="chooseComplaintAmount"
        >
          <option value="" disabled>请选择金额状态</option>
          <option value="KNOWN">已确认</option>
          <option value="PENDING">待补充</option>
        </select></label
      >
      <button
        v-if="action === 'complaint'"
        type="button"
        :disabled="
          complaintPreloading ||
          uploadLoading.COMPLAINT ||
          uploadLoading.AUTHORIZATION
        "
        @click="loadComplaintMaterials"
      >
        重新读取并核对已上传材料
      </button>
      <form
        v-if="action === 'match'"
        data-test="case-match-form"
        @submit.prevent="match"
      >
        <p>匹配当事人与承办律师，提交后进入待写诉状。</p>
        <label
          >实际匹配日期<input
            v-model="matchedOn"
            type="date"
            :max="api.todayShanghai()"
            required
        /></label>
        <div v-for="(defendant, index) in defendants" :key="index">
          <label
            >被告类型<select v-model="defendant.kind">
              <option value="PERSON">自然人</option>
              <option value="ORGANIZATION">组织</option>
            </select></label
          >
          <label>被告名称<input v-model="defendant.name" required /></label>
          <label>证件号码<input v-model="defendant.idNo" /></label>
          <label>电话<input v-model="defendant.phone" /></label>
          <label>地址<input v-model="defendant.address" /></label>
          <button
            v-if="defendants.length > 1"
            type="button"
            @click="defendants.splice(index, 1)"
          >
            移除被告
          </button>
        </div>
        <button
          type="button"
          @click="defendants.push({ kind: 'PERSON', name: '' })"
        >
          添加被告
        </button>
        <label>查找律师<input v-model="lawyerQuery" /></label>
        <button type="button" @click="loadCandidates">查询律师账号</button>
        <label
          >承办律师<select v-model="lawyer" required>
            <option value="" disabled>请选择律师</option>
            <option
              v-for="candidate in candidates"
              :key="candidate.lawyerAccountId"
              :value="candidate.lawyerAccountId"
            >
              {{ candidate.displayName }}
            </option>
          </select></label
        >
        <p v-if="candidatesError" role="alert">{{ candidatesError }}</p>
        <button type="submit">保存匹配并进入待写诉状</button>
      </form>
      <CaseComplaintSubmissionForm
        v-else-if="action === 'complaint' && complaintAmountChoice"
        v-model:amount-state="amountState"
        v-model:amount="amount"
        v-model:pending-reason="pendingReason"
        :complaint-files="complaintFiles"
        :authorization-files="authorizationFiles"
        :upload-loading="uploadLoading"
        :upload-errors="uploadErrors"
        :error="error"
        success=""
        :submitting="busy"
        :locked="
          complaintUploadUnknown ||
          complaintPreloading ||
          uploadLoading.COMPLAINT ||
          uploadLoading.AUTHORIZATION
        "
        @submit="complaint"
        @upload="complaintUpload"
        @remove="
          (category, index) =>
            (category === 'COMPLAINT'
              ? complaintFiles
              : authorizationFiles
            ).splice(index, 1)
        "
        @download="
          (file) =>
            downloadMaterialVersion(file.materialId, file.contentVersionId)
        "
      />
      <CaseComplaintConfirmationPanel
        v-else-if="action === 'confirm-complaint'"
        :item="item"
        :submit-command="(input) => send({ kind: 'confirmation', input })"
        @refresh="refresh"
      />
      <CaseComplaintMailingPanel
        v-else-if="action === 'mail-complaint'"
        :item="item"
        :submit-command="(input) => send({ kind: 'mailing', input })"
        @refresh="refresh"
      />
      <CaseFilingPanel
        v-else-if="action === 'filing'"
        :item="item"
        :context-key="actorKey"
        :submit-command="(input) => send({ kind: 'filing', input })"
        @refresh="refresh"
      />
      <CaseAcceptancePanel
        v-else-if="action === 'acceptance'"
        :item="item"
        :context-key="actorKey"
        :submit-command="(input) => send({ kind: 'acceptance', input })"
        @refresh="refresh"
      />
      <CaseHearingPanel
        v-else-if="action === 'hearing'"
        :item="item"
        :context-key="actorKey"
        :submit-command="hearingSubmit"
        @refresh="refresh"
      />
      <CaseJudgmentPanel
        v-else-if="
          action === 'register-judgment' || action === 'correct-judgment'
        "
        :item="item"
        :context-key="actorKey"
        :edit-only="action === 'correct-judgment'"
        :submit-command="judgmentSubmit"
        @refresh="refresh"
      />
      <CaseJudgmentNextStepPanel
        v-else-if="
          action === 'choose-next-step' || action === 'revoke-next-step'
        "
        :item="item"
        :context-key="actorKey"
        :submit-command="choiceSubmit"
        @refresh="refresh"
      />
      <CaseSecondInstancePanel
        v-else-if="
          action === 'second-instance' ||
          action === 'revoke-second-instance-result'
        "
        :item="item"
        :context-key="actorKey"
        :actor-key="actorKey"
        :submit-command="secondSubmit"
        @refresh="refresh"
      />
      <CaseExecutionSubmissionPanel
        v-else-if="
          action === 'execution-upload' || action === 'execution-submission'
        "
        :item="item"
        :context-key="actorKey"
        :actor-key="actorKey"
        :upload-only="action === 'execution-upload'"
        :submit-command="(input) => send({ kind: 'execution', input })"
        @refresh="refresh"
      />
      <CaseExecutionConfirmationPanel
        v-else-if="action === 'execution-confirmation'"
        :item="item"
        :context-key="actorKey"
        :actor-key="actorKey"
        :submit-command="
          (input) => send({ kind: 'execution-confirmation', input })
        "
        @refresh="refresh"
      />
      <CaseExecutionMailingPanel
        v-else-if="action === 'execution-mailing'"
        :item="item"
        :context-key="actorKey"
        :submit-command="(input) => send({ kind: 'execution-mailing', input })"
        @refresh="refresh"
      />
      <CaseExecutionFilingPanel
        v-else-if="action === 'execution-filing'"
        :item="item"
        :context-key="actorKey"
        :submit-command="(input) => send({ kind: 'execution-filing', input })"
        @refresh="refresh"
      />
      <CaseExecutionFinishPanel
        v-else-if="action === 'finish'"
        :item="item"
        :context-key="actorKey"
        :pending-request="null"
        :submit-finish="finishSubmit"
        :list-basis-files="(id) => files(id, 'EXECUTION_FINISH_BASIS')"
        :upload-basis-file="
          (id, file) => upload(id, file, 'EXECUTION_FINISH_BASIS')
        "
        :download-basis-file="download"
        @refresh="refresh"
      />
      <CaseClosurePanel
        v-else-if="action === 'record-closure' || action === 'correct-closure'"
        :item="item"
        :context-key="actorKey"
        :edit-only="action === 'correct-closure'"
        :pending-request="null"
        :record-closure="closureSubmit"
        :correct-closure="closureCorrect"
        :list-closure-files="(id) => files(id, 'CASE_CLOSURE_DOCUMENT')"
        :upload-closure-file="
          (id, file) => upload(id, file, 'CASE_CLOSURE_DOCUMENT')
        "
        :download-closure-file="download"
        @refresh="refresh"
      />
      <CaseArchivePanel
        v-else-if="action === 'archive' || action === 'correct-archive'"
        :item="item"
        :context-key="actorKey"
        :edit-only="action === 'correct-archive'"
        :pending-request="null"
        :archive-case="archiveSubmit"
        :correct-archive="archiveCorrect"
        @refresh="refresh"
      />
      <p
        v-if="action !== 'second-instance' && action !== 'register-judgment'"
        class="field-help"
      >
        未提交的修改不会保存。
      </p>
    </fieldset>
  </section>
</template>
