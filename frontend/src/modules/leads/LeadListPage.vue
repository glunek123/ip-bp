<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  getLeadFormContext,
  getLead,
  importLeadCsvBatch,
  listLeads,
  type Lead,
  type LeadBusinessResult,
  type LeadFormContext,
  type LeadStatus,
} from '../../api/leads';
import { ApiError } from '../../api/http';
import {
  labelLeadPlatform,
  leadStatusCards,
  leadStatusLabels,
} from './lead-options';
import { summarizeLeadProducts } from './lead-display';
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  readPendingLeadCommands,
  sameLeadAttempt,
} from './LeadListWorkflowPanel.vue';
import LeadQuickActionsPanel, {
  type FrozenLeadPush,
} from './LeadQuickActionsPanel.vue';
import LeadBatchPushPanel from './LeadBatchPushPanel.vue';
import LeadNoEvidenceBatchPanel from './LeadNoEvidenceBatchPanel.vue';
import {
  readPendingLeadNoEvidenceBatches,
  type FrozenLeadNoEvidenceBatch,
} from './lead-no-evidence-batch-recovery';
import {
  readPendingLeadBatchPush,
  savePendingLeadBatchPush,
  sameLeadBatchPush,
  type FrozenLeadBatchPush,
} from './lead-batch-push-recovery';
import LeadCsvImportPanel from './LeadCsvImportPanel.vue';
import {
  clearPendingLeadCsvImport,
  readPendingLeadCsvImports,
  sameLeadCsvImport,
  savePendingLeadCsvImports,
  type FrozenLeadCsvImport,
  type LeadCsvImportAttempt,
  type LeadCsvImportSubmissionContext,
  type LeadCsvImportSubmitOutcome,
} from './lead-csv-import-recovery';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const batchIdentity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}`,
);
const authorizationGeneration = computed(() =>
  String(auth.session?.authorizationRevision ?? ''),
);
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<Lead[]>([]);
const displayItems = computed(() =>
  items.value.map((lead) => ({
    lead,
    summary: summarizeLeadProducts(lead.products),
    products: [...lead.products].sort((a, b) => a.position - b.position),
  })),
);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const canCreate = ref(false);
let request: AbortController | undefined;
let batchRequest: AbortController | undefined;
const pendingPushes = ref(readPendingLeadCommands());
const pendingStorageUnavailable = computed(() => pendingPushes.value === null);
const pendingPush = computed(
  () => pendingPushes.value?.[identity.value] ?? null,
);
const singleBlocksNoEvidence = computed(
  () =>
    pendingPushes.value === null ||
    Object.keys(pendingPushes.value).some(
      (key) =>
        key === batchIdentity.value ||
        key.startsWith(`${batchIdentity.value}:`),
    ),
);
const activeLeadId = ref<string | null>(pendingPush.value?.leadId ?? null);
const selectedIds = ref<string[]>([]);
const noEvidenceSessionEpoch = ref(0);
watch(
  () => auth.session,
  () => {
    noEvidenceSessionEpoch.value += 1;
  },
  { flush: 'sync' },
);
const noEvidenceContext = computed(
  () => `${identity.value}:${noEvidenceSessionEpoch.value}:${route.fullPath}`,
);
const noEvidenceBatches = ref(readPendingLeadNoEvidenceBatches());
const pendingNoEvidence = computed(
  () => noEvidenceBatches.value?.[batchIdentity.value] ?? null,
);
const noEvidenceOpen = ref(false);
const noEvidenceLeads = ref<Lead[]>([]);
const noEvidenceLocked = computed(
  () =>
    noEvidenceOpen.value ||
    !!pendingNoEvidence.value ||
    noEvidenceBatches.value === null,
);
const pendingBatches = ref(readPendingLeadBatchPush());
const pendingBatch = computed(
  () => pendingBatches.value?.[batchIdentity.value] ?? null,
);
const pendingBatchBlocked = computed(() => pendingBatches.value === null);
const pendingCsvImports = ref(readPendingLeadCsvImports());
const pendingCsvImport = computed(
  () => pendingCsvImports.value?.[batchIdentity.value] ?? null,
);
const pendingCsvImportBlocked = computed(
  () => pendingCsvImports.value === null,
);
const csvImportOpen = ref(false);
const csvContextLoading = ref(false);
const csvContextError = ref('');
const csvRecoveryBusy = ref(false);
const csvSuccessMessage = ref('');
const csvFormContext = ref<LeadFormContext | null>(null);
const csvContextKey = ref('');
let csvContextEpoch = 0;
let csvContextRequest: AbortController | undefined;
let csvRecoveryRequest: AbortController | undefined;
let pageMounted = true;
const batchActive = ref(false);
const batchFreshLeads = ref<Lead[]>([]);
const batchLoading = ref(false);
const batchError = ref('');
const selectedLeads = computed(() =>
  selectedIds.value
    .map((id) => items.value.find((lead) => lead.id === id))
    .filter((lead): lead is Lead => !!lead),
);
const activeTitle = ref('线索下一步');
function actionTitle(lead: Lead): string | null {
  switch (lead.status) {
    case 'WAITING_PUSH':
      return '推送给客户审核';
    case 'WAITING_EVIDENCE_DECISION':
      return '确认取证安排';
    case 'ARCHIVED':
      return lead.reviewDecision?.result === 'NO_INFRINGEMENT'
        ? '申请撤回归档'
        : null;
    default:
      return null;
  }
}
function openWorkflow(lead: Lead) {
  if (
    noEvidenceLocked.value ||
    pendingPush.value ||
    pendingStorageUnavailable.value ||
    pendingBatchBlocked.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    activeLeadId.value ||
    csvImportOpen.value ||
    csvContextLoading.value
  )
    return;
  activeTitle.value = actionTitle(lead) ?? '线索下一步';
  activeLeadId.value = lead.id;
}
function savePendingPush(): void {
  pendingPushes.value = readPendingLeadCommands();
}
function reopenPendingWorkflow(): void {
  savePendingPush();
  if (
    noEvidenceLocked.value ||
    !pendingPush.value ||
    activeLeadId.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    csvImportOpen.value ||
    csvContextLoading.value
  )
    return;
  activeTitle.value = '核对未确认的线索请求';
  activeLeadId.value = pendingPush.value.leadId;
}
function handlePushSucceeded(attempt: FrozenLeadPush): void {
  if (
    identity.value !== attempt.identity ||
    activeLeadId.value !== attempt.leadId
  )
    return;
  const pending = readPendingLeadCommands()?.[attempt.identity];
  if (pending && !sameLeadAttempt(pending, attempt)) return;
  notifyWorkflowChanged();
  activeLeadId.value = null;
  savePendingPush();
  void load();
}
function toggleSelected(lead: Lead, checked: boolean) {
  if (
    noEvidenceLocked.value ||
    batchActive.value ||
    pendingBatch.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    csvImportOpen.value ||
    csvContextLoading.value
  )
    return;
  selectedIds.value = checked
    ? [...selectedIds.value, lead.id]
    : selectedIds.value.filter((id) => id !== lead.id);
}
function persistBatch(
  attempt: FrozenLeadBatchPush | null,
  settled: FrozenLeadBatchPush,
  contextIdentity: string,
  contextGeneration: string,
) {
  if (
    contextIdentity !== batchIdentity.value ||
    contextGeneration !== authorizationGeneration.value
  )
    return;
  const entries = readPendingLeadBatchPush();
  if (entries === null || settled.identity !== contextIdentity) return;
  if (attempt) {
    const current = entries[contextIdentity];
    if (current && !sameLeadBatchPush(current, settled)) {
      pendingBatches.value = entries;
      return;
    }
    entries[contextIdentity] = attempt;
  } else {
    const current = entries[contextIdentity];
    const local = pendingBatches.value?.[contextIdentity];
    if (current && !sameLeadBatchPush(current, settled)) {
      pendingBatches.value = entries;
      return;
    }
    if (!current && local && !sameLeadBatchPush(local, settled)) return;
    if (current) delete entries[contextIdentity];
    if (savePendingLeadBatchPush(entries)) pendingBatches.value = entries;
    else if (!current && local && sameLeadBatchPush(local, settled)) {
      const next = { ...pendingBatches.value };
      delete next[contextIdentity];
      pendingBatches.value = next;
    }
    return;
  }
  if (savePendingLeadBatchPush(entries)) pendingBatches.value = entries;
}
function finishBatch(
  attempt: FrozenLeadBatchPush,
  contextIdentity: string,
  generation: string,
) {
  if (
    batchIdentity.value !== attempt.identity ||
    contextIdentity !== attempt.identity ||
    authorizationGeneration.value !== generation ||
    !batchActive.value
  )
    return;
  const entries = readPendingLeadBatchPush();
  if (entries === null) return;
  const pending = entries[attempt.identity];
  if (pending && !sameLeadBatchPush(pending, attempt)) return;
  batchActive.value = false;
  selectedIds.value = [];
  notifyWorkflowChanged();
  void load();
}
async function refreshBatchSnapshot(
  requested: readonly { leadId: string; expectedVersion?: number }[],
  recovering = false,
) {
  if (noEvidenceLocked.value) return;
  if (!requested.length || requested.length > 20) return;
  batchRequest?.abort();
  const controller = new AbortController();
  batchRequest = controller;
  const scopeIdentity = identity.value;
  const scopeGeneration = authorizationGeneration.value;
  batchLoading.value = true;
  batchError.value = '';
  batchActive.value = false;
  batchFreshLeads.value = [];
  try {
    const fresh = await Promise.all(
      requested.map(({ leadId }) =>
        getLead(leadId, { signal: controller.signal }),
      ),
    );
    if (
      controller.signal.aborted ||
      batchRequest !== controller ||
      scopeIdentity !== identity.value ||
      scopeGeneration !== authorizationGeneration.value
    )
      return;
    const departmentId = auth.session?.department?.id;
    if (
      fresh.some(
        (lead, index) =>
          lead.id.toLowerCase() !== requested[index]!.leadId.toLowerCase() ||
          lead.departmentId !== departmentId ||
          (!recovering &&
            (lead.status !== 'WAITING_PUSH' || !lead.capabilities.push)),
      )
    ) {
      batchError.value = '所选线索当前不可用或无推送权限，原请求已保留。';
      return;
    }
    batchFreshLeads.value = fresh;
    batchActive.value = true;
  } catch {
    if (
      !controller.signal.aborted &&
      batchRequest === controller &&
      scopeIdentity === identity.value &&
      scopeGeneration === authorizationGeneration.value
    )
      batchError.value = '无法读取当前线索和权限，批量请求未发送。';
  } finally {
    if (
      batchRequest === controller &&
      scopeIdentity === identity.value &&
      scopeGeneration === authorizationGeneration.value
    ) {
      batchLoading.value = false;
      batchRequest = undefined;
    }
  }
}
function openBatchPush() {
  if (
    noEvidenceLocked.value ||
    pendingBatch.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    csvImportOpen.value ||
    csvContextLoading.value
  )
    return;
  void refreshBatchSnapshot(
    selectedLeads.value.map(({ id }) => ({ leadId: id })),
  );
}
function refreshPendingCsvImports(): void {
  pendingCsvImports.value = readPendingLeadCsvImports();
}
function openCsvImport(): void {
  if (
    noEvidenceLocked.value ||
    state.value !== 'ready' ||
    !canCreate.value ||
    auth.session?.principalType !== 'INTERNAL' ||
    pendingPush.value ||
    pendingStorageUnavailable.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    pendingBatch.value ||
    pendingBatchBlocked.value ||
    activeLeadId.value ||
    batchActive.value ||
    batchLoading.value ||
    csvContextLoading.value
  )
    return;
  csvContextRequest?.abort();
  const controller = new AbortController();
  csvContextRequest = controller;
  const actorIdentity = batchIdentity.value;
  const generation = authorizationGeneration.value;
  const epoch = ++csvContextEpoch;
  csvContextLoading.value = true;
  csvContextError.value = '';
  csvSuccessMessage.value = '';
  void getLeadFormContext({ signal: controller.signal })
    .then((context) => {
      if (
        !pageMounted ||
        controller.signal.aborted ||
        csvContextRequest !== controller ||
        actorIdentity !== batchIdentity.value ||
        generation !== authorizationGeneration.value ||
        epoch !== csvContextEpoch
      )
        return;
      csvFormContext.value = context;
      csvContextKey.value = `${actorIdentity}:${generation}:${epoch}`;
      csvImportOpen.value = true;
    })
    .catch(() => {
      if (
        !controller.signal.aborted &&
        actorIdentity === batchIdentity.value &&
        generation === authorizationGeneration.value
      )
        csvContextError.value = '无法读取当前线索字典和权限，请重试。';
    })
    .finally(() => {
      if (csvContextRequest === controller) {
        csvContextRequest = undefined;
        csvContextLoading.value = false;
      }
    });
}
function closeCsvImport(): void {
  csvContextRequest?.abort();
  csvContextRequest = undefined;
  csvContextLoading.value = false;
  csvContextEpoch += 1;
  csvImportOpen.value = false;
  csvFormContext.value = null;
  csvContextKey.value = '';
}
function safeCsvNoWrite(cause: unknown): cause is ApiError {
  return (
    cause instanceof ApiError &&
    ((cause.status === 400 && cause.code === 'VALIDATION_ERROR') ||
      (cause.status === 409 && cause.code === 'CSV_IMPORT_REJECTED'))
  );
}
function isCurrentCsvSubmission(
  attempt: LeadCsvImportAttempt,
  context: LeadCsvImportSubmissionContext,
): boolean {
  return (
    pageMounted &&
    !context.signal.aborted &&
    csvImportOpen.value &&
    attempt.actorIdentity === batchIdentity.value &&
    context.contextKey === csvContextKey.value &&
    context.authorizationGeneration === authorizationGeneration.value
  );
}
function clearCsvAttempt(attempt: FrozenLeadCsvImport): boolean {
  if (!clearPendingLeadCsvImport(attempt)) return false;
  refreshPendingCsvImports();
  return true;
}
async function submitCsvAttempt(
  attempt: LeadCsvImportAttempt,
  context: LeadCsvImportSubmissionContext,
): Promise<LeadCsvImportSubmitOutcome> {
  if (
    !pageMounted ||
    context.signal.aborted ||
    !csvImportOpen.value ||
    attempt.actorIdentity !== batchIdentity.value ||
    context.contextKey !== csvContextKey.value ||
    context.authorizationGeneration !== authorizationGeneration.value ||
    pendingPush.value ||
    pendingStorageUnavailable.value ||
    pendingCsvImportBlocked.value ||
    pendingCsvImport.value ||
    pendingBatch.value ||
    batchActive.value
  )
    return {
      kind: 'rejected',
      message: '当前账号或页面状态已变化，请重新打开导入。',
    };
  const frozen: FrozenLeadCsvImport = Object.freeze({
    ...attempt,
    uncertain: true,
  });
  const entries = readPendingLeadCsvImports();
  if (entries === null || entries[attempt.actorIdentity]) {
    pendingCsvImports.value = entries;
    return { kind: 'rejected', message: '无法安全保存未决请求，未发送导入。' };
  }
  entries[attempt.actorIdentity] = frozen;
  if (!savePendingLeadCsvImports(entries)) {
    refreshPendingCsvImports();
    return { kind: 'rejected', message: '无法保存未决请求，未发送导入。' };
  }
  pendingCsvImports.value = entries;
  try {
    const result = await importLeadCsvBatch(
      attempt.items,
      attempt.idempotencyKey,
      {
        signal: context.signal,
      },
    );
    if (!isCurrentCsvSubmission(attempt, context))
      return { kind: 'unknown', message: '请求结果待核对；请使用原请求恢复。' };
    return { kind: 'created', result };
  } catch (cause) {
    if (safeCsvNoWrite(cause)) {
      if (!isCurrentCsvSubmission(attempt, context))
        return {
          kind: 'unknown',
          message: '旧请求结果已过期，原请求已保留待核对。',
        };
      if (!clearCsvAttempt(frozen))
        return {
          kind: 'unknown',
          message: '请求未创建，但本地请求状态无法更新。',
        };
      return { kind: 'rejected', message: cause.message };
    }
    return {
      kind: 'unknown',
      message:
        cause instanceof Error
          ? cause.message
          : '请求结果待核对，请保留原请求。',
    };
  }
}
function handleCsvImported(
  attempt: LeadCsvImportAttempt,
  result: {
    items: Array<{ rowNumber: number; lead: LeadBusinessResult }>;
  },
  context: { contextKey: string; authorizationGeneration: string },
): void {
  if (
    attempt.actorIdentity !== batchIdentity.value ||
    !csvImportOpen.value ||
    context.contextKey !== csvContextKey.value ||
    context.authorizationGeneration !== authorizationGeneration.value
  )
    return;
  const current = readPendingLeadCsvImports()?.[attempt.actorIdentity];
  if (!current || !sameLeadCsvImport(current, { ...attempt, uncertain: true }))
    return;
  csvSuccessMessage.value = `已导入 ${result.items.length} 条线索。`;
  notifyWorkflowChanged();
  if (!clearCsvAttempt(current))
    csvContextError.value = '导入已创建，但本地未决记录无法清除。';
  closeCsvImport();
  void load();
}
async function recoverCsvImport(): Promise<void> {
  if (noEvidenceLocked.value || noEvidenceOpen.value) return;
  const attempt = pendingCsvImport.value;
  if (!attempt || csvRecoveryBusy.value) return;
  const stored = readPendingLeadCsvImports()?.[batchIdentity.value];
  if (!stored || !sameLeadCsvImport(stored, attempt)) {
    refreshPendingCsvImports();
    return;
  }
  const controller = new AbortController();
  csvRecoveryRequest = controller;
  const actorIdentity = batchIdentity.value;
  const generation = authorizationGeneration.value;
  const contextEpoch = csvContextEpoch;
  csvRecoveryBusy.value = true;
  try {
    const result = await importLeadCsvBatch(
      attempt.items,
      attempt.idempotencyKey,
      { signal: controller.signal },
    );
    if (
      controller.signal.aborted ||
      actorIdentity !== batchIdentity.value ||
      generation !== authorizationGeneration.value ||
      contextEpoch !== csvContextEpoch
    )
      return;
    csvSuccessMessage.value = `已导入 ${result.items.length} 条线索。`;
    if (clearCsvAttempt(attempt)) void load();
    else csvContextError.value = '导入已创建，但本地未决记录无法清除。';
  } catch (cause) {
    if (
      !controller.signal.aborted &&
      actorIdentity === batchIdentity.value &&
      generation === authorizationGeneration.value &&
      contextEpoch === csvContextEpoch
    ) {
      const message =
        cause instanceof Error ? cause.message : '恢复请求结果仍未确认。';
      csvContextError.value = `${message} 原请求及请求键已保留。`;
    }
  } finally {
    if (csvRecoveryRequest === controller) {
      csvRecoveryRequest = undefined;
      csvRecoveryBusy.value = false;
    }
  }
}
function openNoEvidenceBatch(recovering = false): void {
  noEvidenceBatches.value = readPendingLeadNoEvidenceBatches();
  pendingBatches.value = readPendingLeadBatchPush();
  refreshPendingCsvImports();
  savePendingPush();
  if (
    auth.session?.principalType !== 'INTERNAL' ||
    noEvidenceOpen.value ||
    noEvidenceBatches.value === null ||
    activeLeadId.value ||
    singleBlocksNoEvidence.value ||
    batchActive.value ||
    batchLoading.value ||
    pendingBatch.value ||
    pendingBatchBlocked.value ||
    csvImportOpen.value ||
    csvContextLoading.value ||
    csvRecoveryBusy.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    (recovering
      ? !pendingNoEvidence.value
      : !!pendingNoEvidence.value ||
        !selectedLeads.value.length ||
        state.value !== 'ready')
  )
    return;
  noEvidenceLeads.value = recovering ? [] : [...selectedLeads.value];
  noEvidenceOpen.value = true;
}
function recordNoEvidencePending(
  attempt: FrozenLeadNoEvidenceBatch,
  context: string,
): void {
  if (
    attempt.identity !== batchIdentity.value ||
    context !== noEvidenceContext.value
  )
    return;
  noEvidenceBatches.value = readPendingLeadNoEvidenceBatches();
}
function canSubmitNoEvidenceBatch(actor: string, context: string): boolean {
  const single = readPendingLeadCommands();
  const batches = readPendingLeadBatchPush();
  const csv = readPendingLeadCsvImports();
  return (
    pageMounted &&
    noEvidenceOpen.value &&
    actor === batchIdentity.value &&
    context === noEvidenceContext.value &&
    auth.session?.principalType === 'INTERNAL' &&
    !activeLeadId.value &&
    !batchActive.value &&
    !batchLoading.value &&
    !csvImportOpen.value &&
    !csvContextLoading.value &&
    !csvRecoveryBusy.value &&
    single !== null &&
    !Object.keys(single).some(
      (key) => key === actor || key.startsWith(`${actor}:`),
    ) &&
    batches !== null &&
    !batches[actor] &&
    csv !== null &&
    !csv[actor]
  );
}
function finishNoEvidenceBatch(
  attempt: FrozenLeadNoEvidenceBatch,
  context: string,
): void {
  if (
    !noEvidenceOpen.value ||
    attempt.identity !== batchIdentity.value ||
    context !== noEvidenceContext.value
  )
    return;
  noEvidenceBatches.value = readPendingLeadNoEvidenceBatches();
  if (
    noEvidenceBatches.value === null ||
    noEvidenceBatches.value[attempt.identity]
  )
    return;
  noEvidenceOpen.value = false;
  noEvidenceLeads.value = [];
  selectedIds.value = [];
  notifyWorkflowChanged();
  void load();
}
watch(
  noEvidenceContext,
  () => {
    noEvidenceOpen.value = false;
    noEvidenceLeads.value = [];
    noEvidenceBatches.value = readPendingLeadNoEvidenceBatches();
  },
  { flush: 'sync' },
);
const selectedStatus = computed<LeadStatus | undefined>(() => {
  const value = route.query.status;
  return typeof value === 'string' &&
    leadStatusCards.some((card) => card.status === value)
    ? (value as LeadStatus)
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
const queryDraft = ref('');
const queryFormError = ref('');
const queryError = computed(() => {
  const q = route.query.q;
  return q !== undefined &&
    (typeof q !== 'string' || Array.from(q.trim()).length > 200)
    ? '线索关键词无效，最多200字。'
    : '';
});
const queryBlocked = computed(() =>
  Boolean(
    activeLeadId.value ||
    batchActive.value ||
    batchLoading.value ||
    noEvidenceOpen.value ||
    noEvidenceLocked.value ||
    csvImportOpen.value ||
    csvContextLoading.value ||
    csvRecoveryBusy.value ||
    pendingCsvImport.value ||
    pendingCsvImportBlocked.value ||
    pendingBatch.value ||
    pendingBatchBlocked.value ||
    pendingPush.value ||
    pendingStorageUnavailable.value,
  ),
);
watch(
  () => route.query.q,
  () => {
    queryDraft.value = typeof route.query.q === 'string' ? route.query.q : '';
    queryFormError.value = '';
  },
  { immediate: true, flush: 'sync' },
);
async function applyQuery(clear = false): Promise<void> {
  if (queryBlocked.value) return;
  const q = clear ? '' : queryDraft.value.trim();
  if (Array.from(q).length > 200) {
    queryFormError.value = '线索关键词最多200字。';
    return;
  }
  queryFormError.value = '';
  const query = { ...route.query };
  query.page = '1';
  delete query.q;
  if (q) query.q = q;
  await router.push({ query });
}

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  selectedIds.value = [];
  items.value = [];
  total.value = 0;
  canCreate.value = false;
  const scope = identity.value;
  const session = auth.session;
  const page = requestedPage.value;
  const status = selectedStatus.value;
  if (queryError.value) {
    state.value = 'failed';
    return;
  }
  try {
    const args = [
      page,
      20,
      { signal: controller.signal },
      status,
      'LIBRARY',
    ] as const;
    const q = typeof route.query.q === 'string' ? route.query.q.trim() : '';
    const result = await (q ? listLeads(...args, q) : listLeads(...args));
    if (
      controller.signal.aborted ||
      scope !== identity.value ||
      session !== auth.session ||
      request !== controller
    )
      return;
    const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (page > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
    canCreate.value = result.capabilities.create;
    state.value = 'ready';
  } catch {
    if (
      !controller.signal.aborted &&
      scope === identity.value &&
      session === auth.session &&
      request === controller
    )
      state.value = 'failed';
  }
}
async function goToPage(page: number): Promise<void> {
  if (page < 1 || page > totalPages.value || page === requestedPage.value)
    return;
  await router.push({ query: { ...route.query, page: String(page) } });
}
function formatTime(value: string): string {
  return new Date(value).toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Shanghai',
  });
}
function safeProductUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new globalThis.URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
watch(
  () => [
    route.query.page,
    route.query.status,
    route.query.q,
    auth.session,
    identity.value,
    authorizationGeneration.value,
  ],
  () => void load(),
  { immediate: true, flush: 'sync' },
);
watch(
  () => [identity.value, authorizationGeneration.value],
  ([value]) => {
    csvContextRequest?.abort();
    csvContextRequest = undefined;
    csvRecoveryRequest?.abort();
    csvRecoveryRequest = undefined;
    csvRecoveryBusy.value = false;
    csvContextEpoch += 1;
    csvImportOpen.value = false;
    csvContextLoading.value = false;
    csvFormContext.value = null;
    csvContextKey.value = '';
    refreshPendingCsvImports();
    savePendingPush();
    activeLeadId.value = pendingPushes.value?.[String(value)]?.leadId ?? null;
    batchRequest?.abort();
    batchRequest = undefined;
    batchLoading.value = false;
    batchActive.value = false;
    batchFreshLeads.value = [];
    const attempt = pendingBatches.value?.[batchIdentity.value];
    if (attempt)
      void refreshBatchSnapshot(
        attempt.items.map(({ leadId }) => ({ leadId })),
        true,
      );
  },
  { flush: 'sync', immediate: true },
);
watch(
  () => route.fullPath,
  () => {
    csvSuccessMessage.value = '';
    if (csvContextRequest || csvContextLoading.value || csvImportOpen.value)
      closeCsvImport();
    else csvContextEpoch += 1;
    csvRecoveryRequest?.abort();
    csvRecoveryRequest = undefined;
    csvRecoveryBusy.value = false;
    activeLeadId.value = pendingPush.value?.leadId ?? null;
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  pageMounted = false;
  request?.abort();
  batchRequest?.abort();
  csvContextRequest?.abort();
  csvRecoveryRequest?.abort();
});
</script>

<template>
  <div class="page-view business-list-page">
    <main
      :inert="
        !!activeLeadId ||
        batchActive ||
        csvImportOpen ||
        csvContextLoading ||
        noEvidenceOpen
      "
    >
      <div class="page-head business-list-toolbar">
        <div>
          <h1>线索库</h1>
          <p>记录当前账号有权查看、尚未移交公证的线索。</p>
        </div>
        <div v-if="state === 'ready' && canCreate" class="lead-create-actions">
          <RouterLink to="/leads/new" data-test="create-lead"
            ><ElButton type="primary">新建线索</ElButton></RouterLink
          >
          <ElButton
            data-test="open-csv-import"
            :disabled="
              noEvidenceLocked ||
              auth.session?.principalType !== 'INTERNAL' ||
              !!pendingCsvImport ||
              pendingCsvImportBlocked ||
              !!pendingBatch ||
              pendingBatchBlocked ||
              !!pendingPush ||
              pendingStorageUnavailable ||
              !!pendingCsvImport ||
              pendingCsvImportBlocked ||
              !!activeLeadId ||
              batchActive ||
              batchLoading ||
              csvContextLoading
            "
            @click="openCsvImport"
            >{{ csvContextLoading ? '读取导入配置…' : '导入 CSV' }}</ElButton
          >
        </div>
      </div>
      <form
        aria-label="线索关键词查询"
        class="business-list-toolbar"
        @submit.prevent="applyQuery()"
      >
        <label
          >关键词<input
            v-model="queryDraft"
            data-test="lead-query"
            class="text-input"
            placeholder="编号／店铺／商品名称"
            :disabled="queryBlocked"
        /></label>
        <ElButton
          native-type="submit"
          data-test="lead-search"
          :disabled="queryBlocked"
          >查询</ElButton
        >
        <ElButton
          native-type="button"
          data-test="lead-clear"
          :disabled="queryBlocked"
          @click="applyQuery(true)"
          >清除关键词</ElButton
        >
      </form>
      <p v-if="queryFormError || queryError" role="alert">
        {{ queryFormError || queryError }}
      </p>
      <section class="demo-card" aria-live="polite">
        <div
          v-if="state === 'ready' && selectedLeads.length"
          class="lead-batch-toolbar"
        >
          <span>{{ selectedLeads.length }} 条已选</span>
          <ElButton
            data-test="open-batch-push"
            :disabled="
              noEvidenceLocked ||
              !!pendingPush ||
              pendingBatchBlocked ||
              !!pendingCsvImport ||
              pendingCsvImportBlocked ||
              batchLoading ||
              csvImportOpen ||
              csvContextLoading
            "
            @click="openBatchPush"
            >批量推送</ElButton
          >
          <ElButton
            data-test="open-no-evidence-batch"
            :disabled="
              noEvidenceLocked ||
              singleBlocksNoEvidence ||
              !!activeLeadId ||
              !!pendingBatch ||
              pendingBatchBlocked ||
              batchActive ||
              batchLoading ||
              !!pendingCsvImport ||
              pendingCsvImportBlocked ||
              csvImportOpen ||
              csvContextLoading ||
              csvRecoveryBusy ||
              auth.session?.principalType !== 'INTERNAL'
            "
            @click="openNoEvidenceBatch()"
            >批量不取证归档</ElButton
          >
        </div>
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取线索</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>线索列表暂时无法加载</h2>
          <p>错误不会被当作空列表，可以直接重试。</p>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2 v-if="selectedStatus">
            「{{ leadStatusLabels[selectedStatus] }}」暂无记录
          </h2>
          <h2 v-else>还没有线索记录</h2>
          <p v-if="selectedStatus">可在侧栏切换其他状态查看线索。</p>
          <p v-else>有创建权限时，可从右上角新建待推送线索。</p>
        </div>
        <div
          v-else
          class="demo-table-wrap business-list-scroll"
          tabindex="0"
          role="region"
          aria-label="线索列表，可横向滚动"
        >
          <table class="demo-table business-list-table lead-list-table">
            <colgroup>
              <col style="width: 52px" />
              <col style="width: 200px" />
              <col style="width: 140px" />
              <col style="width: 100px" />
              <col style="width: 160px" />
              <col style="width: 160px" />
              <col style="width: 220px" />
              <col style="width: 100px" />
              <col style="width: 120px" />
              <col style="width: 100px" />
              <col style="width: 140px" />
              <col style="width: 120px" />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="选择线索">选择</th>
                <th>操作／线索编号</th>
                <th>案件进展</th>
                <th>平台</th>
                <th>店铺名</th>
                <th>店铺ID</th>
                <th>商品链接</th>
                <th class="num">销量</th>
                <th class="num">单价（元）</th>
                <th class="num">评论数</th>
                <th class="num">销售总额（估算／元）</th>
                <th>线索发现日期</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="{ lead, summary, products } in displayItems"
                :key="lead.id"
                data-test="lead-row"
              >
                <td>
                  <input
                    v-if="
                      lead.status === 'WAITING_PUSH' ||
                      lead.status === 'WAITING_EVIDENCE_DECISION'
                    "
                    type="checkbox"
                    :aria-label="`选择 ${lead.businessNo}`"
                    :checked="selectedIds.includes(lead.id)"
                    :disabled="
                      noEvidenceLocked ||
                      batchActive ||
                      pendingBatchBlocked ||
                      !!pendingBatch ||
                      !!pendingPush ||
                      !!pendingCsvImport ||
                      pendingCsvImportBlocked ||
                      csvImportOpen ||
                      csvContextLoading
                    "
                    @change="
                      toggleSelected(
                        lead,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </td>
                <td class="business-list-cell--nowrap">
                  <ElButton
                    v-if="actionTitle(lead)"
                    type="primary"
                    data-test="lead-quick-action"
                    :disabled="
                      noEvidenceLocked ||
                      !!pendingPush ||
                      pendingStorageUnavailable ||
                      pendingBatchBlocked ||
                      !!pendingCsvImport ||
                      pendingCsvImportBlocked ||
                      csvImportOpen ||
                      csvContextLoading
                    "
                    @click="openWorkflow(lead)"
                    >{{ actionTitle(lead) }}</ElButton
                  >
                  <RouterLink
                    :to="`/leads/${lead.id}`"
                    :aria-label="`查看线索 ${lead.businessNo} 详情`"
                  >
                    详情
                  </RouterLink>
                  <div class="mono">{{ lead.businessNo }}</div>
                </td>
                <td class="business-list-cell--nowrap">
                  <span class="pill">{{ leadStatusLabels[lead.status] }}</span>
                </td>
                <td class="business-list-cell--nowrap">
                  {{ labelLeadPlatform(lead.platform) }}
                </td>
                <td class="business-list-cell--text">
                  <details>
                    <summary>{{ lead.shopName }}</summary>
                    <p>客户：{{ lead.displayNames.customerName }}</p>
                    <p>权利主体：{{ lead.displayNames.rightsHolderName }}</p>
                    <p>负责人：{{ lead.displayNames.responsibleUserName }}</p>
                  </details>
                </td>
                <td class="business-list-cell--text mono">
                  {{ lead.shopExternalId || '未登记' }}
                </td>
                <td class="business-list-cell--text">
                  <details v-if="products.length">
                    <summary>
                      {{ products.length }} 件商品 · 查看名称／链接
                    </summary>
                    <ul class="lead-list-products">
                      <li v-for="product in products" :key="product.id">
                        <span>{{ product.title || '未登记商品名称' }}</span>
                        <a
                          v-if="safeProductUrl(product.url)"
                          :href="safeProductUrl(product.url)!"
                          target="_blank"
                          rel="noopener noreferrer"
                          >{{ product.url }}</a
                        >
                        <span v-else>无有效商品链接</span>
                      </li>
                    </ul>
                  </details>
                  <span v-else>未登记商品</span>
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-quantity-total"
                >
                  {{ summary.quantityTotal }}
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-first-unit-price"
                >
                  {{ summary.firstUnitPrice ?? '未登记' }}
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-comment-total"
                >
                  {{ summary.commentTotal }}
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-estimated-amount"
                >
                  {{ summary.estimatedAmount }}
                </td>
                <td class="mono business-list-cell--nowrap">
                  {{ formatTime(lead.foundAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready'"
          class="lead-pagination business-list-footer"
          aria-label="线索列表分页"
        >
          <ElButton
            data-test="previous-page"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
            >上一页</ElButton
          >
          <span
            >共 {{ total }} 条 · 第 {{ currentPage }} /
            {{ totalPages }} 页</span
          >
          <ElButton
            data-test="next-page"
            :disabled="currentPage >= totalPages"
            @click="goToPage(currentPage + 1)"
            >下一页</ElButton
          >
        </nav>
      </section>
      <p
        v-if="
          pendingStorageUnavailable ||
          pendingBatchBlocked ||
          pendingCsvImportBlocked
        "
        role="alert"
      >
        无法读取未决请求记录，流程办理暂不可用。
      </p>
      <p v-if="csvContextError" role="alert" data-test="csv-context-error">
        {{ csvContextError }}
      </p>
      <p v-if="csvSuccessMessage" role="status" data-test="csv-success">
        {{ csvSuccessMessage }}
      </p>
      <p v-if="batchError" role="alert" data-test="batch-refresh-error">
        {{ batchError }}
      </p>
      <p v-if="batchLoading" data-test="batch-refresh-loading">
        正在重新核对所选线索和推送权限…
      </p>
      <p v-if="pendingPush && !activeLeadId" role="alert">
        有一项线索请求尚未确认，请先核对原请求。
        <ElButton
          data-test="reopen-pending-lead"
          :disabled="
            noEvidenceLocked ||
            pendingStorageUnavailable ||
            !!pendingCsvImport ||
            pendingCsvImportBlocked ||
            csvImportOpen ||
            csvContextLoading
          "
          @click="reopenPendingWorkflow"
          >核对未确认请求</ElButton
        >
      </p>
    </main>
    <div
      v-if="pendingCsvImport && !csvImportOpen"
      role="alert"
      data-test="pending-csv-import"
    >
      <p>
        有一批 CSV
        导入请求尚未确认。恢复会重放同一组内容和请求键，请勿重新上传文件。
      </p>
      <ElButton
        data-test="recover-csv-import"
        :disabled="csvRecoveryBusy || noEvidenceLocked"
        @click="recoverCsvImport"
        >{{ csvRecoveryBusy ? '正在核对…' : '核对未确认导入' }}</ElButton
      >
    </div>
    <p v-if="noEvidenceBatches === null" role="alert">
      无法读取批量不取证归档原请求，请先修复本机记录，其他流程办理暂不可用。
    </p>
    <div
      v-if="pendingNoEvidence && !noEvidenceOpen"
      role="alert"
      data-test="pending-no-evidence-batch"
    >
      <p>
        有一批不取证归档结果待核对。原始原因、顺序和请求键已保留，请先核对原批次。
      </p>
      <ElButton
        data-test="recover-no-evidence-batch"
        :disabled="
          singleBlocksNoEvidence ||
          !!pendingBatch ||
          pendingBatchBlocked ||
          !!pendingCsvImport ||
          pendingCsvImportBlocked ||
          !!activeLeadId ||
          batchActive ||
          batchLoading ||
          csvImportOpen ||
          csvContextLoading ||
          csvRecoveryBusy
        "
        @click="openNoEvidenceBatch(true)"
        >核对原不取证归档批次</ElButton
      >
    </div>
    <LeadNoEvidenceBatchPanel
      v-if="noEvidenceOpen"
      :key="noEvidenceContext"
      :leads="noEvidenceLeads"
      :identity="batchIdentity"
      :context-generation="noEvidenceContext"
      :pending="pendingNoEvidence"
      :before-submit="canSubmitNoEvidenceBatch"
      @pending="recordNoEvidencePending"
      @succeeded="finishNoEvidenceBatch"
      @close="noEvidenceOpen = false"
    />
    <LeadQuickActionsPanel
      v-if="activeLeadId"
      :lead-id="activeLeadId"
      :identity="identity"
      :title="activeTitle"
      :pending-push="pendingPush"
      @close="activeLeadId = null"
      @pending="savePendingPush"
      @succeeded="handlePushSucceeded"
    />
    <LeadBatchPushPanel
      v-if="batchActive"
      :key="`${batchIdentity}:${authorizationGeneration}`"
      :leads="batchFreshLeads"
      :identity="batchIdentity"
      :context-generation="authorizationGeneration"
      :pending="pendingBatch"
      @pending="persistBatch"
      @succeeded="finishBatch"
      @close="batchActive = false"
    />
    <LeadCsvImportPanel
      v-if="csvImportOpen && csvFormContext"
      :key="csvContextKey"
      :open="csvImportOpen"
      :context-key="csvContextKey"
      :form-context="csvFormContext"
      :operator-display-name="auth.session?.user.displayName ?? ''"
      :actor-identity="batchIdentity"
      :authorization-generation="authorizationGeneration"
      :submit-attempt="submitCsvAttempt"
      @close-request="closeCsvImport"
      @imported="handleCsvImported"
    />
  </div>
</template>

<style scoped>
.lead-list-table {
  min-width: 1560px;
  table-layout: fixed;
}
.lead-list-table details {
  min-width: 0;
}
.lead-list-table summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}
.lead-list-table details:not([open]) summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.lead-list-table details[open] {
  white-space: normal;
  overflow-wrap: anywhere;
}
.lead-list-products {
  margin: 8px 0;
  padding-left: 16px;
}
.lead-list-products a {
  display: block;
  overflow-wrap: anywhere;
}
</style>
