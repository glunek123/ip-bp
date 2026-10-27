<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import OperationDrawer from '../../app/OperationDrawer.vue';
import { ApiError } from '../../api/http';
import {
  getExternalEntryOptions,
  type ExternalEntryOptions,
} from '../../api/cases';
import {
  commitCaseCsvImport,
  getCaseCsvImportTemplate,
  previewCaseCsvImport,
  type CaseCsvCommitResult,
  type CaseCsvDuplicateConfirmation,
  type CaseCsvPreviewResult,
} from '../../api/case-csv-import';

const props = defineProps<{
  open: boolean;
  contextKey: string;
  identityKey: string;
}>();
const emit = defineEmits<{
  close: [];
  completed: [result: CaseCsvCommitResult];
  'access-lost': [];
  'pending-state': [pending: boolean];
}>();
const headers = [
  '外录类型',
  '当前阶段',
  '到达日期',
  '来源',
  '原因',
  '客户编号',
  '权利主体',
  '被告类型',
  '被告姓名',
  '被告证件号',
  '被告电话',
  '被告地址',
  '律师',
  '法院',
  '法院案号',
  '受理日期',
  '二审受理日期',
  '平台',
  '店铺名称',
  '店铺外部编号',
  '案件类型',
  '侵权类型',
];
const options = ref<ExternalEntryOptions | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const fileName = ref('');
const fileInput = ref<globalThis.HTMLInputElement | null>(null);
const csvBase64 = ref('');
const preview = ref<CaseCsvPreviewResult | null>(null);
const selectedRows = ref<number[]>([]);
const result = ref<CaseCsvCommitResult | null>(null);
const duplicateConfirmedRows = ref<number[]>([]);
const previewStale = ref(false);
const pending = ref<{
  csvBase64: string;
  idempotencyKey: string;
  rowNumbers: number[];
  duplicateConfirmations: CaseCsvDuplicateConfirmation[];
} | null>(null);
const uncertain = ref(false);
const pendingIdentityKey = ref<string | null>(null);
const pendingBelongsToContext = computed(
  () =>
    pending.value === null || pendingIdentityKey.value === props.identityKey,
);
const epoch = ref(0);
const controller = ref<AbortController | null>(null);
function hasDuplicateCandidates(candidates: {
  cases: unknown[];
  rowNumbers: number[];
}): boolean {
  return candidates.cases.length > 0 || candidates.rowNumbers.length > 0;
}
const validSelection = computed(() =>
  (preview.value?.rows ?? []).filter(
    (row) => row.valid && selectedRows.value.includes(row.rowNumber),
  ),
);
const unconfirmedDuplicateRows = computed(() =>
  validSelection.value.filter((row) => {
    const candidates = row.duplicateCandidates;
    return (
      candidates !== undefined &&
      hasDuplicateCandidates(candidates) &&
      !duplicateConfirmedRows.value.includes(row.rowNumber)
    );
  }),
);
const customersById = computed(
  () =>
    new Map(
      (options.value?.customers ?? []).map((customer) => [
        customer.id,
        customer,
      ]),
    ),
);
const stageLabels: Record<string, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};
watch(
  () => [props.contextKey, props.identityKey],
  () => {
    epoch.value += 1;
    controller.value?.abort();
    busy.value = false;
    loading.value = false;
    if (!props.identityKey) {
      reset();
      options.value = null;
      emit('pending-state', false);
    } else if (!pending.value) {
      reset();
      options.value = null;
    } else {
      uncertain.value = true;
      error.value =
        '提交结果暂时未知。已保留原CSV、所选行和请求键，请显式核实原请求。';
    }
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  epoch.value += 1;
  controller.value?.abort();
});
watch(
  () => props.open,
  (open) => {
    if (open && pendingBelongsToContext.value && !options.value)
      void loadOptions();
    if (!open && !pending.value) reset();
  },
  { immediate: true },
);
function reset(): void {
  fileName.value = '';
  csvBase64.value = '';
  preview.value = null;
  selectedRows.value = [];
  result.value = null;
  duplicateConfirmedRows.value = [];
  previewStale.value = false;
  error.value = '';
  uncertain.value = false;
  pending.value = null;
  pendingIdentityKey.value = null;
}
function close(): void {
  if (busy.value || uncertain.value) return;
  emit('close');
}
function openFilePicker(): void {
  if (busy.value || pending.value) return;
  fileInput.value?.click();
}
async function loadOptions(): Promise<void> {
  const generation = epoch.value;
  const request = new AbortController();
  controller.value = request;
  loading.value = true;
  error.value = '';
  try {
    const value = await getExternalEntryOptions({ signal: request.signal });
    if (request.signal.aborted || generation !== epoch.value) return;
    if (!value.canCreate) {
      error.value = '当前账号无权批量录入案件。';
      emit('access-lost');
      return;
    }
    options.value = value;
  } catch (cause) {
    if (request.signal.aborted || generation !== epoch.value) return;
    error.value =
      cause instanceof Error ? cause.message : '无法读取案件录入选项。';
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    )
      emit('access-lost');
  } finally {
    if (generation === epoch.value) loading.value = false;
  }
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  return globalThis.btoa(binary);
}
async function onFileChange(event: globalThis.Event): Promise<void> {
  if (pending.value || busy.value) return;
  const generation = epoch.value;
  reset();
  const file = (event.target as globalThis.HTMLInputElement).files?.[0];
  if (!file) return;
  fileName.value = file.name;
  if (file.size > 64 * 1024) {
    error.value = 'CSV文件不能超过64KiB。';
    return;
  }
  try {
    csvBase64.value = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    if (generation !== epoch.value) return;
    const request = new AbortController();
    controller.value = request;
    busy.value = true;
    const value = await previewCaseCsvImport(csvBase64.value, {
      signal: request.signal,
    });
    if (request.signal.aborted || generation !== epoch.value) return;
    preview.value = value;
    duplicateConfirmedRows.value = [];
    previewStale.value = false;
    selectedRows.value = value.rows
      .filter((row) => row.valid)
      .slice(0, 20)
      .map((row) => row.rowNumber);
  } catch (cause) {
    if (generation !== epoch.value) return;
    error.value = cause instanceof Error ? cause.message : 'CSV预览失败。';
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    )
      emit('access-lost');
  } finally {
    if (generation === epoch.value) busy.value = false;
  }
}
function toggleRow(rowNumber: number, checked: boolean): void {
  if (pending.value || busy.value) return;
  selectedRows.value = checked
    ? [...new Set([...selectedRows.value, rowNumber])]
    : selectedRows.value.filter((value) => value !== rowNumber);
}
function confirmDuplicates(rowNumber: number, checked: boolean): void {
  if (pending.value || busy.value || previewStale.value) return;
  duplicateConfirmedRows.value = checked
    ? [...new Set([...duplicateConfirmedRows.value, rowNumber])]
    : duplicateConfirmedRows.value.filter((value) => value !== rowNumber);
}
async function refreshPreview(): Promise<void> {
  if (!csvBase64.value || busy.value || pending.value) return;
  const generation = epoch.value;
  const request = new AbortController();
  controller.value = request;
  busy.value = true;
  error.value = '';
  try {
    const value = await previewCaseCsvImport(csvBase64.value, {
      signal: request.signal,
    });
    if (request.signal.aborted || generation !== epoch.value) return;
    preview.value = value;
    duplicateConfirmedRows.value = [];
    previewStale.value = false;
    selectedRows.value = selectedRows.value.filter((rowNumber) =>
      value.rows.some((row) => row.rowNumber === rowNumber && row.valid),
    );
    error.value = '重复候选已更新。请逐行核对候选并重新确认后提交。';
  } catch (cause) {
    if (request.signal.aborted || generation !== epoch.value) return;
    error.value = cause instanceof Error ? cause.message : 'CSV重新预览失败。';
  } finally {
    if (generation === epoch.value) busy.value = false;
  }
}
async function downloadTemplate(): Promise<void> {
  if (busy.value) return;
  const generation = epoch.value;
  const request = new AbortController();
  controller.value = request;
  busy.value = true;
  error.value = '';
  try {
    const file = await getCaseCsvImportTemplate({ signal: request.signal });
    if (request.signal.aborted || generation !== epoch.value) return;
    const url = globalThis.URL.createObjectURL(file.blob);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.click();
    globalThis.URL.revokeObjectURL(url);
  } catch (cause) {
    if (request.signal.aborted || generation !== epoch.value) return;
    error.value = cause instanceof Error ? cause.message : '模板下载失败。';
  } finally {
    if (generation === epoch.value) busy.value = false;
  }
}
async function commit(): Promise<void> {
  if (
    !pendingBelongsToContext.value ||
    (!pending.value &&
      (!preview.value ||
        previewStale.value ||
        validSelection.value.length === 0 ||
        validSelection.value.length > 20)) ||
    busy.value
  )
    return;
  const generation = epoch.value;
  const input = pending.value ?? {
    csvBase64: csvBase64.value,
    idempotencyKey: globalThis.crypto.randomUUID(),
    rowNumbers: validSelection.value.map((row) => row.rowNumber),
    duplicateConfirmations: validSelection.value.flatMap((row) => {
      const candidates = row.duplicateCandidates;
      if (!candidates || !hasDuplicateCandidates(candidates)) return [];
      if (!duplicateConfirmedRows.value.includes(row.rowNumber)) return [];
      return [
        {
          rowNumber: row.rowNumber,
          caseIds: candidates.cases.map((candidate) => candidate.id),
          rowNumbers: candidates.rowNumbers,
        },
      ];
    }),
  };
  if (!pending.value && unconfirmedDuplicateRows.value.length) {
    error.value = `请先核对并确认第 ${unconfirmedDuplicateRows.value
      .map((row) => row.rowNumber)
      .join('、')} 行的重复候选。`;
    return;
  }
  pending.value = input;
  pendingIdentityKey.value = props.identityKey;
  emit('pending-state', true);
  busy.value = true;
  error.value = '';
  try {
    const value = await commitCaseCsvImport(input);
    if (generation !== epoch.value) return;
    result.value = value;
    pending.value = null;
    uncertain.value = false;
    emit('pending-state', false);
    emit('completed', value);
  } catch (cause) {
    if (generation !== epoch.value) return;
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    ) {
      error.value = '当前账号已无权导入案件。';
      pending.value = null;
      emit('pending-state', false);
      emit('access-lost');
    } else if (
      cause instanceof ApiError &&
      cause.status === 409 &&
      cause.code === 'CASE_CSV_DUPLICATES_CHANGED'
    ) {
      pending.value = null;
      emit('pending-state', false);
      previewStale.value = true;
      duplicateConfirmedRows.value = [];
      const rowNumber = cause.details?.rowNumber;
      error.value = `第 ${typeof rowNumber === 'number' ? rowNumber : ''} 行的重复候选已变化。请重新预览并核对候选，再重新确认。`;
    } else if (
      cause instanceof ApiError &&
      cause.status >= 400 &&
      cause.status < 500
    ) {
      pending.value = null;
      emit('pending-state', false);
      error.value = cause.message || 'CSV提交未被接受，请修正后重新预览。';
    } else {
      uncertain.value = true;
      error.value =
        '提交结果暂时未知。已保留原CSV、所选行和请求键，请显式核实原请求。';
    }
  } finally {
    if (generation === epoch.value) busy.value = false;
  }
}
function customerName(row: { input?: Record<string, unknown> }): string {
  const id = row.input?.customerId;
  return typeof id === 'string'
    ? (customersById.value.get(id)?.name ?? '当前权限内未找到客户')
    : '—';
}
function rightsHolderName(row: { input?: Record<string, unknown> }): string {
  const customerId = row.input?.customerId;
  const holderId = row.input?.rightsHolderId;
  const customer =
    typeof customerId === 'string'
      ? customersById.value.get(customerId)
      : undefined;
  return typeof holderId === 'string'
    ? (customer?.rightsHolders.find((holder) => holder.id === holderId)?.name ??
        '当前权限内未找到权利主体')
    : '—';
}
</script>

<template>
  <OperationDrawer
    :open="open"
    title="CSV批量录入案件"
    size="min(960px, 100vw)"
    :locked="pendingBelongsToContext && (busy || uncertain)"
    @close="pendingBelongsToContext ? close() : emit('close')"
  >
    <div v-if="pendingBelongsToContext" class="csv-import-panel">
      <p>
        仅录入已有案件。不会生成线索或公证事项，也不支持PDF识别。文件须为UTF-8
        CSV且不超过64KiB；最多预览1000行、每次提交20行。
      </p>
      <details>
        <summary>CSV填写规则</summary>
        <p>
          列顺序：{{
            headers.join('、')
          }}。被告类型、姓名、证件号、电话和地址按换行逐行对应；可选列可以留空。多个侵权类型用中文分号分隔。
        </p>
      </details>
      <div class="operation-bar csv-file-actions">
        <ElButton
          class="action-size--wide"
          :disabled="busy"
          @click="downloadTemplate"
          >下载中文模板</ElButton
        >
        <div class="csv-file-picker">
          <label for="case-csv-import-file">CSV文件</label>
          <input
            id="case-csv-import-file"
            ref="fileInput"
            type="file"
            accept=".csv,text/csv"
            :disabled="busy || pending !== null"
            @change="onFileChange"
          />
          <ElButton
            class="action-size--standard"
            :disabled="busy || pending !== null"
            data-test="choose-case-csv-file"
            @click="openFilePicker"
            >{{ fileName ? '更换文件' : '选择文件' }}</ElButton
          >
        </div>
      </div>
      <p v-if="fileName" role="status">{{ fileName }}</p>
      <p v-if="loading || busy" role="status">正在处理CSV…</p>
      <p v-if="preview">
        有效 {{ preview.validCount }} 行，错误 {{ preview.errorCount }} 行。
      </p>
      <div v-if="preview" class="csv-preview-scroll">
        <table class="demo-table">
          <thead>
            <tr>
              <th>选择</th>
              <th>文件行</th>
              <th>客户</th>
              <th>权利主体</th>
              <th>阶段</th>
              <th>校验结果</th>
              <th>重复候选／确认</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in preview.rows" :key="row.rowNumber">
              <td>
                <input
                  type="checkbox"
                  :checked="selectedRows.includes(row.rowNumber)"
                  :disabled="
                    !row.valid ||
                    busy ||
                    pending !== null ||
                    (!selectedRows.includes(row.rowNumber) &&
                      validSelection.length >= 20)
                  "
                  :aria-label="`选择CSV第${row.rowNumber}行`"
                  @change="
                    toggleRow(
                      row.rowNumber,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
              </td>
              <td>{{ row.rowNumber }}</td>
              <td>{{ customerName(row) }}</td>
              <td>{{ rightsHolderName(row) }}</td>
              <td>
                {{
                  typeof row.input?.initialStage === 'string'
                    ? (stageLabels[row.input.initialStage] ?? '—')
                    : '—'
                }}
              </td>
              <td>
                <span v-if="row.valid">有效</span>
                <ul v-else>
                  <li
                    v-for="(issue, index) in row.errors"
                    :key="`${issue.code}:${index}`"
                  >
                    {{ issue.field }}：{{ issue.message }}
                  </li>
                </ul>
              </td>
              <td>
                <template
                  v-if="
                    row.duplicateCandidates &&
                    hasDuplicateCandidates(row.duplicateCandidates)
                  "
                >
                  <p>
                    疑似重复按客户、法院和法院案号匹配，仅提示，不会自动合并。
                  </p>
                  <p>
                    已有案件：
                    <span v-if="row.duplicateCandidates.cases.length === 0"
                      >无</span
                    >
                    <span
                      v-for="candidate in row.duplicateCandidates.cases"
                      :key="candidate.id"
                      class="csv-duplicate-candidate"
                      >{{ candidate.businessNo }}</span
                    >
                  </p>
                  <p>
                    文件内同行：
                    <span v-if="row.duplicateCandidates.rowNumbers.length === 0"
                      >无</span
                    >
                    <span v-else>{{
                      row.duplicateCandidates.rowNumbers.join('、')
                    }}</span>
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      :checked="duplicateConfirmedRows.includes(row.rowNumber)"
                      :disabled="busy || pending !== null || previewStale"
                      :aria-label="`确认CSV第${row.rowNumber}行重复候选`"
                      @change="
                        confirmDuplicates(
                          row.rowNumber,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    我已核对以上候选，仍继续录入本行
                  </label>
                </template>
                <span v-else>未发现疑似重复</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="result" role="status">
        已成功提交 {{ result.items.length }} 行。
      </p>
      <ul v-if="result" aria-label="CSV导入结果">
        <li v-for="item in result.items" :key="item.rowNumber">
          第 {{ item.rowNumber }} 行：{{ item.businessNo }} ·
          {{ stageLabels[item.stage] ?? item.stage }}
        </li>
      </ul>
      <p v-if="uncertain" role="status">{{ error }}</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <ElButton
        v-if="previewStale"
        class="action-size--standard"
        :disabled="busy || pending !== null"
        data-test="refresh-csv-preview"
        @click="refreshPreview"
        >重新预览重复候选</ElButton
      >
    </div>
    <p v-else class="pending-owner-notice">
      其他账号有待核实请求，请返回原账号核实。
    </p>
    <template #footer>
      <ElButton
        v-if="pendingBelongsToContext"
        class="action-size--wide"
        type="primary"
        :disabled="
          busy ||
          previewStale ||
          (!uncertain &&
            (validSelection.length === 0 ||
              validSelection.length > 20 ||
              unconfirmedDuplicateRows.length > 0 ||
              result !== null))
        "
        :loading="busy"
        data-test="commit-case-csv"
        @click="commit"
        >{{
          uncertain ? '核实原请求' : `提交所选 ${validSelection.length} 行`
        }}</ElButton
      >
      <ElButton
        class="action-size--standard"
        :disabled="pendingBelongsToContext && (busy || uncertain)"
        data-test="close-case-csv"
        @click="pendingBelongsToContext ? close() : emit('close')"
        >{{
          pendingBelongsToContext && uncertain ? '保留原请求' : '关闭'
        }}</ElButton
      >
    </template>
  </OperationDrawer>
</template>

<style scoped>
.csv-import-panel {
  display: grid;
  min-width: 0;
  gap: var(--s-4);
}
.csv-import-panel :where(p, ul) {
  margin: 0;
}
.csv-file-actions {
  padding-block: var(--s-3);
  border-block: 1px solid var(--color-hairline);
}
.csv-file-picker {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
}
.csv-file-picker input[type='file'] {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.csv-preview-scroll {
  max-height: min(45vh, 420px);
  overflow: auto;
}
.csv-preview-scroll table {
  min-width: 980px;
}
.csv-duplicate-candidate {
  display: inline-block;
  margin-inline-end: var(--s-2);
}
.csv-preview-scroll ul {
  margin: 0;
  padding-inline-start: var(--s-4);
}
</style>
