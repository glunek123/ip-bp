<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  RouterLink,
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from 'vue-router';
import ListWorkflowDrawer from '../../app/ListWorkflowDrawer.vue';
import type {
  ListWorkflowContext,
  ListWorkflowLoad,
} from '../../app/list-workflow-context';
import NotaryMatterWorkflowPanel from './NotaryMatterWorkflowPanel.vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import ListHeaderSearch from '../../shared/ListHeaderSearch.vue';
import {
  exportNotaryList,
  previewNotaryListExport,
  type NotaryListExportScope,
} from '../../api/notary-list-export';
import type { ArchiveNotaryReturnBatchInput } from '../../api/notary-return-archive-batch';
import {
  listNotaryMatters,
  getNotaryMatter,
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
import NotaryBatchOpeningPanel from './NotaryBatchOpeningPanel.vue';
import { labelLeadPlatform } from './lead-options';
import type { CaseStage } from '../../api/cases';
import { isListRowClick, listReturnPath } from '../../app/list-row-navigation';

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
function actorIdentityKey(actorKey: string): string {
  return actorKey.split(':').slice(0, 3).join(':');
}
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const workflowOpen = ref(false);
const workflowContext = ref<ListWorkflowContext | null>(null);
const workflowDrawer = ref<{ canLeave: () => boolean }>();
const openingBatchPanel = ref<{ canLeave: () => boolean }>();
function loadWorkflowDetail({ context, signal }: ListWorkflowLoad) {
  return getNotaryMatter(context.recordId, { signal });
}
function openWorkflow(
  matter: NotaryMatterListItem,
  action: { label: string; anchor: string },
) {
  if (batchOpen.value || openingBatchOpen.value) return;
  if (workflowDrawer.value && !workflowDrawer.value.canLeave()) return;
  workflowContext.value = {
    recordId: matter.id,
    actorKey: identity.value,
    actionKey: action.anchor,
    title: `${action.label} · ${matter.businessNo}`,
  };
  workflowOpen.value = true;
}

function pendingRequests(): ListWorkflowContext[] {
  const requests: ListWorkflowContext[] = [];
  try {
    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
      const key = globalThis.sessionStorage.key(index);
      const prefix = key?.startsWith('notary-list-request:')
        ? 'notary-list-request:'
        : key?.startsWith('notary-proxy-certificate-request:')
          ? 'notary-proxy-certificate-request:'
          : null;
      if (!prefix) continue;
      const parts: unknown = JSON.parse(key!.slice(prefix.length));
      if (
        !Array.isArray(parts) ||
        parts.length !== 3 ||
        typeof parts[0] !== 'string' ||
        actorIdentityKey(parts[0]) !== actorIdentityKey(identity.value) ||
        typeof parts[1] !== 'string' ||
        typeof parts[2] !== 'string' ||
        ![
          'evidence-form',
          'opening-form',
          'review-form',
          'issuance-form',
          'return-archive-form',
          'certificate',
        ].includes(parts[2])
      )
        continue;
      if (
        !requests.some(
          (request) =>
            request.recordId === parts[1] && request.actionKey === parts[2],
        )
      ) {
        requests.push({
          actorKey: identity.value,
          recordId: parts[1],
          actionKey: parts[2],
          title: '核对未确认的公证请求',
        });
      }
    }
  } catch {
    return requests;
  }
  return requests;
}
function resumeWorkflow(context: ListWorkflowContext) {
  if (batchOpen.value || openingBatchOpen.value) return;
  if (workflowDrawer.value && !workflowDrawer.value.canLeave()) return;
  workflowContext.value = context;
  workflowOpen.value = true;
}

function canLeaveWorkflow() {
  return (
    (workflowDrawer.value?.canLeave() ?? true) &&
    (openingBatchPanel.value?.canLeave() ?? true)
  );
}
onBeforeRouteLeave(canLeaveWorkflow);
onBeforeRouteUpdate(canLeaveWorkflow);
watch(
  [identity, () => route.fullPath],
  () => {
    workflowOpen.value = false;
    workflowContext.value = null;
    openingBatchOpen.value = false;
  },
  { flush: 'sync' },
);
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
const openingBatchOpen = ref(false);
const openingBatchSummary = ref('');
const knownSelectedMatters = computed(() =>
  items.value.filter((matter) => selectedIds.value.includes(matter.id)),
);
const archiveDisabledReason = computed(() => {
  if (!selectedIds.value.length) return '请选择事项';
  if (selectedIds.value.length > 50) return '批量归档最多选择50项';
  if (
    knownSelectedMatters.value.some(
      (matter) =>
        matter.stage !== 'WAITING_RETURN' || !matter.capabilities.archiveReturn,
    )
  )
    return '所选事项含不可退货归档项';
  return '';
});
const openingDisabledReason = computed(() => {
  if (!selectedIds.value.length) return '请选择事项';
  const hasUnknown =
    knownSelectedMatters.value.length < selectedIds.value.length;
  const canOpen = knownSelectedMatters.value.some(
    (matter) =>
      (matter.stage === 'WAITING_UNBOX' && matter.capabilities.recordOpening) ||
      hasPendingRequestFor(identity.value, matter.id, 'opening-form'),
  );
  return hasUnknown || canOpen ? '' : '所选事项无可开箱或待核实项';
});

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
const queryDraft = ref('');
const queryFormError = ref('');
watch(
  () => [identity.value, selectedStage.value, route.query.q],
  () => {
    queryDraft.value = typeof route.query.q === 'string' ? route.query.q : '';
  },
  { immediate: true },
);
function applyFilters(clear = false) {
  if (clear) {
    queryDraft.value = '';
    queryFormError.value = '';
  }
  const q = clear ? '' : queryDraft.value.trim();
  if (Array.from(q).length > 200) {
    queryFormError.value = '关键词最多200字。';
    return;
  }
  queryFormError.value = '';
  const query: Record<string, string | string[] | null | undefined> = {
    ...route.query,
    page: '1',
  };
  if (clear) {
    delete query.customerId;
    delete query.rightsHolderId;
    delete query.shopName;
  }
  delete query.q;
  if (q) query.q = q;
  void router.push({ query });
}
const legacyFilters = computed(() => [
  ...(typeof route.query.customerId === 'string'
    ? [{ key: 'customerId', label: '客户', value: route.query.customerId }]
    : []),
  ...(typeof route.query.rightsHolderId === 'string'
    ? [
        {
          key: 'rightsHolderId',
          label: '权利主体',
          value: route.query.rightsHolderId,
        },
      ]
    : []),
  ...(typeof route.query.shopName === 'string'
    ? [{ key: 'shopName', label: '店铺名', value: route.query.shopName }]
    : []),
]);
async function removeLegacyFilter(key: string): Promise<void> {
  const query = { ...route.query, page: '1' };
  Reflect.deleteProperty(query, key);
  await router.push({ query });
}
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
    80 +
    actionColumnWidth.value +
    visibleColumns.value.reduce(
      (width, column) => width + columnWidth(column),
      0,
    ),
);
const hasMatterActions = computed(() =>
  items.value.some((matter) => matterActions(matter).length > 0),
);
const actionColumnWidth = computed(() => (hasMatterActions.value ? 160 : 0));
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
      return matter.sourceSummary.shopExternalId ?? '';
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
      label: '审核开箱',
      anchor: 'review-form',
    },
    {
      enabled: matter.capabilities.decideIssuance,
      label: '决定是否出证',
      anchor: 'issuance-form',
    },
    {
      enabled: Boolean(matter.capabilities.proxyIssueCertificate),
      label: '代办公证处出证',
      anchor: 'certificate',
    },
    {
      enabled: matter.capabilities.archiveReturn,
      label: '办理退货归档',
      anchor: 'return-archive-form',
    },
  ];
  const saved = actions.find((action) => {
    try {
      return (
        globalThis.sessionStorage.getItem(
          `${action.anchor === 'certificate' ? 'notary-proxy-certificate-request' : 'notary-list-request'}:${JSON.stringify([identity.value, matter.id, action.anchor])}`,
        ) !== null ||
        hasPendingRequestFor(identity.value, matter.id, action.anchor)
      );
    } catch {
      return false;
    }
  });
  return saved
    ? [{ ...saved, label: `恢复${saved.label}请求` }]
    : actions.filter((action) => action.enabled).slice(0, 1);
}
function shortMatterAction(label: string): string {
  if (label.startsWith('恢复')) return '核对请求';
  if (label === '登记取证') return '登记取证';
  if (label === '审核开箱') return '审核';
  if (label === '决定是否出证') return '出证决定';
  if (label === '代办公证处出证') return '代办出证';
  if (label === '办理退货归档') return '退货归档';
  return label;
}
function hasPendingRequestFor(
  actorKey: string,
  matterId: string,
  actionKey: string,
): boolean {
  const wanted = actorIdentityKey(actorKey);
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    const key = globalThis.sessionStorage.key(index);
    const prefix =
      actionKey === 'certificate'
        ? 'notary-proxy-certificate-request:'
        : 'notary-list-request:';
    if (!key?.startsWith(prefix)) continue;
    try {
      const tuple: unknown = JSON.parse(key.slice(prefix.length));
      if (
        Array.isArray(tuple) &&
        tuple.length === 3 &&
        typeof tuple[0] === 'string' &&
        actorIdentityKey(tuple[0]) === wanted &&
        tuple[1] === matterId &&
        tuple[2] === actionKey
      )
        return true;
    } catch {
      continue;
    }
  }
  return false;
}
const exportScopeKey = computed(() =>
  JSON.stringify({
    identity: identity.value,
    userId: auth.session?.user.id ?? '',
    departmentId: auth.session?.department?.id ?? '',
    stage: selectedStage.value ?? null,
    q: route.query.q ?? null,
    customerId: route.query.customerId ?? null,
    rightsHolderId: route.query.rightsHolderId ?? null,
    shopName: route.query.shopName ?? null,
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
    return {
      mode: 'FILTERED',
      ...(typeof route.query.q === 'string' ? { q: route.query.q } : {}),
      ...(selectedStage.value ? { stage: selectedStage.value } : {}),
      ...(typeof route.query.customerId === 'string'
        ? { customerId: route.query.customerId }
        : {}),
      ...(typeof route.query.rightsHolderId === 'string'
        ? { rightsHolderId: route.query.rightsHolderId }
        : {}),
      ...(typeof route.query.shopName === 'string'
        ? { shopName: route.query.shopName }
        : {}),
    };
  }
  return null;
}

function clearSelectionOnly(): void {
  selectedIds.value = [];
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
  openingBatchSummary.value = '';
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
  openingBatchSummary.value = '';
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
  openingBatchSummary.value = '';
  invalidateExport();
  exportMessage.value = '';
}

function completeBatch(): void {
  clearSelection();
  batchOpen.value = false;
  activeBatchRequest.value = null;
  void load();
}

function completeOpeningBatch(
  failedItems: Array<{ id: string; businessNo?: string; note?: string }>,
): void {
  openingBatchOpen.value = false;
  if (failedItems.length > 0) {
    selectedIds.value = failedItems.map((item) => item.id);
    openingBatchSummary.value = `${failedItems.length} 个事项确定失败，已保留勾选以便刷新后重试。${failedItems.map((item) => `${item.businessNo ?? item.id}：${item.note ?? '请重新核对事项'}`).join('；')}`;
  } else {
    clearSelection();
    openingBatchSummary.value = '所选事项均已逐项登记开箱。';
  }
  invalidateExport();
  exportMessage.value = '';
  void load();
}

function closeOpeningBatch(successfulIds: string[] = []): void {
  if (openingBatchPanel.value && !openingBatchPanel.value.canLeave()) return;
  openingBatchOpen.value = false;
  if (successfulIds.length > 0) {
    const succeeded = new Set(successfulIds);
    selectedIds.value = selectedIds.value.filter((id) => !succeeded.has(id));
    openingBatchSummary.value = `${successfulIds.length} 个事项已完成开箱并从勾选中移除；其余事项仍保留。`;
    invalidateExport();
    exportMessage.value = '';
    void load();
  }
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
    preferenceMessage.value = '';
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
    const filters = {
      ...(typeof route.query.q === 'string' ? { q: route.query.q } : {}),
      ...(typeof route.query.customerId === 'string'
        ? { customerId: route.query.customerId }
        : {}),
      ...(typeof route.query.rightsHolderId === 'string'
        ? { rightsHolderId: route.query.rightsHolderId }
        : {}),
      ...(typeof route.query.shopName === 'string'
        ? { shopName: route.query.shopName }
        : {}),
    };
    const result = Object.keys(filters).length
      ? await listNotaryMatters(
          requestedPage.value,
          20,
          { signal: controller.signal },
          selectedStage.value,
          filters,
        )
      : await listNotaryMatters(
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
    const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (result.items.length === 0 && requestedPage.value > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
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
function matterDetailLocation(matter: NotaryMatterListItem) {
  return {
    path: `/notary-matters/${encodeURIComponent(matter.id)}`,
    query: { returnTo: listReturnPath(route.fullPath, '/notary-matters') },
  };
}
function openMatterRow(
  event: InstanceType<typeof globalThis.MouseEvent>,
  matter: NotaryMatterListItem,
): void {
  if (!isListRowClick(event)) return;
  void router.push(matterDetailLocation(matter));
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
    route.query.q,
    route.query.stage,
    route.query.customerId,
    route.query.rightsHolderId,
    route.query.shopName,
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
      <h1 class="sr-only">公证阶段</h1>
      <ListHeaderSearch
        v-model="queryDraft"
        placeholder="按客户、权利主体、店铺名、公证编号或线索编号搜索"
        @search="applyFilters()"
      />
      <div
        v-if="legacyFilters.length"
        class="legacy-filter-chips"
        aria-label="旧链接中的筛选条件"
      >
        <span>旧链接筛选条件：</span>
        <span
          v-for="filter in legacyFilters"
          :key="filter.key"
          class="legacy-filter-chip"
          data-test="legacy-filter-chip"
        >
          {{ filter.label }}：{{ filter.value }}
          <button
            type="button"
            :aria-label="`移除${filter.label}条件`"
            @click="removeLegacyFilter(filter.key)"
          >
            ×
          </button>
        </span>
      </div>
      <p v-if="queryFormError" role="alert">{{ queryFormError }}</p>
      <section
        class="export-panel business-list-toolbar"
        aria-label="公证事项清单导出"
      >
        <div class="export-actions">
          <ElButton
            native-type="button"
            data-test="notary-clear-filters"
            @click="applyFilters(true)"
            >清除筛选</ElButton
          >
          <ElButton
            v-if="selectedIds.length > 0"
            data-test="clear-selection"
            :disabled="
              batchOpen ||
              openingBatchOpen ||
              !!pendingBatchForScope ||
              workflowOpen ||
              exportLoading ||
              exportOpen ||
              !!exportPreview
            "
            @click="clearSelectionOnly"
            >清除选择</ElButton
          >
          <span data-test="selected-count"
            >已选择 {{ selectedIds.length }} 项</span
          >
          <span
            v-if="openingBatchSummary"
            data-test="batch-opening-summary"
            role="status"
            >{{ openingBatchSummary }}</span
          >
          <ElButton
            data-test="batch-archive-open"
            :title="archiveDisabledReason || '归档所选事项'"
            :disabled="
              !!archiveDisabledReason ||
              batchOpen ||
              openingBatchOpen ||
              workflowOpen ||
              !!pendingBatchForScope
            "
            @click="
              activeBatchRequest = null;
              batchOpen = true;
            "
            >批量归档</ElButton
          >
          <ElButton
            data-test="batch-opening-open"
            :title="openingDisabledReason || '逐项核实并登记开箱'"
            :disabled="
              !!openingDisabledReason ||
              batchOpen ||
              openingBatchOpen ||
              workflowOpen ||
              !!pendingBatchForScope
            "
            @click="openingBatchOpen = true"
            >逐项批量开箱</ElButton
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
          <ElButton
            class="column-settings-toggle"
            data-test="column-settings-toggle"
            :disabled="preferenceState !== 'ready' || saving"
            @click="settingsOpen = !settingsOpen"
            >列设置</ElButton
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
            导出固定20列取证清单，含获准读取的已记录费用；未知值留空，真实零保留0.00。物流按顺序换行对应，不含附件。
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
      <NotaryBatchOpeningPanel
        v-if="openingBatchOpen"
        ref="openingBatchPanel"
        :matter-ids="selectedIds"
        :actor-key="identity"
        @close="closeOpeningBatch"
        @completed="completeOpeningBatch"
      />
      <section
        v-if="settingsOpen"
        class="column-settings demo-card"
        aria-label="公证事项列设置"
      >
        <div class="column-settings-fixed">
          <strong>始终显示</strong>
          <span>选择、操作（有可办理项时显示）、案件进展</span>
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
        v-if="preferenceMessage || preferenceState === 'failed'"
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
              <col style="width: 80px" />
              <col
                v-if="hasMatterActions"
                :style="{ width: `${actionColumnWidth}px` }"
              />
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
                      items.length === 0 ||
                      batchOpen ||
                      openingBatchOpen ||
                      !!pendingBatchForScope
                    "
                    @change="
                      toggleCurrentPage(
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />选择
                </th>
                <th v-if="hasMatterActions" class="business-list-cell--nowrap">
                  操作
                </th>
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
                class="business-row-link"
                tabindex="0"
                :aria-label="`查看公证事项 ${matter.businessNo}`"
                @click="openMatterRow($event, matter)"
                @keydown.enter.self="router.push(matterDetailLocation(matter))"
                @keydown.space.self.prevent="
                  router.push(matterDetailLocation(matter))
                "
              >
                <td class="selection-column">
                  <input
                    type="checkbox"
                    :aria-label="`选择${matter.businessNo}`"
                    data-test="select-matter"
                    :checked="selectedIds.includes(matter.id)"
                    :disabled="
                      batchOpen || openingBatchOpen || !!pendingBatchForScope
                    "
                    @change="
                      toggleMatter(
                        matter.id,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </td>
                <td
                  v-if="hasMatterActions"
                  class="business-list-cell--nowrap notary-actions"
                >
                  <div>
                    <ElButton
                      v-for="action in matterActions(matter)"
                      :key="action.anchor"
                      data-test="matter-action"
                      type="primary"
                      :title="action.label"
                      @click="openWorkflow(matter, action)"
                      >{{ shortMatterAction(action.label) }}</ElButton
                    >
                  </div>
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
                    <div class="notary-stage">
                      <span class="pill">{{ stageLabels[matter.stage] }}</span>
                      <RouterLink
                        v-if="matter.linkedCase"
                        class="notary-case-link"
                        data-test="linked-case"
                        :title="`已流转诉讼 · ${caseStageLabels[matter.linkedCase.stage]}`"
                        :to="`/cases/${matter.linkedCase.id}`"
                        >已流转诉讼 ·
                        {{
                          caseStageLabels[matter.linkedCase.stage]
                        }}</RouterLink
                      >
                    </div>
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
                    <span
                      class="notary-truncate"
                      :title="columnText(matter, column)"
                    >
                      {{ columnText(matter, column) }}
                    </span>
                  </template>
                  <template v-else>
                    <span
                      class="mono"
                      :class="{ 'notary-truncate': !isFeeColumn(column) }"
                      :title="columnText(matter, column)"
                      >{{ columnText(matter, column) }}</span
                    >
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
      <section v-if="pendingRequests().length" aria-label="未确认的公证请求">
        <p>尚有请求结果未确认，事项可能已经离开当前筛选。请核对原请求。</p>
        <ElButton
          v-for="pending in pendingRequests()"
          :key="pending.recordId + pending.actionKey"
          data-test="notary-resume-request"
          @click="resumeWorkflow(pending)"
          >核对未确认的公证请求</ElButton
        >
      </section>
      <ListWorkflowDrawer
        ref="workflowDrawer"
        v-model="workflowOpen"
        :context="workflowContext"
        :load-detail="loadWorkflowDetail"
        @success="load"
      >
        <template #default="{ detail, session }"
          ><NotaryMatterWorkflowPanel :detail="detail" :session="session"
        /></template>
      </ListWorkflowDrawer>
    </main>
  </div>
</template>

<style scoped>
.demo-table.business-list-table {
  table-layout: fixed;
  font-size: 12px;
}
.demo-table.business-list-table :is(th, td) {
  height: auto;
  padding: 7px 8px;
}

.notary-actions a + a {
  margin-left: 0.75rem;
}
.notary-actions :deep(.el-button) {
  min-width: 56px;
  height: 32px;
  padding: 0 8px;
}
.notary-actions a {
  margin-left: 6px;
}

.notary-stage {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
.notary-stage .pill {
  flex: 0 0 auto;
}
.notary-case-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}

.notary-truncate {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-settings {
  margin-bottom: 1rem;
}

.export-panel.business-list-toolbar {
  margin-bottom: 4px;
  padding: 0;
}

.export-actions,
.export-options {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.export-actions {
  justify-content: flex-end;
  width: 100%;
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
