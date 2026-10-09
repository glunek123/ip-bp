<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCustomer,
  deleteCustomerDraft,
  type CustomerDetail,
  type CustomerSummary,
} from '../../api/customers';
import CustomerRightsHolderPanel from './CustomerRightsHolderPanel.vue';
import CustomerAdmissionPanel from './CustomerAdmissionPanel.vue';
import CustomerAccountPanel from './CustomerAccountPanel.vue';
import CustomerRightAssetsPanel from './CustomerRightAssetsPanel.vue';
import type { RightAssetRecoverySnapshot } from './customer-right-assets-recovery';
import CustomerCooperationPanel from './CustomerCooperationPanel.vue';
import CustomerContactsPanel from './CustomerContactsPanel.vue';
import CustomerAgreementPanel from './CustomerAgreementPanel.vue';
import CustomerInvoiceProfilePanel from './CustomerInvoiceProfilePanel.vue';
import CustomerSettlementsPanel from './CustomerSettlementsPanel.vue';
import { labelCustomerType, labelIdentityType } from './customer-labels';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';
import {
  clearPendingCustomerDraftCommand,
  readPendingCustomerDraftCommand,
  savePendingCustomerDraftCommand,
  type PendingCustomerDraftCommand,
} from './customer-lifecycle-pending';
import { hasPendingCustomerMaintenance } from './customer-maintenance-pending';
import { listPendingCustomerContacts } from './customer-contacts-pending';
import { readPendingSettlementCommand } from './customer-settlement-pending';
import { useCustomerSettlements } from './use-customer-settlements';
import {
  formatSettlementAmount,
  formatSettlementPercent,
  settlementPendingDisplay,
  settlementRecoveryBarWidth,
} from './customer-settlement-money';
import {
  hasPendingCustomerAgreementInvoice,
  readPendingCustomerAgreementUpload,
  readPendingCustomerDocumentCommand,
} from './customer-agreements-invoice-pending';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore(pinia);
const state = ref<'loading' | 'ready' | 'missing' | 'failed' | 'unavailable'>(
  'loading',
);
const customer = ref<CustomerDetail>();
const activeTab = ref<'basic' | 'assets' | 'settlements'>('basic');
const requests = new Set<AbortController>();
const deletionReason = ref('');
const deletePrompt = ref(false);
const deleteStatus = ref<'idle' | 'submitting' | 'unknown' | 'conflict'>(
  'idle',
);
const frozenDelete = ref<PendingCustomerDraftCommand>();
const maintenancePending = ref(false);
const contactsPending = ref(false);
const contactsProjectionStale = ref(false);
const currentProjectionStale = ref(false);
const assetPending = ref(false);
const assetRecoverySnapshot = ref<RightAssetRecoverySnapshot>();
const agreementState = ref({
  unknown: false,
  stale: false,
  uploadUnknown: false,
});
const invoiceState = ref({ unknown: false, stale: false });
const pendingStorageBlocked = ref(false);
const settlementUnknown = ref(false);
const settlementStale = ref(false);
const settlementDetailRefreshNeeded = ref(false);
const admissionRefreshFailed = ref(false);
let viewGeneration = 0;

const actor = computed(() => {
  const session = auth.session;
  if (session?.principalType !== 'INTERNAL' || !session.department) return null;
  return {
    userId: session.user.id,
    departmentId: session.department.id,
    authorizationRevision: session.authorizationRevision,
  };
});
const actorKey = computed(() =>
  actor.value
    ? `${actor.value.userId}:${actor.value.departmentId}:${auth.session?.authorizationRevision ?? 0}`
    : '',
);
const settlementCustomerId = computed(() => String(route.params.id));
const settlementCanRead = computed(
  () => customer.value?.capabilities.settlement.read ?? false,
);
const settlementOwner = useCustomerSettlements(
  settlementCustomerId,
  actorKey,
  settlementCanRead,
);
const settlementData = computed(() => settlementOwner.data.value);
const settlementKpis = computed(() => settlementOwner.kpis.value);
const settlementPending = computed(
  () => settlementUnknown.value || settlementStale.value,
);
const settlementPendingAmount = computed(() =>
  settlementPendingDisplay(settlementKpis.value?.pendingAmount ?? null),
);
const settlementRateLabel = computed(() => {
  const value = settlementKpis.value?.recoveryRate;
  return value === null || value === undefined
    ? '—'
    : formatSettlementPercent(value);
});
const settlementRateWidth = computed(() =>
  settlementRecoveryBarWidth(settlementKpis.value?.recoveryRate ?? null),
);
const settlementReceivedLabel = computed(() =>
  settlementKpis.value?.receivedUnknownCount ? '已知回款小计' : '累计回款',
);
const contactsWriteBlocked = computed(
  () => contactsPending.value || contactsProjectionStale.value,
);
const documentPending = computed(
  () =>
    pendingStorageBlocked.value ||
    agreementState.value.unknown ||
    agreementState.value.uploadUnknown ||
    agreementState.value.stale ||
    invoiceState.value.unknown ||
    invoiceState.value.stale,
);
const otherMaintenanceBlocked = computed(
  () =>
    !!frozenDelete.value ||
    maintenancePending.value ||
    contactsWriteBlocked.value ||
    currentProjectionStale.value ||
    assetPending.value ||
    documentPending.value,
);
const sharedWriteBlocked = computed(
  () => otherMaintenanceBlocked.value || settlementPending.value,
);
const agreementBlocked = computed(
  () =>
    !!frozenDelete.value ||
    maintenancePending.value ||
    contactsWriteBlocked.value ||
    currentProjectionStale.value ||
    assetPending.value ||
    pendingStorageBlocked.value ||
    settlementPending.value ||
    invoiceState.value.unknown ||
    invoiceState.value.stale,
);
const invoiceBlocked = computed(
  () =>
    !!frozenDelete.value ||
    maintenancePending.value ||
    contactsWriteBlocked.value ||
    currentProjectionStale.value ||
    assetPending.value ||
    pendingStorageBlocked.value ||
    settlementPending.value ||
    agreementState.value.unknown ||
    agreementState.value.uploadUnknown ||
    agreementState.value.stale,
);
const assetsBlocked = computed(
  () =>
    !!frozenDelete.value ||
    maintenancePending.value ||
    contactsWriteBlocked.value ||
    currentProjectionStale.value ||
    pendingStorageBlocked.value ||
    documentPending.value ||
    settlementPending.value,
);

function pendingIdentity(customerId: string) {
  const session = auth.session;
  if (!session?.department) return undefined;
  return {
    action: 'delete-draft' as const,
    userId: session.user.id,
    departmentId: session.department.id,
    customerId,
  };
}

function restorePending(customerId: string): void {
  const identity = pendingIdentity(customerId);
  frozenDelete.value =
    identity === undefined
      ? undefined
      : readPendingCustomerDraftCommand(identity);
  if (frozenDelete.value) {
    deletionReason.value = frozenDelete.value.reason ?? '';
    deleteStatus.value = 'unknown';
    deletePrompt.value = true;
  } else {
    deleteStatus.value = 'idle';
    deletePrompt.value = false;
  }
  maintenancePending.value = actor.value
    ? hasPendingCustomerMaintenance(actor.value, customerId)
    : false;
  try {
    contactsPending.value = actor.value
      ? listPendingCustomerContacts(actor.value, customerId).length > 0
      : false;
  } catch {
    contactsPending.value = true;
  }
  if (
    assetRecoverySnapshot.value &&
    (assetRecoverySnapshot.value.customerId !== customerId ||
      assetRecoverySnapshot.value.userId !== actor.value?.userId ||
      assetRecoverySnapshot.value.departmentId !== actor.value?.departmentId)
  )
    assetRecoverySnapshot.value = undefined;
  assetPending.value = !!assetRecoverySnapshot.value;
  agreementState.value = { unknown: false, stale: false, uploadUnknown: false };
  invoiceState.value = { unknown: false, stale: false };
  pendingStorageBlocked.value = false;
  settlementUnknown.value = false;
  settlementStale.value = false;
  const currentSession = auth.session;
  if (
    currentSession?.principalType === 'INTERNAL' &&
    currentSession.department
  ) {
    try {
      settlementUnknown.value = !!readPendingSettlementCommand({
        userId: currentSession.user.id,
        departmentId: currentSession.department.id,
        customerId,
        kind: 'settlement',
      });
    } catch {
      settlementUnknown.value = true;
    }
  }
  const session = auth.session;
  if (session?.principalType === 'INTERNAL' && session.department) {
    const base = {
      userId: session.user.id,
      departmentId: session.department.id,
      customerId,
    };
    const agreement = readPendingCustomerDocumentCommand({
      ...base,
      kind: 'agreement',
    });
    const invoice = readPendingCustomerDocumentCommand({
      ...base,
      kind: 'invoice',
    });
    const upload = readPendingCustomerAgreementUpload(base);
    agreementState.value = {
      ...agreementState.value,
      unknown: !!agreement,
      uploadUnknown: !!upload,
    };
    invoiceState.value = { ...invoiceState.value, unknown: !!invoice };
    pendingStorageBlocked.value =
      hasPendingCustomerAgreementInvoice(
        { userId: base.userId, departmentId: base.departmentId },
        customerId,
      ) &&
      !agreement &&
      !invoice &&
      !upload;
  }
}

function updateContactsPending(
  customerId: string,
  sourceActorKey: string,
  pending: boolean,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  contactsPending.value = pending;
}

function updateContactProjectionStale(
  customerId: string,
  sourceActorKey: string,
  stale: boolean,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  contactsProjectionStale.value = stale;
}

function acceptContactRefresh(
  customerId: string,
  sourceActorKey: string,
  latest: CustomerDetail,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    latest.id !== customerId ||
    customer.value?.id !== customerId
  )
    return;
  acceptRefreshedCustomer(latest);
}

function handleContactUnavailable(
  customerId: string,
  sourceActorKey: string,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  viewGeneration += 1;
  abortRequests();
  customer.value = undefined;
  currentProjectionStale.value = false;
  state.value = 'unavailable';
}

async function submitDelete(): Promise<void> {
  const current = customer.value;
  if (
    deleteStatus.value === 'submitting' ||
    maintenancePending.value ||
    contactsWriteBlocked.value ||
    currentProjectionStale.value ||
    assetPending.value ||
    documentPending.value ||
    settlementPending.value
  )
    return;
  if (!frozenDelete.value && (!current || !current.capabilities.deleteDraft))
    return;
  if (frozenDelete.value === undefined) {
    const identity = pendingIdentity(current!.id);
    if (!identity) return;
    const reason = deletionReason.value.trim();
    if (reason.length > 500) return;
    frozenDelete.value = {
      ...identity,
      expectedVersion: current!.version,
      ...(reason.length > 0 ? { reason } : {}),
      key: globalThis.crypto.randomUUID(),
    };
    savePendingCustomerDraftCommand(frozenDelete.value);
  }
  const command = frozenDelete.value;
  deleteStatus.value = 'submitting';
  try {
    await deleteCustomerDraft(
      command.customerId,
      {
        expectedVersion: command.expectedVersion,
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      },
      command.key,
    );
    clearPendingCustomerDraftCommand(command);
    frozenDelete.value = undefined;
    if (String(route.params.id) === command.customerId)
      await router.push('/customers');
  } catch (error) {
    if (String(route.params.id) !== command.customerId) return;
    deleteStatus.value =
      error instanceof ApiError &&
      error.status === 409 &&
      error.code !== 'CUSTOMER_CONTACT_BUSY'
        ? 'conflict'
        : 'unknown';
  }
}

async function refreshAfterDeleteConflict(): Promise<void> {
  if (frozenDelete.value) clearPendingCustomerDraftCommand(frozenDelete.value);
  frozenDelete.value = undefined;
  deleteStatus.value = 'idle';
  deletePrompt.value = false;
  await load();
}

function abortRequests(): void {
  for (const controller of requests) controller.abort();
  requests.clear();
}

function isCurrentRequest(
  customerId: string,
  controller: AbortController,
): boolean {
  return (
    !controller.signal.aborted &&
    String(route.params.id) === customerId &&
    customer.value?.id === customerId
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function actionLabel(action: string): string {
  if (action === 'customer.draft-created') return '创建客户草稿';
  if (action === 'customer.duplicate-name-overridden') return '同名核对后继续';
  if (action === 'customer.admitted') return '客户准入完成';
  if (action === 'customer.responsible-transferred') return '变更负责运营';
  if (action === 'customer.cooperation-pause') return '暂停合作';
  if (action === 'customer.cooperation-terminate') return '终止合作';
  if (action === 'customer.cooperation-resume') return '恢复合作';
  return '客户资料变更';
}

function profileLabel(status: CustomerSummary['profileStatus']): string {
  return status === 'admitted' ? '已准入' : '草稿';
}

async function load(): Promise<void> {
  const customerId = String(route.params.id);
  const recoveringUnavailable = state.value === 'unavailable';
  const generation = viewGeneration;
  const identityAtStart = actorKey.value;
  const controller = new AbortController();
  requests.add(controller);
  state.value = 'loading';
  try {
    const latest = await getCustomer(customerId, {
      signal: controller.signal,
    });
    if (
      !controller.signal.aborted &&
      generation === viewGeneration &&
      identityAtStart === actorKey.value &&
      String(route.params.id) === customerId
    ) {
      customer.value = latest;
      state.value = 'ready';
      currentProjectionStale.value = false;
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    if (
      generation !== viewGeneration ||
      identityAtStart !== actorKey.value ||
      String(route.params.id) !== customerId
    )
      return;
    state.value = recoveringUnavailable
      ? 'unavailable'
      : error instanceof ApiError && error.code === 'CUSTOMER_NOT_FOUND'
        ? 'missing'
        : isCustomerNotFound(error)
          ? 'missing'
          : 'failed';
  } finally {
    requests.delete(controller);
  }
}

function updateCustomerVersion(customerId: string, version: number): void {
  if (
    customer.value?.id !== customerId ||
    String(route.params.id) !== customerId
  ) {
    return;
  }
  if (customer.value) customer.value = { ...customer.value, version };
}

function updateDocumentState(
  kind: 'agreement' | 'invoice',
  customerId: string,
  sourceActorKey: string,
  field: 'unknown' | 'stale' | 'uploadUnknown',
  value: boolean,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  if (kind === 'agreement' && field in agreementState.value)
    agreementState.value = { ...agreementState.value, [field]: value };
  if (kind === 'invoice' && field in invoiceState.value)
    invoiceState.value = { ...invoiceState.value, [field]: value };
}

function updateSettlementState(
  customerId: string,
  sourceActorKey: string,
  field: 'unknown' | 'stale',
  value: boolean,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  if (field === 'unknown') settlementUnknown.value = value;
  else settlementStale.value = value;
}

function invalidateSettlementRead(
  customerId: string,
  sourceActorKey: string,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  settlementStale.value = true;
  settlementOwner.invalidate();
}

async function refreshSettlementList(): Promise<void> {
  settlementStale.value = true;
  let detailRefreshed = true;
  if (settlementDetailRefreshNeeded.value) {
    detailRefreshed = await refreshCustomerVersion(String(route.params.id));
    if (detailRefreshed) settlementDetailRefreshNeeded.value = false;
  }
  if (!detailRefreshed) return;
  if (!settlementCanRead.value) {
    if (!settlementDetailRefreshNeeded.value) settlementStale.value = false;
    return;
  }
  await settlementOwner.refresh();
  if (
    settlementOwner.status.value === 'ready' &&
    !settlementDetailRefreshNeeded.value
  )
    settlementStale.value = false;
}

async function refreshAfterSettlementCommand(
  customerId: string,
  sourceActorKey: string,
): Promise<void> {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId
  )
    return;
  settlementStale.value = true;
  settlementDetailRefreshNeeded.value = true;
  const detailRefreshed = await refreshCustomerVersion(customerId);
  if (detailRefreshed) settlementDetailRefreshNeeded.value = false;
  if (settlementCanRead.value) {
    await settlementOwner.refresh();
    if (
      detailRefreshed &&
      settlementOwner.status.value === 'ready' &&
      !settlementDetailRefreshNeeded.value
    )
      settlementStale.value = false;
  } else if (detailRefreshed) {
    settlementStale.value = false;
  }
}

function updateDocumentCustomerVersion(
  customerId: string,
  sourceActorKey: string,
  version: number,
): void {
  if (sourceActorKey === actorKey.value)
    updateCustomerVersion(customerId, version);
}

function refreshDocumentCustomer(
  customerId: string,
  sourceActorKey: string,
): void {
  if (
    customerId === String(route.params.id) &&
    sourceActorKey === actorKey.value &&
    customer.value?.id === customerId
  )
    void refreshCustomerVersion(customerId);
}

function handleDocumentUnavailable(
  customerId: string,
  sourceActorKey: string,
): void {
  if (
    customerId === String(route.params.id) &&
    sourceActorKey === actorKey.value &&
    customer.value?.id === customerId
  )
    refreshAfterMaintenanceAccessFailure(customerId);
}

function updateAssetPending(
  customerId: string,
  sourceActorKey: string,
  pending: boolean,
): void {
  if (
    customerId === String(route.params.id) &&
    sourceActorKey === actorKey.value &&
    customer.value?.id === customerId
  ) {
    if (!pending && assetRecoverySnapshot.value) return;
    assetPending.value = pending;
  }
}

function updateAssetRecovery(
  customerId: string,
  sourceActorKey: string,
  snapshot: RightAssetRecoverySnapshot | null,
): void {
  if (
    customerId !== String(route.params.id) ||
    sourceActorKey !== actorKey.value ||
    customer.value?.id !== customerId ||
    (snapshot &&
      (snapshot.customerId !== customerId ||
        snapshot.userId !== actor.value?.userId ||
        snapshot.departmentId !== actor.value?.departmentId))
  )
    return;
  assetRecoverySnapshot.value = snapshot ?? undefined;
  assetPending.value = !!snapshot;
}

function acceptRefreshedCustomer(latest: CustomerDetail): void {
  if (
    latest.id !== String(route.params.id) ||
    customer.value?.id !== latest.id
  ) {
    return;
  }
  customer.value = latest;
  currentProjectionStale.value = false;
}

async function acceptAdmission(
  customerId: string,
  sourceActorKey: string,
  admitted: CustomerSummary,
): Promise<void> {
  const current = customer.value;
  if (
    current === undefined ||
    current.id !== customerId ||
    sourceActorKey !== actorKey.value ||
    customerId !== admitted.id ||
    admitted.id !== String(route.params.id)
  ) {
    return;
  }
  currentProjectionStale.value = true;
  admissionRefreshFailed.value = false;
  const controller = new AbortController();
  requests.add(controller);
  try {
    const identityAtStart = actorKey.value;
    const latest = await getCustomer(customerId, {
      signal: controller.signal,
    });
    if (
      identityAtStart === actorKey.value &&
      isCurrentRequest(customerId, controller)
    ) {
      customer.value = latest;
      currentProjectionStale.value = false;
    }
  } catch {
    admissionRefreshFailed.value = true;
  } finally {
    requests.delete(controller);
  }
}

function acceptAdmissionRefresh(
  customerId: string,
  sourceActorKey: string,
  latest: CustomerDetail,
): void {
  if (sourceActorKey !== actorKey.value || customerId !== latest.id) return;
  acceptRefreshedCustomer(latest);
}

function returnFromAdmission(customerId: string, sourceActorKey: string): void {
  if (sourceActorKey === actorKey.value) returnToCustomerList(customerId);
}

async function retryCurrentDetail(): Promise<void> {
  const current = customer.value;
  if (!current) return;
  const customerId = current.id;
  const generation = viewGeneration;
  const identityAtStart = actorKey.value;
  try {
    const latest = await getCustomer(customerId);
    if (
      generation !== viewGeneration ||
      identityAtStart !== actorKey.value ||
      customerId !== String(route.params.id)
    )
      return;
    customer.value = latest;
    currentProjectionStale.value = false;
    admissionRefreshFailed.value = false;
  } catch {
    if (
      generation === viewGeneration &&
      identityAtStart === actorKey.value &&
      customerId === String(route.params.id)
    )
      admissionRefreshFailed.value = true;
  }
}

async function refreshCustomerVersion(customerId: string): Promise<boolean> {
  if (
    customer.value?.id !== customerId ||
    customerId !== String(route.params.id)
  ) {
    return false;
  }
  const controller = new AbortController();
  requests.add(controller);
  try {
    const latest = await getCustomer(customerId, { signal: controller.signal });
    if (isCurrentRequest(customerId, controller)) {
      customer.value = latest;
      return true;
    }
    return false;
  } catch (error) {
    if (isCurrentRequest(customerId, controller) && isCustomerNotFound(error)) {
      returnToCustomerList(customerId);
    }
    // Other failures leave the panel's input and refresh prompt visible.
    return false;
  } finally {
    requests.delete(controller);
  }
}

function returnToCustomerList(customerId: string): void {
  if (
    customerId !== String(route.params.id) ||
    customer.value?.id !== customerId
  ) {
    return;
  }
  void router.push('/customers');
}

function leaveAfterConfirmedMaintenance(customerId: string): void {
  if (
    customerId !== String(route.params.id) ||
    customer.value?.id !== customerId
  ) {
    return;
  }
  const currentActor = actor.value;
  const authorizationRevision = auth.session?.authorizationRevision;
  if (!currentActor || typeof authorizationRevision !== 'number') {
    void router.push('/customers');
    return;
  }
  void router.push({
    path: '/customers',
    state: {
      customerMaintenanceNotice: {
        type: 'access-revoked-after-confirmed-maintenance',
        ...currentActor,
        authorizationRevision,
      },
    },
  });
}

function isCustomerNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'CUSTOMER_NOT_FOUND'
  );
}

function updateMaintenancePending(pending: boolean): void {
  maintenancePending.value = pending;
}

function refreshAfterMaintenanceAccessFailure(customerId: string): void {
  if (
    customerId !== String(route.params.id) ||
    customer.value?.id !== customerId
  )
    return;
  customer.value = undefined;
  currentProjectionStale.value = false;
  state.value = 'loading';
  void load();
}

watch(settlementOwner.status, (status) => {
  if (status === 'ready' && !settlementDetailRefreshNeeded.value)
    settlementStale.value = false;
  else if (status === 'failed' && settlementCanRead.value)
    settlementStale.value = true;
});

watch(
  () => `${String(route.params.id)}:${actorKey.value}`,
  () => {
    viewGeneration += 1;
    abortRequests();
    restorePending(String(route.params.id));
    contactsProjectionStale.value = false;
    customer.value = undefined;
    currentProjectionStale.value = false;
    admissionRefreshFailed.value = false;
    activeTab.value = 'basic';
    state.value = 'loading';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  abortRequests();
  settlementOwner.dispose();
});
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/customers">← 返回客户列表</RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <span class="state-index">读取中</span>
        <h1>正在读取客户资料</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <span class="state-index">404</span>
        <h1>客户不存在或当前不可访问</h1>
        <p>请返回列表，从有权查看的客户中重新选择。</p>
        <div v-if="frozenDelete" data-test="pending-delete-after-404">
          <p>此前的删除请求结果尚不确定。可用原请求和原幂等键重试。</p>
          <ElButton
            v-if="deleteStatus !== 'conflict'"
            :loading="deleteStatus === 'submitting'"
            @click="submitDelete"
            >按原请求重试</ElButton
          >
          <ElButton v-else @click="refreshAfterDeleteConflict"
            >刷新客户资料</ElButton
          >
        </div>
        <p v-if="maintenancePending" data-test="pending-maintenance-after-404">
          维护结果尚未确认，原请求已保留。恢复访问后可按原请求重试。
        </p>
      </section>
      <section
        v-else-if="state === 'unavailable'"
        class="state-panel ledger-panel"
        data-test="customer-contact-unavailable"
      >
        <h1>客户资料当前不可用</h1>
        <p>恢复访问后，请先只读刷新客户资料。</p>
        <ElButton data-test="customer-contact-readonly-retry" @click="load"
          >只读刷新客户资料</ElButton
        >
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <span class="state-index">连接失败</span>
        <h1>客户资料暂时无法加载</h1>
        <p v-if="maintenancePending">
          维护结果尚未确认，原请求已保留。恢复访问后可按原请求重试。
        </p>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="customer">
        <div class="detail-heading">
          <div>
            <p class="section-kicker">客户详情</p>
            <h1>{{ customer.name }}</h1>
          </div>
          <div class="detail-actions">
            <ElButton
              v-if="customer.capabilities.deleteDraft && !sharedWriteBlocked"
              data-test="delete-draft-open"
              @click="deletePrompt = true"
              >删除草稿</ElButton
            >
            <RouterLink
              v-if="customer.capabilities.editRoutine && !sharedWriteBlocked"
              data-test="edit-customer"
              :to="`/customers/${customer.id}/edit`"
            >
              编辑资料
            </RouterLink>
            <span class="status-chip status-chip--large">{{
              profileLabel(customer.profileStatus)
            }}</span>
          </div>
        </div>
        <section
          v-if="
            settlementCanRead &&
            settlementKpis &&
            settlementOwner.status.value === 'ready' &&
            !settlementStale
          "
          class="settlement-top-kpis"
          data-test="settlement-top-kpis"
          aria-label="客户结算统计"
        >
          <div data-test="settlement-kpi-settlement">
            <span>累计结算金额</span>
            <strong>{{
              formatSettlementAmount(settlementKpis.totalSettlement)
            }}</strong>
          </div>
          <div data-test="settlement-kpi-received">
            <span>{{ settlementReceivedLabel }}</span>
            <strong>{{
              formatSettlementAmount(settlementKpis.receivedKnownSubtotal)
            }}</strong>
            <small v-if="settlementKpis.receivedUnknownCount"
              >{{ settlementKpis.receivedUnknownCount }} 笔未录入</small
            >
          </div>
          <div data-test="settlement-kpi-pending">
            <span>{{ settlementPendingAmount.label }}</span>
            <strong>{{ settlementPendingAmount.amount }}</strong>
          </div>
          <div data-test="settlement-kpi-rate">
            <span>回款率</span>
            <strong>{{ settlementRateLabel }}</strong>
            <span class="settlement-top-kpis__bar" aria-hidden="true"
              ><span :style="{ width: settlementRateWidth }"
            /></span>
          </div>
        </section>
        <p v-if="currentProjectionStale" role="status">
          当前客户资料需要刷新。刷新完成前不能发起新的维护。
        </p>
        <ElButton
          v-if="currentProjectionStale && admissionRefreshFailed"
          data-test="admission-refresh-readonly"
          @click="retryCurrentDetail"
          >只读重试刷新</ElButton
        >
        <CustomerCooperationPanel
          v-if="!frozenDelete || maintenancePending"
          :customer="customer"
          :actor="actor"
          :blocked-by-other-maintenance="
            !!frozenDelete ||
            contactsWriteBlocked ||
            currentProjectionStale ||
            assetPending ||
            documentPending ||
            settlementPending
          "
          @refreshed="acceptRefreshedCustomer"
          @unreadable="leaveAfterConfirmedMaintenance"
          @pending-changed="updateMaintenancePending"
          @refresh-required="currentProjectionStale = $event"
          @access-uncertain="refreshAfterMaintenanceAccessFailure"
        />
        <section
          v-if="
            deletePrompt && (customer.capabilities.deleteDraft || frozenDelete)
          "
          class="ledger-panel detail-card"
          data-test="delete-draft-confirm"
        >
          <h2>删除这份草稿？</h2>
          <p>删除后将从普通客户列表隐藏。可在已删除草稿中恢复原客户。</p>
          <label
            >原因（选填）<input
              v-model="deletionReason"
              :disabled="!!frozenDelete"
              maxlength="500"
          /></label>
          <p v-if="deleteStatus === 'unknown'" role="alert">
            结果尚不确定。重试会使用原请求和同一幂等键。
          </p>
          <p v-if="deleteStatus === 'conflict'" role="alert">
            客户资料已变化。保留当前原因，请明确刷新后再决定。
          </p>
          <ElButton
            data-test="delete-draft-submit"
            :loading="deleteStatus === 'submitting'"
            :disabled="deleteStatus === 'conflict'"
            @click="submitDelete"
            >{{
              deleteStatus === 'unknown' ? '按原请求重试' : '确认删除'
            }}</ElButton
          >
          <ElButton
            v-if="deleteStatus === 'conflict'"
            data-test="delete-draft-refresh"
            @click="refreshAfterDeleteConflict"
            >刷新客户资料</ElButton
          >
          <ElButton v-if="deleteStatus === 'idle'" @click="deletePrompt = false"
            >取消</ElButton
          >
        </section>
        <div class="customer-tabs" role="tablist" aria-label="客户详情">
          <button
            id="customer-tab-button-basic"
            class="customer-tabs__tab"
            type="button"
            role="tab"
            aria-controls="customer-tab-basic"
            :aria-selected="activeTab === 'basic'"
            @click="activeTab = 'basic'"
          >
            基本信息
          </button>
          <button
            id="customer-tab-button-assets"
            class="customer-tabs__tab"
            type="button"
            role="tab"
            aria-controls="customer-tab-assets"
            :aria-selected="activeTab === 'assets'"
            @click="activeTab = 'assets'"
          >
            权利资产
          </button>
          <button
            v-if="
              customer.capabilities.settlement.read ||
              customer.capabilities.settlement.register ||
              settlementUnknown
            "
            id="customer-tab-button-settlements"
            class="customer-tabs__tab"
            type="button"
            role="tab"
            aria-controls="customer-tab-settlements"
            :aria-selected="activeTab === 'settlements'"
            @click="activeTab = 'settlements'"
          >
            结算记录
          </button>
        </div>
        <section
          id="customer-tab-basic"
          class="customer-tab-panel"
          role="tabpanel"
          aria-labelledby="customer-tab-button-basic"
          v-show="activeTab === 'basic'"
        >
          <nav class="detail-anchor-nav" aria-label="基本信息快速导航">
            <a href="#customer-profile">客户资料</a>
            <a href="#customer-contacts">联系人</a>
            <a href="#customer-rights-holders">权利人</a>
            <a href="#customer-admission">身份材料</a>
            <a href="#customer-accounts">企业账号</a>
            <a href="#customer-history">办理历史</a>
          </nav>
          <section id="customer-profile" class="ledger-panel detail-card">
            <dl class="detail-grid">
              <div>
                <dt>资料状态</dt>
                <dd>{{ profileLabel(customer.profileStatus) }}</dd>
              </div>
              <div>
                <dt>客户类别</dt>
                <dd>{{ customer.category || '未填写' }}</dd>
              </div>
              <div>
                <dt>客户组织类型</dt>
                <dd>{{ labelCustomerType(customer.customerType) }}</dd>
              </div>
              <div>
                <dt>身份证明类型</dt>
                <dd>{{ labelIdentityType(customer.identityType) }}</dd>
              </div>
              <div>
                <dt>证件号码</dt>
                <dd>{{ customer.identityNumber || '未填写' }}</dd>
              </div>
              <div>
                <dt>签发国家／地区</dt>
                <dd>{{ customer.issuingCountryOrRegion || '未填写' }}</dd>
              </div>
              <div>
                <dt>证件有效期</dt>
                <dd>
                  {{
                    customer.identityValidityMode === 'LONG_TERM'
                      ? '长期有效'
                      : customer.identityValidityMode === 'NOT_STATED'
                        ? '证件未注明'
                        : customer.identityValidTo || '未填写'
                  }}
                </dd>
              </div>
              <div>
                <dt>所属地区</dt>
                <dd>{{ customer.region || '未填写' }}</dd>
              </div>
              <div>
                <dt>准入联系人</dt>
                <dd>{{ customer.admissionContactName || '未填写' }}</dd>
              </div>
              <div>
                <dt>联系人电话</dt>
                <dd>{{ customer.admissionContactPhone || '未填写' }}</dd>
              </div>
              <div>
                <dt>联系人邮箱</dt>
                <dd>{{ customer.admissionContactEmail || '未填写' }}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{{ formatTime(customer.updatedAt) }}</dd>
              </div>
            </dl>
            <p class="draft-note">
              {{
                customer.profileStatus === 'admitted'
                  ? '客户已完成准入，可用于创建正式线索。'
                  : '资料尚未准入，可继续补充证件与联系人。'
              }}
            </p>
          </section>
          <CustomerContactsPanel
            id="customer-contacts"
            :customer="customer"
            :actor="actor"
            :blocked-by-other-maintenance="
              !!frozenDelete ||
              maintenancePending ||
              currentProjectionStale ||
              assetPending ||
              documentPending ||
              settlementPending
            "
            @refreshed="acceptContactRefresh"
            @pending-changed="updateContactsPending"
            @projection-stale="updateContactProjectionStale"
            @unavailable="handleContactUnavailable"
          />
          <CustomerAgreementPanel
            v-if="
              customer.capabilities.agreement.read ||
              agreementState.unknown ||
              agreementState.stale ||
              agreementState.uploadUnknown
            "
            :customer-id="customer.id"
            :customer-version="customer.version"
            :can-read="customer.capabilities.agreement.read"
            :can-edit="customer.capabilities.agreement.edit"
            :actor="
              actor
                ? { userId: actor.userId, departmentId: actor.departmentId }
                : null
            "
            :actor-key="actorKey"
            :blocked-by-other-maintenance="agreementBlocked"
            @document-state="updateDocumentState"
            @version-updated="updateDocumentCustomerVersion"
            @refresh-requested="refreshDocumentCustomer"
            @unavailable="handleDocumentUnavailable"
          />
          <CustomerInvoiceProfilePanel
            v-if="
              customer.capabilities.invoice.read ||
              invoiceState.unknown ||
              invoiceState.stale
            "
            :customer-id="customer.id"
            :customer-version="customer.version"
            :can-read="customer.capabilities.invoice.read"
            :can-edit="customer.capabilities.invoice.edit"
            :actor="
              actor
                ? { userId: actor.userId, departmentId: actor.departmentId }
                : null
            "
            :actor-key="actorKey"
            :blocked-by-other-maintenance="invoiceBlocked"
            @document-state="updateDocumentState"
            @version-updated="updateDocumentCustomerVersion"
            @refresh-requested="refreshDocumentCustomer"
            @unavailable="handleDocumentUnavailable"
          />
          <CustomerRightsHolderPanel
            v-if="!sharedWriteBlocked"
            id="customer-rights-holders"
            :customer-id="customer.id"
            :customer-version="customer.version"
            :can-edit="customer.capabilities.editRoutine"
            @version-updated="updateCustomerVersion"
            @refresh-requested="refreshCustomerVersion"
            @customer-not-found="returnToCustomerList"
          />
          <CustomerAdmissionPanel
            v-if="!sharedWriteBlocked"
            id="customer-admission"
            :customer="customer"
            @admitted="acceptAdmission"
            @customer-refreshed="acceptAdmissionRefresh"
            @customer-not-found="returnFromAdmission"
          />
          <CustomerAccountPanel
            v-if="!sharedWriteBlocked"
            id="customer-accounts"
            :customer-id="customer.id"
            :admitted="customer.profileStatus === 'admitted'"
          />
          <details id="customer-history" class="history-panel">
            <summary>办理历史 · {{ customer.history.length }} 条</summary>
            <ol>
              <li
                v-for="event in customer.history"
                :key="`${event.action}-${event.occurredAt}`"
              >
                <strong>{{ actionLabel(event.action) }}</strong>
                <time>{{ formatTime(event.occurredAt) }}</time>
              </li>
            </ol>
          </details>
        </section>
        <section
          id="customer-tab-assets"
          class="customer-tab-panel"
          role="tabpanel"
          aria-labelledby="customer-tab-button-assets"
          v-show="activeTab === 'assets'"
        >
          <CustomerRightAssetsPanel
            :customer-id="customer.id"
            :customer-version="customer.version"
            :can-edit="customer.capabilities.editRoutine"
            :actor-user-id="actor?.userId ?? ''"
            :actor-department-id="actor?.departmentId ?? ''"
            :actor-key="actorKey"
            :recovery-snapshot="assetRecoverySnapshot"
            :blocked-by-other-maintenance="assetsBlocked"
            @maintenance-pending="updateAssetPending"
            @recovery-snapshot="updateAssetRecovery"
            @version-updated="updateCustomerVersion"
            @refresh-requested="refreshCustomerVersion"
            @customer-not-found="returnToCustomerList"
          />
        </section>
        <section
          v-if="
            customer.capabilities.settlement.read ||
            customer.capabilities.settlement.register ||
            settlementUnknown
          "
          id="customer-tab-settlements"
          class="customer-tab-panel"
          role="tabpanel"
          aria-labelledby="customer-tab-button-settlements"
          v-show="activeTab === 'settlements'"
        >
          <CustomerSettlementsPanel
            v-if="
              customer.capabilities.settlement.read ||
              customer.capabilities.settlement.register ||
              settlementUnknown
            "
            :customer-id="customer.id"
            :customer-version="customer.version"
            :actor="
              actor
                ? { userId: actor.userId, departmentId: actor.departmentId }
                : null
            "
            :actor-key="actorKey"
            :can-read="customer.capabilities.settlement.read"
            :can-register="customer.capabilities.settlement.register"
            :can-correct="customer.capabilities.settlement.correct"
            :data="settlementData"
            :status="settlementOwner.status.value"
            :stale="settlementStale || settlementOwner.stale.value"
            :error="settlementOwner.error.value"
            :page="settlementOwner.page.value"
            :page-size="settlementOwner.pageSize"
            :blocked-by-other-maintenance="otherMaintenanceBlocked"
            @page-change="settlementOwner.setPage"
            @refresh="refreshSettlementList"
            @settlement-state="updateSettlementState"
            @private-read-failed="invalidateSettlementRead"
            @command-confirmed="refreshAfterSettlementCommand"
          />
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.customer-tabs {
  display: flex;
  gap: var(--s-2);
  margin: 0 0 var(--s-4);
  border-bottom: 1px solid var(--color-hairline);
}

.settlement-top-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-3);
  margin: 0 0 var(--s-4);
}

.settlement-top-kpis > div {
  display: grid;
  gap: var(--s-1);
  padding: var(--s-3);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-card);
}

.settlement-top-kpis__bar {
  display: block;
  height: 0.5rem;
  overflow: hidden;
  border-radius: 99px;
  background: var(--color-hairline);
}

.settlement-top-kpis__bar > span {
  display: block;
  height: 100%;
  background: var(--color-accent);
}

.customer-tabs__tab {
  margin-bottom: -1px;
  padding: var(--s-3) var(--s-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-ink-muted);
  cursor: pointer;
  font: inherit;
}

.customer-tabs__tab[aria-selected='true'] {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 600;
}

.customer-tabs__tab:focus-visible {
  outline: 2px solid var(--color-primary-focus);
  outline-offset: 2px;
}

.customer-tab-panel--notice {
  padding: var(--s-6);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-surface-1);
}

.customer-tab-panel--notice h2 {
  margin: 0 0 var(--s-2);
  font-size: 16px;
}

.customer-tab-panel--notice p {
  margin: 0;
  color: var(--color-ink-muted);
}
</style>
