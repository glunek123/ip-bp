<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type {
  OpeningImportBatch,
  OpeningImportEligiblePage,
  OpeningImportItem,
} from '../../api/notary-opening-import';

type ImportBatchItemStatus = OpeningImportItem['status'];
type ImportMatchStatus = OpeningImportItem['matchStatus'];
type SenderDraft = { name: string; phone: string; address: string };

const props = defineProps<{
  batch: OpeningImportBatch | null;
  resumeBatchId?: string | null;
  uploadState: 'IDLE' | 'UPLOADING' | 'UNKNOWN';
  uploadError?: string;
  busyItemId?: string | null;
  unknownConfirmItemIds?: string[];
  itemErrors?: Record<string, string>;
  eligibleMatterPages?: Record<string, OpeningImportEligiblePage>;
  photoSources?: Record<string, string>;
  photoErrors?: Record<string, string>;
  panelBusy?: boolean;
  writeLocked?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  upload: [file: InstanceType<typeof globalThis.File>];
  recoverUpload: [file: InstanceType<typeof globalThis.File> | null];
  startNewImport: [];
  refreshBatch: [];
  resumeBatchById: [batchId: string];
  searchEligibleMatters: [itemId: string, query: string, page: number];
  loadPhoto: [batchId: string, photoId: string];
  photoFailed: [photoId: string];
  saveManualItem: [
    itemId: string,
    input: { trackingNo: string | null; selectedMatterId: string | null },
  ];
  confirmItem: [
    itemId: string,
    sender: { name?: string; phone?: string; address?: string },
  ];
  retryUnknownItem: [itemId: string];
}>();

const fileInput = ref<InstanceType<typeof globalThis.HTMLInputElement>>();
const selectedFile = ref<InstanceType<typeof globalThis.File> | null>(null);
const enteredBatchId = ref('');
const activeItemId = ref<string | null>(null);
const trackingDrafts = ref<Record<string, string>>({});
const matterDrafts = ref<Record<string, string>>({});
const senderDrafts = ref<Record<string, SenderDraft>>({});
const eligibleQueries = ref<Record<string, string>>({});
const batchItems = computed(() => props.batch?.items ?? []);
const activeItem = computed(
  () => batchItems.value.find((item) => item.id === activeItemId.value) ?? null,
);
const activeEligiblePage = computed(() =>
  activeItem.value
    ? (props.eligibleMatterPages?.[activeItem.value.id] ?? null)
    : null,
);
const suggestedMatter = computed(() => {
  const suggestionId = activeItem.value?.suggestedMatterId;
  return suggestionId
    ? (activeEligiblePage.value?.items.find(
        (matter) => matter.id === suggestionId,
      ) ?? null)
    : null;
});
const uploadLocked = computed(
  () => props.uploadState !== 'IDLE' || props.panelBusy || props.writeLocked,
);
const canStartNewImport = computed(
  () =>
    !!props.batch &&
    (props.batch.status !== 'READY' ||
      props.batch.items.every((item) => item.status === 'COMMITTED')) &&
    props.uploadState === 'IDLE' &&
    !props.unknownConfirmItemIds?.length &&
    !props.panelBusy &&
    !props.writeLocked,
);

function canLeave(): boolean {
  return (
    props.uploadState !== 'UPLOADING' &&
    !props.panelBusy &&
    !props.busyItemId &&
    !props.unknownConfirmItemIds?.length
  );
}

defineExpose({ canLeave });

function initItemDrafts(item: OpeningImportItem): void {
  trackingDrafts.value[item.id] ??= item.trackingNo ?? '';
  matterDrafts.value[item.id] ??= item.selectedMatterId ?? '';
  senderDrafts.value[item.id] ??= { name: '', phone: '', address: '' };
  eligibleQueries.value[item.id] ??= '';
}

function selectItem(item: OpeningImportItem): void {
  initItemDrafts(item);
  activeItemId.value = item.id;
  emit(
    'searchEligibleMatters',
    item.id,
    eligibleQueries.value[item.id] ?? '',
    1,
  );
}

function itemIsDirty(item: OpeningImportItem): boolean {
  return (
    (trackingDrafts.value[item.id] ?? item.trackingNo ?? '') !==
      (item.trackingNo ?? '') ||
    (matterDrafts.value[item.id] ?? item.selectedMatterId ?? '') !==
      (item.selectedMatterId ?? '')
  );
}

function saveManualItem(item: OpeningImportItem): void {
  if (item.status === 'COMMITTED') return;
  emit('saveManualItem', item.id, {
    trackingNo: trackingDrafts.value[item.id]?.trim() || null,
    selectedMatterId: matterDrafts.value[item.id] || null,
  });
}

function searchEligible(item: OpeningImportItem, page = 1): void {
  emit(
    'searchEligibleMatters',
    item.id,
    eligibleQueries.value[item.id]?.trim() ?? '',
    page,
  );
}

function confirmItem(item: OpeningImportItem): void {
  if (
    item.status === 'COMMITTED' ||
    item.status === 'CONFLICT' ||
    itemIsDirty(item) ||
    !item.selectedMatterId
  )
    return;
  const sender = senderDrafts.value[item.id] ?? {
    name: '',
    phone: '',
    address: '',
  };
  emit('confirmItem', item.id, {
    ...(sender.name.trim() ? { name: sender.name.trim() } : {}),
    ...(sender.phone.trim() ? { phone: sender.phone.trim() } : {}),
    ...(sender.address.trim() ? { address: sender.address.trim() } : {}),
  });
}

function requestUpload(): void {
  const file = selectedFile.value;
  if (!file || uploadLocked.value) return;
  emit('upload', file);
}

function chooseFile(event: globalThis.Event): void {
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  selectedFile.value = target.files?.[0] ?? null;
}

function matchStatusLabel(status: ImportMatchStatus): string {
  return {
    UNMATCHED: '未匹配',
    SUGGESTED: '有建议，需人工选择',
    AMBIGUOUS: '多个候选，需人工核对',
    CONFLICT: '匹配冲突',
  }[status];
}

function recognitionStatusLabel(
  status: OpeningImportItem['recognitionStatus'],
): string {
  return {
    DISABLED: '识别未启用',
    SUCCEEDED: '模拟识别完成',
    FAILED: '模拟识别未成功',
  }[status];
}

function itemStatusLabel(status: ImportBatchItemStatus): string {
  return {
    READY: '待确认',
    CONFLICT: '需处理',
    COMMITTED: '已完成',
  }[status];
}

function formatExpiry(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

watch(
  () =>
    props.batch?.items
      .map((item) => `${item.id}:${item.revision}:${item.status}`)
      .join('|') ?? '',
  () => {
    const items = batchItems.value;
    for (const item of items) initItemDrafts(item);
    if (!items.some((item) => item.id === activeItemId.value)) {
      if (items[0]) selectItem(items[0]);
      else activeItemId.value = null;
    }
  },
  { immediate: true },
);

watch(
  () => props.batch?.id,
  () => {
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = '';
  },
);
</script>

<template>
  <section
    class="demo-card demo-card--pad opening-import-panel"
    data-test="opening-import-panel"
  >
    <header class="opening-import-header">
      <div>
        <h2>ZIP 批量开箱</h2>
        <p>
          每个文件夹是一组。系统只提供识别结果或候选；你必须逐组选择待开箱事项并明确确认。
        </p>
      </div>
      <ElButton
        text
        data-test="opening-import-close"
        :disabled="!canLeave()"
        :title="
          unknownConfirmItemIds?.length
            ? '先核实原确认请求，再离开此批次'
            : undefined
        "
        @click="emit('close')"
        >关闭</ElButton
      >
    </header>

    <section
      v-if="!batch"
      class="opening-import-upload"
      data-test="opening-import-upload"
    >
      <template v-if="resumeBatchId">
        <p>
          已保存的批次编号：<span class="mono">{{ resumeBatchId }}</span>
        </p>
        <ElButton
          data-test="opening-import-resume-batch"
          :disabled="panelBusy"
          @click="emit('refreshBatch')"
          >重试读取原批次</ElButton
        >
      </template>
      <template v-else>
        <label for="opening-import-batch-id">已有批次编号</label>
        <input
          id="opening-import-batch-id"
          v-model.trim="enteredBatchId"
          data-test="opening-import-batch-id"
          :disabled="panelBusy"
          placeholder="填写完整批次编号"
        />
        <ElButton
          data-test="opening-import-resume-by-id"
          :disabled="panelBusy || !enteredBatchId"
          @click="emit('resumeBatchById', enteredBatchId)"
          >读取已有批次</ElButton
        >
        <label for="opening-import-zip">选择 ZIP 文件</label>
        <input
          id="opening-import-zip"
          ref="fileInput"
          data-test="opening-import-file"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          :disabled="panelBusy || uploadState === 'UPLOADING'"
          @change="chooseFile"
        />
      </template>
      <p v-if="selectedFile" class="field-help">
        已选择 {{ selectedFile.name }}（{{
          formatBytes(selectedFile.size)
        }}）。选择文件不会提交；点击下方按钮后才创建导入批次。
      </p>
      <p v-if="uploadError" class="field-error" role="alert">
        {{ uploadError }}
      </p>
      <p
        v-if="writeLocked"
        role="status"
        data-test="opening-import-other-window"
      >
        当前窗口仅可读取已有批次。请回到原办理窗口，或在支持安全办理的浏览器中重新打开。
      </p>
      <p
        v-if="uploadState === 'UNKNOWN'"
        role="alert"
        data-test="opening-import-upload-unknown"
      >
        上传结果未知。请先按原请求键核实；若服务器未找到原批次，再选择内容完全相同的
        ZIP。核实前不能使用新请求重传。
      </p>
      <div v-if="!resumeBatchId" class="opening-import-actions">
        <ElButton
          v-if="uploadState === 'UNKNOWN'"
          data-test="opening-import-recover-upload"
          :disabled="panelBusy || writeLocked"
          @click="emit('recoverUpload', selectedFile)"
          >核实原上传请求</ElButton
        >
        <ElButton
          v-else
          type="primary"
          data-test="opening-import-start"
          :disabled="!selectedFile || uploadLocked"
          @click="requestUpload"
          >{{
            uploadState === 'UPLOADING'
              ? '正在上传并建立批次…'
              : '上传并建立批次'
          }}</ElButton
        >
      </div>
    </section>

    <template v-else>
      <div
        class="opening-import-batch-meta"
        data-test="opening-import-batch-meta"
      >
        <p>
          批次编号：<span class="mono">{{ batch.id }}</span>
        </p>
        <p>
          状态：{{
            batch.status === 'READY'
              ? '待逐组处理'
              : batch.status === 'CANCELLED'
                ? '已取消'
                : '已过期'
          }}
        </p>
        <p>
          保留至：<span class="mono">{{ formatExpiry(batch.expiresAt) }}</span>
        </p>
      </div>
      <p
        v-if="batch.status !== 'READY'"
        role="status"
        data-test="opening-import-read-only"
      >
        此批次仅供核对已有结果；不能继续保存或确认新事项。结果未知的原请求仍须按原请求核实。
      </p>
      <p
        v-if="batch.recognitionMode === 'MOCK'"
        class="opening-import-mock-warning"
        role="status"
        data-test="opening-import-mock-warning"
      >
        当前为模拟识别。识别结果仅供核对，不会自动关联事项，也不代表真实识别结果。
      </p>
      <p v-else class="field-help" data-test="opening-import-manual-only">
        识别未启用。你仍可手工填写单号、选择事项并逐组确认。
      </p>
      <p v-if="uploadError" class="field-error" role="alert">
        {{ uploadError }}
      </p>
      <p
        v-if="writeLocked"
        role="status"
        data-test="opening-import-other-window"
      >
        当前窗口仅可核对批次事实；请回到原办理窗口继续操作。
      </p>
      <p v-if="uploadState === 'UNKNOWN'" role="alert">
        原上传请求尚未核实。此批次可只读核对；请先核实原上传请求，再办理新事项。
      </p>
      <div class="opening-import-actions">
        <ElButton
          v-if="uploadState === 'UNKNOWN'"
          data-test="opening-import-recover-upload"
          :disabled="panelBusy || writeLocked"
          @click="emit('recoverUpload', null)"
          >核实原上传请求</ElButton
        >
        <ElButton
          text
          data-test="opening-import-refresh"
          :disabled="panelBusy"
          @click="emit('refreshBatch')"
          >刷新批次</ElButton
        >
        <ElButton
          v-if="canStartNewImport"
          data-test="opening-import-new"
          @click="emit('startNewImport')"
          >新建 ZIP 导入</ElButton
        >
      </div>

      <div class="opening-import-workspace">
        <nav aria-label="ZIP 文件夹事项" class="opening-import-items">
          <h3>文件夹事项（{{ batch.items.length }}）</h3>
          <button
            v-for="item in batch.items"
            :key="item.id"
            type="button"
            :class="{ 'is-active': item.id === activeItemId }"
            :data-test="`opening-import-item-${item.id}`"
            @click="selectItem(item)"
          >
            <span>{{ item.folderName }}</span>
            <small
              >{{ itemStatusLabel(item.status) }} ·
              {{ item.photos.length }} 张</small
            >
          </button>
        </nav>

        <section
          v-if="activeItem"
          class="opening-import-item-detail"
          :data-test="`opening-import-detail-${activeItem.id}`"
        >
          <div class="opening-import-item-heading">
            <div>
              <h3>{{ activeItem.folderName }}</h3>
              <p>
                {{ recognitionStatusLabel(activeItem.recognitionStatus) }} ·
                {{ matchStatusLabel(activeItem.matchStatus) }}
              </p>
            </div>
            <span class="pill">{{ itemStatusLabel(activeItem.status) }}</span>
          </div>
          <p
            v-if="unknownConfirmItemIds?.includes(activeItem.id)"
            role="alert"
            data-test="opening-import-confirm-unknown"
          >
            此项确认结果未知。请用原确认请求核实；不能编辑内容后另发请求。
          </p>
          <p
            v-if="itemErrors?.[activeItem.id]"
            class="field-error"
            role="alert"
          >
            {{ itemErrors[activeItem.id] }}
          </p>

          <section class="opening-import-photos" aria-label="本文件夹照片">
            <h4>照片（{{ activeItem.photos.length }}）</h4>
            <div class="opening-import-photo-grid">
              <figure v-for="photo in activeItem.photos" :key="photo.id">
                <img
                  v-if="photoSources?.[photo.id] && !photoErrors?.[photo.id]"
                  :src="photoSources[photo.id]"
                  :alt="photo.filename"
                  @error="emit('photoFailed', photo.id)"
                />
                <div v-else class="opening-import-photo-placeholder">
                  <ElButton
                    text
                    :data-test="`opening-import-photo-load-${photo.id}`"
                    :disabled="panelBusy"
                    @click="emit('loadPhoto', batch.id, photo.id)"
                  >
                    {{
                      photoErrors?.[photo.id]
                        ? '读取失败，重试预览'
                        : '加载预览'
                    }}
                  </ElButton>
                </div>
                <small v-if="photoErrors?.[photo.id]" role="alert">{{
                  photoErrors[photo.id]
                }}</small>
                <figcaption>
                  <span>{{ photo.filename }}</span>
                  <small>{{ formatBytes(photo.sizeBytes) }}</small>
                </figcaption>
              </figure>
            </div>
          </section>

          <section class="opening-import-recognition" aria-label="识别建议">
            <h4>识别建议（仅供参考）</h4>
            <p>识别到的单号：{{ activeItem.trackingCandidate || '未识别' }}</p>
            <p>
              识别到的寄件人：{{ activeItem.senderCandidate?.name || '未识别' }}
            </p>
            <p>
              识别到的电话：{{ activeItem.senderCandidate?.phone || '未识别' }}
            </p>
            <p>
              识别到的地址：{{
                activeItem.senderCandidate?.address || '未识别'
              }}
            </p>
            <p v-if="activeItem.suggestedMatterId" class="field-help">
              <template v-if="suggestedMatter">
                系统建议候选：{{ suggestedMatter.businessNo }}。
              </template>
              <template v-else> 系统有建议，请按当前单号检索核对。 </template>
              该建议尚未选择或绑定。
            </p>
          </section>

          <div class="opening-import-fields">
            <label>
              快递单号（可人工修改）
              <input
                v-model="trackingDrafts[activeItem.id]"
                :disabled="
                  activeItem.status === 'COMMITTED' ||
                  batch.status !== 'READY' ||
                  writeLocked ||
                  activeItem.id === busyItemId ||
                  unknownConfirmItemIds?.includes(activeItem.id)
                "
                :data-test="`opening-import-tracking-${activeItem.id}`"
              />
            </label>
            <label>
              搜索待开箱事项
              <input
                v-model="eligibleQueries[activeItem.id]"
                :disabled="
                  activeItem.id === busyItemId ||
                  unknownConfirmItemIds?.includes(activeItem.id)
                "
                :data-test="`opening-import-search-${activeItem.id}`"
                @input="searchEligible(activeItem)"
              />
            </label>
          </div>
          <div
            class="opening-import-eligible"
            data-test="opening-import-eligible"
          >
            <p v-if="activeEligiblePage?.total === 0">
              没有找到可匹配的待开箱事项。
            </p>
            <p v-else-if="!activeEligiblePage">
              输入编号或快递单号，搜索有权访问的待开箱事项。
            </p>
            <label
              v-for="matter in activeEligiblePage?.items ?? []"
              :key="matter.id"
              class="opening-import-eligible-option"
            >
              <input
                v-model="matterDrafts[activeItem.id]"
                type="radio"
                :name="`opening-import-matter-${activeItem.id}`"
                :value="matter.id"
                :disabled="
                  activeItem.status === 'COMMITTED' ||
                  batch.status !== 'READY' ||
                  writeLocked ||
                  activeItem.id === busyItemId ||
                  unknownConfirmItemIds?.includes(activeItem.id)
                "
                :data-test="`opening-import-select-matter-${matter.id}`"
              />
              <span>{{ matter.businessNo }}</span>
              <small>当前单号：{{ matter.trackingNo || '未登记' }}</small>
            </label>
          </div>

          <div class="opening-import-sender-fields">
            <h4>寄件信息（仅在确认本组时提交）</h4>
            <p v-if="activeItem.senderCandidate" class="field-help">
              识别候选不会自动填写。请按实际资料手工确认。
            </p>
            <label>
              寄件人姓名
              <input
                v-model="senderDrafts[activeItem.id].name"
                :disabled="
                  activeItem.status === 'COMMITTED' ||
                  batch.status !== 'READY' ||
                  writeLocked ||
                  activeItem.id === busyItemId ||
                  unknownConfirmItemIds?.includes(activeItem.id)
                "
                maxlength="120"
              />
            </label>
            <label>
              寄件人电话
              <input
                v-model="senderDrafts[activeItem.id].phone"
                :disabled="
                  activeItem.status === 'COMMITTED' ||
                  batch.status !== 'READY' ||
                  writeLocked ||
                  activeItem.id === busyItemId ||
                  unknownConfirmItemIds?.includes(activeItem.id)
                "
                maxlength="50"
              />
            </label>
            <label>
              寄件人地址
              <input
                v-model="senderDrafts[activeItem.id].address"
                :disabled="
                  activeItem.status === 'COMMITTED' ||
                  batch.status !== 'READY' ||
                  writeLocked ||
                  activeItem.id === busyItemId ||
                  unknownConfirmItemIds?.includes(activeItem.id)
                "
                maxlength="500"
              />
            </label>
          </div>

          <div class="opening-import-actions">
            <ElButton
              data-test="opening-import-save-item"
              :disabled="
                activeItem.status === 'COMMITTED' ||
                batch.status !== 'READY' ||
                writeLocked ||
                uploadState !== 'IDLE' ||
                activeItem.id === busyItemId ||
                unknownConfirmItemIds?.includes(activeItem.id) ||
                !itemIsDirty(activeItem)
              "
              @click="saveManualItem(activeItem)"
              >保存人工核对</ElButton
            >
            <ElButton
              v-if="unknownConfirmItemIds?.includes(activeItem.id)"
              type="primary"
              data-test="opening-import-retry-confirm"
              :disabled="writeLocked || activeItem.id === busyItemId"
              @click="emit('retryUnknownItem', activeItem.id)"
              >按原请求核实此项</ElButton
            >
            <ElButton
              v-else-if="activeItem.status !== 'COMMITTED'"
              type="primary"
              data-test="opening-import-confirm-item"
              :disabled="
                activeItem.status === 'CONFLICT' ||
                batch.status !== 'READY' ||
                writeLocked ||
                uploadState !== 'IDLE' ||
                activeItem.id === busyItemId ||
                itemIsDirty(activeItem) ||
                !activeItem.selectedMatterId
              "
              @click="confirmItem(activeItem)"
              >确认本组并登记开箱</ElButton
            >
          </div>
          <p v-if="activeItem.status === 'COMMITTED'" role="status">
            本组已成功提交。不会再次提交。
          </p>
        </section>
        <p v-else class="opening-import-empty">此批次没有文件夹事项。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.opening-import-header,
.opening-import-item-heading,
.opening-import-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.opening-import-header h2,
.opening-import-item-heading h3,
.opening-import-items h3,
.opening-import-photos h4,
.opening-import-recognition h4,
.opening-import-sender-fields h4 {
  margin: 0;
}

.opening-import-header p,
.opening-import-item-heading p,
.opening-import-recognition p,
.opening-import-batch-meta p {
  margin: 4px 0;
}

.opening-import-upload,
.opening-import-recognition,
.opening-import-sender-fields,
.opening-import-eligible {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.opening-import-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.opening-import-fields > label,
.opening-import-sender-fields > label {
  display: grid;
  gap: 6px;
}

.opening-import-fields input,
.opening-import-sender-fields input {
  min-width: 0;
  min-height: 38px;
  padding: 6px 9px;
  border: 1px solid var(--color-hairline);
  border-radius: 5px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.opening-import-mock-warning {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--color-warning, #c98d20);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-warning, #c98d20) 10%, white);
}

.opening-import-batch-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 12px 0;
}

.opening-import-workspace {
  display: grid;
  grid-template-columns: minmax(190px, 250px) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.opening-import-items {
  display: grid;
  align-content: start;
  gap: 6px;
}

.opening-import-items button {
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 5px;
  background: var(--color-surface);
  color: var(--color-ink);
  text-align: left;
  cursor: pointer;
}

.opening-import-items button.is-active {
  border-color: var(--color-primary);
  box-shadow: inset 3px 0 var(--color-primary);
}

.opening-import-items small,
.opening-import-eligible small,
.opening-import-photo-grid small {
  color: var(--color-ink-subtle);
}

.opening-import-item-detail {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}

.opening-import-item-heading {
  margin-bottom: 12px;
}

.opening-import-photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.opening-import-photo-grid figure {
  min-width: 0;
  margin: 0;
}

.opening-import-photo-grid img,
.opening-import-photo-placeholder {
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  object-fit: contain;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  background: var(--color-surface-2);
}

.opening-import-photo-grid figcaption {
  display: grid;
  gap: 2px;
  margin-top: 4px;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.opening-import-eligible-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
}

.opening-import-actions {
  flex-wrap: wrap;
  justify-content: flex-start;
  margin-top: 14px;
}

.opening-import-empty {
  margin: 18px 0;
}

@media (max-width: 760px) {
  .opening-import-workspace,
  .opening-import-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
