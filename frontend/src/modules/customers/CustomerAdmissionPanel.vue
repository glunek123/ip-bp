<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  admitCustomer,
  getCustomer,
  type AdmitCustomerInput,
  type CustomerDetail,
  type CustomerSummary,
} from '../../api/customers';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import {
  deleteMaterial,
  downloadMaterialVersion,
  listOwnerMaterials,
  restoreMaterial,
  uploadMaterialFile,
  type MaterialPurpose,
  type OwnerMaterial,
  type UploadedMaterial,
} from '../../api/materials';
import {
  compatibleIdentityOptions,
  customerTypeOptions,
  identityCompatibility,
  identityValidityModeOptions,
  isCustomerTypeCode,
  isIdentityTypeCode,
  normalizeCustomerTypeOption,
  normalizeIdentityTypeOption,
  type IdentityValidityModeCode,
} from './customer-admission-options';

type SelectedFile = InstanceType<typeof globalThis.File>;

const props = defineProps<{ customer: CustomerDetail }>();
const emit = defineEmits<{
  admitted: [customer: CustomerSummary];
  'customer-refreshed': [customer: CustomerDetail];
  'customer-not-found': [];
}>();

const expectedVersion = ref(props.customer.version);
const name = ref(props.customer.name);
const customerType = ref(
  normalizeCustomerTypeOption(props.customer.customerType),
);
const identityType = ref(
  normalizeIdentityTypeOption(props.customer.identityType),
);
const identityNumber = ref(props.customer.identityNumber ?? '');
const issuingCountryOrRegion = ref(props.customer.issuingCountryOrRegion ?? '');
const identityValidFrom = ref(props.customer.identityValidFrom ?? '');
const identityValidTo = ref(props.customer.identityValidTo ?? '');
const identityValidityMode = ref<IdentityValidityModeCode>(
  props.customer.identityValidityMode ?? 'NOT_STATED',
);
const admissionContactName = ref(props.customer.admissionContactName ?? '');
const admissionContactPhone = ref(props.customer.admissionContactPhone ?? '');
const admissionContactEmail = ref(props.customer.admissionContactEmail ?? '');
const documentPurpose = ref<MaterialPurpose>('IDENTITY_FULL');
const materials = ref<OwnerMaterial[]>([]);
const materialsLoading = ref(false);
const uploadingFilename = ref('');
const submitting = ref(false);
const formError = ref('');
const materialError = ref('');
const staleReview = ref(false);
const externalSnapshotChanged = ref(false);
const identityNumberError = ref('');
const identityNumberInput =
  ref<InstanceType<typeof globalThis.HTMLInputElement>>();
let pendingCommand: { fingerprint: string; key: string } | undefined;

const canManageMaterials = computed(
  () =>
    props.customer.profileStatus === 'draft' &&
    props.customer.capabilities.admit,
);
const compatibleOptions = computed(() =>
  compatibleIdentityOptions(customerType.value),
);
const activeMaterials = computed(() =>
  materials.value.filter((material) => material.status === 'ACTIVE'),
);
const purposeOptions = computed<
  ReadonlyArray<{ value: MaterialPurpose; label: string }>
>(() =>
  identityType.value === 'NATIONAL_ID'
    ? [
        { value: 'IDENTITY_FULL', label: '正反面合并 PDF' },
        { value: 'IDENTITY_FRONT', label: '人像面' },
        { value: 'IDENTITY_BACK', label: '国徽面' },
      ]
    : [{ value: 'IDENTITY_FULL', label: '完整证件' }],
);

watch(
  () => props.customer.version,
  (version) => {
    if (version === expectedVersion.value) return;
    externalSnapshotChanged.value = true;
    pendingCommand = undefined;
    formError.value =
      '客户资料已在其他区域更新。为避免用旧字段覆盖新资料，请重新载入后核对。';
  },
);

function loadCustomerSnapshot(): void {
  expectedVersion.value = props.customer.version;
  name.value = props.customer.name;
  customerType.value = normalizeCustomerTypeOption(props.customer.customerType);
  identityType.value = normalizeIdentityTypeOption(props.customer.identityType);
  identityNumber.value = props.customer.identityNumber ?? '';
  issuingCountryOrRegion.value = props.customer.issuingCountryOrRegion ?? '';
  identityValidFrom.value = props.customer.identityValidFrom ?? '';
  identityValidTo.value = props.customer.identityValidTo ?? '';
  identityValidityMode.value =
    props.customer.identityValidityMode ?? 'NOT_STATED';
  admissionContactName.value = props.customer.admissionContactName ?? '';
  admissionContactPhone.value = props.customer.admissionContactPhone ?? '';
  admissionContactEmail.value = props.customer.admissionContactEmail ?? '';
  externalSnapshotChanged.value = false;
  staleReview.value = false;
  identityNumberError.value = '';
  formError.value = '';
  pendingCommand = undefined;
  void reloadMaterials();
}

function onCustomerTypeChanged(): void {
  if (
    isCustomerTypeCode(customerType.value) &&
    (!isIdentityTypeCode(identityType.value) ||
      !identityCompatibility[customerType.value].includes(identityType.value))
  ) {
    identityType.value = '';
  }
  onIdentityTypeChanged();
}

function onIdentityTypeChanged(): void {
  documentPurpose.value = 'IDENTITY_FULL';
  formError.value = '';
}

async function reloadMaterials(): Promise<void> {
  materialsLoading.value = true;
  materialError.value = '';
  try {
    const result = await listOwnerMaterials('CUSTOMER', props.customer.id);
    const activeIds = new Set(result.items.map((item) => item.id));
    const locallyDeleted = materials.value.filter(
      (item) => item.status === 'DELETED' && !activeIds.has(item.id),
    );
    materials.value = [...result.items, ...locallyDeleted];
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === 'RESOURCE_NOT_FOUND' ||
        error.code === 'CUSTOMER_NOT_FOUND')
    ) {
      emit('customer-not-found');
      return;
    }
    materialError.value =
      error instanceof ApiError &&
      (error.code === 'ACTION_FORBIDDEN' ||
        error.code === 'CUSTOMER_ACTION_FORBIDDEN')
        ? '当前账号无权查看客户材料'
        : '证件材料暂时无法读取，请稍后重试';
  } finally {
    materialsLoading.value = false;
  }
}

function currentVersion(material: OwnerMaterial) {
  return material.contentVersions.find(
    (version) => version.id === material.currentVersionId,
  );
}

function fileValidationError(file: SelectedFile): string {
  if (!isIdentityTypeCode(identityType.value)) return '请先选择证件类型';
  if (activeMaterials.value.length >= 10)
    return '每位客户最多保留 10 份证件材料';
  if (file.size > 20 * 1024 * 1024) return '单个文件不能超过 20MB';
  const generalAllowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]);
  if (!generalAllowed.has(file.type)) return '仅支持 PDF、JPG/JPEG、PNG 文件';
  if (
    identityType.value === 'NATIONAL_ID' &&
    documentPurpose.value === 'IDENTITY_FULL' &&
    file.type !== 'application/pdf'
  ) {
    return '身份证合并文件必须使用 PDF；图片请分别选择人像面或国徽面';
  }
  if (
    identityType.value === 'NATIONAL_ID' &&
    documentPurpose.value !== 'IDENTITY_FULL' &&
    file.type !== 'image/jpeg' &&
    file.type !== 'image/png'
  ) {
    return '身份证单面材料仅支持 JPG/JPEG 或 PNG 图片';
  }
  return '';
}

function uploadedAsMaterial(uploaded: UploadedMaterial): OwnerMaterial {
  const now = new Date().toISOString();
  return {
    id: uploaded.materialId,
    ownerType: 'CUSTOMER',
    ownerId: props.customer.id,
    category: 'CUSTOMER_IDENTITY',
    purpose: uploaded.purpose,
    currentVersionId: uploaded.contentVersionId,
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contentVersions: [
      {
        id: uploaded.contentVersionId,
        materialId: uploaded.materialId,
        originalFilename: uploaded.originalFilename,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        sha256: uploaded.sha256,
        status: 'AVAILABLE',
        createdAt: now,
      },
    ],
  };
}

async function upload(event: { target: unknown }): Promise<void> {
  if (!(event.target instanceof globalThis.HTMLInputElement)) return;
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined || uploadingFilename.value) return;
  materialError.value = fileValidationError(file);
  if (materialError.value) return;
  uploadingFilename.value = file.name;
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'CUSTOMER',
      ownerId: props.customer.id,
      category: 'CUSTOMER_IDENTITY',
      purpose: documentPurpose.value,
      file,
    });
    materials.value = [
      uploadedAsMaterial(uploaded),
      ...materials.value.filter((item) => item.id !== uploaded.materialId),
    ];
    await reloadMaterials();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === 'RESOURCE_NOT_FOUND' ||
        error.code === 'CUSTOMER_NOT_FOUND')
    ) {
      emit('customer-not-found');
    } else if (
      error instanceof ApiError &&
      (error.code === 'ACTION_FORBIDDEN' ||
        error.code === 'CUSTOMER_ACTION_FORBIDDEN')
    ) {
      materialError.value = '当前账号无权上传客户材料';
    } else {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        materialError.value = '文件格式、内容或数量不符合要求，请核对后重试';
      } else if (
        error instanceof ApiError &&
        error.code === 'MATERIAL_VERSION_INVALID'
      ) {
        materialError.value = '材料版本已失效，请刷新后重新选择文件';
      } else {
        materialError.value = '文件上传没有完成，已保留当前填写内容';
      }
    }
  } finally {
    uploadingFilename.value = '';
  }
}

async function download(material: OwnerMaterial): Promise<void> {
  const version = currentVersion(material);
  if (version === undefined) return;
  materialError.value = '';
  try {
    await downloadMaterialVersion(material.id, version.id);
  } catch (error) {
    materialError.value =
      error instanceof ApiError &&
      (error.code === 'ACTION_FORBIDDEN' ||
        error.code === 'CUSTOMER_ACTION_FORBIDDEN')
        ? '当前账号无权下载此客户材料'
        : error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
          ? '文件已不存在，请刷新材料列表'
          : '文件下载没有完成，请稍后重试';
  }
}

async function remove(material: OwnerMaterial): Promise<void> {
  materialError.value = '';
  try {
    const deleted = await deleteMaterial(material.id, material.version);
    materials.value = materials.value.map((item) =>
      item.id === material.id
        ? {
            ...item,
            status: deleted.status,
            version: deleted.version,
            deletedAt: new Date().toISOString(),
          }
        : item,
    );
  } catch (error) {
    materialError.value =
      error instanceof ApiError &&
      (error.code === 'ACTION_FORBIDDEN' ||
        error.code === 'CUSTOMER_ACTION_FORBIDDEN')
        ? '当前账号无权移除客户材料'
        : error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
          ? '材料已不存在，请刷新后核对'
          : '材料没有移除，可能已被流程引用或版本已变化';
  }
}

async function restore(material: OwnerMaterial): Promise<void> {
  materialError.value = '';
  try {
    const restored = await restoreMaterial(material.id, material.version);
    materials.value = materials.value.map((item) =>
      item.id === material.id
        ? {
            ...item,
            status: restored.status,
            version: restored.version,
            deletedAt: null,
          }
        : item,
    );
  } catch (error) {
    materialError.value =
      error instanceof ApiError &&
      (error.code === 'ACTION_FORBIDDEN' ||
        error.code === 'CUSTOMER_ACTION_FORBIDDEN')
        ? '当前账号无权恢复客户材料'
        : error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
          ? '材料已不存在，请刷新后核对'
          : '材料没有恢复，请刷新后核对当前状态';
  }
}

function selectedDocumentVersionIds(): string[] {
  const usable = activeMaterials.value.flatMap((material) => {
    const version = currentVersion(material);
    return version === undefined ? [] : [{ material, version }];
  });
  if (identityType.value !== 'NATIONAL_ID') {
    return usable
      .filter(({ material }) => material.purpose === 'IDENTITY_FULL')
      .map(({ version }) => version.id);
  }
  const full = usable.find(
    ({ material, version }) =>
      material.purpose === 'IDENTITY_FULL' &&
      version.mimeType === 'application/pdf',
  );
  if (full) return [full.version.id];
  const front = usable.find(
    ({ material, version }) =>
      material.purpose === 'IDENTITY_FRONT' &&
      (version.mimeType === 'image/jpeg' || version.mimeType === 'image/png'),
  );
  const back = usable.find(
    ({ material, version }) =>
      material.purpose === 'IDENTITY_BACK' &&
      (version.mimeType === 'image/jpeg' || version.mimeType === 'image/png'),
  );
  return front && back ? [front.version.id, back.version.id] : [];
}

function validate(): AdmitCustomerInput | undefined {
  const errors: string[] = [];
  if (!name.value.trim()) errors.push('请填写客户名称');
  if (!isCustomerTypeCode(customerType.value))
    errors.push('请选择客户主体类型');
  if (!isIdentityTypeCode(identityType.value))
    errors.push('请选择兼容的证件类型');
  if (
    isCustomerTypeCode(customerType.value) &&
    isIdentityTypeCode(identityType.value) &&
    !identityCompatibility[customerType.value].includes(identityType.value)
  ) {
    errors.push('证件类型与客户主体类型不匹配');
  }
  if (!identityNumber.value.trim()) errors.push('请填写证件号码');
  if (!admissionContactName.value.trim()) errors.push('请填写准入联系人姓名');
  const phone = admissionContactPhone.value.trim();
  const email = admissionContactEmail.value.trim();
  if (!phone && !email) errors.push('联系人至少填写电话或邮箱');
  if (phone && !/^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u.test(phone)) {
    errors.push('联系人电话格式不正确');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    errors.push('联系人邮箱格式不正确');
  }
  if (identityValidityMode.value === 'FIXED') {
    if (!identityValidTo.value) errors.push('固定有效期请填写截止日期');
    if (
      identityValidFrom.value &&
      identityValidTo.value &&
      identityValidTo.value < identityValidFrom.value
    ) {
      errors.push('证件截止日期不能早于开始日期');
    }
  }
  const contentVersionIds = selectedDocumentVersionIds();
  if (contentVersionIds.length === 0) {
    errors.push(
      identityType.value === 'NATIONAL_ID'
        ? '身份证需要合并 PDF，或同时上传人像面和国徽面'
        : '请上传至少一份完整证件材料',
    );
  }
  formError.value = errors.join('；');
  if (
    errors.length > 0 ||
    !isCustomerTypeCode(customerType.value) ||
    !isIdentityTypeCode(identityType.value)
  ) {
    return undefined;
  }
  return {
    expectedVersion: expectedVersion.value,
    customerType: customerType.value,
    name: name.value.trim(),
    identityType: identityType.value,
    identityNumber: identityNumber.value.trim(),
    ...(issuingCountryOrRegion.value.trim()
      ? { issuingCountryOrRegion: issuingCountryOrRegion.value.trim() }
      : {}),
    ...(identityValidFrom.value
      ? { identityValidFrom: identityValidFrom.value }
      : {}),
    ...(identityValidityMode.value === 'FIXED' && identityValidTo.value
      ? { identityValidTo: identityValidTo.value }
      : {}),
    identityValidityMode: identityValidityMode.value,
    admissionContactName: admissionContactName.value.trim(),
    ...(phone ? { admissionContactPhone: phone } : {}),
    ...(email ? { admissionContactEmail: email } : {}),
    identityDocumentContentVersionIds: contentVersionIds,
  };
}

function commandKey(input: AdmitCustomerInput): string {
  const fingerprint = JSON.stringify(input);
  if (pendingCommand?.fingerprint === fingerprint) return pendingCommand.key;
  const key =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `admit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  pendingCommand = { fingerprint, key };
  return key;
}

async function refreshAfterConflict(): Promise<void> {
  try {
    const latest = await getCustomer(props.customer.id);
    if (latest.profileStatus === 'admitted') {
      emit('admitted', latest);
      return;
    }
    expectedVersion.value = latest.version;
    emit('customer-refreshed', latest);
    await reloadMaterials();
    staleReview.value = true;
    pendingCommand = undefined;
    formError.value = `客户资料已被他人更新，已读取最新版本 ${latest.version}。已保留当前填写内容，请核对后重试。`;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CUSTOMER_NOT_FOUND') {
      emit('customer-not-found');
      return;
    }
    formError.value = '客户版本已变化，但最新资料读取失败，请稍后重试';
  }
}

async function submit(): Promise<void> {
  if (
    submitting.value ||
    uploadingFilename.value ||
    externalSnapshotChanged.value ||
    !canManageMaterials.value
  )
    return;
  identityNumberError.value = '';
  const input = validate();
  if (input === undefined) return;
  submitting.value = true;
  formError.value = '';
  try {
    const admitted = await admitCustomer(
      props.customer.id,
      input,
      commandKey(input),
    );
    pendingCommand = undefined;
    expectedVersion.value = admitted.version;
    emit('admitted', admitted);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === 'CUSTOMER_VERSION_CONFLICT'
    ) {
      await refreshAfterConflict();
    } else if (
      error instanceof ApiError &&
      (error.code === 'RESOURCE_NOT_FOUND' ||
        error.code === 'CUSTOMER_NOT_FOUND')
    ) {
      pendingCommand = undefined;
      emit('customer-not-found');
    } else {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        pendingCommand = undefined;
      }
      if (
        error instanceof ApiError &&
        error.code === 'CUSTOMER_IDENTITY_DUPLICATE'
      ) {
        identityNumberError.value =
          '该证件号码已用于其他客户，请核对号码或打开已有客户';
        formError.value = identityNumberError.value;
        identityNumberInput.value?.focus();
      } else if (
        error instanceof ApiError &&
        (error.code === 'CUSTOMER_DOCUMENT_INVALID' ||
          error.code === 'MATERIAL_VERSION_INVALID')
      ) {
        materialError.value =
          '证件材料已失效或不符合准入要求，请刷新后重新选择有效材料';
        formError.value = materialError.value;
      } else if (
        error instanceof ApiError &&
        (error.code === 'ACTION_FORBIDDEN' ||
          error.code === 'CUSTOMER_ACTION_FORBIDDEN')
      ) {
        formError.value = '当前账号无权执行客户准入，请联系管理员授权';
      } else if (
        error instanceof ApiError &&
        error.code === 'CUSTOMER_ADMISSION_INCOMPLETE'
      ) {
        formError.value =
          '准入条件还不完整，请核对主体、证件、有效期、联系人和材料';
      } else {
        formError.value = '准入没有完成，已保留当前填写内容，请稍后重试';
      }
    }
  } finally {
    submitting.value = false;
  }
}

void reloadMaterials();
</script>

<template>
  <section
    class="admission-panel ledger-panel"
    aria-labelledby="admission-title"
  >
    <div class="admission-heading">
      <div>
        <p class="section-kicker">
          {{ canManageMaterials ? '客户准入' : '客户材料' }}
        </p>
        <h2 id="admission-title">
          {{ canManageMaterials ? '补齐客户身份证明并准入' : '身份证明材料' }}
        </h2>
        <p>
          {{
            canManageMaterials
              ? '选择主体与证件，上传真实材料，一次确认即可完成。'
              : '可查看并下载当前有权访问的客户材料。'
          }}
        </p>
      </div>
      <span class="admission-step">{{
        canManageMaterials ? '01 · 准入' : '只读'
      }}</span>
    </div>

    <form @submit.prevent="submit">
      <div v-if="canManageMaterials" class="admission-grid">
        <label>
          <span>客户组织类型<RequiredFieldMark /></span>
          <select
            v-model="customerType"
            name="customerType"
            class="text-input"
            @change="onCustomerTypeChanged"
          >
            <option value="">请选择</option>
            <option
              v-for="option in customerTypeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>身份证明类型<RequiredFieldMark /></span>
          <select
            v-model="identityType"
            name="identityType"
            class="text-input"
            @change="onIdentityTypeChanged"
          >
            <option value="">请选择</option>
            <option
              v-for="option in compatibleOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="admission-grid__wide">
          <span>客户名称<RequiredFieldMark /></span>
          <input
            v-model="name"
            name="admissionName"
            class="text-input"
            maxlength="200"
          />
        </label>
        <label>
          <span>证件号码<RequiredFieldMark /></span>
          <input
            ref="identityNumberInput"
            v-model="identityNumber"
            name="identityNumber"
            class="text-input"
            maxlength="100"
            :aria-invalid="identityNumberError ? 'true' : undefined"
            @input="identityNumberError = ''"
          />
          <small v-if="identityNumberError" class="field-error">
            {{ identityNumberError }}
          </small>
        </label>
        <label>
          <span>签发国家／地区（选填）</span>
          <input
            v-model="issuingCountryOrRegion"
            name="issuingCountryOrRegion"
            class="text-input"
            maxlength="100"
          />
        </label>
        <label>
          <span>有效期类型<RequiredFieldMark /></span>
          <select
            v-model="identityValidityMode"
            name="identityValidityMode"
            class="text-input"
          >
            <option
              v-for="option in identityValidityModeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>有效期开始（选填）</span>
          <input
            v-model="identityValidFrom"
            name="identityValidFrom"
            class="text-input"
            type="date"
          />
        </label>
        <label v-if="identityValidityMode === 'FIXED'">
          <span>有效期截止<RequiredFieldMark /></span>
          <input
            v-model="identityValidTo"
            name="identityValidTo"
            class="text-input"
            type="date"
          />
        </label>
      </div>

      <fieldset v-if="canManageMaterials" class="admission-section">
        <legend>准入联系人</legend>
        <div class="admission-grid admission-grid--three">
          <label>
            <span>联系人姓名<RequiredFieldMark /></span>
            <input
              v-model="admissionContactName"
              name="admissionContactName"
              class="text-input"
              maxlength="100"
            />
          </label>
          <label>
            <span>电话</span>
            <input
              v-model="admissionContactPhone"
              name="admissionContactPhone"
              class="text-input"
              maxlength="30"
            />
          </label>
          <label>
            <span>邮箱</span>
            <input
              v-model="admissionContactEmail"
              name="admissionContactEmail"
              class="text-input"
              maxlength="254"
            />
          </label>
        </div>
      </fieldset>

      <fieldset class="admission-section material-section">
        <legend>身份证明材料</legend>
        <div class="upload-row">
          <label v-if="canManageMaterials">
            <span>材料用途<RequiredFieldMark /></span>
            <span v-if="purposeOptions.length === 1" class="sole-choice">
              完整身份证明材料
            </span>
            <select
              v-else
              v-model="documentPurpose"
              name="documentPurpose"
              class="text-input"
            >
              <option
                v-for="option in purposeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label
            v-if="canManageMaterials"
            class="file-picker"
            :class="{ 'file-picker--busy': uploadingFilename }"
          >
            <input
              name="identityDocument"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              :disabled="Boolean(uploadingFilename)"
              aria-describedby="identity-document-guidance"
              @change="upload"
            />
            <span>{{
              uploadingFilename
                ? `正在上传${uploadingFilename}`
                : '选择并上传文件'
            }}</span>
          </label>
          <ElButton
            data-test="reload-materials"
            :loading="materialsLoading"
            @click="reloadMaterials"
          >
            刷新材料
          </ElButton>
        </div>
        <p
          v-if="canManageMaterials"
          id="identity-document-guidance"
          class="field-help"
        >
          支持 PDF、JPG/JPEG、PNG；单份不超过 20MB，最多 10 份。
        </p>
        <p v-if="materialError" class="field-error" role="alert">
          {{ materialError }}
        </p>
        <div v-if="materials.length" class="material-list">
          <article
            v-for="material in materials"
            :key="material.id"
            class="material-card"
            :class="{ 'material-card--deleted': material.status === 'DELETED' }"
          >
            <div>
              <strong>{{
                currentVersion(material)?.originalFilename || '材料版本不可用'
              }}</strong>
              <small>{{
                purposeOptions.find(
                  (option) => option.value === material.purpose,
                )?.label || material.purpose
              }}</small>
            </div>
            <div class="material-actions">
              <button
                v-if="material.status === 'ACTIVE'"
                :data-test="`download-material-${material.id}`"
                type="button"
                @click="download(material)"
              >
                下载
              </button>
              <button
                v-if="material.status === 'ACTIVE' && canManageMaterials"
                :data-test="`remove-material-${material.id}`"
                type="button"
                @click="remove(material)"
              >
                移除
              </button>
              <button
                v-else-if="canManageMaterials"
                :data-test="`restore-material-${material.id}`"
                type="button"
                @click="restore(material)"
              >
                恢复
              </button>
            </div>
          </article>
        </div>
        <p v-else-if="!materialsLoading" class="empty-material">
          尚未上传身份证明。
        </p>
      </fieldset>

      <p v-if="formError" class="submit-error" role="alert">{{ formError }}</p>
      <div v-if="canManageMaterials" class="admission-submit">
        <p>准入后即可用于创建正式线索。</p>
        <ElButton
          v-if="externalSnapshotChanged"
          data-test="reload-customer-snapshot"
          @click="loadCustomerSnapshot"
        >
          重新载入客户资料
        </ElButton>
        <ElButton
          v-if="staleReview && !externalSnapshotChanged"
          data-test="retry-admission"
          @click="
            staleReview = false;
            submit();
          "
        >
          核对后重试
        </ElButton>
        <ElButton
          data-test="admit-submit"
          native-type="submit"
          type="primary"
          :loading="submitting"
          :disabled="
            submitting ||
            Boolean(uploadingFilename) ||
            staleReview ||
            externalSnapshotChanged
          "
        >
          确认准入
        </ElButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.admission-panel {
  margin-top: 24px;
  padding: 28px;
  border-top: 4px solid var(--ink, #1e2925);
}

.admission-heading,
.admission-submit,
.upload-row,
.material-card,
.material-actions {
  display: flex;
  align-items: center;
}

.admission-heading,
.admission-submit,
.material-card {
  justify-content: space-between;
  gap: 20px;
}

.admission-heading h2 {
  margin: 4px 0 6px;
  font-size: 24px;
}

.admission-heading p,
.admission-submit p {
  margin: 0;
  color: var(--text-muted, #66736d);
}

.admission-step {
  color: var(--accent, #a45f31);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  white-space: nowrap;
}

.admission-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  margin-top: 24px;
}

.admission-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 0;
}

.admission-grid__wide {
  grid-column: 1 / -1;
}

.admission-grid label,
.upload-row label {
  display: grid;
  gap: 7px;
  color: var(--text-muted, #66736d);
  font-size: 13px;
  font-weight: 650;
}

.admission-section {
  margin: 26px 0 0;
  padding: 20px 0 0;
  border: 0;
  border-top: 1px solid var(--line, #d9ddd9);
}

.admission-section legend {
  padding: 0 12px 0 0;
  font-weight: 750;
}

.upload-row {
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
}

.upload-row > label:first-child {
  min-width: 210px;
}

.file-picker {
  position: relative;
  min-height: 42px;
  padding: 0 18px;
  place-items: center;
  border: 1px dashed var(--accent, #a45f31);
  background: #fffaf5;
  color: var(--accent, #a45f31) !important;
  cursor: pointer;
  overflow: hidden;
}

.file-picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.file-picker--busy {
  opacity: 0.65;
  cursor: wait;
}

.material-list {
  display: grid;
  gap: 9px;
  margin-top: 16px;
}

.material-card {
  padding: 13px 15px;
  border: 1px solid var(--line, #d9ddd9);
  background: #fbfcfa;
}

.material-card strong,
.material-card small {
  display: block;
}

.material-card small {
  margin-top: 4px;
  color: var(--text-muted, #66736d);
}

.material-card--deleted {
  opacity: 0.62;
}

.material-actions {
  gap: 12px;
}

.material-actions button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent, #a45f31);
  cursor: pointer;
}

.empty-material,
.field-help {
  color: var(--text-muted, #66736d);
  font-size: 13px;
}

.admission-submit {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--line, #d9ddd9);
}

@media (max-width: 720px) {
  .admission-grid,
  .admission-grid--three {
    grid-template-columns: 1fr;
  }

  .admission-grid__wide {
    grid-column: auto;
  }

  .admission-heading,
  .admission-submit {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
