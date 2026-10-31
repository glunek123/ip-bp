<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  archiveCheckReason,
  decodeArchiveChecks,
  getCaseArchiveReadiness,
  type ArchiveChecks,
  type CaseArchiveReadiness,
} from '../../api/case-archive-readiness';
import { todayShanghai } from '../../api/cases';
import { ApiError } from '../../api/http';

type ArchiveType =
  | 'VOIDED'
  | 'SETTLEMENT'
  | 'MEDIATION'
  | 'JUDGMENT_PERFORMED'
  | 'EXECUTION_COLLECTED'
  | 'EXECUTION_CLOSED';
type ArchiveInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedClosureVersionId: string;
  archiveAt: string;
  archiveType: ArchiveType;
  archiveReason: string;
  archiveNote?: string | null;
};
type CorrectInput = ArchiveInput & {
  expectedArchiveVersionId: string;
  correctionReason: string;
};
type PendingRequest =
  | { command: 'ARCHIVE'; input: ArchiveInput }
  | { command: 'CORRECT'; input: CorrectInput };
type ArchiveResult = {
  id: string;
  archiveId: string;
  archiveVersionId: string;
  closureId: string;
  closureVersionId: string;
  stage: 'ARCHIVED';
  version: number;
  recordedAt: string;
};
type ArchiveVersion = {
  id: string;
  kind: 'ARCHIVE' | 'CORRECT';
  priorVersionId: string | null;
  closureVersionId: string;
  fromVersion: number;
  toVersion: number;
  archiveAt: string;
  archiveType: ArchiveType;
  archiveReason: string;
  archiveNote: string | null;
  correctionReason?: string | null;
  recordedAt: string;
  recordedByUserId?: string;
};
const props = defineProps<{
  editOnly?: boolean;
  editRequest?: number;
  item: {
    id: string;
    stage: string;
    version: number;
    canArchive: boolean;
    canCorrectArchive: boolean;
    closure: { id: string; current: { id: string } } | null;
    archive: {
      id: string;
      closureId: string;
      closureVersionId: string;
      current: ArchiveVersion;
      history: ArchiveVersion[];
    } | null;
  };
  contextKey: string;
  lawyer?: boolean;
  pendingRequest: PendingRequest | null;
  archiveCase: (caseId: string, input: ArchiveInput) => Promise<ArchiveResult>;
  correctArchive: (
    caseId: string,
    input: CorrectInput,
  ) => Promise<ArchiveResult>;
}>();
const emit = defineEmits<{
  changed: [result: ArchiveResult];
  refresh: [];
  cancel: [];
  'pending-change': [request: PendingRequest | null];
}>();
const archiveTypes: { value: ArchiveType; label: string }[] = [
  { value: 'VOIDED', label: '案件作废' },
  { value: 'SETTLEMENT', label: '和解结案' },
  { value: 'MEDIATION', label: '调解结案' },
  { value: 'JUDGMENT_PERFORMED', label: '判决履行' },
  { value: 'EXECUTION_COLLECTED', label: '执行到款' },
  { value: 'EXECUTION_CLOSED', label: '执行终本' },
];
const archiveAt = ref('');
const archiveType = ref<ArchiveType | ''>('');
const archiveReason = ref('');
const archiveNote = ref('');
const correctionReason = ref('');
const correcting = ref(false);
const pending = ref<PendingRequest | null>(null);
const submitting = ref(false);
const success = ref(false);
const denied = ref(false);
const conflict = ref(false);
const projectionBlocked = ref(false);
const error = ref('');
const readiness = ref<CaseArchiveReadiness | null>(null);
const latestChecks = ref<ArchiveChecks | null>(null);
const checking = ref(false);
const checkError = ref('');
const checkExpired = ref(false);
let checkSequence = 0;
const checkRows = [
  { key: 'payment', label: '付款结清' },
  { key: 'refund', label: '诉讼退费' },
  { key: 'customer', label: '客户回款' },
  { key: 'lawyer', label: '律师开票' },
] as const;
const stateLabels = {
  PASSED: '通过',
  BLOCKED: '不足',
  UNKNOWN: '未知',
  EXEMPT: '免校验',
};
const displayedChecks = computed(
  () => latestChecks.value ?? readiness.value?.checks,
);
const financialReady = computed(
  () =>
    !!readiness.value &&
    !checkExpired.value &&
    readiness.value.caseVersion === props.item.version &&
    readiness.value.closureVersionId === props.item.closure?.current.id &&
    readiness.value.state === 'PASSED' &&
    !latestChecks.value,
);
function invalidateCheck() {
  checkSequence += 1;
  readiness.value = null;
  latestChecks.value = null;
  checking.value = false;
  checkError.value = '';
  checkExpired.value = false;
}
async function checkReadiness() {
  if (
    !active ||
    !canArchive.value ||
    denied.value ||
    pending.value ||
    submitting.value ||
    checking.value
  )
    return;
  const context = capture();
  const sequence = ++checkSequence;
  checking.value = true;
  readiness.value = null;
  latestChecks.value = null;
  checkError.value = '';
  try {
    const result = await getCaseArchiveReadiness(context.id, !!props.lawyer);
    if (!current(context) || sequence !== checkSequence) return;
    readiness.value = result;
    checkExpired.value =
      result.caseVersion !== props.item.version ||
      result.closureVersionId !== props.item.closure?.current.id;
  } catch (failure) {
    if (!current(context) || sequence !== checkSequence) return;
    if (failure instanceof ApiError && [401, 403].includes(failure.status))
      loseAccess();
    else checkError.value = '归档条件核查失败，请重新核查。';
  } finally {
    if (current(context) && sequence === checkSequence) checking.value = false;
  }
}

let active = true;
let revision = 0;
let trustedItem = props.item;
function capture() {
  return { id: props.item.id, key: props.contextKey, revision };
}
function current(context: ReturnType<typeof capture>) {
  return (
    active &&
    context.id === props.item.id &&
    context.key === props.contextKey &&
    context.revision === revision
  );
}
function copy(request: PendingRequest): PendingRequest {
  return request.command === 'ARCHIVE'
    ? { command: 'ARCHIVE', input: { ...request.input } }
    : { command: 'CORRECT', input: { ...request.input } };
}
function publish(request: PendingRequest | null) {
  pending.value = request === null ? null : copy(request);
  emit('pending-change', request === null ? null : copy(request));
}
function clearDraft() {
  archiveAt.value = archiveType.value = '';
  archiveReason.value = archiveNote.value = correctionReason.value = '';
  correcting.value = false;
}
const canArchive = computed(
  () =>
    !props.editOnly &&
    !projectionBlocked.value &&
    props.item.stage === 'WAITING_ARCHIVE' &&
    props.item.canArchive &&
    !!props.item.closure &&
    !props.item.archive,
);
const canCorrect = computed(
  () =>
    !projectionBlocked.value &&
    !props.lawyer &&
    props.item.stage === 'ARCHIVED' &&
    props.item.canCorrectArchive &&
    !!props.item.closure &&
    !!props.item.archive,
);
const editable = computed(
  () =>
    !denied.value &&
    !conflict.value &&
    !success.value &&
    (canArchive.value || (canCorrect.value && correcting.value)),
);
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <= todayShanghai()
  );
}
function validText(value: string, limit: number) {
  return value.trim().length > 0 && value.length <= limit;
}
const ready = computed(
  () =>
    editable.value &&
    (correcting.value || financialReady.value) &&
    !submitting.value &&
    !pending.value &&
    validDate(archiveAt.value) &&
    archiveTypes.some((type) => type.value === archiveType.value) &&
    validText(archiveReason.value, 2000) &&
    (!correcting.value || correctionReason.value.length <= 500),
);
function startCorrection() {
  if (
    !canCorrect.value ||
    denied.value ||
    conflict.value ||
    success.value ||
    pending.value
  )
    return;
  const version = props.item.archive!.current;
  archiveAt.value = version.archiveAt;
  archiveType.value = version.archiveType;
  archiveReason.value = version.archiveReason;
  archiveNote.value = version.archiveNote ?? '';
  correctionReason.value = '';
  correcting.value = true;
}
function loseAccess(preserveUnknown = false) {
  revision += 1;
  invalidateCheck();
  clearDraft();
  // A retry denial cannot resolve the earlier request; recovery owns its original key/body.
  if (preserveUnknown) pending.value = null;
  else publish(null);
  denied.value = true;
  submitting.value = false;
  error.value = '当前身份或权限已变化，请刷新核对。';
  emit('refresh');
}
watch(
  () => [props.item.id, props.contextKey, props.lawyer],
  (next, previous) => {
    if (previous && next.every((value, index) => value === previous[index]))
      return;
    revision += 1;
    invalidateCheck();
    clearDraft();
    projectionBlocked.value =
      !!previous && next[0] === previous[0] && props.item === trustedItem;
    trustedItem = props.item;
    pending.value = null;
    submitting.value = success.value = denied.value = conflict.value = false;
    error.value = '';
    if (previous) emit('pending-change', null);
    else if (props.pendingRequest) pending.value = copy(props.pendingRequest);
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => props.item,
  (item) => {
    if (item === trustedItem) return;
    trustedItem = item;
    invalidateCheck();
    projectionBlocked.value = false;
    if (conflict.value && !pending.value && !denied.value) {
      conflict.value = false;
      clearDraft();
      error.value = '';
    }
  },
  { flush: 'sync' },
);
watch(
  () => props.pendingRequest,
  (request) => {
    if (!denied.value && !projectionBlocked.value && request)
      pending.value = copy(request);
    // A parent null or a fresh same-identity read cannot resolve an unknown command.
  },
);
watch(
  () => [
    props.item.version,
    props.item.stage,
    props.item.canArchive,
    props.item.canCorrectArchive,
    props.item.closure?.current.id,
    props.item.archive?.current.id,
  ],
  (next, previous) => {
    if (next.every((value, index) => value === previous[index])) return;
    revision += 1;
    invalidateCheck();
    submitting.value = success.value = false;
    clearDraft();
    // Preserve the original command across competing versions; ignore late responses.
  },
  { flush: 'sync' },
);
watch(
  () => props.editRequest,
  (request) => {
    if (
      !request ||
      pending.value ||
      submitting.value ||
      denied.value ||
      conflict.value
    )
      return;
    success.value = false;
    startCorrection();
  },
  { immediate: true },
);
watch(
  () => [
    props.item,
    props.item.version,
    props.item.closure?.current.id,
    props.contextKey,
    props.lawyer,
    canArchive.value,
  ],
  () => {
    void checkReadiness();
  },
  { immediate: true, flush: 'post' },
);
function cancelEdit(): void {
  if (pending.value || submitting.value) return;
  clearDraft();
  emit('cancel');
}
onDeactivated(() => {
  active = false;
  revision += 1;
  invalidateCheck();
  submitting.value = false;
});
onActivated(() => {
  active = true;
  if (!readiness.value) void checkReadiness();
});
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  invalidateCheck();
});
async function submit() {
  if (
    submitting.value ||
    denied.value ||
    projectionBlocked.value ||
    (props.lawyer && pending.value?.command === 'CORRECT') ||
    (!pending.value && !ready.value)
  )
    return;
  const context = capture();
  const replayingUnknown = pending.value !== null;
  let request = pending.value;
  if (!request) {
    if (archiveType.value === '') return;
    const input: ArchiveInput = {
      expectedVersion: props.item.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      expectedClosureVersionId: props.item.closure!.current.id,
      archiveAt: archiveAt.value,
      archiveType: archiveType.value,
      archiveReason: archiveReason.value,
      ...(archiveNote.value.length > 0
        ? { archiveNote: archiveNote.value }
        : {}),
    };
    request = correcting.value
      ? {
          command: 'CORRECT',
          input: {
            ...input,
            expectedArchiveVersionId: props.item.archive!.current.id,
            correctionReason: correctionReason.value.trim()
              ? correctionReason.value
              : '未填写',
          },
        }
      : { command: 'ARCHIVE', input };
  }
  const snapshot = copy(request);
  submitting.value = true;
  publish(snapshot);
  if (!current(context)) return;
  error.value = '';
  try {
    const outgoing = copy(snapshot);
    const result =
      outgoing.command === 'ARCHIVE'
        ? await props.archiveCase(context.id, outgoing.input)
        : await props.correctArchive(context.id, outgoing.input);
    if (!current(context)) return;
    publish(null);
    success.value = true;
    clearDraft();
    emit('changed', result);
  } catch (failure) {
    if (!current(context)) return;
    if (failure instanceof ApiError && [401, 403].includes(failure.status))
      loseAccess(replayingUnknown);
    else if (
      !(failure instanceof ApiError) ||
      ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(failure.code) ||
      failure.status >= 500
    )
      error.value = '提交结果暂时未知。请使用原请求重试，或刷新核实记录。';
    else {
      publish(null);
      if (
        failure.status === 409 &&
        failure.code === 'ARCHIVE_FINANCIAL_NOT_READY'
      ) {
        invalidateCheck();
        try {
          latestChecks.value = decodeArchiveChecks(failure.details?.checks);
        } catch {
          /* Invalid details remain blocked. */
        }
        error.value =
          '归档条件未满足。已显示服务端最新核查结果，请补齐后重新核查。';
      } else if (failure.status === 409) {
        conflict.value = true;
        clearDraft();
        error.value =
          failure.code === 'IDEMPOTENCY_CONFLICT'
            ? '原请求键存在冲突，请刷新核对，不要重复归档。'
            : '案件状态或来源已变化，请刷新核对记录。';
        emit('refresh');
      } else error.value = '归档资料未保存，请检查信息后重试。';
    }
  } finally {
    if (current(context)) submitting.value = false;
  }
}
function typeLabel(value: ArchiveType) {
  return archiveTypes.find((type) => type.value === value)?.label;
}
function recordedTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
</script>

<template>
  <section
    class="archive-panel demo-card demo-card--pad"
    aria-label="业务归档"
    data-test="archive-panel"
  >
    <details :open="editable || !!pending || !!error || success">
      <summary class="form-section-title">业务归档</summary>
      <p
        v-if="error"
        role="alert"
        class="submit-error"
        data-test="archive-error"
      >
        {{ error }}
      </p>
      <p v-if="success" role="status" data-test="archive-success">
        归档资料已保存。
      </p>
      <template v-if="!denied && !projectionBlocked">
        <div v-if="item.archive" data-test="archive-current">
          <p>归档日期：{{ item.archive.current.archiveAt }}</p>
          <p>归档类型：{{ typeLabel(item.archive.current.archiveType) }}</p>
          <p class="preserve-text">
            归档原因：{{ item.archive.current.archiveReason }}
          </p>
          <p v-if="item.archive.current.archiveNote" class="preserve-text">
            归档备注：{{ item.archive.current.archiveNote }}
          </p>
          <p>结案版本：{{ item.archive.closureVersionId }}</p>
          <details data-test="archive-history">
            <summary>归档历史（{{ item.archive.history.length }}）</summary>
            <article v-for="version in item.archive.history" :key="version.id">
              <p>
                {{ version.kind === 'ARCHIVE' ? '首次归档' : '归档更正' }} ·
                版本 {{ version.id }} · {{ recordedTime(version.recordedAt) }}
              </p>
              <p>
                {{ version.archiveAt }} · {{ typeLabel(version.archiveType) }}
              </p>
              <p class="preserve-text">归档原因：{{ version.archiveReason }}</p>
              <p v-if="version.archiveNote" class="preserve-text">
                归档备注：{{ version.archiveNote }}
              </p>
              <p>结案版本：{{ version.closureVersionId }}</p>
              <p
                v-if="!lawyer && version.correctionReason"
                class="preserve-text"
              >
                更正原因：{{ version.correctionReason }}
              </p>
              <p v-if="!lawyer && version.recordedByUserId">
                登记人：{{ version.recordedByUserId }}
              </p>
            </article>
          </details>
          <ElButton
            v-if="
              canCorrect && !correcting && !pending && !success && !conflict
            "
            data-test="archive-correct"
            @click="startCorrection"
            >更正归档资料</ElButton
          >
        </div>
        <p v-else data-test="archive-unrecorded">归档资料：未登记</p>
        <p class="field-help">款项状态以实际记录为准。</p>
        <section
          v-if="canArchive"
          aria-label="归档条件核查"
          data-test="archive-readiness"
        >
          <p>归档前逐项核查。正式归档时服务端仍会重新核查。</p>
          <p v-if="readiness">
            核查时间：{{ recordedTime(readiness.checkedAt) }}
          </p>
          <p v-if="checkExpired" role="status">
            核查已过期或案件版本已变化，请重新核查。
          </p>
          <p v-if="checkError" role="alert">{{ checkError }}</p>
          <ul>
            <li
              v-for="row in checkRows"
              :key="row.key"
              :data-test="`archive-check-${row.key}`"
            >
              {{ row.label }}：{{
                displayedChecks
                  ? stateLabels[displayedChecks[row.key].state]
                  : '未知'
              }}。
              {{
                displayedChecks
                  ? archiveCheckReason(displayedChecks[row.key].reason)
                  : '尚未核查'
              }}
            </li>
          </ul>
          <ElButton
            data-test="archive-check"
            :loading="checking"
            :disabled="checking || submitting || !!pending || denied"
            @click="checkReadiness"
            >重新核查</ElButton
          >
        </section>
        <template v-if="pending">
          <p role="status">
            原请求待核实。当前案件记录不能代替本次请求的结果。
          </p>
          <p data-test="archive-pending-summary" class="preserve-text">
            原{{ pending.command === 'ARCHIVE' ? '归档' : '更正' }}请求：{{
              pending.input.archiveAt
            }}；{{ typeLabel(pending.input.archiveType) }}；归档原因
            {{ pending.input.archiveReason }}；归档备注
            {{ pending.input.archiveNote || '未填写'
            }}<template v-if="!lawyer && pending.command === 'CORRECT'"
              >；更正原因 {{ pending.input.correctionReason }}</template
            >
          </p>
          <ElButton
            v-if="!lawyer || pending.command === 'ARCHIVE'"
            type="primary"
            data-test="archive-retry"
            :disabled="submitting"
            :loading="submitting"
            @click="submit"
            >使用原请求重试</ElButton
          >
          <ElButton
            data-test="archive-refresh"
            :disabled="submitting"
            @click="emit('refresh')"
            >刷新核实记录</ElButton
          >
        </template>
        <form
          v-else-if="editable"
          data-test="archive-form"
          @submit.prevent="submit"
        >
          <p v-if="correcting" class="field-help">
            更正追加新版本，保留旧归档记录及原结案版本。
          </p>
          <label
            >归档日期 <span aria-hidden="true">*</span
            ><input
              v-model="archiveAt"
              type="date"
              class="text-input"
              :max="todayShanghai()"
              data-test="archive-date"
              :disabled="submitting"
              required
          /></label>
          <label
            >归档类型 <span aria-hidden="true">*</span
            ><select
              v-model="archiveType"
              class="text-input"
              data-test="archive-type"
              :disabled="submitting"
              required
            >
              <option value="" disabled>请选择</option>
              <option
                v-for="type in archiveTypes"
                :key="type.value"
                :value="type.value"
              >
                {{ type.label }}
              </option>
            </select></label
          >
          <label
            >归档原因 <span aria-hidden="true">*</span
            ><textarea
              v-model="archiveReason"
              class="text-input"
              maxlength="2000"
              data-test="archive-reason"
              :disabled="submitting"
              required
            />
          </label>
          <label
            >归档备注（选填）
            <textarea
              v-model="archiveNote"
              class="text-input"
              maxlength="2000"
              data-test="archive-note"
              :disabled="submitting"
            />
          </label>
          <label v-if="correcting"
            >更正原因（选填）
            <textarea
              v-model="correctionReason"
              class="text-input"
              maxlength="500"
              data-test="archive-correction-reason"
              :disabled="submitting"
            />
          </label>
          <ElButton
            type="primary"
            native-type="submit"
            data-test="archive-submit"
            :disabled="!ready"
            :loading="submitting"
            >{{ correcting ? '保存更正' : '确认归档' }}</ElButton
          >
          <ElButton
            v-if="correcting && !editOnly"
            data-test="archive-cancel"
            :disabled="submitting"
            @click="clearDraft"
            >取消更正</ElButton
          >
        </form>
      </template>
      <ElButton
        v-if="denied || conflict"
        data-test="archive-refresh-blocked"
        @click="emit('refresh')"
        >刷新核实记录</ElButton
      >
      <ElButton
        v-if="editOnly"
        data-test="archive-edit-cancel"
        :disabled="!!pending || submitting"
        @click="cancelEdit"
        >取消</ElButton
      >
    </details>
  </section>
</template>

<style scoped>
.archive-panel {
  margin-top: var(--s-5);
}
summary {
  cursor: pointer;
  font-weight: 600;
}
form {
  display: grid;
  gap: var(--s-3);
  margin-top: var(--s-4);
  max-width: 640px;
}
label {
  display: grid;
  gap: 6px;
}
textarea {
  min-height: 90px;
  resize: vertical;
}
article {
  padding: var(--s-3) 0;
  border-bottom: 1px solid var(--color-hairline);
}
.preserve-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
