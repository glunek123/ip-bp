<script setup lang="ts">
import CaseExecutionMailingPanel from './CaseExecutionMailingPanel.vue';
import CaseExecutionFilingPanel from './CaseExecutionFilingPanel.vue';
import CaseExecutionFinishPanel from './CaseExecutionFinishPanel.vue';
import CaseClosurePanel from './CaseClosurePanel.vue';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  recordCaseClosure,
  caseClosureSession,
  type RecordCaseClosureInput,
  type CaseClosureResult,
  type CaseClosurePendingRequest,
  finishCaseExecution,
  executionFinishSession,
  type FinishCaseExecutionInput,
  type FinishCaseExecutionResult,
  getLawyerCase,
  submitComplaint,
  type CaseFile,
  type LawyerCaseDetail,
  type SubmitComplaintInput,
} from '../../api/cases';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import { useAuthStore } from '../../stores/auth';
import CaseComplaintConfirmationPanel from './CaseComplaintConfirmationPanel.vue';
import CaseComplaintMailingPanel from './CaseComplaintMailingPanel.vue';
import CaseComplaintSubmissionForm from './CaseComplaintSubmissionForm.vue';
import CaseFilingPanel from './CaseFilingPanel.vue';
import CaseAcceptancePanel from './CaseAcceptancePanel.vue';
import CaseHearingPanel from './CaseHearingPanel.vue';
import CaseJudgmentPanel from './CaseJudgmentPanel.vue';
import CaseJudgmentNextStepPanel from './CaseJudgmentNextStepPanel.vue';
import CaseSecondInstancePanel from './CaseSecondInstancePanel.vue';
import CaseExecutionSubmissionPanel from './CaseExecutionSubmissionPanel.vue';
import CaseExecutionConfirmationPanel from './CaseExecutionConfirmationPanel.vue';

const route = useRoute();
const auth = useAuthStore();
const id = computed(() => String(route.params.id));
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`,
);
const secondInstanceActorKey = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.department?.id ?? ''}`,
);
const item = ref<LawyerCaseDetail>();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const error = ref('');
const refreshError = ref('');
const uploadError = ref('');
const submitError = ref('');
const submitSuccess = ref('');
const submitting = ref(false);
const uploadBusy = ref<'COMPLAINT' | 'AUTHORIZATION' | null>(null);
const complaintUploads = ref<CaseFile[]>([]);
const authorizationUploads = ref<CaseFile[]>([]);
const amountState = ref<'KNOWN' | 'PENDING'>('KNOWN');
const amount = ref('');
const pendingReason = ref('');
let request: AbortController | undefined;
const downloads = new Set<AbortController>();
let contextRevision = 0;
let readRevision = 0;
let fingerprint = '';
let idempotencyKey = '';
let postSucceeded = false;

function abortDownloads(): void {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}

function clearContext(): void {
  item.value = undefined;
  state.value = 'loading';
  error.value = '';
  refreshError.value = '';
  uploadError.value = '';
  submitError.value = '';
  submitSuccess.value = '';
  submitting.value = false;
  uploadBusy.value = null;
  complaintUploads.value = [];
  authorizationUploads.value = [];
  amountState.value = 'KNOWN';
  amount.value = '';
  pendingReason.value = '';
  fingerprint = '';
  idempotencyKey = '';
  postSucceeded = false;
}

const finishSession = executionFinishSession(auth, () => identity.value);
const finishPending = computed(() => finishSession.pending(id.value));
const finishCallbacks = computed(() => {
  const caseId = item.value?.id ?? id.value;
  const contextKey = identity.value;
  const revision = contextRevision;
  const current = () =>
    caseId === id.value &&
    contextKey === identity.value &&
    revision === contextRevision;
  const denied = async (reason: unknown) => {
    if (
      current() &&
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      finishSession.clear();
      closureSession.clear();
      clearContext();
      await load();
    }
    throw reason;
  };
  return {
    pending: (input: FinishCaseExecutionInput | null) => {
      if (current()) finishSession.setPending(caseId, input);
    },
    submit: async (targetId: string, input: FinishCaseExecutionInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      // Store before transport as well as pending-change, without changing the original body.
      finishSession.setPending(caseId, input);
      try {
        return await finishCaseExecution(caseId, input, 'lawyer');
      } catch (reason) {
        return denied(reason);
      }
    },
    list: async (targetId: string): Promise<CaseFile[]> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      try {
        const materials = await listOwnerMaterials('CASE', caseId);
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return materials.items
          .filter(
            (material) =>
              material.status === 'ACTIVE' &&
              material.category === 'EXECUTION_FINISH_BASIS',
          )
          .flatMap((material) => {
            const version = material.contentVersions.find(
              (entry) => entry.id === material.currentVersionId,
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
      } catch (reason) {
        return denied(reason);
      }
    },
    upload: async (
      targetId: string,
      file: globalThis.File,
    ): Promise<CaseFile> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      try {
        const result = await uploadMaterialFile({
          ownerType: 'CASE',
          ownerId: caseId,
          category: 'EXECUTION_FINISH_BASIS',
          purpose: 'EXECUTION_FINISH_BASIS',
          file,
        });
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return {
          materialId: result.materialId,
          contentVersionId: result.contentVersionId,
          originalFilename: result.originalFilename,
          mimeType: result.mimeType,
        };
      } catch (reason) {
        return denied(reason);
      }
    },
    download: async (
      targetId: string,
      file: CaseFile,
      signal: globalThis.AbortSignal,
    ) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      try {
        return await downloadMaterialVersion(
          file.materialId,
          file.contentVersionId,
          signal,
        );
      } catch (reason) {
        return denied(reason);
      }
    },
    changed: (result: FinishCaseExecutionResult) => {
      if (!current() || result.id !== caseId) return;
      finishSession.setPending(caseId, null);
      if (finishSession.markChanged(result.finishId)) {
        notifyWorkflowChanged();
        void load();
      }
    },
    refresh: () => {
      if (current()) void load();
    },
  };
});

const closureSession = caseClosureSession(auth, () => identity.value);
const closurePending = computed(() => closureSession.pending(id.value));
const closureCallbacks = computed(() => {
  const caseId = item.value?.id ?? id.value;
  const contextKey = identity.value;
  const revision = contextRevision;
  const current = () =>
    caseId === id.value &&
    contextKey === identity.value &&
    revision === contextRevision;
  const denied = async (reason: unknown) => {
    if (
      current() &&
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      finishSession.clear();
      closureSession.clear();
      clearContext();
      await load();
    }
    throw reason;
  };
  return {
    pending: (input: CaseClosurePendingRequest | null) => {
      if (current()) closureSession.setPending(caseId, input);
    },
    record: async (targetId: string, input: RecordCaseClosureInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      closureSession.setPending(caseId, { command: 'RECORD', input });
      try {
        const result = await recordCaseClosure(caseId, input, 'lawyer');
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return result;
      } catch (reason) {
        return denied(reason);
      }
    },
    correct: async (): Promise<CaseClosureResult> => {
      throw new ApiError('律师不能更正结案资料', 403, 'ACTION_FORBIDDEN');
    },
    list: async (targetId: string): Promise<CaseFile[]> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      try {
        const materials = await listOwnerMaterials('CASE', caseId);
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return materials.items
          .filter(
            (material) =>
              material.status === 'ACTIVE' &&
              material.category === 'CASE_CLOSURE_DOCUMENT',
          )
          .flatMap((material) => {
            const version = material.contentVersions.find(
              (entry) => entry.id === material.currentVersionId,
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
      } catch (reason) {
        return denied(reason);
      }
    },
    upload: async (
      targetId: string,
      file: globalThis.File,
    ): Promise<CaseFile> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      try {
        const result = await uploadMaterialFile({
          ownerType: 'CASE',
          ownerId: caseId,
          category: 'CASE_CLOSURE_DOCUMENT',
          purpose: 'CASE_CLOSURE_DOCUMENT',
          file,
        });
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return {
          materialId: result.materialId,
          contentVersionId: result.contentVersionId,
          originalFilename: result.originalFilename,
          mimeType: result.mimeType,
        };
      } catch (reason) {
        return denied(reason);
      }
    },
    download: async (
      targetId: string,
      file: CaseFile,
      signal: globalThis.AbortSignal,
    ) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      try {
        return await downloadMaterialVersion(
          file.materialId,
          file.contentVersionId,
          signal,
        );
      } catch (reason) {
        return denied(reason);
      }
    },
    changed: (result: CaseClosureResult) => {
      if (!current() || result.id !== caseId) return;
      closureSession.setPending(caseId, null);
      if (closureSession.markChanged(result.closureVersionId)) {
        notifyWorkflowChanged();
        void load();
      }
    },
    refresh: () => {
      if (current()) void load();
    },
  };
});
async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const targetId = id.value;
  const targetIdentity = identity.value;
  const currentContext = contextRevision;
  const currentRead = ++readRevision;
  const preserve = state.value === 'ready' && item.value?.id === targetId;
  const current = () =>
    !controller.signal.aborted &&
    currentRead === readRevision &&
    currentContext === contextRevision &&
    targetId === id.value &&
    targetIdentity === identity.value;
  if (preserve) refreshError.value = '';
  else {
    state.value = 'loading';
    error.value = '';
  }
  try {
    const result = await getLawyerCase(targetId, { signal: controller.signal });
    if (!current()) return;
    item.value = result;
    if (result.stage === 'WAITING_COMPLAINT' && result.canSubmitComplaint) {
      const materialList = await listOwnerMaterials('CASE', result.id, {
        signal: controller.signal,
      });
      if (!current()) return;
      const existing = (category: 'COMPLAINT' | 'AUTHORIZATION'): CaseFile[] =>
        materialList.items
          .filter(
            (material) =>
              material.status === 'ACTIVE' &&
              material.category === category &&
              material.currentVersionId !== null,
          )
          .flatMap((material) => {
            const version = material.contentVersions.find(
              (candidate) => candidate.id === material.currentVersionId,
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
      complaintUploads.value = existing('COMPLAINT');
      authorizationUploads.value = existing('AUTHORIZATION');
    }
    state.value = 'ready';
    refreshError.value = '';
    if (result.stage !== 'WAITING_COMPLAINT') {
      postSucceeded = false;
      submitSuccess.value = '';
    }
  } catch (reason) {
    if (!current()) return;
    if (
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403 || reason.status === 404)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      request = undefined;
      abortDownloads();
      finishSession.clear();
      closureSession.clear();
      clearContext();
      state.value = reason.status === 404 ? 'missing' : 'failed';
      error.value =
        reason.status === 403
          ? '当前账号已不能读取该案件。'
          : '案件不存在或已不可访问。';
    } else if (preserve && item.value?.id === targetId) {
      state.value = 'ready';
      refreshError.value = postSucceeded
        ? '提交已成功；详情同步暂时失败。请刷新核实，页面已锁定重复提交。'
        : '详情读取失败，已保留当前案件与待核对请求；请重试。';
    } else {
      state.value = 'failed';
      error.value = '案件暂时无法读取，请刷新重试。';
    }
  } finally {
    if (current()) request = undefined;
  }
}

watch(
  [id, identity],
  ([caseId], [priorCaseId]) => {
    if (caseId !== priorCaseId && route.params.id !== undefined)
      closureSession.clear();
    contextRevision += 1;
    readRevision += 1;
    request?.abort();
    request = undefined;
    abortDownloads();
    clearContext();
    void load();
  },
  { flush: 'sync' },
);

async function upload(
  category: 'COMPLAINT' | 'AUTHORIZATION',
  event: globalThis.Event,
): Promise<void> {
  const input = event.target as globalThis.HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !item.value || uploadBusy.value) return;
  const targetId = item.value.id;
  const targetContext = contextRevision;
  uploadBusy.value = category;
  uploadError.value = '';
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'CASE',
      ownerId: targetId,
      category,
      purpose: category,
      file,
    });
    if (targetId !== id.value || targetContext !== contextRevision) return;
    const target =
      category === 'COMPLAINT' ? complaintUploads : authorizationUploads;
    target.value = [
      ...target.value.filter(
        (entry) => entry.contentVersionId !== uploaded.contentVersionId,
      ),
      {
        materialId: uploaded.materialId,
        contentVersionId: uploaded.contentVersionId,
        originalFilename: uploaded.originalFilename,
        mimeType: uploaded.mimeType,
      },
    ];
  } catch (reason) {
    if (targetId === id.value && targetContext === contextRevision)
      uploadError.value =
        reason instanceof ApiError ? reason.message : '上传失败，请重试。';
  } finally {
    if (targetId === id.value && targetContext === contextRevision)
      uploadBusy.value = null;
  }
}

function removeUpload(
  category: 'COMPLAINT' | 'AUTHORIZATION',
  index: number,
): void {
  const target =
    category === 'COMPLAINT' ? complaintUploads : authorizationUploads;
  target.value.splice(index, 1);
  fingerprint = '';
  idempotencyKey = '';
}

function makeKey(): string {
  return globalThis.crypto.randomUUID();
}
async function submit(): Promise<void> {
  const current = item.value;
  if (
    !current ||
    current.stage !== 'WAITING_COMPLAINT' ||
    !current.canSubmitComplaint ||
    submitting.value ||
    postSucceeded
  )
    return;
  submitError.value = '';
  if (
    complaintUploads.value.length === 0 ||
    authorizationUploads.value.length === 0
  ) {
    submitError.value = '请至少上传 1 份起诉状和 1 份授权材料。';
    return;
  }
  const input: SubmitComplaintInput = {
    expectedVersion: current.version,
    idempotencyKey: '',
    amountState: amountState.value,
    amount: amountState.value === 'KNOWN' ? amount.value : null,
    pendingReason:
      amountState.value === 'PENDING' ? pendingReason.value.trim() : null,
    complaintContentVersionIds: complaintUploads.value.map(
      (file) => file.contentVersionId,
    ),
    authorizationContentVersionIds: authorizationUploads.value.map(
      (file) => file.contentVersionId,
    ),
  };
  const nextFingerprint = JSON.stringify({
    ...input,
    idempotencyKey: undefined,
  });
  if (nextFingerprint !== fingerprint) {
    fingerprint = nextFingerprint;
    idempotencyKey = makeKey();
  }
  input.idempotencyKey = idempotencyKey;
  submitting.value = true;
  const targetId = current.id;
  const targetContext = contextRevision;
  try {
    await submitComplaint(targetId, input, 'lawyer');
    if (targetId !== id.value || targetContext !== contextRevision) return;
    postSucceeded = true;
    submitSuccess.value = '起诉材料已成功提交；正在同步服务端记录。';
    notifyWorkflowChanged();
    await load();
  } catch (reason) {
    if (targetId !== id.value || targetContext !== contextRevision) return;
    if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT')
      submitError.value = '案件状态已变化，请刷新后核对。';
    else if (reason instanceof ApiError && reason.status === 403)
      submitError.value = '当前账号已无权办理该案件。';
    else if (reason instanceof ApiError && reason.code === 'RESOURCE_NOT_FOUND')
      submitError.value = '案件不存在或已不可访问。';
    else if (
      reason instanceof ApiError &&
      (reason.code === 'NETWORK_ERROR' || reason.code === 'TIMEOUT')
    )
      submitError.value =
        '提交结果暂时未知；请求键和表单已保留，请安全重试或刷新核实。';
    else
      submitError.value =
        reason instanceof ApiError
          ? reason.message
          : '提交未能确认，请刷新案件核实后重试。';
  } finally {
    if (targetId === id.value && targetContext === contextRevision)
      submitting.value = false;
  }
}

async function download(file: CaseFile): Promise<void> {
  const controller = new AbortController();
  downloads.add(controller);
  const targetId = id.value;
  const targetIdentity = identity.value;
  const targetContext = contextRevision;
  try {
    await downloadMaterialVersion(
      file.materialId,
      file.contentVersionId,
      controller.signal,
    );
  } catch {
    if (
      !controller.signal.aborted &&
      targetContext === contextRevision &&
      targetId === id.value &&
      targetIdentity === identity.value
    )
      refreshError.value = '附件下载失败，请稍后重试。';
  } finally {
    downloads.delete(controller);
  }
}
function stageLabel(stage: string): string {
  return (
    (
      {
        PENDING_MATCH: '待匹配',
        WAITING_COMPLAINT: '待写诉状',
        WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
        WAITING_COMPLAINT_STAMP: '诉状待盖章',
        WAITING_FILING: '待提交立案',
        WAITING_FORMAL_ACCEPTANCE: '待正式立案',
        WAITING_HEARING: '待开庭',
        WAITING_JUDGMENT: '待判决',
        SECOND_INSTANCE: '二审',
        WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
        WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
        WAITING_EXECUTION_STAMP: '执行材料待盖章',
        WAITING_EXECUTION_FILING: '待申请执行',
        EXECUTING: '强制执行中',
        WAITING_ARCHIVE: '待归档',
      } as Record<string, string>
    )[stage] ?? stage
  );
}
onMounted(() => void load());
onBeforeUnmount(() => {
  contextRevision += 1;
  readRevision += 1;
  request?.abort();
  abortDownloads();
});
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <p><RouterLink to="/lawyer/cases">返回本人案件</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取案件</h1>
      </section>
      <section
        v-else-if="state === 'missing' || state === 'failed'"
        class="state-panel ledger-panel"
      >
        <h1>案件暂不可访问</h1>
        <p role="alert">{{ error }}</p>
        <RouterLink to="/lawyer/cases">返回本人案件</RouterLink>
      </section>
      <template v-else-if="item">
        <div class="page-head">
          <div>
            <p class="eyebrow">本人承办案件</p>
            <h1>{{ item.businessNo }}</h1>
            <p>
              {{ stageLabel(item.stage) }} · {{ item.customer.name }} ·
              {{ item.rightsHolder.name }}
            </p>
          </div>
          <ElButton text @click="load">刷新</ElButton>
        </div>
        <p v-if="refreshError" class="submit-error" role="alert">
          {{ refreshError }}
        </p>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">案件信息</h2>
          <p>权利人：{{ item.rightsHolder.name }}</p>
          <p>
            证书编号：{{ item.certificate.certificateNo }} ·
            {{ item.certificate.certificateDate }}
          </p>
          <p>实际匹配日期：{{ item.matchedOn ?? '未记录' }}</p>
          <h3>承办法官</h3>
          <ul>
            <li v-for="lawyer in item.lawyers" :key="lawyer.id">
              {{ lawyer.fullName }} · {{ lawyer.lawFirm ?? '律所未填写' }}
            </li>
          </ul>
          <h3>被告</h3>
          <ul>
            <li v-for="defendant in item.defendants" :key="defendant.id">
              {{ defendant.name }}
            </li>
          </ul>
          <h3>证书材料</h3>
          <ul>
            <li
              v-for="file in [
                ...item.certificate.files,
                ...item.certificate.disclosureFiles,
              ]"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}
              <ElButton text @click="download(file)">下载</ElButton>
            </li>
          </ul>
        </section>
        <CaseComplaintSubmissionForm
          v-if="item.stage === 'WAITING_COMPLAINT' && item.canSubmitComplaint"
          :complaint-files="complaintUploads"
          :authorization-files="authorizationUploads"
          v-model:amount-state="amountState"
          v-model:amount="amount"
          v-model:pending-reason="pendingReason"
          :upload-loading="{
            COMPLAINT: uploadBusy === 'COMPLAINT',
            AUTHORIZATION: uploadBusy === 'AUTHORIZATION',
          }"
          :upload-errors="{ COMPLAINT: uploadError, AUTHORIZATION: '' }"
          :error="submitError"
          :success="submitSuccess"
          :submitting="submitting"
          :locked="postSucceeded"
          @upload="upload"
          @download="download"
          @remove="removeUpload"
          @submit="submit"
        />
        <CaseComplaintConfirmationPanel
          v-if="
            item.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
            item.stage === 'WAITING_COMPLAINT_STAMP'
          "
          :item="item"
          :lawyer="true"
          @changed="load"
          @refresh="load"
        />
        <CaseComplaintMailingPanel
          v-if="
            item.stage === 'WAITING_COMPLAINT_STAMP' ||
            item.stage === 'WAITING_FILING'
          "
          :item="item"
          :lawyer="true"
          @changed="load"
          @refresh="load"
        />
        <CaseFilingPanel
          v-if="item.stage === 'WAITING_FILING'"
          :item="item"
          :lawyer="true"
          :context-key="identity"
          @changed="load"
          @refresh="load"
        />
        <CaseAcceptancePanel
          v-if="
            item.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
            item.stage === 'WAITING_HEARING'
          "
          :item="item"
          :lawyer="true"
          :context-key="identity"
          @changed="load"
          @refresh="load"
        />
        <CaseHearingPanel
          v-if="
            item.acceptance !== null &&
            (item.stage === 'WAITING_HEARING' ||
              item.stage === 'WAITING_JUDGMENT')
          "
          :item="item"
          :lawyer="true"
          :context-key="identity"
          @changed="load"
          @refresh="load"
        />
        <CaseJudgmentPanel
          v-if="
            item.stage === 'WAITING_JUDGMENT' ||
            (item.judgment !== undefined && item.judgment.current !== null)
          "
          :item="item"
          :lawyer="true"
          :context-key="identity"
          @changed="load"
          @refresh="load"
        />
        <CaseJudgmentNextStepPanel
          v-if="item.judgment !== undefined && item.judgment.current !== null"
          :item="item"
          :lawyer="true"
          :context-key="identity"
          @changed="load"
          @refresh="load"
        />
        <CaseSecondInstancePanel
          v-if="
            item.secondInstance.rounds.length > 0 ||
            item.canSaveSecondInstance ||
            item.canRegisterSecondInstanceResult
          "
          :item="item"
          :lawyer="true"
          :context-key="identity"
          :actor-key="secondInstanceActorKey"
          @changed="load"
          @refresh="load"
        />
        <CaseExecutionSubmissionPanel
          v-if="
            item.canSubmitExecution ||
            item.executionSubmission.submissions.length > 0
          "
          :item="item"
          :lawyer="true"
          :context-key="identity"
          :actor-key="secondInstanceActorKey"
          @changed="load"
          @refresh="load"
        />
        <CaseExecutionMailingPanel
          v-if="
            item.canMailExecution ||
            item.executionMailing ||
            item.stage === 'WAITING_EXECUTION_STAMP'
          "
          :item="item"
          :context-key="identity"
          lawyer
          @changed="load"
          @refresh="load"
        />
        <CaseExecutionFinishPanel
          v-if="
            item.canFinishExecution ||
            item.executionFinish ||
            finishPending ||
            item.stage === 'EXECUTING'
          "
          :item="item"
          :context-key="identity"
          :pending-request="finishPending"
          :submit-finish="finishCallbacks.submit"
          :list-basis-files="finishCallbacks.list"
          :upload-basis-file="finishCallbacks.upload"
          :download-basis-file="finishCallbacks.download"
          @pending-change="finishCallbacks.pending"
          @changed="finishCallbacks.changed"
          @refresh="finishCallbacks.refresh"
        />
        <CaseClosurePanel
          v-if="
            item.stage === 'WAITING_ARCHIVE' || item.closure || closurePending
          "
          :item="item"
          :context-key="identity"
          lawyer
          :pending-request="closurePending"
          :record-closure="closureCallbacks.record"
          :correct-closure="closureCallbacks.correct"
          :list-closure-files="closureCallbacks.list"
          :upload-closure-file="closureCallbacks.upload"
          :download-closure-file="closureCallbacks.download"
          @pending-change="closureCallbacks.pending"
          @changed="closureCallbacks.changed"
          @refresh="closureCallbacks.refresh"
        />

        <CaseExecutionFilingPanel
          v-if="
            item.canSubmitExecutionFiling ||
            item.executionFiling ||
            item.stage === 'WAITING_EXECUTION_FILING'
          "
          :item="item"
          :context-key="identity"
          lawyer
          @changed="load"
          @refresh="load"
        />
        <CaseExecutionConfirmationPanel
          v-if="
            item.canConfirmExecution ||
            item.executionConfirmation ||
            item.stage === 'WAITING_EXECUTION_STAMP'
          "
          :item="item"
          :lawyer="true"
          :context-key="identity"
          :actor-key="secondInstanceActorKey"
          @changed="load"
          @refresh="load"
        />
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">案件信息</h2>
          <p data-test="court-case-no">
            法院案号：{{ item.courtCaseNo ?? '未登记' }}
          </p>
        </section>
        <section v-if="item.complaint" class="demo-card demo-card--pad">
          <h2 class="form-section-title">起诉材料记录</h2>
          <ul>
            <li
              v-for="file in [
                ...item.complaint.complaintFiles,
                ...item.complaint.authorizationFiles,
              ]"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}
              <ElButton text @click="download(file)">下载</ElButton>
            </li>
          </ul>
        </section>
        <section v-if="item.complaintMailing" class="demo-card demo-card--pad">
          <h2 class="form-section-title">邮寄记录</h2>
          <p>邮寄日期：{{ item.complaintMailing.mailedAt }}</p>
          <ul>
            <li
              v-for="file in item.complaintMailing.receiptFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}
              <ElButton text @click="download(file)">下载</ElButton>
            </li>
          </ul>
        </section>
        <section v-if="item.filingSubmission" class="demo-card demo-card--pad">
          <h2 class="form-section-title">立案提交记录</h2>
          <p>
            {{ item.filingSubmission.court.name }} ·
            {{ item.filingSubmission.submittedAt }}
          </p>
          <p>诉调号：{{ item.filingSubmission.mediationNo ?? '未填写' }}</p>
          <ul>
            <li
              v-for="file in [
                ...item.filingSubmission.evidenceFiles,
                ...item.filingSubmission.screenshotFiles,
              ]"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}
              <ElButton text @click="download(file)">下载</ElButton>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>
