<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type OwnerMaterial,
} from '../../api/materials';
import {
  getNotaryPortalMatter,
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

async function refreshMaterials(): Promise<void> {
  const response = await listOwnerMaterials('NOTARY_MATTER', matterId.value);
  materials.value = response.items;
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
    state.value = 'ready';
    if (result.stage === 'WAITING_UNBOX') await refreshMaterials();
  } catch (reason) {
    if (controller.signal.aborted) return;
    state.value =
      reason instanceof ApiError && reason.status === 404
        ? 'missing'
        : 'failed';
    error.value = '事项暂时无法读取，请刷新重试。';
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
      <p><RouterLink to="/notary-portal/matters">返回待开箱事项</RouterLink></p>
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
              {{ matter.stage === 'WAITING_UNBOX' ? '待开箱' : '开箱待审核' }} ·
              创建于 {{ formatTime(matter.createdAt) }}
            </p>
          </div>
          <ElButton text @click="load">刷新</ElButton>
        </div>
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
      </template>
    </main>
  </div>
</template>
