<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCase,
  matchCase,
  listLawyerMatchCandidates,
  submitComplaint,
  todayShanghai,
  type CaseFile,
  type CaseDetail,
  type MatchCaseInput,
  type LawyerMatchCandidate,
} from '../../api/cases';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type MaterialCategory,
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
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const backTo = computed(() => ({ path: '/cases', query: route.query }));
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const refreshing = ref(false);
const refreshError = ref('');
const item = ref<CaseDetail>();
const error = ref('');
const downloadError = ref('');
const matchError = ref('');
const matchSuccess = ref('');
const submitting = ref(false);
const complaintUploads = ref<CaseFile[]>([]);
const authorizationUploads = ref<CaseFile[]>([]);
const amountState = ref<'KNOWN' | 'PENDING'>('KNOWN');
const amount = ref('');
const pendingReason = ref('');
const uploadErrors = ref<Record<string, string>>({});
const uploadLoading = ref<Record<string, boolean>>({});
const complaintError = ref('');
const complaintSuccess = ref('');
const complaintSubmitting = ref(false);
let complaintFingerprint = '';
let complaintIdempotencyKey = '';
type DefendantDraft = {
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string;
  phone: string;
  address: string;
};
const defendants = ref<DefendantDraft[]>([
  { kind: 'PERSON', name: '', idNo: '', phone: '', address: '' },
]);
const lawyerQuery = ref('');
const lawyerCandidates = ref<LawyerMatchCandidate[]>([]);
const selectedLawyer = ref<LawyerMatchCandidate>();
const lawyerCandidatesLoading = ref(false);
const lawyerCandidatesError = ref('');
const matchedOn = ref(todayShanghai());
let submissionFingerprint = '';
let idempotencyKey = '';
let request: AbortController | undefined;
let contextRevision = 0;
let readRevision = 0;
let candidateRequest: AbortController | undefined;

type OperationContext = {
  caseId: string;
  identity: string;
  revision: number;
};

function operationContext(): OperationContext {
  return {
    caseId: id.value,
    identity: identity.value,
    revision: contextRevision,
  };
}

function isCurrentOperation(context: OperationContext): boolean {
  return (
    context.revision === contextRevision &&
    context.caseId === id.value &&
    context.identity === identity.value
  );
}

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const targetId = id.value;
  const targetIdentity = identity.value;
  const targetContextRevision = contextRevision;
  const thisReadRevision = ++readRevision;
  const preserveCurrent =
    state.value === 'ready' && item.value?.id === targetId;
  const isCurrentRead = () =>
    !controller.signal.aborted &&
    thisReadRevision === readRevision &&
    targetContextRevision === contextRevision &&
    targetId === id.value &&
    targetIdentity === identity.value;
  if (preserveCurrent) {
    refreshing.value = true;
    refreshError.value = '';
  } else {
    state.value = 'loading';
    error.value = '';
    refreshError.value = '';
  }
  try {
    const result = await getCase(targetId, { signal: controller.signal });
    if (!isCurrentRead()) return;
    item.value = result;
    if (result.stage === 'WAITING_COMPLAINT' && result.canSubmitComplaint) {
      const materials = await listOwnerMaterials('CASE', result.id, {
        signal: controller.signal,
      });
      if (!isCurrentRead()) return;
      complaintUploads.value = materials.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.currentVersionId !== null &&
            material.category === 'COMPLAINT',
        )
        .flatMap((material) => {
          const version = material.contentVersions.find(
            (entry) => entry.id === material.currentVersionId,
          );
          if (!version) return [];
          const file = {
            materialId: material.id,
            contentVersionId: version.id,
            originalFilename: version.originalFilename,
            mimeType: version.mimeType,
          };
          return material.category === 'COMPLAINT' ? [file] : [];
        });
      authorizationUploads.value = materials.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.currentVersionId !== null &&
            material.category === 'AUTHORIZATION',
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
    }
    state.value = 'ready';
    refreshError.value = '';
  } catch (reason) {
    if (!isCurrentRead()) return;
    if (
      reason instanceof ApiError &&
      (reason.status === 403 || reason.status === 404)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      request = undefined;
      clearContext();
      state.value = reason.status === 404 ? 'missing' : 'failed';
      error.value =
        reason.status === 403
          ? '当前账号无权读取该案件。'
          : '案件不存在或已不可访问。';
      return;
    }
    if (preserveCurrent && item.value?.id === targetId) {
      state.value = 'ready';
      refreshError.value = '详情读取失败，已保留当前案件与待核对请求；请重试。';
      return;
    }
    state.value =
      reason instanceof ApiError && reason.status === 404
        ? 'missing'
        : 'failed';
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取该案件。'
        : '案件暂时无法读取，请刷新重试。';
  } finally {
    if (isCurrentRead()) {
      refreshing.value = false;
      request = undefined;
    }
  }
}

function clearContext(): void {
  item.value = undefined;
  state.value = 'loading';
  refreshing.value = false;
  refreshError.value = '';
  error.value = '';
  downloadError.value = '';
  matchError.value = '';
  matchSuccess.value = '';
  submitting.value = false;
  complaintUploads.value = [];
  authorizationUploads.value = [];
  amountState.value = 'KNOWN';
  amount.value = '';
  pendingReason.value = '';
  uploadErrors.value = {};
  uploadLoading.value = {};
  complaintError.value = '';
  complaintSuccess.value = '';
  complaintSubmitting.value = false;
  complaintFingerprint = '';
  complaintIdempotencyKey = '';
  defendants.value = [
    { kind: 'PERSON', name: '', idNo: '', phone: '', address: '' },
  ];
  lawyerQuery.value = '';
  lawyerCandidates.value = [];
  selectedLawyer.value = undefined;
  lawyerCandidatesError.value = '';
  matchedOn.value = todayShanghai();
  submissionFingerprint = '';
  idempotencyKey = '';
}

watch(
  [id, identity],
  () => {
    contextRevision += 1;
    readRevision += 1;
    request?.abort();
    request = undefined;
    clearContext();
    void load();
  },
  { flush: 'sync' },
);

watch(
  [id, lawyerQuery, () => item.value?.stage, () => item.value?.canMatch],
  async ([caseId], _previous, onCleanup) => {
    candidateRequest?.abort();
    const controller = new AbortController();
    candidateRequest = controller;
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    lawyerCandidates.value = [];
    selectedLawyer.value = undefined;
    lawyerCandidatesError.value = '';
    if (
      !caseId ||
      item.value?.stage !== 'PENDING_MATCH' ||
      !item.value.canMatch
    )
      return;
    lawyerCandidatesLoading.value = true;
    try {
      const candidates = await listLawyerMatchCandidates(
        caseId,
        lawyerQuery.value,
        { signal: controller.signal },
      );
      if (!current || controller.signal.aborted) return;
      lawyerCandidates.value = candidates;
      if (candidates.length === 1) selectedLawyer.value = candidates[0];
    } catch (reason) {
      if (current && !controller.signal.aborted)
        lawyerCandidatesError.value =
          reason instanceof ApiError && reason.status === 403
            ? '当前账号无权读取该案的律师账号。'
            : '律师账号候选暂时无法加载。';
    } finally {
      if (current) lawyerCandidatesLoading.value = false;
    }
  },
  { flush: 'post' },
);
function addDefendant() {
  if (defendants.value.length >= 20) return;
  defendants.value.push({
    kind: 'PERSON',
    name: '',
    idNo: '',
    phone: '',
    address: '',
  });
}
function stageLabel(stage: CaseDetail['stage']): string {
  if (stage === 'PENDING_MATCH') return '待匹配';
  if (stage === 'WAITING_COMPLAINT') return '待写诉状';
  if (stage === 'WAITING_COMPLAINT_CONFIRMATION') return '诉状待确认';
  if (stage === 'WAITING_COMPLAINT_STAMP') return '诉状待盖章';
  if (stage === 'WAITING_FILING') return '待提交立案';
  return '待正式立案';
}
function removeDefendant(index: number) {
  if (defendants.value.length > 1) defendants.value.splice(index, 1);
}
function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function uploadComplaintFiles(
  category: Extract<MaterialCategory, 'COMPLAINT' | 'AUTHORIZATION'>,
  event: unknown,
) {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('target' in event) ||
    !(event.target instanceof globalThis.HTMLInputElement)
  ) {
    return;
  }
  const input = event.target;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const uploads =
    category === 'COMPLAINT' ? complaintUploads : authorizationUploads;
  const label = category === 'COMPLAINT' ? '起诉状' : '授权材料';
  uploadErrors.value = { ...uploadErrors.value, [category]: '' };
  complaintError.value = '';
  if (uploads.value.length + files.length > 10) {
    uploadErrors.value[category] = `${label}最多上传 10 份。`;
    return;
  }
  uploadLoading.value = { ...uploadLoading.value, [category]: true };
  const context = operationContext();
  for (const file of files) {
    try {
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.caseId,
        category,
        purpose: category,
        file,
      });
      if (!isCurrentOperation(context)) return;
      uploads.value.push({
        materialId: result.materialId,
        contentVersionId: result.contentVersionId,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
      });
      complaintFingerprint = '';
    } catch (reason) {
      if (!isCurrentOperation(context)) return;
      uploadErrors.value[category] =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? `${label}格式不支持或超过 50MB。`
          : `${label}上传未完成，请检查连接后重试。`;
      break;
    }
  }
  if (isCurrentOperation(context))
    uploadLoading.value = { ...uploadLoading.value, [category]: false };
}
function downloadComplaintFile(file: CaseFile): void {
  void download(file.materialId, file.contentVersionId);
}
function removeComplaintUpload(
  category: 'COMPLAINT' | 'AUTHORIZATION',
  index: number,
): void {
  const uploads =
    category === 'COMPLAINT' ? complaintUploads : authorizationUploads;
  uploads.value.splice(index, 1);
  complaintFingerprint = '';
  complaintIdempotencyKey = '';
}
function complaintErrorMessage(reason: unknown): string {
  if (
    reason instanceof ApiError &&
    (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
  ) {
    return '案件阶段或版本已变化，正在读取最新信息。';
  }
  if (
    reason instanceof ApiError &&
    (reason.code === 'NETWORK_ERROR' || reason.code === 'TIMEOUT')
  ) {
    return '提交结果暂时未知；表单和请求键已保留，可安全重试或刷新核实。';
  }
  if (reason instanceof ApiError && reason.code === 'IDEMPOTENCY_CONFLICT') {
    complaintIdempotencyKey = '';
    complaintFingerprint = '';
    return '请求键已用于不同的起诉材料，请刷新案件后重新提交。';
  }
  if (reason instanceof ApiError && reason.status === 403) {
    return '当前账号无权办理此案件。';
  }
  return '起诉材料提交未能完成，请检查信息后重试。';
}
async function submitComplaintMaterials() {
  const current = item.value;
  if (
    !current ||
    current.stage !== 'WAITING_COMPLAINT' ||
    !current.canSubmitComplaint ||
    complaintSubmitting.value
  )
    return;
  complaintError.value = '';
  complaintSuccess.value = '';
  if (
    complaintUploads.value.length < 1 ||
    authorizationUploads.value.length < 1
  ) {
    complaintError.value = '请至少上传 1 份起诉状和 1 份授权材料。';
    return;
  }
  const trimmedAmount = amount.value.trim();
  const trimmedReason = pendingReason.value.trim();
  if (
    amountState.value === 'KNOWN'
      ? !/^\d+(\.\d+)?$/u.test(trimmedAmount)
      : !trimmedReason
  ) {
    complaintError.value =
      amountState.value === 'KNOWN'
        ? '请输入非负精确金额。'
        : '请填写待确认原因。';
    return;
  }
  const input = {
    expectedVersion: current.version,
    idempotencyKey: '',
    amountState: amountState.value,
    amount: amountState.value === 'KNOWN' ? trimmedAmount : null,
    pendingReason: amountState.value === 'PENDING' ? trimmedReason : null,
    complaintContentVersionIds: complaintUploads.value.map(
      (file) => file.contentVersionId,
    ),
    authorizationContentVersionIds: authorizationUploads.value.map(
      (file) => file.contentVersionId,
    ),
  } as const;
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== complaintFingerprint) {
    complaintFingerprint = fingerprint;
    complaintIdempotencyKey = makeKey();
  }
  complaintSubmitting.value = true;
  const context = operationContext();
  try {
    await submitComplaint(current.id, {
      ...input,
      idempotencyKey: complaintIdempotencyKey,
    });
    if (!isCurrentOperation(context)) return;
    const fresh = await getCase(current.id);
    if (!isCurrentOperation(context)) return;
    item.value = fresh;
    if (fresh.stage === 'WAITING_COMPLAINT_CONFIRMATION' && fresh.complaint) {
      complaintSuccess.value = '起诉材料已确认提交，当前阶段为诉状待确认。';
      complaintFingerprint = '';
      complaintIdempotencyKey = '';
      notifyWorkflowChanged();
    } else {
      complaintError.value =
        '请求已提交，但尚未能从案件详情确认结果；请刷新核实。';
    }
  } catch (reason) {
    if (!isCurrentOperation(context)) return;
    complaintError.value = complaintErrorMessage(reason);
    if (
      reason instanceof ApiError &&
      (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
    ) {
      try {
        const fresh = await getCase(current.id);
        if (isCurrentOperation(context)) item.value = fresh;
      } catch {
        /* retain the last confirmed detail */
      }
      complaintFingerprint = '';
      complaintIdempotencyKey = '';
    }
  } finally {
    if (isCurrentOperation(context)) complaintSubmitting.value = false;
  }
}
async function submitMatch() {
  const current = item.value;
  if (
    !current ||
    current.stage !== 'PENDING_MATCH' ||
    !current.canMatch ||
    submitting.value
  )
    return;
  matchError.value = '';
  matchSuccess.value = '';
  if (defendants.value.some(({ name }) => !name.trim())) {
    matchError.value = '请填写每位被告的名称。';
    return;
  }
  if (!selectedLawyer.value) {
    matchError.value =
      '请选择已创建的律师账号；没有候选时请联系有权限的管理员创建账号。';
    return;
  }
  if (!matchedOn.value || matchedOn.value > todayShanghai()) {
    matchError.value = '请选择真实的实际匹配日期，不能晚于今天。';
    return;
  }
  const input: MatchCaseInput = {
    expectedVersion: current.version,
    idempotencyKey: '',
    matchedOn: matchedOn.value,
    defendants: defendants.value.map(
      ({ kind, name, idNo, phone, address }) => ({
        kind,
        name,
        idNo,
        phone,
        address,
      }),
    ),
    lawyerAccountId: selectedLawyer.value.lawyerAccountId,
    lawyerProfileId: selectedLawyer.value.lawyerProfileId,
  };
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== submissionFingerprint) {
    submissionFingerprint = fingerprint;
    idempotencyKey = makeKey();
  }
  input.idempotencyKey = idempotencyKey;
  submitting.value = true;
  const context = operationContext();
  try {
    await matchCase(current.id, input);
    if (!isCurrentOperation(context)) return;
    const fresh = await getCase(current.id);
    if (!isCurrentOperation(context)) return;
    item.value = fresh;
    if (
      fresh.stage === 'WAITING_COMPLAINT' &&
      fresh.matchedAt !== null &&
      fresh.matchedOn === matchedOn.value
    ) {
      matchSuccess.value = '案件匹配已完成，当前阶段为待写诉状。';
      submissionFingerprint = '';
      idempotencyKey = '';
      notifyWorkflowChanged();
    } else {
      matchError.value =
        '请求已提交，但尚未能从案件详情确认匹配结果；请刷新核实。';
    }
  } catch (reason) {
    if (!isCurrentOperation(context)) return;
    if (
      reason instanceof ApiError &&
      (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
    ) {
      matchError.value = '案件状态或版本已变化，正在读取最新信息。';
      try {
        const fresh = await getCase(current.id);
        if (isCurrentOperation(context)) item.value = fresh;
      } catch {
        /* Keep the confirmed prior detail visible. */
      }
      submissionFingerprint = '';
      idempotencyKey = '';
    } else if (
      reason instanceof ApiError &&
      (reason.status === 403 ||
        ['ACTION_FORBIDDEN', 'CASE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(
          reason.code,
        ))
    ) {
      matchError.value = '当前账号无权办理此案件。';
    } else if (
      reason instanceof ApiError &&
      ['RESOURCE_NOT_FOUND', 'NOT_FOUND'].includes(reason.code)
    ) {
      matchError.value = '案件不存在或当前账号不可访问。';
    } else if (
      reason instanceof ApiError &&
      reason.code === 'IDEMPOTENCY_CONFLICT'
    ) {
      matchError.value = '请求键已用于不同的匹配信息，请刷新案件后重新提交。';
      submissionFingerprint = '';
      idempotencyKey = '';
    } else if (
      reason instanceof ApiError &&
      reason.code === 'VALIDATION_ERROR'
    ) {
      matchError.value = '匹配信息未通过校验，请检查日期、必填项和字段长度。';
    } else if (
      reason instanceof ApiError &&
      (reason.code === 'NETWORK_ERROR' || reason.code === 'TIMEOUT')
    ) {
      matchError.value =
        '提交结果暂时未知；表单已保留，可安全重试或刷新详情核实。';
    } else {
      matchError.value = '案件匹配未能完成，请检查信息后重试。';
    }
  } finally {
    if (isCurrentOperation(context)) submitting.value = false;
  }
}
async function download(materialId: string, versionId: string) {
  const context = operationContext();
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId);
  } catch {
    if (isCurrentOperation(context))
      downloadError.value = '文件下载失败，请稍后重试。';
  }
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <p><RouterLink :to="backTo">返回案件列表</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取案件</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>案件不存在或已不可访问</h1>
        <p><RouterLink :to="backTo">返回案件列表</RouterLink></p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>案件暂时无法读取</h1>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="item">
        <div class="page-head">
          <div>
            <p class="eyebrow">案件详情</p>
            <h1>{{ item.businessNo }}</h1>
            <p>
              <span class="pill">{{ stageLabel(item.stage) }}</span>
              · 创建于
              {{
                new Date(item.createdAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  hour12: false,
                })
              }}
            </p>
          </div>
          <ElButton
            text
            data-test="case-refresh"
            :loading="refreshing"
            @click="load"
            >刷新</ElButton
          >
        </div>
        <p v-if="refreshing" role="status">正在刷新案件详情…</p>
        <p v-if="refreshError" class="submit-error" role="alert">
          {{ refreshError }}
        </p>
        <p v-if="matchSuccess" role="status">{{ matchSuccess }}</p>
        <CaseComplaintConfirmationPanel
          v-if="
            item.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
            item.stage === 'WAITING_COMPLAINT_STAMP'
          "
          :item="item"
          @changed="load"
          @refresh="load"
        />
        <CaseComplaintMailingPanel
          v-if="
            item.stage === 'WAITING_COMPLAINT_STAMP' ||
            item.stage === 'WAITING_FILING'
          "
          :item="item"
          @changed="load"
          @refresh="load"
        />
        <CaseFilingPanel
          v-if="item.stage === 'WAITING_FILING'"
          :item="item"
          :context-key="identity"
          @changed="load"
          @refresh="load"
        />
        <section
          v-if="item.filingSubmission"
          class="demo-card demo-card--pad"
          data-test="case-filing-record"
        >
          <h2 class="form-section-title">提交立案记录</h2>
          <p>法院：{{ item.filingSubmission.court.name }}</p>
          <p>实际提交日期：{{ item.filingSubmission.submittedAt }}</p>
          <p>诉调号：{{ item.filingSubmission.mediationNo ?? '未填写' }}</p>
          <p>
            系统登记时间：{{
              new Date(item.filingSubmission.recordedAt).toLocaleString(
                'zh-CN',
                { timeZone: 'Asia/Shanghai', hour12: false },
              )
            }}
          </p>
          <p>
            已确认金额：{{
              item.complaintConfirmation?.amountState === 'KNOWN'
                ? `¥ ${item.complaintConfirmation.amount}`
                : '待确认'
            }}（只读）
          </p>
          <h3>冻结的起诉及证据材料</h3>
          <ul>
            <li
              v-for="file in item.filingSubmission.evidenceFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}（{{ file.mimeType }}）
              <ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <h3>冻结的立案截图</h3>
          <ul>
            <li
              v-for="file in item.filingSubmission.screenshotFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}（{{ file.mimeType }}）
              <ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
        </section>
        <section
          v-if="item.stage === 'PENDING_MATCH' && item.canMatch"
          class="demo-card demo-card--pad"
          data-test="case-match-form"
        >
          <h2 class="form-section-title">匹配当事人与承办律师</h2>
          <p class="field-help">
            提交后将保存全部被告和主办律师，并把案件推进到“待写诉状”。上述信息与阶段变更会一并保存。
          </p>
          <div class="demo-form-grid">
            <label
              >实际匹配日期 <span aria-hidden="true">*</span
              ><input
                v-model="matchedOn"
                type="date"
                class="text-input"
                :max="todayShanghai()"
                required
                :aria-required="true"
            /></label>
            <p class="field-help">
              默认今天；补录时可改为真实的过去日期。系统会另记本次登记时间。
            </p>
          </div>
          <div
            v-for="(defendant, index) in defendants"
            :key="index"
            class="demo-form-grid"
          >
            <h3>被告 {{ index + 1 }}</h3>
            <label
              >主体类型
              <select v-model="defendant.kind" class="text-input">
                <option value="PERSON">自然人</option>
                <option value="ORGANIZATION">组织</option>
              </select></label
            >
            <label
              >名称 <span aria-hidden="true">*</span
              ><input
                v-model="defendant.name"
                class="text-input"
                required
                :aria-required="true"
            /></label>
            <label
              >身份证号（选填）<input
                v-model="defendant.idNo"
                class="text-input"
            /></label>
            <label
              >电话（选填）<input v-model="defendant.phone" class="text-input"
            /></label>
            <label
              >地址（选填）<input
                v-model="defendant.address"
                class="text-input"
            /></label>
            <ElButton
              v-if="defendants.length > 1"
              text
              @click="removeDefendant(index)"
              >移除此被告</ElButton
            >
          </div>
          <ElButton
            text
            :disabled="defendants.length >= 20"
            @click="addDefendant"
            >添加被告（最多 20 位）</ElButton
          >
          <div class="demo-form-grid">
            <h3>主办律师账号</h3>
            <label
              >按姓名或用户名搜索<input
                v-model="lawyerQuery"
                class="text-input"
                autocomplete="off"
            /></label>
            <label
              >账号 <span aria-hidden="true">*</span
              ><select
                v-model="selectedLawyer"
                class="text-input"
                :disabled="
                  lawyerCandidatesLoading || lawyerCandidates.length === 0
                "
              >
                <option :value="undefined">
                  {{
                    lawyerCandidatesLoading
                      ? '正在读取律师账号'
                      : '请选择姓名（用户名）'
                  }}
                </option>
                <option
                  v-for="candidate in lawyerCandidates"
                  :key="candidate.lawyerAccountId"
                  :value="candidate"
                >
                  {{ candidate.displayName }}（{{ candidate.username }}）
                </option>
              </select></label
            >
            <p v-if="lawyerCandidatesError" class="submit-error" role="alert">
              {{ lawyerCandidatesError }}
            </p>
            <p
              v-else-if="
                !lawyerCandidatesLoading && lawyerCandidates.length === 0
              "
              class="field-help"
            >
              没有有效律师账号候选。请联系有权限的管理员先创建律师账号。
            </p>
            <p v-else-if="lawyerCandidates.length === 1" class="field-help">
              已自动选择唯一候选账号。
            </p>
          </div>
          <p v-if="matchError" class="submit-error" role="alert">
            {{ matchError }}
          </p>
          <ElButton
            type="primary"
            :loading="submitting"
            :disabled="submitting"
            @click="submitMatch"
            >确认匹配并进入待写诉状</ElButton
          >
        </section>
        <section
          v-else-if="
            item.stage === 'PENDING_MATCH' ||
            (item.stage === 'WAITING_COMPLAINT' && !item.canSubmitComplaint)
          "
          class="demo-card demo-card--pad"
          data-test="case-read-only"
        >
          <h2 class="form-section-title">案件只读</h2>
          <p>
            你可以查看案件和下载获准材料；{{
              item.stage === 'PENDING_MATCH'
                ? '当前账号不能办理此案。'
                : item.stage === 'WAITING_COMPLAINT'
                  ? '匹配已完成；当前账号不能提交此案的起诉材料，可查看案件和下载获准附件。'
                  : '当前阶段为诉状待盖章；本切片只展示已保存事实。'
            }}
          </p>
        </section>
        <CaseComplaintSubmissionForm
          v-if="item.stage === 'WAITING_COMPLAINT' && item.canSubmitComplaint"
          :complaint-files="complaintUploads"
          :authorization-files="authorizationUploads"
          v-model:amount-state="amountState"
          v-model:amount="amount"
          v-model:pending-reason="pendingReason"
          :upload-loading="uploadLoading"
          :upload-errors="uploadErrors"
          :error="complaintError"
          :success="complaintSuccess"
          :submitting="complaintSubmitting"
          :locked="uploadLoading.COMPLAINT || uploadLoading.AUTHORIZATION"
          @upload="uploadComplaintFiles"
          @download="downloadComplaintFile"
          @remove="removeComplaintUpload"
          @submit="submitComplaintMaterials"
        />
        <section
          v-if="item.complaint"
          class="demo-card demo-card--pad"
          data-test="complaint-read-only"
        >
          <h2 class="form-section-title">已提交的起诉材料</h2>
          <p>
            标的额：{{
              item.complaint.amountState === 'PENDING'
                ? `待确认（${item.complaint.pendingReason}）`
                : `¥ ${item.complaint.amount}`
            }}
          </p>
          <p>
            提交时间：{{
              new Date(item.complaint.submittedAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })
            }}
          </p>
          <h3>起诉状</h3>
          <ul>
            <li
              v-for="file in item.complaint.complaintFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}（{{ file.mimeType }}）
              <ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <h3>授权材料</h3>
          <ul>
            <li
              v-for="file in item.complaint.authorizationFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}（{{ file.mimeType }}）
              <ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
        </section>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">来源与归属</h2>
          <p>部门：{{ item.department.name }}</p>
          <p>客户：{{ item.customer.name }}</p>
          <p>权利主体：{{ item.rightsHolder.name }}</p>
          <p>负责人：{{ item.owner.displayName }}</p>
          <p>来源线索：{{ item.sourceLead.businessNo }}</p>
          <p>来源公证事项：{{ item.sourceNotaryMatter.businessNo }}</p>
          <p>法院案号：未登记</p>
        </section>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">当事人与承办律师</h2>
          <p v-if="item.defendants.length === 0" class="field-help">
            尚未登记被告。
          </p>
          <ul v-else>
            <li v-for="defendant in item.defendants" :key="defendant.id">
              {{ defendant.kind === 'PERSON' ? '自然人' : '组织' }}：{{
                defendant.name
              }}
              <span v-if="defendant.idNo"> · 证件号 {{ defendant.idNo }}</span>
              <span v-if="defendant.phone"> · 电话 {{ defendant.phone }}</span>
              <span v-if="defendant.address">
                · 地址 {{ defendant.address }}</span
              >
            </li>
          </ul>
          <p v-if="item.lawyers.length === 0" class="field-help">
            尚未登记承办律师。
          </p>
          <ul v-else>
            <li v-for="entry in item.lawyers" :key="entry.id">
              {{ entry.fullName
              }}<span v-if="entry.lawFirm">（{{ entry.lawFirm }}）</span
              ><span v-if="entry.phone"> · 电话 {{ entry.phone }}</span>
            </li>
          </ul>
          <p v-if="item.matchedAt" class="field-help">
            实际匹配日期：{{ item.matchedOn ?? '未记录' }} · 系统登记时间：{{
              new Date(item.matchedAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })
            }}
          </p>
        </section>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">公证书</h2>
          <p>证书编号：{{ item.certificate.certificateNo }}</p>
          <p>出证日期：{{ item.certificate.certificateDate }}</p>
          <p>披露：{{ item.certificate.needDisclose ? '需要' : '不需要' }}</p>
          <ul>
            <li
              v-for="file in item.certificate.files"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <ul v-if="item.certificate.disclosureFiles.length">
            <li
              v-for="file in item.certificate.disclosureFiles"
              :key="file.contentVersionId"
            >
              披露材料：{{ file.originalFilename
              }}<ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="submit-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">来源费用（只读）</h2>
          <ul>
            <li
              v-for="(fee, index) in item.fees"
              :key="`${fee.category}-${fee.sourceId}-${index}`"
            >
              {{
                fee.category === 'NOTARY'
                  ? '公证费'
                  : fee.category === 'SAMPLE'
                    ? '样品费'
                    : fee.category === 'INVESTIGATION'
                      ? '调查费'
                      : '披露费'
              }}：{{
                fee.state === 'PENDING' ? '待确认' : `¥ ${fee.amount}`
              }}（来自{{
                fee.sourceType === 'NOTARY_MATTER_EVIDENCE'
                  ? '公证事项取证记录'
                  : '公证出证'
              }}）
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>
