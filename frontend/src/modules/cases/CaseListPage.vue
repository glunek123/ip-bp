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
  exportSelectedCasesCsv,
  exportCaseListCsv,
  getCaseListExportCapability,
  type CaseListExportInput,
} from '../../api/case-list-export';
import { useAuthStore } from '../../stores/auth';
import { labelLeadPlatform } from '../leads/index';
import { isListRowClick } from '../../app/list-row-navigation';
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
import CaseConsolidationPanel from './CaseConsolidationPanel.vue';
import CaseCsvImportPanel from './CaseCsvImportPanel.vue';
import ListHeaderSearch from '../../shared/ListHeaderSearch.vue';
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
const parsedListQuery = computed(() =>
  parseCaseListQuery({ ...route.query, caseType: undefined }),
);
watch(
  () => route.query.caseType,
  (value) => {
    if (value === undefined) return;
    const query = { ...route.query };
    delete query.caseType;
    void router.replace({ query: { ...query, page: '1' } });
  },
  { immediate: true },
);
const listFilters = computed<CaseListQuery>(() =>
  parsedListQuery.value.ok ? parsedListQuery.value.value : {},
);
const effectiveListQuery = computed<CaseListQuery>(() => listFilters.value);
const listFilterKey = computed(() => caseListQueryKey(listFilters.value));
const rawListQueryKey = computed(() =>
  JSON.stringify(
    [
      'q',
      'customerName',
      'rightsHolderName',
      'courtCaseNo',
      'shopName',
      'defendantName',
      'courtName',
      'lawyerName',
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
const selectionExportError = ref('');
const selectedCaseIds = ref<string[]>([]);
const consolidationOpen = ref(false);
const csvImportOpen = ref(false);
const csvImportPending = ref(false);
const csvImportPendingOwner = ref<string | null>(null);
watch(
  identity,
  (currentIdentity) => {
    csvImportOpen.value =
      csvImportPending.value && csvImportPendingOwner.value === currentIdentity;
    consolidationOpen.value = false;
  },
  { flush: 'sync' },
);
const selectedCases = computed(() =>
  items.value.filter((item) => selectedCaseIds.value.includes(item.id)),
);
const selectedCase = computed(() =>
  selectedCaseIds.value.length === 1 && selectedCases.value.length === 1
    ? selectedCases.value[0]
    : null,
);
const selectedCaseSecondaryActions = computed(() => {
  if (!selectedCase.value || pendingActions.value.has(selectedCase.value.id))
    return [];
  const primary = progressActions(selectedCase.value)[0];
  return listActions(selectedCase.value).filter(
    (action) =>
      action.intent !== primary?.intent && action.intent !== 'early-closure',
  );
});
const closureQueue = ref<CaseSummary[]>([]);
const archiveQueue = ref<CaseSummary[]>([]);
const canArchiveSelection = computed(
  () =>
    selectedCases.value.length > 1 &&
    selectedCases.value.length === selectedCaseIds.value.length &&
    selectedCases.value.every(
      (item) =>
        item.stage === 'WAITING_ARCHIVE' &&
        !pendingActions.value.has(item.id) &&
        !recordRecoveries.value.some((entry) => entry.caseId === item.id) &&
        listActions(item).some((action) => action.intent === 'archive'),
    ),
);
function startArchiveSelection() {
  if (!canArchiveSelection.value || openingAction.value) return;
  archiveQueue.value = [
    ...new Map(selectedCases.value.map((item) => [item.id, item])).values(),
  ];
  nextArchiveCase();
}
function nextArchiveCase() {
  const item = archiveQueue.value[0];
  if (item && !openingAction.value) enterAction(item, 'archive');
}
const canCloseSelection = computed(
  () =>
    selectedCases.value.length > 0 &&
    selectedCases.value.length === selectedCaseIds.value.length &&
    selectedCases.value.every((item) =>
      listActions(item).some((action) => action.intent === 'early-closure'),
    ),
);
function startClosureSelection() {
  if (!canCloseSelection.value || openingAction.value) return;
  closureQueue.value = [
    ...new Map(selectedCases.value.map((item) => [item.id, item])).values(),
  ];
  nextClosureCase();
}
function nextClosureCase() {
  const item = closureQueue.value[0];
  if (item && !openingAction.value) enterAction(item, 'early-closure');
}
function workflowSucceeded() {
  if (
    selectedAction.value === 'early-closure' &&
    closureQueue.value[0]?.id === workflowContext.value?.recordId
  )
    closureQueue.value = closureQueue.value.slice(1);
  if (
    selectedAction.value === 'archive' &&
    archiveQueue.value[0]?.id === workflowContext.value?.recordId
  )
    archiveQueue.value = archiveQueue.value.slice(1);
  void load();
}
const canConsolidateSelection = computed(
  () =>
    stage.value === 'PENDING_MATCH' &&
    selectedCaseIds.value.length >= 2 &&
    selectedCaseIds.value.length <= 20 &&
    selectedCases.value.length === selectedCaseIds.value.length &&
    selectedCases.value.every(
      (item) =>
        item.canConsolidate === true &&
        item.stage === selectedCases.value[0]?.stage,
    ),
);
const allVisibleSelected = computed(
  () =>
    items.value.length > 0 &&
    items.value.every((item) => selectedCaseIds.value.includes(item.id)),
);
function setSelectedCase(caseId: string, selected: boolean): void {
  selectedCaseIds.value = selected
    ? [...new Set([...selectedCaseIds.value, caseId])]
    : selectedCaseIds.value.filter((id) => id !== caseId);
}
function setAllVisibleSelected(selected: boolean): void {
  const visibleIds = new Set(items.value.map((item) => item.id));
  selectedCaseIds.value = selected
    ? [...new Set([...selectedCaseIds.value, ...visibleIds])]
    : selectedCaseIds.value.filter((id) => !visibleIds.has(id));
}
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
watch(
  requestKey,
  () => {
    selectedCaseIds.value = [];
    selectionExportError.value = '';
    if (!csvImportPending.value) csvImportOpen.value = false;
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
const queryDraft = ref({ q: '' });
watch(
  () => parsedListQuery.value,
  (parsed) => {
    if (!parsed.ok) return;
    queryDraft.value = {
      q: parsed.value.q ?? '',
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
      ...serializeCaseListQuery(parsed.value),
      page: '1',
    },
  });
}
function clearQuery() {
  queryDraft.value = {
    q: '',
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
  const actions = resolveCaseListActions(item).filter(
    (action) =>
      (action.intent !== 'early-closure' &&
        action.intent !== 'payment-proof') ||
      (auth.session?.principalType === 'INTERNAL' &&
        item.owner.id === auth.session.user.id),
  );
  const primary =
    actions.find((action) => action.intent === 'choose-next-step') ??
    primaryCaseAction(item.stage, actions);
  return primary
    ? [primary, ...actions.filter((action) => action !== primary)]
    : actions;
}
const secondaryCaseIntents = new Set<CaseActionIntent>([
  'payment-proof',
  'correct-archive',
  'correct-closure',
  'correct-judgment',
  'revoke-next-step',
  'revoke-second-instance-result',
  'defendant-contact-update',
  'acceptance-correction',
]);
function isSecondaryCaseAction(
  item: CaseSummary,
  action: { intent: CaseActionIntent },
) {
  return (
    secondaryCaseIntents.has(action.intent) ||
    (action.intent === 'hearing' && !item.canScheduleHearing)
  );
}
function progressActions(item: CaseSummary) {
  if (pendingActions.value.has(item.id)) return [];
  return listActions(item)
    .filter(
      (action) =>
        !isSecondaryCaseAction(item, action) &&
        action.intent !== 'early-closure' &&
        action.intent !== 'archive',
    )
    .slice(0, 1);
}
function shortCaseAction(action: {
  intent: CaseActionIntent;
  label: string;
}): string {
  const labels: Partial<Record<CaseActionIntent, string>> = {
    match: '匹配案件',
    complaint: '提交诉状',
    'confirm-complaint': '确认诉状',
    'mail-complaint': '邮寄诉状',
    filing: '提交立案',
    acceptance: '正式立案',
    hearing: '登记开庭',
    'register-judgment': '登记判决',
    'choose-next-step': '选择后续',
    'second-instance': '二审办理',
    'execution-upload': '上传材料',
    'execution-submission': '提交材料',
    'execution-confirmation': '确认材料',
    'execution-mailing': '执行邮寄',
    'execution-filing': '执行立案',
    finish: '执行结束',
    'record-closure': '登记结案',
    archive: '归档',
  };
  return labels[action.intent] ?? action.label;
}
const pendingActions = ref(new Map<string, CaseActionIntent>());
const recordRecoveries = ref<CaseListRecordRecovery[]>([]);
const recordRecoveryError = ref('');
const canEditSelectedCase = computed(
  () =>
    selectedCase.value !== null &&
    auth.session?.principalType === 'INTERNAL' &&
    selectedCase.value.owner.id === auth.session.user.id &&
    !recordRecoveries.value.some(
      (recovery) => recovery.caseId === selectedCase.value?.id,
    ),
);
const editSelectedCaseTitle = computed(() => {
  if (selectedCaseIds.value.length > 1) return '请恰选一条本人负责的案件';
  if (!selectedCase.value) return '请选择本人负责的案件';
  if (auth.session?.principalType !== 'INTERNAL')
    return '当前账号不可编辑案件资料';
  if (selectedCase.value.owner.id !== auth.session?.user.id)
    return '仅可编辑本人负责的案件';
  if (
    recordRecoveries.value.some(
      (entry) => entry.caseId === selectedCase.value?.id,
    )
  )
    return '请先核对待恢复的资料更正请求';
  return '编辑本人负责案件的已登记资料';
});
const pendingRecoveryActions = computed(() => [...pendingActions.value]);
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
function openSelectedRoutineEdit() {
  if (!canEditSelectedCase.value || !selectedCase.value) return;
  void router.push({
    path: `/cases/${encodeURIComponent(selectedCase.value.id)}`,
    query: { ...listQuery.value, edit: 'routine' },
  });
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
watch(
  [identity, sessionGeneration],
  () => {
    closureQueue.value = [];
    archiveQueue.value = [];
    closeWorkflow();
  },
  { flush: 'sync' },
);
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
type CaseListTableColumn =
  CaseListColumn | 'selection' | 'owner' | 'rowActions';
const tableColumns = computed<CaseListTableColumn[]>(() => [
  'selection',
  'rowActions',
  'businessNo',
  'owner',
  ...visibleColumns.value.filter((column) => column !== 'businessNo'),
]);
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
  businessNo: '案件编号',
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
const fixedColumnLabels = {
  selection: '选择',
  owner: '负责人',
  rowActions: '操作',
} as const;
function columnLabel(column: CaseListTableColumn): string {
  return column in fixedColumnLabels
    ? fixedColumnLabels[column as keyof typeof fixedColumnLabels]
    : columnLabels[column as CaseListColumn];
}
function columnClass(column: CaseListTableColumn) {
  if (column === 'selection') return 'case-list-col--selection';
  if (column === 'owner') return 'case-list-col--owner';
  if (column === 'rowActions') return 'case-list-col--actions';
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
function cellClass(column: CaseListTableColumn) {
  if (column === 'selection') return 'business-list-cell--nowrap';
  if (column === 'owner') return 'business-list-cell--text';
  if (column === 'rowActions') return 'business-list-cell--text';
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
  tableColumns.value.reduce((width, column) => {
    if (column === 'selection') return width + 48;
    if (column === 'owner') return width + 120;
    if (column === 'rowActions') return width + 200;
    if (
      column === 'businessNo' ||
      column === 'shopExternalId' ||
      column === 'courtCaseNo'
    )
      return width + 170;
    if (column === 'stage') return width + 140;
    if (column === 'platform') return width + 100;
    if (column.endsWith('Amount')) return width + 160;
    return width + 160;
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
async function exportSelectedList(): Promise<void> {
  if (
    !canExportCsv.value ||
    selectedCaseIds.value.length === 0 ||
    exporting.value
  )
    return;
  const key = exportContextKey.value;
  const generation = ++exportGeneration;
  const ids = [...selectedCaseIds.value];
  const controller = new AbortController();
  exportController?.abort();
  exportController = controller;
  exporting.value = true;
  selectionExportError.value = '';
  try {
    const result = await exportSelectedCasesCsv(
      { view: view.value, ids },
      { signal: controller.signal },
    );
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      key !== exportContextKey.value ||
      ids.some((id) => !selectedCaseIds.value.includes(id)) ||
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
      (cause.status === 401 || cause.status === 403)
    ) {
      exportCapability.value = false;
      selectionExportError.value =
        '当前账号已无案件导出权限，请刷新列表后重试。';
    } else selectionExportError.value = '选中案件导出失败，请稍后重试。';
  } finally {
    if (generation === exportGeneration) {
      exporting.value = false;
      exportController = undefined;
    }
  }
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
      <h1 class="sr-only">
        {{ view === 'department' ? '全部部门案件' : '我的案件' }}
      </h1>
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
        v-if="pendingRecoveryActions.length"
        class="state-panel"
        aria-label="未确认的案件办理请求"
      >
        <p>原办理请求尚待确认，可在此核对原请求。</p>
        <ElButton
          v-for="[id, action] in pendingRecoveryActions"
          :key="id"
          :disabled="openingAction"
          @click="enterRecovery(id, action)"
          >核对原办理请求</ElButton
        >
      </section>
      <ListHeaderSearch
        v-model="queryDraft.q"
        placeholder="编号、案号、客户、权利主体、店铺、被告、法院、律师"
        @search="applyQuery"
      />
      <div
        class="case-list-toolbar case-list-head-actions operation-bar"
        aria-label="案件列表工具栏"
      >
        <ElButton @click="applyQuery">查询</ElButton>
        <ElButton data-test="case-query-clear" @click="clearQuery"
          >清除筛选</ElButton
        >
        <span v-if="selectedCaseIds.length" aria-live="polite">
          已选 {{ selectedCaseIds.length }} 件
        </span>
        <ElButton
          v-if="canEditSelectedCase"
          class="case-toolbar-button"
          data-test="edit-selected-case"
          :title="editSelectedCaseTitle"
          @click="openSelectedRoutineEdit"
          >编辑资料</ElButton
        >
        <ElButton
          v-else
          class="case-toolbar-button"
          disabled
          data-test="edit-selected-case"
          :title="editSelectedCaseTitle"
          >编辑资料</ElButton
        >
        <template v-if="selectedCase && selectedCaseSecondaryActions.length">
          <ElButton
            v-for="action in selectedCaseSecondaryActions"
            :key="action.intent"
            class="case-toolbar-action"
            :disabled="openingAction"
            :data-case-action="action.intent"
            :title="action.label"
            @click="enterAction(selectedCase, action.intent)"
            >{{ shortCaseAction(action) }}</ElButton
          >
        </template>
        <ElButton
          v-if="canCloseSelection"
          data-test="close-selected-cases"
          data-case-action="early-closure"
          :disabled="openingAction"
          @click="startClosureSelection"
          >结案</ElButton
        >
        <ElButton
          v-if="closureQueue.length && !drawerOpen"
          data-test="next-closure-case"
          :disabled="openingAction"
          @click="nextClosureCase"
          >继续逐案结案（剩余 {{ closureQueue.length }} 件）</ElButton
        >
        <ElButton
          v-if="canArchiveSelection"
          data-test="archive-selected-cases"
          data-case-action="archive"
          :disabled="openingAction"
          @click="startArchiveSelection"
          >归档</ElButton
        >
        <ElButton
          v-if="archiveQueue.length && !drawerOpen"
          data-test="next-archive-case"
          :disabled="openingAction"
          @click="nextArchiveCase"
          >继续逐案归档（剩余 {{ archiveQueue.length }} 件）</ElButton
        >
        <ElButton
          class="case-toolbar-button"
          :disabled="
            !selectedCaseIds.length ||
            !canExportCsv ||
            exporting ||
            selectedCaseIds.length > 1000
          "
          :loading="exporting"
          :title="
            !selectedCaseIds.length
              ? '请先勾选案件'
              : !exportCapability
                ? '暂不可导出，请稍后重试或核对权限'
                : !exportInput
                  ? '请先修正筛选条件'
                  : selectedCaseIds.length > 1000
                    ? '每次最多导出 1000 件案件'
                    : exporting
                      ? '正在导出，请稍候'
                      : '导出选中案件'
          "
          data-test="export-selected-cases"
          @click="exportSelectedList"
          >导出选中</ElButton
        >
        <ElButton
          v-if="stage === 'PENDING_MATCH'"
          class="case-toolbar-button"
          :disabled="!canConsolidateSelection"
          :title="
            canConsolidateSelection
              ? '合并所选案件'
              : '请选择 2 至 20 件待匹配且可合并的案件'
          "
          data-test="open-case-consolidation"
          @click="consolidationOpen = true"
          >合并起诉</ElButton
        >
        <ElButton
          v-if="selectedCaseIds.length"
          class="case-toolbar-button"
          data-test="clear-case-selection"
          @click="selectedCaseIds = []"
          >清空选择</ElButton
        >
        <ElButton
          v-if="canExportCsv"
          class="case-toolbar-button"
          :loading="exporting"
          :disabled="exporting || state !== 'ready'"
          data-test="export-current-case-list"
          @click="exportCurrentList"
          title="导出当前筛选结果"
          >导出筛选</ElButton
        >
        <ElButton
          v-if="
            canCreateExternalEntry && stage === 'PENDING_MATCH' && !stageGroup
          "
          class="case-toolbar-button"
          type="primary"
          @click="router.push('/cases/external-entry')"
          title="创建、转入或补录案件"
          >创建案件</ElButton
        >
        <ElButton
          v-if="canCreateExternalEntry"
          class="case-toolbar-button"
          data-test="open-case-csv-import"
          @click="csvImportOpen = true"
          title="批量导入案件 CSV"
          >导入</ElButton
        >
        <ElButton
          class="case-toolbar-button"
          :loading="state === 'loading'"
          title="刷新案件列表"
          @click="load"
          >刷新</ElButton
        >
        <CaseListPreferencesPanel
          :bucket="preferenceBucket"
          :request-generation="preferenceRequestGeneration"
          @change="applyColumnPreference"
        />
        <p
          v-if="exportError || selectionExportError"
          class="submit-error"
          role="alert"
        >
          {{ exportError || selectionExportError }}
        </p>
      </div>
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
                v-for="column in tableColumns"
                :key="column"
                :class="columnClass(column)"
              />
            </colgroup>
            <thead>
              <tr>
                <th
                  v-for="column in tableColumns"
                  :key="column"
                  scope="col"
                  :data-column="column"
                  :class="
                    !['owner', 'rowActions'].includes(column) &&
                    column.endsWith('Amount')
                      ? 'num'
                      : undefined
                  "
                >
                  <label
                    v-if="column === 'selection'"
                    class="case-list-select-all"
                  >
                    <input
                      type="checkbox"
                      aria-label="全选本页案件"
                      data-test="select-visible-cases"
                      :checked="allVisibleSelected"
                      :indeterminate="
                        selectedCases.length > 0 && !allVisibleSelected
                      "
                      @change="
                        setAllVisibleSelected(
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                  </label>
                  <template v-else>{{ columnLabel(column) }}</template>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.id"
                class="business-row-link"
                @click="
                  isListRowClick($event) &&
                  router.push({
                    path: `/cases/${encodeURIComponent(item.id)}`,
                    query: listQuery,
                  })
                "
              >
                <td
                  v-for="column in tableColumns"
                  :key="column"
                  :class="cellClass(column)"
                  :data-column="column"
                >
                  <template v-if="column === 'selection'">
                    <input
                      type="checkbox"
                      :aria-label="`选择案件 ${item.businessNo}`"
                      :data-test="`select-case-${item.id}`"
                      :checked="selectedCaseIds.includes(item.id)"
                      @change="
                        setSelectedCase(
                          item.id,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                  </template>
                  <template v-else-if="column === 'businessNo'">
                    <RouterLink
                      class="mono"
                      :to="{
                        path: `/cases/${encodeURIComponent(item.id)}`,
                        query: listQuery,
                      }"
                      >{{ item.businessNo }}</RouterLink
                    >
                  </template>
                  <span
                    v-else-if="column === 'owner'"
                    class="case-list-truncate"
                    :title="item.owner.displayName"
                  >
                    {{ item.owner.displayName }}
                  </span>
                  <div
                    v-else-if="column === 'rowActions'"
                    class="case-list-actions operation-bar"
                  >
                    <ElButton
                      v-for="action in progressActions(item)"
                      :key="action.intent"
                      class="case-list-progress"
                      type="primary"
                      :title="action.label"
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
                      {{ shortCaseAction(action) }}
                    </ElButton>
                  </div>
                  <span v-else-if="column === 'stage'" class="pill">
                    {{ stageLabel(item.stage) }}
                  </span>
                  <span
                    v-else-if="
                      column === 'customerName' || column === 'rightsHolderName'
                    "
                    class="case-list-truncate"
                    :title="item.displaySummary[column]"
                    >{{ item.displaySummary[column] }}</span
                  >
                  <span v-else-if="column === 'platform'">
                    {{
                      item.displaySummary.source.platform
                        ? labelLeadPlatform(item.displaySummary.source.platform)
                        : '未提供'
                    }}
                  </span>
                  <span
                    v-else-if="column === 'shopName'"
                    class="case-list-truncate"
                    :title="item.displaySummary.source.shopName ?? '未提供'"
                  >
                    {{ item.displaySummary.source.shopName ?? '未提供' }}
                  </span>
                  <span
                    v-else-if="column === 'shopExternalId'"
                    class="mono case-list-truncate"
                    :title="item.displaySummary.source.shopExternalId ?? ''"
                  >
                    {{ item.displaySummary.source.shopExternalId ?? '' }}
                  </span>
                  <span
                    v-else-if="column === 'defendants'"
                    class="case-list-truncate"
                    :title="
                      item.displaySummary.defendants
                        .map((entry) => entry.name)
                        .join('、') || '未登记'
                    "
                  >
                    {{
                      item.displaySummary.defendants
                        .map((entry) => entry.name)
                        .join('、') || '未登记'
                    }}
                  </span>
                  <span
                    v-else-if="column === 'lawyers'"
                    class="case-list-truncate"
                    :title="
                      item.displaySummary.lawyers
                        .map((entry) => entry.fullName)
                        .join('、') || '未登记'
                    "
                  >
                    {{
                      item.displaySummary.lawyers
                        .map((entry) => entry.fullName)
                        .join('、') || '未登记'
                    }}
                  </span>
                  <span
                    v-else-if="column === 'court'"
                    class="case-list-truncate"
                    :title="item.displaySummary.court?.name ?? '未登记'"
                  >
                    {{ item.displaySummary.court?.name ?? '未登记' }}
                  </span>
                  <span
                    v-else-if="column === 'courtCaseNo'"
                    class="mono case-list-truncate"
                    :title="item.displaySummary.courtCaseNo ?? '未登记'"
                  >
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
      @success="workflowSucceeded"
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
          :actor-user-id="auth.session?.user.id"
          :record-recovery="selectedRecordRecovery"
          @cancel="drawer?.requestClose()"
        />
      </template>
    </ListWorkflowDrawer>
    <CaseConsolidationPanel
      v-if="consolidationOpen && canConsolidateSelection"
      :items="selectedCases"
      :context-key="requestKey"
      @close="consolidationOpen = false"
      @completed="
        consolidationOpen = false;
        selectedCaseIds = [];
        load();
      "
    />
    <CaseCsvImportPanel
      v-if="csvImportOpen || csvImportPending"
      :open="csvImportOpen"
      :context-key="preferenceRequestGeneration"
      :identity-key="identity"
      @close="csvImportOpen = false"
      @completed="load"
      @access-lost="load"
      @pending-state="
        csvImportPending = $event;
        csvImportPendingOwner = $event ? identity : null;
      "
    />
  </div>
</template>

<style scoped>
.case-list-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--s-1);
  white-space: nowrap;
}
.case-list-col--selection {
  width: 48px;
}
.case-list-col--identity {
  width: 170px;
}
.case-list-col--owner {
  width: 120px;
}
.case-list-col--actions {
  width: 200px;
}
.case-list-col--origin {
  width: 190px;
}
.case-list-context {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s-1) var(--s-3);
  margin-top: 0;
}
.case-list-context p {
  margin: 0;
}
.case-list-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.case-list-actions :deep(.case-list-progress) {
  min-width: 80px;
  height: 32px;
  padding: 0 8px;
}

.demo-table.business-list-table.case-list-table {
  table-layout: fixed;
  font-size: 12px;
}
.case-list-table :is(th, td) {
  height: auto;
  padding: 7px 8px;
}

.case-list-col--stage {
  width: 140px;
}

.case-list-col--name {
  width: 160px;
}

.case-list-col--platform {
  width: 100px;
}

.case-list-col--amount {
  width: 160px;
}

.case-list-name summary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  white-space: nowrap;
}
.case-list-truncate {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  grid-template-columns: minmax(160px, 240px) auto;
  justify-content: start;
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

.case-list-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}

.case-list-toolbar {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin: 0 0 var(--s-2);
}

.case-list-toolbar :deep(.case-list-preferences) {
  flex: 0 0 auto;
  margin: 0;
}

.case-list-toolbar :deep(.case-toolbar-button),
.case-list-toolbar :deep(.case-toolbar-action) {
  flex: 0 0 auto;
  width: auto;
  min-width: 72px;
  padding-inline: 10px;
  white-space: nowrap;
}

.case-list-toolbar .submit-error {
  flex-basis: 100%;
  margin: 0;
  text-align: right;
}

@media (max-width: 900px) {
  .case-list-query {
    grid-template-columns: minmax(120px, 1fr) auto;
    justify-content: stretch;
  }
}

@media (max-width: 540px) {
  .case-list-query {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
