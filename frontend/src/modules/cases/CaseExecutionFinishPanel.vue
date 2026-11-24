<script setup lang="ts">
import { useMaterialRemoval } from './use-material-removal';
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { todayShanghai, type CaseFile } from '../../api/cases';
import { ApiError } from '../../api/http';

type FinishInput = {
  expectedVersion: number;
  idempotencyKey: string;
  expectedFilingId: string | null;
  finishedAt: string;
  reason: string;
  basisNote: string | null;
  basisContentVersionIds: string[];
};
type FinishResult = {
  id: string;
  finishId: string;
  filingId: string | null;
  /** 保存执行更新不推进阶段。 */
  stage: 'EXECUTING';
  version: number;
  finishedAt: string;
  recordedAt: string;
};
type FinishRecord = {
  id: string;
  filingId: string | null;
  finishedAt: string;
  reason: string;
  basisNote: string | null;
  recordedAt: string;
  files: CaseFile[];
};
const props = defineProps<{
  readRevision?: number;
  item: {
    id: string;
    stage: string;
    version: number;
    canFinishExecution: boolean;
    origin?:
      { kind: 'NOTARY' } | { kind: 'EXTERNAL_ENTRY'; initialStage: string };
    executionFiling?: { id: string } | null;
    executionFinish?: FinishRecord | null;
  };
  contextKey: string;
  pendingRequest: FinishInput | null;
  submitFinish: (caseId: string, input: FinishInput) => Promise<FinishResult>;
  listBasisFiles: (caseId: string) => Promise<CaseFile[]>;
  uploadBasisFile: (caseId: string, file: globalThis.File) => Promise<CaseFile>;
  downloadBasisFile: (
    caseId: string,
    file: CaseFile,
    signal: globalThis.AbortSignal,
  ) => Promise<void>;
}>();
const emit = defineEmits<{
  changed: [result: FinishResult];
  refresh: [];
  'pending-change': [input: FinishInput | null];
}>();
const {
  remove: removeMaterial,
  removing: removingMaterial,
  isRemoved,
} = useMaterialRemoval({
  caseId: () => props.item.id,
  onRemoved: () => emit('refresh'),
});

const finishedAt = ref(todayShanghai());
const reason = ref('');
const selected = ref<CaseFile[]>([]);
const available = ref<CaseFile[]>([]);
const pending = ref<FinishInput | null>(null);
const submitting = ref(false);
const uploading = ref(false);
const loading = ref(false);
const reviewing = ref(false);
const fileInput = ref<globalThis.HTMLInputElement | null>(null);
function pickFiles(): void {
  fileInput.value?.click();
}
const success = ref(false);
const denied = ref(false);
const conflict = ref(false);
const error = ref('');
const materialError = ref('');
let active = true;
let revision = 0;
let selectionRevision = 0;
const downloads = new Set<AbortController>();
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
  for (const download of downloads) download.abort();
  downloads.clear();
}
function copy(input: FinishInput): FinishInput {
  return {
    ...input,
    basisContentVersionIds: [...input.basisContentVersionIds],
  };
}
function publish(input: FinishInput | null) {
  pending.value = input === null ? null : copy(input);
  emit('pending-change', input === null ? null : copy(input));
}
function hydrate(input: FinishInput) {
  pending.value = copy(input);
  finishedAt.value = input.finishedAt;
  reason.value = input.reason;
  reviewing.value = false;
}
function clearDraft() {
  finishedAt.value = todayShanghai();
  reason.value = '';
  selected.value = [];
  available.value = [];
  reviewing.value = false;
  materialError.value = '';
}
const editable = computed(
  () =>
    !denied.value &&
    !conflict.value &&
    !success.value &&
    props.item.canFinishExecution &&
    props.item.stage === 'EXECUTING' &&
    (!!props.item.executionFiling ||
      (props.item.origin?.kind === 'EXTERNAL_ENTRY' &&
        props.item.origin.initialStage === 'EXECUTING')) &&
    !props.item.executionFinish,
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
function validText(value: string) {
  return value.trim().length > 0 && value.length <= 2000;
}
const ready = computed(
  () =>
    editable.value &&
    !pending.value &&
    !submitting.value &&
    !uploading.value &&
    validDate(finishedAt.value) &&
    validText(reason.value) &&
    selected.value.length <= 10,
);
function isDenied(value: unknown) {
  return value instanceof ApiError && [401, 403].includes(value.status);
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
  if (!active || !editable.value || pending.value) return;
  const context = capture();
  const selection = selectionRevision;
  loading.value = true;
  materialError.value = '';
  try {
    const files = await props.listBasisFiles(context.id);
    if (current(context) && selection === selectionRevision && !pending.value)
      available.value = files;
  } catch (failure) {
    if (!current(context)) return;
    if (isDenied(failure)) loseAccess();
    else materialError.value = '依据材料加载失败，可重试或填写依据说明。';
  } finally {
    if (current(context)) loading.value = false;
  }
}
watch(
  () => [props.item.id, props.contextKey],
  (next, previous) => {
    if (previous && next.every((value, index) => value === previous[index]))
      return;
    revision += 1;
    selectionRevision += 1;
    abortDownloads();
    clearDraft();
    pending.value = null;
    submitting.value =
      uploading.value =
      loading.value =
      success.value =
      denied.value =
        false;
    error.value = '';
    conflict.value = false;
    if (previous) emit('pending-change', null);
    else if (props.pendingRequest) hydrate(props.pendingRequest);
    void loadFiles();
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => props.pendingRequest,
  (input) => {
    if (input) hydrate(input);
    else pending.value = null;
  },
);
watch(
  () => [
    props.item.version,
    props.item.stage,
    props.item.canFinishExecution,
    props.item.executionFiling?.id,
    props.item.executionFinish?.id,
  ],
  (next, previous) => {
    if (next.every((value, index) => value === previous[index])) return;
    revision += 1;
    selectionRevision += 1;
    abortDownloads();
    submitting.value = uploading.value = loading.value = false;
    conflict.value = false;
    if (!pending.value) clearDraft();
    else available.value = selected.value = [];
    void loadFiles();
  },
  { flush: 'sync' },
);
watch(
  () => props.readRevision,
  () => {
    if (active) void loadFiles();
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  active = false;
  revision += 1;
  abortDownloads();
  submitting.value = false;
  uploading.value = false;
  loading.value = false;
  reviewing.value = false;
});
onActivated(() => {
  active = true;
});
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
  reviewing.value = false;
  selected.value = target.checked
    ? [...selected.value, file]
    : selected.value.filter(
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
    materialError.value = '最多选择 10 份真实依据附件。';
    return;
  }
  const context = capture();
  selectionRevision += 1;
  reviewing.value = false;
  uploading.value = true;
  materialError.value = '';
  try {
    for (const file of files) {
      if (!current(context)) return;
      const uploaded = await props.uploadBasisFile(context.id, file);
      if (!current(context)) return;
      available.value = [
        ...available.value.filter(
          (entry) => entry.contentVersionId !== uploaded.contentVersionId,
        ),
        uploaded,
      ];
      if (
        !selected.value.some(
          (entry) => entry.contentVersionId === uploaded.contentVersionId,
        )
      )
        selected.value = [...selected.value, uploaded];
    }
  } catch (failure) {
    if (!current(context)) return;
    if (isDenied(failure)) loseAccess();
    else materialError.value = '依据附件上传失败，请检查文件后重试。';
  } finally {
    if (current(context)) uploading.value = false;
  }
}
async function submit() {
  if (submitting.value || denied.value || (!pending.value && !ready.value))
    return;
  const context = capture();
  const input = copy(
    pending.value ?? {
      expectedVersion: props.item.version,
      expectedFilingId: props.item.executionFiling?.id ?? null,
      idempotencyKey: globalThis.crypto.randomUUID(),
      finishedAt: finishedAt.value,
      reason: reason.value,
      // 依据说明不再是登记项；后端要求「依据说明或附件至少一项」，用执行案号兜底。
      basisNote: reason.value.trim() ? reason.value : null,
      basisContentVersionIds: selected.value.map(
        (file) => file.contentVersionId,
      ),
    },
  );
  submitting.value = true;
  publish(input);
  if (!current(context)) return;
  error.value = '';
  try {
    const result = await props.submitFinish(context.id, copy(input));
    if (!current(context)) return;
    publish(null);
    success.value = true;
    emit('changed', result);
  } catch (failure) {
    if (!current(context)) return;
    if (isDenied(failure)) {
      loseAccess();
    } else if (
      !(failure instanceof ApiError) ||
      ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(failure.code) ||
      failure.status >= 500
    ) {
      error.value = '提交结果暂时未知。请使用原请求重试，或刷新核实记录。';
    } else {
      publish(null);
      reviewing.value = false;
      if (failure.status === 409) {
        conflict.value = true;
        error.value =
          failure.code === 'IDEMPOTENCY_CONFLICT'
            ? '原请求键存在冲突，请刷新核对，不要重复登记。'
            : '案件状态或来源已变化，请刷新核对记录。';
        emit('refresh');
      } else error.value = '执行结束登记未完成，请检查信息后重试。';
    }
  } finally {
    // 上下文一旦变化，current(context) 为 false；若因此跳过重置，按钮会永远
    // 停在 loading，整张卡片点不动。这里无条件复位，旧上下文的重置无害。
    submitting.value = false;
  }
}
async function download(file: CaseFile) {
  if (denied.value) return;
  const context = capture();
  const controller = new AbortController();
  downloads.add(controller);
  try {
    await props.downloadBasisFile(context.id, file, controller.signal);
  } catch (failure) {
    if (!controller.signal.aborted && current(context)) {
      if (isDenied(failure)) loseAccess();
      else error.value = '依据附件下载失败，请稍后重试。';
    }
  } finally {
    downloads.delete(controller);
  }
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="execution-finish-panel">
    <h2 class="form-section-title">执行更新</h2>
    <template v-if="item.executionFinish && !denied">
      <p data-test="execution-finish-fact">
        执行正式立案日期：{{ item.executionFinish.finishedAt }}；登记时间：{{
          new Date(item.executionFinish.recordedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })
        }}
      </p>
      <p>执行案号：{{ item.executionFinish.reason }}</p>
      <ul>
        <li
          v-for="file in item.executionFinish.files"
            v-show="!isRemoved(file)"
          :key="file.contentVersionId"
        >
          {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
            text
            @click="download(file)"
            >下载</ElButton
          >
            <ElButton
              text
              data-test="case-remove-material"
              :disabled="removingMaterial"
              @click="removeMaterial(file)"
              >删除</ElButton
            >

        </li>
      </ul>
    </template>
    <template v-if="pending && !denied">
      <p role="status">原请求待核实。当前案件记录不能代替本次请求的结果。</p>
      <p data-test="execution-finish-pending-summary">
        原立案日期：{{ pending.finishedAt }}；执行案号：{{
          pending.reason
        }}；执行文书版本：{{
          pending.basisContentVersionIds.join('、') || '未选择'
        }}
      </p>
      <ElButton
        data-test="execution-finish-retry"
        type="primary"
        :disabled="submitting"
        :loading="submitting"
        @click="submit"
        >使用原请求重试</ElButton
      >
      <ElButton
        data-test="execution-finish-refresh"
        :disabled="submitting"
        @click="emit('refresh')"
        >刷新核实记录</ElButton
      >
    </template>
    <template v-else-if="editable">
      <p class="field-help">
        登记执行正式立案信息：立案日期、执行案号与执行文书。保存只更新字段，不推进阶段；阶段流转由「结案」办理。
      </p>
      <label class="finish-field">
        <span>执行正式立案日期 <span aria-hidden="true">*</span></span>
        <input
          v-model="finishedAt"
          type="date"
          class="text-input"
          :max="todayShanghai()"
          data-test="execution-finish-date"
          required
          @input="reviewing = false"
        />
      </label>
      <label class="finish-field">
        <span>执行案号 <span aria-hidden="true">*</span></span>
        <input
          v-model="reason"
          type="text"
          class="text-input"
          maxlength="2000"
          placeholder="如（2026）浙0106执1234号"
          data-test="execution-finish-reason"
          required
          @input="reviewing = false"
        />
      </label>
      <div class="finish-field">
        <span>执行文书</span>
        <div class="finish-pick">
          <ElButton
            size="small"
            :disabled="uploading || selected.length >= 10"
            @click="pickFiles"
            >选择文件</ElButton
          >
          <span class="finish-pick__hint"
            >已选 {{ selected.length }} 份，最多 10 份</span
          >
          <input
            ref="fileInput"
            class="finish-pick__input"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            :disabled="uploading || selected.length >= 10"
            data-test="execution-finish-upload"
            @change="upload"
          />
        </div>
      </div>
      <p class="field-help">
        PDF、JPG 或 PNG，单个文件不超过 50 MB，最多 10
        份。选择具体内容版本，保留原件。
      </p>
      <p v-if="loading" role="status">正在加载执行文书</p>
      <p v-if="uploading" role="status">正在上传执行文书</p>
      <p v-if="materialError" role="alert">{{ materialError }}</p>
      <ElButton
        v-if="materialError"
        :disabled="loading || uploading"
        @click="loadFiles"
        >重新加载执行文书</ElButton
      >
      <fieldset v-if="available.length">
        <legend>选择本次使用的文书版本</legend>
        <label v-for="file in available"
            v-show="!isRemoved(file)" :key="file.contentVersionId"
          ><input
            type="checkbox"
            data-test="execution-finish-choice"
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
          >
            <ElButton
              text
              data-test="case-remove-material"
              :disabled="removingMaterial"
              @click="removeMaterial(file)"
              >删除</ElButton
            >
</label
        >
      </fieldset>
      <ElButton
        data-test="execution-finish-submit"
        type="primary"
        :loading="submitting"
        :disabled="!ready"
        @click="submit"
        >保存</ElButton
      >
    </template>
    <p
      v-else-if="!success && !item.executionFinish"
      data-test="execution-finish-read-only"
      class="field-help"
    >
      当前案件或账号不满足执行更新登记条件。
    </p>
    <p v-if="success" role="status" data-test="execution-finish-success">
      执行更新已保存，请刷新查看留存事实。
    </p>
    <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
    <ElButton
      v-if="conflict"
      data-test="execution-finish-refresh"
      @click="emit('refresh')"
      >刷新核对记录</ElButton
    >
  </section>
</template>

<style scoped>
.finish-field {
  display: grid;
  gap: 6px;
}
.finish-pick {
  display: flex;
  gap: 10px;
  align-items: center;
}
.finish-pick__hint {
  color: #909399;
  font-size: 12px;
}
.finish-pick__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
