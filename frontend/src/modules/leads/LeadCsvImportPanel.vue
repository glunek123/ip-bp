<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { LeadCsvParsedRow, LeadCsvSelection } from './lead-csv-preview';
import { LeadCsvPreviewSession, type LeadCsvPreview } from './lead-csv-preview';
import LeadCsvPreviewPanel from './LeadCsvPreviewPanel.vue';

const props = defineProps<{
  open: boolean;
  contextKey: string;
  parseFile: (
    file: InstanceType<typeof globalThis.File>,
    signal: InstanceType<typeof globalThis.AbortSignal>,
  ) => Promise<readonly LeadCsvParsedRow[]>;
}>();

const emit = defineEmits<{
  closeRequest: [];
  confirmRequest: [selection: LeadCsvSelection];
}>();

const session = new LeadCsvPreviewSession();
const snapshot = ref<LeadCsvPreview>(session.snapshot());
const input = ref<InstanceType<typeof globalThis.HTMLInputElement>>();
const confirmationSent = ref(false);
let activeRead: {
  generation: number;
  controller: InstanceType<typeof globalThis.AbortController>;
} | null = null;
let mounted = true;

const display = computed(() => {
  const generation = snapshot.value.generation;
  const contextKey = props.contextKey;
  return {
    onFileChange: (event: InstanceType<typeof globalThis.Event>) =>
      chooseFile(generation, contextKey, event),
  };
});

function syncSnapshot(): void {
  snapshot.value = session.snapshot();
}

function abortActiveRead(): void {
  activeRead?.controller.abort();
  activeRead = null;
}

function invalidateAndClose(): void {
  abortActiveRead();
  session.cancel();
  confirmationSent.value = false;
  syncSnapshot();
  if (input.value) input.value.value = '';
}

watch(
  () => [props.open, props.contextKey] as const,
  ([isOpen]) => {
    abortActiveRead();
    if (input.value) input.value.value = '';
    confirmationSent.value = false;
    if (isOpen) session.open();
    else session.cancel();
    syncSnapshot();
  },
  { immediate: true, flush: 'sync' },
);

async function chooseFile(
  generationAtRender: number,
  contextKeyAtRender: string,
  event: InstanceType<typeof globalThis.Event>,
): Promise<void> {
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  const file = target.files?.[0];
  target.value = '';
  if (
    !file ||
    !props.open ||
    confirmationSent.value ||
    contextKeyAtRender !== props.contextKey ||
    generationAtRender !== snapshot.value.generation ||
    snapshot.value.phase === 'closed'
  )
    return;

  abortActiveRead();
  const generation = session.beginFile(file.name);
  syncSnapshot();
  if (generation === null) return;

  const controller = new globalThis.AbortController();
  activeRead = { generation, controller };
  try {
    const rows = await props.parseFile(file, controller.signal);
    if (
      !mounted ||
      controller.signal.aborted ||
      activeRead?.generation !== generation
    )
      return;
    session.acceptParsed(generation, rows);
  } catch {
    if (
      mounted &&
      !controller.signal.aborted &&
      activeRead?.generation === generation
    )
      session.failFile(generation);
  } finally {
    if (activeRead?.generation === generation) activeRead = null;
    if (mounted) syncSnapshot();
  }
}

function selectRows(request: {
  generation: number;
  rowNumbers: number[];
}): void {
  if (
    confirmationSent.value ||
    request.generation !== snapshot.value.generation
  ) {
    syncSnapshot();
    return;
  }
  session.selectRows(request.generation, request.rowNumbers);
  syncSnapshot();
}

function cancelRequest(request: { generation: number }): void {
  if (
    request.generation !== snapshot.value.generation ||
    snapshot.value.phase === 'closed'
  )
    return;
  invalidateAndClose();
  emit('closeRequest');
}

function confirmRequest(request: { generation: number }): void {
  if (
    confirmationSent.value ||
    request.generation !== snapshot.value.generation
  )
    return;
  const selection = session.selection();
  if (!selection || !session.isCurrentSelection(selection)) return;
  confirmationSent.value = true;
  emit('confirmRequest', selection);
}

onBeforeUnmount(() => {
  mounted = false;
  abortActiveRead();
  session.cancel();
});
</script>

<template>
  <section
    v-if="open"
    class="demo-card demo-card--pad"
    data-test="csv-import-panel"
  >
    <h2>导入线索 CSV</h2>
    <label>
      选择 CSV 文件
      <input
        :key="`${contextKey}:${snapshot.generation}`"
        ref="input"
        type="file"
        accept=".csv,text/csv"
        :disabled="confirmationSent"
        data-test="csv-file-input"
        v-on="{ change: display.onFileChange }"
      />
    </label>
    <p v-if="confirmationSent" aria-live="polite" data-test="csv-intent-sent">
      当前选择已确认。
    </p>
    <LeadCsvPreviewPanel
      :snapshot="snapshot"
      @select-rows="selectRows"
      @cancel-request="cancelRequest"
      @confirm-request="confirmRequest"
    />
  </section>
</template>
