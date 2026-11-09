<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  RouterLink,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type LocationQueryRaw,
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
  todayShanghai,
  type CaseStage,
  type CaseStageGroup,
  type CaseStageFilter,
  type CaseSummary,
  type CaseDetail,
  type CaseView,
  type CaseListQuery,
} from '../../api/cases';
import {
  defaultCaseListPreference,
  type CaseListHiddenColumn,
  type CaseListColumn,
  type CaseListPreference,
  type CaseListPreferenceBucket,
} from '../../api/case-list-preference';
import CaseListPreferencesPanel from './CaseListPreferencesPanel.vue';
import { caseStageLabels } from './case-workspace-read-model';
import CaseConsolidationPanel from './CaseConsolidationPanel.vue';
import CaseCsvImportPanel from './CaseCsvImportPanel.vue';
import CaseComplaintExportPanel from './CaseComplaintExportPanel.vue';
import CaseFilingBatchPanel from './CaseFilingBatchPanel.vue';
import CaseLawyerAssignmentBatchPanel from './CaseLawyerAssignmentBatchPanel.vue';
import ListHeaderSearch from '../../shared/ListHeaderSearch.vue';
import {
  filingActorIdentity,
  readFilingBatchState,
} from './case-filing-batch-recovery';
import type { FilingBatchRead } from './case-filing-batch-recovery';
import { readLawyerAssignmentBatch } from './case-lawyer-assignment-batch-recovery';
import type { LawyerAssignmentBatchRead } from './case-lawyer-assignment-batch-recovery';
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
const filtersOpen = ref(false);
type ComplaintBatchAction =
  'complaint' | 'confirm-complaint' | 'mail-complaint';
type ComplaintBatchEntry = {
  caseId: string;
  businessNo: string;
  action: ComplaintBatchAction;
  status: 'pending' | 'ineligible' | 'succeeded' | 'skipped';
  reason: string;
};
type ComplaintBatchQueue = {
  version: 1;
  actor: string;
  action: ComplaintBatchAction;
  entries: ComplaintBatchEntry[];
};
const complaintBatchQueue = ref<ComplaintBatchQueue>();
const batchMailAt = ref(todayShanghai());
const batchMailRemark = ref('');
const complaintBatchStorageError = ref('');
const complaintBatchKey = (actor: string) =>
  `case-list-complaint-batch:v1:${encodeURIComponent(actor)}`;
function isComplaintBatchAction(value: unknown): value is ComplaintBatchAction {
  return (
    value === 'complaint' ||
    value === 'confirm-complaint' ||
    value === 'mail-complaint'
  );
}
function restoreComplaintBatchQueue() {
  complaintBatchQueue.value = undefined;
  complaintBatchStorageError.value = '';
  if (!identity.value) return;
  try {
    const raw = globalThis.sessionStorage.getItem(
      complaintBatchKey(identity.value),
    );
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('actor' in value) ||
      value.actor !== identity.value ||
      !('action' in value) ||
      !isComplaintBatchAction(value.action) ||
      !('entries' in value) ||
      !Array.isArray(value.entries) ||
      value.entries.length > 1000
    )
      throw new Error('Invalid complaint batch queue');
    const entries: ComplaintBatchEntry[] = [];
    const seen = new Set<string>();
    for (const entry of value.entries) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('caseId' in entry) ||
        typeof entry.caseId !== 'string' ||
        !entry.caseId ||
        seen.has(entry.caseId) ||
        !('businessNo' in entry) ||
        typeof entry.businessNo !== 'string' ||
        !('action' in entry) ||
        entry.action !== value.action ||
        !('status' in entry) ||
        !['pending', 'ineligible', 'succeeded', 'skipped'].includes(
          String(entry.status),
        ) ||
        !('reason' in entry) ||
        typeof entry.reason !== 'string'
      )
        throw new Error('Invalid complaint batch entry');
      seen.add(entry.caseId);
      entries.push({
        caseId: entry.caseId,
        businessNo: entry.businessNo,
        action: value.action,
        status: entry.status as ComplaintBatchEntry['status'],
        reason: entry.reason,
      });
    }
    if (!entries.length) throw new Error('Empty complaint batch queue');
    complaintBatchQueue.value = {
      version: 1,
      actor: identity.value,
      action: value.action,
      entries,
    };
  } catch {
    complaintBatchStorageError.value =
      '批量诉状队列记录无法核对。为避免重复提交，当前不会创建新队列或发送新请求。';
  }
}
function persistComplaintBatchQueue() {
  const queue = complaintBatchQueue.value;
  if (
    !queue ||
    queue.actor !== identity.value ||
    complaintBatchStorageError.value
  )
    return false;
  try {
    globalThis.sessionStorage.setItem(
      complaintBatchKey(queue.actor),
      JSON.stringify(queue),
    );
    return true;
  } catch {
    complaintBatchStorageError.value =
      '批量诉状队列无法安全保存。为避免重复提交，请先保留当前会话并核对原请求。';
    return false;
  }
}
const complaintQueueHasPending = computed(() =>
  complaintBatchQueue.value?.entries.some(
    (entry) => entry.status === 'pending',
  ),
);
const complaintBatchAvailable = computed(
  () =>
    stageGroup.value === 'COMPLAINT_PREPARATION' ||
    [
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
    ].includes(stage.value),
);
const complaintBatchQueueVisible = computed(
  () =>
    !!complaintBatchStorageError.value ||
    (!!complaintBatchQueue.value &&
      (complaintBatchAvailable.value ||
        complaintBatchQueue.value.entries.some(
          (entry) => entry.status !== 'succeeded',
        ))),
);
type CaseListBatchPanel = 'assignment' | 'filing' | 'complaint-export';
const activeBatchPanel = ref<CaseListBatchPanel | null>(null);
const batchPanelCases = shallowRef<CaseSummary[]>([]);
const batchPanelActorKey = ref('');
const batchPanelNavigationError = ref('');
const filingRecovery = ref<FilingBatchRead>({ state: 'missing' });
const assignmentRecovery = ref<LawyerAssignmentBatchRead>({ state: 'missing' });
const canStartBatchFromSelection = computed(
  () =>
    identity.value !== '' &&
    auth.session?.principalType === 'INTERNAL' &&
    selectedCaseIds.value.length >= 1 &&
    selectedCaseIds.value.length <= 20 &&
    selectedCases.value.length === selectedCaseIds.value.length,
);
function refreshCaseBatchRecovery() {
  const actor =
    auth.session?.principalType === 'INTERNAL'
      ? filingActorIdentity(identity.value)
      : null;
  if (!actor) {
    filingRecovery.value = { state: 'missing' };
    assignmentRecovery.value = { state: 'missing' };
    return;
  }
  filingRecovery.value = readFilingBatchState(actor);
  assignmentRecovery.value = readLawyerAssignmentBatch(actor);
}
const filingBatchNeedsRecovery = computed(() =>
  filingRecovery.value.state === 'blocked'
    ? true
    : filingRecovery.value.state === 'valid' &&
      filingRecovery.value.batch.items.some(
        (item) => item.state !== 'COMMITTED',
      ),
);
const assignmentBatchNeedsRecovery = computed(() =>
  assignmentRecovery.value.state === 'blocked'
    ? true
    : assignmentRecovery.value.state === 'valid' &&
      assignmentRecovery.value.batch.items.some(
        (item) => !['ASSIGNED', 'NO_CHANGE', 'SKIPPED'].includes(item.state),
      ),
);
function openBatchPanel(panel: CaseListBatchPanel, restoring = false): void {
  if (activeBatchPanel.value || !identity.value) return;
  if (restoring) batchPanelCases.value = [];
  else {
    if (!canStartBatchFromSelection.value) return;
    batchPanelCases.value = [...selectedCases.value];
  }
  batchPanelActorKey.value = identity.value;
  batchPanelNavigationError.value = '';
  activeBatchPanel.value = panel;
}
function closeBatchPanel(): void {
  activeBatchPanel.value = null;
  batchPanelCases.value = [];
  batchPanelActorKey.value = '';
  batchPanelNavigationError.value = '';
  refreshCaseBatchRecovery();
}
function openFilingBatchRecovery(): void {
  if (filingBatchNeedsRecovery.value) openBatchPanel('filing', true);
}
function openAssignmentBatchRecovery(): void {
  if (assignmentBatchNeedsRecovery.value) openBatchPanel('assignment', true);
}
function batchPanelChanged(): void {
  refreshCaseBatchRecovery();
  void load();
}
watch(identity, refreshCaseBatchRecovery, { immediate: true, flush: 'sync' });
watch(identity, restoreComplaintBatchQueue, { immediate: true, flush: 'sync' });
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
const closureQueue = ref<CaseSummary[]>([]);
const archiveQueue = ref<CaseSummary[]>([]);
const canArchiveSelection = computed(
  () =>
    selectedCases.value.length > 0 &&
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
const closureSelectionTitle = computed(() => {
  if (!selectedCaseIds.value.length) return '请先勾选可结案的案件';
  if (selectedCases.value.length !== selectedCaseIds.value.length)
    return '所选案件不在当前页，无法核对全部结案权限';
  if (!canCloseSelection.value) return '所选案件当前不具备结案权限或阶段不符';
  return '逐案核对并办理结案';
});
const archiveSelectionTitle = computed(() => {
  if (!selectedCaseIds.value.length) return '请先勾选待归档案件';
  if (selectedCases.value.length !== selectedCaseIds.value.length)
    return '所选案件不在当前页，无法核对全部归档权限';
  if (!canArchiveSelection.value)
    return '请只选择当前页中有归档权限且尚未归档的案件';
  return '逐案核对并正式归档';
});
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
function startComplaintBatch(action: ComplaintBatchAction) {
  if (
    !identity.value ||
    !selectedCaseIds.value.length ||
    selectedCaseIds.value.length > 1000 ||
    state.value !== 'ready' ||
    openingAction.value ||
    complaintBatchStorageError.value ||
    complaintQueueHasPending.value
  )
    return;
  const byId = new Map(items.value.map((item) => [item.id, item]));
  const entries = selectedCaseIds.value.map((caseId) => {
    const item = byId.get(caseId);
    if (!item)
      return {
        caseId,
        businessNo: `案件 ${caseId}`,
        action,
        status: 'ineligible' as const,
        reason: '当前列表未包含此案件，无法核对阶段和办理权限。',
      };
    if (pendingActions.value.has(caseId))
      return {
        caseId,
        businessNo: item.businessNo,
        action,
        status: 'pending' as const,
        reason: '有尚未确认的原办理请求，必须先核对原请求。',
      };
    if (recordRecoveries.value.some((entry) => entry.caseId === caseId))
      return {
        caseId,
        businessNo: item.businessNo,
        action,
        status: 'ineligible' as const,
        reason: '请先核对本案待恢复的资料更正请求。',
      };
    if (!listActions(item).some((entry) => entry.intent === action))
      return {
        caseId,
        businessNo: item.businessNo,
        action,
        status: 'ineligible' as const,
        reason: '案件阶段或服务端权限不符合此项诉状办理。',
      };
    return {
      caseId,
      businessNo: item.businessNo,
      action,
      status: 'pending' as const,
      reason: '',
    };
  });
  complaintBatchQueue.value = {
    version: 1,
    actor: identity.value,
    action,
    entries,
  };
  persistComplaintBatchQueue();
}
function complaintBatchStatus(entry: ComplaintBatchEntry) {
  if (entry.status === 'succeeded') return '已成功';
  if (entry.status === 'skipped') return '已跳过';
  if (entry.status === 'ineligible') return '条件不符';
  if (hasUnresolvedOriginalRequest(entry.caseId)) return '待核对原请求';
  return '待办理';
}
function openComplaintBatchEntry(entry: ComplaintBatchEntry) {
  const queue = complaintBatchQueue.value;
  if (
    !queue ||
    queue.actor !== identity.value ||
    complaintBatchStorageError.value ||
    entry.status !== 'pending' ||
    openingAction.value
  )
    return;
  const originalAction = pendingActions.value.get(entry.caseId);
  if (originalAction) {
    enterRecovery(entry.caseId, originalAction);
    return;
  }
  selectedAction.value = entry.action;
  selectedRecordRecovery.value = null;
  workflowContext.value = {
    recordId: entry.caseId,
    actorKey: queue.actor,
    actionKey: entry.action,
    title: `${entry.businessNo} · ${shortCaseAction({ intent: entry.action, label: entry.action })}`,
  };
  drawerOpen.value = true;
}
function skipComplaintBatchEntry(entry: ComplaintBatchEntry) {
  const queue = complaintBatchQueue.value;
  if (
    !queue ||
    queue.actor !== identity.value ||
    complaintBatchStorageError.value ||
    drawerOpen.value ||
    entry.status !== 'pending' ||
    hasUnresolvedOriginalRequest(entry.caseId)
  )
    return;
  entry.status = 'skipped';
  entry.reason = '';
  persistComplaintBatchQueue();
}
function complaintBatchActionLabel(action: ComplaintBatchAction) {
  if (action === 'complaint') return '上传诉状';
  if (action === 'confirm-complaint') return '确认诉状';
  return '登记邮寄';
}
function complaintBatchEntryReason(entry: ComplaintBatchEntry) {
  if (hasUnresolvedOriginalRequest(entry.caseId))
    return '存在未确认的原请求。请打开并核对原请求，不能跳过。';
  if (entry.status === 'pending' && !entry.reason)
    return '符合当前列表条件；打开后将重新读取案件并核对服务端权限。';
  return entry.reason;
}
function workflowSucceeded() {
  const completedAction = selectedAction.value;
  const completedId = workflowContext.value?.recordId;
  const completedCase = items.value.find((item) => item.id === completedId);
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
  const complaintQueue = complaintBatchQueue.value;
  const complaintEntry = complaintQueue?.entries.find(
    (entry) => entry.caseId === completedId && entry.status === 'pending',
  );
  if (
    complaintQueue?.actor === identity.value &&
    selectedAction.value === complaintQueue.action &&
    complaintEntry
  ) {
    complaintEntry.status = 'succeeded';
    complaintEntry.reason = '';
    persistComplaintBatchQueue();
  }
  if (
    completedAction === 'record-closure' &&
    completedCase?.stage === 'WAITING_ARCHIVE' &&
    completedId
  )
    void verifyClosureBridge(completedId, identity.value);
  void load();
}
const closureBridge = ref<{
  caseId: string;
  actor: string;
  status: 'checking' | 'ready' | 'denied' | 'unconfirmed';
  detail?: CaseDetail;
}>();
let closureBridgeController: AbortController | undefined;
async function verifyClosureBridge(caseId: string, actor: string) {
  closureBridgeController?.abort();
  const controller = new AbortController();
  closureBridgeController = controller;
  closureBridge.value = { caseId, actor, status: 'checking' };
  try {
    const detail = await getCase(caseId, { signal: controller.signal });
    if (
      controller.signal.aborted ||
      identity.value !== actor ||
      detail.id !== caseId
    )
      return;
    if (detail.stage !== 'WAITING_ARCHIVE' || !detail.closure) {
      closureBridge.value = { caseId, actor, status: 'unconfirmed' };
      return;
    }
    if (detail.canUpdateClosureSettlement !== true) {
      closureBridge.value = { caseId, actor, status: 'denied' };
      return;
    }
    closureBridge.value = { caseId, actor, status: 'ready', detail };
  } catch {
    if (!controller.signal.aborted && identity.value === actor)
      closureBridge.value = { caseId, actor, status: 'unconfirmed' };
  }
}
function continueClosureSettlement() {
  const bridge = closureBridge.value;
  if (
    !bridge ||
    bridge.actor !== identity.value ||
    bridge.status !== 'ready' ||
    !bridge.detail
  )
    return;
  selectedAction.value = 'settlement-update';
  selectedRecordRecovery.value = null;
  workflowContext.value = {
    recordId: bridge.caseId,
    actorKey: identity.value,
    actionKey: 'settlement-update',
    title: `${bridge.detail.businessNo} · 结算更新`,
  };
  drawerOpen.value = true;
  closureBridge.value = undefined;
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
type CaseListQueryDraft = Required<
  Pick<
    CaseListQuery,
    | 'q'
    | 'customerName'
    | 'rightsHolderName'
    | 'courtCaseNo'
    | 'shopName'
    | 'defendantName'
    | 'courtName'
    | 'lawyerName'
  >
> &
  Pick<CaseListQuery, 'caseType' | 'sortBy' | 'sortDirection'>;
const emptyQueryDraft = (): CaseListQueryDraft => ({
  q: '',
  customerName: '',
  rightsHolderName: '',
  courtCaseNo: '',
  shopName: '',
  defendantName: '',
  courtName: '',
  lawyerName: '',
});
const queryDraft = ref<CaseListQueryDraft>(emptyQueryDraft());
watch(
  () => parsedListQuery.value,
  (parsed) => {
    if (!parsed.ok) return;
    queryDraft.value = { ...emptyQueryDraft(), ...parsed.value };
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
  const next = { ...queryDraft.value } satisfies CaseListQuery;
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
  filtersOpen.value = false;
}
function clearQuery() {
  queryDraft.value = emptyQueryDraft();
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
  const actions = resolveCaseListActions(item);
  const primary =
    (item.stage === 'WAITING_JUDGMENT'
      ? actions.find(
          (action) =>
            action.intent === 'register-judgment' ||
            action.intent === 'correct-judgment',
        )
      : undefined) ??
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
function isSecondaryCaseAction(action: { intent: CaseActionIntent }) {
  return secondaryCaseIntents.has(action.intent);
}
function progressActions(item: CaseSummary) {
  if (pendingActions.value.has(item.id)) return [];
  return listActions(item)
    .filter(
      (action) =>
        !isSecondaryCaseAction(action) &&
        action.intent !== 'early-closure' &&
        action.intent !== 'archive',
    )
    .slice(0, item.stage === 'WAITING_JUDGMENT' ? 2 : 1);
}
function shortCaseAction(
  action: {
    intent: CaseActionIntent;
    label: string;
  },
  item?: Pick<CaseSummary, 'stage' | 'displaySummary'>,
): string {
  if (action.intent === 'match')
    return item?.displaySummary.defendants.length ? '匹配律师' : '补充被告';
  if (item?.stage === 'WAITING_ARCHIVE' && action.intent === 'record-closure')
    return '结算更新';
  const labels: Partial<Record<CaseActionIntent, string>> = {
    match: '匹配律师',
    complaint: '提交诉状',
    'confirm-complaint': '确认诉状',
    'mail-complaint': '邮寄诉状',
    filing: '提交立案',
    acceptance: '正式立案',
    hearing: '补录／更正开庭日期',
    'register-judgment': '判决更新',
    'correct-judgment': '判决更新',
    'choose-next-step': '二审抉择',
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
function caseActionTitle(
  item: CaseSummary,
  action: { intent: CaseActionIntent; label: string },
): string {
  if (item.stage === 'WAITING_ARCHIVE' && action.intent === 'record-closure')
    return '缺少结案资料。请先登记；登记后需重新读取并由你明确继续结算更新。';
  return action.label;
}
const pendingActions = ref(new Map<string, CaseActionIntent>());
const pendingRecoveryBlockedCaseIds = ref(new Set<string>());
const pendingRecoveryStorageBlocked = ref(false);
const recordRecoveries = ref<CaseListRecordRecovery[]>([]);
const recordRecoveryError = ref('');
const pendingRecoveryActions = computed(() => [...pendingActions.value]);
function readPendingActions() {
  const result = new Map<string, CaseActionIntent>();
  const blockedCaseIds = new Set<string>();
  pendingRecoveryStorageBlocked.value = false;
  const prefix = `case-list-workflow:v1:${encodeURIComponent(identity.value)}:`;
  try {
    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
      let key: string | null = null;
      try {
        key = globalThis.sessionStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const raw = globalThis.sessionStorage.getItem(key);
        if (!raw) throw new Error('Missing workflow recovery record');
        const value: unknown = JSON.parse(raw);
        const pending = decodeCaseListRequest(value);
        if (
          pending &&
          pending.actor === identity.value &&
          key === `${prefix}${encodeURIComponent(pending.caseId)}`
        )
          result.set(pending.caseId, pending.action);
        else throw new Error('Invalid workflow recovery record');
      } catch {
        if (key?.startsWith(prefix)) {
          try {
            const caseId = decodeURIComponent(key.slice(prefix.length));
            if (caseId) blockedCaseIds.add(caseId);
          } catch {
            pendingRecoveryStorageBlocked.value = true;
          }
        }
      }
    }
  } catch {
    /* Storage restrictions must not prevent reading the case list. */
    pendingRecoveryStorageBlocked.value = true;
  }
  pendingActions.value = result;
  pendingRecoveryBlockedCaseIds.value = blockedCaseIds;
  try {
    recordRecoveries.value = readCaseListRecordRecoveries(recordActorKey.value);
    recordRecoveryError.value = '';
  } catch {
    recordRecoveries.value = [];
    recordRecoveryError.value =
      '无法核对资料更正的原请求恢复记录。请保留当前会话并联系管理员，尚未发送新更正请求。';
  }
}
function hasUnresolvedOriginalRequest(caseId: string) {
  return (
    pendingRecoveryStorageBlocked.value ||
    pendingActions.value.has(caseId) ||
    pendingRecoveryBlockedCaseIds.value.has(caseId)
  );
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
function leaveCaseListRoute() {
  if (activeBatchPanel.value && batchPanelActorKey.value === identity.value) {
    batchPanelNavigationError.value =
      '请先关闭批量办理面板，再离开案件列表或修改筛选条件。';
    return false;
  }
  if (activeBatchPanel.value) closeBatchPanel();
  return leaveWorkflow();
}
onBeforeRouteLeave(leaveCaseListRoute);
onBeforeRouteUpdate(leaveCaseListRoute);
watch(
  [identity, sessionGeneration],
  () => {
    closureQueue.value = [];
    archiveQueue.value = [];
    closureBridgeController?.abort();
    closureBridgeController = undefined;
    closureBridge.value = undefined;
    closeWorkflow();
    if (activeBatchPanel.value) closeBatchPanel();
    selectedCaseIds.value = [];
    refreshCaseBatchRecovery();
    restoreComplaintBatchQueue();
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
const hiddenColumns = ref<CaseListHiddenColumn[]>(
  view.value === 'mine' ? ['owner'] : [],
);
const visibleColumns = computed(() =>
  columnOrder.value.filter(
    (column) => !hiddenColumns.value.some((hidden) => hidden === column),
  ),
);
const ownerVisible = computed(() => !hiddenColumns.value.includes('owner'));
type CaseListTableColumn =
  CaseListColumn | 'selection' | 'owner' | 'rowActions';
const tableColumns = computed<CaseListTableColumn[]>(() => [
  'selection',
  'rowActions',
  'businessNo',
  ...(ownerVisible.value ? ['owner' as const] : []),
  ...visibleColumns.value.filter((column) => column !== 'businessNo'),
]);
const preferenceBucket = computed<CaseListPreferenceBucket>(
  () => stageGroup.value ?? stage.value,
);
const preferenceRequestGeneration = computed(
  () => `${sessionGeneration.value}:${identity.value}`,
);
const workflowStages: Record<CaseStageGroup, readonly CaseStage[]> = {
  COMPLAINT_PREPARATION: [
    'WAITING_COMPLAINT',
    'WAITING_COMPLAINT_CONFIRMATION',
    'WAITING_COMPLAINT_STAMP',
  ],
  EXECUTION_PREPARATION: [
    'WAITING_EXECUTION_DOCUMENTS',
    'WAITING_EXECUTION_CONFIRMATION',
    'WAITING_EXECUTION_STAMP',
  ],
};
const workflowStageGroup = computed(() => {
  if (stageGroup.value) return stageGroup.value;
  const selected = stage.value;
  return selected === 'all'
    ? undefined
    : (Object.keys(workflowStages) as CaseStageGroup[]).find((group) =>
        workflowStages[group].includes(selected),
      );
});
const workflowStageOptions = computed(() =>
  workflowStageGroup.value ? workflowStages[workflowStageGroup.value] : [],
);
function filterWorkflowStage(selected: string) {
  const group = workflowStageGroup.value;
  if (!group) return;
  const query: LocationQueryRaw = { ...route.query, page: '1' };
  if (selected) {
    delete query.stageGroup;
    query.stage = selected;
  } else {
    delete query.stage;
    query.stageGroup = group;
  }
  void router.push({ query });
}
watch(
  [preferenceBucket, sessionGeneration, identity, view],
  () => {
    columnOrder.value = [...defaultCaseListPreference.order];
    hiddenColumns.value =
      view.value === 'mine' ? ['owner'] : [...defaultCaseListPreference.hidden];
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
  judgmentAmount: '判决金额',
  closureAmount: '结案金额',
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
  closureBridgeController?.abort();
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
        {{ view === 'department' ? '部门案件' : '我的案件' }}
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
      <section
        v-if="closureBridge && closureBridge.actor === identity"
        class="state-panel"
        aria-label="继续结算更新"
        data-test="closure-settlement-bridge"
      >
        <p v-if="closureBridge.status === 'checking'" role="status">
          结案资料已登记，正在重新读取最新资料和权限。
        </p>
        <template v-else-if="closureBridge.status === 'ready'">
          <p>最新资料已确认。结算更新不会自动提交；请明确选择下一步。</p>
          <ElButton
            type="primary"
            data-test="continue-closure-settlement"
            @click="continueClosureSettlement"
            >继续结算更新</ElButton
          >
        </template>
        <p v-else-if="closureBridge.status === 'denied'" role="alert">
          结案资料已登记，但当前账号没有更新结算的权限。请联系有权限的负责人。
        </p>
        <template v-else>
          <p role="alert">
            结案资料已提交，但最新资料或阶段尚未确认。请重新读取后核对；不会自动提交结算。
          </p>
          <ElButton
            data-test="retry-closure-settlement-read"
            @click="
              verifyClosureBridge(closureBridge.caseId, closureBridge.actor)
            "
            >重新读取</ElButton
          >
        </template>
      </section>
      <ListHeaderSearch
        v-model="queryDraft.q"
        placeholder="编号、案号、客户、权利主体、店铺、被告、法院、律师"
        @search="applyQuery"
      />
      <div
        class="case-list-toolbar case-list-head-actions operation-bar"
        :class="{
          'case-list-toolbar--matching': stage === 'PENDING_MATCH',
          'case-list-toolbar--filing': stage === 'WAITING_FILING',
          'case-list-toolbar--archive': stage === 'WAITING_ARCHIVE',
          'case-list-toolbar--archived': stage === 'ARCHIVED',
          'case-list-toolbar--general': ![
            'PENDING_MATCH',
            'WAITING_FILING',
            'WAITING_ARCHIVE',
            'ARCHIVED',
          ].includes(stage),
        }"
        aria-label="案件列表工具栏"
      >
        <label v-if="workflowStageGroup" class="case-list-stage-filter">
          <span>案件进展</span>
          <select
            data-test="case-workflow-stage-filter"
            :value="stage === 'all' ? '' : stage"
            @change="
              filterWorkflowStage(($event.target as HTMLSelectElement).value)
            "
          >
            <option value="">全部进展</option>
            <option
              v-for="option in workflowStageOptions"
              :key="option"
              :value="option"
            >
              {{ caseStageLabels[option] }}
            </option>
          </select>
        </label>
        <span v-if="selectedCaseIds.length" aria-live="polite">
          已选 {{ selectedCaseIds.length }} 件
          <ElButton
            text
            data-test="clear-case-selection"
            @click="selectedCaseIds = []"
            >清空选择</ElButton
          >
        </span>
        <ElButton
          v-if="stage === 'PENDING_MATCH' && !stageGroup"
          :disabled="!canStartBatchFromSelection || !!activeBatchPanel"
          :title="
            canStartBatchFromSelection
              ? '只处理明确勾选的案件；逐案读取分配权限'
              : selectedCaseIds.length > 20
                ? '每批最多选择20件案件'
                : '请先勾选1至20件当前列表中的案件'
          "
          data-test="case-lawyer-assignment-batch-open"
          @click="openBatchPanel('assignment')"
          >批量分配律师</ElButton
        >
        <ElButton
          v-if="stage === 'WAITING_FILING' && !stageGroup"
          :disabled="!canStartBatchFromSelection || !!activeBatchPanel"
          :title="
            canStartBatchFromSelection
              ? '只处理明确勾选的案件；逐案读取立案权限和材料要求'
              : selectedCaseIds.length > 20
                ? '每批最多选择20件案件'
                : '请先勾选1至20件当前列表中的案件'
          "
          data-test="case-filing-batch-open"
          @click="openBatchPanel('filing')"
          >批量立案</ElButton
        >
        <template v-if="complaintBatchAvailable">
          <ElButton
            v-for="action in [
              'complaint',
              'confirm-complaint',
              'mail-complaint',
            ] as const"
            :key="action"
            :disabled="
              !identity ||
              !selectedCaseIds.length ||
              selectedCaseIds.length > 1000 ||
              state !== 'ready' ||
              openingAction ||
              !!complaintBatchStorageError ||
              complaintQueueHasPending
            "
            :title="
              complaintQueueHasPending
                ? '请先继续或跳过当前队列中可跳过的案件'
                : selectedCaseIds.length
                  ? '只处理明确勾选的案件；逐案重新核对阶段和服务端权限'
                  : '请先勾选案件'
            "
            :data-test="`start-complaint-batch-${action}`"
            @click="startComplaintBatch(action)"
          >
            批量{{ complaintBatchActionLabel(action) }}
          </ElButton>
          <ElButton
            :disabled="!canStartBatchFromSelection || !!activeBatchPanel"
            :title="
              canStartBatchFromSelection
                ? '只预览和导出明确勾选的案件'
                : selectedCaseIds.length > 20
                  ? '每批最多选择20件案件'
                  : '请先勾选1至20件当前列表中的案件'
            "
            data-test="case-complaint-export-open"
            @click="openBatchPanel('complaint-export')"
            >批量导出诉状</ElButton
          >
        </template>
        <ElButton
          v-if="stage === 'WAITING_ARCHIVE'"
          data-test="archive-selected-cases"
          data-case-action="archive"
          :disabled="openingAction || !canArchiveSelection"
          :title="archiveSelectionTitle"
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
          v-if="stage !== 'WAITING_ARCHIVE' && stage !== 'ARCHIVED'"
          data-test="close-selected-cases"
          data-case-action="early-closure"
          :disabled="openingAction || !canCloseSelection"
          :title="closureSelectionTitle"
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
        <details class="case-list-toolbar-menu" data-test="case-export-menu">
          <summary>导出</summary>
          <div class="case-list-toolbar-menu__items">
            <ElButton
              v-if="canExportCsv"
              :loading="exporting"
              :disabled="exporting || state !== 'ready'"
              data-test="export-current-case-list"
              @click="exportCurrentList"
              >导出筛选结果</ElButton
            >
            <ElButton
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
              >导出选中案件</ElButton
            >
          </div>
        </details>
        <details
          v-if="
            canCreateExternalEntry && stage === 'PENDING_MATCH' && !stageGroup
          "
          class="case-list-toolbar-menu"
          data-test="case-create-menu"
        >
          <summary>创建案件</summary>
          <div class="case-list-toolbar-menu__items">
            <ElButton
              type="primary"
              data-test="create-case-entry"
              @click="router.push('/cases/external-entry')"
              title="创建、转入或补录案件"
              >创建案件</ElButton
            >
            <ElButton
              data-test="open-case-csv-import"
              @click="csvImportOpen = true"
              >CSV 导入</ElButton
            >
          </div>
        </details>
        <ElButton
          v-if="stage === 'PENDING_MATCH'"
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
          data-test="open-case-filters"
          @click="filtersOpen = !filtersOpen"
          >筛选</ElButton
        >
        <div class="case-list-toolbar-preferences">
          <CaseListPreferencesPanel
            :bucket="preferenceBucket"
            :view="view"
            :request-generation="preferenceRequestGeneration"
            @change="applyColumnPreference"
          />
        </div>
        <p
          v-if="exportError || selectionExportError"
          class="submit-error"
          role="alert"
        >
          {{ exportError || selectionExportError }}
        </p>
      </div>
      <section
        v-if="filingBatchNeedsRecovery || assignmentBatchNeedsRecovery"
        class="state-panel case-batch-recovery"
        aria-live="polite"
        data-test="case-batch-recovery"
      >
        <p
          v-if="filingBatchNeedsRecovery"
          data-test="filing-batch-recovery-status"
        >
          {{
            filingRecovery.state === 'blocked'
              ? '原立案批次记录无法核对；恢复面板会保持只读并保留原记录。'
              : '存在尚未完成的原立案批次；恢复入口不受当前筛选和勾选影响。'
          }}
        </p>
        <ElButton
          v-if="filingBatchNeedsRecovery"
          :disabled="!!activeBatchPanel"
          data-test="resume-filing-batch"
          @click="openFilingBatchRecovery"
          >恢复原立案批次</ElButton
        >
        <p
          v-if="assignmentBatchNeedsRecovery"
          data-test="assignment-batch-recovery-status"
        >
          {{
            assignmentRecovery.state === 'blocked'
              ? '原律师分配批次记录无法核对；恢复面板会保持只读并保留原记录。'
              : '存在尚未完成的原律师分配批次；恢复入口不受当前筛选和勾选影响。'
          }}
        </p>
        <ElButton
          v-if="assignmentBatchNeedsRecovery"
          :disabled="!!activeBatchPanel"
          data-test="resume-assignment-batch"
          @click="openAssignmentBatchRecovery"
          >恢复原律师分配批次</ElButton
        >
      </section>
      <section
        v-if="activeBatchPanel"
        class="case-batch-panel-host"
        data-test="case-batch-panel-host"
      >
        <p v-if="batchPanelNavigationError" role="alert">
          {{ batchPanelNavigationError }}
        </p>
        <CaseLawyerAssignmentBatchPanel
          v-if="activeBatchPanel === 'assignment'"
          :selected-cases="batchPanelCases"
          :actor-key="batchPanelActorKey"
          @changed="batchPanelChanged"
          @close="closeBatchPanel"
        />
        <CaseFilingBatchPanel
          v-else-if="activeBatchPanel === 'filing'"
          :selected-cases="batchPanelCases"
          :actor-key="batchPanelActorKey"
          @changed="batchPanelChanged"
          @close="closeBatchPanel"
        />
        <CaseComplaintExportPanel
          v-else
          :selected-cases="batchPanelCases"
          :actor-key="batchPanelActorKey"
          @changed="batchPanelChanged"
          @close="closeBatchPanel"
        />
      </section>
      <section
        v-if="complaintBatchQueueVisible"
        class="state-panel complaint-batch-queue"
        aria-label="批量诉状逐案队列"
        data-test="complaint-batch-queue"
      >
        <h2>批量诉状逐案办理</h2>
        <p v-if="complaintBatchStorageError" role="alert">
          {{ complaintBatchStorageError }}
        </p>
        <template v-else-if="complaintBatchQueue">
          <div
            v-if="complaintBatchQueue.action === 'mail-complaint'"
            class="demo-form-grid"
          >
            <label
              >本批邮寄日期<input
                v-model="batchMailAt"
                type="date"
                class="text-input"
                :max="todayShanghai()"
                data-test="batch-mail-date"
            /></label>
            <label
              >本批邮寄备注<input
                v-model="batchMailRemark"
                class="text-input"
                maxlength="1000"
                data-test="batch-mail-remark"
            /></label>
          </div>
          <p>
            {{
              complaintBatchActionLabel(complaintBatchQueue.action)
            }}：逐案提交，
            {{
              complaintBatchQueue.entries.filter(
                (entry) => entry.status === 'succeeded',
              ).length
            }}
            件已成功；逐案核对权限和结果。
          </p>
          <ul>
            <li
              v-for="entry in complaintBatchQueue.entries"
              :key="entry.caseId"
              :data-test="`complaint-batch-entry-${entry.caseId}`"
            >
              <span
                >{{ entry.businessNo }} —
                {{ complaintBatchStatus(entry) }}</span
              >
              <span v-if="complaintBatchEntryReason(entry)">
                {{ complaintBatchEntryReason(entry) }}
              </span>
              <ElButton
                v-if="entry.status === 'pending'"
                :disabled="
                  !identity ||
                  complaintBatchQueue.actor !== identity ||
                  !!complaintBatchStorageError ||
                  openingAction
                "
                :data-test="`continue-complaint-batch-${entry.caseId}`"
                @click="openComplaintBatchEntry(entry)"
              >
                {{
                  hasUnresolvedOriginalRequest(entry.caseId)
                    ? '核对原请求'
                    : '继续逐案办理'
                }}
              </ElButton>
              <ElButton
                v-if="
                  entry.status === 'pending' &&
                  !hasUnresolvedOriginalRequest(entry.caseId)
                "
                :disabled="drawerOpen || !!complaintBatchStorageError"
                :data-test="`skip-complaint-batch-${entry.caseId}`"
                @click="skipComplaintBatchEntry(entry)"
                >跳过此案</ElButton
              >
            </li>
          </ul>
        </template>
      </section>
      <section
        v-if="filtersOpen"
        class="case-list-filters state-panel"
        aria-label="案件列表筛选"
        data-test="case-list-filters"
      >
        <h2>筛选案件</h2>
        <div class="case-list-filters__grid">
          <label
            >客户<input
              v-model="queryDraft.customerName"
              data-test="filter-customerName"
          /></label>
          <label
            >权利主体<input
              v-model="queryDraft.rightsHolderName"
              data-test="filter-rightsHolderName"
          /></label>
          <label
            >案号<input
              v-model="queryDraft.courtCaseNo"
              data-test="filter-courtCaseNo"
          /></label>
          <label
            >店铺<input
              v-model="queryDraft.shopName"
              data-test="filter-shopName"
          /></label>
          <label
            >被告<input
              v-model="queryDraft.defendantName"
              data-test="filter-defendantName"
          /></label>
          <label
            >法院<input
              v-model="queryDraft.courtName"
              data-test="filter-courtName"
          /></label>
          <label
            >律师<input
              v-model="queryDraft.lawyerName"
              data-test="filter-lawyerName"
          /></label>
          <label
            >关键词<input
              v-model="queryDraft.q"
              data-test="filter-q"
              @keydown.enter.prevent="applyQuery"
          /></label>
        </div>
        <div class="operation-bar">
          <ElButton
            type="primary"
            data-test="apply-case-filters"
            @click="applyQuery"
            >应用筛选</ElButton
          >
          <ElButton data-test="case-query-clear" @click="clearQuery"
            >清除筛选</ElButton
          >
          <ElButton
            :loading="state === 'loading'"
            data-test="refresh-case-list-in-filters"
            @click="load"
            >刷新</ElButton
          >
          <ElButton @click="filtersOpen = false">关闭</ElButton>
        </div>
      </section>
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
                      :title="caseActionTitle(item, action)"
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
                      {{ shortCaseAction(action, item) }}
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
          :batch-mail-defaults="
            complaintBatchQueue?.action === 'mail-complaint'
              ? { mailedAt: batchMailAt, remark: batchMailRemark }
              : undefined
          "
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
.case-list-toolbar--matching .case-list-toolbar-preferences,
.case-list-toolbar--filing .case-list-toolbar-preferences,
.case-list-toolbar--archived .case-list-toolbar-preferences,
.case-list-toolbar--archive [data-test='archive-selected-cases'] {
  order: 1;
}
.case-list-toolbar--matching [data-test='open-case-filters'],
.case-list-toolbar--filing [data-test='open-case-filters'],
.case-list-toolbar--archived [data-test='open-case-filters'],
.case-list-toolbar--archive [data-test='export-current-case-list'] {
  order: 2;
}
.case-list-toolbar--matching [data-test='case-export-menu'],
.case-list-toolbar--filing [data-test='case-export-menu'],
.case-list-toolbar--archived [data-test='case-export-menu'],
.case-list-toolbar--archive [data-test='case-export-menu'],
.case-list-toolbar--archive [data-test='open-case-filters'] {
  order: 3;
}
.case-list-toolbar--matching [data-case-action='early-closure'],
.case-list-toolbar--filing [data-case-action='early-closure'],
.case-list-toolbar--general [data-case-action='early-closure'],
.case-list-toolbar--general [data-test='case-export-menu'] {
  order: 1;
}
.case-list-toolbar--matching [data-case-action='early-closure'],
.case-list-toolbar--matching [data-test='create-case-entry'],
.case-list-toolbar--matching [data-test='case-create-menu'],
.case-list-toolbar--matching [data-test='open-case-consolidation'] {
  order: 4;
}
.case-list-toolbar--general [data-test='open-case-filters'],
.case-list-toolbar--archive [data-test='open-case-filters'] {
  order: 3;
}
.case-list-toolbar--general .case-list-toolbar-preferences,
.case-list-toolbar--archive .case-list-toolbar-preferences {
  order: 4;
}
.case-list-toolbar--matching .case-list-toolbar-preferences,
.case-list-toolbar--filing .case-list-toolbar-preferences,
.case-list-toolbar--archived .case-list-toolbar-preferences {
  order: 1;
}
.case-list-toolbar--general [data-test='open-case-filters'] {
  order: 3;
}
.case-list-toolbar-menu {
  position: relative;
}
.case-list-stage-filter {
  display: grid;
  gap: 2px;
  min-width: 170px;
  color: var(--color-ink-muted);
  font-size: 12px;
  text-align: left;
}
.case-list-stage-filter select {
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  color: var(--color-ink);
}
.case-list-toolbar-menu > summary {
  cursor: pointer;
  list-style: none;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  padding: 6px 12px;
  background: var(--el-bg-color);
}
.case-list-toolbar-menu__items {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  min-width: max-content;
  gap: var(--s-1);
  padding: var(--s-2);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}
.case-list-filters__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--s-2) var(--s-3);
  margin: var(--s-3) 0;
}
.case-list-filters__grid label {
  display: grid;
  gap: var(--s-1);
}
.case-list-filters__grid input {
  min-width: 0;
  height: 32px;
  padding: 0 var(--s-2);
}
.case-list-filters .operation-bar {
  flex-wrap: wrap;
}
.complaint-batch-queue ul {
  display: grid;
  gap: var(--s-2);
  margin: var(--s-2) 0 0;
  padding-left: 1.25rem;
}
.complaint-batch-queue {
  padding: var(--s-3);
  text-align: left;
}
.complaint-batch-queue h2 {
  margin: 0 0 var(--s-2);
}
.complaint-batch-queue p {
  margin-bottom: var(--s-2);
}
.complaint-batch-queue li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-1) var(--s-2);
}
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

.case-list-toolbar--matching .case-list-toolbar-preferences,
.case-list-toolbar--filing .case-list-toolbar-preferences {
  order: 1;
}
.case-list-toolbar--matching [data-test='open-case-filters'],
.case-list-toolbar--filing [data-test='open-case-filters'] {
  order: 2;
}
.case-list-toolbar--matching [data-test='case-lawyer-assignment-batch-open'],
.case-list-toolbar--filing [data-test='case-filing-batch-open'] {
  order: 3;
}
.case-list-toolbar--matching [data-test='case-export-menu'],
.case-list-toolbar--filing [data-test='case-export-menu'] {
  order: 4;
}
.case-list-toolbar--matching [data-case-action='early-closure'],
.case-list-toolbar--filing [data-case-action='early-closure'] {
  order: 5;
}
.case-list-toolbar--matching [data-test='case-create-menu'] {
  order: 6;
}
.case-list-toolbar--matching [data-test='open-case-consolidation'] {
  order: 7;
}
.case-list-toolbar--general [data-test='case-complaint-export-open'] {
  order: 4;
}
.case-batch-panel-host {
  display: grid;
  gap: var(--s-2);
  margin: var(--s-3) 0;
}
.case-batch-panel-host > p {
  margin: 0;
}
.case-batch-recovery {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2) var(--s-3);
  margin: var(--s-3) 0;
}
.case-batch-recovery p {
  flex-basis: 100%;
  margin: 0;
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
