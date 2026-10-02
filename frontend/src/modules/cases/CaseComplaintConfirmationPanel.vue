<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  confirmCaseComplaint,
  type CaseDetail,
  type CaseFile,
  type ConfirmCaseComplaintInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type OwnerMaterial,
} from '../../api/materials';
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{ item: CaseDetail }>();
const emit = defineEmits<{ changed: []; refresh: [] }>();
type ComplaintVersion = CaseFile & { createdAt: string };

const auth = useAuthStore();
const versions = ref<ComplaintVersion[]>([]);
const versionsLoading = ref(false);
const versionsError = ref('');
const selectedVersionId = ref('');
const amountState = ref<'KNOWN' | 'PENDING'>('KNOWN');
const amount = ref('');
const pendingReason = ref('');
const changeNote = ref('');
const confirmDisclose = ref<boolean | null>(null);
const uploadLoading = ref(false);
const uploadError = ref('');
const downloadError = ref('');
const confirmationError = ref('');
const confirmationSuccess = ref('');
const confirmationSubmitting = ref(false);
const reviewVisible = ref(false);
const unknownRequest = ref<ConfirmCaseComplaintInput | null>(null);
const contextRevision = ref(0);
let versionsRequest: AbortController | undefined;
let mounted = true;

const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const requestScopeKey = computed(() => `${props.item.id}:${identity.value}`);
const factsKey = computed(() => `${props.item.version}:${props.item.stage}`);
const canConfirm = computed(
  () =>
    props.item.stage === 'WAITING_COMPLAINT_CONFIRMATION' &&
    props.item.canConfirmComplaint,
);
const originalFiles = computed(
  () => props.item.complaint?.complaintFiles ?? [],
);
const changedFacts = computed(() => {
  const original = props.item.complaint;
  if (!original || !selectedVersionId.value) return false;
  const selectedWasSubmitted = original.complaintFiles.some(
    (file) => file.contentVersionId === selectedVersionId.value,
  );
  const amountChanged =
    original.amountState !== amountState.value ||
    (amountState.value === 'KNOWN'
      ? original.amount !== amount.value.trim()
      : original.pendingReason !== pendingReason.value.trim());
  return !selectedWasSubmitted || amountChanged;
});
const amountValid = computed(() =>
  amountState.value === 'KNOWN'
    ? /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(amount.value.trim())
    : pendingReason.value.trim().length >= 1 &&
      pendingReason.value.trim().length <= 500,
);
const noteValid = computed(
  () =>
    !changedFacts.value ||
    (changeNote.value.trim().length >= 1 &&
      changeNote.value.trim().length <= 500),
);
const readyToReview = computed(
  () =>
    canConfirm.value &&
    selectedVersionId.value.length > 0 &&
    amountValid.value &&
    noteValid.value &&
    confirmDisclose.value !== null &&
    !versionsLoading.value &&
    !confirmationSubmitting.value &&
    unknownRequest.value === null,
);

function uniqueVersions(materials: OwnerMaterial[]): ComplaintVersion[] {
  const byVersion = new Map<string, ComplaintVersion>();
  for (const material of materials) {
    if (material.category !== 'COMPLAINT' || material.status !== 'ACTIVE')
      continue;
    for (const version of material.contentVersions) {
      if (version.status !== 'AVAILABLE') continue;
      byVersion.set(version.id, {
        materialId: material.id,
        contentVersionId: version.id,
        originalFilename: version.originalFilename,
        mimeType: version.mimeType,
        createdAt: version.createdAt,
      });
    }
  }
  for (const file of originalFiles.value) {
    if (!byVersion.has(file.contentVersionId)) {
      byVersion.set(file.contentVersionId, {
        ...file,
        createdAt: '',
      });
    }
  }
  return [...byVersion.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function resetDraft(): void {
  const complaint = props.item.complaint;
  amountState.value = complaint?.amountState ?? 'KNOWN';
  amount.value = complaint?.amount ?? '';
  pendingReason.value = complaint?.pendingReason ?? '';
  selectedVersionId.value = '';
  changeNote.value = '';
  confirmDisclose.value = null;
  reviewVisible.value = false;
  unknownRequest.value = null;
  confirmationError.value = '';
  confirmationSuccess.value = '';
  downloadError.value = '';
}

async function loadVersions(revision: number): Promise<void> {
  versionsRequest?.abort();
  const controller = new AbortController();
  versionsRequest = controller;
  versions.value = [];
  versionsError.value = '';
  const shouldLoad =
    props.item.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
    props.item.stage === 'WAITING_COMPLAINT_STAMP';
  if (!shouldLoad) return;
  versionsLoading.value = true;
  try {
    const result = await listOwnerMaterials('CASE', props.item.id, {
      signal: controller.signal,
    });
    if (
      !mounted ||
      controller.signal.aborted ||
      revision !== contextRevision.value
    )
      return;
    versions.value = uniqueVersions(result.items);
    if (versions.value.length === 1)
      selectedVersionId.value = versions.value[0]!.contentVersionId;
  } catch {
    if (
      !mounted ||
      controller.signal.aborted ||
      revision !== contextRevision.value
    )
      return;
    versions.value = uniqueVersions([]);
    versionsError.value =
      '诉状版本暂时无法加载；原已提交版本仍可查看，修订版请重试加载。';
  } finally {
    if (mounted && revision === contextRevision.value)
      versionsLoading.value = false;
  }
}

watch(
  [requestScopeKey, factsKey],
  ([scope], [previousScope]) => {
    const preserveUnknownRequest =
      previousScope === scope &&
      unknownRequest.value !== null &&
      props.item.stage === 'WAITING_COMPLAINT_CONFIRMATION';
    contextRevision.value += 1;
    if (preserveUnknownRequest) {
      confirmationError.value = '';
      confirmationSuccess.value = '';
      downloadError.value = '';
    } else {
      resetDraft();
    }
    void loadVersions(contextRevision.value);
  },
  { immediate: true, flush: 'sync' },
);

function selectedFile(versionId: string): ComplaintVersion | undefined {
  return versions.value.find((entry) => entry.contentVersionId === versionId);
}

async function uploadRevisions(event: Event): Promise<void> {
  if (!canConfirm.value || unknownRequest.value || confirmationSubmitting.value)
    return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  uploadError.value = '';
  if (files.length === 0) return;
  uploadLoading.value = true;
  const revision = contextRevision.value;
  const caseId = props.item.id;
  const currentIdentity = identity.value;
  try {
    for (const file of files) {
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        file,
      });
      if (
        !mounted ||
        revision !== contextRevision.value ||
        props.item.id !== caseId ||
        identity.value !== currentIdentity
      )
        return;
      if (
        !versions.value.some(
          (entry) => entry.contentVersionId === result.contentVersionId,
        )
      ) {
        versions.value = [
          ...versions.value,
          {
            materialId: result.materialId,
            contentVersionId: result.contentVersionId,
            originalFilename: result.originalFilename,
            mimeType: result.mimeType,
            createdAt: new Date().toISOString(),
          },
        ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      }
      selectedVersionId.value = result.contentVersionId;
    }
  } catch (reason) {
    if (
      mounted &&
      revision === contextRevision.value &&
      props.item.id === caseId &&
      identity.value === currentIdentity
    ) {
      uploadError.value =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? '诉状仅支持不超过 50MB 的 PDF、DOC 或 DOCX 文件。'
          : '修订诉状上传失败，请检查后重试。';
    }
  } finally {
    if (mounted && revision === contextRevision.value)
      uploadLoading.value = false;
  }
}

async function download(file: CaseFile): Promise<void> {
  const revision = contextRevision.value;
  const caseId = props.item.id;
  const currentIdentity = identity.value;
  const isCurrent = () =>
    mounted &&
    revision === contextRevision.value &&
    props.item.id === caseId &&
    identity.value === currentIdentity;
  downloadError.value = '';
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch {
    if (isCurrent()) downloadError.value = '附件下载失败，请稍后重试。';
  }
}

function createRequest(): ConfirmCaseComplaintInput | null {
  if (!readyToReview.value) return null;
  return {
    expectedVersion: props.item.version,
    idempotencyKey: globalThis.crypto.randomUUID(),
    confirmedComplaintContentVersionId: selectedVersionId.value,
    amountState: amountState.value,
    amount: amountState.value === 'KNOWN' ? amount.value.trim() : null,
    pendingReason:
      amountState.value === 'PENDING' ? pendingReason.value.trim() : null,
    ...(changeNote.value.trim() ? { changeNote: changeNote.value.trim() } : {}),
    confirmDisclose: confirmDisclose.value!,
  };
}

function reviewConfirmation(): void {
  confirmationError.value = '';
  if (readyToReview.value) reviewVisible.value = true;
}

function isUnknownResult(reason: unknown): boolean {
  if (!(reason instanceof ApiError)) return true;
  return (
    reason.status >= 500 ||
    reason.code === 'NETWORK_ERROR' ||
    reason.code === 'TIMEOUT' ||
    reason.code === 'INVALID_RESPONSE'
  );
}

async function sendConfirmation(
  body: ConfirmCaseComplaintInput,
): Promise<void> {
  if (
    confirmationSubmitting.value ||
    props.item.stage !== 'WAITING_COMPLAINT_CONFIRMATION' ||
    !props.item.canConfirmComplaint
  )
    return;
  confirmationSubmitting.value = true;
  confirmationError.value = '';
  const revision = contextRevision.value;
  const caseId = props.item.id;
  const currentIdentity = identity.value;
  const isCurrent = () =>
    mounted &&
    revision === contextRevision.value &&
    props.item.id === caseId &&
    identity.value === currentIdentity;
  try {
    await confirmCaseComplaint(caseId, body);
    if (!isCurrent()) return;
    unknownRequest.value = null;
    reviewVisible.value = false;
    confirmationSuccess.value =
      '诉状已确认，案件进入诉状待盖章。原提交记录仍保留。';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent()) return;
    if (isUnknownResult(reason)) {
      unknownRequest.value = body;
      reviewVisible.value = false;
      confirmationError.value =
        '确认结果暂时未知；原表单和请求键已保留。请刷新案件核实，或使用同一请求键重试。';
    } else {
      confirmationError.value =
        reason instanceof ApiError && reason.code === 'IDEMPOTENCY_CONFLICT'
          ? '该请求键已用于不同的确认内容。案件详情已刷新，请核对后重新办理。'
          : '案件阶段、版本或权限已变化，请刷新案件核对最新状态。';
      reviewVisible.value = false;
      emit('refresh');
    }
  } finally {
    if (isCurrent()) confirmationSubmitting.value = false;
  }
}

function submitConfirmation(): void {
  const body = createRequest();
  if (body) void sendConfirmation(body);
}

function retryUnknownRequest(): void {
  const body = unknownRequest.value;
  if (body) void sendConfirmation(body);
}

function checkUnknownResult(): void {
  emit('refresh');
}

onBeforeUnmount(() => {
  mounted = false;
  contextRevision.value += 1;
  versionsRequest?.abort();
});
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="complaint-confirmation-panel"
  >
    <h2 class="form-section-title">
      {{
        item.stage === 'WAITING_COMPLAINT_STAMP' ? '诉状确认记录' : '确认诉状'
      }}
    </h2>

    <template v-if="item.stage === 'WAITING_COMPLAINT_CONFIRMATION'">
      <p class="field-help">
        当前流程：诉状待确认→诉状待盖章。确认后案件只推进到“诉状待盖章”；本次诉状版本和金额事实另行留存，原提交版本、金额和回执不会覆盖。请逐件使用下载入口核对文件。
      </p>
      <p v-if="!canConfirm" class="field-help">
        当前账号对此案只读，可以查看和逐件下载材料，不能确认或上传诉状。
      </p>
      <div
        v-if="canConfirm"
        class="demo-form-grid"
        data-test="confirmation-form"
      >
        <fieldset
          :disabled="
            unknownRequest !== null || confirmationSubmitting || uploadLoading
          "
        >
          <legend>确认诉状版本 <span aria-hidden="true">*</span></legend>
          <p v-if="versionsLoading" role="status">正在读取可用诉状版本…</p>
          <p v-else-if="versions.length === 0" class="field-help">
            尚无可用诉状版本，请先上传本案诉状。
          </p>
          <p v-else-if="versions.length > 1" class="field-help">
            请选择本次确认的诉状版本；系统不会替你默认选择。
          </p>
          <label
            v-for="version in versions"
            :key="version.contentVersionId"
            class="confirmation-version"
          >
            <input
              :data-test="`complaint-version-${version.contentVersionId}`"
              v-model="selectedVersionId"
              type="radio"
              name="confirmed-complaint-version"
              :value="version.contentVersionId"
              required
            />
            <span>
              {{ version.originalFilename }} · 版本 ID
              {{ version.contentVersionId }} ·
              {{
                version.createdAt
                  ? new Date(version.createdAt).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      hour12: false,
                    })
                  : '原提交版本'
              }}
            </span>
            <ElButton text @click.prevent="download(version)"
              >逐件下载</ElButton
            >
          </label>
          <p v-if="versionsError" class="submit-error" role="alert">
            {{ versionsError }}
          </p>
          <p
            v-if="downloadError"
            data-test="confirmation-download-error"
            class="submit-error"
            role="alert"
          >
            {{ downloadError }}
          </p>
          <label v-if="canConfirm" class="confirmation-upload">
            上传修订诉状
            <input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              :disabled="
                uploadLoading ||
                confirmationSubmitting ||
                unknownRequest !== null
              "
              data-test="complaint-revision-upload"
              @change="uploadRevisions"
            />
          </label>
          <p v-if="uploadLoading" role="status">正在上传诉状…</p>
          <p v-if="uploadError" class="submit-error" role="alert">
            {{ uploadError }}
          </p>
        </fieldset>

        <fieldset
          :disabled="
            unknownRequest !== null || confirmationSubmitting || uploadLoading
          "
        >
          <legend>
            本次确认的标的额状态 <span aria-hidden="true">*</span>
          </legend>
          <label>
            <input v-model="amountState" type="radio" value="KNOWN" /> 已知金额
          </label>
          <label>
            <input v-model="amountState" type="radio" value="PENDING" />
            待确认金额
          </label>
          <label v-if="amountState === 'KNOWN'">
            金额 <span aria-hidden="true">*</span>
            <input
              v-model="amount"
              data-test="confirmation-amount"
              inputmode="decimal"
              class="text-input"
              :disabled="
                unknownRequest !== null ||
                confirmationSubmitting ||
                uploadLoading
              "
              required
            />
          </label>
          <label v-else>
            待确认原因 <span aria-hidden="true">*</span>
            <textarea
              v-model="pendingReason"
              data-test="pending-reason"
              class="text-input"
              maxlength="500"
              required
            />
          </label>
        </fieldset>

        <label v-if="changedFacts">
          版本或金额变更说明 <span aria-hidden="true">*</span>
          <textarea
            v-model="changeNote"
            data-test="change-note"
            class="text-input"
            maxlength="500"
            required
            :disabled="
              unknownRequest !== null || confirmationSubmitting || uploadLoading
            "
          />
        </label>
        <fieldset
          :disabled="
            unknownRequest !== null || confirmationSubmitting || uploadLoading
          "
        >
          <legend>
            本次是否需要下载诉状及授权书 <span aria-hidden="true">*</span>
          </legend>
          <label>
            <input
              v-model="confirmDisclose"
              data-test="confirm-disclose-true"
              type="radio"
              :value="true"
              required
            />
            需要下载
          </label>
          <label>
            <input
              v-model="confirmDisclose"
              data-test="confirm-disclose-false"
              type="radio"
              :value="false"
              required
            />
            暂不需要下载
          </label>
          <p class="field-help">
            此选择只记录下载需求，不表示附件已经下载或对外披露。
          </p>
        </fieldset>

        <p v-if="confirmationError" class="submit-error" role="alert">
          {{ confirmationError }}
        </p>
        <p v-if="confirmationSuccess" role="status">
          {{ confirmationSuccess }}
        </p>
        <div v-if="unknownRequest" class="confirmation-unknown">
          <ElButton
            text
            data-test="confirmation-check"
            @click="checkUnknownResult"
            >刷新核对结果</ElButton
          >
          <ElButton
            type="primary"
            data-test="confirmation-retry"
            :loading="confirmationSubmitting"
            @click="retryUnknownRequest"
            >使用原请求键重试</ElButton
          >
        </div>
        <ElButton
          v-else
          type="primary"
          data-test="confirmation-review"
          :disabled="!readyToReview || uploadLoading"
          @click="reviewConfirmation"
          >核对并确认本案</ElButton
        >
      </div>
      <div
        v-if="reviewVisible"
        class="confirmation-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-review-title"
      >
        <h3 id="confirmation-review-title">确认后进入诉状待盖章</h3>
        <p>
          本次选择、金额状态和说明将单独保存，原提交记录不会覆盖；确认仅推进本案，不代表材料已下载。
        </p>
        <ElButton text @click="reviewVisible = false">返回修改</ElButton>
        <ElButton
          type="primary"
          data-test="confirmation-submit"
          :loading="confirmationSubmitting"
          @click="submitConfirmation"
          >确认进入诉状待盖章</ElButton
        >
      </div>
    </template>

    <template v-else>
      <div
        v-if="item.complaintConfirmation"
        data-test="confirmed-complaint-record"
      >
        <p>
          确认时间：{{
            new Date(item.complaintConfirmation.confirmedAt).toLocaleString(
              'zh-CN',
              {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              },
            )
          }}
        </p>
        <p>
          确认金额：{{
            item.complaintConfirmation.amountState === 'PENDING'
              ? `待确认（${item.complaintConfirmation.pendingReason}）`
              : `¥ ${item.complaintConfirmation.amount}`
          }}
        </p>
        <p>
          需要下载：{{
            item.complaintConfirmation.confirmDisclose ? '是' : '否'
          }}
        </p>
        <p v-if="item.complaintConfirmation.changeNote">
          变更说明：{{ item.complaintConfirmation.changeNote }}
        </p>
        <div v-if="item.complaintConfirmation.complaintFile">
          <span>{{
            item.complaintConfirmation.complaintFile.originalFilename
          }}</span>
          <ElButton
            text
            data-test="confirmed-complaint-download"
            @click="download(item.complaintConfirmation!.complaintFile!)"
            >逐件下载确认版本</ElButton
          >
        </div>
        <p v-else class="field-help">
          确认版本元数据当前不可用；原提交诉状和授权书仍可逐件查看与下载。
        </p>
      </div>
      <p v-else class="field-help">当前案件尚无诉状确认记录。</p>
      <p v-if="downloadError" class="submit-error" role="alert">
        {{ downloadError }}
      </p>
      <p class="field-help">本阶段不提供邮寄或其他未实现的后续操作。</p>
    </template>
  </section>
</template>
