<script lang="ts">
import type {
  CaseDetail,
  CaseFile,
  CorrectExecutionMailingRecordInput,
  CorrectExecutionFilingRecordInput,
  CorrectExecutionFinishRecordInput,
  CorrectHearingRecordInput,
  CorrectJudgmentRecordInput,
  CorrectClosureRecordInput,
  ExecutionMailingRecordEdit,
  ExecutionFilingRecordEdit,
  ExecutionFinishRecordEdit,
  HearingRecordEdit,
  JudgmentRecordEdit,
  ClosureRecordEdit,
} from '../../api/cases';
import {
  correctCaseExecutionMailingRecord,
  correctCaseExecutionFilingRecord,
  correctCaseExecutionFinishRecord,
  correctCaseHearingRecord,
  correctCaseJudgmentRecord,
  correctCaseClosureRecord,
} from '../../api/cases';
import { ApiError, type RequestOptions } from '../../api/http';

export type CaseSectionRecordKind =
  | 'execution-mailing'
  | 'execution-filing'
  | 'execution-finish'
  | 'hearing'
  | 'judgment'
  | 'closure';
type Inputs = {
  'execution-mailing': CorrectExecutionMailingRecordInput;
  'execution-filing': CorrectExecutionFilingRecordInput;
  'execution-finish': CorrectExecutionFinishRecordInput;
  hearing: CorrectHearingRecordInput;
  judgment: CorrectJudgmentRecordInput;
  closure: CorrectClosureRecordInput;
};
export type CaseSectionRecordRequest = {
  [K in CaseSectionRecordKind]: { kind: K; input: Inputs[K] };
}[CaseSectionRecordKind];
type Entries = {
  'execution-mailing': ExecutionMailingRecordEdit;
  'execution-filing': ExecutionFilingRecordEdit;
  'execution-finish': ExecutionFinishRecordEdit;
  hearing: HearingRecordEdit;
  judgment: JudgmentRecordEdit;
  closure: ClosureRecordEdit;
};
type Target = {
  [K in CaseSectionRecordKind]: { kind: K; entry: Entries[K] };
}[CaseSectionRecordKind];
type Stored = {
  version: 1;
  actor: string;
  caseId: string;
  request: CaseSectionRecordRequest;
};
const inFlight = new Set<string>();
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    v,
  );
const text = (v: unknown): v is string => typeof v === 'string';
const ids = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.every(uuid) &&
  v.length <= 10 &&
  new Set(v).size === v.length;
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k))
  );
}
function date(v: unknown, nullable = false): v is string | null {
  if (v === null) return nullable;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v
  );
}
function amount(state: unknown, value: unknown): boolean {
  return state === 'PENDING'
    ? value === null
    : state === 'KNOWN' &&
        typeof value === 'string' &&
        /^\d{1,14}(?:\.\d{1,2})?$/u.test(value.trim());
}
function reason(v: unknown, limit = 500): v is string {
  return typeof v === 'string' && /\S/u.test(v) && v.length <= limit;
}
const commonKeys = ['idempotencyKey'];
function common(v: Record<string, unknown>): boolean {
  return reason(v.idempotencyKey, 128);
}
function mailing(v: unknown): v is CorrectExecutionMailingRecordInput {
  return (
    record(v) &&
    keys(v, [
      ...commonKeys,
      'mailingId',
      'expectedMailingRevision',
      'mailedAt',
      'mailReceiptContentVersionIds',
      'reason',
    ]) &&
    common(v) &&
    uuid(v.mailingId) &&
    revision(v.expectedMailingRevision) &&
    date(v.mailedAt) &&
    ids(v.mailReceiptContentVersionIds) &&
    v.mailReceiptContentVersionIds.length > 0 &&
    reason(v.reason)
  );
}
function filing(v: unknown): v is CorrectExecutionFilingRecordInput {
  return (
    record(v) &&
    keys(v, [
      ...commonKeys,
      'filingId',
      'expectedFilingRevision',
      'submittedAt',
      'executionFilingProofContentVersionIds',
      'reason',
    ]) &&
    common(v) &&
    uuid(v.filingId) &&
    revision(v.expectedFilingRevision) &&
    date(v.submittedAt) &&
    ids(v.executionFilingProofContentVersionIds) &&
    v.executionFilingProofContentVersionIds.length > 0 &&
    reason(v.reason)
  );
}
function finish(v: unknown): v is CorrectExecutionFinishRecordInput {
  return (
    record(v) &&
    keys(v, [
      ...commonKeys,
      'finishId',
      'expectedFinishRevision',
      'finishedAt',
      'reason',
      'basisNote',
      'basisContentVersionIds',
      'correctionReason',
    ]) &&
    common(v) &&
    uuid(v.finishId) &&
    revision(v.expectedFinishRevision) &&
    date(v.finishedAt) &&
    reason(v.reason, 2000) &&
    (v.basisNote === null || reason(v.basisNote, 2000)) &&
    ids(v.basisContentVersionIds) &&
    reason(v.correctionReason)
  );
}
function hearing(v: unknown): v is CorrectHearingRecordInput {
  return (
    record(v) &&
    keys(v, [
      ...commonKeys,
      'arrangementId',
      'trialRoundId',
      'expectedHearingRevision',
      'hearingAt',
      'reason',
    ]) &&
    common(v) &&
    uuid(v.arrangementId) &&
    uuid(v.trialRoundId) &&
    revision(v.expectedHearingRevision) &&
    date(v.hearingAt, true) &&
    reason(v.reason)
  );
}
function judgment(v: unknown): v is CorrectJudgmentRecordInput {
  return (
    record(v) &&
    keys(v, [
      ...commonKeys,
      'judgmentId',
      'trialRoundId',
      'expectedJudgmentRevision',
      'judgmentReceivedAt',
      'judgmentAmountState',
      'judgmentAmount',
      'paidLitigationFeeState',
      'paidLitigationFee',
      'judgmentContentVersionIds',
      'reason',
    ]) &&
    common(v) &&
    uuid(v.judgmentId) &&
    uuid(v.trialRoundId) &&
    revision(v.expectedJudgmentRevision) &&
    date(v.judgmentReceivedAt) &&
    amount(v.judgmentAmountState, v.judgmentAmount) &&
    amount(v.paidLitigationFeeState, v.paidLitigationFee) &&
    ids(v.judgmentContentVersionIds) &&
    v.judgmentContentVersionIds.length > 0 &&
    reason(v.reason)
  );
}
function closure(v: unknown): v is CorrectClosureRecordInput {
  return (
    record(v) &&
    keys(v, [
      ...commonKeys,
      'closureId',
      'expectedClosureVersionId',
      'expectedClosureRevision',
      'closeAt',
      'closeAmountState',
      'closeAmt',
      'note',
      'closeContentVersionIds',
      'correctionReason',
    ]) &&
    common(v) &&
    uuid(v.closureId) &&
    uuid(v.expectedClosureVersionId) &&
    revision(v.expectedClosureRevision) &&
    date(v.closeAt, true) &&
    amount(v.closeAmountState, v.closeAmt) &&
    (v.note === null || reason(v.note, 2000)) &&
    ids(v.closeContentVersionIds) &&
    reason(v.correctionReason)
  );
}
function decodeRequest(v: unknown): CaseSectionRecordRequest | null {
  if (!record(v) || !keys(v, ['kind', 'input'])) return null;
  switch (v.kind) {
    case 'execution-mailing':
      return mailing(v.input) ? { kind: v.kind, input: v.input } : null;
    case 'execution-filing':
      return filing(v.input) ? { kind: v.kind, input: v.input } : null;
    case 'execution-finish':
      return finish(v.input) ? { kind: v.kind, input: v.input } : null;
    case 'hearing':
      return hearing(v.input) ? { kind: v.kind, input: v.input } : null;
    case 'judgment':
      return judgment(v.input) ? { kind: v.kind, input: v.input } : null;
    case 'closure':
      return closure(v.input) ? { kind: v.kind, input: v.input } : null;
    default:
      return null;
  }
}
export function decodeCaseSectionRecordRequest(v: unknown): Stored | null {
  if (
    !record(v) ||
    !keys(v, ['version', 'actor', 'caseId', 'request']) ||
    v.version !== 1 ||
    !text(v.actor) ||
    !v.actor ||
    !uuid(v.caseId)
  )
    return null;
  const request = decodeRequest(v.request);
  return request
    ? { version: 1, actor: v.actor, caseId: v.caseId, request }
    : null;
}
export function sectionRecordTargetId(
  request: CaseSectionRecordRequest,
): string {
  switch (request.kind) {
    case 'execution-mailing':
      return request.input.mailingId;
    case 'execution-filing':
      return request.input.filingId;
    case 'execution-finish':
      return request.input.finishId;
    case 'hearing':
      return request.input.arrangementId;
    case 'judgment':
      return request.input.judgmentId;
    case 'closure':
      return request.input.closureId;
  }
}
export async function submitCaseSectionRecordRequest(
  caseId: string,
  request: CaseSectionRecordRequest,
  options: RequestOptions,
): Promise<void> {
  let valid = false;
  switch (request.kind) {
    case 'execution-mailing': {
      const result = await correctCaseExecutionMailingRecord(
        caseId,
        request.input,
        options,
      );
      valid =
        result.caseId === caseId &&
        result.mailingId === request.input.mailingId &&
        result.mailingRevision === request.input.expectedMailingRevision + 1 &&
        result.mailedAt === request.input.mailedAt;
      break;
    }
    case 'execution-filing': {
      const result = await correctCaseExecutionFilingRecord(
        caseId,
        request.input,
        options,
      );
      valid =
        result.caseId === caseId &&
        result.filingId === request.input.filingId &&
        result.filingRevision === request.input.expectedFilingRevision + 1 &&
        result.submittedAt === request.input.submittedAt;
      break;
    }
    case 'execution-finish': {
      const result = await correctCaseExecutionFinishRecord(
        caseId,
        request.input,
        options,
      );
      valid =
        result.caseId === caseId &&
        result.finishId === request.input.finishId &&
        result.finishRevision === request.input.expectedFinishRevision + 1 &&
        result.finishedAt === request.input.finishedAt;
      break;
    }
    case 'hearing': {
      const result = await correctCaseHearingRecord(
        caseId,
        request.input,
        options,
      );
      valid =
        result.caseId === caseId &&
        result.arrangementId === request.input.arrangementId &&
        result.trialRoundId === request.input.trialRoundId &&
        result.hearingRevision === request.input.expectedHearingRevision + 1 &&
        result.hearingAt === request.input.hearingAt;
      break;
    }
    case 'judgment': {
      const result = await correctCaseJudgmentRecord(
        caseId,
        request.input,
        options,
      );
      valid =
        result.caseId === caseId &&
        result.judgmentId === request.input.judgmentId &&
        result.trialRoundId === request.input.trialRoundId &&
        result.judgmentRevision ===
          request.input.expectedJudgmentRevision + 1 &&
        result.judgmentReceivedAt === request.input.judgmentReceivedAt;
      break;
    }
    case 'closure': {
      const result = await correctCaseClosureRecord(
        caseId,
        request.input,
        options,
      );
      valid =
        result.caseId === caseId &&
        result.closureId === request.input.closureId &&
        result.closureRevision === request.input.expectedClosureRevision + 1 &&
        result.closeAt === request.input.closeAt;
      break;
    }
  }
  if (!valid)
    throw new ApiError('资料更正回执与原请求不一致', 0, 'INVALID_RESPONSE');
}
function targetId(target: Target): string {
  switch (target.kind) {
    case 'execution-mailing':
      return target.entry.mailingId;
    case 'execution-filing':
      return target.entry.filingId;
    case 'execution-finish':
      return target.entry.finishId;
    case 'hearing':
      return target.entry.arrangementId;
    case 'judgment':
      return target.entry.judgmentId;
    case 'closure':
      return target.entry.closureId;
  }
}
function targetRevision(target: Target): number {
  switch (target.kind) {
    case 'execution-mailing':
      return target.entry.mailingRevision;
    case 'execution-filing':
      return target.entry.filingRevision;
    case 'execution-finish':
      return target.entry.finishRevision;
    case 'hearing':
      return target.entry.hearingRevision;
    case 'judgment':
      return target.entry.judgmentRevision;
    case 'closure':
      return target.entry.closureRevision;
  }
}
function targetDate(target: Target): string {
  switch (target.kind) {
    case 'execution-mailing':
      return target.entry.effective.mailedAt;
    case 'execution-filing':
      return target.entry.effective.submittedAt;
    case 'execution-finish':
      return target.entry.effective.finishedAt;
    case 'hearing':
      return target.entry.effective.hearingAt ?? '日期未定';
    case 'judgment':
      return target.entry.effective.judgmentReceivedAt;
    case 'closure':
      return target.entry.effective.closeAt ?? '日期未定';
  }
}
function targets(item: CaseDetail): Target[] {
  const edits = item.recordEdits;
  return [
    ...(edits?.executionMailings ?? []).map((entry) => ({
      kind: 'execution-mailing' as const,
      entry,
    })),
    ...(edits?.executionFilings ?? []).map((entry) => ({
      kind: 'execution-filing' as const,
      entry,
    })),
    ...(edits?.executionFinishes ?? []).map((entry) => ({
      kind: 'execution-finish' as const,
      entry,
    })),
    ...(edits?.hearings ?? []).map((entry) => ({
      kind: 'hearing' as const,
      entry,
    })),
    ...(edits?.judgments ?? []).map((entry) => ({
      kind: 'judgment' as const,
      entry,
    })),
    ...(edits?.closures ?? []).map((entry) => ({
      kind: 'closure' as const,
      entry,
    })),
  ];
}
const labels: Record<CaseSectionRecordKind, { title: string; date: string }> = {
  'execution-mailing': { title: '更正执行邮寄信息', date: '执行邮寄日期' },
  'execution-filing': { title: '更正申请执行信息', date: '申请执行日期' },
  'execution-finish': { title: '更正执行结束信息', date: '执行结束日期' },
  hearing: { title: '更正开庭资料', date: '开庭日期' },
  judgment: { title: '更正判决资料', date: '收到判决日期' },
  closure: { title: '更正结案资料', date: '结案日期' },
};
function storagePrefix(actor: string, caseId: string): string {
  return `case-section-record:v1:${encodeURIComponent(actor)}:${encodeURIComponent(caseId)}:`;
}
export function caseSectionRecordStorageKey(
  actor: string,
  caseId: string,
  request: CaseSectionRecordRequest,
): string {
  return `${storagePrefix(actor, caseId)}${request.kind}:${sectionRecordTargetId(request)}`;
}
// Durable business requests only; unsaved form drafts are never sent or stored as facts.
export function readCaseSectionRecordRequests(
  actor: string,
  caseId: string,
): Stored[] {
  const result: Stored[] = [];
  const prefix = storagePrefix(actor, caseId);
  for (let i = 0; i < globalThis.sessionStorage.length; i += 1) {
    const key = globalThis.sessionStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = globalThis.sessionStorage.getItem(key);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const stored = decodeCaseSectionRecordRequest(parsed);
    if (
      !stored ||
      stored.actor !== actor ||
      stored.caseId !== caseId ||
      caseSectionRecordStorageKey(actor, caseId, stored.request) !== key
    )
      throw new Error('Invalid section correction recovery record');
    result.push(stored);
  }
  return result;
}
</script>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { todayShanghai } from '../../api/cases';
import { downloadMaterialVersion } from '../../api/materials';

const props = defineProps<{
  item: CaseDetail;
  kind: CaseSectionRecordKind;
  actorKey: string;
  contextKey: string;
  openRevision?: number;
  initialTargetId?: string;
  beforeSubmit?: (input: {
    caseId: string;
    request: CaseSectionRecordRequest;
    recovery: boolean;
  }) => boolean;
  submitRequest?: (
    caseId: string,
    request: CaseSectionRecordRequest,
    options: RequestOptions,
  ) => Promise<void>;
}>();
const emit = defineEmits<{
  changed: [];
  refresh: [];
  'access-lost': [];
  cancel: [];
  'state-change': [state: 'idle' | 'submitting' | 'unknown'];
}>();
const selectedId = ref('');
const options = computed(() =>
  targets(props.item).filter((target) => target.kind === props.kind),
);
const selected = computed(() =>
  options.value.find((target) => targetId(target) === selectedId.value),
);
const pendingRequests = shallowRef<Stored[]>([]);
const pending = computed(() =>
  pendingRequests.value.find(
    (stored) =>
      stored.request.kind === props.kind &&
      sectionRecordTargetId(stored.request) === selectedId.value,
  ),
);
const submitting = ref(false);
const storageBlocked = ref(false);
const projectionBlocked = ref(false);
const denied = ref(false);
const error = ref('');
const success = ref('');
const draft = reactive({
  date: '',
  amountState: 'PENDING' as 'KNOWN' | 'PENDING',
  amount: '',
  feeState: 'PENDING' as 'KNOWN' | 'PENDING',
  fee: '',
  businessReason: '',
  basisNote: '',
  note: '',
  correctionReason: '',
  fileIds: [] as string[],
});
const baseFingerprint = ref('');
const baseClosureVersionId = ref<string>();
let generation = 0;
let active = true;
let requestController: AbortController | undefined;
let trustedItem = props.item;
const downloads = new Set<AbortController>();
function abortDownloads() {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}
function capture() {
  return {
    actor: props.actorKey,
    caseId: props.item.id,
    context: props.contextKey,
    kind: props.kind,
    targetId: selectedId.value,
    hint: props.initialTargetId,
    openRevision: props.openRevision,
    generation,
  };
}
function current(context: ReturnType<typeof capture>): boolean {
  return (
    active &&
    context.generation === generation &&
    context.actor === props.actorKey &&
    context.caseId === props.item.id &&
    context.context === props.contextKey &&
    context.kind === props.kind &&
    context.targetId === selectedId.value &&
    context.hint === props.initialTargetId &&
    context.openRevision === props.openRevision
  );
}
function fingerprint(): string {
  const target = selected.value;
  return target
    ? JSON.stringify([
        targetId(target),
        targetRevision(target),
        target.entry.effective,
        target.kind === 'closure' ? props.item.closure?.current.id : null,
      ])
    : '';
}
function defaultId(): string {
  if (props.initialTargetId !== undefined) return props.initialTargetId;
  const retained = pendingRequests.value.find(
    (stored) => stored.request.kind === props.kind,
  );
  if (retained) return sectionRecordTargetId(retained.request);
  const currentIds: Record<CaseSectionRecordKind, string | undefined> = {
    'execution-mailing': props.item.executionMailing?.id,
    'execution-filing': props.item.executionFiling?.id,
    'execution-finish': props.item.executionFinish?.id,
    hearing: props.item.hearing.currentArrangement?.id,
    judgment: props.item.judgment.current?.id,
    closure: props.item.closure?.id,
  };
  return options.value.find(
    (target) => targetId(target) === currentIds[props.kind],
  )
    ? currentIds[props.kind]!
    : options.value.length === 1
      ? targetId(options.value[0]!)
      : '';
}
function resetDraft(): void {
  Object.assign(draft, {
    date: '',
    amountState: 'PENDING',
    amount: '',
    feeState: 'PENDING',
    fee: '',
    businessReason: '',
    basisNote: '',
    note: '',
    correctionReason: '',
    fileIds: [],
  });
  const target = selected.value;
  baseFingerprint.value = fingerprint();
  baseClosureVersionId.value =
    target?.kind === 'closure' &&
    props.item.closure?.id === target.entry.closureId
      ? props.item.closure.current.id
      : undefined;
  if (!target) return;
  switch (target.kind) {
    case 'execution-mailing':
      draft.date = target.entry.effective.mailedAt;
      draft.fileIds = [...target.entry.effective.mailReceiptContentVersionIds];
      break;
    case 'execution-filing':
      draft.date = target.entry.effective.submittedAt;
      draft.fileIds = [
        ...target.entry.effective.executionFilingProofContentVersionIds,
      ];
      break;
    case 'execution-finish':
      draft.date = target.entry.effective.finishedAt;
      draft.businessReason = target.entry.effective.reason;
      draft.basisNote = target.entry.effective.basisNote ?? '';
      draft.fileIds = [...target.entry.effective.basisContentVersionIds];
      break;
    case 'hearing':
      draft.date = target.entry.effective.hearingAt ?? '';
      break;
    case 'judgment':
      draft.date = target.entry.effective.judgmentReceivedAt;
      draft.amountState = target.entry.effective.judgmentAmountState;
      draft.amount = target.entry.effective.judgmentAmount ?? '';
      draft.feeState = target.entry.effective.paidLitigationFeeState;
      draft.fee = target.entry.effective.paidLitigationFee ?? '';
      draft.fileIds = [...target.entry.effective.judgmentContentVersionIds];
      break;
    case 'closure':
      draft.date = target.entry.effective.closeAt ?? '';
      draft.amountState = target.entry.effective.closeAmountState;
      draft.amount = target.entry.effective.closeAmt ?? '';
      draft.note = target.entry.effective.note ?? '';
      draft.fileIds = [...target.entry.effective.closeContentVersionIds];
      break;
  }
}
function comparedIds(values: string[]): string[] {
  return [...values].sort();
}
function businessValues(request: CaseSectionRecordRequest): string {
  switch (request.kind) {
    case 'execution-mailing':
      return JSON.stringify([
        request.input.mailedAt,
        comparedIds(request.input.mailReceiptContentVersionIds),
      ]);
    case 'execution-filing':
      return JSON.stringify([
        request.input.submittedAt,
        comparedIds(request.input.executionFilingProofContentVersionIds),
      ]);
    case 'execution-finish':
      return JSON.stringify([
        request.input.finishedAt,
        request.input.reason,
        request.input.basisNote,
        comparedIds(request.input.basisContentVersionIds),
      ]);
    case 'hearing':
      return JSON.stringify([request.input.hearingAt]);
    case 'judgment':
      return JSON.stringify([
        request.input.judgmentReceivedAt,
        request.input.judgmentAmountState,
        request.input.judgmentAmount,
        request.input.paidLitigationFeeState,
        request.input.paidLitigationFee,
        comparedIds(request.input.judgmentContentVersionIds),
      ]);
    case 'closure':
      return JSON.stringify([
        request.input.closeAt,
        request.input.closeAmountState,
        request.input.closeAmt,
        request.input.note,
        comparedIds(request.input.closeContentVersionIds),
      ]);
  }
}
function effectiveValues(target: Target): string {
  switch (target.kind) {
    case 'execution-mailing':
      return JSON.stringify([
        target.entry.effective.mailedAt,
        comparedIds(target.entry.effective.mailReceiptContentVersionIds),
      ]);
    case 'execution-filing':
      return JSON.stringify([
        target.entry.effective.submittedAt,
        comparedIds(
          target.entry.effective.executionFilingProofContentVersionIds,
        ),
      ]);
    case 'execution-finish':
      return JSON.stringify([
        target.entry.effective.finishedAt,
        target.entry.effective.reason,
        target.entry.effective.basisNote,
        comparedIds(target.entry.effective.basisContentVersionIds),
      ]);
    case 'hearing':
      return JSON.stringify([target.entry.effective.hearingAt]);
    case 'judgment':
      return JSON.stringify([
        target.entry.effective.judgmentReceivedAt,
        target.entry.effective.judgmentAmountState,
        target.entry.effective.judgmentAmount,
        target.entry.effective.paidLitigationFeeState,
        target.entry.effective.paidLitigationFee,
        comparedIds(target.entry.effective.judgmentContentVersionIds),
      ]);
    case 'closure':
      return JSON.stringify([
        target.entry.effective.closeAt,
        target.entry.effective.closeAmountState,
        target.entry.effective.closeAmt,
        target.entry.effective.note,
        comparedIds(target.entry.effective.closeContentVersionIds),
      ]);
  }
}
function loadPending(): void {
  try {
    pendingRequests.value = readCaseSectionRecordRequests(
      props.actorKey,
      props.item.id,
    );
    storageBlocked.value = false;
  } catch {
    storageBlocked.value = true;
    error.value =
      '无法核对原请求恢复记录，尚未发送新请求。请保留当前会话并联系管理员。';
  }
}
let stateTransition = false;
function reportState(): void {
  emit(
    'state-change',
    submitting.value ? 'submitting' : pending.value ? 'unknown' : 'idle',
  );
}
function changeSession(update: () => void, notify: boolean): void {
  stateTransition = true;
  try {
    update();
  } finally {
    stateTransition = false;
    if (notify) reportState();
  }
}
watch(
  () =>
    [
      props.actorKey,
      props.contextKey,
      props.item.id,
      props.kind,
      props.initialTargetId,
      props.openRevision,
    ] as const,
  (next, previous) => {
    const contextChanged =
      !previous ||
      next.slice(0, 4).some((value, index) => value !== previous[index]);
    const hintChanged = next[4] !== previous?.[4];
    const reopened = next[5] !== previous?.[5];
    if (!contextChanged && !hintChanged && !reopened) return;
    const blockedTargetSwitch =
      !contextChanged &&
      hintChanged &&
      next[4] !== undefined &&
      next[4] !== selectedId.value &&
      (submitting.value || !!pending.value);
    changeSession(() => {
      generation += 1;
      requestController?.abort();
      abortDownloads();
      submitting.value = false;
      if (contextChanged) {
        denied.value = false;
        projectionBlocked.value =
          !!previous &&
          (next[0] !== previous[0] || next[1] !== previous[1]) &&
          props.item === trustedItem;
        trustedItem = props.item;
        error.value = success.value = '';
        pendingRequests.value = [];
      }
      loadPending();
      if (
        !blockedTargetSwitch &&
        (contextChanged || next[4] !== undefined || hintChanged)
      )
        selectedId.value = defaultId();
      if (contextChanged || !pending.value) {
        resetDraft();
        success.value = '';
      }
      if (blockedTargetSwitch)
        error.value =
          '原目标请求结果待核对，请先核对原请求；切换资料需由宿主开启新的读取会话。';
    }, !!previous);
  },
  { immediate: true, flush: 'pre' },
);
watch(
  selectedId,
  () => {
    abortDownloads();
    if (!submitting.value) {
      resetDraft();
      success.value = '';
    }
  },
  { flush: 'sync' },
);
watch(
  () => props.item,
  (item) => {
    if (item !== trustedItem) {
      trustedItem = item;
      projectionBlocked.value = false;
    }
  },
  { flush: 'pre' },
);
watch(
  fingerprint,
  (next, previous) => {
    if (!previous || next === previous || pending.value || submitting.value)
      return;
    resetDraft();
    error.value = '资料或结案版本已更新，请核对当前值后重新填写。';
  },
  { flush: 'sync' },
);
const requestState = computed(() =>
  submitting.value ? 'submitting' : pending.value ? 'unknown' : 'idle',
);
watch(
  requestState,
  (state) => {
    if (!stateTransition) emit('state-change', state);
  },
  {
    flush: 'sync',
    immediate: true,
  },
);
const availableFiles = computed(() => {
  const target = selected.value;
  if (!target || target.kind === 'hearing') return [];
  const files = new Map<string, CaseFile>();
  for (const values of [
    target.entry.original,
    ...target.entry.history,
    target.entry.effective,
  ])
    for (const file of values.files) files.set(file.contentVersionId, file);
  return [...files.values()];
});
const allowed = computed(
  () =>
    !!selected.value?.entry.canEdit &&
    !projectionBlocked.value &&
    !denied.value,
);
const editable = computed(
  () =>
    allowed.value &&
    !submitting.value &&
    !pending.value &&
    !storageBlocked.value,
);
function businessRequest(key: string): CaseSectionRecordRequest | null {
  const target = selected.value;
  if (!target) return null;
  const idempotencyKey = key;
  const reason = draft.correctionReason;
  switch (target.kind) {
    case 'execution-mailing':
      return {
        kind: target.kind,
        input: {
          idempotencyKey,
          mailingId: target.entry.mailingId,
          expectedMailingRevision: target.entry.mailingRevision,
          mailedAt: draft.date,
          mailReceiptContentVersionIds: [...draft.fileIds],
          reason,
        },
      };
    case 'execution-filing':
      return {
        kind: target.kind,
        input: {
          idempotencyKey,
          filingId: target.entry.filingId,
          expectedFilingRevision: target.entry.filingRevision,
          submittedAt: draft.date,
          executionFilingProofContentVersionIds: [...draft.fileIds],
          reason,
        },
      };
    case 'execution-finish':
      return {
        kind: target.kind,
        input: {
          idempotencyKey,
          finishId: target.entry.finishId,
          expectedFinishRevision: target.entry.finishRevision,
          finishedAt: draft.date,
          reason: draft.businessReason,
          basisNote: draft.basisNote === '' ? null : draft.basisNote,
          basisContentVersionIds: [...draft.fileIds],
          correctionReason: reason,
        },
      };
    case 'hearing':
      return {
        kind: target.kind,
        input: {
          idempotencyKey,
          arrangementId: target.entry.arrangementId,
          trialRoundId: target.entry.trialRoundId,
          expectedHearingRevision: target.entry.hearingRevision,
          hearingAt: draft.date || null,
          reason,
        },
      };
    case 'judgment':
      return {
        kind: target.kind,
        input: {
          idempotencyKey,
          judgmentId: target.entry.judgmentId,
          trialRoundId: target.entry.trialRoundId,
          expectedJudgmentRevision: target.entry.judgmentRevision,
          judgmentReceivedAt: draft.date,
          judgmentAmountState: draft.amountState,
          judgmentAmount: draft.amountState === 'KNOWN' ? draft.amount : null,
          paidLitigationFeeState: draft.feeState,
          paidLitigationFee: draft.feeState === 'KNOWN' ? draft.fee : null,
          judgmentContentVersionIds: [...draft.fileIds],
          reason,
        },
      };
    case 'closure': {
      const versionId = baseClosureVersionId.value;
      if (!versionId) return null;
      return {
        kind: target.kind,
        input: {
          idempotencyKey,
          closureId: target.entry.closureId,
          expectedClosureVersionId: versionId,
          expectedClosureRevision: target.entry.closureRevision,
          closeAt: draft.date || null,
          closeAmountState: draft.amountState,
          closeAmt: draft.amountState === 'KNOWN' ? draft.amount : null,
          note: draft.note === '' ? null : draft.note,
          closeContentVersionIds: [...draft.fileIds],
          correctionReason: reason,
        },
      };
    }
  }
}
const ready = computed(() => {
  if (!editable.value || baseFingerprint.value !== fingerprint()) return false;
  const request = businessRequest('validate-only');
  if (!request || !decodeRequest(request)) return false;
  if (props.kind !== 'hearing' && draft.date && draft.date > todayShanghai())
    return false;
  return (
    !!selected.value &&
    businessValues(request) !== effectiveValues(selected.value)
  );
});
function toggle(file: CaseFile, checked: boolean): void {
  if (!editable.value) return;
  if (!checked)
    draft.fileIds = draft.fileIds.filter((id) => id !== file.contentVersionId);
  else {
    const sameMaterial = new Set(
      availableFiles.value
        .filter((value) => value.materialId === file.materialId)
        .map((value) => value.contentVersionId),
    );
    const retained = draft.fileIds.filter((id) => !sameMaterial.has(id));
    if (retained.length < 10)
      draft.fileIds = [...retained, file.contentVersionId];
  }
}
function isUnknown(failure: unknown): boolean {
  return (
    !(failure instanceof ApiError) ||
    failure.status === 0 ||
    failure.status >= 500 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(
      failure.code,
    )
  );
}
async function send(
  request: CaseSectionRecordRequest,
  recovery = false,
): Promise<void> {
  if (
    !allowed.value ||
    storageBlocked.value ||
    submitting.value ||
    (!recovery && pending.value)
  )
    return;
  const context = capture();
  const stored = decodeCaseSectionRecordRequest({
    version: 1,
    actor: context.actor,
    caseId: context.caseId,
    request,
  });
  if (!stored) {
    error.value = '提交内容不完整，尚未发送请求。';
    return;
  }
  const key = caseSectionRecordStorageKey(
    context.actor,
    context.caseId,
    stored.request,
  );
  if (inFlight.has(key)) {
    error.value = '此资料的原请求正在提交，请等待结果。';
    return;
  }
  const serialized = JSON.stringify(stored);
  try {
    const prior = globalThis.sessionStorage.getItem(key);
    if (prior !== null && prior !== serialized)
      throw new Error('Different pending request');
  } catch {
    storageBlocked.value = true;
    error.value = '无法保存完整原请求，尚未发送请求。请保留当前会话核查。';
    return;
  }
  // Reserve the exact target before calling a synchronous, potentially
  // reentrant host gate. Admission never delegates transport or its signal.
  inFlight.add(key);
  try {
    if (
      props.beforeSubmit &&
      props.beforeSubmit({
        caseId: stored.caseId,
        request: globalThis.structuredClone(stored.request),
        recovery,
      }) !== true
    ) {
      inFlight.delete(key);
      return;
    }
  } catch {
    inFlight.delete(key);
    error.value = '当前操作未获提交准入，尚未发送请求。';
    return;
  }
  if (!current(context) || !allowed.value || storageBlocked.value) {
    inFlight.delete(key);
    emit('state-change', requestState.value);
    return;
  }
  // Host admission has succeeded. Report submitting before persisting a new
  // pending record, so a synchronous observer never sees transient unknown.
  submitting.value = true;
  try {
    const prior = globalThis.sessionStorage.getItem(key);
    if (prior !== null && prior !== serialized)
      throw new Error('Different pending request');
    globalThis.sessionStorage.setItem(key, serialized);
  } catch {
    inFlight.delete(key);
    storageBlocked.value = true;
    error.value = '无法保存完整原请求，尚未发送请求。请保留当前会话核查。';
    submitting.value = false;
    return;
  }
  loadPending();
  if (!current(context) || !allowed.value || storageBlocked.value) {
    inFlight.delete(key);
    submitting.value = false;
    emit('state-change', requestState.value);
    return;
  }
  error.value = success.value = '';
  const controller = new AbortController();
  requestController = controller;
  function release() {
    if (globalThis.sessionStorage.getItem(key) === serialized)
      globalThis.sessionStorage.removeItem(key);
    if (current(context)) loadPending();
  }
  try {
    await (props.submitRequest ?? submitCaseSectionRecordRequest)(
      stored.caseId,
      stored.request,
      { signal: controller.signal },
    );
    if (!current(context)) return;
    release();
    success.value = '资料更正已保存，请核对最新信息。';
    emit('changed');
  } catch (failure) {
    if (!current(context)) return;
    if (isUnknown(failure))
      error.value = '提交结果待核对。完整原请求已保留，只能显式重试原请求。';
    else if (
      failure instanceof ApiError &&
      [401, 403, 404].includes(failure.status)
    ) {
      denied.value = true;
      error.value = '当前身份或资料权限已变化，请刷新核对。原请求仍保留。';
      emit('access-lost');
    } else if (
      failure instanceof ApiError &&
      failure.code === 'IDEMPOTENCY_CONFLICT'
    )
      error.value = '原请求键存在冲突，请保留原请求并联系管理员核查。';
    else {
      try {
        release();
      } catch {
        storageBlocked.value = true;
        error.value = '无法清理原请求恢复记录，请保留当前会话核查。';
        return;
      }
      error.value =
        failure instanceof ApiError && failure.status === 409
          ? '资料版本或结案版本已变化，请刷新核对后重新填写。'
          : '更正未保存，请核对资料和更正原因。';
      if (failure instanceof ApiError && failure.status === 409) {
        projectionBlocked.value = true;
        emit('refresh');
      }
    }
  } finally {
    inFlight.delete(key);
    if (requestController === controller) requestController = undefined;
    if (current(context)) submitting.value = false;
  }
}
function save(): void {
  if (!ready.value) return;
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) {
    error.value = '当前浏览器不能生成安全请求键，尚未发送请求。';
    return;
  }
  const request = businessRequest(key);
  if (request) void send(request);
}
function retryOriginal(): void {
  if (pending.value) void send(pending.value.request, true);
}
function cancel(): void {
  if (submitting.value || pending.value) return;
  resetDraft();
  error.value = success.value = '';
  emit('cancel');
}
async function download(file: CaseFile): Promise<void> {
  if (projectionBlocked.value || denied.value || !selected.value) return;
  const context = capture();
  const controller = new AbortController();
  downloads.add(controller);
  try {
    await downloadMaterialVersion(
      file.materialId,
      file.contentVersionId,
      controller.signal,
    );
  } catch {
    if (current(context) && !controller.signal.aborted)
      error.value = '精确文件版本暂时无法下载，请稍后重试。';
  } finally {
    downloads.delete(controller);
  }
}
function frozenFiles(value: Target['entry']['effective']): CaseFile[] {
  return 'files' in value ? value.files : [];
}
function displayValues(
  value: Target['entry']['effective'],
): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  if ('mailedAt' in value)
    result.push({ label: '执行邮寄日期', value: value.mailedAt });
  if ('submittedAt' in value)
    result.push({ label: '申请执行日期', value: value.submittedAt });
  if ('finishedAt' in value)
    result.push(
      { label: '执行结束日期', value: value.finishedAt },
      { label: '结束原因', value: value.reason },
      { label: '依据说明', value: value.basisNote ?? '未登记' },
    );
  if ('hearingAt' in value)
    result.push({ label: '开庭日期', value: value.hearingAt ?? '未知' });
  if ('judgmentReceivedAt' in value)
    result.push(
      { label: '收到判决日期', value: value.judgmentReceivedAt },
      {
        label: '判决金额',
        value:
          value.judgmentAmountState === 'KNOWN'
            ? `${value.judgmentAmount} 元`
            : '待定',
      },
      {
        label: '实缴诉讼费',
        value:
          value.paidLitigationFeeState === 'KNOWN'
            ? `${value.paidLitigationFee} 元`
            : '待定',
      },
    );
  if ('closeAt' in value)
    result.push(
      { label: '结案日期', value: value.closeAt ?? '未知' },
      {
        label: '结案金额',
        value:
          value.closeAmountState === 'KNOWN' ? `${value.closeAmt} 元` : '待定',
      },
      { label: '结案说明', value: value.note ?? '未登记' },
    );
  return result;
}
onBeforeUnmount(() => {
  active = false;
  generation += 1;
  requestController?.abort();
  abortDownloads();
});
</script>

<template>
  <section
    class="demo-card demo-card--pad section-record-correction"
    data-test="section-record-panel"
  >
    <h2 class="form-section-title">{{ labels[kind].title }}</h2>
    <p class="field-help">
      只更正本项已登记资料，保存不改变案件阶段或办理版本；原登记、回执和文件版本保留。
    </p>
    <label v-if="options.length > 1" class="field-label"
      >资料记录
      <select
        v-model="selectedId"
        class="text-input"
        data-test="section-record-target"
        :disabled="submitting || !!pending"
      >
        <option value="" disabled>请选择要更正的已登记记录</option>
        <option
          v-for="(target, index) in options"
          :key="targetId(target)"
          :value="targetId(target)"
        >
          {{ labels[target.kind].title }} · {{ targetDate(target) }} · 第{{
            index + 1
          }}条{{
            target.kind === 'hearing' || target.kind === 'judgment'
              ? ` · 审理轮次 ${item.secondInstance.rounds.find((round) => round.id === target.entry.trialRoundId)?.sequence ?? '历史'}`
              : ''
          }}
        </option>
      </select>
    </label>
    <p v-if="!selected" role="status" data-test="section-record-unavailable">
      没有可读取的已登记资料目标；不会改为办理当前流程。
    </p>
    <p
      v-else-if="!allowed"
      role="status"
      data-test="section-record-unavailable"
    >
      当前账号没有更正该记录的权限，或资料读取上下文已变化。请刷新核对。
    </p>
    <template v-if="selected && !projectionBlocked && !denied">
      <dl class="case-workspace-fields" data-test="section-record-effective">
        <div
          v-for="field in displayValues(selected.entry.effective)"
          :key="field.label"
        >
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value }}</dd>
        </div>
      </dl>
      <ul data-test="section-record-effective-files">
        <li
          v-for="file in frozenFiles(selected.entry.effective)"
          :key="file.contentVersionId"
        >
          <ElButton text type="primary" @click="download(file)"
            >{{ file.originalFilename }}（当前有效版本）</ElButton
          >
          <details>
            <summary>文件版本详情</summary>
            {{ file.contentVersionId }}
          </details>
        </li>
      </ul>
      <details data-test="section-record-history">
        <summary>原登记与更正历史</summary>
        <h3>原登记</h3>
        <dl>
          <template
            v-for="field in displayValues(selected.entry.original)"
            :key="field.label"
            ><dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd></template
          >
        </dl>
        <ul>
          <li
            v-for="file in frozenFiles(selected.entry.original)"
            :key="file.contentVersionId"
          >
            <ElButton text type="primary" @click="download(file)"
              >{{ file.originalFilename }}（原登记版本）</ElButton
            >
            <details>
              <summary>文件版本详情</summary>
              {{ file.contentVersionId }}
            </details>
          </li>
        </ul>
        <article v-for="change in selected.entry.history" :key="change.id">
          <h3>资料更正 · {{ change.recordedAt }}</h3>
          <dl>
            <template v-for="field in displayValues(change)" :key="field.label"
              ><dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd></template
            >
          </dl>
          <ul>
            <li
              v-for="file in frozenFiles(change)"
              :key="file.contentVersionId"
            >
              <ElButton text type="primary" @click="download(file)"
                >{{ file.originalFilename }}（本次更正版本）</ElButton
              >
              <details>
                <summary>文件版本详情</summary>
                {{ file.contentVersionId }}
              </details>
            </li>
          </ul>
          <p>更正原因：{{ change.correctionReason }}</p>
          <details>
            <summary>记录详情</summary>
            <p>操作者：{{ change.recordedByUserId }}</p>
            <p>资料版本：{{ change.fromRevision }} → {{ change.toRevision }}</p>
          </details>
        </article>
      </details>
      <form
        v-if="allowed"
        class="form-stack"
        data-test="section-record-form"
        @submit.prevent="save"
      >
        <label class="field-label"
          >{{ labels[kind].date
          }}<input
            v-model="draft.date"
            class="text-input"
            data-test="section-record-date"
            type="date"
            :required="kind !== 'hearing' && kind !== 'closure'"
            :max="kind === 'hearing' ? undefined : todayShanghai()"
            :disabled="!editable"
        /></label>
        <p v-if="kind === 'hearing' || kind === 'closure'" class="field-help">
          日期未知可留空；清空仅更正资料，不回退或推进阶段。
        </p>
        <template v-if="kind === 'judgment' || kind === 'closure'">
          <label class="field-label"
            >{{ kind === 'judgment' ? '判决金额状态' : '结案金额状态'
            }}<select
              v-model="draft.amountState"
              class="text-input"
              data-test="section-record-amount-state"
              :disabled="!editable"
            >
              <option value="KNOWN">已知金额</option>
              <option value="PENDING">待定</option>
            </select></label
          >
          <label v-if="draft.amountState === 'KNOWN'" class="field-label"
            >金额（元）<input
              v-model="draft.amount"
              class="text-input"
              data-test="section-record-amount"
              inputmode="decimal"
              maxlength="17"
              :disabled="!editable"
          /></label>
          <p v-else class="field-help">金额待定保存为空，不按0元登记。</p>
        </template>
        <template v-if="kind === 'judgment'">
          <label class="field-label"
            >实缴诉讼费状态<select
              v-model="draft.feeState"
              class="text-input"
              data-test="section-record-fee-state"
              :disabled="!editable"
            >
              <option value="KNOWN">已知金额</option>
              <option value="PENDING">待定</option>
            </select></label
          >
          <label v-if="draft.feeState === 'KNOWN'" class="field-label"
            >实缴诉讼费（元）<input
              v-model="draft.fee"
              class="text-input"
              data-test="section-record-fee"
              inputmode="decimal"
              maxlength="17"
              :disabled="!editable"
          /></label>
        </template>
        <template v-if="kind === 'execution-finish'">
          <label class="field-label"
            >执行结束原因<textarea
              v-model="draft.businessReason"
              class="text-input"
              data-test="section-record-business-reason"
              maxlength="2000"
              :disabled="!editable"
            />
          </label>
          <label class="field-label"
            >结束依据说明（选填）<textarea
              v-model="draft.basisNote"
              class="text-input"
              data-test="section-record-basis-note"
              maxlength="2000"
              :disabled="!editable"
            />
          </label>
        </template>
        <label v-if="kind === 'closure'" class="field-label"
          >结案说明（选填）<textarea
            v-model="draft.note"
            class="text-input"
            data-test="section-record-note"
            maxlength="2000"
            :disabled="!editable"
          />
        </label>
        <fieldset v-if="kind !== 'hearing'" class="form-stack">
          <legend>本条资料的精确文件版本</legend>
          <p class="field-help" data-test="section-record-upload-unavailable">
            可复用本条资料已登记的文件版本；新增附件上传尚未开放。
          </p>
          <label
            v-for="file in availableFiles"
            :key="file.contentVersionId"
            class="checkbox-row"
            ><input
              type="checkbox"
              :data-test="`section-record-file-${file.contentVersionId}`"
              :checked="draft.fileIds.includes(file.contentVersionId)"
              :disabled="!editable"
              @change="
                toggle(file, ($event.target as HTMLInputElement).checked)
              "
            />{{ file.originalFilename
            }}<ElButton text type="primary" @click="download(file)"
              >下载精确版本</ElButton
            >
            <details>
              <summary>文件版本详情</summary>
              {{ file.contentVersionId }}
            </details></label
          >
        </fieldset>
        <label class="field-label"
          >本次更正原因<textarea
            v-model="draft.correctionReason"
            class="text-input"
            data-test="section-record-reason"
            maxlength="500"
            required
            :disabled="!editable"
          />
        </label>
        <div class="detail-actions">
          <ElButton
            data-test="section-record-save"
            type="primary"
            native-type="submit"
            :disabled="!ready"
            :loading="submitting"
            >保存资料更正</ElButton
          ><ElButton
            data-test="section-record-cancel"
            :disabled="submitting || !!pending"
            @click="cancel"
            >取消</ElButton
          >
        </div>
      </form>
    </template>
    <div
      v-if="pending && !projectionBlocked && !denied"
      role="status"
      data-test="section-record-pending"
    >
      <p>
        原请求结果待核对，表单暂时只读。恢复仅使用保留的原提交数据；目标暂不可读时请先刷新核对。
      </p>
      <details>
        <summary>查看待核对的原提交数据</summary>
        <pre>{{ JSON.stringify(pending.request.input, null, 2) }}</pre>
      </details>
    </div>
    <p v-if="error" role="alert" data-test="section-record-error">
      {{ error }}
    </p>
    <p v-if="success" role="status" data-test="section-record-success">
      {{ success }}
    </p>
    <ElButton
      v-if="pending && allowed"
      data-test="section-record-retry"
      :disabled="submitting || storageBlocked"
      @click="retryOriginal"
      >核对并重试原请求</ElButton
    >
    <ElButton
      v-if="error || !allowed"
      data-test="section-record-refresh"
      :disabled="submitting"
      @click="emit('refresh')"
      >刷新核对资料</ElButton
    >
  </section>
</template>
