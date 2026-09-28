<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type OwnerMaterial,
} from '../../api/materials';
import {
  getNotaryPortalMatter,
  recordNotaryPortalCertificate,
  type NotaryPortalCertificateInput,
  recordNotaryPortalOpening,
  type NotaryPortalMatter,
} from '../../api/notary-portal';
import type { RecordNotaryOpeningInput } from '../../api/notary';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const matter = ref<NotaryPortalMatter>();
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
const needDisclose = ref(false);
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
    (!needDisclose.value ||
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
let request: AbortController | undefined;
const matterId = computed(() => String(route.params.id));
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
async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  error.value = '';
  try {
    const result = await getNotaryPortalMatter(matterId.value, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    matter.value = result;
    needDisclose.value = result.disclosureRequired;
    state.value = 'ready';
    if (
      result.stage === 'WAITING_UNBOX' ||
      result.stage === 'WAITING_CERTIFICATE'
    )
      await refreshMaterials();
  } catch (reason) {
    if (controller.signal.aborted) return;
    state.value =
      reason instanceof ApiError && reason.status === 404
        ? 'missing'
        : 'failed';
    error.value = '事项暂时无法读取，请刷新重试。';
  }
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
      needDisclose: matter.value.disclosureRequired || needDisclose.value,
      disclosureContentVersionIds:
        matter.value.disclosureRequired || needDisclose.value
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
    const result = await recordNotaryPortalCertificate(
      matterId.value,
      input,
      globalThis.crypto.randomUUID(),
    );
    certificateSuccess.value = `出证已完成，案件编号 ${result.case.businessNo}。`;
    notifyWorkflowChanged();
    await load();
  } catch (reason) {
    error.value =
      reason instanceof ApiError
        ? `${reason.message}。请刷新核对当前事项状态。`
        : '提交结果暂时未知，请刷新核对事项状态。';
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
    await recordNotaryPortalOpening(
      matterId.value,
      input,
      globalThis.crypto.randomUUID(),
    );
    success.value = '开箱记录已提交，事项已进入开箱审核。';
    await load();
  } catch (reason) {
    error.value =
      reason instanceof ApiError
        ? `${reason.message}。请刷新核对当前事项状态。`
        : '提交结果暂时未知，请刷新核对事项状态。';
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
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <p><RouterLink to="/notary-portal/matters">返回公证事项</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取事项</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>事项不存在或已不可访问</h1>
        <p>请返回列表刷新。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>事项暂时无法加载</h1>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="matter">
        <div class="page-head">
          <div>
            <p class="eyebrow">公证处办理端</p>
            <h1>{{ matter.businessNo }}</h1>
            <p>
              {{
                matter.stage === 'WAITING_UNBOX'
                  ? '待开箱'
                  : matter.stage === 'UNBOX_REVIEW'
                    ? '开箱待审核'
                    : matter.stage === 'WAITING_CERTIFICATE'
                      ? '待出证'
                      : '已出证'
              }}
              · 创建于 {{ formatTime(matter.createdAt) }}
            </p>
          </div>
          <ElButton text @click="load">刷新</ElButton>
        </div>
        <p v-if="matter.issuanceDecision" class="field-help">
          已审核同意出证：{{ matter.issuanceDecision.actorDisplayName }} ·
          {{ formatTime(matter.issuanceDecision.decidedAt) }}
        </p>
        <section v-if="matter.evidence" class="demo-card demo-card--pad">
          <h2 class="form-section-title">取证与物流</h2>
          <p>取证日期：{{ matter.evidence.evidenceAt }}</p>
          <ul>
            <li v-for="row in matter.evidence.logistics" :key="row.id">
              快递公司：{{
                row.companyState === 'NONE' ? '无' : row.companyValue
              }}；快递单号：{{
                row.trackingState === 'NONE' ? '无' : row.trackingValue
              }}
            </li>
          </ul>
        </section>
        <section
          v-if="matter.capabilities.recordOpening"
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
                纳入开箱记录：{{ photo.originalFilename }}（{{
                  photo.mimeType
                }}）
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
          v-else-if="matter.opening"
          class="demo-card demo-card--pad"
          data-test="notary-saved-opening"
        >
          <h2 class="form-section-title">已保存的开箱记录</h2>
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
                data-test="notary-opening-photo-download"
                @click="download(photo.materialId, photo.contentVersionId)"
                >下载照片</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="submit-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section
          v-if="matter.capabilities.issueCertificate"
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
              v-model="needDisclose"
              data-test="disclosure-toggle"
              type="checkbox"
              :disabled="matter.disclosureRequired || submitting || uploading"
            />
            {{
              matter.disclosureRequired ? '必须披露材料' : '需要披露材料'
            }}</label
          >
          <p v-if="matter.disclosureRequired" class="field-help">
            来源线索要求披露材料，至少选择一份披露文件后才能出证。
          </p>
          <template v-if="needDisclose">
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
            <label class="field-label field-label--spaced">{{
              fee.label
            }}</label>
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
        <section
          v-if="matter.stage === 'ARCHIVED' && matter.certificate"
          class="demo-card demo-card--pad"
          data-test="certificate-record"
        >
          <h2 class="form-section-title">已登记公证书</h2>
          <p>
            编号：{{ matter.certificate.certificateNo }} · 日期：{{
              matter.certificate.certificateDate
            }}
          </p>
          <p>案件编号：{{ matter.certificate.caseBusinessNo || '暂不可用' }}</p>
          <p>公证书文件</p>
          <ul>
            <li
              v-for="file in matter.certificate.files"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename
              }}<ElButton
                text
                :data-test="`download-certificate-${file.contentVersionId}`"
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <p v-if="matter.certificate.disclosureFiles.length">披露文件</p>
          <ul>
            <li
              v-for="file in matter.certificate.disclosureFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename
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
        <p
          v-if="certificateSuccess"
          class="submit-success"
          role="status"
          data-test="certificate-success"
        >
          {{ certificateSuccess }}
        </p>
      </template>
    </main>
  </div>
</template>
