<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  RouterLink,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  exportCaseListCsv,
  getCaseListExportCapability,
  type CaseListExportInput,
} from '../../api/case-list-export';
import { useAuthStore } from '../../stores/auth';
import { labelLeadPlatform } from '../leads/index';
import ListWorkflowDrawer from '../../app/ListWorkflowDrawer.vue';
import type {
  ListWorkflowContext,
  ListWorkflowLoad,
} from '../../app/list-workflow-context';
import CaseListWorkflowPanel, {
  decodeCaseListRequest,
  readCaseListRecordRecoveries,
  type CaseListAction,
  type CaseListRecordRecovery,
} from './CaseListWorkflowPanel.vue';
import {
  primaryCaseAction,
  resolveCaseListActions,
  type CaseActionIntent,
} from './case-workspace-actions';
import { sectionRecordCommands } from './case-workspace-section-edits';
import {
  getExternalEntryOptions,
  getCase,
  listCases,
  type CaseStageGroup,
  type CaseStageFilter,
  type CaseSummary,
  type CaseView,
  type CaseListQuery,
} from '../../api/cases';
import {
  defaultCaseListPreference,
  type CaseListColumn,
  type CaseListPreference,
  type CaseListPreferenceBucket,
} from '../../api/case-list-preference';
import CaseListPreferencesPanel from './CaseListPreferencesPanel.vue';
import {
  caseListQueryKey,
  parseCaseListQuery,
  serializeCaseListQuery,
} from './case-list-query';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sessionGeneration = ref(0);
watch(
  () => auth.session,
  () => {
    sessionGeneration.value += 1;
  },
  { flush: 'sync' },
);
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.principalType}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`,
);
const recordActorKey = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.department?.id ?? ''}`,
);
const view = computed<CaseView>(() =>
  route.query.view === 'department' ? 'department' : 'mine',
);
const stage = computed<CaseStageFilter>(() =>
  route.query.stage === 'PENDING_MATCH' ||
  route.query.stage === 'WAITING_COMPLAINT' ||
  route.query.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
  route.query.stage === 'WAITING_COMPLAINT_STAMP' ||
  route.query.stage === 'WAITING_FILING' ||
  route.query.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
  route.query.stage === 'WAITING_HEARING' ||
  route.query.stage === 'WAITING_JUDGMENT' ||
  route.query.stage === 'SECOND_INSTANCE' ||
  route.query.stage === 'WAITING_EXECUTION_DOCUMENTS' ||
  route.query.stage === 'WAITING_EXECUTION_CONFIRMATION' ||
  route.query.stage === 'WAITING_EXECUTION_STAMP' ||
  route.query.stage === 'WAITING_EXECUTION_FILING' ||
  route.query.stage === 'EXECUTING' ||
  route.query.stage === 'WAITING_ARCHIVE' ||
  route.query.stage === 'ARCHIVED'
    ? route.query.stage
    : 'all',
);
const stageGroup = computed<CaseStageGroup | undefined>(() =>
  route.query.stageGroup === 'COMPLAINT_PREPARATION' ||
  route.query.stageGroup === 'EXECUTION_PREPARATION'
    ? route.query.stageGroup
    : undefined,
);
const invalidFilter = computed(
  () =>
    (route.query.stage !== undefined &&
      route.query.stage !== 'all' &&
      stage.value === 'all') ||
    (route.query.stageGroup !== undefined && stageGroup.value === undefined),
);
const parsedListQuery = computed(() => parseCaseListQuery(route.query));
const listFilters = computed<CaseListQuery>(() =>
  parsedListQuery.value.ok ? parsedListQuery.value.value : {},
);
const effectiveListQuery = computed<CaseListQuery>(() => ({
  ...listFilters.value,
  sortBy: listFilters.value.sortBy ?? 'createdAt',
  sortDirection: listFilters.value.sortDirection ?? 'desc',
}));
const listFilterKey = computed(() => caseListQueryKey(listFilters.value));
const rawListQueryKey = computed(() =>
  JSON.stringify(
    [
      'q',
      'customerName',
      'rightsHolderName',
      'courtCaseNo',
      'sortBy',
      'sortDirection',
    ].map((key) => [key, route.query[key] ?? null]),
  ),
);
const listQueryValidityKey = computed(() =>
  parsedListQuery.value.ok ? 'valid' : 'invalid',
);
const pageSize = 20;
const page = computed(() => {
  const value = route.query.page;
  const parsed =
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(parsed) ? parsed : 1;
});
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);
const requestKey = computed(
  () =>
    `${sessionGeneration.value}:${identity.value}:${view.value}:${stage.value}:${stageGroup.value ?? ''}:${listQueryValidityKey.value}:${rawListQueryKey.value}:${listFilterKey.value}:${page.value}`,
);
const exportInput = computed<CaseListExportInput | null>(() => {
  if (
    auth.session?.principalType !== 'INTERNAL' ||
    invalidFilter.value ||
    !parsedListQuery.value.ok ||
    (stage.value !== 'all' && stageGroup.value !== undefined)
  )
    return null;
  return {
    view: view.value,
    ...(stage.value === 'all' ? {} : { stage: stage.value }),
    ...(stageGroup.value ? { stageGroup: stageGroup.value } : {}),
    ...serializeCaseListQuery(effectiveListQuery.value),
  };
});
const exportContextKey = computed(
  () => `${route.fullPath}:${requestKey.value}`,
);
const exportCapability = ref(false);
const canExportCsv = computed(
  () => exportCapability.value && exportInput.value !== null,
);
const exporting = ref(false);
const exportError = ref('');
let capabilityController: AbortController | undefined;
let capabilityGeneration = 0;
let exportController: AbortController | undefined;
let exportGeneration = 0;
watch(
  [identity, sessionGeneration],
  ([currentIdentity, currentSessionGeneration]) => {
    const generation = ++capabilityGeneration;
    capabilityController?.abort();
    capabilityController = undefined;
    exportCapability.value = false;
    if (!currentIdentity || auth.session?.principalType !== 'INTERNAL') return;
    const controller = new AbortController();
    capabilityController = controller;
    void getCaseListExportCapability({ signal: controller.signal })
      .then((result) => {
        if (
          controller.signal.aborted ||
          generation !== capabilityGeneration ||
          identity.value !== currentIdentity ||
          sessionGeneration.value !== currentSessionGeneration
        )
          return;
        exportCapability.value = result.canExport;
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          generation === capabilityGeneration &&
          identity.value === currentIdentity &&
          sessionGeneration.value === currentSessionGeneration
        )
          exportCapability.value = false;
      });
  },
  { immediate: true, flush: 'sync' },
);
watch(
  exportContextKey,
  () => {
    exportGeneration += 1;
    exportController?.abort();
    exportController = undefined;
    exporting.value = false;
    exportError.value = '';
  },
  { flush: 'sync' },
);
const listQuery = computed(() =>
  Object.fromEntries([
    ...Object.entries(route.query).filter(
      ([key, value]) =>
        ['view', 'page', 'stage', 'stageGroup'].includes(key) &&
        typeof value === 'string',
    ),
    ...Object.entries(serializeCaseListQuery(listFilters.value)),
  ]),
);
const queryDraft = ref<{
  q: string;
  customerName: string;
  rightsHolderName: string;
  courtCaseNo: string;
  sortBy: NonNullable<CaseListQuery['sortBy']>;
  sortDirection: NonNullable<CaseListQuery['sortDirection']>;
}>({
  q: '',
  customerName: '',
  rightsHolderName: '',
  courtCaseNo: '',
  sortBy: 'createdAt',
  sortDirection: 'desc',
});
watch(
  () => parsedListQuery.value,
  (parsed) => {
    if (!parsed.ok) return;
    queryDraft.value = {
      q: parsed.value.q ?? '',
      customerName: parsed.value.customerName ?? '',
      rightsHolderName: parsed.value.rightsHolderName ?? '',
      courtCaseNo: parsed.value.courtCaseNo ?? '',
      sortBy: parsed.value.sortBy ?? 'createdAt',
      sortDirection: parsed.value.sortDirection ?? 'desc',
    };
  },
  { immediate: true },
);
function listRouteBase() {
  return Object.fromEntries(
    Object.entries(route.query).filter(
      ([key, value]) =>
        ['view', 'stage', 'stageGroup'].includes(key) &&
        typeof value === 'string',
    ),
  );
}
function applyQuery() {
  const next = {
    q: queryDraft.value.q,
    customerName: queryDraft.value.customerName,
    rightsHolderName: queryDraft.value.rightsHolderName,
    courtCaseNo: queryDraft.value.courtCaseNo,
    sortBy: queryDraft.value.sortBy,
    sortDirection: queryDraft.value.sortDirection,
  } satisfies CaseListQuery;
  const parsed = parseCaseListQuery(next);
  if (!parsed.ok) {
    error.value = parsed.message;
    state.value = 'failed';
    return;
  }
  void router.push({
    query: {
      ...listRouteBase(),
      ...serializeCaseListQuery({
        ...parsed.value,
        sortBy: queryDraft.value.sortBy,
        sortDirection: queryDraft.value.sortDirection,
      }),
      page: '1',
    },
  });
}
function clearQuery() {
  queryDraft.value = {
    q: '',
    customerName: '',
    rightsHolderName: '',
    courtCaseNo: '',
    sortBy: 'createdAt',
    sortDirection: 'desc',
  };
  applyQuery();
}
function stageLabel(value: CaseSummary['stage']): string {
  if (value === 'PENDING_MATCH') return '待匹配';
  if (value === 'WAITING_COMPLAINT') return '待写诉状';
  if (value === 'WAITING_COMPLAINT_CONFIRMATION') return '诉状待确认';
  if (value === 'WAITING_COMPLAINT_STAMP') return '诉状待盖章';
  if (value === 'WAITING_FILING') return '待提交立案';
  if (value === 'WAITING_FORMAL_ACCEPTANCE') return '待正式立案';
  if (value === 'WAITING_JUDGMENT') return '待判决';
  if (value === 'SECOND_INSTANCE') return '二审';
  if (value === 'WAITING_EXECUTION_DOCUMENTS') return '待写执行材料';
  if (value === 'WAITING_EXECUTION_CONFIRMATION') return '执行材料待确认';
  if (value === 'WAITING_EXECUTION_STAMP') return '执行材料待盖章';
  if (value === 'WAITING_EXECUTION_FILING') return '待申请执行';
  if (value === 'EXECUTING') return '强制执行中';
  if (value === 'WAITING_ARCHIVE') return '待归档';
  if (value === 'ARCHIVED') return '已归档';
  return '待开庭';
}
function listActions(item: CaseSummary) {
  const recovery = pendingActions.value.get(item.id);
  if (recovery)
    return [
      {
        id: 'recovery',
        section: 'case-info' as const,
        intent: recovery,
        label: '核对原办理请求',
      },
    ];
  const actions = resolveCaseListActions(item);
  const primary =
    actions.find((action) => action.intent === 'choose-next-step') ??
    primaryCaseAction(item.stage, actions);
  return primary
    ? [primary, ...actions.filter((action) => action !== primary)]
    : actions;
}
const pendingActions = ref(new Map<string, CaseActionIntent>());
const recordRecoveries = ref<CaseListRecordRecovery[]>([]);
const recordRecoveryError = ref('');
const missingPendingActions = computed(() =>
  [...pendingActions.value].filter(
    ([id]) => !items.value.some((item) => item.id === id),
  ),
);
function readPendingActions() {
  const result = new Map<string, CaseActionIntent>();
  const prefix = `case-list-workflow:v1:${encodeURIComponent(identity.value)}:`;
  try {
    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
      try {
        const key = globalThis.sessionStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const raw = globalThis.sessionStorage.getItem(key);
        if (!raw) continue;
        const value: unknown = JSON.parse(raw);
        const pending = decodeCaseListRequest(value);
        if (
          pending &&
          pending.actor === identity.value &&
          key === `${prefix}${encodeURIComponent(pending.caseId)}`
        )
          result.set(pending.caseId, pending.action);
      } catch {
        /* Opening a fresh detail still fails closed if storage is inaccessible. */
      }
    }
  } catch {
    /* Storage restrictions must not prevent reading the case list. */
  }
  pendingActions.value = result;
  try {
    recordRecoveries.value = readCaseListRecordRecoveries(recordActorKey.value);
    recordRecoveryError.value = '';
  } catch {
    recordRecoveries.value = [];
    recordRecoveryError.value =
      '无法核对资料更正的原请求恢复记录。请保留当前会话并联系管理员，尚未发送新更正请求。';
  }
}
function enterRecordEditor(
  item: Pick<CaseSummary, 'id' | 'businessNo'>,
  recovery?: CaseListRecordRecovery,
) {
  if (
    !identity.value ||
    openingAction.value ||
    recordRecoveryError.value ||
    pendingActions.value.has(item.id)
  )
    return;
  if (
    drawerOpen.value &&
    workflowContext.value?.recordId === item.id &&
    selectedAction.value === 'edit-section-records'
  )
    return;
  selectedAction.value = 'edit-section-records';
  selectedRecordRecovery.value =
    recovery ??
    recordRecoveries.value.find((entry) => entry.caseId === item.id) ??
    null;
  workflowContext.value = {
    recordId: item.id,
    actorKey: identity.value,
    actionKey: 'edit-section-records',
    title: `${item.businessNo} · 编辑已登记资料`,
  };
  drawerOpen.value = true;
}
function enterRecovery(id: string, action: CaseActionIntent) {
  if (!identity.value || openingAction.value) return;
  selectedAction.value = action;
  selectedRecordRecovery.value = null;
  workflowContext.value = {
    recordId: id,
    actorKey: identity.value,
    actionKey: action,
    title: '核对原案件办理请求',
  };
  drawerOpen.value = true;
}
const drawer = ref<{
  canLeave: () => boolean;
  requestClose: () => boolean;
} | null>(null);
const drawerOpen = ref(false);
const workflowContext = ref<ListWorkflowContext | null>(null);
const selectedAction = ref<CaseListAction | null>(null);
const selectedRecordRecovery = ref<CaseListRecordRecovery | null>(null);
const openingAction = computed(
  () => drawer.value !== null && !drawer.value.canLeave(),
);
function enterAction(item: CaseSummary, action: CaseActionIntent) {
  if (
    !identity.value ||
    openingAction.value ||
    (!pendingActions.value.has(item.id) &&
      recordRecoveries.value.some((entry) => entry.caseId === item.id)) ||
    (drawerOpen.value &&
      workflowContext.value?.recordId === item.id &&
      selectedAction.value === action)
  )
    return;
  const entry = listActions(item).find((entry) => entry.intent === action);
  if (!entry) return;
  selectedAction.value = action;
  selectedRecordRecovery.value = null;
  workflowContext.value = {
    recordId: item.id,
    actorKey: identity.value,
    actionKey: action,
    title: `${item.businessNo} · ${entry.label}`,
  };
  drawerOpen.value = true;
}
function loadWorkflow(request: ListWorkflowLoad) {
  return getCase(request.context.recordId, { signal: request.signal });
}
function closeWorkflow() {
  drawerOpen.value = false;
  workflowContext.value = null;
  selectedAction.value = null;
  selectedRecordRecovery.value = null;
}
function leaveWorkflow() {
  if (drawer.value && !drawer.value.canLeave()) return false;
  closeWorkflow();
  return true;
}
onBeforeRouteLeave(leaveWorkflow);
onBeforeRouteUpdate(leaveWorkflow);
watch([identity, sessionGeneration], closeWorkflow, { flush: 'sync' });
const caseListColumnOrder = [
  'businessNo',
  'stage',
  'customerName',
  'rightsHolderName',
  'platform',
  'shopName',
  'shopExternalId',
  'defendants',
  'lawyers',
  'court',
  'courtCaseNo',
  'claimAmount',
  'judgmentAmount',
  'closureAmount',
] as const;
type CaseListAmountColumn = 'claimAmount' | 'judgmentAmount' | 'closureAmount';
const columnOrder = ref<CaseListColumn[]>([...caseListColumnOrder]);
const hiddenColumns = ref<CaseListColumn[]>([]);
const visibleColumns = computed(() =>
  columnOrder.value.filter((column) => !hiddenColumns.value.includes(column)),
);
const preferenceBucket = computed<CaseListPreferenceBucket>(
  () => stageGroup.value ?? stage.value,
);
const preferenceRequestGeneration = computed(
  () => `${sessionGeneration.value}:${identity.value}`,
);
watch(
  [preferenceBucket, sessionGeneration, identity],
  () => {
    columnOrder.value = [...defaultCaseListPreference.order];
    hiddenColumns.value = [...defaultCaseListPreference.hidden];
  },
  { immediate: true, flush: 'sync' },
);
function applyColumnPreference(
  bucket: CaseListPreferenceBucket,
  preference: CaseListPreference,
  generation: string | number,
) {
  if (
    bucket !== preferenceBucket.value ||
    generation !== preferenceRequestGeneration.value
  )
    return;
  columnOrder.value = [...preference.order];
  hiddenColumns.value = [...preference.hidden];
}
const columnLabels: Record<CaseListColumn, string> = {
  businessNo: '操作／案件编号',
  stage: '案件进展',
  customerName: '客户',
  rightsHolderName: '权利主体',
  platform: '平台',
  shopName: '店铺',
  shopExternalId: '店铺ID',
  defendants: '被告',
  lawyers: '律师',
  court: '法院',
  courtCaseNo: '案号',
  claimAmount: '标的额',
  judgmentAmount: '判决额',
  closureAmount: '结案额',
};
function columnClass(column: CaseListColumn) {
  if (
    column === 'businessNo' ||
    column === 'shopExternalId' ||
    column === 'courtCaseNo'
  )
    return 'case-list-col--identity';
  if (column === 'stage') return 'case-list-col--stage';
  if (column === 'platform') return 'case-list-col--platform';
  if (column.endsWith('Amount')) return 'case-list-col--amount';
  return 'case-list-col--name';
}
function cellClass(column: CaseListColumn) {
  if (
    column === 'businessNo' ||
    column === 'stage' ||
    column === 'platform' ||
    column === 'shopExternalId' ||
    column === 'courtCaseNo'
  )
    return 'business-list-cell--nowrap';
  if (column.endsWith('Amount')) return 'mono business-list-cell--number';
  return 'business-list-cell--text';
}
function isAmountColumn(
  column: CaseListColumn,
): column is CaseListAmountColumn {
  return (
    column === 'claimAmount' ||
    column === 'judgmentAmount' ||
    column === 'closureAmount'
  );
}
const minimumTableWidth = computed(() =>
  visibleColumns.value.reduce((width, column) => {
    if (
      column === 'businessNo' ||
      column === 'shopExternalId' ||
      column === 'courtCaseNo'
    )
      return width + 200;
    if (column === 'stage') return width + 140;
    if (column === 'platform') return width + 100;
    if (column.endsWith('Amount')) return width + 160;
    return width + 180;
  }, 0),
);
type DisplayAmount =
  | CaseSummary['displaySummary']['claimAmount']
  | CaseSummary['displaySummary']['judgmentAmount']
  | CaseSummary['displaySummary']['closureAmount'];
function amountLabel(amount: DisplayAmount): string {
  if (amount.state === 'UNRECORDED') return '未登记';
  if (amount.state === 'PENDING') return '待定';
  return amount.amount ?? '未登记';
}
function amountSourceLabel(source: DisplayAmount['sourceType']): string {
  if (source === 'COMPLAINT_CONFIRMATION') return '诉状确认';
  if (source === 'COMPLAINT_SUBMISSION') return '已提交诉状';
  if (source === 'FIRST_INSTANCE_JUDGMENT') return '一审判决';
  if (source === 'FIRST_INSTANCE_JUDGMENT_RECORD_CORRECTION')
    return '判决资料更正';
  if (source === 'SECOND_INSTANCE_RESULT') return '二审结果';
  if (source === 'CASE_CLOSURE_VERSION') return '结案登记';
  if (source === 'CASE_CLOSURE_RECORD_CORRECTION') return '结案资料更正';
  return '未登记';
}
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const canCreateExternalEntry = ref(false);
const items = ref<CaseSummary[]>([]);
const total = ref(0);
const error = ref('');
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  items.value = [];
  total.value = 0;
  error.value = '';
  readPendingActions();
  if (invalidFilter.value) {
    error.value = '阶段筛选无效，请清除筛选后重试。';
    state.value = 'failed';
    return;
  }
  if (!parsedListQuery.value.ok) {
    error.value = parsedListQuery.value.message;
    state.value = 'failed';
    return;
  }
  if (stage.value !== 'all' && stageGroup.value !== undefined) {
    const query = { ...route.query };
    delete query.stageGroup;
    await router.replace({ query });
    return;
  }
  const currentPage = page.value;
  const currentKey = requestKey.value;
  canCreateExternalEntry.value = false;
  void getExternalEntryOptions({ signal: controller.signal })
    .then((result) => {
      if (!controller.signal.aborted && currentKey === requestKey.value)
        canCreateExternalEntry.value = result.canCreate;
    })
    .catch(() => {
      if (!controller.signal.aborted && currentKey === requestKey.value)
        canCreateExternalEntry.value = false;
    });
  try {
    const result = await listCases(currentPage, pageSize, {
      signal: controller.signal,
      view: view.value,
      ...(stageGroup.value
        ? {
            stageGroup: stageGroup.value,
          }
        : { stage: stage.value }),
      ...effectiveListQuery.value,
    });
    if (controller.signal.aborted || currentKey !== requestKey.value) return;
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
    if (currentPage > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
    items.value = result.items;
    readPendingActions();
    total.value = result.total;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted || currentKey !== requestKey.value) return;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取案件，请联系管理员核实权限。'
        : '案件列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}
function downloadCsv(
  blob: InstanceType<typeof globalThis.Blob>,
  filename: string,
): void {
  const objectUrl = globalThis.URL.createObjectURL(blob);
  try {
    const link = globalThis.document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.click();
  } finally {
    globalThis.URL.revokeObjectURL(objectUrl);
  }
}
async function exportCurrentList(): Promise<void> {
  const input = exportInput.value;
  if (!canExportCsv.value || !input || exporting.value) return;
  const key = exportContextKey.value;
  const generation = ++exportGeneration;
  const controller = new AbortController();
  exportController?.abort();
  exportController = controller;
  exporting.value = true;
  exportError.value = '';
  try {
    const result = await exportCaseListCsv(
      { ...input },
      {
        signal: controller.signal,
      },
    );
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      key !== exportContextKey.value ||
      !canExportCsv.value
    )
      return;
    downloadCsv(result.blob, result.filename);
  } catch (cause) {
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      key !== exportContextKey.value
    )
      return;
    if (
      cause instanceof ApiError &&
      cause.code === 'CASE_EXPORT_LIMIT_EXCEEDED'
    )
      exportError.value = '当前筛选结果超过1000项，请缩小筛选范围后重试。';
    else if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    ) {
      exportCapability.value = false;
      exportError.value = '当前账号已无案件导出权限，请刷新列表后重试。';
    } else exportError.value = '案件清单导出失败，请稍后重试。';
  } finally {
    if (generation === exportGeneration) {
      exporting.value = false;
      exportController = undefined;
    }
  }
}
function setView(next: CaseView) {
  if (next === view.value) return;
  void router.push({ query: { ...route.query, view: next, page: '1' } });
}
function goToPage(next: number) {
  if (
    state.value !== 'ready' ||
    next < 1 ||
    next > totalPages.value ||
    next === page.value
  )
    return;
  void router.push({ query: { ...route.query, page: String(next) } });
}
watch(
  () =>
    [
      view.value,
      stage.value,
      stageGroup.value,
      listFilterKey.value,
      route.query.page,
      identity.value,
      route.query.stage,
      route.query.stageGroup,
      sessionGeneration.value,
      listQueryValidityKey.value,
      rawListQueryKey.value,
    ] as const,
  (next, previous) => {
    if (!parsedListQuery.value.ok) {
      void load();
      return;
    }
    const filterChanged =
      previous &&
      next.slice(0, 4).some((value, index) => value !== previous[index]);
    // Canonicalizing a legal mixed bookmark preserves its page and scope.
    if (
      !invalidFilter.value &&
      stage.value !== 'all' &&
      stageGroup.value !== undefined
    ) {
      void load();
      return;
    }
    const canonicalized =
      previous &&
      next[6] === previous[6] &&
      next[1] !== 'all' &&
      previous[2] !== undefined &&
      next[2] === undefined;
    if (
      filterChanged &&
      !canonicalized &&
      next[4] === previous[4] &&
      page.value !== 1
    ) {
      request?.abort();
      items.value = [];
      total.value = 0;
      state.value = 'loading';
      void router.replace({ query: { ...route.query, page: '1' } });
      return;
    }
    if (
      route.query.page !== undefined &&
      route.query.page !== String(page.value)
    ) {
      request?.abort();
      void router.replace({
        query: { ...route.query, page: String(page.value) },
      });
      return;
    }
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  request?.abort();
  capabilityGeneration += 1;
  capabilityController?.abort();
  capabilityController = undefined;
  exportGeneration += 1;
  exportController?.abort();
  exportController = undefined;
});
</script>

<template>
  <div class="page-view business-list-page">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">业务管理系统</p>
          <h1>案件</h1>
          <p>
            {{ view === 'mine' ? '我负责的案件' : '本部门全部案件' }} ·
            {{
              stageGroup
                ? stageGroup === 'COMPLAINT_PREPARATION'
                  ? '准备起诉文书'
                  : '准备执行文书'
                : stage === 'all'
                  ? '全部阶段'
                  : stageLabel(stage)
            }}
          </p>
        </div>
        <div class="case-list-head-actions">
          <RouterLink
            v-if="auth.session?.principalType === 'INTERNAL'"
            :to="{
              path: '/case-handling-groups',
              query: { returnTo: route.fullPath },
            }"
            data-test="case-handling-groups-entry"
            >案件办理组</RouterLink
          >
          <ElButton
            v-if="canExportCsv"
            type="primary"
            :loading="exporting"
            :disabled="exporting || state !== 'ready'"
            data-test="export-current-case-list"
            @click="exportCurrentList"
            >导出当前筛选结果</ElButton
          >
          <ElButton
            v-if="canCreateExternalEntry"
            type="primary"
            @click="router.push('/cases/external-entry')"
            >转入／补录案件</ElButton
          >
          <ElButton text :loading="state === 'loading'" @click="load"
            >刷新</ElButton
          >
          <p v-if="exportError" class="submit-error" role="alert">
            {{ exportError }}
          </p>
        </div>
      </div>
      <section
        v-if="recordRecoveries.length || recordRecoveryError"
        class="state-panel"
        aria-label="资料更正原请求恢复"
      >
        <p v-if="recordRecoveryError" role="alert">{{ recordRecoveryError }}</p>
        <p v-else>
          资料更正原请求尚待核对；案件离开当前筛选后仍可打开原对象恢复。
        </p>
        <ElButton
          v-for="(recovery, index) in recordRecoveries"
          :key="`${recovery.caseId}:${recovery.kind}:${recovery.targetId}`"
          :disabled="openingAction || pendingActions.has(recovery.caseId)"
          @click="
            enterRecordEditor(
              { id: recovery.caseId, businessNo: '原案件' },
              recovery,
            )
          "
          >核对资料更正原请求 {{ index + 1 }} ·
          {{
            sectionRecordCommands.find(
              (command) => command.kind === recovery.kind,
            )?.label
          }}</ElButton
        >
      </section>
      <section
        v-if="missingPendingActions.length"
        class="state-panel"
        aria-label="未确认的案件办理请求"
      >
        <p>原办理请求尚待确认。即使案件已离开当前筛选，仍可核对原请求。</p>
        <ElButton
          v-for="[id, action] in missingPendingActions"
          :key="id"
          :disabled="openingAction"
          @click="enterRecovery(id, action)"
          >核对原办理请求</ElButton
        >
      </section>
      <div
        class="segmented-control business-list-toolbar"
        role="group"
        aria-label="案件范围"
      >
        <ElButton
          :type="view === 'mine' ? 'primary' : 'default'"
          @click="setView('mine')"
          >我负责</ElButton
        >
        <ElButton
          :type="view === 'department' ? 'primary' : 'default'"
          @click="setView('department')"
          >本部门全部</ElButton
        >
      </div>
      <CaseListPreferencesPanel
        :bucket="preferenceBucket"
        :request-generation="preferenceRequestGeneration"
        @change="applyColumnPreference"
      />
      <form class="case-list-query" role="search" @submit.prevent="applyQuery">
        <label>
          <span>关键词</span>
          <input
            v-model="queryDraft.q"
            type="search"
            placeholder="编号、案号、客户、权利主体、被告"
            data-test="case-query-keyword"
          />
        </label>
        <label>
          <span>客户</span>
          <input v-model="queryDraft.customerName" />
        </label>
        <label>
          <span>权利主体</span>
          <input v-model="queryDraft.rightsHolderName" />
        </label>
        <label>
          <span>案号</span>
          <input v-model="queryDraft.courtCaseNo" />
        </label>
        <label>
          <span>排序字段</span>
          <select v-model="queryDraft.sortBy">
            <option value="createdAt">创建时间</option>
            <option value="businessNo">案件编号</option>
            <option value="rightsHolderName">权利主体</option>
          </select>
        </label>
        <label>
          <span>顺序</span>
          <select v-model="queryDraft.sortDirection">
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </label>
        <div class="case-list-query-actions">
          <ElButton type="primary" native-type="submit">查询</ElButton>
          <ElButton native-type="button" @click="clearQuery">清除筛选</ElButton>
        </div>
      </form>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取案件</h2>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h2>案件列表暂时无法加载</h2>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <section v-else class="demo-card" data-test="case-list">
        <p v-if="items.length === 0" class="field-help demo-card--pad">
          当前没有案件。
        </p>
        <div
          v-else
          class="business-list-scroll"
          role="region"
          aria-label="案件列表，可横向滚动"
          tabindex="0"
        >
          <table
            class="demo-table business-list-table case-list-table"
            :style="{ minWidth: `${minimumTableWidth}px` }"
          >
            <caption class="sr-only">
              案件列表
            </caption>
            <colgroup>
              <col
                v-for="column in visibleColumns"
                :key="column"
                :class="columnClass(column)"
              />
            </colgroup>
            <thead>
              <tr>
                <th
                  v-for="column in visibleColumns"
                  :key="column"
                  scope="col"
                  :class="column.endsWith('Amount') ? 'num' : undefined"
                >
                  {{ columnLabels[column] }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td
                  v-for="column in visibleColumns"
                  :key="column"
                  :class="cellClass(column)"
                >
                  <template v-if="column === 'businessNo'">
                    <RouterLink
                      class="mono"
                      :to="{
                        path: `/cases/${encodeURIComponent(item.id)}`,
                        query: listQuery,
                      }"
                      >{{ item.businessNo }}</RouterLink
                    >
                    <div class="case-list-actions">
                      <ElButton
                        v-for="(action, index) in listActions(item)"
                        :key="action.intent"
                        :text="index !== 0"
                        type="primary"
                        :data-case-action="action.intent"
                        :disabled="
                          openingAction ||
                          (!pendingActions.has(item.id) &&
                            recordRecoveries.some(
                              (recovery) => recovery.caseId === item.id,
                            ))
                        "
                        @click="enterAction(item, action.intent)"
                      >
                        {{ action.label }}
                      </ElButton>
                      <ElButton
                        text
                        data-case-record-edit
                        :disabled="
                          openingAction ||
                          !!recordRecoveryError ||
                          pendingActions.has(item.id)
                        "
                        @click="enterRecordEditor(item)"
                        >编辑已登记资料</ElButton
                      >
                      <span
                        v-if="listActions(item).length === 0"
                        class="field-help"
                        >当前无可办操作</span
                      >
                    </div>
                    <details class="case-list-context">
                      <summary :title="item.owner.displayName">
                        负责人：{{ item.owner.displayName }}
                      </summary>
                      <p>负责人：{{ item.owner.displayName }}</p>
                      <p v-if="item.sourceLead">
                        来源线索：<span class="mono case-list-identifier">{{
                          item.sourceLead.businessNo
                        }}</span>
                      </p>
                      <p v-if="item.sourceNotaryMatter">
                        公证事项：<span class="mono case-list-identifier">{{
                          item.sourceNotaryMatter.businessNo
                        }}</span>
                      </p>
                      <p v-if="item.origin?.kind === 'EXTERNAL_ENTRY'">
                        案件来源：{{
                          item.origin.entryKind === 'EXTERNAL_TRANSFER'
                            ? '外部转入'
                            : '历史补录'
                        }}
                        · {{ item.origin.stageReachedOn }}
                      </p>
                    </details>
                  </template>
                  <span v-else-if="column === 'stage'" class="pill">
                    {{ stageLabel(item.stage) }}
                  </span>
                  <details
                    v-else-if="
                      column === 'customerName' || column === 'rightsHolderName'
                    "
                    class="case-list-name"
                  >
                    <summary :title="item.displaySummary[column]">
                      {{ item.displaySummary[column] }}
                    </summary>
                    <p>{{ item.displaySummary[column] }}</p>
                  </details>
                  <span v-else-if="column === 'platform'">
                    {{
                      item.displaySummary.source.platform
                        ? labelLeadPlatform(item.displaySummary.source.platform)
                        : '未提供'
                    }}
                  </span>
                  <details
                    v-else-if="column === 'shopName'"
                    class="case-list-name"
                  >
                    <summary
                      :title="item.displaySummary.source.shopName ?? '未提供'"
                    >
                      {{ item.displaySummary.source.shopName ?? '未提供' }}
                    </summary>
                    <p>{{ item.displaySummary.source.shopName ?? '未提供' }}</p>
                  </details>
                  <span v-else-if="column === 'shopExternalId'" class="mono">
                    {{ item.displaySummary.source.shopExternalId ?? '未登记' }}
                  </span>
                  <details
                    v-else-if="
                      column === 'defendants' &&
                      item.displaySummary.defendants.length
                    "
                    class="case-list-name"
                  >
                    <summary>
                      {{
                        item.displaySummary.defendants
                          .map((defendant) => defendant.name)
                          .join('、')
                      }}
                    </summary>
                    <ul>
                      <li
                        v-for="defendant in item.displaySummary.defendants"
                        :key="defendant.id"
                      >
                        {{ defendant.name }}
                      </li>
                    </ul>
                  </details>
                  <span v-else-if="column === 'defendants'">未登记</span>
                  <details
                    v-else-if="
                      column === 'lawyers' && item.displaySummary.lawyers.length
                    "
                    class="case-list-name"
                  >
                    <summary>
                      {{
                        item.displaySummary.lawyers
                          .map((lawyer) => lawyer.fullName)
                          .join('、')
                      }}
                    </summary>
                    <ul>
                      <li
                        v-for="lawyer in item.displaySummary.lawyers"
                        :key="lawyer.id"
                      >
                        {{ lawyer.fullName }}
                      </li>
                    </ul>
                  </details>
                  <span v-else-if="column === 'lawyers'">未登记</span>
                  <details
                    v-else-if="column === 'court' && item.displaySummary.court"
                    class="case-list-name"
                  >
                    <summary :title="item.displaySummary.court.name">
                      {{ item.displaySummary.court.name }}
                    </summary>
                    <p>{{ item.displaySummary.court.name }}</p>
                  </details>
                  <span v-else-if="column === 'court'">未登记</span>
                  <span v-else-if="column === 'courtCaseNo'" class="mono">
                    {{ item.displaySummary.courtCaseNo ?? '未登记' }}
                  </span>
                  <template v-else-if="isAmountColumn(column)">
                    <span>{{ amountLabel(item.displaySummary[column]) }}</span>
                    <details
                      v-if="item.displaySummary[column].sourceId !== null"
                      class="case-list-amount-source"
                    >
                      <summary>
                        {{
                          amountSourceLabel(
                            item.displaySummary[column].sourceType,
                          )
                        }}
                      </summary>
                      <p>
                        来源记录：{{ item.displaySummary[column].sourceId }}
                      </p>
                    </details>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="business-list-footer">
          <p class="field-help" aria-live="polite">
            当前显示 {{ items.length }} / {{ total }} 项
          </p>
          <nav
            class="case-list-pagination"
            aria-label="案件分页"
            data-test="case-pagination"
          >
            <ElButton
              text
              data-test="previous-page"
              :disabled="page <= 1"
              @click="goToPage(page - 1)"
              >上一页</ElButton
            >
            <span>第 {{ page }} / {{ totalPages }} 页</span>
            <ElButton
              text
              data-test="next-page"
              :disabled="page >= totalPages"
              @click="goToPage(page + 1)"
              >下一页</ElButton
            >
          </nav>
        </div>
      </section>
    </main>
    <ListWorkflowDrawer
      ref="drawer"
      v-model="drawerOpen"
      :context="workflowContext"
      :load-detail="loadWorkflow"
      @success="load"
      @closed="readPendingActions"
    >
      <template #default="{ detail, session, requestState }">
        <CaseListWorkflowPanel
          v-if="selectedAction"
          :item="detail"
          :action="selectedAction"
          :session="session"
          :request-state="requestState"
          :record-actor-key="recordActorKey"
          :record-recovery="selectedRecordRecovery"
          @cancel="drawer?.requestClose()"
        />
      </template>
    </ListWorkflowDrawer>
  </div>
</template>

<style scoped>
.case-list-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-1);
  white-space: normal;
}
.case-list-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.case-list-table {
  min-width: 2600px;
}

.case-list-col--identity {
  width: 200px;
}

.case-list-col--stage {
  width: 140px;
}

.case-list-col--name {
  width: 180px;
}

.case-list-col--platform {
  width: 100px;
}

.case-list-col--amount {
  width: 160px;
}

.case-list-name summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  cursor: pointer;
  white-space: normal;
  overflow-wrap: anywhere;
}

.case-list-name p,
.case-list-name ul,
.case-list-context p,
.case-list-amount-source p {
  margin: var(--s-2) 0 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.case-list-context,
.case-list-amount-source {
  margin-top: var(--s-2);
  color: var(--color-ink-muted);
  font-size: 12px;
}

.case-list-identifier {
  white-space: nowrap;
  word-break: normal;
}

.case-list-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}

.case-list-pagination span {
  white-space: nowrap;
}

.case-list-query {
  display: grid;
  grid-template-columns: repeat(4, minmax(150px, 1fr));
  align-items: end;
  gap: var(--s-3);
  margin: var(--s-4) 0;
}

.case-list-query label {
  display: grid;
  gap: var(--s-1);
  color: var(--color-ink-muted);
  font-size: 12px;
}

.case-list-query input,
.case-list-query select {
  min-width: 0;
  height: 32px;
  padding: 0 var(--s-2);
  color: var(--color-ink);
  background: var(--color-surface-1);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font: inherit;
}

.case-list-query input:focus,
.case-list-query select:focus {
  outline: 2px solid rgba(94, 106, 210, 0.25);
  outline-offset: 1px;
}

.case-list-query-actions {
  display: flex;
  gap: var(--s-2);
}

@media (max-width: 900px) {
  .case-list-query {
    grid-template-columns: repeat(2, minmax(150px, 1fr));
  }
}

@media (max-width: 540px) {
  .case-list-query {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
