<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { todayShanghai, type CaseFile } from '../../api/cases';
import { ApiError } from '../../api/http';

type RecordInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedFinishId: string;
  closeAt: string | null;
  closeAmountState: 'KNOWN' | 'PENDING';
  closeAmt: string | null;
  note: string | null;
  closeContentVersionIds: string[];
};
type CorrectInput = RecordInput & {
  expectedClosureVersionId: string;
  correctionReason: string;
};
type PendingRequest =
  | { command: 'RECORD'; input: RecordInput }
  | { command: 'CORRECT'; input: CorrectInput };
type ClosureResult = {
  id: string;
  closureId: string;
  closureVersionId: string;
  finishId: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  recordedAt: string;
};
type ClosureVersion = {
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
  correctionReason?: string | null;
  recordedAt: string;
  recordedByUserId?: string;
  files: CaseFile[];
};
const props = defineProps<{
  item: {
    id: string;
    stage: string;
    version: number;
    canRecordClosure: boolean;
    canCorrectClosure: boolean;
    executionFinish: { id: string } | null;
    closure: {
      id: string;
      finishId: string;
      current: ClosureVersion;
      history: ClosureVersion[];
    } | null;
  };
  contextKey: string;
  lawyer?: boolean;
  pendingRequest: PendingRequest | null;
  recordClosure: (caseId: string, input: RecordInput) => Promise<ClosureResult>;
  correctClosure: (
    caseId: string,
    input: CorrectInput,
  ) => Promise<ClosureResult>;
  listClosureFiles: (caseId: string) => Promise<CaseFile[]>;
  uploadClosureFile: (
    caseId: string,
    file: globalThis.File,
  ) => Promise<CaseFile>;
  downloadClosureFile: (
    caseId: string,
    file: CaseFile,
    signal: globalThis.AbortSignal,
  ) => Promise<void>;
}>();
const emit = defineEmits<{
  changed: [result: ClosureResult];
  refresh: [];
  'pending-change': [request: PendingRequest | null];
}>();
const closeAt = ref('');
const amountState = ref<'KNOWN' | 'PENDING'>('PENDING');
const amount = ref('');
const note = ref('');
const correctionReason = ref('');
const correcting = ref(false);
const selected = ref<CaseFile[]>([]);
const available = ref<CaseFile[]>([]);
const pending = ref<PendingRequest | null>(null);
const submitting = ref(false);
const uploading = ref(false);
const loading = ref(false);
const success = ref(false);
const denied = ref(false);
const projectionBlocked = ref(false);
const conflict = ref(false);
const error = ref('');
const materialError = ref('');
let active = true;
let revision = 0;
let selectionRevision = 0;
const downloads = new Set<AbortController>();
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
function abortDownloads() {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}
function copy(request: PendingRequest): PendingRequest {
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
function publish(request: PendingRequest | null) {
  pending.value = request === null ? null : copy(request);
  emit('pending-change', request === null ? null : copy(request));
}
function clearDraft() {
  selectionRevision += 1;
  closeAt.value = '';
  amountState.value = 'PENDING';
  amount.value = note.value = correctionReason.value = '';
  correcting.value = false;
  selected.value = available.value = [];
  materialError.value = '';
}
const canRecord = computed(
  () =>
    !projectionBlocked.value &&
    props.item.stage === 'WAITING_ARCHIVE' &&
    props.item.canRecordClosure &&
    !!props.item.executionFinish &&
    !props.item.closure,
);
const canCorrect = computed(
  () =>
    !projectionBlocked.value &&
    props.item.stage === 'WAITING_ARCHIVE' &&
    !props.lawyer &&
    props.item.canCorrectClosure &&
    !!props.item.executionFinish &&
    !!props.item.closure,
);
const editable = computed(
  () =>
    !denied.value &&
    !conflict.value &&
    !success.value &&
    props.item.stage === 'WAITING_ARCHIVE' &&
    (canRecord.value || (canCorrect.value && correcting.value)),
);
function validDate(value: string) {
  if (value === '') return true;
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
    !pending.value &&
    !submitting.value &&
    !uploading.value &&
    validDate(closeAt.value) &&
    (amountState.value === 'PENDING' ||
      /^\d{1,14}(?:\.\d{1,2})?$/u.test(amount.value)) &&
    (note.value === '' || validText(note.value, 2000)) &&
    (!correcting.value || validText(correctionReason.value, 500)) &&
    selected.value.length <= 10,
);
function isDenied(failure: unknown) {
  return failure instanceof ApiError && [401, 403].includes(failure.status);
}
function loseAccess() {
  revision += 1;
  selectionRevision += 1;
  abortDownloads();
  clearDraft();
  publish(null);
  denied.value = true;
  submitting.value = uploading.value = loading.value = false;
  error.value = '当前身份或权限已变化，请刷新核对。';
  emit('refresh');
}
async function loadFiles() {
  if (!editable.value || pending.value) return;
  const context = capture();
  const selection = selectionRevision;
  loading.value = true;
  materialError.value = '';
  try {
    const files = await props.listClosureFiles(context.id);
    if (current(context) && selection === selectionRevision && !pending.value) {
      available.value = [
        ...selected.value,
        ...files.filter(
          (file) =>
            !selected.value.some(
              (entry) => entry.contentVersionId === file.contentVersionId,
            ),
        ),
      ];
    }
  } catch (failure) {
    if (!current(context)) return;
    if (isDenied(failure)) loseAccess();
    else materialError.value = '结案附件加载失败，可重试或先保存资料。';
  } finally {
    if (current(context)) loading.value = false;
  }
}
function startCorrection() {
  if (
    !canCorrect.value ||
    denied.value ||
    conflict.value ||
    success.value ||
    pending.value ||
    props.item.stage !== 'WAITING_ARCHIVE'
  )
    return;
  const version = props.item.closure!.current;
  closeAt.value = version.closeAt ?? '';
  amountState.value = version.closeAmountState;
  amount.value = version.closeAmt ?? '';
  note.value = version.note ?? '';
  correctionReason.value = '';
  selected.value = [...version.files];
  available.value = [...version.files];
  correcting.value = true;
  void loadFiles();
}
watch(
  () => [props.item.id, props.contextKey, props.lawyer],
  (next, previous) => {
    if (previous && next.every((value, index) => value === previous[index]))
      return;
    revision += 1;
    selectionRevision += 1;
    abortDownloads();
    clearDraft();
    projectionBlocked.value =
      !!previous && next[0] === previous[0] && props.item === trustedItem;
    trustedItem = props.item;
    pending.value = null;
    submitting.value =
      uploading.value =
      loading.value =
      success.value =
      denied.value =
      conflict.value =
        false;
    error.value = '';
    if (previous) emit('pending-change', null);
    else if (props.pendingRequest) pending.value = copy(props.pendingRequest);
    void loadFiles();
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => props.item,
  (item) => {
    if (item !== trustedItem) {
      trustedItem = item;
      projectionBlocked.value = false;
      if (conflict.value && !pending.value && !denied.value) {
        // A successful same-context read resolves a definite conflict even
        // when its business fields have not changed. It never releases an
        // unknown request or submits a replacement intention automatically.
        conflict.value = false;
        clearDraft();
        error.value = '';
      }
      void loadFiles();
    }
  },
  { flush: 'sync' },
);
watch(
  () => props.pendingRequest,
  (request) => {
    if (!denied.value && request) pending.value = copy(request);
    // Only a definite outcome or a context switch releases a retained request.
  },
);
watch(
  () => [
    props.item.version,
    props.item.stage,
    props.item.canRecordClosure,
    props.item.canCorrectClosure,
    props.item.executionFinish?.id,
    props.item.closure?.current.id,
  ],
  (next, previous) => {
    if (next.every((value, index) => value === previous[index])) return;
    revision += 1;
    selectionRevision += 1;
    abortDownloads();
    submitting.value = uploading.value = loading.value = conflict.value = false;
    if (!pending.value) clearDraft();
    else available.value = selected.value = [];
    void loadFiles();
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  abortDownloads();
});
function toggle(file: CaseFile, event: globalThis.Event) {
  if (!editable.value || pending.value || uploading.value) return;
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  selectionRevision += 1;
  if (
    target.checked &&
    !selected.value.some(
      (entry) => entry.contentVersionId === file.contentVersionId,
    ) &&
    selected.value.length < 10
  ) {
    selected.value = [
      ...selected.value.filter((entry) => entry.materialId !== file.materialId),
      file,
    ];
  } else if (!target.checked)
    selected.value = selected.value.filter(
      (entry) => entry.contentVersionId !== file.contentVersionId,
    );
}
async function upload(event: globalThis.Event) {
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  const files = Array.from(target.files ?? []);
  target.value = '';
  if (!editable.value || pending.value || uploading.value || !files.length)
    return;
  if (selected.value.length + files.length > 10) {
    materialError.value = '最多选择 10 份结案附件。';
    return;
  }
  const context = capture();
  selectionRevision += 1;
  uploading.value = true;
  materialError.value = '';
  try {
    for (const file of files) {
      if (!current(context)) return;
      const uploaded = await props.uploadClosureFile(context.id, file);
      if (!current(context)) return;
      available.value = [
        ...available.value.filter(
          (entry) => entry.contentVersionId !== uploaded.contentVersionId,
        ),
        uploaded,
      ];
      selected.value = [
        ...selected.value.filter(
          (entry) => entry.materialId !== uploaded.materialId,
        ),
        uploaded,
      ];
    }
  } catch (failure) {
    if (!current(context)) return;
    if (isDenied(failure)) loseAccess();
    else materialError.value = '结案附件上传失败，请检查文件后重试。';
  } finally {
    if (current(context)) uploading.value = false;
  }
}
async function submit() {
  if (submitting.value || denied.value || (!pending.value && !ready.value))
    return;
  const context = capture();
  let request = pending.value;
  if (!request) {
    const input: RecordInput = {
      expectedVersion: props.item.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      expectedFinishId: props.item.executionFinish!.id,
      closeAt: closeAt.value === '' ? null : closeAt.value,
      closeAmountState: amountState.value,
      closeAmt: amountState.value === 'PENDING' ? null : amount.value,
      note: note.value === '' ? null : note.value,
      closeContentVersionIds: selected.value.map(
        (file) => file.contentVersionId,
      ),
    };
    request = correcting.value
      ? {
          command: 'CORRECT',
          input: {
            ...input,
            expectedClosureVersionId: props.item.closure!.current.id,
            correctionReason: correctionReason.value,
          },
        }
      : { command: 'RECORD', input };
  }
  const snapshot = copy(request);
  submitting.value = true;
  publish(snapshot);
  if (!current(context)) return;
  error.value = '';
  try {
    const outgoing = copy(snapshot);
    const result =
      outgoing.command === 'RECORD'
        ? await props.recordClosure(context.id, outgoing.input)
        : await props.correctClosure(context.id, outgoing.input);
    if (!current(context)) return;
    publish(null);
    success.value = true;
    clearDraft();
    emit('changed', result);
  } catch (failure) {
    if (!current(context)) return;
    if (isDenied(failure)) loseAccess();
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
        error.value =
          failure.code === 'IDEMPOTENCY_CONFLICT'
            ? '原请求键存在冲突，请刷新核对，不要重复保存。'
            : '案件状态或来源已变化，请刷新核对记录。';
        emit('refresh');
      } else error.value = '结案资料未保存，请检查信息后重试。';
    }
  } finally {
    if (current(context)) submitting.value = false;
  }
}
async function download(file: CaseFile) {
  if (denied.value || projectionBlocked.value) return;
  const context = capture();
  const controller = new AbortController();
  downloads.add(controller);
  try {
    await props.downloadClosureFile(context.id, file, controller.signal);
  } catch (failure) {
    if (!controller.signal.aborted && current(context)) {
      if (isDenied(failure)) loseAccess();
      else error.value = '结案附件下载失败，请稍后重试。';
    }
  } finally {
    downloads.delete(controller);
  }
}
function recordedTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
</script>

<template>
  <details class="demo-card demo-card--pad" data-test="closure-panel" open>
    <summary class="form-section-title">结案信息</summary>
    <template v-if="!denied && !projectionBlocked">
      <div v-if="item.closure" data-test="closure-current">
        <p>
          结案日期：{{ item.closure.current.closeAt ?? '未知' }}；结案额：{{
            item.closure.current.closeAmountState === 'PENDING'
              ? '待定'
              : item.closure.current.closeAmt
          }}；登记时间：{{ recordedTime(item.closure.current.recordedAt) }}
        </p>
        <p>说明：{{ item.closure.current.note ?? '未登记' }}</p>
        <ul>
          <li
            v-for="file in item.closure.current.files"
            :key="file.contentVersionId"
          >
            {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
              text
              @click="download(file)"
              >下载</ElButton
            >
          </li>
        </ul>
        <details data-test="closure-history">
          <summary>
            结案资料历史（{{ item.closure.history.length }} 版）
          </summary>
          <article
            v-for="version in item.closure.history"
            :key="version.id"
            data-test="closure-history-version"
          >
            <p>
              {{ version.kind === 'REGISTER' ? '首次登记' : '原因更正' }} ·
              案件版本 {{ version.fromVersion }} → {{ version.toVersion }} ·
              {{ recordedTime(version.recordedAt) }}
            </p>
            <p>
              结案日期：{{ version.closeAt ?? '未知' }}；结案额：{{
                version.closeAmountState === 'PENDING'
                  ? '待定'
                  : version.closeAmt
              }}
            </p>
            <p>说明：{{ version.note ?? '未登记' }}</p>
            <p v-if="!lawyer && version.correctionReason">
              更正原因：{{ version.correctionReason }}
            </p>
            <ul>
              <li v-for="file in version.files" :key="file.contentVersionId">
                {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
                  text
                  @click="download(file)"
                  >下载</ElButton
                >
              </li>
            </ul>
          </article>
        </details>
        <ElButton
          v-if="
            canCorrect &&
            !correcting &&
            !pending &&
            !success &&
            !conflict &&
            item.stage === 'WAITING_ARCHIVE'
          "
          data-test="closure-correct"
          @click="startCorrection"
          >更正结案资料</ElButton
        >
      </div>
      <p v-else data-test="closure-unrecorded">结案资料：未登记</p>
      <p class="field-help">案件实收：未登记。保存结案资料后仍为待归档。</p>
    </template>
    <template v-if="pending && !denied">
      <p role="status">原请求待核实。当前案件记录不能代替本次请求的结果。</p>
      <p data-test="closure-pending-summary">
        原{{ pending.command === 'RECORD' ? '登记' : '更正' }}请求：结案日期
        {{ pending.input.closeAt ?? '未知' }}；结案额
        {{
          pending.input.closeAmountState === 'PENDING'
            ? '待定'
            : pending.input.closeAmt
        }}；说明 {{ pending.input.note ?? '未登记' }}；附件版本
        {{ pending.input.closeContentVersionIds.join('、') || '未选择'
        }}<template v-if="pending.command === 'CORRECT'"
          >；更正原因 {{ pending.input.correctionReason }}</template
        >
      </p>
      <ElButton
        data-test="closure-retry"
        type="primary"
        :disabled="submitting"
        :loading="submitting"
        @click="submit"
        >使用原请求重试</ElButton
      >
      <ElButton
        data-test="closure-refresh"
        :disabled="submitting"
        @click="emit('refresh')"
        >刷新核实记录</ElButton
      >
    </template>
    <form
      v-else-if="editable"
      data-test="closure-form"
      @submit.prevent="submit"
    >
      <p v-if="correcting" class="field-help">
        更正追加新版本，旧记录与附件仍可追溯。请填写本次更正原因。
      </p>
      <label
        >结案日期<input
          v-model="closeAt"
          type="date"
          class="text-input"
          :max="todayShanghai()"
          data-test="closure-date"
      /></label>
      <p class="field-help">日期未知时留空。</p>
      <label
        >结案额状态<select
          v-model="amountState"
          class="text-input"
          data-test="closure-amount-state"
        >
          <option value="PENDING">待定</option>
          <option value="KNOWN">已知</option>
        </select></label
      >
      <label v-if="amountState === 'KNOWN'"
        >结案额<input
          v-model="amount"
          class="text-input"
          inputmode="decimal"
          data-test="closure-amount"
          placeholder="填写真实金额，可为 0"
          required
      /></label>
      <label
        >结案说明<textarea
          v-model="note"
          class="text-input"
          maxlength="2000"
          data-test="closure-note"
        />
      </label>
      <label v-if="correcting"
        >更正原因 <span aria-hidden="true">*</span
        ><textarea
          v-model="correctionReason"
          class="text-input"
          maxlength="500"
          data-test="closure-reason"
          required
        />
      </label>
      <label
        >结案附件<input
          type="file"
          class="text-input"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          multiple
          :disabled="uploading || selected.length >= 10"
          data-test="closure-upload"
          @change="upload"
      /></label>
      <p class="field-help">
        PDF、JPG 或 PNG，单个文件不超过 50 MB，最多 10
        份。可先保存资料，附件可为空。
      </p>
      <p v-if="loading" role="status">正在加载结案附件</p>
      <p v-if="uploading" role="status">正在上传结案附件</p>
      <p v-if="materialError" role="alert">{{ materialError }}</p>
      <ElButton
        v-if="materialError"
        :disabled="loading || uploading"
        @click="loadFiles"
        >重新加载结案附件</ElButton
      >
      <fieldset v-if="available.length">
        <legend>选择本次附件版本</legend>
        <label v-for="file in available" :key="file.contentVersionId"
          ><input
            type="checkbox"
            data-test="closure-choice"
            :checked="
              selected.some(
                (entry) => entry.contentVersionId === file.contentVersionId,
              )
            "
            :disabled="
              uploading ||
              (selected.length >= 10 &&
                !selected.some(
                  (entry) => entry.contentVersionId === file.contentVersionId,
                ))
            "
            @change="toggle(file, $event)"
          />{{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
            text
            @click="download(file)"
            >下载</ElButton
          ></label
        >
      </fieldset>
      <ElButton
        data-test="closure-submit"
        type="primary"
        :disabled="!ready"
        @click="submit"
        >{{ correcting ? '保存更正' : '保存结案资料' }}</ElButton
      >
      <ElButton
        v-if="correcting"
        data-test="closure-cancel"
        :disabled="uploading"
        @click="clearDraft"
        >取消更正</ElButton
      >
    </form>
    <p v-if="success" role="status" data-test="closure-success">
      结案资料已保存，案件仍为待归档，请刷新查看记录。
    </p>
    <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
    <ElButton
      v-if="conflict"
      data-test="closure-refresh"
      @click="emit('refresh')"
      >刷新核对记录</ElButton
    >
  </details>
</template>
