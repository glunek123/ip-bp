<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCase,
  matchCase,
  submitComplaint,
  todayShanghai,
  type CaseFile,
  type CaseDetail,
  type MatchCaseInput,
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
const lawyer = ref({ fullName: '', lawFirm: '', phone: '' });
const matchedOn = ref(todayShanghai());
let submissionFingerprint = '';
let idempotencyKey = '';
let request: AbortController | undefined;
let contextRevision = 0;
let readRevision = 0;

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
  lawyer.value = { fullName: '', lawFirm: '', phone: '' };
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
  return '诉状待盖章';
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
  if (!lawyer.value.fullName.trim()) {
    matchError.value = '请填写主办律师姓名。';
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
    lawyer: { ...lawyer.value },
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
        <p v-if="complaintSuccess" role="status">{{ complaintSuccess }}</p>
        <CaseComplaintConfirmationPanel
          v-if="
            item.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
            item.stage === 'WAITING_COMPLAINT_STAMP'
          "
          :item="item"
          @changed="load"
          @refresh="load"
        />
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
            <h3>主办律师</h3>
            <label
              >律师姓名 <span aria-hidden="true">*</span
              ><input
                v-model="lawyer.fullName"
                class="text-input"
                required
                :aria-required="true"
            /></label>
            <label
              >律师事务所（选填）<input
                v-model="lawyer.lawFirm"
                class="text-input"
            /></label>
            <label
              >电话（选填）<input v-model="lawyer.phone" class="text-input"
            /></label>
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
        <section
          v-if="item.stage === 'WAITING_COMPLAINT' && item.canSubmitComplaint"
          class="demo-card demo-card--pad"
          data-test="complaint-submit-form"
        >
          <h2 class="form-section-title">提交起诉材料</h2>
          <p class="field-help">
            上传材料与确认提交是两个独立动作。上传不会推进案件；确认后将固定本次选择的文件版本并进入“诉状待确认”。
          </p>
          <div class="demo-form-grid">
            <label>
              起诉状 <span aria-hidden="true">*</span>
              <input
                type="file"
                class="text-input"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                :disabled="
                  uploadLoading.COMPLAINT || complaintUploads.length >= 10
                "
                @change="uploadComplaintFiles('COMPLAINT', $event)"
              />
            </label>
            <p class="field-help">
              PDF、DOC 或 DOCX，单份不超过 50MB；1～10 份。
            </p>
            <p v-if="uploadLoading.COMPLAINT" role="status">正在上传起诉状…</p>
            <p v-if="uploadErrors.COMPLAINT" class="submit-error" role="alert">
              {{ uploadErrors.COMPLAINT }}
            </p>
            <ul>
              <li
                v-for="(file, index) in complaintUploads"
                :key="file.contentVersionId"
              >
                {{ file.originalFilename }}（{{ file.mimeType }}）
                <ElButton
                  text
                  @click="download(file.materialId, file.contentVersionId)"
                  >下载</ElButton
                >
                <ElButton text @click="complaintUploads.splice(index, 1)"
                  >从本次提交移除</ElButton
                >
              </li>
            </ul>
          </div>
          <div class="demo-form-grid">
            <label>
              授权材料 <span aria-hidden="true">*</span>
              <input
                type="file"
                class="text-input"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                :disabled="
                  uploadLoading.AUTHORIZATION ||
                  authorizationUploads.length >= 10
                "
                @change="uploadComplaintFiles('AUTHORIZATION', $event)"
              />
            </label>
            <p class="field-help">
              PDF、DOC 或 DOCX，单份不超过 50MB；1～10 份。
            </p>
            <p v-if="uploadLoading.AUTHORIZATION" role="status">
              正在上传授权材料…
            </p>
            <p
              v-if="uploadErrors.AUTHORIZATION"
              class="submit-error"
              role="alert"
            >
              {{ uploadErrors.AUTHORIZATION }}
            </p>
            <ul>
              <li
                v-for="(file, index) in authorizationUploads"
                :key="file.contentVersionId"
              >
                {{ file.originalFilename }}（{{ file.mimeType }}）
                <ElButton
                  text
                  @click="download(file.materialId, file.contentVersionId)"
                  >下载</ElButton
                >
                <ElButton text @click="authorizationUploads.splice(index, 1)"
                  >从本次提交移除</ElButton
                >
              </li>
            </ul>
          </div>
          <fieldset class="demo-form-grid">
            <legend>标的额 <span aria-hidden="true">*</span></legend>
            <label>
              <input v-model="amountState" type="radio" value="KNOWN" />
              已知金额
            </label>
            <label>
              <input v-model="amountState" type="radio" value="PENDING" />
              待确认金额
            </label>
            <label v-if="amountState === 'KNOWN'">
              金额（非负精确金额）<span aria-hidden="true">*</span>
              <input
                v-model="amount"
                inputmode="decimal"
                class="text-input"
                required
              />
            </label>
            <label v-else>
              待确认原因 <span aria-hidden="true">*</span>
              <textarea v-model="pendingReason" class="text-input" required />
            </label>
          </fieldset>
          <p v-if="complaintError" class="submit-error" role="alert">
            {{ complaintError }}
          </p>
          <ElButton
            type="primary"
            :loading="complaintSubmitting"
            :disabled="
              complaintSubmitting ||
              uploadLoading.COMPLAINT ||
              uploadLoading.AUTHORIZATION
            "
            data-test="submit-complaint"
            @click="submitComplaintMaterials"
            >确认提交起诉材料</ElButton
          >
        </section>
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
