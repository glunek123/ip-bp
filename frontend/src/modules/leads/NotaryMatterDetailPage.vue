<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import {
  deleteMaterial,
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type OwnerMaterial,
} from '../../api/materials';
import {
  getNotaryMatter,
  recordNotaryEvidence,
  recordNotaryOpening,
  type NotaryMatterDetail,
  type RecordNotaryEvidenceInput,
  type RecordNotaryOpeningInput,
} from '../../api/notary';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const matter = ref<NotaryMatterDetail>();
const downloadError = ref('');
const evidenceDate = ref('');
const sampleFeeState = ref('');
const sampleFeeAmount = ref('');
const logisticsRows = ref([
  { companyState: '', companyValue: '', trackingState: '', trackingValue: '' },
]);
const evidenceErrors = ref<string[]>([]);
const evidenceError = ref('');
const evidenceSuccess = ref('');
const submittingEvidence = ref(false);
const openingSenderName = ref('');
const openingSenderPhone = ref('');
const openingSenderAddress = ref('');
type OpeningPhotoDraft = {
  localId: number;
  materialId?: string;
  contentVersionId?: string;
  originalFilename: string;
  mimeType: string;
  version: number | null;
  selected: boolean;
  file?: InstanceType<typeof globalThis.File>;
  uploading: boolean;
  error?: string;
};
const openingPhotos = ref<OpeningPhotoDraft[]>([]);
const openingUploadError = ref('');
const openingMaterialsError = ref('');
const openingError = ref('');
const openingSuccess = ref('');
const uploadingOpeningPhotos = ref(false);
const submittingOpening = ref(false);
const deletingOpeningMaterialId = ref<string | null>(null);
const refreshingOpeningPhotos = ref(false);
let evidenceIdempotencyKey = '';
let evidenceSubmissionFingerprint = '';
let openingIdempotencyKey = '';
let openingSubmissionFingerprint = '';
let request: AbortController | undefined;
let nextOpeningPhotoLocalId = 1;

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function hasSavedEvidence(value: NotaryMatterDetail | undefined): boolean {
  return value?.stage === 'WAITING_UNBOX' && value.evidence !== null;
}

function hasSavedOpening(value: NotaryMatterDetail | undefined): boolean {
  return value?.stage === 'UNBOX_REVIEW' && value.opening !== null;
}

async function load(): Promise<boolean> {
  evidenceIdempotencyKey = '';
  evidenceSubmissionFingerprint = '';
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const current = await getNotaryMatter(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return false;
    matter.value = current;
    state.value = 'ready';
    if (current.stage === 'WAITING_UNBOX') {
      await refreshOpeningPhotos(current.id);
    } else {
      openingPhotos.value = [];
      openingMaterialsError.value = '';
    }
    return true;
  } catch (error) {
    if (controller.signal.aborted) return false;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
    return false;
  }
}

const allowedOpeningPhotoTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const maxOpeningPhotoSize = 20 * 1024 * 1024;

function openingPhotoDraftsFromMaterials(
  items: OwnerMaterial[],
  selectedContentVersionIds: ReadonlySet<string>,
): OpeningPhotoDraft[] {
  return items.flatMap((material) => {
    if (
      material.ownerType !== 'NOTARY_MATTER' ||
      material.ownerId !== matter.value?.id ||
      material.category !== 'NOTARY_OPENING_PHOTO' ||
      material.purpose !== 'NOTARY_OPENING_PHOTO' ||
      material.status !== 'ACTIVE' ||
      material.currentVersionId === null
    ) {
      return [];
    }
    const content = material.contentVersions.find(
      (version) => version.id === material.currentVersionId,
    );
    if (!content) return [];
    return [
      {
        localId: nextOpeningPhotoLocalId++,
        materialId: material.id,
        contentVersionId: content.id,
        originalFilename: content.originalFilename,
        mimeType: content.mimeType,
        version: material.version,
        selected: selectedContentVersionIds.has(content.id),
        uploading: false,
      },
    ];
  });
}

async function refreshOpeningPhotos(matterId: string): Promise<void> {
  if (refreshingOpeningPhotos.value) return;
  refreshingOpeningPhotos.value = true;
  openingMaterialsError.value = '';
  const selectedIds = new Set(
    openingPhotos.value
      .filter((photo) => photo.selected && photo.contentVersionId)
      .map((photo) => photo.contentVersionId as string),
  );
  try {
    const result = await listOwnerMaterials('NOTARY_MATTER', matterId);
    const serverPhotos = openingPhotoDraftsFromMaterials(
      result.items,
      selectedIds,
    );
    const localPhotos = openingPhotos.value.filter(
      (photo) => !photo.materialId,
    );
    openingPhotos.value = [...serverPhotos, ...localPhotos];
  } catch {
    openingMaterialsError.value = '开箱照片列表读取失败，请刷新重试';
  } finally {
    refreshingOpeningPhotos.value = false;
  }
}

async function uploadOpeningFiles(
  event: InstanceType<typeof globalThis.Event>,
): Promise<void> {
  if (
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    refreshingOpeningPhotos.value
  ) {
    return;
  }
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  openingUploadError.value = '';
  if (openingPhotos.value.length + files.length > 50) {
    openingUploadError.value = '开箱照片最多上传 50 张';
    return;
  }
  const accepted: OpeningPhotoDraft[] = [];
  for (const file of files) {
    if (!allowedOpeningPhotoTypes.has(file.type)) {
      openingUploadError.value = '仅支持 JPEG、PNG 或 WEBP 格式的开箱照片';
      continue;
    }
    if (file.size > maxOpeningPhotoSize) {
      openingUploadError.value = '单张开箱照片不能超过 20 MB';
      continue;
    }
    accepted.push({
      localId: nextOpeningPhotoLocalId++,
      originalFilename: file.name,
      mimeType: file.type,
      version: null,
      selected: false,
      file,
      uploading: false,
    });
  }
  openingPhotos.value.push(...accepted);
  if (accepted.length === 0) return;
  uploadingOpeningPhotos.value = true;
  try {
    for (const photo of accepted) await uploadOpeningPhoto(photo);
  } finally {
    uploadingOpeningPhotos.value = false;
  }
}

async function uploadOpeningPhoto(photo: OpeningPhotoDraft): Promise<void> {
  if (!photo.file) return;
  photo.error = undefined;
  photo.uploading = true;
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'NOTARY_MATTER',
      ownerId: matter.value?.id ?? String(route.params.id),
      category: 'NOTARY_OPENING_PHOTO',
      purpose: 'NOTARY_OPENING_PHOTO',
      file: photo.file,
    });
    photo.materialId = uploaded.materialId;
    photo.contentVersionId = uploaded.contentVersionId;
    photo.originalFilename = uploaded.originalFilename;
    photo.mimeType = uploaded.mimeType;
    photo.selected = true;
    await refreshOpeningPhotos(matter.value?.id ?? String(route.params.id));
  } catch {
    photo.error = '上传失败，可移除后重试';
  } finally {
    photo.uploading = false;
  }
}

async function retryOpeningPhoto(photo: OpeningPhotoDraft): Promise<void> {
  if (!photo.file) return;
  uploadingOpeningPhotos.value = true;
  try {
    await uploadOpeningPhoto(photo);
  } finally {
    uploadingOpeningPhotos.value = false;
  }
}

function removeLocalOpeningPhoto(localId: number): void {
  if (
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    refreshingOpeningPhotos.value
  ) {
    return;
  }
  openingPhotos.value = openingPhotos.value.filter(
    (photo) => photo.localId !== localId,
  );
}

async function deleteOpeningPhoto(photo: OpeningPhotoDraft): Promise<void> {
  if (
    !photo.materialId ||
    photo.version === null ||
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    refreshingOpeningPhotos.value ||
    matter.value?.stage !== 'WAITING_UNBOX' ||
    !matter.value.capabilities.recordOpening
  ) {
    return;
  }
  deletingOpeningMaterialId.value = photo.materialId;
  photo.error = undefined;
  try {
    await deleteMaterial(photo.materialId, photo.version);
    openingPhotos.value = openingPhotos.value.filter(
      (candidate) => candidate.materialId !== photo.materialId,
    );
  } catch {
    photo.error = '删除失败，材料仍保留在待提交列表中';
  } finally {
    deletingOpeningMaterialId.value = null;
  }
}

async function submitOpening(): Promise<void> {
  openingError.value = '';
  openingSuccess.value = '';
  openingUploadError.value = '';
  const current = matter.value;
  if (
    !current?.capabilities.recordOpening ||
    current.stage !== 'WAITING_UNBOX' ||
    !openingPhotos.value.some((photo) => photo.selected) ||
    openingPhotos.value.some(
      (photo) => photo.selected && (photo.uploading || !photo.contentVersionId),
    ) ||
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    submittingOpening.value
  ) {
    if (!openingPhotos.value.some((photo) => photo.selected))
      openingUploadError.value = '至少上传一张开箱照片';
    else if (
      openingPhotos.value.some(
        (photo) => photo.selected && !photo.contentVersionId,
      )
    )
      openingUploadError.value = '请先完成所选照片上传';
    return;
  }
  const input: RecordNotaryOpeningInput = {
    expectedVersion: current.version,
    contentVersionIds: openingPhotos.value
      .filter((photo) => photo.selected && photo.contentVersionId)
      .map((photo) => photo.contentVersionId as string),
    ...(openingSenderName.value.trim()
      ? { senderName: openingSenderName.value.trim() }
      : {}),
    ...(openingSenderPhone.value.trim()
      ? { senderPhone: openingSenderPhone.value.trim() }
      : {}),
    ...(openingSenderAddress.value.trim()
      ? { senderAddress: openingSenderAddress.value.trim() }
      : {}),
  };
  const fingerprint = JSON.stringify(input);
  if (fingerprint !== openingSubmissionFingerprint) {
    openingIdempotencyKey = globalThis.crypto.randomUUID();
    openingSubmissionFingerprint = fingerprint;
  }
  submittingOpening.value = true;
  try {
    await recordNotaryOpening(current.id, input, openingIdempotencyKey);
    await load();
    if (hasSavedOpening(matter.value)) {
      openingPhotos.value = [];
      openingIdempotencyKey = '';
      openingSubmissionFingerprint = '';
      openingSuccess.value = '开箱记录已保存，事项已进入开箱审核。';
    } else {
      openingError.value = '提交已受理，但暂时无法读取保存结果，请刷新确认。';
    }
  } catch (error) {
    openingError.value =
      error instanceof ApiError &&
      ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_STATE'].includes(
        error.code,
      )
        ? '事项状态或提交内容已变化，请刷新后再试。'
        : '开箱记录提交失败，请检查网络后重试。';
  } finally {
    submittingOpening.value = false;
  }
}

async function downloadMaterial(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, contentVersionId);
  } catch {
    downloadError.value = '附件下载失败，请稍后重试';
  }
}

function addLogisticsRow(): void {
  logisticsRows.value.push({
    companyState: '',
    companyValue: '',
    trackingState: '',
    trackingValue: '',
  });
}

function removeLogisticsRow(index: number): void {
  if (logisticsRows.value.length > 1) logisticsRows.value.splice(index, 1);
}

async function submitEvidence(): Promise<void> {
  evidenceErrors.value = [];
  evidenceError.value = '';
  evidenceSuccess.value = '';
  const errors: string[] = [];
  if (!evidenceDate.value) errors.push('请选择取证日期');
  if (!sampleFeeState.value) errors.push('请选择样品费用状态');
  if (
    sampleFeeState.value === 'KNOWN' &&
    !/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(sampleFeeAmount.value)
  )
    errors.push('已知样品费用请输入非负且保留两位小数的金额');
  if (logisticsRows.value.length < 1) errors.push('至少登记一条物流信息');
  logisticsRows.value.forEach((row, index) => {
    if (!row.companyState) errors.push(`第${index + 1}条请选择快递公司状态`);
    else if (row.companyState === 'PRESENT' && !row.companyValue.trim())
      errors.push(`第${index + 1}条请填写快递公司`);
    if (!row.trackingState) errors.push(`第${index + 1}条请选择快递单号状态`);
    else if (row.trackingState === 'PRESENT' && !row.trackingValue.trim())
      errors.push(`第${index + 1}条请填写快递单号`);
  });
  evidenceErrors.value = errors;
  if (
    errors.length ||
    !matter.value?.capabilities.recordEvidence ||
    matter.value.stage !== 'PENDING_EVIDENCE'
  )
    return;

  const current = matter.value;
  const feeInput =
    sampleFeeState.value === 'KNOWN'
      ? {
          sampleFeeState: 'KNOWN' as const,
          sampleFeeAmount: sampleFeeAmount.value,
        }
      : { sampleFeeState: 'PENDING' as const };
  const input: RecordNotaryEvidenceInput = {
    evidenceAt: evidenceDate.value,
    ...feeInput,
    logistics: logisticsRows.value.map((row) => ({
      companyState: row.companyState as 'PRESENT' | 'NONE',
      companyValue:
        row.companyState === 'PRESENT' ? row.companyValue.trim() : null,
      trackingState: row.trackingState as 'PRESENT' | 'NONE',
      trackingValue:
        row.trackingState === 'PRESENT' ? row.trackingValue.trim() : null,
    })),
    expectedVersion: current.version,
  };
  submittingEvidence.value = true;
  const fingerprint = JSON.stringify(input);
  if (fingerprint !== evidenceSubmissionFingerprint) {
    evidenceIdempotencyKey = globalThis.crypto.randomUUID();
    evidenceSubmissionFingerprint = fingerprint;
  }
  try {
    await recordNotaryEvidence(current.id, input, evidenceIdempotencyKey);
    evidenceIdempotencyKey = '';
    evidenceSubmissionFingerprint = '';
    const loaded = await load();
    if (loaded && hasSavedEvidence(matter.value)) {
      evidenceSuccess.value = '取证物流已登记，事项已进入待开箱。';
    } else {
      evidenceError.value = '取证已提交，但暂时无法读取保存结果，请刷新确认。';
    }
  } catch (error) {
    evidenceError.value =
      error instanceof ApiError &&
      ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_STATE'].includes(
        error.code,
      )
        ? '事项状态或提交内容已变化，请刷新后再试。'
        : '取证物流登记失败，请检查网络或刷新后重试。';
  } finally {
    submittingEvidence.value = false;
  }
}

onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink
        v-if="matter"
        class="back-link"
        :to="`/leads/${matter.sourceLead.id}`"
        >← 返回来源线索</RouterLink
      >
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取取证批次</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>取证批次不存在或当前不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>取证批次暂时无法加载</h1>
        <ElButton data-test="refresh-matter" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="matter">
        <div class="page-head">
          <div>
            <span class="pill">{{
              matter.stage === 'UNBOX_REVIEW'
                ? '开箱审核中'
                : matter.stage === 'WAITING_UNBOX'
                  ? '等待开箱'
                  : '待公证处取证'
            }}</span>
            <h1>{{ matter.businessNo }}</h1>
          </div>
          <ElButton
            data-test="refresh-matter"
            text
            :disabled="
              deletingOpeningMaterialId !== null || refreshingOpeningPhotos
            "
            @click="load"
            >刷新</ElButton
          >
        </div>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-matter-detail"
        >
          <h2 class="form-section-title">批次信息</h2>
          <dl class="demo-detail-grid">
            <div>
              <dt>来源线索</dt>
              <dd>
                <RouterLink
                  data-test="notary-matter-source-lead"
                  :to="`/leads/${matter.sourceLead.id}`"
                  >{{ matter.sourceLead.businessNo }}</RouterLink
                >
              </dd>
            </div>
            <div>
              <dt>公证处</dt>
              <dd>{{ matter.notaryOffice.name }}</dd>
            </div>
            <div>
              <dt>办理方式</dt>
              <dd>线上购买</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd class="mono">{{ formatTime(matter.createdAt) }}</dd>
            </div>
            <div class="detail-grid__wide">
              <dt>本批次用途</dt>
              <dd>{{ matter.batchPurpose }}</dd>
            </div>
          </dl>
        </section>
        <section
          v-if="matter.stage === 'WAITING_UNBOX'"
          class="demo-card demo-card--pad"
          data-test="opening-form"
        >
          <h2 class="form-section-title">登记开箱材料</h2>
          <p>提交后事项将进入开箱审核。</p>
          <form data-test="record-opening" @submit.prevent="submitOpening">
            <label v-if="matter.capabilities.recordOpening"
              >开箱照片（JPEG、PNG、WEBP；单张不超过 20 MB，最多 50
              张）<RequiredFieldMark />
              <input
                v-if="matter.capabilities.recordOpening"
                data-test="opening-photo-files"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                :disabled="
                  uploadingOpeningPhotos ||
                  deletingOpeningMaterialId !== null ||
                  refreshingOpeningPhotos
                "
                @change="uploadOpeningFiles"
              />
            </label>
            <p v-if="matter.capabilities.recordOpening" class="muted-copy">
              删除会释放材料配额，并从本次待提交选择中移除。
            </p>
            <p v-if="openingMaterialsError" class="field-error" role="alert">
              {{ openingMaterialsError }}
            </p>
            <div data-test="opening-staged-materials">
              <p v-if="openingPhotos.length === 0">暂无待提交开箱照片。</p>
              <ul v-else>
                <li
                  v-for="photo in openingPhotos"
                  :key="photo.contentVersionId || `local-${photo.localId}`"
                  :data-test="
                    photo.contentVersionId
                      ? `opening-staged-row-${photo.contentVersionId}`
                      : undefined
                  "
                >
                  <label v-if="photo.contentVersionId">
                    <input
                      v-if="matter.capabilities.recordOpening"
                      v-model="photo.selected"
                      type="checkbox"
                      :data-test="`select-opening-photo-${photo.contentVersionId}`"
                      :disabled="
                        uploadingOpeningPhotos ||
                        deletingOpeningMaterialId !== null ||
                        refreshingOpeningPhotos
                      "
                    />
                    {{ photo.originalFilename }}（{{ photo.mimeType }}）
                  </label>
                  <span v-else>
                    {{ photo.originalFilename }} —
                    {{ photo.uploading ? '正在上传' : photo.error || '待上传' }}
                  </span>
                  <ElButton
                    v-if="
                      photo.materialId &&
                      photo.version !== null &&
                      matter.capabilities.recordOpening
                    "
                    text
                    :data-test="`delete-opening-photo-${photo.materialId}`"
                    :disabled="
                      deletingOpeningMaterialId !== null ||
                      uploadingOpeningPhotos ||
                      refreshingOpeningPhotos
                    "
                    @click="deleteOpeningPhoto(photo)"
                    >删除并释放配额</ElButton
                  >
                  <p
                    v-if="photo.error && photo.materialId"
                    :data-test="`opening-delete-error-${photo.materialId}`"
                    class="field-error"
                    role="alert"
                  >
                    {{ photo.error }}
                  </p>
                  <button
                    v-if="photo.error && !photo.materialId && photo.file"
                    type="button"
                    :disabled="
                      uploadingOpeningPhotos ||
                      deletingOpeningMaterialId !== null ||
                      refreshingOpeningPhotos
                    "
                    @click="retryOpeningPhoto(photo)"
                  >
                    重试上传
                  </button>
                  <button
                    v-if="!photo.materialId && !photo.uploading"
                    type="button"
                    :disabled="
                      uploadingOpeningPhotos ||
                      deletingOpeningMaterialId !== null ||
                      refreshingOpeningPhotos
                    "
                    :data-test="`remove-local-opening-photo-${photo.localId}`"
                    @click="removeLocalOpeningPhoto(photo.localId)"
                  >
                    移除此照片
                  </button>
                </li>
              </ul>
            </div>
            <label v-if="matter.capabilities.recordOpening"
              >寄件人姓名<input
                v-model="openingSenderName"
                data-test="opening-sender-name"
                maxlength="120"
            /></label>
            <label v-if="matter.capabilities.recordOpening"
              >寄件人电话<input
                v-model="openingSenderPhone"
                data-test="opening-sender-phone"
                maxlength="50"
            /></label>
            <label v-if="matter.capabilities.recordOpening"
              >寄件人地址<input
                v-model="openingSenderAddress"
                data-test="opening-sender-address"
                maxlength="500"
            /></label>
            <p v-if="openingUploadError" class="field-error" role="alert">
              {{ openingUploadError }}
            </p>
            <p v-if="openingError" class="field-error" role="alert">
              {{ openingError }}
            </p>
            <p v-if="openingSuccess" role="status">{{ openingSuccess }}</p>
            <ElButton
              v-if="matter.capabilities.recordOpening"
              data-test="record-opening-submit"
              native-type="submit"
              :loading="submittingOpening"
              :disabled="
                submittingOpening ||
                uploadingOpeningPhotos ||
                deletingOpeningMaterialId !== null ||
                refreshingOpeningPhotos
              "
              >登记开箱并进入审核</ElButton
            >
          </form>
        </section>
        <section
          v-else-if="matter.opening"
          class="demo-card demo-card--pad"
          data-test="saved-opening"
        >
          <h2 class="form-section-title">开箱记录</h2>
          <p>寄件人：{{ matter.opening.senderName || '未登记' }}</p>
          <p>电话：{{ matter.opening.senderPhone || '未登记' }}</p>
          <p>地址：{{ matter.opening.senderAddress || '未登记' }}</p>
          <p>登记时间：{{ formatTime(matter.opening.recordedAt) }}</p>
          <ul>
            <li
              v-for="photo in matter.opening.photos"
              :key="photo.contentVersionId"
            >
              {{ photo.originalFilename }}
              <ElButton
                text
                :data-test="`download-opening-photo-${photo.contentVersionId}`"
                @click="
                  downloadMaterial(photo.materialId, photo.contentVersionId)
                "
                >下载照片</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section
          v-if="
            matter.stage === 'PENDING_EVIDENCE' &&
            matter.capabilities.recordEvidence
          "
          class="demo-card demo-card--pad"
          data-test="evidence-form"
        >
          <h2 class="form-section-title">登记取证物流</h2>
          <p>提交后事项将进入待开箱。</p>
          <form data-test="record-evidence" @submit.prevent="submitEvidence">
            <label
              >取证日期<RequiredFieldMark />
              <input
                v-model="evidenceDate"
                data-test="evidence-date"
                type="date"
                required
            /></label>
            <label
              >样品费用状态<RequiredFieldMark />
              <select
                v-model="sampleFeeState"
                data-test="sample-fee-state"
                required
              >
                <option value="">请选择</option>
                <option value="KNOWN">已知</option>
                <option value="PENDING">待定</option>
              </select>
            </label>
            <label v-if="sampleFeeState === 'KNOWN'"
              >样品费用（元）<RequiredFieldMark />
              <input
                v-model="sampleFeeAmount"
                data-test="sample-fee-amount"
                inputmode="decimal"
                placeholder="0.00"
                required
            /></label>
            <fieldset v-for="(row, index) in logisticsRows" :key="index">
              <legend>物流 {{ index + 1 }}</legend>
              <label
                >快递公司状态<RequiredFieldMark />
                <select
                  v-model="row.companyState"
                  :data-test="`logistics-company-state-${index}`"
                  required
                >
                  <option value="">请选择</option>
                  <option value="PRESENT">有</option>
                  <option value="NONE">无</option>
                </select>
              </label>
              <label v-if="row.companyState === 'PRESENT'"
                >快递公司<RequiredFieldMark />
                <input
                  v-model="row.companyValue"
                  :data-test="`logistics-company-value-${index}`"
                  required
              /></label>
              <p v-else-if="row.companyState === 'NONE'">未登记快递公司</p>
              <label
                >快递单号状态<RequiredFieldMark />
                <select
                  v-model="row.trackingState"
                  :data-test="`logistics-tracking-state-${index}`"
                  required
                >
                  <option value="">请选择</option>
                  <option value="PRESENT">有</option>
                  <option value="NONE">无</option>
                </select>
              </label>
              <label v-if="row.trackingState === 'PRESENT'"
                >快递单号<RequiredFieldMark />
                <input
                  v-model="row.trackingValue"
                  :data-test="`logistics-tracking-value-${index}`"
                  required
              /></label>
              <p v-else-if="row.trackingState === 'NONE'">未登记快递单号</p>
              <button
                v-if="logisticsRows.length > 1"
                type="button"
                @click="removeLogisticsRow(index)"
              >
                删除此条
              </button>
            </fieldset>
            <button type="button" @click="addLogisticsRow">添加物流</button>
            <ul v-if="evidenceErrors.length" class="field-error" role="alert">
              <li v-for="error in evidenceErrors" :key="error">{{ error }}</li>
            </ul>
            <p v-if="evidenceError" class="field-error" role="alert">
              {{ evidenceError }}
            </p>
            <p v-if="evidenceSuccess" role="status">{{ evidenceSuccess }}</p>
            <ElButton
              data-test="record-evidence-submit"
              native-type="submit"
              :loading="submittingEvidence"
              :disabled="submittingEvidence"
              >登记并进入待开箱</ElButton
            >
          </form>
        </section>
        <section
          v-else-if="matter.evidence"
          class="demo-card demo-card--pad"
          data-test="saved-evidence"
        >
          <h2 class="form-section-title">取证物流记录</h2>
          <p>取证日期：{{ matter.evidence.evidenceAt }}</p>
          <p>
            样品费用：{{
              matter.evidence.sampleFeeState === 'PENDING'
                ? '待定'
                : `${matter.evidence.sampleFeeAmount} 元`
            }}
          </p>
          <ul>
            <li v-for="row in matter.evidence.logistics" :key="row.id">
              快递公司：{{
                row.companyState === 'NONE' ? '无' : row.companyValue
              }}；快递单号：{{
                row.trackingState === 'NONE' ? '无' : row.trackingValue
              }}
            </li>
          </ul>
          <p>登记时间：{{ formatTime(matter.evidence.recordedAt) }}</p>
          <p v-if="evidenceSuccess" role="status">{{ evidenceSuccess }}</p>
        </section>
        <section class="demo-card" data-test="notary-matter-products">
          <h2 class="card-section-title">本批次商品</h2>
          <div class="demo-table-wrap">
            <table class="demo-table">
              <thead>
                <tr>
                  <th>名称／链接</th>
                  <th class="num">数量</th>
                  <th class="num">单价</th>
                  <th class="num">评论数</th>
                  <th class="num">估算额</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="product in matter.selectedProducts"
                  :key="product.id"
                >
                  <td>
                    <strong>{{ product.title || '未命名商品' }}</strong>
                    <a
                      v-if="product.url"
                      class="product-link"
                      :href="product.url"
                      target="_blank"
                      rel="noreferrer"
                      >{{ product.url }}</a
                    >
                  </td>
                  <td class="num mono">{{ product.quantity }}</td>
                  <td class="num mono">{{ product.unitPrice }}</td>
                  <td class="num mono">{{ product.commentCount }}</td>
                  <td class="num mono">{{ product.estimatedAmount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section
          class="demo-card demo-card--pad lead-attachments"
          data-test="notary-matter-materials"
        >
          <h2 class="form-section-title">本批次截图</h2>
          <p v-if="matter.selectedMaterials.length === 0">本批次未选择截图。</p>
          <ul v-else>
            <li
              v-for="material in matter.selectedMaterials"
              :key="material.contentVersionId"
            >
              <span>{{ material.originalFilename }}</span>
              <ElButton
                text
                :data-test="`download-matter-material-${material.contentVersionId}`"
                @click="
                  downloadMaterial(
                    material.materialId,
                    material.contentVersionId,
                  )
                "
                >下载附件</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
      </template>
    </main>
  </div>
</template>
