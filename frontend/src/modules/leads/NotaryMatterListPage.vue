<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  exportNotaryList,
  previewNotaryListExport,
  type NotaryListExportScope,
} from '../../api/notary-list-export';
import type { ArchiveNotaryReturnBatchInput } from '../../api/notary-return-archive-batch';
import {
  listNotaryMatters,
  notaryListStages,
  type NotaryListStage,
  type NotaryMatterListItem,
} from '../../api/notary';
import {
  defaultNotaryListPreference,
  getNotaryListPreference,
  saveNotaryListPreference,
  type NotaryListPreference,
  type NotaryListPreferenceColumn,
} from '../../api/notary-list-preference';
import { useAuthStore } from '../../stores/auth';
import NotaryReturnArchiveBatchPanel from './NotaryReturnArchiveBatchPanel.vue';
import { labelLeadPlatform } from './lead-options';
import type { CaseStage } from '../../api/cases';

const stageLabels: Record<NotaryListStage, string> = {
  PENDING_EVIDENCE: '待取证',
  WAITING_UNBOX: '待取件开箱',
  UNBOX_REVIEW: '开箱待审核',
  ISSUANCE_DECISION: '开箱待确认',
  WAITING_CERTIFICATE: '待出证',
  WAITING_RETURN: '待退货',
  ARCHIVED: '已归档',
};
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<NotaryMatterListItem[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const preferenceState = ref<'loading' | 'ready' | 'failed'>('loading');
const savedPreference = ref<NotaryListPreference>({
  order: [...defaultNotaryListPreference.order],
  hidden: [...defaultNotaryListPreference.hidden],
});
const draftOrder = ref<NotaryListPreferenceColumn[]>([
  ...defaultNotaryListPreference.order,
]);
const draftHidden = ref<NotaryListPreference['hidden']>([
  ...defaultNotaryListPreference.hidden,
]);
const settingsOpen = ref(false);
const preferenceMessage = ref('正在读取个人列设置。');
const saving = ref(false);
const selectedIds = ref<string[]>([]);
const batchOpen = ref(false);
type PendingBatch = {
  items: ArchiveNotaryReturnBatchInput[];
  key: string;
  scopeKey: string;
};
const pendingBatches = ref<Record<string, PendingBatch>>({});
const activeBatchRequest = ref<PendingBatch | null>(null);
const exportOpen = ref(false);
const exportMode = ref<'SELECTED' | 'FILTERED' | null>(null);
const exportPreview = ref<{ count: number; maxRows: 1000 } | null>(null);
const exportMessage = ref('');
const exportLoading = ref(false);
let listRequest: AbortController | undefined;
let preferenceRequest: AbortController | undefined;
let saveRequest: AbortController | undefined;
let preferenceGeneration = 0;
let saveGeneration = 0;
let currentListScope = '';
let exportPreviewRequest: AbortController | undefined;
let exportRequest: AbortController | undefined;
let exportGeneration = 0;
let currentExportScopeKey = '';

const selectedStage = computed<NotaryListStage | undefined>(() => {
  const value = route.query.stage;
  return typeof value === 'string' &&
    notaryListStages.some((stage) => stage === value)
    ? (value as NotaryListStage)
    : undefined;
});
const requestedPage = computed(() => {
  const value = Array.isArray(route.query.page)
    ? route.query.page[0]
    : route.query.page;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
});
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);
const columnLabels: Record<NotaryListPreferenceColumn, string> = {
  businessNo: '公证事项编号',
  stage: '案件进展',
  rightsHolder: '权利主体',
  platform: '平台',
  shopName: '店铺名',
  shopExternalId: '店铺ID',
  transferredAt: '推送日期',
  evidenceAt: '取证日期',
  openingPhotos: '开箱照片',
  certificateNo: '公证书编号',
  senderName: '发货人',
  senderPhone: '发货电话',
  senderAddress: '发货地址',
  notaryFee: '公证费',
  investigationFee: '调查费',
  sampleFee: '样品费',
  sourceLead: '来源线索',
  notaryOffice: '公证处',
  createdAt: '创建时间',
};
const optionalColumns = computed(() =>
  draftOrder.value.filter(isOptionalColumn),
);
const visibleColumns = computed(() =>
  savedPreference.value.order.filter(
    (column) =>
      column !== 'businessNo' &&
      (!isOptionalColumn(column) ||
        !savedPreference.value.hidden.includes(column)),
  ),
);
const tableWidth = computed(
  () =>
    48 +
    200 +
    visibleColumns.value.reduce(
      (width, column) => width + columnWidth(column),
      0,
    ),
);
const caseStageLabels: Record<CaseStage, string> = {
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

function columnWidth(column: NotaryListPreferenceColumn): number {
  if (column === 'stage' || column === 'senderPhone') return 140;
  if (column === 'platform') return 100;
  if (
    column === 'senderAddress' ||
    column === 'certificateNo' ||
    column === 'createdAt'
  )
    return 240;
  if (
    [
      'transferredAt',
      'evidenceAt',
      'openingPhotos',
      'notaryFee',
      'investigationFee',
      'sampleFee',
    ].includes(column)
  )
    return 120;
  return 160;
}
function isTextColumn(column: NotaryListPreferenceColumn): boolean {
  return [
    'rightsHolder',
    'shopName',
    'senderName',
    'senderAddress',
    'notaryOffice',
  ].includes(column);
}
function isFeeColumn(column: NotaryListPreferenceColumn): boolean {
  return ['notaryFee', 'investigationFee', 'sampleFee'].includes(column);
}
function feeLabel(fee: NotaryMatterListItem['fees']['notary']): string {
  return fee.state === 'KNOWN'
    ? `¥ ${fee.amount}`
    : fee.state === 'PENDING'
      ? '待定'
      : '未登记';
}
function columnText(
  matter: NotaryMatterListItem,
  column: NotaryListPreferenceColumn,
): string {
  switch (column) {
    case 'rightsHolder':
      return matter.sourceSummary.rightsHolder.name;
    case 'platform':
      return labelLeadPlatform(matter.sourceSummary.platform);
    case 'shopName':
      return matter.sourceSummary.shopName;
    case 'shopExternalId':
      return matter.sourceSummary.shopExternalId ?? '未登记';
    case 'transferredAt':
      return matter.transferredAt;
    case 'evidenceAt':
      return matter.evidenceAt ?? '未登记';
    case 'certificateNo':
      return matter.certificateSummary?.certificateNo ?? '未登记';
    case 'senderName':
      return matter.openingSummary?.senderName ?? '未登记';
    case 'senderPhone':
      return matter.openingSummary?.senderPhone ?? '未登记';
    case 'senderAddress':
      return matter.openingSummary?.senderAddress ?? '未登记';
    case 'notaryFee':
      return feeLabel(matter.fees.notary);
    case 'investigationFee':
      return feeLabel(matter.fees.investigation);
    case 'sampleFee':
      return feeLabel(matter.fees.sample);
    case 'notaryOffice':
      return matter.notaryOffice.name;
    case 'createdAt':
      return formatTime(matter.createdAt);
    default:
      return '';
  }
}
function matterActions(
  matter: NotaryMatterListItem,
): Array<{ label: string; anchor: string }> {
  const actions = [
    {
      enabled: matter.capabilities.recordEvidence,
      label: '登记取证',
      anchor: 'evidence-form',
    },
    {
      enabled: matter.capabilities.recordOpening,
      label: '登记开箱',
      anchor: 'opening-form',
    },
    {
      enabled: matter.capabilities.reviewOpening,
      label: '审核',
      anchor: 'review-form',
    },
    {
      enabled: matter.capabilities.decideIssuance,
      label: '确认',
      anchor: 'issuance-form',
    },
    {
      enabled: matter.capabilities.archiveReturn,
      label: '处理退货',
      anchor: 'return-archive-form',
    },
  ];
  return actions.filter((action) => action.enabled);
}
const exportScopeKey = computed(() =>
  JSON.stringify({
    identity: identity.value,
    userId: auth.session?.user.id ?? '',
    departmentId: auth.session?.department?.id ?? '',
    stage: selectedStage.value ?? null,
    mode: exportMode.value,
    matterIds:
      exportMode.value === 'SELECTED' ? [...selectedIds.value].sort() : [],
  }),
);
const batchScopeKey = computed(
  () => `${identity.value}:${selectedStage.value ?? ''}`,
);
const pendingBatchForScope = computed(
  () => pendingBatches.value[batchScopeKey.value] ?? null,
);
const canConfirmExport = computed(
  () =>
    exportPreview.value !== null &&
    currentExportScopeKey === exportScopeKey.value,
);

function buildExportScope(): NotaryListExportScope | null {
  if (exportMode.value === 'SELECTED') {
    if (selectedIds.value.length === 0 || selectedIds.value.length > 1000)
      return null;
    return { mode: 'SELECTED', matterIds: [...selectedIds.value] };
  }
  if (exportMode.value === 'FILTERED') {
    return selectedStage.value
      ? { mode: 'FILTERED', stage: selectedStage.value }
      : { mode: 'FILTERED' };
  }
  return null;
}

function invalidateExport(): void {
  exportGeneration += 1;
  exportPreviewRequest?.abort();
  exportRequest?.abort();
  exportPreviewRequest = undefined;
  exportRequest = undefined;
  exportPreview.value = null;
  currentExportScopeKey = '';
  exportLoading.value = false;
}

function toggleMatter(id: string, checked: boolean): void {
  if (checked) {
    if (selectedIds.value.length >= 1000) {
      exportMessage.value = '最多可选择 1000 项，请缩小范围。';
      return;
    }
    if (!selectedIds.value.includes(id))
      selectedIds.value = [...selectedIds.value, id];
  } else {
    selectedIds.value = selectedIds.value.filter(
      (selectedId) => selectedId !== id,
    );
  }
  invalidateExport();
  exportMessage.value = '';
}

function toggleCurrentPage(checked: boolean): void {
  const pageIds = items.value.map((item) => item.id);
  if (checked) {
    const next = [...new Set([...selectedIds.value, ...pageIds])];
    if (next.length > 1000) {
      exportMessage.value = '最多可选择 1000 项，请缩小范围。';
      return;
    }
    selectedIds.value = next;
  } else {
    selectedIds.value = selectedIds.value.filter((id) => !pageIds.includes(id));
  }
  invalidateExport();
  exportMessage.value = '';
}

function clearSelection(): void {
  selectedIds.value = [];
  invalidateExport();
  exportMessage.value = '';
}

function completeBatch(): void {
  clearSelection();
  batchOpen.value = false;
  activeBatchRequest.value = null;
  void load();
}

function holdBatch(request: PendingBatch): void {
  pendingBatches.value[request.scopeKey] = request;
}

function resolveBatch(request: PendingBatch): void {
  if (pendingBatches.value[request.scopeKey]?.key === request.key)
    delete pendingBatches.value[request.scopeKey];
}

function closeBatch(): void {
  batchOpen.value = false;
  activeBatchRequest.value = null;
}

function resumeBatch(): void {
  if (!pendingBatchForScope.value) return;
  activeBatchRequest.value = pendingBatchForScope.value;
  batchOpen.value = true;
}

async function requestExportPreview(): Promise<void> {
  if (exportLoading.value) return;
  const scope = buildExportScope();
  if (!scope) {
    exportMessage.value = '请先明确选择导出范围；已勾选事项至少需要选择 1 项。';
    return;
  }
  invalidateExport();
  const generation = exportGeneration;
  const scopeKey = exportScopeKey.value;
  const userId = auth.session?.user.id;
  const departmentId = auth.session?.department?.id;
  const controller = new AbortController();
  exportPreviewRequest = controller;
  exportLoading.value = true;
  exportMessage.value = '正在核对导出范围与数量。';
  try {
    const result = await previewNotaryListExport(scope, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      auth.session?.user.id !== userId ||
      auth.session?.department?.id !== departmentId ||
      scopeKey !== exportScopeKey.value
    )
      return;
    exportPreview.value = result;
    currentExportScopeKey = scopeKey;
    exportMessage.value = `后端核对完成，共 ${result.count} 条。请确认后下载。`;
  } catch (error) {
    if (controller.signal.aborted || generation !== exportGeneration) return;
    exportMessage.value =
      error instanceof Error ? error.message : '预览失败，请重试。';
    if ((error as { code?: string })?.code === 'EXPORT_LIMIT_EXCEEDED')
      exportMessage.value = '导出范围超过 1000 条，请缩小范围后重新预览。';
  } finally {
    if (generation === exportGeneration) exportLoading.value = false;
  }
}

async function confirmExport(): Promise<void> {
  if (exportLoading.value || !canConfirmExport.value || !exportPreview.value)
    return;
  const scope = buildExportScope();
  if (!scope) return;
  const expectedCount = exportPreview.value.count;
  const generation = exportGeneration;
  const scopeKey = exportScopeKey.value;
  const userId = auth.session?.user.id;
  const departmentId = auth.session?.department?.id;
  const controller = new AbortController();
  exportRequest = controller;
  exportLoading.value = true;
  exportMessage.value = '正在生成下载文件。';
  try {
    const file = await exportNotaryList(scope, expectedCount, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      auth.session?.user.id !== userId ||
      auth.session?.department?.id !== departmentId ||
      scopeKey !== exportScopeKey.value
    )
      return;
    const url = globalThis.URL.createObjectURL(file.blob);
    try {
      const anchor = globalThis.document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
    } finally {
      globalThis.URL.revokeObjectURL(url);
    }
    exportMessage.value = '文件已生成并交由浏览器下载。';
    exportPreview.value = null;
    currentExportScopeKey = '';
  } catch (error) {
    if (controller.signal.aborted || generation !== exportGeneration) return;
    const code = (error as { code?: string })?.code;
    exportMessage.value =
      code === 'EXPORT_SCOPE_CHANGED'
        ? '事项数量已变化，请重新预览后下载。'
        : code === 'EXPORT_LIMIT_EXCEEDED'
          ? '导出范围超过 1000 条，请缩小范围后重新预览。'
          : error instanceof Error
            ? error.message
            : '下载失败，请重试。';
    exportPreview.value = null;
    currentExportScopeKey = '';
  } finally {
    if (generation === exportGeneration) exportLoading.value = false;
  }
}

function closeExport(): void {
  invalidateExport();
  exportOpen.value = false;
  exportMode.value = null;
  exportMessage.value = '已取消导出。';
}

function isOptionalColumn(
  column: NotaryListPreferenceColumn,
): column is Exclude<NotaryListPreferenceColumn, 'businessNo' | 'stage'> {
  return column !== 'businessNo' && column !== 'stage';
}

function copyPreference(
  preference: NotaryListPreference,
): NotaryListPreference {
  return { order: [...preference.order], hidden: [...preference.hidden] };
}

function setDraft(preference: NotaryListPreference): void {
  draftOrder.value = [...preference.order];
  draftHidden.value = [...preference.hidden];
}

async function loadPreference(userId: string | undefined): Promise<void> {
  const scope = identity.value;
  preferenceRequest?.abort();
  saveRequest?.abort();
  preferenceGeneration += 1;
  saveGeneration += 1;
  const generation = preferenceGeneration;
  saving.value = false;
  settingsOpen.value = false;
  savedPreference.value = copyPreference(defaultNotaryListPreference);
  setDraft(defaultNotaryListPreference);
  if (!userId) {
    preferenceState.value = 'failed';
    preferenceMessage.value = '当前账号信息不可用，无法读取个人列设置。';
    return;
  }

  const controller = new AbortController();
  preferenceRequest = controller;
  preferenceState.value = 'loading';
  preferenceMessage.value = '正在读取个人列设置。';
  try {
    const preference = await getNotaryListPreference({
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== preferenceGeneration ||
      identity.value !== scope
    )
      return;
    savedPreference.value = copyPreference(preference);
    setDraft(preference);
    preferenceState.value = 'ready';
    preferenceMessage.value = '个人列设置已加载。';
  } catch {
    if (
      controller.signal.aborted ||
      generation !== preferenceGeneration ||
      identity.value !== scope
    )
      return;
    preferenceState.value = 'failed';
    preferenceMessage.value =
      '个人列设置读取失败。列表仍可使用默认列，请重试读取。';
  }
}

function moveDraftColumn(
  column: NotaryListPreferenceColumn,
  direction: -1 | 1,
) {
  if (!isOptionalColumn(column)) return;
  const optional = optionalColumns.value;
  const index = optional.indexOf(column);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= optional.length) return;
  const next = [...optional];
  [next[index], next[target]] = [next[target], next[index]];
  draftOrder.value = ['businessNo', 'stage', ...next];
}

function toggleDraftColumn(
  column: NotaryListPreferenceColumn,
  hidden: boolean,
): void {
  if (column === 'businessNo' || column === 'stage') return;
  draftHidden.value = hidden
    ? [...new Set([...draftHidden.value, column])]
    : draftHidden.value.filter((item) => item !== column);
}

async function savePreference(preference: NotaryListPreference): Promise<void> {
  const scope = identity.value;
  const userId = auth.session?.user.id;
  if (preferenceState.value !== 'ready' || !userId || saving.value) return;
  saveRequest?.abort();
  const controller = new AbortController();
  saveRequest = controller;
  const generation = ++saveGeneration;
  saving.value = true;
  preferenceMessage.value = '正在保存个人列设置。';
  try {
    const saved = await saveNotaryListPreference(preference, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== saveGeneration ||
      identity.value !== scope
    )
      return;
    savedPreference.value = copyPreference(saved);
    setDraft(saved);
    preferenceMessage.value = '个人列设置已保存。';
  } catch {
    if (
      controller.signal.aborted ||
      generation !== saveGeneration ||
      identity.value !== scope
    )
      return;
    preferenceMessage.value = '保存失败，草稿仍保留，可以重试。';
  } finally {
    if (generation === saveGeneration) saving.value = false;
  }
}

function saveDraft(): Promise<void> {
  return savePreference({
    order: [...draftOrder.value],
    hidden: [...draftHidden.value],
  });
}

function cancelDraft(): void {
  setDraft(savedPreference.value);
  settingsOpen.value = false;
  preferenceMessage.value = '已取消未保存的列设置。';
}

function resetDraft(): Promise<void> {
  setDraft(defaultNotaryListPreference);
  return savePreference(copyPreference(defaultNotaryListPreference));
}

async function load(): Promise<void> {
  listRequest?.abort();
  const userId = auth.session?.user.id;
  const departmentId = auth.session?.department?.id;
  const scope = identity.value;
  if (currentListScope && currentListScope !== scope) {
    items.value = [];
    total.value = 0;
  }
  currentListScope = scope;
  if (!userId) {
    items.value = [];
    total.value = 0;
    state.value = 'ready';
    return;
  }
  const controller = new AbortController();
  listRequest = controller;
  state.value = 'loading';
  try {
    const result = await listNotaryMatters(
      requestedPage.value,
      20,
      { signal: controller.signal },
      selectedStage.value,
    );
    if (
      controller.signal.aborted ||
      identity.value !== scope ||
      auth.session?.user.id !== userId ||
      auth.session?.department?.id !== departmentId
    )
      return;
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
    state.value = 'ready';
  } catch {
    if (!controller.signal.aborted && identity.value === scope)
      state.value = 'failed';
  }
}
async function goToPage(page: number): Promise<void> {
  if (page < 1 || page > totalPages.value || page === requestedPage.value)
    return;
  await router.push({ query: { ...route.query, page: String(page) } });
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
watch(
  () => [
    route.query.page,
    route.query.stage,
    auth.session?.user.id,
    auth.session?.department?.id,
    auth.session?.authorizationRevision,
    auth.session?.principalType,
  ],
  () => void load(),
  { immediate: true },
);
watch(
  () => [
    auth.session?.user.id,
    auth.session?.department?.id,
    auth.session?.authorizationRevision,
    auth.session?.principalType,
    selectedStage.value,
  ],
  () => {
    selectedIds.value = [];
    closeBatch();
    invalidateExport();
    exportOpen.value = false;
    exportMode.value = null;
  },
);
watch(exportScopeKey, () => {
  if (
    currentExportScopeKey !== exportScopeKey.value &&
    (exportPreview.value || exportPreviewRequest || exportRequest)
  )
    invalidateExport();
});
watch(identity, () => void loadPreference(auth.session?.user.id), {
  immediate: true,
});
onBeforeUnmount(() => {
  listRequest?.abort();
  preferenceRequest?.abort();
  saveRequest?.abort();
  invalidateExport();
});
</script>

<template>
  <div class="page-view business-list-page">
    <main>
      <div class="page-head">
        <div>
          <h1>公证阶段</h1>
          <p>逐个办理当前账号有权查看的公证事项。</p>
        </div>
        <ElButton
          data-test="column-settings-toggle"
          :disabled="preferenceState !== 'ready' || saving"
          @click="settingsOpen = !settingsOpen"
          >列设置</ElButton
        >
      </div>
      <section
        class="export-panel business-list-toolbar"
        aria-label="公证事项清单导出"
      >
        <div class="export-actions">
          <span data-test="selected-count"
            >已选择 {{ selectedIds.length }} 项</span
          >
          <ElButton
            data-test="clear-selection"
            :disabled="selectedIds.length === 0 || batchOpen"
            @click="clearSelection"
            >清空选择</ElButton
          >
          <ElButton
            data-test="batch-archive-open"
            :disabled="
              selectedIds.length === 0 || batchOpen || !!pendingBatchForScope
            "
            @click="
              activeBatchRequest = null;
              batchOpen = true;
            "
            >批量归档</ElButton
          >
          <ElButton
            v-if="pendingBatchForScope && !batchOpen"
            data-test="batch-resume"
            @click="resumeBatch"
            >恢复未确认的批量归档</ElButton
          >
          <span v-if="pendingBatchForScope" role="status">
            原请求仅保留在当前列表页内存中；离开本页或刷新后无法恢复。关闭面板不表示撤销提交。
          </span>
          <ElButton
            data-test="export-open"
            @click="
              exportOpen = true;
              exportMessage = '';
            "
            >批量导出</ElButton
          >
        </div>
        <div v-if="exportOpen" class="export-options">
          <strong>请明确选择导出范围</strong>
          <label>
            <input
              type="radio"
              name="notary-export-scope"
              data-test="export-mode-selected"
              value="SELECTED"
              :checked="exportMode === 'SELECTED'"
              @change="
                exportMode = 'SELECTED';
                exportMessage = '';
              "
            />
            已勾选事项（{{ selectedIds.length }} 项）
          </label>
          <label>
            <input
              type="radio"
              name="notary-export-scope"
              data-test="export-mode-filtered"
              value="FILTERED"
              :checked="exportMode === 'FILTERED'"
              @change="
                exportMode = 'FILTERED';
                exportMessage = '';
              "
            />
            当前阶段筛选结果（{{
              selectedStage ? stageLabels[selectedStage] : '全部可见事项'
            }}）
          </label>
          <p>
            仅导出事项编号、阶段、来源线索编号、公证处、创建时间五列；不含附件和内部费用。
          </p>
          <p v-if="exportPreview" data-test="export-preview-count">
            预览范围：{{
              exportMode === 'SELECTED' ? '已勾选事项' : '当前阶段筛选结果'
            }}；共 {{ exportPreview.count }} 条（上限
            {{ exportPreview.maxRows }} 条）。
          </p>
          <p v-if="exportMessage" role="status" data-test="export-status">
            {{ exportMessage }}
          </p>
          <div class="export-actions">
            <ElButton
              data-test="export-preview"
              :disabled="
                exportLoading ||
                !exportMode ||
                (exportMode === 'SELECTED' && selectedIds.length === 0)
              "
              @click="requestExportPreview"
              >{{ exportLoading ? '处理中' : '预览数量' }}</ElButton
            >
            <ElButton
              v-if="canConfirmExport"
              data-test="export-confirm"
              :disabled="exportLoading"
              @click="confirmExport"
              >确认下载 {{ exportPreview?.count }} 条</ElButton
            >
            <ElButton data-test="export-cancel" @click="closeExport"
              >取消</ElButton
            >
          </div>
        </div>
      </section>
      <NotaryReturnArchiveBatchPanel
        v-if="batchOpen"
        :matter-ids="
          activeBatchRequest
            ? activeBatchRequest.items.map((item) => item.matterId)
            : selectedIds
        "
        :scope-key="batchScopeKey"
        :pending-request="activeBatchRequest"
        @close="closeBatch"
        @frozen="holdBatch"
        @resolved="resolveBatch"
        @completed="completeBatch"
      />
      <section
        v-if="settingsOpen"
        class="column-settings demo-card"
        aria-label="公证事项列设置"
      >
        <div class="column-settings-fixed">
          <strong>始终显示</strong>
          <span>选择、操作／公证事项编号、案件进展</span>
        </div>
        <div class="column-settings-options">
          <div
            v-for="(column, index) in optionalColumns"
            :key="column"
            class="column-setting-row"
            data-test="column-option"
          >
            <label>
              <input
                type="checkbox"
                :checked="
                  !draftHidden.includes(
                    column as Exclude<
                      NotaryListPreferenceColumn,
                      'businessNo' | 'stage'
                    >,
                  )
                "
                :data-column-key="column"
                @change="
                  toggleDraftColumn(
                    column,
                    !($event.target as HTMLInputElement).checked,
                  )
                "
              />
              {{ columnLabels[column] }}
            </label>
            <ElButton
              :disabled="saving || index === 0"
              :aria-label="`上移${columnLabels[column]}`"
              @click="moveDraftColumn(column, -1)"
              >上移</ElButton
            >
            <ElButton
              :disabled="saving || index === optionalColumns.length - 1"
              :aria-label="`下移${columnLabels[column]}`"
              @click="moveDraftColumn(column, 1)"
              >下移</ElButton
            >
          </div>
        </div>
        <div class="column-settings-actions">
          <ElButton
            data-test="save-columns"
            :disabled="saving"
            @click="saveDraft"
          >
            {{ saving ? '保存中' : '保存' }}
          </ElButton>
          <ElButton
            data-test="cancel-columns"
            :disabled="saving"
            @click="cancelDraft"
          >
            取消
          </ElButton>
          <ElButton
            data-test="reset-columns"
            :disabled="saving"
            @click="resetDraft"
          >
            恢复默认
          </ElButton>
        </div>
      </section>
      <p
        class="column-preference-message"
        role="status"
        data-test="column-preference-status"
      >
        {{ preferenceMessage }}
        <ElButton
          v-if="preferenceState === 'failed'"
          data-test="retry-preference"
          @click="loadPreference(auth.session?.user.id)"
          >重试读取</ElButton
        >
      </p>
      <section class="demo-card" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取公证事项</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>公证事项列表暂时无法加载</h2>
          <p>错误不会被当作空列表，可以直接重试。</p>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2 v-if="selectedStage">
            「{{ stageLabels[selectedStage] }}」暂无记录
          </h2>
          <h2 v-else>当前没有公证事项</h2>
          <p v-if="selectedStage">可在侧栏切换其他阶段查看公证事项。</p>
          <p v-else>线索确认取证并移交后，事项会在这里出现。</p>
        </div>
        <div
          v-else
          class="demo-table-wrap business-list-scroll"
          tabindex="0"
          role="region"
          aria-label="公证事项表格，可横向滚动"
        >
          <table
            class="demo-table business-list-table"
            :style="{ minWidth: `${tableWidth}px` }"
          >
            <colgroup>
              <col style="width: 48px" />
              <col style="width: 200px" />
              <col
                v-for="column in visibleColumns"
                :key="column"
                :style="{ width: `${columnWidth(column)}px` }"
              />
            </colgroup>
            <thead>
              <tr>
                <th class="selection-column">
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    data-test="select-page"
                    :checked="
                      items.length > 0 &&
                      items.every((matter) => selectedIds.includes(matter.id))
                    "
                    :disabled="
                      items.length === 0 || batchOpen || !!pendingBatchForScope
                    "
                    @change="
                      toggleCurrentPage(
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />选择
                </th>
                <th class="business-list-cell--nowrap">操作</th>
                <th
                  v-for="column in visibleColumns"
                  :key="column"
                  :data-column="column"
                  :class="
                    isFeeColumn(column)
                      ? 'business-list-cell--number'
                      : 'business-list-cell--nowrap'
                  "
                >
                  {{ columnLabels[column] }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="matter in items"
                :key="matter.id"
                data-test="matter-row"
              >
                <td class="selection-column">
                  <input
                    type="checkbox"
                    :aria-label="`选择${matter.businessNo}`"
                    data-test="select-matter"
                    :checked="selectedIds.includes(matter.id)"
                    :disabled="batchOpen || !!pendingBatchForScope"
                    @change="
                      toggleMatter(
                        matter.id,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </td>
                <td class="business-list-cell--nowrap notary-actions">
                  <div>
                    <RouterLink
                      v-for="action in matterActions(matter)"
                      :key="action.anchor"
                      data-test="matter-action"
                      :to="`/notary-matters/${matter.id}#${action.anchor}`"
                      >{{ action.label }}</RouterLink
                    >
                    <RouterLink
                      data-test="matter-link"
                      :to="`/notary-matters/${matter.id}`"
                      >详情</RouterLink
                    >
                  </div>
                  <span class="mono notary-business-no">{{
                    matter.businessNo
                  }}</span>
                </td>
                <td
                  v-for="column in visibleColumns"
                  :key="column"
                  :data-column="column"
                  :class="
                    isFeeColumn(column)
                      ? 'business-list-cell--number'
                      : isTextColumn(column)
                        ? 'business-list-cell--text'
                        : 'business-list-cell--nowrap'
                  "
                >
                  <template v-if="column === 'stage'">
                    <span class="pill">{{ stageLabels[matter.stage] }}</span>
                    <RouterLink
                      v-if="matter.linkedCase"
                      class="notary-case-link"
                      data-test="linked-case"
                      :to="`/cases/${matter.linkedCase.id}`"
                      >已流转诉讼 ·
                      {{ caseStageLabels[matter.linkedCase.stage] }}</RouterLink
                    >
                    <span v-else class="notary-case-link">暂无可见案件</span>
                  </template>
                  <template v-else-if="column === 'sourceLead'">
                    <RouterLink
                      data-test="source-lead-link"
                      :to="`/leads/${matter.sourceLead.id}`"
                      >{{ matter.sourceLead.businessNo }}</RouterLink
                    >
                  </template>
                  <template v-else-if="column === 'openingPhotos'">
                    <RouterLink
                      v-if="
                        matter.openingSummary &&
                        matter.openingSummary.photoCount > 0
                      "
                      data-test="opening-photos-link"
                      :to="`/notary-matters/${matter.id}#saved-opening`"
                      >{{ matter.openingSummary.photoCount }} 张 ·
                      查看</RouterLink
                    >
                    <span v-else>{{
                      matter.openingSummary ? '0 张' : '未登记'
                    }}</span>
                  </template>
                  <template v-else-if="isTextColumn(column)">
                    <details
                      v-if="columnText(matter, column) !== '未登记'"
                      class="notary-long-text"
                      :style="{ maxWidth: `${columnWidth(column) - 24}px` }"
                    >
                      <summary
                        :aria-label="`展开${columnLabels[column]}：${columnText(matter, column)}`"
                      >
                        <span>{{ columnText(matter, column) }}</span>
                      </summary>
                      <p>{{ columnText(matter, column) }}</p>
                    </details>
                    <span v-else>未登记</span>
                  </template>
                  <template v-else>
                    <span class="mono">{{ columnText(matter, column) }}</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready' && totalPages > 1"
          class="lead-pagination business-list-footer"
          aria-label="公证事项列表分页"
        >
          <ElButton
            data-test="previous-page"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
            >上一页</ElButton
          >
          <span>第 {{ currentPage }} / {{ totalPages }} 页</span>
          <ElButton
            data-test="next-page"
            :disabled="currentPage >= totalPages"
            @click="goToPage(currentPage + 1)"
            >下一页</ElButton
          >
        </nav>
      </section>
    </main>
  </div>
</template>

<style scoped>
.demo-table.business-list-table {
  table-layout: auto;
}

.notary-actions a + a {
  margin-left: 0.75rem;
}

.notary-business-no,
.notary-case-link {
  display: block;
  margin-top: 0.25rem;
  white-space: nowrap;
}

.notary-long-text summary {
  cursor: pointer;
}

.notary-long-text summary span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
}

.notary-long-text p {
  margin: 0.5rem 0 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.column-settings {
  margin-bottom: 1rem;
}

.export-panel {
  margin-bottom: 1rem;
  padding: 1rem;
}

.export-actions,
.export-options {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.export-options {
  align-items: flex-start;
  flex-direction: column;
  margin-top: 1rem;
}

.selection-column {
  white-space: nowrap;
  width: 5rem;
}

.column-settings-fixed,
.column-setting-row,
.column-settings-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.column-settings-options {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.column-setting-row label {
  align-items: center;
  display: inline-flex;
  flex: 1;
  gap: 0.5rem;
}

.column-settings-actions {
  margin-top: 1rem;
}

.column-preference-message {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
}
</style>
