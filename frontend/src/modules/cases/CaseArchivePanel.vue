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
const correctionReason = ref('');
const correcting = ref(false);
const pending = ref<PendingRequest | null>(null);
const submitting = ref(false);
const success = ref(false);
const denied = ref(false);
const conflict = ref(false);
const projectionBlocked = ref(false);
const error = ref('');
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
  archiveReason.value = correctionReason.value = '';
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
    !submitting.value &&
    !pending.value &&
    validDate(archiveAt.value) &&
    archiveTypes.some((type) => type.value === archiveType.value) &&
    validText(archiveReason.value, 2000) &&
    (!correcting.value || validText(correctionReason.value, 500)),
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
  correctionReason.value = '';
  correcting.value = true;
}
function loseAccess() {
  revision += 1;
  clearDraft();
  publish(null);
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
function cancelEdit(): void {
  if (pending.value || submitting.value) return;
  clearDraft();
  emit('cancel');
}
onDeactivated(() => {
  active = false;
  revision += 1;
  submitting.value = false;
});
onActivated(() => {
  active = true;
});
onBeforeUnmount(() => {
  active = false;
  revision += 1;
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
    };
    request = correcting.value
      ? {
          command: 'CORRECT',
          input: {
            ...input,
            expectedArchiveVersionId: props.item.archive!.current.id,
            correctionReason: correctionReason.value,
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
      loseAccess();
    else if (
      !(failure instanceof ApiError) ||
      ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(failure.code) ||
      failure.status >= 500
    )
      error.value = '提交结果暂时未知。请使用原请求重试，或刷新核实记录。';
    else {
      publish(null);
      if (failure.status === 409) {
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
        <p class="field-help">归档不代表款项已收齐或结清。</p>
        <template v-if="pending">
          <p role="status">
            原请求待核实。当前案件记录不能代替本次请求的结果。
          </p>
          <p data-test="archive-pending-summary" class="preserve-text">
            原{{ pending.command === 'ARCHIVE' ? '归档' : '更正' }}请求：{{
              pending.input.archiveAt
            }}；{{ typeLabel(pending.input.archiveType) }}；归档原因
            {{ pending.input.archiveReason
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
          <label v-if="correcting"
            >更正原因 <span aria-hidden="true">*</span
            ><textarea
              v-model="correctionReason"
              class="text-input"
              maxlength="500"
              data-test="archive-correction-reason"
              :disabled="submitting"
              required
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
