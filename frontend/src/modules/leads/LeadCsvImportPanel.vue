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
import {
  previewLeadWorkbook,
  downloadLeadWorkbookTemplate,
  type LeadWorkbookSheet,
} from '../../api/lead-workbook';
import { parseLeadCsvRecords } from './lead-csv-parser';
import {
  leadImportFields,
  mapLeadTableRows,
  officialLeadColumns,
  suggestLeadColumnMapping,
  type LeadColumnMapping,
  type LeadTableRecord,
} from './lead-import-table';

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
const workbookSheets = ref<LeadWorkbookSheet[]>([]);
const sheetIndex = ref<number | null>(null);
const headerIndex = ref<number | null>(null);
const fieldColumns = ref<Record<string, number | null>>({});
const ignoredConfirmed = ref(false);
const pendingGeneration = ref<number | null>(null);
const sourceRows = computed<LeadTableRecord[]>(() =>
  sheetIndex.value === null
    ? []
    : (workbookSheets.value[sheetIndex.value]?.rows ?? []),
);
const header = computed(() =>
  headerIndex.value === null
    ? null
    : (sourceRows.value[headerIndex.value] ?? null),
);
const mappingFields = computed(() => {
  const numbered = Object.keys(fieldColumns.value).flatMap((field) => {
    const match = /(?:商品名称|商品链接|销量|单价|评论数|截图)(\d+)$/u.exec(
      field,
    );
    return match ? [Number(match[1])] : [];
  });
  return leadImportFields(Math.max(10, ...numbered));
});
const baseMappingFields = leadImportFields(1);
const numberedGroups = computed(() =>
  Array.from(
    { length: (mappingFields.value.length - baseMappingFields.length) / 6 },
    (_, index) => index + 2,
  ),
);
const groupFields = (number: number) =>
  ['商品名称', '商品链接', '销量', '单价', '评论数', '截图'].map(
    (field) => `${field}${number}`,
  );
const extraColumns = computed(
  () =>
    header.value?.cells.flatMap((label, index) =>
      label.trim() && !Object.values(fieldColumns.value).includes(index)
        ? [{ index, label }]
        : [],
    ) ?? [],
);
const rawPreviewRows = computed(() =>
  headerIndex.value === null
    ? []
    : sourceRows.value
        .slice(headerIndex.value + 1)
        .filter((row) => row.cells.some((cell) => cell.trim()))
        .slice(0, 3),
);
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
  workbookSheets.value = [];
  sheetIndex.value = null;
  headerIndex.value = null;
  fieldColumns.value = {};
  ignoredConfirmed.value = false;
  pendingGeneration.value = null;
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
    fileError.value = '导入文件不能超过 2 MiB。';
    session.failFile(generation);
    syncSnapshot();
    return;
  }

  const controller = new AbortController();
  activeRead = { generation, controller };
  try {
    let rows: readonly LeadCsvParsedRow[] | null = null;
    if (props.parseFile) {
      rows = await props.parseFile(
        file,
        controller.signal,
        mappingContext.value,
      );
    } else if (/\.xlsx$/iu.test(file.name)) {
      workbookSheets.value = await previewLeadWorkbook(file, {
        signal: controller.signal,
      });
    } else {
      const bytes = await readBytes(file, controller.signal);
      if (controller.signal.aborted || !mounted) return;
      const records = parseLeadCsvRecords(bytes, {
        maxBytes: 2 * 1024 * 1024,
        maxRecords: 1001,
        maxColumns: 620,
      });
      try {
        rows = parseLeadCsvPreview(bytes, mappingContext.value);
      } catch {
        workbookSheets.value = [
          {
            name: 'CSV',
            rows: records.map((record) => ({
              rowNumber: record.startLine,
              cells: [...record.cells],
            })),
          },
        ];
      }
    }
    if (
      !mounted ||
      controller.signal.aborted ||
      activeRead?.generation !== generation ||
      contextKeyAtRender !== props.contextKey ||
      authorizationGenerationAtRender !== props.authorizationGeneration
    )
      return;
    if (rows) session.acceptParsed(generation, rows);
    else {
      pendingGeneration.value = generation;
      if (workbookSheets.value.length === 1) chooseSheet(0);
    }
  } catch {
    if (
      mounted &&
      !controller.signal.aborted &&
      activeRead?.generation === generation &&
      contextKeyAtRender === props.contextKey &&
      authorizationGenerationAtRender === props.authorizationGeneration
    ) {
      fileError.value = '无法解析当前导入文件，请检查格式、表头和内容。';
      session.failFile(generation);
    }
  } finally {
    if (activeRead?.generation === generation) activeRead = null;
    if (mounted) syncSnapshot();
  }
}

function chooseSheet(index: number): void {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= workbookSheets.value.length
  )
    return;
  sheetIndex.value = index;
  headerIndex.value = null;
  fieldColumns.value = {};
  ignoredConfirmed.value = false;
  const candidates = sourceRows.value.slice(0, 20).flatMap((row, rowIndex) => {
    const guess = suggestLeadColumnMapping(row.cells);
    return guess.missingFields.length === 0 &&
      Object.values(guess.fields).filter((value) => value !== null).length >= 15
      ? [rowIndex]
      : [];
  });
  if (candidates.length === 1) chooseHeader(candidates[0]!);
}

function chooseHeader(index: number): void {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= Math.min(20, sourceRows.value.length)
  )
    return;
  headerIndex.value = index;
  fieldColumns.value = {
    ...suggestLeadColumnMapping(sourceRows.value[index]!.cells).fields,
  };
  ignoredConfirmed.value = false;
}

function confirmMapping(): void {
  const generation = pendingGeneration.value;
  if (generation === null || !header.value || headerIndex.value === null)
    return;
  const chosen = Object.values(fieldColumns.value).filter(
    (value): value is number => value !== null && value !== undefined,
  );
  if (new Set(chosen).size !== chosen.length) {
    fileError.value = '一个源列不能映射多个字段。';
    return;
  }
  const base = suggestLeadColumnMapping(header.value.cells);
  const mapping: LeadColumnMapping = {
    ...base,
    fields: { ...fieldColumns.value },
    missingFields: officialLeadColumns.filter(
      (field) =>
        !['案件单号', '店铺ID', '线索备注', '运营', '截图'].includes(field) &&
        fieldColumns.value[field] == null,
    ),
  };
  if (mapping.missingFields.length) {
    fileError.value = `缺少必要字段：${mapping.missingFields.join('、')}`;
    return;
  }
  if (extraColumns.value.length && !ignoredConfirmed.value) {
    fileError.value = '请先确认忽略未映射的列。';
    return;
  }
  const rows = mapLeadTableRows(
    sourceRows.value.slice(headerIndex.value + 1),
    mapping,
    mappingContext.value,
  );
  if (rows.length > 1000) {
    fileError.value = '单个文件最多1000条数据行。';
    return;
  }
  if (!session.acceptParsed(generation, rows)) {
    fileError.value = '导入预览已过期，请重新选择文件。';
    return;
  }
  pendingGeneration.value = null;
  fileError.value = '';
  syncSnapshot();
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
    selection.rows.map(
      ({ rowNumber, input: selected, remoteScreenshots, operatorText }) => {
        const infringementTypes = Object.freeze([
          ...selected.infringementTypes,
        ]);
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
        return Object.freeze({
          rowNumber,
          input,
          ...(operatorText ? { operatorText } : {}),
          ...(remoteScreenshots
            ? {
                remoteScreenshots: Object.freeze(
                  remoteScreenshots.map((group) =>
                    Object.freeze({
                      productNumber: group.productNumber,
                      sourceGroupNumber: group.sourceGroupNumber,
                      urls: Object.freeze([...group.urls]),
                    }),
                  ),
                ),
              }
            : {}),
        });
      },
    ),
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

function saveTemplate(blob: globalThis.Blob, name: string): void {
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  globalThis.URL.revokeObjectURL(url);
}

async function downloadTemplate(): Promise<void> {
  try {
    const result = await downloadLeadWorkbookTemplate();
    saveTemplate(result.blob, '线索导入模板.xlsx');
  } catch {
    fileError.value = '无法下载 Excel 模板。';
  }
}

function downloadCsvTemplate(): void {
  const content = createLeadCsvTemplate(mappingContext.value);
  saveTemplate(
    new globalThis.Blob([`\uFEFF${content}`], {
      type: 'text/csv;charset=utf-8',
    }),
    '旧版线索导入模板.csv',
  );
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
    <h2>导入线索 Excel / CSV</h2>
    <p>
      运营列填写负责运营的实名；如有重名，请填写唯一登录用户名。可用运营以当前权限为准。
    </p>
    <p>
      单个文件最多 2 MiB、1000 条数据行；每次最多提交 20 条线索，实际请求还受 90
      KiB 上限约束。解析完成不表示全文件可以一次提交。
    </p>
    <ElButton
      data-test="csv-download-template"
      :disabled="submitting"
      @click="downloadTemplate"
    >
      下载 Excel 模板（19 列，预留 10 组商品）
    </ElButton>
    <ElButton :disabled="submitting" @click="downloadCsvTemplate"
      >下载旧版 CSV 模板</ElButton
    >
    <label>
      选择 Excel 或 CSV 文件
      <input
        :key="`${contextKey}:${authorizationGeneration}:${snapshot.generation}`"
        ref="input"
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        :disabled="submitting || confirmationSent"
        data-test="csv-file-input"
        v-on="{ change: display.onFileChange }"
      />
    </label>
    <div v-if="pendingGeneration !== null" data-test="lead-column-mapping">
      <label v-if="workbookSheets.length > 1"
        >工作表
        <select
          :value="sheetIndex ?? ''"
          @change="
            chooseSheet(Number(($event.target as HTMLSelectElement).value))
          "
        >
          <option value="" disabled>请选择工作表</option>
          <option
            v-for="(sheet, index) in workbookSheets"
            :key="index"
            :value="index"
          >
            {{ sheet.name }}
          </option>
        </select>
      </label>
      <label v-if="sheetIndex !== null"
        >表头行
        <select
          :value="headerIndex ?? ''"
          @change="
            chooseHeader(Number(($event.target as HTMLSelectElement).value))
          "
        >
          <option value="" disabled>请选择表头行</option>
          <option
            v-for="(row, index) in sourceRows.slice(0, 20)"
            :key="row.rowNumber"
            :value="index"
          >
            第 {{ row.rowNumber }} 行：{{ row.cells.slice(0, 4).join(' / ') }}
          </option>
        </select>
      </label>
      <template v-if="header">
        <p>请核对字段对应。重复、歧义或未识别列需手动处理。</p>
        <label v-for="field in baseMappingFields" :key="field"
          >{{ field }}
          <select
            v-model.number="fieldColumns[field]"
            @change="ignoredConfirmed = false"
          >
            <option :value="null">不映射</option>
            <option
              v-for="(label, index) in header.cells"
              :key="index"
              :value="index"
            >
              {{ index + 1 }}：{{ label || '（空列）' }}
            </option>
          </select>
        </label>
        <details v-for="number in numberedGroups" :key="number">
          <summary>商品 {{ number }} 的列</summary>
          <label v-for="field in groupFields(number)" :key="field"
            >{{ field }}
            <select
              v-model.number="fieldColumns[field]"
              @change="ignoredConfirmed = false"
            >
              <option :value="null">不映射</option>
              <option
                v-for="(label, index) in header.cells"
                :key="index"
                :value="index"
              >
                {{ index + 1 }}：{{ label || '（空列）' }}
              </option>
            </select>
          </label>
        </details>
        <p v-if="extraColumns.length">
          未导入列：{{
            extraColumns
              .map((item) => `${item.index + 1} ${item.label}`)
              .join('、')
          }}
        </p>
        <label v-if="extraColumns.length"
          ><input
            v-model="ignoredConfirmed"
            type="checkbox"
          />我确认忽略上述列的数据</label
        >
        <details v-if="rawPreviewRows.length">
          <summary>查看前 {{ rawPreviewRows.length }} 行原始数据</summary>
          <div style="overflow-x: auto">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th v-for="(label, index) in header.cells" :key="index">
                    {{ label || `第${index + 1}列` }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rawPreviewRows" :key="row.rowNumber">
                  <td>{{ row.rowNumber }}</td>
                  <td v-for="(_, index) in header.cells" :key="index">
                    {{ row.cells[index] ?? '' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <ElButton data-test="lead-confirm-mapping" @click="confirmMapping"
          >确认映射并预览数据</ElButton
        >
      </template>
    </div>
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
