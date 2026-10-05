<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
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

const route = useRoute();
const auth = useAuthStore();
const id = computed(() => String(route.params.id));
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
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
      (reason.status === 403 || reason.status === 404)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      request = undefined;
      abortDownloads();
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
  () => {
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
      } as Record<string, string>
    )[stage] ?? stage
  );
}
onMounted(() => void load());
onBeforeUnmount(() => {
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
