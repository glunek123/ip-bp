<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';
import { ApiError } from '../../api/http';
import {
  submitExecution,
  type CaseDetail,
  type CaseFile,
  type ExecutionSubmissionFile,
  type LawyerCaseDetail,
  type SubmitExecutionInput,
} from '../../api/cases';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  beginExecutionCommand,
  beginExecutionUpload,
  clearExecutionCommand,
  clearExecutionUpload,
  hasUnclearedExecutionUpload,
  pendingExecutionCommand,
  readExecutionUpload,
  settleExecutionCommand,
} from './case-execution-recovery';

const props = defineProps<{
  item: CaseDetail | LawyerCaseDetail;
  lawyer?: boolean;
  contextKey: string;
  actorKey: string;
  readRevision?: number;
}>();
const files = ref<ExecutionSubmissionFile[]>([]);
const selected = ref<string[]>([]);
const changeReason = ref('');
const submitting = ref(false);
const uploading = ref(false);
const uploadUnknown = ref(false);
const recoveryLoading = ref(false);
const candidates = ref<
  Array<{
    materialId: string;
    version: {
      id: string;
      originalFilename: string;
      mimeType: string;
      createdAt: string;
    };
  }>
>([]);
const verified = ref(new Set<string>());
const error = ref('');
const message = ref('');
const accessDenied = ref(false);
const conflict = ref(false);
const pendingCommand = ref<SubmitExecutionInput | null>(null);
let mounted = false;
let revision = 0;
let keyFingerprint = '';
let idempotencyKey = '';
let conflictIdentity = '';
let conflictVersion: number | null = null;

const maySubmit = computed(
  () =>
    props.item.canSubmitExecution &&
    (props.item.stage === 'WAITING_EXECUTION_DOCUMENTS' ||
      props.item.stage === 'WAITING_EXECUTION_CONFIRMATION') &&
    !props.item.executionConfirmation &&
    !accessDenied.value,
);
const current = computed(() =>
  accessDenied.value ? null : props.item.executionSubmission.current,
);
const recoveryIdentity = () => ({
  actor: props.actorKey,
  caseId: props.item.id,
});
const identityKey = () =>
  `${props.actorKey}:${props.item.id}:${props.contextKey}`;
const context = () => ({
  id: props.item.id,
  actor: props.actorKey,
  key: props.contextKey,
  revision,
});
const isCurrent = (captured: ReturnType<typeof context>) =>
  mounted &&
  !accessDenied.value &&
  captured.revision === revision &&
  captured.id === props.item.id &&
  captured.actor === props.actorKey &&
  captured.key === props.contextKey;
const currentSubmissionFileKeys = computed(
  () =>
    new Set((current.value?.files ?? []).map((file) => file.contentVersionId)),
);
const isSameFileSet = computed(
  () =>
    current.value !== null &&
    selected.value.length === current.value.files.length &&
    selected.value.every((id) => currentSubmissionFileKeys.value.has(id)),
);
const canConfirm = computed(
  () =>
    maySubmit.value &&
    !submitting.value &&
    !uploading.value &&
    !uploadUnknown.value &&
    !pendingCommand.value &&
    !conflict.value &&
    selected.value.length >= 1 &&
    selected.value.length <= 10 &&
    (!current.value ||
      (!!changeReason.value.trim() &&
        changeReason.value.trim().length <= 500 &&
        !isSameFileSet.value)),
);

function resetContext(): void {
  if (conflictIdentity !== identityKey()) {
    conflict.value = false;
    conflictIdentity = '';
    conflictVersion = null;
  }
  revision += 1;
  files.value = [];
  selected.value = [];
  changeReason.value = '';
  submitting.value = false;
  uploading.value = false;
  candidates.value = [];
  verified.value.clear();
  error.value = '';
  message.value = '';
  accessDenied.value = false;
  pendingCommand.value = pendingExecutionCommand(recoveryIdentity());
  const marker = readExecutionUpload(recoveryIdentity());
  uploadUnknown.value =
    !!marker || hasUnclearedExecutionUpload(recoveryIdentity());
  keyFingerprint = '';
  idempotencyKey = '';
  if (props.item.canSubmitExecution) void loadFiles();
}

function clearSensitive(): void {
  accessDenied.value = true;
  revision += 1;
  files.value = [];
  selected.value = [];
  changeReason.value = '';
  recoveryLoading.value = false;
  candidates.value = [];
  verified.value.clear();
  error.value = '';
  message.value = '当前账号已无权读取或提交执行材料，敏感草稿已清除。';
}

async function loadFiles(): Promise<void> {
  const captured = context();
  try {
    const result = await listOwnerMaterials('CASE', captured.id);
    if (!isCurrent(captured)) return;
    const permitted = new Set(
      props.item.executionSubmission.availableFiles.map(
        (file) => file.contentVersionId,
      ),
    );
    const visible = result.items
      .filter(
        (material) =>
          material.ownerType === 'CASE' &&
          material.ownerId === captured.id &&
          material.category === 'EXECUTION_APPLICATION' &&
          material.purpose === 'EXECUTION_APPLICATION' &&
          material.status === 'ACTIVE',
      )
      .flatMap((material) =>
        material.contentVersions
          .filter(
            (version) =>
              version.status === 'AVAILABLE' &&
              (version.id === material.currentVersionId ||
                permitted.has(version.id)),
          )
          .map((version) => ({
            materialId: material.id,
            contentVersionId: version.id,
            originalFilename: version.originalFilename,
            mimeType: version.mimeType,
            uploadedAt: version.createdAt,
          })),
      );
    const allowed = new Map(
      props.item.executionSubmission.availableFiles.map((file) => [
        file.contentVersionId,
        file,
      ]),
    );
    files.value = visible
      .filter((file) => allowed.has(file.contentVersionId))
      .map((file) => allowed.get(file.contentVersionId)!);
    selected.value =
      !conflict.value && files.value.length === 1
        ? [files.value[0]!.contentVersionId]
        : [];
  } catch (reason) {
    if (!isCurrent(captured)) return;
    if (reason instanceof ApiError && reason.status === 403) clearSensitive();
    else error.value = '执行材料读取失败，请刷新案件后重试。';
  }
}

function fileInput(event: globalThis.Event): void {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const picked = Array.from(input.files ?? []);
  input.value = '';
  if (
    picked.length === 0 ||
    uploading.value ||
    uploadUnknown.value ||
    pendingCommand.value
  )
    return;
  if (
    picked.length + files.value.length > 10 ||
    picked.some((file) => file.size > 50 * 1024 * 1024)
  ) {
    error.value = '每份文件不得超过 50MB，最多选择 10 份。';
    return;
  }
  uploading.value = true;
  error.value = '';
  message.value = '';
  void uploadFiles(picked);
}

async function uploadFiles(
  picked: Array<InstanceType<typeof globalThis.File>>,
): Promise<void> {
  const captured = context();
  let uploadedAny = false;
  for (const file of picked) {
    let marker: ReturnType<typeof beginExecutionUpload> | undefined;
    try {
      marker = beginExecutionUpload(recoveryIdentity());
      await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: captured.id,
        category: 'EXECUTION_APPLICATION',
        purpose: 'EXECUTION_APPLICATION',
        file,
      });
      if (!isCurrent(captured)) return;
      clearExecutionUpload(marker);
      uploadedAny = true;
    } catch (reason) {
      if (!isCurrent(captured)) return;
      uploading.value = false;
      if (!marker) {
        error.value =
          '无法保存上传恢复标记，上传尚未开始。请检查浏览器会话存储后重试。';
      } else if (reason instanceof ApiError && reason.status === 403) {
        if (marker) {
          try {
            clearExecutionUpload(marker);
          } catch {
            /* retain warning marker */
          }
        }
        clearSensitive();
      } else if (reason instanceof ApiError && reason.status < 500) {
        if (marker) {
          try {
            clearExecutionUpload(marker);
          } catch {
            /* retain warning marker */
          }
        }
        error.value = reason.message || '文件不符合上传要求。';
      } else {
        uploadUnknown.value = true;
        message.value =
          '上传结果未知。系统不会自动重传；请刷新材料、下载候选版本并人工核对。';
      }
      if (uploadedAny) emit('refresh');
      return;
    }
  }
  if (isCurrent(captured)) {
    uploading.value = false;
    message.value = '文件已上传；上传不会提交或推进案件。';
    emit('refresh');
  }
}

async function refreshRecovery(): Promise<void> {
  if (!uploadUnknown.value || recoveryLoading.value || accessDenied.value)
    return;
  const marker = readExecutionUpload(recoveryIdentity());
  if (!marker) {
    message.value = '恢复标记不可读取，请停止操作并联系管理员核查。';
    return;
  }
  const captured = context();
  recoveryLoading.value = true;
  candidates.value = [];
  verified.value.clear();
  try {
    const result = await listOwnerMaterials('CASE', captured.id);
    if (!isCurrent(captured)) return;
    candidates.value = result.items
      .filter(
        (material) =>
          material.ownerType === 'CASE' &&
          material.ownerId === captured.id &&
          material.category === 'EXECUTION_APPLICATION' &&
          material.purpose === 'EXECUTION_APPLICATION' &&
          material.status === 'ACTIVE',
      )
      .flatMap((material) =>
        material.contentVersions
          .filter(
            (version) =>
              version.status === 'AVAILABLE' &&
              version.id === material.currentVersionId,
          )
          .map((version) => ({ materialId: material.id, version })),
      );
    message.value = candidates.value.length
      ? '下载并人工核对候选版本后，才能认领该精确版本。'
      : '没有候选版本；恢复标记保留，不能安全重传。';
  } catch (reason) {
    if (!isCurrent(captured)) return;
    if (reason instanceof ApiError && reason.status === 403) clearSensitive();
    else message.value = '候选材料读取失败；未知上传标记仍保留。';
  } finally {
    if (isCurrent(captured)) recoveryLoading.value = false;
  }
}

function candidateKey(file: {
  materialId: string;
  version: { id: string };
}): string {
  return `${file.materialId}:${file.version.id}`;
}
async function downloadCandidate(
  file: (typeof candidates.value)[number],
): Promise<void> {
  const captured = context();
  try {
    await downloadMaterialVersion(file.materialId, file.version.id);
    if (isCurrent(captured)) verified.value.add(candidateKey(file));
  } catch (reason) {
    if (!isCurrent(captured)) return;
    if (reason instanceof ApiError && reason.status === 403) clearSensitive();
    else message.value = '候选版本下载失败，请重试。';
  }
}
function adoptCandidate(file: (typeof candidates.value)[number]): void {
  if (!verified.value.has(candidateKey(file))) return;
  const marker = readExecutionUpload(recoveryIdentity());
  if (!marker) return;
  const available = props.item.executionSubmission.availableFiles.find(
    (entry) =>
      entry.materialId === file.materialId &&
      entry.contentVersionId === file.version.id,
  );
  if (!available) {
    message.value = '该版本尚未进入案件可选清单，刷新案件后再核对。';
    return;
  }
  try {
    clearExecutionUpload(marker);
  } catch {
    message.value = '无法清除恢复标记，请联系管理员核查。';
    return;
  }
  uploadUnknown.value = false;
  candidates.value = [];
  files.value = [
    ...files.value.filter(
      (entry) => entry.contentVersionId !== available.contentVersionId,
    ),
    available,
  ];
  selected.value = [
    ...new Set([...selected.value, available.contentVersionId]),
  ].slice(0, 10);
  message.value = '已人工核对并选用精确版本；仍需明确提交。';
}

function buildInput(): SubmitExecutionInput | null {
  const item = props.item;
  const next = item.judgmentNextStep.current;
  const trialRoundId =
    item.secondInstance.currentTrialRoundId ?? next?.trialRoundId;
  const latestResult = item.secondInstance.currentResult;
  const secondInstanceResultId =
    next?.next === 'APPEAL' &&
    latestResult &&
    (latestResult.result === 'CHANGE' || latestResult.result === 'AFFIRM')
      ? latestResult.id
      : null;
  const sortedIds = [...selected.value].sort();
  if (!next || !trialRoundId || selected.value.length === 0) return null;
  const reSubmitting = item.executionSubmission.current !== null;
  const fingerprint = JSON.stringify([
    item.version,
    trialRoundId,
    next.id,
    secondInstanceResultId,
    item.executionSubmission.current?.id ?? null,
    sortedIds,
  ]);
  if (fingerprint !== keyFingerprint) {
    keyFingerprint = fingerprint;
    idempotencyKey = globalThis.crypto.randomUUID();
  }
  return {
    expectedVersion: item.version,
    idempotencyKey,
    trialRoundId,
    judgmentNextStepId: next.id,
    secondInstanceResultId,
    expectedSubmissionId: item.executionSubmission.current?.id ?? null,
    executionApplicationContentVersionIds: sortedIds,
    ...(reSubmitting ? { changeReason: changeReason.value.trim() } : {}),
  };
}

function acknowledgeConflict(): void {
  if (
    !conflict.value ||
    conflictIdentity !== identityKey() ||
    conflictVersion === null ||
    props.item.version === conflictVersion
  )
    return;
  conflict.value = false;
  conflictIdentity = '';
  conflictVersion = null;
  selected.value = [];
  changeReason.value = '';
  keyFingerprint = '';
  idempotencyKey = '';
  message.value = '请重新选择材料，并核对最新案件信息后重新提交。';
}

async function send(input?: SubmitExecutionInput): Promise<void> {
  const command = input ?? buildInput();
  if (!command || submitting.value || !maySubmit.value) return;
  if (!pendingCommand.value && !canConfirm.value) return;
  const captured = context();
  const recovery = recoveryIdentity();
  const begun = beginExecutionCommand(recovery, command);
  pendingCommand.value = begun.input;
  submitting.value = true;
  error.value = '';
  message.value = '';
  try {
    await submitExecution(
      captured.id,
      begun.input,
      props.lawyer ? 'lawyer' : 'internal',
    );
    settleExecutionCommand(recovery, begun.attempt, 'confirmed');
    clearExecutionCommand(recovery);
    if (!isCurrent(captured)) return;
    pendingCommand.value = null;
    notifyWorkflowChanged();
    message.value = '执行材料已提交，案件进入待确认阶段。';
    emit('changed');
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 403) {
      settleExecutionCommand(recovery, begun.attempt, 'rejected');
      clearExecutionCommand(recovery);
      if (isCurrent(captured)) {
        pendingCommand.value = null;
        clearSensitive();
      }
      return;
    }
    if (reason instanceof ApiError && reason.status === 409) {
      settleExecutionCommand(recovery, begun.attempt, 'rejected');
      clearExecutionCommand(recovery);
      if (!isCurrent(captured)) return;
      pendingCommand.value = null;
      conflict.value = true;
      conflictIdentity = identityKey();
      conflictVersion = props.item.version;
      error.value =
        '案件版本已变化。已停止旧草稿提交，请刷新并核对最新案件后重新选择。';
      emit('refresh');
      return;
    }
    const unknown =
      !(reason instanceof ApiError) ||
      reason.status >= 500 ||
      reason.code === 'NETWORK_ERROR' ||
      reason.code === 'TIMEOUT';
    settleExecutionCommand(
      recovery,
      begun.attempt,
      unknown ? 'unknown' : 'rejected',
    );
    if (!isCurrent(captured)) return;
    if (!unknown) {
      clearExecutionCommand(recovery);
      pendingCommand.value = null;
    }
    error.value = unknown
      ? '提交结果未知。只可使用原请求键重试；不会改用最新版本覆盖旧草稿。'
      : '执行材料未提交，请核对信息后重试。';
  } finally {
    if (isCurrent(captured)) submitting.value = false;
  }
}

const emit = defineEmits<{ refresh: []; changed: [] }>();
function retry(): void {
  if (pendingCommand.value) void send(pendingCommand.value);
}
async function download(
  file: CaseFile | ExecutionSubmissionFile,
): Promise<void> {
  if (accessDenied.value) return;
  const captured = context();
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch (reason) {
    if (!isCurrent(captured)) return;
    if (reason instanceof ApiError && reason.status === 403) clearSensitive();
    else error.value = '执行材料下载失败，请重试。';
  }
}
function timestamp(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

watch(
  () => [
    props.item.id,
    props.item.version,
    props.actorKey,
    props.contextKey,
    props.item.canSubmitExecution,
    props.item.executionSubmission.availableFiles.length,
  ],
  resetContext,
  { flush: 'sync' },
);
watch(
  () => props.readRevision,
  () => {
    if (mounted) void loadFiles();
  },
  { flush: 'sync' },
);
onMounted(() => {
  mounted = true;
  resetContext();
});
onDeactivated(() => {
  mounted = false;
  revision += 1;
  submitting.value = false;
  uploading.value = false;
  recoveryLoading.value = false;
});
onActivated(() => {
  mounted = true;
  uploadUnknown.value =
    !!readExecutionUpload(recoveryIdentity()) ||
    hasUnclearedExecutionUpload(recoveryIdentity());
});
onBeforeUnmount(() => {
  mounted = false;
  revision += 1;
});
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="execution-submission-panel"
  >
    <h2 class="form-section-title">
      {{
        accessDenied
          ? '执行材料'
          : maySubmit
            ? '执行材料提交'
            : '执行材料提交历史'
      }}
    </h2>
    <p v-if="maySubmit" class="field-help">
      上传材料不会推进案件。确认提交后，案件进入“执行材料待确认”，并限制撤销上游执行决定。
    </p>
    <p
      v-else-if="
        !accessDenied && props.item.executionSubmission.submissions.length
      "
      class="field-help"
    >
      当前阶段仅展示已提交材料历史。请在确认面板核对整套材料，确认后不可重提。
    </p>
    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="conflict" class="submit-error">
      案件版本冲突。旧草稿未应用到最新案件版本；请核对案件详情后重新选择材料。
    </p>
    <button
      v-if="
        conflict &&
        conflictIdentity === identityKey() &&
        conflictVersion !== null &&
        props.item.version !== conflictVersion
      "
      type="button"
      data-test="acknowledge-execution-conflict"
      @click="acknowledgeConflict"
    >
      我已核对最新案件，重新选择材料
    </button>
    <template v-if="maySubmit">
      <label>
        执行申请材料 <span aria-hidden="true">*</span>
        <input
          type="file"
          class="text-input"
          multiple
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          :disabled="uploading || uploadUnknown || !!pendingCommand"
          @change="fileInput"
        />
      </label>
      <p class="field-help">
        PDF、DOC 或 DOCX，单份不超过 50MB；共 1～10
        份。上传完成后仍须明确选择并提交。
      </p>
      <ul>
        <li v-for="file in files" :key="file.contentVersionId">
          <label
            ><input
              v-model="selected"
              type="checkbox"
              :value="file.contentVersionId"
              :disabled="
                uploadUnknown ||
                !!pendingCommand ||
                (selected.length >= 10 &&
                  !selected.includes(file.contentVersionId))
              "
            />
            {{ file.originalFilename }}（{{ file.mimeType }}，上传于
            {{ timestamp(file.uploadedAt) }}）</label
          >
          <button type="button" @click="download(file)">下载</button>
        </li>
      </ul>
      <label v-if="current"
        >重提原因 <span aria-hidden="true">*</span
        ><textarea
          v-model="changeReason"
          maxlength="500"
          :disabled="!!pendingCommand"
        />
      </label>
      <p v-if="isSameFileSet" class="field-help">
        文件集合与当前提交相同，仅调整顺序不能作为重提。
      </p>
      <button
        type="button"
        :disabled="!canConfirm"
        data-test="submit-execution"
        @click="send()"
      >
        {{ current ? '确认重提' : '确认提交' }}
      </button>
      <button
        v-if="pendingCommand"
        type="button"
        :disabled="submitting"
        data-test="retry-execution"
        @click="retry"
      >
        使用原请求重试
      </button>
      <div v-if="uploadUnknown && !accessDenied">
        <p>上传结果未知。禁止盲目重传。请刷新候选、下载核对后再认领。</p>
        <button
          type="button"
          :disabled="recoveryLoading"
          @click="refreshRecovery"
        >
          刷新候选
        </button>
        <ul>
          <li v-for="file in candidates" :key="candidateKey(file)">
            {{ file.version.originalFilename }}（{{ file.version.mimeType }}，{{
              timestamp(file.version.createdAt)
            }}）<button type="button" @click="downloadCandidate(file)">
              下载核对</button
            ><button
              type="button"
              :disabled="!verified.has(candidateKey(file))"
              @click="adoptCandidate(file)"
            >
              认领此版本
            </button>
          </li>
        </ul>
      </div>
    </template>
    <section
      v-if="!accessDenied && props.item.executionSubmission.submissions.length"
      aria-label="执行材料提交历史"
    >
      <h3>提交历史</h3>
      <article
        v-for="submission in props.item.executionSubmission.submissions"
        :key="submission.id"
      >
        <p>
          提交于 {{ timestamp(submission.submittedAt) }}；版本
          {{ submission.fromVersion }} → {{ submission.toVersion }}
        </p>
        <p v-if="submission.changeReason">
          重提原因：{{ submission.changeReason }}
        </p>
        <ul>
          <li v-for="file in submission.files" :key="file.contentVersionId">
            {{ file.originalFilename }}（上传于
            {{ timestamp(file.uploadedAt) }}）<button
              type="button"
              @click="download(file)"
            >
              下载
            </button>
          </li>
        </ul>
      </article>
    </section>
  </section>
</template>
