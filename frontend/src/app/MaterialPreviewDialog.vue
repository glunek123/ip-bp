<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiError, getBlob } from '../api/http';

type HtmlElement = {
  focus(): void;
  isConnected: boolean;
  contains(target: unknown): boolean;
  getAttribute(name: string): string | null;
  querySelector(selector: string): HtmlElement | null;
  querySelectorAll(selector: string): ArrayLike<HtmlElement>;
};
type DialogKeyboardEvent = InstanceType<(typeof globalThis)['KeyboardEvent']>;

const props = defineProps<{
  materialId: string;
  contentVersionId: string;
  filename: string;
  scopeKey: string;
}>();
const emit = defineEmits<{
  close: [];
  unavailable: [status: 403 | 404];
}>();

const url = ref('');
const mimeType = ref('');
const status = ref<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
const dialogRoot = ref<HtmlElement | null>(null);
let controller: AbortController | undefined;
let generation = 0;
let returnFocusTarget: HtmlElement | null = null;

function restoreFocus(): void {
  if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
}

function clearPreview(): void {
  generation += 1;
  controller?.abort();
  controller = undefined;
  if (url.value) globalThis.URL.revokeObjectURL(url.value);
  url.value = '';
  mimeType.value = '';
}

function close(): void {
  clearPreview();
  restoreFocus();
  emit('close');
}

function handleKeydown(event: DialogKeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;

  const dialog = event.currentTarget as unknown as HtmlElement;
  const focusable = (
    Array.from(
      dialog.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])',
      ),
    ) as unknown as HtmlElement[]
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = globalThis.document
    .activeElement as unknown as HtmlElement | null;
  if (!dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => [props.scopeKey, props.materialId, props.contentVersionId],
  async () => {
    clearPreview();
    const requestGeneration = generation;
    const activeController = new AbortController();
    controller = activeController;
    status.value = 'loading';
    try {
      const file = await getBlob(
        `/materials/${encodeURIComponent(props.materialId)}/versions/${encodeURIComponent(props.contentVersionId)}/content`,
        { signal: activeController.signal },
      );
      if (requestGeneration !== generation || activeController.signal.aborted)
        return;
      if (
        !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
          file.mimeType,
        )
      ) {
        status.value = 'unsupported';
        return;
      }
      mimeType.value = file.mimeType;
      url.value = globalThis.URL.createObjectURL(file.blob);
      status.value = 'ready';
    } catch (error) {
      if (requestGeneration !== generation || activeController.signal.aborted)
        return;
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        clearPreview();
        emit('unavailable', error.status as 403 | 404);
        emit('close');
        return;
      }
      status.value = 'failed';
    }
  },
  { immediate: true },
);

onMounted(() => {
  const active = globalThis.document.activeElement;
  returnFocusTarget =
    active !== null && 'focus' in active && 'isConnected' in active
      ? (active as unknown as HtmlElement)
      : null;
  dialogRoot.value
    ?.querySelector('[data-test="material-preview-close"]')
    ?.focus();
});

onBeforeUnmount(() => {
  clearPreview();
  restoreFocus();
});
</script>

<template>
  <div
    ref="dialogRoot"
    class="material-preview-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="`预览 ${filename}`"
    tabindex="-1"
    @keydown.capture="handleKeydown"
  >
    <div class="material-preview-window">
      <header>
        <strong>{{ filename }}</strong>
        <button type="button" data-test="material-preview-close" @click="close">
          关闭
        </button>
      </header>
      <p v-if="status === 'loading'" role="status">正在加载预览…</p>
      <p v-else-if="status === 'unsupported'" role="status">
        此文件格式暂不支持预览，请关闭后使用下载入口查看。
      </p>
      <p v-else-if="status === 'failed'" role="alert">
        文件预览失败，请稍后重试或使用下载入口。
      </p>
      <img
        v-else-if="mimeType.startsWith('image/')"
        :src="url"
        :alt="filename"
      />
      <iframe v-else :src="url" :title="filename" />
    </div>
  </div>
</template>

<style scoped>
.material-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2500;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 68%);
}
.material-preview-window {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(900px, 100%);
  height: min(84vh, 900px);
  min-height: 180px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-surface-1, white);
}
.material-preview-window header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-hairline, #ddd);
}
.material-preview-window header strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.material-preview-window button {
  min-height: var(--app-control-height, 34px);
  min-width: var(--app-control-min-width, 72px);
  cursor: pointer;
}
.material-preview-window img,
.material-preview-window iframe {
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
}
.material-preview-window p {
  padding: 16px;
}
</style>
