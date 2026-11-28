<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElDialog } from 'element-plus/es/components/dialog/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import { ApiError } from '../api/http';
import {
  deleteLegacyAttachment,
  listLegacyAttachments,
  type LegacyAttachmentItem,
  type LegacyAttachmentOwnerType,
} from '../api/legacy-attachments';

const props = withDefaults(
  defineProps<{
    ownerType: LegacyAttachmentOwnerType;
    ownerId: string;
    canDelete?: boolean;
  }>(),
  { canDelete: false },
);

const status = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<LegacyAttachmentItem[]>([]);
const errorText = ref('');
const previewItem = ref<LegacyAttachmentItem | null>(null);
const deleteTarget = ref<LegacyAttachmentItem | null>(null);
const deleteReason = ref('');
const deleteBusy = ref(false);
const deleteError = ref('');

let controller: globalThis.AbortController | undefined;
let generation = 0;

function isImageItem(item: LegacyAttachmentItem): boolean {
  const ext = (item.extname ?? '').toLowerCase();
  const mime = (item.mimeType ?? '').toLowerCase();
  return (
    mime.startsWith('image/') ||
    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)
  );
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const groups = computed(() => {
  const map = new Map<
    string,
    { categoryCode: string; categoryLabel: string; entries: LegacyAttachmentItem[] }
  >();
  for (const entry of items.value) {
    const existing = map.get(entry.categoryCode);
    if (existing) {
      existing.entries.push(entry);
    } else {
      map.set(entry.categoryCode, {
        categoryCode: entry.categoryCode,
        categoryLabel: entry.categoryLabel,
        entries: [entry],
      });
    }
  }
  return [...map.values()];
});

async function load(): Promise<void> {
  if (!props.ownerId) return;
  controller?.abort();
  controller = new globalThis.AbortController();
  const current = ++generation;
  status.value = 'loading';
  errorText.value = '';
  try {
    const res = await listLegacyAttachments(props.ownerType, props.ownerId, {
      signal: controller.signal,
    });
    if (current !== generation) return;
    items.value = res.items;
    status.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted || current !== generation) return;
    status.value = 'failed';
    errorText.value =
      error instanceof ApiError ? error.message : '历史附件加载失败，请重试。';
  }
}

function openDelete(item: LegacyAttachmentItem): void {
  deleteTarget.value = item;
  deleteReason.value = '';
  deleteError.value = '';
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target || deleteBusy.value) return;
  const reason = deleteReason.value.trim();
  if (reason.length < 1 || reason.length > 500) {
    deleteError.value = '请填写删除原因（1 至 500 字）';
    return;
  }
  deleteBusy.value = true;
  deleteError.value = '';
  try {
    await deleteLegacyAttachment(target.id, reason);
    deleteTarget.value = null;
    await load();
  } catch (error) {
    deleteError.value =
      error instanceof ApiError ? error.message : '删除失败，请稍后重试';
  } finally {
    deleteBusy.value = false;
  }
}

watch(
  () => [props.ownerType, props.ownerId] as const,
  () => {
    void load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  controller?.abort();
});
</script>

<template>
  <section
    class="demo-card demo-card--pad legacy-attachments-section"
    data-test="legacy-attachments-section"
  >
    <div class="legacy-attachments-head">
      <h2 class="form-section-title">
        历史迁移附件（阿里云 OSS）
        <span v-if="status === 'ready'" class="legacy-attachments-count"
          >· {{ items.length }} 份</span
        >
      </h2>
      <ElButton
        v-if="status === 'failed'"
        size="small"
        plain
        @click="load"
        >重新加载</ElButton
      >
    </div>

    <p v-if="status === 'loading'" class="field-help">正在加载历史附件…</p>
    <p v-else-if="status === 'failed'" class="field-error" role="alert">
      {{ errorText }}
    </p>
    <p v-else-if="items.length === 0" class="field-help">暂无历史迁移附件。</p>

    <div v-else class="legacy-attachment-groups">
      <details
        v-for="group in groups"
        :key="group.categoryCode"
        open
        class="legacy-attachment-group"
        :data-test="`legacy-attachment-group-${group.categoryCode}`"
      >
        <summary>
          {{ group.categoryLabel }}（{{ group.entries.length }}）
        </summary>
        <ul class="legacy-attachment-list">
          <li
            v-for="entry in group.entries"
            :key="entry.id"
            class="legacy-attachment-item"
            :data-test="`legacy-attachment-item-${entry.id}`"
          >
            <div class="legacy-attachment-meta">
              <button
                v-if="isImageItem(entry)"
                type="button"
                class="legacy-attachment-thumb-btn"
                :title="`预览 ${entry.title}`"
                @click="previewItem = entry"
              >
                <img
                  :src="entry.ossUrl"
                  :alt="entry.title"
                  loading="lazy"
                  class="legacy-attachment-thumb"
                />
              </button>
              <div class="legacy-attachment-text">
                <strong class="legacy-attachment-name">{{
                  entry.title || entry.filename
                }}</strong>
                <span v-if="formatSize(entry.sizeBytes)" class="field-help">
                  {{ formatSize(entry.sizeBytes) }}
                </span>
              </div>
            </div>
            <div class="legacy-attachment-actions">
              <ElButton
                v-if="isImageItem(entry)"
                size="small"
                text
                @click="previewItem = entry"
                >预览</ElButton
              >
              <a
                :href="entry.ossUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="legacy-attachment-link"
                :data-test="`legacy-attachment-open-${entry.id}`"
                >打开／下载</a
              >
              <ElButton
                v-if="canDelete"
                size="small"
                type="danger"
                text
                :data-test="`legacy-attachment-delete-${entry.id}`"
                @click="openDelete(entry)"
                >删除</ElButton
              >
            </div>
          </li>
        </ul>
      </details>
    </div>

    <ElDialog
      :model-value="previewItem !== null"
      :title="previewItem?.title || previewItem?.filename || '附件预览'"
      width="min(820px, 94vw)"
      @update:model-value="(open: boolean) => { if (!open) previewItem = null; }"
      @close="previewItem = null"
    >
      <div v-if="previewItem" class="legacy-attachment-preview">
        <img :src="previewItem.ossUrl" :alt="previewItem.title" />
        <p>
          <a
            :href="previewItem.ossUrl"
            target="_blank"
            rel="noopener noreferrer"
            >在新窗口打开原图</a
          >
        </p>
      </div>
    </ElDialog>

    <ElDialog
      :model-value="deleteTarget !== null"
      title="删除历史附件"
      width="460px"
      data-test="legacy-attachment-delete-dialog"
      @update:model-value="(open: boolean) => { if (!open) deleteTarget = null; }"
      @close="deleteTarget = null"
    >
      <p v-if="deleteTarget">
        确定删除历史附件
        <strong>{{ deleteTarget.title || deleteTarget.filename }}</strong>？
      </p>
      <p class="field-help">删除操作与原因会永久写入删除留痕。</p>
      <ElInput
        v-model="deleteReason"
        type="textarea"
        :rows="2"
        maxlength="500"
        show-word-limit
        data-test="legacy-attachment-delete-reason"
        placeholder="请填写删除原因（1 至 500 字）"
      />
      <p v-if="deleteError" class="field-error" role="alert">{{ deleteError }}</p>
      <template #footer>
        <ElButton :disabled="deleteBusy" @click="deleteTarget = null"
          >取消</ElButton
        >
        <ElButton
          type="danger"
          :loading="deleteBusy"
          data-test="legacy-attachment-delete-confirm"
          @click="confirmDelete"
          >删除</ElButton
        >
      </template>
    </ElDialog>
  </section>
</template>

<style scoped>
.legacy-attachments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.legacy-attachments-count {
  font-size: 13px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
.legacy-attachment-groups {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}
.legacy-attachment-group > summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
}
.legacy-attachment-list {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.legacy-attachment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  border: 1px solid var(--color-hairline, #e5e7eb);
  border-radius: 6px;
}
.legacy-attachment-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.legacy-attachment-thumb-btn {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}
.legacy-attachment-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  display: block;
}
.legacy-attachment-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.legacy-attachment-name {
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.legacy-attachment-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.legacy-attachment-link {
  font-size: 13px;
  color: var(--el-color-primary);
  text-decoration: none;
}
.legacy-attachment-preview {
  display: grid;
  gap: 10px;
  justify-items: center;
}
.legacy-attachment-preview img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}
</style>
