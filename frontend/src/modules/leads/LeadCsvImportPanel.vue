<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { LeadFormContext, LeadBusinessResult } from '../../api/leads';
import {
  parseLeadCsvPreview,
  createLeadCsvTemplate,
  type LeadCsvMappingContext,
} from './lead-csv-adapter';
import type { LeadCsvParsedRow, LeadCsvSelection } from './lead-csv-preview';
import { LeadCsvPreviewSession, type LeadCsvPreview } from './lead-csv-preview';
import type {
  LeadCsvImportAttempt,
  LeadCsvImportItem,
  LeadCsvImportSubmissionContext,
  LeadCsvImportSubmitOutcome,
} from './lead-csv-import-recovery';
import LeadCsvPreviewPanel from './LeadCsvPreviewPanel.vue';

const props = defineProps<{
  open: boolean;
  contextKey: string;
  formContext: LeadFormContext;
  operatorDisplayName: string;
  actorIdentity: string;
  authorizationGeneration: string;
  submitAttempt: (
    attempt: LeadCsvImportAttempt,
    context: LeadCsvImportSubmissionContext,
  ) => Promise<LeadCsvImportSubmitOutcome>;
  parseFile?: (
    file: InstanceType<typeof globalThis.File>,
    signal: globalThis.AbortSignal,
    context: LeadCsvMappingContext,
  ) => Promise<readonly LeadCsvParsedRow[]>;
}>();

const emit = defineEmits<{
  closeRequest: [];
  imported: [
    attempt: LeadCsvImportAttempt,
    result: { items: Array<{ rowNumber: number; lead: LeadBusinessResult }> },
    context: { contextKey: string; authorizationGeneration: string },
  ];
}>();

const session = new LeadCsvPreviewSession();
const snapshot = ref<LeadCsvPreview>(session.snapshot());
const input = ref<InstanceType<typeof globalThis.HTMLInputElement>>();
const submitting = ref(false);
const confirmationSent = ref(false);
const selectionError = ref('');
const fileError = ref('');
const submitError = ref('');
let mounted = true;
let activeRead: { generation: number; controller: AbortController } | null =
  null;
let activeSubmission: AbortController | null = null;

const mappingContext = computed<LeadCsvMappingContext>(() => ({
  formContext: props.formContext,
  operatorDisplayName: props.operatorDisplayName,
}));
const display = computed(() => {
  const generation = snapshot.value.generation;
  const contextKey = props.contextKey;
  const authorizationGeneration = props.authorizationGeneration;
  return {
    onFileChange: (event: globalThis.Event) =>
      chooseFile(generation, contextKey, authorizationGeneration, event),
  };
});

function syncSnapshot(): void {
  snapshot.value = session.snapshot();
}
function abortRead(): void {
  activeRead?.controller.abort();
  activeRead = null;
}
function abortSubmission(): void {
  activeSubmission?.abort();
  activeSubmission = null;
  submitting.value = false;
}
function resetSession(isOpen: boolean): void {
  abortRead();
  abortSubmission();
  if (input.value) input.value.value = '';
  confirmationSent.value = false;
  selectionError.value = '';
  fileError.value = '';
  submitError.value = '';
  if (isOpen) session.open();
  else session.cancel();
  syncSnapshot();
}

watch(
  () =>
    [
      props.open,
      props.contextKey,
      props.formContext,
      props.operatorDisplayName,
      props.actorIdentity,
      props.authorizationGeneration,
    ] as const,
  ([isOpen]) => resetSession(isOpen),
  { immediate: true, flush: 'sync' },
);

function readBytes(
  file: InstanceType<typeof globalThis.File>,
  signal: globalThis.AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new globalThis.DOMException('读取已取消', 'AbortError'));
      return;
    }
    const reader = new globalThis.FileReader();
    const detach = () => signal.removeEventListener('abort', abortReader);
    const abortReader = () => {
      if (reader.readyState === globalThis.FileReader.LOADING) reader.abort();
    };
    reader.onerror = () => {
      detach();
      reject(reader.error ?? new Error('无法读取 CSV 文件'));
    };
    reader.onabort = () => {
      detach();
      reject(new globalThis.DOMException('读取已取消', 'AbortError'));
    };
    reader.onload = () => {
      detach();
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('文件读取结果无效'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    signal.addEventListener('abort', abortReader, { once: true });
    reader.readAsArrayBuffer(file);
  });
}

async function chooseFile(
  generationAtRender: number,
  contextKeyAtRender: string,
  authorizationGenerationAtRender: string,
  event: globalThis.Event,
): Promise<void> {
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  const file = target.files?.[0];
  target.value = '';
  if (
    !file ||
    !props.open ||
    submitting.value ||
    confirmationSent.value ||
    contextKeyAtRender !== props.contextKey ||
    authorizationGenerationAtRender !== props.authorizationGeneration ||
    generationAtRender !== snapshot.value.generation ||
    snapshot.value.phase === 'closed'
  )
    return;

  abortRead();
  selectionError.value = '';
  fileError.value = '';
  submitError.value = '';
  const generation = session.beginFile(file.name);
  syncSnapshot();
  if (generation === null) return;
  if (file.size > 2 * 1024 * 1024) {
    fileError.value = 'CSV 文件不能超过 2 MiB。';
    session.failFile(generation);
    syncSnapshot();
    return;
  }

  const controller = new AbortController();
  activeRead = { generation, controller };
  try {
    const rows = props.parseFile
      ? await props.parseFile(file, controller.signal, mappingContext.value)
      : parseLeadCsvPreview(
          await readBytes(file, controller.signal),
          mappingContext.value,
        );
    if (
      !mounted ||
      controller.signal.aborted ||
      activeRead?.generation !== generation ||
      contextKeyAtRender !== props.contextKey ||
      authorizationGenerationAtRender !== props.authorizationGeneration
    )
      return;
    session.acceptParsed(generation, rows);
  } catch {
    if (
      mounted &&
      !controller.signal.aborted &&
      activeRead?.generation === generation &&
      contextKeyAtRender === props.contextKey &&
      authorizationGenerationAtRender === props.authorizationGeneration
    ) {
      fileError.value = '无法解析当前 CSV 文件，请检查编码、表头和内容。';
      session.failFile(generation);
    }
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
    submitting.value ||
    confirmationSent.value ||
    request.generation !== snapshot.value.generation
  ) {
    syncSnapshot();
    return;
  }
  const uniqueRows = new Set(request.rowNumbers);
  if (uniqueRows.size !== request.rowNumbers.length || uniqueRows.size > 20) {
    selectionError.value = '每次最多选择 20 条有效线索。';
    syncSnapshot();
    return;
  }
  if (!session.selectRows(request.generation, request.rowNumbers)) {
    syncSnapshot();
    return;
  }
  selectionError.value = '';
  submitError.value = '';
  syncSnapshot();
}

function freezeItems(
  selection: LeadCsvSelection,
): readonly LeadCsvImportItem[] {
  return Object.freeze(
    selection.rows.map(({ rowNumber, input: selected }) => {
      const infringementTypes = Object.freeze([...selected.infringementTypes]);
      const products = Object.freeze(
        selected.products.map((product) => Object.freeze({ ...product })),
      );
      const input = Object.freeze({
        customerId: selected.customerId,
        rightsHolderId: selected.rightsHolderId,
        caseType: selected.caseType,
        infringementTypes,
        source: selected.source,
        platform: selected.platform,
        foundAt: selected.foundAt,
        shopName: selected.shopName,
        ...(selected.shopExternalId === undefined
          ? {}
          : { shopExternalId: selected.shopExternalId }),
        needDisclose: selected.needDisclose,
        ...(selected.remark === undefined ? {} : { remark: selected.remark }),
        products,
        leadScreenshotContentVersionIds: Object.freeze([]) as readonly [],
      });
      return Object.freeze({ rowNumber, input });
    }),
  );
}

async function confirmRequest(request: { generation: number }): Promise<void> {
  if (
    submitting.value ||
    confirmationSent.value ||
    request.generation !== snapshot.value.generation
  )
    return;
  const selection = session.selection();
  if (
    !selection ||
    selection.rows.length < 1 ||
    selection.rows.length > 20 ||
    !session.isCurrentSelection(selection)
  )
    return;

  const attempt: LeadCsvImportAttempt = Object.freeze({
    actorIdentity: props.actorIdentity,
    idempotencyKey: globalThis.crypto.randomUUID(),
    items: freezeItems(selection),
  });
  const contextKey = props.contextKey;
  const authorizationGeneration = props.authorizationGeneration;
  const controller = new AbortController();
  activeSubmission = controller;
  submitting.value = true;
  confirmationSent.value = true;
  selectionError.value = '';
  submitError.value = '';
  const context: LeadCsvImportSubmissionContext = Object.freeze({
    contextKey,
    authorizationGeneration,
    signal: controller.signal,
  });

  let outcome: LeadCsvImportSubmitOutcome;
  try {
    outcome = await props.submitAttempt(attempt, context);
  } catch (cause) {
    outcome = {
      kind: 'unknown',
      message:
        cause instanceof Error
          ? cause.message
          : '请求结果待核对，请保留原请求。',
    };
  } finally {
    if (activeSubmission === controller) {
      activeSubmission = null;
      submitting.value = false;
    }
  }

  if (
    !mounted ||
    controller.signal.aborted ||
    contextKey !== props.contextKey ||
    authorizationGeneration !== props.authorizationGeneration ||
    !session.isCurrentSelection(selection)
  )
    return;

  if (outcome.kind === 'created')
    emit('imported', attempt, outcome.result, {
      contextKey,
      authorizationGeneration,
    });
  else if (outcome.kind === 'rejected') {
    confirmationSent.value = false;
    submitError.value = outcome.message;
  } else submitError.value = outcome.message;
}

function cancelRequest(request: { generation: number }): void {
  if (
    submitting.value ||
    request.generation !== snapshot.value.generation ||
    snapshot.value.phase === 'closed'
  )
    return;
  abortRead();
  session.cancel();
  confirmationSent.value = false;
  selectionError.value = '';
  fileError.value = '';
  submitError.value = '';
  syncSnapshot();
  if (input.value) input.value.value = '';
  emit('closeRequest');
}

function downloadTemplate(): void {
  const content = createLeadCsvTemplate(mappingContext.value);
  const blob = new globalThis.Blob([`\uFEFF${content}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = '线索导入模板.csv';
  anchor.click();
  globalThis.URL.revokeObjectURL(url);
}

onBeforeUnmount(() => {
  mounted = false;
  abortRead();
  abortSubmission();
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
    <p>
      单个文件最多 2 MiB；每次最多提交 20 条线索，实际请求还受 90 KiB
      上限约束。解析完成不表示全文件可以一次提交。
    </p>
    <ElButton
      data-test="csv-download-template"
      :disabled="submitting"
      @click="downloadTemplate"
    >
      下载 CSV 模板
    </ElButton>
    <label>
      选择 CSV 文件
      <input
        :key="`${contextKey}:${authorizationGeneration}:${snapshot.generation}`"
        ref="input"
        type="file"
        accept=".csv,text/csv"
        :disabled="submitting || confirmationSent"
        data-test="csv-file-input"
        v-on="{ change: display.onFileChange }"
      />
    </label>
    <p v-if="fileError" role="alert" data-test="csv-file-error">
      {{ fileError }}
    </p>
    <p v-if="selectionError" role="alert" data-test="csv-selection-error">
      {{ selectionError }}
    </p>
    <p v-if="submitting" aria-live="polite" data-test="csv-submitting">
      正在提交当前选择…
    </p>
    <p
      v-else-if="confirmationSent && submitError"
      role="alert"
      data-test="csv-unknown"
    >
      {{ submitError }}
    </p>
    <p v-else-if="submitError" role="alert" data-test="csv-submit-error">
      {{ submitError }}
    </p>
    <LeadCsvPreviewPanel
      :snapshot="snapshot"
      :form-context="formContext"
      @select-rows="selectRows"
      @cancel-request="cancelRequest"
      @confirm-request="confirmRequest"
    />
  </section>
</template>
