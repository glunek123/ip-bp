<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  createCustomerAgreement,
  getCustomerAgreement,
  listCustomerAgreementVersions,
  reviseCustomerAgreement,
  type AgreementValidityMode,
  type CustomerAgreementFile,
  type CustomerAgreementResponse,
  type CustomerAgreementVersion,
  type ReviseCustomerAgreementInput,
} from '../../api/customer-agreements-invoice';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type MaterialContentVersion,
} from '../../api/materials';
import {
  clearPendingCustomerAgreementUpload,
  clearPendingCustomerDocumentCommand,
  readPendingCustomerAgreementUpload,
  readPendingCustomerDocumentCommand,
  savePendingCustomerAgreementUpload,
  savePendingCustomerDocumentCommand,
  type PendingCustomerDocumentCommand,
} from './customer-agreements-invoice-pending';

type Actor = { userId: string; departmentId: string };
type AgreementForm = {
  title: string;
  model: string;
  settlementMethod: string;
  validityMode: AgreementValidityMode;
  effectiveFrom: string;
  effectiveTo: string;
  files: CustomerAgreementFile[];
};
type RecoveryFile = {
  materialId: string;
  version: MaterialContentVersion;
};

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  canRead: boolean;
  canEdit: boolean;
  actor: Actor | null;
  actorKey: string;
  blockedByOtherMaintenance: boolean;
}>();

const emit = defineEmits<{
  'document-state': [
    kind: 'agreement',
    customerId: string,
    actorKey: string,
    field: 'unknown' | 'stale' | 'uploadUnknown',
    value: boolean,
  ];
  'version-updated': [customerId: string, actorKey: string, version: number];
  'refresh-requested': [customerId: string, actorKey: string];
  unavailable: [customerId: string, actorKey: string];
}>();

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const data = ref<CustomerAgreementResponse>();
const form = ref<AgreementForm>(emptyForm());
const editing = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const status = ref<'idle' | 'unknown' | 'conflict' | 'refresh-needed'>('idle');
const message = ref('');
const uploadUnknown = ref(false);
const recoveryFiles = ref<RecoveryFile[]>([]);
const recoveryLoading = ref(false);
const verifiedRecoveryFiles = ref(new Set<string>());
const history = ref<CustomerAgreementVersion[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);
const historyLoading = ref(false);
const historyOpen = ref(false);
const versionCount = 20;
let generation = 0;
let pending: PendingCustomerDocumentCommand | undefined;

function emptyForm(): AgreementForm {
  return {
    title: '',
    model: '',
    settlementMethod: '',
    validityMode: 'UNKNOWN',
    effectiveFrom: '',
    effectiveTo: '',
    files: [],
  };
}

const hasAgreement = computed(
  () => data.value?.agreement !== null && data.value?.agreement !== undefined,
);
const canSubmit = computed(
  () =>
    props.canRead &&
    props.canEdit &&
    data.value?.canEdit === true &&
    !props.blockedByOtherMaintenance &&
    !submitting.value &&
    !uploading.value &&
    status.value !== 'refresh-needed',
);
const canCancel = computed(
  () =>
    !props.blockedByOtherMaintenance &&
    status.value !== 'unknown' &&
    status.value !== 'refresh-needed' &&
    !submitting.value &&
    !uploading.value,
);

function identity() {
  if (!props.actor) return undefined;
  return {
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customerId,
    kind: 'agreement' as const,
  };
}

function uploadIdentity() {
  if (!props.actor) return undefined;
  return {
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customerId,
  };
}

function current(
  requestGeneration: number,
  customerId: string,
  actorKey: string,
): boolean {
  return (
    requestGeneration === generation &&
    customerId === props.customerId &&
    actorKey === props.actorKey
  );
}

function setField(
  field: 'unknown' | 'stale' | 'uploadUnknown',
  value: boolean,
): void {
  emit(
    'document-state',
    'agreement',
    props.customerId,
    props.actorKey,
    field,
    value,
  );
}

function clearSensitiveProjection(): void {
  data.value = undefined;
  history.value = [];
  historyTotal.value = 0;
  historyOpen.value = false;
  recoveryFiles.value = [];
  verifiedRecoveryFiles.value.clear();
  form.value = emptyForm();
  editing.value = false;
  message.value = '';
}

function formFromVersion(version?: CustomerAgreementVersion): AgreementForm {
  return {
    title: version?.title ?? '',
    model: version?.model ?? '',
    settlementMethod: version?.settlementMethod ?? '',
    validityMode: version?.validityMode ?? 'UNKNOWN',
    effectiveFrom: version?.effectiveFrom ?? '',
    effectiveTo: version?.effectiveTo ?? '',
    files: version?.files.map((file) => ({ ...file })) ?? [],
  };
}

function restorePending(): void {
  pending = undefined;
  uploadUnknown.value = false;
  const key = identity();
  const uploadKey = uploadIdentity();
  if (key) pending = readPendingCustomerDocumentCommand(key);
  if (uploadKey)
    uploadUnknown.value = !!readPendingCustomerAgreementUpload(uploadKey);
  if (pending) {
    const body = pending.body;
    status.value = 'unknown';
    editing.value = true;
    if ('title' in body) {
      form.value = {
        title: body.title ?? '',
        model: body.model ?? '',
        settlementMethod: body.settlementMethod ?? '',
        validityMode: body.validityMode ?? 'UNKNOWN',
        effectiveFrom: body.effectiveFrom ?? '',
        effectiveTo: body.effectiveTo ?? '',
        files: [],
      };
    }
    message.value = '协议请求结果未知，原请求已保留。请按原请求重试。';
    setField('unknown', true);
  } else {
    status.value = 'idle';
    setField('unknown', false);
  }
  setField('uploadUnknown', uploadUnknown.value);
}

async function refreshCurrent(): Promise<void> {
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  if (!props.canRead) {
    clearSensitiveProjection();
    state.value = 'ready';
    setField('stale', false);
    return;
  }
  state.value = 'loading';
  try {
    const latest = await getCustomerAgreement(customerId);
    if (!current(ownGeneration, customerId, actorKey)) return;
    data.value = latest;
    state.value = 'ready';
    if (!pending && status.value !== 'refresh-needed') {
      form.value = formFromVersion(latest.agreement?.currentVersion);
      editing.value = false;
    }
    if (status.value === 'refresh-needed') {
      form.value = formFromVersion(latest.agreement?.currentVersion);
      editing.value = false;
      status.value = 'idle';
      message.value = '协议当前版已刷新。';
    }
    setField('stale', false);
    emit('refresh-requested', customerId, actorKey);
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    state.value = 'failed';
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
      return;
    }
    setField('stale', true);
    message.value =
      status.value === 'refresh-needed'
        ? '协议已提交，但当前版本刷新失败。请只读刷新。'
        : '协议资料暂时无法刷新，请重试读取。';
  }
}

async function loadHistory(page = 1): Promise<void> {
  const agreement = data.value?.agreement;
  if (!props.canRead || !agreement) return;
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  historyLoading.value = true;
  try {
    const result = await listCustomerAgreementVersions(
      customerId,
      agreement.id,
      page,
      versionCount,
    );
    if (!current(ownGeneration, customerId, actorKey)) return;
    history.value = result.items;
    historyPage.value = result.page;
    historyTotal.value = result.total;
    historyOpen.value = true;
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
    } else {
      message.value = '协议历史暂时无法读取，请重试。';
    }
  } finally {
    if (current(ownGeneration, customerId, actorKey))
      historyLoading.value = false;
  }
}

function startEditing(): void {
  if (!canSubmit.value || pending || status.value === 'refresh-needed') return;
  form.value = formFromVersion(data.value?.agreement?.currentVersion);
  editing.value = true;
  status.value = 'idle';
  message.value = '';
}

function cancelEditing(): void {
  if (!canCancel.value || pending) return;
  editing.value = false;
  form.value = formFromVersion(data.value?.agreement?.currentVersion);
  message.value = '';
}

function setValidityMode(mode: AgreementValidityMode): void {
  form.value.validityMode = mode;
  if (mode !== 'FIXED') form.value.effectiveTo = '';
}

function makeBody(): PendingCustomerDocumentCommand['body'] {
  const latest = data.value;
  if (!latest) throw new Error('协议资料尚未读取');
  const fields = {
    title: form.value.title.trim(),
    model: form.value.model.trim() || null,
    settlementMethod: form.value.settlementMethod.trim() || null,
    validityMode: form.value.validityMode,
    effectiveFrom: form.value.effectiveFrom || null,
    effectiveTo:
      form.value.validityMode === 'FIXED'
        ? form.value.effectiveTo || null
        : null,
    contentVersionIds: form.value.files.map((file) => file.contentVersionId),
  };
  return latest.agreement
    ? {
        expectedCustomerVersion: props.customerVersion,
        expectedAgreementVersion: latest.agreement.version,
        ...fields,
      }
    : {
        expectedCustomerVersion: props.customerVersion,
        ...fields,
      };
}

function isUnknown(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status >= 500 ||
    ['BUSY', 'TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(
      error.code,
    )
  );
}

async function submit(): Promise<void> {
  if (submitting.value || !canSubmit.value) return;
  const key = identity();
  if (!key) return;
  let command = pending;
  if (!command) {
    try {
      command = {
        userId: props.actor!.userId,
        departmentId: props.actor!.departmentId,
        customerId: props.customerId,
        kind: 'agreement',
        action: hasAgreement.value ? 'revise' : 'create',
        body: makeBody(),
        key: globalThis.crypto.randomUUID(),
      } as PendingCustomerDocumentCommand;
      savePendingCustomerDocumentCommand(command);
    } catch {
      message.value = '无法保存协议请求，请检查当前浏览器存储后重试。';
      return;
    }
    pending = command;
    status.value = 'unknown';
    setField('unknown', true);
  }
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  submitting.value = true;
  message.value = '';
  try {
    const result =
      command.action === 'create'
        ? await createCustomerAgreement(
            customerId,
            command.body as never,
            command.key,
          )
        : await reviseCustomerAgreement(
            customerId,
            data.value!.agreement!.id,
            command.body as ReviseCustomerAgreementInput,
            command.key,
          );
    if (!current(ownGeneration, customerId, actorKey)) return;
    clearPendingCustomerDocumentCommand(key);
    pending = undefined;
    setField('unknown', false);
    status.value = 'refresh-needed';
    message.value = `本次提交已成功（第 ${result.agreement?.currentVersion.version ?? '新'} 版），正在刷新当前资料。`;
    setField('stale', true);
    emit('version-updated', customerId, actorKey, result.customerVersion);
    await refreshCurrent();
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (error instanceof ApiError && error.status === 409) {
      clearPendingCustomerDocumentCommand(key);
      pending = undefined;
      setField('unknown', false);
      status.value = 'conflict';
      message.value =
        '协议已在其他位置更新。草稿已保留，请刷新当前版并核对后再提交。';
      await refreshCurrent();
      status.value = 'conflict';
      return;
    }
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      status.value = 'unknown';
      message.value =
        '当前权限或客户范围已变化。原请求已保留；恢复权限后可按原请求重试。';
      setField('unknown', true);
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
      return;
    }
    if (isUnknown(error)) {
      status.value = 'unknown';
      message.value = '协议请求结果未知，原请求已保留。请按原请求重试。';
      setField('unknown', true);
    } else {
      clearPendingCustomerDocumentCommand(key);
      pending = undefined;
      status.value = 'idle';
      setField('unknown', false);
      message.value =
        error instanceof ApiError
          ? error.message
          : '协议未提交，请检查内容后重试。';
    }
  } finally {
    if (current(ownGeneration, customerId, actorKey)) submitting.value = false;
  }
}

function isUnknownUpload(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status >= 500 ||
    error.status === 403 ||
    error.status === 404 ||
    ['BUSY', 'TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(
      error.code,
    )
  );
}

async function uploadSelectedFile(event: globalThis.Event): Promise<void> {
  const input = event.target as globalThis.HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !canSubmit.value || uploadUnknown.value) return;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  const ownGeneration = generation;
  uploading.value = true;
  message.value = '';
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_AGREEMENT',
      purpose: 'CUSTOMER_AGREEMENT',
      file,
    });
    if (!current(ownGeneration, customerId, actorKey)) return;
    form.value.files.push({
      materialId: uploaded.materialId,
      contentVersionId: uploaded.contentVersionId,
      originalFilename: uploaded.originalFilename,
      mimeType: uploaded.mimeType,
    });
    message.value = '协议文件已上传，尚未绑定到新版本。';
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (isUnknownUpload(error)) {
      const key = uploadIdentity();
      if (key) {
        try {
          savePendingCustomerAgreementUpload({
            ...key,
            kind: 'agreement-upload',
            createdAt: new Date().toISOString(),
          });
          uploadUnknown.value = true;
          setField('uploadUnknown', true);
        } catch {
          message.value =
            '协议上传结果未知且无法保存恢复标记，请停止重传并联系管理员核查。';
          return;
        }
      }
      message.value =
        '协议上传结果未知。请刷新已有文件、下载核对精确版本后再明确选用；不要再次上传。';
    } else if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      emit('unavailable', customerId, actorKey);
      message.value = '当前权限或客户范围已变化。';
    } else {
      message.value =
        error instanceof ApiError ? error.message : '协议文件上传失败。';
    }
  } finally {
    if (current(ownGeneration, customerId, actorKey)) uploading.value = false;
  }
}

async function refreshRecoveryFiles(): Promise<void> {
  if (!uploadUnknown.value || !props.canRead || recoveryLoading.value) return;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  const ownGeneration = generation;
  recoveryLoading.value = true;
  recoveryFiles.value = [];
  verifiedRecoveryFiles.value.clear();
  try {
    const result = await listOwnerMaterials('CUSTOMER', customerId);
    if (!current(ownGeneration, customerId, actorKey)) return;
    recoveryFiles.value = result.items
      .filter(
        (material) =>
          material.ownerType === 'CUSTOMER' &&
          material.ownerId === customerId &&
          material.category === 'CUSTOMER_AGREEMENT' &&
          material.purpose === 'CUSTOMER_AGREEMENT' &&
          material.status === 'ACTIVE',
      )
      .flatMap((material) =>
        material.contentVersions.map((version) => ({
          materialId: material.id,
          version,
        })),
      );
    if (recoveryFiles.value.length === 0) {
      message.value =
        '当前没有可核对的协议文件。未知上传标记已保留，请联系管理员核查。';
    } else {
      message.value =
        '请下载每个候选版本人工核对，再选择要用于协议的精确版本。';
    }
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
    } else {
      message.value = '协议文件列表暂时无法刷新，未知上传标记已保留。';
    }
  } finally {
    if (current(ownGeneration, customerId, actorKey))
      recoveryLoading.value = false;
  }
}

function recoveryKey(file: RecoveryFile): string {
  return `${file.materialId}:${file.version.id}`;
}

async function downloadRecoveryFile(file: RecoveryFile): Promise<void> {
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  try {
    await downloadMaterialVersion(file.materialId, file.version.id);
    if (!current(ownGeneration, customerId, actorKey)) return;
    verifiedRecoveryFiles.value.add(recoveryKey(file));
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
    } else {
      message.value = '文件下载失败，请稍后重试核对。';
    }
  }
}

function adoptRecoveryFile(file: RecoveryFile): void {
  if (!verifiedRecoveryFiles.value.has(recoveryKey(file)) || !canSubmit.value)
    return;
  if (
    form.value.files.some((item) => item.contentVersionId === file.version.id)
  )
    return;
  form.value.files.push({
    materialId: file.materialId,
    contentVersionId: file.version.id,
    originalFilename: file.version.originalFilename,
    mimeType: file.version.mimeType,
  });
  const key = uploadIdentity();
  if (key) clearPendingCustomerAgreementUpload(key);
  uploadUnknown.value = false;
  setField('uploadUnknown', false);
  recoveryFiles.value = [];
  message.value = '已人工核对并选用此协议文件版本。';
}

async function downloadFile(file: CustomerAgreementFile): Promise<void> {
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
    } else {
      message.value = '协议文件下载失败，请稍后重试。';
    }
  }
}

watch(
  () => `${props.customerId}:${props.actorKey}:${props.canRead}`,
  () => {
    generation += 1;
    clearSensitiveProjection();
    restorePending();
    if (props.canRead) void refreshCurrent();
    else {
      state.value = 'ready';
      setField('stale', false);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  generation += 1;
});
</script>

<template>
  <section
    class="ledger-panel customer-document-card"
    data-test="agreement-panel"
    aria-labelledby="agreement-heading"
  >
    <header>
      <div>
        <span class="state-index">协议</span>
        <h2 id="agreement-heading">客户协议</h2>
      </div>
      <button
        v-if="
          canRead &&
          state === 'ready' &&
          !editing &&
          status !== 'refresh-needed' &&
          data?.canEdit &&
          canEdit
        "
        type="button"
        data-test="agreement-edit"
        :disabled="blockedByOtherMaintenance"
        @click="startEditing"
      >
        {{ hasAgreement ? '编辑新版本' : '建立协议' }}
      </button>
    </header>

    <p v-if="!canRead && (status === 'unknown' || uploadUnknown)" role="status">
      协议存在待恢复结果。读取权限恢复后可重试原请求或核对已有文件。
    </p>
    <p v-else-if="!canRead" data-test="agreement-no-read">
      当前没有协议读取权限。
    </p>
    <p v-else-if="state === 'loading'">正在读取协议资料。</p>
    <div v-else-if="state === 'failed'" role="alert">
      <p>{{ message }}</p>
      <button
        type="button"
        data-test="agreement-refresh"
        @click="refreshCurrent"
      >
        只读刷新
      </button>
    </div>
    <template v-else-if="data">
      <template v-if="!editing">
        <p v-if="!data.agreement" data-test="agreement-not-created">
          尚未建立协议。
        </p>
        <template v-else>
          <p data-test="agreement-version">
            当前第 {{ data.agreement.version }} 版
          </p>
          <h3>{{ data.agreement.currentVersion.title }}</h3>
          <dl class="detail-grid">
            <div>
              <dt>协议型号</dt>
              <dd>{{ data.agreement.currentVersion.model || '未填写' }}</dd>
            </div>
            <div>
              <dt>结算方式</dt>
              <dd>
                {{ data.agreement.currentVersion.settlementMethod || '未填写' }}
              </dd>
            </div>
            <div>
              <dt>期限</dt>
              <dd>
                {{
                  data.agreement.currentVersion.validityMode === 'FIXED'
                    ? `${data.agreement.currentVersion.effectiveFrom || '起始日未知'} 至 ${data.agreement.currentVersion.effectiveTo}`
                    : data.agreement.currentVersion.validityMode === 'LONG_TERM'
                      ? '长期'
                      : '期限未知'
                }}
              </dd>
            </div>
          </dl>
          <div class="customer-document-files">
            <p v-if="data.agreement.currentVersion.files.length === 0">
              未附协议文件
            </p>
            <ul v-else>
              <li
                v-for="file in data.agreement.currentVersion.files"
                :key="file.contentVersionId"
              >
                <span>{{ file.originalFilename }}</span>
                <button
                  type="button"
                  :data-test="`agreement-download-${file.contentVersionId}`"
                  @click="downloadFile(file)"
                >
                  下载此版本
                </button>
              </li>
            </ul>
          </div>
          <p class="draft-note">
            期限和文件信息仅记录已提交资料，不判断协议效力或签署状态。
          </p>
        </template>
      </template>

      <form
        v-else
        class="customer-document-form"
        data-test="agreement-form"
        @submit.prevent="submit"
      >
        <label
          >协议名称<input
            v-model="form.title"
            maxlength="200"
            required
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label
          >型号<input
            v-model="form.model"
            maxlength="100"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label
          >结算方式<input
            v-model="form.settlementMethod"
            maxlength="200"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label
          >期限类型
          <select
            :value="form.validityMode"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
            @change="
              setValidityMode(
                ($event.target as HTMLSelectElement)
                  .value as AgreementValidityMode,
              )
            "
          >
            <option value="FIXED">固定期限</option>
            <option value="LONG_TERM">长期</option>
            <option value="UNKNOWN">未知</option>
          </select>
        </label>
        <label
          >生效日<input
            v-model="form.effectiveFrom"
            type="date"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label v-if="form.validityMode === 'FIXED'"
          >截止日<input
            v-model="form.effectiveTo"
            type="date"
            required
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <fieldset
          :disabled="
            !canEdit ||
            blockedByOtherMaintenance ||
            status === 'unknown' ||
            uploadUnknown
          "
        >
          <legend>协议文件（最多 10 份）</legend>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            :disabled="form.files.length >= 10 || uploading"
            @change="uploadSelectedFile"
          />
          <p v-if="form.files.length === 0">未附协议文件</p>
          <ul v-else>
            <li v-for="file in form.files" :key="file.contentVersionId">
              <span>{{ file.originalFilename }}</span>
              <button
                type="button"
                :disabled="blockedByOtherMaintenance || status === 'unknown'"
                @click="
                  form.files = form.files.filter(
                    (item) => item.contentVersionId !== file.contentVersionId,
                  )
                "
              >
                移除此版附件
              </button>
            </li>
          </ul>
          <p v-if="uploading" role="status">正在上传协议文件。</p>
          <p v-if="uploadUnknown" role="alert">
            协议上传结果未知。刷新列表后下载核对精确版本，不能再次上传。
          </p>
        </fieldset>
        <p v-if="status === 'unknown' || status === 'conflict'" role="alert">
          {{ message }}
        </p>
        <p v-else-if="status === 'refresh-needed'" role="status">
          {{ message }}
        </p>
        <p v-else-if="message" role="status">{{ message }}</p>
        <div class="customer-document-actions">
          <button
            type="submit"
            data-test="agreement-submit"
            :disabled="
              submitting ||
              status === 'refresh-needed' ||
              (!pending && !canSubmit) ||
              (form.validityMode === 'FIXED' && !form.effectiveTo)
            "
          >
            {{ status === 'unknown' ? '按原请求重试' : '保存新版本' }}
          </button>
          <button
            v-if="status === 'refresh-needed'"
            type="button"
            data-test="agreement-refresh-current"
            @click="refreshCurrent"
          >
            只读刷新
          </button>
          <button
            type="button"
            data-test="agreement-cancel"
            :disabled="
              !canCancel || status === 'unknown' || status === 'refresh-needed'
            "
            @click="cancelEditing"
          >
            取消编辑
          </button>
        </div>
      </form>

      <div v-if="uploadUnknown && canRead" class="customer-document-recovery">
        <p role="status">
          上传结果未知。请下载并人工核对现有精确版本，再选择是否用于协议。
        </p>
        <button
          type="button"
          data-test="agreement-recovery-refresh"
          :disabled="recoveryLoading"
          @click="refreshRecoveryFiles"
        >
          刷新已有协议文件
        </button>
        <ul>
          <li
            v-for="file in recoveryFiles"
            :key="`${file.materialId}:${file.version.id}`"
          >
            <span
              >{{ file.version.originalFilename }} ·
              {{ file.version.createdAt }}</span
            >
            <button
              type="button"
              :data-test="`recovery-download-${file.version.id}`"
              @click="downloadRecoveryFile(file)"
            >
              下载核对
            </button>
            <button
              type="button"
              :data-test="`recovery-adopt-${file.version.id}`"
              :disabled="
                !verifiedRecoveryFiles.has(recoveryKey(file)) || !canSubmit
              "
              @click="adoptRecoveryFile(file)"
            >
              确认选用此版本
            </button>
          </li>
        </ul>
      </div>

      <div v-if="data.agreement && canRead" class="customer-document-history">
        <button
          type="button"
          data-test="agreement-history-toggle"
          :disabled="historyLoading"
          @click="historyOpen ? (historyOpen = false) : loadHistory(1)"
        >
          {{ historyOpen ? '收起版本历史' : '查看版本历史' }}
        </button>
        <section v-if="historyOpen" aria-label="协议版本历史">
          <ol>
            <li v-for="item in history" :key="item.id">
              <h4>第 {{ item.version }} 版 · {{ item.title }}</h4>
              <time>{{ item.recordedAt }} · {{ item.recordedByUserId }}</time>
              <p>
                期限：{{
                  item.validityMode === 'FIXED'
                    ? `${item.effectiveFrom || '起始日未知'} 至 ${item.effectiveTo}`
                    : item.validityMode === 'LONG_TERM'
                      ? '长期'
                      : '期限未知'
                }}
              </p>
              <p v-if="item.files.length === 0">未附协议文件</p>
              <ul v-else>
                <li v-for="file in item.files" :key="file.contentVersionId">
                  {{ file.originalFilename }}
                  <button
                    type="button"
                    :data-test="`history-download-${file.contentVersionId}`"
                    @click="downloadFile(file)"
                  >
                    下载此历史版本
                  </button>
                </li>
              </ul>
            </li>
          </ol>
          <div class="customer-document-actions">
            <button
              type="button"
              :disabled="historyLoading || historyPage <= 1"
              @click="loadHistory(historyPage - 1)"
            >
              上一页
            </button>
            <span>第 {{ historyPage }} 页，共 {{ historyTotal }} 条</span>
            <button
              type="button"
              :disabled="
                historyLoading || historyPage * versionCount >= historyTotal
              "
              @click="loadHistory(historyPage + 1)"
            >
              下一页
            </button>
          </div>
        </section>
      </div>
      <p v-if="message && !editing" role="status">{{ message }}</p>
    </template>
  </section>
</template>

<style scoped>
.customer-document-card {
  margin-top: var(--s-4);
  padding: var(--s-5);
}
.customer-document-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}
.customer-document-card h2 {
  margin: var(--s-1) 0 var(--s-3);
  font-size: 18px;
}
.customer-document-card h3 {
  margin: 0 0 var(--s-3);
  font-size: 16px;
}
.customer-document-card button {
  min-height: 36px;
  padding: 0 var(--s-3);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  background: var(--color-surface-1);
  color: var(--color-ink);
  cursor: pointer;
  font: inherit;
}
.customer-document-card button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.customer-document-form {
  display: grid;
  gap: var(--s-3);
  max-width: 620px;
}
.customer-document-form label {
  display: grid;
  gap: var(--s-1);
}
.customer-document-form input,
.customer-document-form textarea,
.customer-document-form select {
  min-height: 38px;
  padding: var(--s-2);
  border: 1px solid var(--color-hairline);
  border-radius: 5px;
  font: inherit;
}
.customer-document-form fieldset {
  display: grid;
  gap: var(--s-2);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  padding: var(--s-3);
}
.customer-document-form ul,
.customer-document-files ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.customer-document-form li,
.customer-document-files li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  margin: var(--s-2) 0;
}
.customer-document-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
}
.customer-document-history,
.customer-document-recovery {
  margin-top: var(--s-4);
}
.customer-document-history ol {
  padding-left: var(--s-5);
}
.customer-document-history ol > li {
  margin: var(--s-3) 0;
}
.customer-document-history time {
  display: block;
  color: var(--color-ink-muted);
  font-size: 13px;
}
.customer-document-recovery ul {
  padding-left: var(--s-4);
}
</style>
