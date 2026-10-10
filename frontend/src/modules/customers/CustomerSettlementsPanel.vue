<script setup lang="ts">
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  correctCustomerSettlement,
  listCustomerSettlementVersions,
  registerCustomerSettlement,
  type CorrectCustomerSettlementInput,
  type CustomerSettlementCommandResult,
  type CustomerSettlementRecord,
  type CustomerSettlementVersion,
  type RegisterCustomerSettlementInput,
} from '../../api/customer-settlements';
import {
  ConfirmedSettlementCommandError,
  clearPendingSettlementCommand,
  markConfirmedSettlementCommand,
  readPendingSettlementCommand,
  savePendingSettlementCommand,
  type PendingSettlementCommand,
} from './customer-settlement-pending';
import {
  formatSettlementAmount,
  formatSettlementPercent,
  isSettlementInputAmount,
  settlementPendingDisplay,
  settlementRecoveryBarWidth,
} from './customer-settlement-money';

type Actor = { userId: string; departmentId: string } | null;
type ListData = {
  items: CustomerSettlementRecord[];
  total: number;
  stats: {
    recordCount: number;
    totalSettlement: string;
    invoiceKnownSubtotal: string;
    invoiceUnknownCount: number;
    receivedKnownSubtotal: string;
    receivedUnknownCount: number;
    pendingAmount: string | null;
    recoveryRate: string | null;
  };
};

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  actor: Actor;
  actorKey: string;
  canRead: boolean;
  canRegister: boolean;
  canCorrect: boolean;
  data?: ListData;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  stale: boolean;
  error: string;
  page: number;
  pageSize: number;
  blockedByOtherMaintenance: boolean;
}>();

const emit = defineEmits<{
  'page-change': [page: number];
  refresh: [];
  'settlement-state': [
    customerId: string,
    actorKey: string,
    field: 'unknown' | 'stale',
    value: boolean,
  ];
  'private-read-failed': [customerId: string, actorKey: string];
  'command-confirmed': [
    customerId: string,
    actorKey: string,
    result: CustomerSettlementCommandResult,
  ];
}>();

const settlementDate = ref('');
const settlementAmount = ref('');
const invoiceKnown = ref(false);
const invoiceAmount = ref('');
const receivedKnown = ref(false);
const receivedAmount = ref('');
const receivedDateKnown = ref(false);
const receivedDate = ref('');
const correctionReason = ref('');
const selectedRecord = ref<CustomerSettlementRecord>();
const histories = ref<Record<string, CustomerSettlementVersion[]>>({});
const historyOpen = ref<Record<string, boolean>>({});
const historyLoading = ref<Record<string, boolean>>({});
const historyPage = ref<Record<string, number>>({});
const historyTotal = ref<Record<string, number>>({});
const pending = ref<PendingSettlementCommand>();
const privateReadFailed = ref(false);
const commandStatus = ref<
  'idle' | 'sending' | 'unknown' | 'conflict' | 'refresh-needed'
>('idle');
const refreshExpectedCustomerVersion = ref<number>();
const confirmedStorageBlocked = ref(false);
const message = ref('');
let generation = 0;
let historyController: AbortController | undefined;

const canDiscover = computed(
  () =>
    props.canRead &&
    !privateReadFailed.value &&
    props.data !== undefined &&
    props.status === 'ready',
);
const editing = computed(() => selectedRecord.value !== undefined);
const busy = computed(
  () => commandStatus.value === 'sending' || props.blockedByOtherMaintenance,
);
const canSubmitRegister = computed(
  () =>
    props.canRegister &&
    !props.stale &&
    !busy.value &&
    !pending.value &&
    commandStatus.value !== 'conflict' &&
    commandStatus.value !== 'refresh-needed',
);
const canSubmitCorrection = computed(
  () =>
    props.canRead &&
    props.canCorrect &&
    !props.stale &&
    selectedRecord.value !== undefined &&
    !busy.value &&
    !pending.value &&
    commandStatus.value !== 'refresh-needed',
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil((props.data?.total ?? 0) / props.pageSize)),
);
const pendingDisplay = computed(() =>
  settlementPendingDisplay(props.data?.stats.pendingAmount ?? null),
);
const rateLabel = computed(() =>
  props.data?.stats.recoveryRate === null ||
  props.data?.stats.recoveryRate === undefined
    ? '—'
    : formatSettlementPercent(props.data.stats.recoveryRate),
);
const rateWidth = computed(() =>
  settlementRecoveryBarWidth(props.data?.stats.recoveryRate ?? null),
);

function identity() {
  if (!props.actor) return undefined;
  return {
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customerId,
    kind: 'settlement' as const,
  };
}

function clearForm(): void {
  settlementDate.value = '';
  settlementAmount.value = '';
  invoiceKnown.value = false;
  invoiceAmount.value = '';
  receivedKnown.value = false;
  receivedAmount.value = '';
  receivedDateKnown.value = false;
  receivedDate.value = '';
  correctionReason.value = '';
  selectedRecord.value = undefined;
}

function clearHistory(): void {
  historyController?.abort();
  historyController = undefined;
  histories.value = {};
  historyOpen.value = {};
  historyLoading.value = {};
  historyPage.value = {};
  historyTotal.value = {};
}

function restorePending(): void {
  pending.value = undefined;
  confirmedStorageBlocked.value = false;
  refreshExpectedCustomerVersion.value = undefined;
  const who = identity();
  if (!who) return;
  try {
    pending.value = readPendingSettlementCommand(who);
  } catch (error) {
    confirmedStorageBlocked.value =
      error instanceof ConfirmedSettlementCommandError;
    commandStatus.value =
      error instanceof ConfirmedSettlementCommandError
        ? 'refresh-needed'
        : 'unknown';
    message.value =
      error instanceof ConfirmedSettlementCommandError
        ? '本次结算已确认成功。请只读刷新，并修复浏览器会话存储后继续。'
        : '原结算请求状态无法读取。请恢复本地存储后重试。';
    emit(
      'settlement-state',
      props.customerId,
      props.actorKey,
      error instanceof ConfirmedSettlementCommandError ? 'stale' : 'unknown',
      true,
    );
    return;
  }
  if (pending.value) {
    commandStatus.value = 'unknown';
    message.value = '结算请求结果未知。重试将使用原请求和同一幂等键。';
    emit('settlement-state', props.customerId, props.actorKey, 'unknown', true);
  } else if (commandStatus.value === 'unknown') {
    commandStatus.value = 'idle';
    emit(
      'settlement-state',
      props.customerId,
      props.actorKey,
      'unknown',
      false,
    );
  }
}

function setSensitiveUnavailable(): void {
  privateReadFailed.value = true;
  clearHistory();
  clearForm();
  emit('private-read-failed', props.customerId, props.actorKey);
}

function useVersion(version: CustomerSettlementVersion): void {
  settlementDate.value = version.settlementDate;
  settlementAmount.value = version.settlementAmount;
  invoiceKnown.value = version.invoiceAmount !== null;
  invoiceAmount.value = version.invoiceAmount ?? '';
  receivedKnown.value = version.receivedAmount !== null;
  receivedAmount.value = version.receivedAmount ?? '';
  receivedDateKnown.value = version.receivedDate !== null;
  receivedDate.value = version.receivedDate ?? '';
}

function beginCorrection(record: CustomerSettlementRecord): void {
  if (
    !props.canRead ||
    !props.canCorrect ||
    props.stale ||
    props.blockedByOtherMaintenance
  )
    return;
  selectedRecord.value = record;
  useVersion(record.currentVersion);
  correctionReason.value = '';
  commandStatus.value = 'idle';
  message.value = '';
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === 0) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

function validForm(): boolean {
  return (
    isValidDate(settlementDate.value) &&
    isSettlementInputAmount(settlementAmount.value) &&
    (!invoiceKnown.value || isSettlementInputAmount(invoiceAmount.value)) &&
    (!receivedKnown.value || isSettlementInputAmount(receivedAmount.value)) &&
    (!receivedDateKnown.value || isValidDate(receivedDate.value)) &&
    (!editing.value ||
      (correctionReason.value.trim().length > 0 &&
        correctionReason.value.trim().length <= 500))
  );
}

function createBody():
  RegisterCustomerSettlementInput | CorrectCustomerSettlementInput {
  const facts = {
    settlementDate: settlementDate.value,
    settlementAmount: settlementAmount.value,
    invoiceAmount: invoiceKnown.value ? invoiceAmount.value : null,
    receivedAmount: receivedKnown.value ? receivedAmount.value : null,
    receivedDate: receivedDateKnown.value ? receivedDate.value : null,
  };
  return editing.value
    ? {
        expectedCustomerVersion: props.customerVersion,
        expectedRecordVersion: selectedRecord.value!.version,
        ...facts,
        reason: correctionReason.value.trim(),
      }
    : { expectedCustomerVersion: props.customerVersion, ...facts };
}

function makeCommand(): PendingSettlementCommand {
  const body = createBody();
  const common = {
    ...identity()!,
    action: editing.value ? ('correct' as const) : ('register' as const),
    expectedCustomerVersion: props.customerVersion,
    body,
    key: globalThis.crypto.randomUUID(),
  };
  return editing.value
    ? {
        ...common,
        recordId: selectedRecord.value!.id,
        expectedRecordVersion: selectedRecord.value!.version,
      }
    : common;
}

async function send(
  command: PendingSettlementCommand,
  sourceActorKey = props.actorKey,
): Promise<void> {
  if (busy.value) return;
  commandStatus.value = 'sending';
  message.value = '';
  emit('settlement-state', props.customerId, props.actorKey, 'unknown', true);
  try {
    const result =
      command.action === 'correct'
        ? await correctCustomerSettlement(
            command.customerId,
            command.recordId!,
            command.body as CorrectCustomerSettlementInput,
            command.key,
          )
        : await registerCustomerSettlement(
            command.customerId,
            command.body as RegisterCustomerSettlementInput,
            command.key,
          );
    if (
      sourceActorKey !== props.actorKey ||
      command.customerId !== props.customerId ||
      command.userId !== props.actor?.userId ||
      command.departmentId !== props.actor?.departmentId
    )
      return;
    const cleared = clearPendingSettlementCommand(command);
    confirmedStorageBlocked.value = !cleared;
    if (!cleared) markConfirmedSettlementCommand(command);
    pending.value = undefined;
    commandStatus.value = 'refresh-needed';
    refreshExpectedCustomerVersion.value = result.customerVersion;
    emit(
      'settlement-state',
      props.customerId,
      props.actorKey,
      'unknown',
      false,
    );
    message.value = `本次提交已成功（第 ${result.version} 版）。`;
    emit('command-confirmed', props.customerId, props.actorKey, result);
    if (command.action === 'register' && !props.canRead) clearForm();
  } catch (error) {
    if (
      sourceActorKey !== props.actorKey ||
      command.customerId !== props.customerId ||
      command.userId !== props.actor?.userId ||
      command.departmentId !== props.actor?.departmentId
    )
      return;
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      error.code !== 'BUSY'
    ) {
      clearPendingSettlementCommand(command);
      pending.value = undefined;
      commandStatus.value = 'conflict';
      message.value = `结算资料已变化。草稿仍在本页；当前提交版为第 ${command.expectedRecordVersion ?? 0} 版，请读取当前记录后人工对照。`;
      emit(
        'settlement-state',
        props.customerId,
        props.actorKey,
        'unknown',
        false,
      );
      emit('settlement-state', props.customerId, props.actorKey, 'stale', true);
      return;
    }
    pending.value = command;
    commandStatus.value = 'unknown';
    message.value =
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
        ? '当前授权或客户状态已变化。原请求已保留；恢复访问后可按原请求重试。'
        : '结算请求结果未知。重试将使用原请求和同一幂等键。';
    emit('settlement-state', props.customerId, props.actorKey, 'unknown', true);
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    )
      setSensitiveUnavailable();
  } finally {
    if (
      sourceActorKey === props.actorKey &&
      command.customerId === props.customerId &&
      command.userId === props.actor?.userId &&
      command.departmentId === props.actor?.departmentId &&
      commandStatus.value === 'sending'
    )
      commandStatus.value = 'unknown';
  }
}

function submit(): void {
  if (editing.value ? !canSubmitCorrection.value : !canSubmitRegister.value)
    return;
  if (!validForm()) {
    message.value = editing.value
      ? '请填写有效事实和更正原因。'
      : '请填写有效结算日期和金额。';
    return;
  }
  const who = identity();
  if (!who) {
    message.value = '当前账号不能登记结算。';
    return;
  }
  const command = makeCommand();
  if (!savePendingSettlementCommand(command)) {
    commandStatus.value = 'idle';
    message.value =
      '无法安全保存原请求，本次未提交。请检查浏览器会话存储后重试。';
    return;
  }
  pending.value = command;
  void send(command);
}

function retryPending(): void {
  if (!pending.value || busy.value) return;
  void send(pending.value, props.actorKey);
}

function cancelDraft(): void {
  if (pending.value || props.stale || props.blockedByOtherMaintenance) return;
  clearForm();
  commandStatus.value = 'idle';
  message.value = '';
}

async function loadHistory(recordId: string, page = 1): Promise<void> {
  if (
    !props.canRead ||
    !props.data ||
    props.stale ||
    props.blockedByOtherMaintenance
  )
    return;
  const requestGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  historyController?.abort();
  historyController = new AbortController();
  const controller = historyController;
  historyLoading.value = { ...historyLoading.value, [recordId]: true };
  try {
    const result = await listCustomerSettlementVersions(
      customerId,
      recordId,
      page,
      props.pageSize,
      { signal: controller.signal },
    );
    if (
      requestGeneration !== generation ||
      controller.signal.aborted ||
      customerId !== props.customerId ||
      actorKey !== props.actorKey ||
      !props.canRead
    )
      return;
    histories.value = { ...histories.value, [recordId]: result.items };
    historyPage.value = { ...historyPage.value, [recordId]: result.page };
    historyTotal.value = { ...historyTotal.value, [recordId]: result.total };
    historyOpen.value = { ...historyOpen.value, [recordId]: true };
  } catch {
    if (
      requestGeneration !== generation ||
      controller.signal.aborted ||
      customerId !== props.customerId ||
      actorKey !== props.actorKey
    )
      return;
    histories.value = {};
    historyOpen.value = {};
    emit('settlement-state', customerId, actorKey, 'stale', true);
    setSensitiveUnavailable();
  } finally {
    if (requestGeneration === generation)
      historyLoading.value = { ...historyLoading.value, [recordId]: false };
  }
}

function toggleHistory(recordId: string): void {
  if (historyOpen.value[recordId]) {
    historyOpen.value = { ...historyOpen.value, [recordId]: false };
    return;
  }
  void loadHistory(recordId);
}

watch(
  () =>
    `${props.customerId}:${props.actorKey}:${props.canRead}:${props.canRegister}:${props.canCorrect}`,
  () => {
    generation += 1;
    clearHistory();
    clearForm();
    message.value = '';
    commandStatus.value = 'idle';
    restorePending();
    if (!props.canRead) {
      histories.value = {};
      selectedRecord.value = undefined;
    }
  },
  { immediate: true, flush: 'sync' },
);

watch(
  () => props.data,
  (data) => {
    if (data && props.status === 'ready') privateReadFailed.value = false;
  },
);

watch(
  () => props.status,
  (status) => {
    if (status === 'failed') {
      privateReadFailed.value = true;
      clearHistory();
      clearForm();
    }
  },
);

watch(
  () => props.customerVersion,
  (version) => {
    if (
      commandStatus.value === 'refresh-needed' &&
      !confirmedStorageBlocked.value &&
      refreshExpectedCustomerVersion.value !== undefined &&
      version >= refreshExpectedCustomerVersion.value
    ) {
      commandStatus.value = 'idle';
      refreshExpectedCustomerVersion.value = undefined;
    }
  },
);

watch(
  () => props.stale,
  (stale) => {
    if (!stale && confirmedStorageBlocked.value) {
      confirmedStorageBlocked.value = false;
      commandStatus.value = 'idle';
      refreshExpectedCustomerVersion.value = undefined;
    }
  },
);

onBeforeUnmount(() => {
  generation += 1;
  clearHistory();
});
</script>

<template>
  <section
    class="ledger-panel settlement-panel"
    data-test="settlement-panel"
    aria-labelledby="settlement-heading"
  >
    <header class="settlement-panel__heading">
      <div>
        <p class="section-kicker">客户结算</p>
        <h2 id="settlement-heading">结算记录</h2>
      </div>
      <ElButton
        v-if="canRead || (canRegister && stale)"
        native-type="button"
        data-test="settlement-refresh"
        :disabled="status === 'loading'"
        @click="emit('refresh')"
      >
        只读刷新
      </ElButton>
    </header>

    <div
      v-if="canDiscover"
      class="settlement-summary"
      data-test="settlement-kpi-projection"
    >
      <div>
        <span>结算笔数</span><strong>{{ data!.stats.recordCount }}</strong>
      </div>
      <div>
        <span>开票已知小计</span
        ><strong>{{
          formatSettlementAmount(data!.stats.invoiceKnownSubtotal)
        }}</strong
        ><small v-if="data!.stats.invoiceUnknownCount"
          >{{ data!.stats.invoiceUnknownCount }} 笔未录入</small
        >
      </div>
      <div>
        <span>{{
          data!.stats.receivedUnknownCount ? '已知回款小计' : '累计回款'
        }}</span
        ><strong>{{
          formatSettlementAmount(data!.stats.receivedKnownSubtotal)
        }}</strong
        ><small v-if="data!.stats.receivedUnknownCount"
          >{{ data!.stats.receivedUnknownCount }} 笔未录入</small
        >
      </div>
    </div>

    <p v-if="status === 'loading'" role="status">正在读取结算台账。</p>
    <div
      v-else-if="status === 'failed'"
      role="alert"
      data-test="settlement-read-error"
    >
      <p>{{ error || '结算资料读取失败。' }}</p>
      <ElButton
        v-if="canRead"
        native-type="button"
        data-test="settlement-read-retry"
        @click="emit('refresh')"
      >
        只读重试
      </ElButton>
    </div>
    <div v-else-if="canRead && data" data-test="settlement-records">
      <p v-if="data.total === 0" data-test="settlement-empty">暂无结算记录。</p>
      <article
        v-for="record in data.items"
        :key="record.id"
        class="settlement-record"
        data-test="settlement-record"
      >
        <div class="settlement-record__facts">
          <strong>{{ record.currentVersion.settlementDate }}</strong>
          <span
            >结算
            {{
              formatSettlementAmount(record.currentVersion.settlementAmount)
            }}</span
          >
          <span :data-test="`settlement-received-${record.id}`"
            >回款
            {{
              record.currentVersion.receivedAmount === null
                ? '未录入'
                : formatSettlementAmount(record.currentVersion.receivedAmount)
            }}</span
          >
          <span
            >开票
            {{
              record.currentVersion.invoiceAmount === null
                ? '未录入'
                : formatSettlementAmount(record.currentVersion.invoiceAmount)
            }}</span
          >
        </div>
        <div class="settlement-record__actions">
          <ElButton
            native-type="button"
            :data-test="`settlement-history-${record.id}`"
            :disabled="busy"
            @click="toggleHistory(record.id)"
          >
            {{ historyOpen[record.id] ? '收起版本' : '版本历史' }}
          </ElButton>
          <ElButton
            v-if="canRead && canCorrect"
            native-type="button"
            :data-test="`correct-settlement-${record.id}`"
            :disabled="busy"
            @click="beginCorrection(record)"
          >
            更正
          </ElButton>
        </div>
        <ol
          v-if="historyOpen[record.id]"
          :data-test="`settlement-history-list-${record.id}`"
        >
          <li v-for="version in histories[record.id] ?? []" :key="version.id">
            第 {{ version.version }} 版 ·
            {{ version.action === 'REGISTER' ? '登记' : '更正' }} ·
            {{ version.correctionReason || '初次登记' }} ·
            {{ version.recordedByUserId }} · {{ version.recordedAt }}
          </li>
        </ol>
        <div
          v-if="
            historyOpen[record.id] && (historyTotal[record.id] ?? 0) > pageSize
          "
          class="settlement-pagination"
        >
          <ElButton
            native-type="button"
            :disabled="
              (historyPage[record.id] ?? 1) <= 1 || historyLoading[record.id]
            "
            @click="loadHistory(record.id, (historyPage[record.id] ?? 1) - 1)"
          >
            上一页
          </ElButton>
          <span
            >{{ historyPage[record.id] }} /
            {{ Math.ceil((historyTotal[record.id] ?? 0) / pageSize) }}</span
          >
          <ElButton
            native-type="button"
            :disabled="
              (historyPage[record.id] ?? 1) * pageSize >=
                (historyTotal[record.id] ?? 0) || historyLoading[record.id]
            "
            @click="loadHistory(record.id, (historyPage[record.id] ?? 1) + 1)"
          >
            下一页
          </ElButton>
        </div>
      </article>
      <nav
        v-if="pageCount > 1"
        class="settlement-pagination"
        aria-label="结算记录分页"
      >
        <ElButton
          native-type="button"
          :disabled="page <= 1"
          @click="emit('page-change', page - 1)"
        >
          上一页
        </ElButton>
        <span>{{ page }} / {{ pageCount }}</span>
        <ElButton
          native-type="button"
          :disabled="page >= pageCount"
          @click="emit('page-change', page + 1)"
        >
          下一页
        </ElButton>
      </nav>
      <div class="settlement-derived">
        <span>{{ pendingDisplay.label }}：{{ pendingDisplay.amount }}</span>
        <span>回款率：{{ rateLabel }}</span>
        <span class="settlement-derived__bar" aria-hidden="true"
          ><span :style="{ width: rateWidth }"
        /></span>
      </div>
    </div>

    <form
      class="settlement-register-form"
      v-if="
        !pending && (canRegister || (selectedRecord && canRead && canCorrect))
      "
      data-test="settlement-register-form"
      @submit.prevent="submit"
    >
      <h3>
        {{ editing ? `更正第 ${selectedRecord!.version} 版结算` : '登记结算' }}
      </h3>
      <p v-if="editing">
        日期：{{ selectedRecord!.currentVersion.settlementDate }}；金额：{{
          formatSettlementAmount(
            selectedRecord!.currentVersion.settlementAmount,
          )
        }}。完整事实和更正原因会形成新版本。
      </p>
      <label
        >结算日期<input
          v-model="settlementDate"
          type="date"
          data-test="settlement-date-input"
          required
      /></label>
      <label
        >结算金额<input
          v-model="settlementAmount"
          inputmode="decimal"
          data-test="settlement-amount-input"
          required
      /></label>
      <label
        ><input
          v-model="invoiceKnown"
          type="checkbox"
          data-test="settlement-invoice-known"
        />已知开票金额</label
      >
      <label v-if="invoiceKnown"
        >开票金额<input
          v-model="invoiceAmount"
          inputmode="decimal"
          data-test="settlement-invoice-input"
          required
      /></label>
      <label
        ><input
          v-model="receivedKnown"
          type="checkbox"
          data-test="settlement-received-known"
        />已知回款金额</label
      >
      <label v-if="receivedKnown"
        >回款金额<input
          v-model="receivedAmount"
          inputmode="decimal"
          data-test="settlement-received-input"
          required
      /></label>
      <label
        ><input
          v-model="receivedDateKnown"
          type="checkbox"
          data-test="settlement-received-date-known"
        />已知回款日期</label
      >
      <label v-if="receivedDateKnown"
        >回款日期<input
          v-model="receivedDate"
          type="date"
          data-test="settlement-received-date-input"
          required
      /></label>
      <label v-if="editing"
        >更正原因<textarea
          v-model="correctionReason"
          maxlength="500"
          data-test="settlement-correction-reason"
          required
        />
      </label>
      <p v-if="commandStatus === 'unknown'" role="alert">{{ message }}</p>
      <p
        v-else-if="commandStatus === 'conflict'"
        role="alert"
        data-test="settlement-conflict"
      >
        {{ message }}
      </p>
      <p v-else-if="message" role="status">{{ message }}</p>
      <div class="customer-form-actions">
        <ElButton
          v-if="commandStatus === 'unknown' && pending"
          native-type="button"
          data-test="settlement-retry-original"
          :disabled="busy"
          @click="retryPending"
        >
          按原请求重试
        </ElButton>
        <ElButton
          v-else
          native-type="submit"
          type="primary"
          :data-test="
            editing ? 'settlement-correct-submit' : 'settlement-register-submit'
          "
          :disabled="editing ? !canSubmitCorrection : !canSubmitRegister"
        >
          {{
            commandStatus === 'sending'
              ? '提交中'
              : editing
                ? '确认更正'
                : '登记结算'
          }}
        </ElButton>
        <ElButton
          v-if="editing && !pending"
          native-type="button"
          data-test="settlement-cancel-edit"
          :disabled="blockedByOtherMaintenance"
          @click="cancelDraft"
        >
          取消
        </ElButton>
      </div>
    </form>
    <p v-if="pending" data-test="settlement-private-retry-note">
      原请求已保留。恢复访问后可按原请求重试。
      <ElButton
        native-type="button"
        :data-test="
          canRead
            ? 'settlement-retry-original'
            : 'settlement-retry-original-private'
        "
        :disabled="busy"
        @click="retryPending"
      >
        按原请求重试
      </ElButton>
    </p>
    <p v-if="stale && canRead" role="status">结算台账需要只读刷新。</p>
    <p v-else-if="stale && canRegister" role="status">
      结算提交后的客户资料需要只读刷新。
    </p>
  </section>
</template>

<style scoped>
.settlement-panel {
  display: grid;
  gap: var(--s-3);
}
.settlement-panel__heading,
.settlement-record,
.settlement-record__facts,
.settlement-record__actions,
.settlement-pagination,
.settlement-derived {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}
.settlement-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-3);
}
.settlement-summary > div {
  display: grid;
  gap: var(--s-1);
  padding: var(--s-3);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}
.settlement-record {
  flex-wrap: wrap;
  padding: var(--s-3) 0;
  border-top: 1px solid var(--color-hairline);
}
.settlement-record__facts {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.settlement-record ol {
  flex-basis: 100%;
}
.settlement-pagination,
.settlement-derived {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.settlement-derived__bar {
  display: inline-block;
  width: 8rem;
  height: 0.5rem;
  overflow: hidden;
  border-radius: 99px;
  background: var(--color-hairline);
}
.settlement-derived__bar > span {
  display: block;
  height: 100%;
  background: var(--color-primary);
}
form {
  display: grid;
  gap: var(--s-2);
  padding-top: var(--s-3);
  border-top: 1px solid var(--color-hairline);
}
form label {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
form input:not([type='checkbox']),
form textarea {
  max-width: 24rem;
}
@media (max-width: 720px) {
  .settlement-summary {
    grid-template-columns: 1fr;
  }
}
</style>
