<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type OwnerMaterial,
} from '../../api/materials';
import {
  recordNotaryPortalCertificate,
  recordProxyNotaryCertificate,
  recordNotaryPortalOpening,
  type NotaryPortalCertificateInput,
  type NotaryPortalMatter,
} from '../../api/notary-portal';
import type { NotaryMatterDetail, RecordNotaryOpeningInput } from '../../api/notary';
const props = defineProps<{
  detail: NotaryPortalMatter | NotaryMatterDetail;
  session: ListWorkflowSession;
  proxy?: boolean;
}>();
const matter = computed(() => ({
  ...props.detail,
  disclosureRequired: props.detail.disclosureRequired ?? false,
  capabilities: {
    recordOpening: !props.proxy && props.detail.capabilities.recordOpening,
    issueCertificate: props.proxy
      ? Boolean(typeof props.detail.disclosureRequired === 'boolean' &&
          'proxyIssueCertificate' in props.detail.capabilities &&
          props.detail.capabilities.proxyIssueCertificate)
      : Boolean((props.detail as NotaryPortalMatter).capabilities.issueCertificate),
  },
}));
const materials = ref<OwnerMaterial[]>([]);
const excludedPhotoIds = ref<Set<string>>(new Set());
const senderName = ref('');
const senderPhone = ref('');
const senderAddress = ref('');
const uploading = ref(false);
const submitting = ref(false);
const error = ref('');
const uploadError = ref('');
const success = ref('');
const downloadError = ref('');
const certificateNo = ref('');
const certificateDate = ref('');
const selectedCertificateIds = ref<Set<string>>(new Set());
const selectedDisclosureIds = ref<Set<string>>(new Set());
const feeStates = ref({
  notary: 'PENDING' as 'KNOWN' | 'PENDING',
  investigation: 'PENDING' as 'KNOWN' | 'PENDING',
  disclosure: 'PENDING' as 'KNOWN' | 'PENDING',
});
const feeAmounts = ref({ notary: '', investigation: '', disclosure: '' });
const certificateSuccess = ref('');
const feeCategories = [
  { key: 'notary', label: '公证费' },
  { key: 'investigation', label: '调查费' },
  { key: 'disclosure', label: '披露费' },
] as const;
const canSubmitCertificate = computed(
  () =>
    Boolean(matter.value?.capabilities.issueCertificate) &&
    certificateNo.value.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/u.test(certificateDate.value) &&
    certificateFiles.value.some((file) =>
      selectedCertificateIds.value.has(file.contentVersionId),
    ) &&
    certificateFiles.value.filter((file) =>
      selectedCertificateIds.value.has(file.contentVersionId),
    ).length <= 10 &&
    (!matter.value?.disclosureRequired ||
      (disclosureFiles.value.some((file) =>
        selectedDisclosureIds.value.has(file.contentVersionId),
      ) &&
        disclosureFiles.value.filter((file) =>
          selectedDisclosureIds.value.has(file.contentVersionId),
        ).length <= 10)) &&
    feeCategories.every(
      ({ key }) =>
        feeStates.value[key] === 'PENDING' ||
        /^\d+\.\d{2}$/u.test(feeAmounts.value[key]),
    ),
);
let active = true;
const matterId = computed(() => props.detail.id);
const openingPhotos = computed(() =>
  materials.value.flatMap((material) => {
    if (
      material.ownerType !== 'NOTARY_MATTER' ||
      material.ownerId !== matterId.value ||
      material.category !== 'NOTARY_OPENING_PHOTO' ||
      material.purpose !== 'NOTARY_OPENING_PHOTO' ||
      material.status !== 'ACTIVE' ||
      !material.currentVersionId
    )
      return [];
    const content = material.contentVersions.find(
      (version) => version.id === material.currentVersionId,
    );
    return content
      ? [
          {
            materialId: material.id,
            contentVersionId: content.id,
            originalFilename: content.originalFilename,
            mimeType: content.mimeType,
          },
        ]
      : [];
  }),
);
const selectedOpeningPhotos = computed(() =>
  openingPhotos.value.filter(
    (photo) => !excludedPhotoIds.value.has(photo.contentVersionId),
  ),
);
function currentFiles(category: 'NOTARY_CERTIFICATE' | 'NOTARY_DISCLOSURE') {
  return materials.value.flatMap((material) => {
    if (
      material.ownerType !== 'NOTARY_MATTER' ||
      material.ownerId !== matterId.value ||
      material.category !== category ||
      material.purpose !== category ||
      material.status !== 'ACTIVE' ||
      !material.currentVersionId
    )
      return [];
    const content = material.contentVersions.find(
      (version) => version.id === material.currentVersionId,
    );
    return content
      ? [
          {
            materialId: material.id,
            contentVersionId: content.id,
            originalFilename: content.originalFilename,
            mimeType: content.mimeType,
          },
        ]
      : [];
  });
}
const certificateFiles = computed(() => currentFiles('NOTARY_CERTIFICATE'));
const disclosureFiles = computed(() => currentFiles('NOTARY_DISCLOSURE'));

async function refreshMaterials(): Promise<void> {
  const response = await listOwnerMaterials('NOTARY_MATTER', matterId.value);
  if (!active || !props.session.isCurrent()) return;
  materials.value = response.items;
  selectedCertificateIds.value = new Set([
    ...certificateFiles.value.map((file) => file.contentVersionId),
    ...selectedCertificateIds.value,
  ]);
  selectedDisclosureIds.value = new Set([
    ...disclosureFiles.value.map((file) => file.contentVersionId),
    ...selectedDisclosureIds.value,
  ]);
}

async function uploadCertificateFiles(
  event: InstanceType<typeof globalThis.Event>,
  category: 'NOTARY_CERTIFICATE' | 'NOTARY_DISCLOSURE',
): Promise<void> {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement) || uploading.value)
    return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  uploadError.value = '';
  if (
    files.length +
      (category === 'NOTARY_CERTIFICATE'
        ? certificateFiles.value.length
        : disclosureFiles.value.length) >
    10
  ) {
    uploadError.value = '每类出证材料最多 10 个文件';
    return;
  }
  uploading.value = true;
  try {
    for (const file of files) {
      if (!active || !props.session.isCurrent()) return;
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        uploadError.value = '公证书和披露材料仅支持 PDF、JPEG 或 PNG';
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        uploadError.value = '单个出证材料不能超过 50 MB';
        continue;
      }
      const uploaded = await uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId.value,
        category,
        purpose: category,
        file,
      });
      if (category === 'NOTARY_CERTIFICATE')
        selectedCertificateIds.value = new Set([
          ...selectedCertificateIds.value,
          uploaded.contentVersionId,
        ]);
      else
        selectedDisclosureIds.value = new Set([
          ...selectedDisclosureIds.value,
          uploaded.contentVersionId,
        ]);
    }
    await refreshMaterials();
  } catch {
    uploadError.value = '材料上传失败，请刷新列表确认后重试。';
  } finally {
    uploading.value = false;
  }
}
function updateCertificateSelection(
  contentVersionId: string,
  kind: 'certificate' | 'disclosure',
  event: InstanceType<typeof globalThis.Event>,
): void {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const current =
    kind === 'certificate'
      ? selectedCertificateIds.value
      : selectedDisclosureIds.value;
  const next = new Set(current);
  if (input.checked) next.add(contentVersionId);
  else next.delete(contentVersionId);
  if (kind === 'certificate') selectedCertificateIds.value = next;
  else selectedDisclosureIds.value = next;
}
async function submitCertificate(): Promise<void> {
  if (
    !matter.value?.capabilities.issueCertificate ||
    !canSubmitCertificate.value ||
    submitting.value ||
    uploading.value
  )
    return;
  submitting.value = true;
  error.value = '';
  certificateSuccess.value = '';
  try {
    const input: NotaryPortalCertificateInput = {
      expectedVersion: matter.value.version,
      certificateNo: certificateNo.value.trim(),
      certificateDate: certificateDate.value,
      contentVersionIds: certificateFiles.value
        .filter((file) =>
          selectedCertificateIds.value.has(file.contentVersionId),
        )
        .map((file) => file.contentVersionId),
      needDisclose: matter.value.disclosureRequired,
      disclosureContentVersionIds: matter.value.disclosureRequired
        ? disclosureFiles.value
            .filter((file) =>
              selectedDisclosureIds.value.has(file.contentVersionId),
            )
            .map((file) => file.contentVersionId)
        : [],
      fees: {
        notary: {
          state: feeStates.value.notary,
          amount:
            feeStates.value.notary === 'KNOWN' ? feeAmounts.value.notary : null,
        },
        investigation: {
          state: feeStates.value.investigation,
          amount:
            feeStates.value.investigation === 'KNOWN'
              ? feeAmounts.value.investigation
              : null,
        },
        disclosure: {
          state: feeStates.value.disclosure,
          amount:
            feeStates.value.disclosure === 'KNOWN'
              ? feeAmounts.value.disclosure
              : null,
        },
      },
    };
    await execute({ kind: 'certificate', input });
  } finally {
    submitting.value = false;
  }
}

async function uploadFiles(
  event: InstanceType<typeof globalThis.Event>,
): Promise<void> {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement) || uploading.value)
    return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  uploadError.value = '';
  if (openingPhotos.value.length + files.length > 50) {
    uploadError.value = '开箱照片最多 50 张';
    return;
  }
  uploading.value = true;
  try {
    for (const file of files) {
      if (!active || !props.session.isCurrent()) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        uploadError.value = '仅支持 JPEG、PNG 或 WEBP 图片';
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        uploadError.value = '单张照片不能超过 20 MB';
        continue;
      }
      await uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId.value,
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        file,
      });
    }
    await refreshMaterials();
  } catch {
    uploadError.value = '照片上传失败，请刷新列表确认后重试。';
  } finally {
    uploading.value = false;
  }
}
function updatePhotoSelection(
  contentVersionId: string,
  event: InstanceType<typeof globalThis.Event>,
): void {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const excluded = new Set(excludedPhotoIds.value);
  if (input.checked) excluded.delete(contentVersionId);
  else excluded.add(contentVersionId);
  excludedPhotoIds.value = excluded;
}
async function submitOpening(): Promise<void> {
  if (
    !matter.value ||
    !matter.value.capabilities.recordOpening ||
    submitting.value ||
    uploading.value ||
    selectedOpeningPhotos.value.length === 0
  )
    return;
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    const input: RecordNotaryOpeningInput = {
      expectedVersion: matter.value.version,
      contentVersionIds: selectedOpeningPhotos.value.map(
        (photo) => photo.contentVersionId,
      ),
      ...(senderName.value.trim()
        ? { senderName: senderName.value.trim() }
        : {}),
      ...(senderPhone.value.trim()
        ? { senderPhone: senderPhone.value.trim() }
        : {}),
      ...(senderAddress.value.trim()
        ? { senderAddress: senderAddress.value.trim() }
        : {}),
    };
    await execute({ kind: 'opening', input });
  } finally {
    submitting.value = false;
  }
}

async function download(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, contentVersionId);
  } catch {
    downloadError.value = '照片下载失败，请稍后重试。';
  }
}
type Command =
  | { kind: 'opening'; input: RecordNotaryOpeningInput }
  | { kind: 'certificate'; input: NotaryPortalCertificateInput };
type Pending = { command: Command; key: string };
const busy = ref(false);
const unknown = ref(false);
const message = ref('');
const blocked = ref(false);
const locked = computed(() => busy.value || unknown.value || blocked.value);
const storageKey = `${props.proxy ? 'notary-proxy-certificate-request' : 'notary-portal-list-request'}:${JSON.stringify([props.session.context.actorKey, props.detail.id, props.session.context.actionKey])}`;
let pending: Pending | null = null;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === 'string' && id.length > 0)
  );
}
function validPending(value: unknown): value is Pending {
  if (
    !record(value) ||
    typeof value.key !== 'string' ||
    !value.key ||
    !record(value.command)
  )
    return false;
  const { kind, input } = value.command;
  if (
    !record(input) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1
  )
    return false;
  if (kind === 'opening')
    return (
      stringIds(input.contentVersionIds) &&
      ['senderName', 'senderPhone', 'senderAddress'].every(
        (key) => input[key] === undefined || typeof input[key] === 'string',
      )
    );
  return (
    kind === 'certificate' &&
    typeof input.certificateNo === 'string' &&
    typeof input.certificateDate === 'string' &&
    stringIds(input.contentVersionIds) &&
    typeof input.needDisclose === 'boolean' &&
    Array.isArray(input.disclosureContentVersionIds) &&
    input.disclosureContentVersionIds.every((id) => typeof id === 'string') &&
    record(input.fees) &&
    ['notary', 'investigation', 'disclosure'].every((key) => {
      const fees = input.fees;
      if (!record(fees)) return false;
      const fee = fees[key];
      return (
        record(fee) &&
        ((fee.state === 'PENDING' && fee.amount === null) ||
          (fee.state === 'KNOWN' &&
            typeof fee.amount === 'string' &&
            /^\d+\.\d{2}$/u.test(fee.amount)))
      );
    })
  );
}

const requestedAction = computed(() => props.session.context.actionKey);
const currentAction = computed<Command['kind'] | null>(() => {
  const current = matter.value;
  if (current.stage === 'WAITING_UNBOX' && current.capabilities.recordOpening)
    return 'opening';
  if (
    current.stage === 'WAITING_CERTIFICATE' &&
    current.capabilities.issueCertificate
  )
    return 'certificate';
  return null;
});
const formAvailable = computed(
  () =>
    currentAction.value !== null &&
    requestedAction.value === currentAction.value,
);
function allowed(command: Command, recovery = false): boolean {
  return (
    requestedAction.value === command.kind &&
    (recovery
      ? props.session.isCurrent()
      : currentAction.value === command.kind)
  );
}

function post(request: Pending) {
  const { command, key } = request;
  return command.kind === 'opening'
    ? recordNotaryPortalOpening(props.detail.id, command.input, key)
    : props.proxy
      ? recordProxyNotaryCertificate(props.detail.id, command.input, key)
      : recordNotaryPortalCertificate(props.detail.id, command.input, key);
}

async function execute(command: Command, recovery = false): Promise<void> {
  const session = props.session;
  if (
    busy.value ||
    blocked.value ||
    (!recovery && unknown.value) ||
    !allowed(command, recovery) ||
    !session.isCurrent()
  )
    return;
  if (!recovery) {
    const request = { command, key: globalThis.crypto.randomUUID() };
    try {
      // Persist before dispatch. A reload while POST is in flight must recover
      // this exact body/key rather than silently opening a new command.
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(request));
      const frozen: unknown = JSON.parse(JSON.stringify(request));
      if (!validPending(frozen)) throw new Error('Invalid request');
      pending = frozen;
    } catch {
      message.value = '无法保留原请求，请检查浏览器存储后重试；尚未提交。';
      return;
    }
  }
  if (!pending || !session.beginSubmit({ recovery })) return;
  const request = pending;
  busy.value = true;
  message.value = '';
  try {
    await post(request);
    // The pending slot belongs to the original actor/record, even if its panel
    // was invalidated. Never refresh or notify the next session for a late POST.
    if (
      globalThis.sessionStorage.getItem(storageKey) === JSON.stringify(request)
    )
      globalThis.sessionStorage.removeItem(storageKey);
    if (!session.isCurrent()) return;
    pending = null;
    unknown.value = false;
    notifyWorkflowChanged();
    session.endSubmit('success');
  } catch (error) {
    if (!session.isCurrent()) return;
    const uncertain =
      !(error instanceof ApiError) ||
      error.status === 0 ||
      error.status >= 500 ||
      ['INVALID_RESPONSE', 'TIMEOUT', 'NETWORK_ERROR'].includes(error.code);
    unknown.value = uncertain;
    session.endSubmit(uncertain ? 'unknown' : 'failed');
    if (uncertain) {
      message.value =
        '提交结果暂时未知，原内容与请求键已保留；请使用相同请求键重试。';
    } else {
      if (!(recovery && [401, 403, 404].includes(error.status))) {
        globalThis.sessionStorage.removeItem(storageKey);
        pending = null;
      }
      blocked.value = [401, 403, 404, 409].includes(error.status);
      message.value = `${error.message}${blocked.value ? '。请返回列表核对最新资料或权限后重新打开。' : '。输入已保留，请修正后重试。'}`;
      if ([401, 403, 404].includes(error.status)) session.deny();
    }
  } finally {
    busy.value = false;
  }
}
async function retry() {
  if (pending) await execute(pending.command, true);
}
try {
  const saved = globalThis.sessionStorage.getItem(storageKey);
  if (saved) {
    const decoded: unknown = JSON.parse(saved);
    if (!validPending(decoded) || !allowed(decoded.command, true))
      throw new Error('Invalid pending request');
    pending = decoded;
    if (decoded.command.kind === 'opening') {
      senderName.value = decoded.command.input.senderName ?? '';
      senderPhone.value = decoded.command.input.senderPhone ?? '';
      senderAddress.value = decoded.command.input.senderAddress ?? '';
    } else {
      const input = decoded.command.input;
      certificateNo.value = input.certificateNo;
      certificateDate.value = input.certificateDate;
      selectedCertificateIds.value = new Set(input.contentVersionIds);
      selectedDisclosureIds.value = new Set(input.disclosureContentVersionIds);
      for (const { key } of feeCategories) {
        feeStates.value[key] = input.fees[key].state;
        feeAmounts.value[key] = input.fees[key].amount ?? '';
      }
    }
    unknown.value = true;
    if (!props.session.restoreUnknown()) blocked.value = true;
    message.value = '检测到尚未确认的原请求，请使用原请求重试核对。';
  }
} catch {
  blocked.value = true;
  message.value = '原请求无法安全恢复，已停止提交，请联系管理员核对。';
}

void refreshMaterials().catch(() => {
  if (active) uploadError.value = '材料读取失败，请重新打开后重试。';
});
onBeforeUnmount(() => {
  active = false;
});
</script>
<template>
  <p v-if="proxy" role="status">运营代办公证处出证；提交后记录真实运营账号、时间和结果。</p>
  <p>提交会推进阶段；当前服务暂不支持仅保存这些资料。已上传材料会保留。</p>
  <p v-if="message" role="alert">{{ message }}</p>
  <ElButton
    v-if="unknown"
    data-test="notary-workflow-retry"
    :disabled="busy"
    @click="retry"
    >使用相同请求键重试</ElButton
  >
  <p v-if="!formAvailable" role="alert">
    {{
      unknown
        ? '当前事项可能已经推进；恢复只会核对原冻结请求。'
        : '当前步骤或办理权限已变化，请返回列表刷新后重新打开。'
    }}
  </p>
  <fieldset
    v-if="formAvailable"
    :disabled="locked"
    style="border: 0; padding: 0"
  >
    <section
      v-if="matter.capabilities.recordOpening"
      id="portal-opening-form"
      class="demo-card demo-card--pad"
      data-test="notary-opening-form"
    >
      <h2 class="form-section-title">登记开箱材料</h2>
      <p>
        提交后事项将进入开箱审核。请先上传本事项开箱照片，提交后记录不可由此页面撤回。
      </p>
      <label
        >开箱照片（JPEG、PNG、WEBP；单张不超过 20 MB，最多 50
        张）<RequiredFieldMark /><input
          data-test="notary-opening-photo-files"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          :disabled="uploading || submitting"
          @change="uploadFiles"
      /></label>
      <p class="field-help">
        默认勾选全部已上传照片。提交后仅勾选照片会被冻结在开箱记录中；未勾选照片不属于该记录。
      </p>
      <p v-if="openingPhotos.length === 0" class="field-help">
        暂无已上传开箱照片。
      </p>
      <ul v-else>
        <li v-for="photo in openingPhotos" :key="photo.contentVersionId">
          <label>
            <input
              :data-test="`notary-opening-photo-select-${photo.contentVersionId}`"
              type="checkbox"
              :checked="!excludedPhotoIds.has(photo.contentVersionId)"
              :disabled="uploading || submitting"
              @change="updatePhotoSelection(photo.contentVersionId, $event)"
            />
            纳入开箱记录：{{ photo.originalFilename }}（{{ photo.mimeType }}）
          </label>
        </li>
      </ul>
      <p v-if="uploadError" class="submit-error" role="alert">
        {{ uploadError }}
      </p>
      <label class="field-label field-label--spaced" for="sender-name"
        >寄件人姓名</label
      ><input
        id="sender-name"
        v-model="senderName"
        class="text-input"
        maxlength="120"
        :disabled="submitting"
      />
      <label class="field-label field-label--spaced" for="sender-phone"
        >寄件人电话</label
      ><input
        id="sender-phone"
        v-model="senderPhone"
        class="text-input"
        maxlength="50"
        :disabled="submitting"
      />
      <label class="field-label field-label--spaced" for="sender-address"
        >寄件人地址</label
      ><textarea
        id="sender-address"
        v-model="senderAddress"
        class="text-input"
        maxlength="500"
        :disabled="submitting"
      />
      <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
      <p v-if="success" class="submit-success" role="status">
        {{ success }}
      </p>
      <ElButton
        type="primary"
        data-test="notary-opening-submit"
        :loading="submitting"
        :disabled="
          submitting || uploading || selectedOpeningPhotos.length === 0
        "
        @click="submitOpening"
        >登记开箱并进入审核</ElButton
      >
    </section>
    <section
      v-if="matter.capabilities.issueCertificate"
      id="portal-certificate-form"
      class="demo-card demo-card--pad"
      data-test="certificate-form"
    >
      <h2 class="form-section-title">登记公证书并归档</h2>
      <p>
        提交后事项将归档并生成一个待匹配案件，证书信息和所选文件不可在本页面撤回。请先核对编号、日期、文件和费用。
      </p>
      <label class="field-label" for="certificate-no"
        >公证书编号<RequiredFieldMark
      /></label>
      <input
        id="certificate-no"
        data-test="certificate-number"
        v-model="certificateNo"
        class="text-input"
        maxlength="120"
        :disabled="submitting || uploading"
      />
      <label class="field-label field-label--spaced" for="certificate-date"
        >出证日期<RequiredFieldMark
      /></label>
      <input
        id="certificate-date"
        data-test="certificate-date"
        v-model="certificateDate"
        class="text-input"
        type="date"
        :disabled="submitting || uploading"
      />
      <label
        >公证书文件（PDF、JPEG、PNG；单个不超过 50 MB，最多 10
        个）<RequiredFieldMark /><input
          data-test="certificate-file-input"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          :disabled="submitting || uploading"
          @change="uploadCertificateFiles($event, 'NOTARY_CERTIFICATE')"
      /></label>
      <p class="field-help">
        默认勾选新上传及已有有效版本。提交时只冻结勾选的内容版本。
      </p>
      <ul v-if="certificateFiles.length">
        <li v-for="file in certificateFiles" :key="file.contentVersionId">
          <label
            ><input
              :data-test="`certificate-select-${file.contentVersionId}`"
              type="checkbox"
              :checked="selectedCertificateIds.has(file.contentVersionId)"
              :disabled="submitting || uploading"
              @change="
                updateCertificateSelection(
                  file.contentVersionId,
                  'certificate',
                  $event,
                )
              "
            />
            {{ file.originalFilename }}（{{ file.mimeType }}）</label
          ><ElButton
            text
            :data-test="`download-certificate-${file.contentVersionId}`"
            @click="download(file.materialId, file.contentVersionId)"
            >下载</ElButton
          >
        </li>
      </ul>
      <label
        ><input
          :checked="matter.disclosureRequired"
          data-test="disclosure-toggle"
          type="checkbox"
          disabled
        />
        {{
          matter.disclosureRequired
            ? '来源线索要求披露材料'
            : '来源线索不要求披露材料'
        }}</label
      >
      <p v-if="matter.disclosureRequired" class="field-help">
        来源线索要求披露材料，至少选择一份披露文件后才能出证。
      </p>
      <template v-if="matter.disclosureRequired">
        <label class="field-label field-label--spaced"
          >披露文件（PDF、JPEG、PNG；单个不超过 50 MB，最多 10
          个）<RequiredFieldMark /><input
            data-test="disclosure-file-input"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            :disabled="submitting || uploading"
            @change="uploadCertificateFiles($event, 'NOTARY_DISCLOSURE')"
        /></label>
        <ul v-if="disclosureFiles.length">
          <li v-for="file in disclosureFiles" :key="file.contentVersionId">
            <label
              ><input
                :data-test="`disclosure-select-${file.contentVersionId}`"
                type="checkbox"
                :checked="selectedDisclosureIds.has(file.contentVersionId)"
                :disabled="submitting || uploading"
                @change="
                  updateCertificateSelection(
                    file.contentVersionId,
                    'disclosure',
                    $event,
                  )
                "
              />
              {{ file.originalFilename }}（{{ file.mimeType }}）</label
            ><ElButton
              text
              :data-test="`download-disclosure-${file.contentVersionId}`"
              @click="download(file.materialId, file.contentVersionId)"
              >下载</ElButton
            >
          </li>
        </ul>
      </template>
      <h3 class="form-section-title">费用记录</h3>
      <p>
        样品费沿用取证记录，出证时不可修改：{{
          matter.evidence?.sampleFeeState === 'KNOWN'
            ? `¥ ${matter.evidence.sampleFeeAmount}`
            : '待确认'
        }}
      </p>
      <div v-for="fee in feeCategories" :key="fee.key">
        <label class="field-label field-label--spaced">{{ fee.label }}</label>
        <select
          v-model="feeStates[fee.key]"
          :data-test="`fee-${fee.key}-state`"
          class="text-input"
          :disabled="submitting || uploading"
        >
          <option value="KNOWN">已知</option>
          <option value="PENDING">待确认</option>
        </select>
        <input
          v-if="feeStates[fee.key] === 'KNOWN'"
          v-model="feeAmounts[fee.key]"
          :data-test="`fee-${fee.key}-amount`"
          class="text-input"
          inputmode="decimal"
          aria-label="金额（元）"
          placeholder="金额（元，如 12.00）"
          :disabled="submitting || uploading"
        />
      </div>
      <p v-if="uploadError" class="submit-error" role="alert">
        {{ uploadError }}
      </p>
      <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
      <ElButton
        type="primary"
        data-test="certificate-submit"
        :loading="submitting"
        :disabled="submitting || uploading || !canSubmitCertificate"
        @click="submitCertificate"
        >确认出证并归档</ElButton
      >
    </section>
  </fieldset>
</template>
