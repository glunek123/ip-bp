<script setup lang="ts">
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  changeCustomerCooperation,
  listEligibleOperators,
  transferCustomerResponsible,
  type CooperationAction,
  type CustomerMaintenanceResult,
  type EligibleOperator,
} from '../../api/customer-cooperation';
import { getCustomer, type CustomerDetail } from '../../api/customers';
import {
  clearPendingCustomerMaintenance,
  readPendingCustomerMaintenance,
  savePendingCustomerMaintenance,
  type PendingCustomerMaintenance,
} from './customer-maintenance-pending';

type Actor = {
  userId: string;
  departmentId: string;
  authorizationRevision?: number;
};
const props = defineProps<{
  customer: CustomerDetail;
  actor: Actor | null;
  blockedByOtherMaintenance: boolean;
}>();
const emit = defineEmits<{
  refreshed: [customer: CustomerDetail];
  unreadable: [customerId: string];
  pendingChanged: [pending: boolean];
  refreshRequired: [required: boolean];
  accessUncertain: [customerId: string];
}>();

const selectedAction = ref<CooperationAction | 'responsible-transfer' | null>(
  null,
);
const reason = ref('');
const targetUserId = ref('');
const operators = ref<EligibleOperator[]>([]);
const page = ref(0);
const totalOperators = ref(0);
const loadingOperators = ref(false);
const status = ref<
  'idle' | 'submitting' | 'unknown' | 'conflict' | 'refresh-failed'
>('idle');
const frozen = ref<PendingCustomerMaintenance>();
const successMessage = ref('');
const refreshFailed = ref(false);
const confirmedWrite = ref(false);
let generation = 0;

const cooperationLabel = computed(() =>
  props.customer.cooperationStatus === 'COOPERATING'
    ? '合作中'
    : props.customer.cooperationStatus === 'PAUSED'
      ? '已暂停合作'
      : '已终止合作',
);
const canStartAction = computed(
  () =>
    !props.blockedByOtherMaintenance &&
    status.value === 'idle' &&
    !frozen.value,
);
const actorKey = computed(() =>
  props.actor
    ? `${props.actor.userId}:${props.actor.departmentId}:${props.actor.authorizationRevision ?? 0}`
    : '',
);

function identity(action: PendingCustomerMaintenance['action']) {
  if (!props.actor) return undefined;
  return {
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customer.id,
    action,
  };
}

function restorePending(): void {
  generation += 1;
  selectedAction.value = null;
  reason.value = '';
  targetUserId.value = '';
  operators.value = [];
  loadingOperators.value = false;
  successMessage.value = '';
  refreshFailed.value = false;
  frozen.value = undefined;
  for (const action of [
    'responsible-transfer',
    'pause',
    'terminate',
    'resume',
  ] as const) {
    const key = identity(action);
    const command = key ? readPendingCustomerMaintenance(key) : undefined;
    if (command) {
      frozen.value = command;
      selectedAction.value = action;
      reason.value = command.body.reason ?? '';
      targetUserId.value =
        'targetUserId' in command.body ? command.body.targetUserId : '';
      status.value = 'unknown';
      break;
    }
  }
  emit('pendingChanged', frozen.value !== undefined);
}

watch(() => `${props.customer.id}:${actorKey.value}`, restorePending, {
  immediate: true,
});
onBeforeUnmount(() => {
  generation += 1;
});

function openAction(action: CooperationAction | 'responsible-transfer'): void {
  if (!canStartAction.value) return;
  confirmedWrite.value = false;
  refreshFailed.value = false;
  selectedAction.value = action;
  reason.value = '';
  targetUserId.value = '';
  successMessage.value = '';
  if (action === 'responsible-transfer') void loadOperators(true);
}

async function loadOperators(reset = false): Promise<void> {
  if (loadingOperators.value || !props.actor) return;
  if (reset) {
    operators.value = [];
    page.value = 0;
    totalOperators.value = 0;
  }
  const nextPage = page.value + 1;
  const requestGeneration = generation;
  const customerId = props.customer.id;
  const identityAtStart = actorKey.value;
  loadingOperators.value = true;
  try {
    const result = await listEligibleOperators(customerId, nextPage, 20);
    if (
      requestGeneration !== generation ||
      customerId !== props.customer.id ||
      identityAtStart !== actorKey.value
    )
      return;
    const known = new Set(operators.value.map((operator) => operator.id));
    operators.value = [
      ...operators.value,
      ...result.items.filter((operator) => !known.has(operator.id)),
    ];
    page.value = result.page;
    totalOperators.value = result.total;
  } catch {
    if (requestGeneration === generation)
      successMessage.value = '运营名单暂时无法加载，请重试。';
  } finally {
    if (requestGeneration === generation) loadingOperators.value = false;
  }
}

function makeCommand(): PendingCustomerMaintenance | undefined {
  if (!props.actor || !selectedAction.value) return undefined;
  const expectedVersion = props.customer.version;
  const trimmedReason = reason.value.trim();
  let body: PendingCustomerMaintenance['body'];
  if (selectedAction.value === 'responsible-transfer') {
    if (!targetUserId.value) {
      successMessage.value = '请选择新的负责运营。';
      return undefined;
    }
    if (trimmedReason.length < 1 || trimmedReason.length > 500) {
      successMessage.value = '请填写1至500字的原因。';
      return undefined;
    }
    body = {
      expectedVersion,
      targetUserId: targetUserId.value,
      reason: trimmedReason,
    };
  } else {
    const action = selectedAction.value;
    if (
      action !== 'resume' &&
      (trimmedReason.length < 1 || trimmedReason.length > 500)
    ) {
      successMessage.value = '请填写1至500字的原因。';
      return undefined;
    }
    if (trimmedReason.length > 500) {
      successMessage.value = '原因不能超过500字。';
      return undefined;
    }
    body = {
      expectedVersion,
      action,
      ...(trimmedReason.length > 0 ? { reason: trimmedReason } : {}),
    };
  }
  return {
    action: selectedAction.value,
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customer.id,
    expectedVersion,
    body,
    key: globalThis.crypto.randomUUID(),
  };
}

function isCurrent(
  requestGeneration: number,
  customerId: string,
  identityAtStart: string,
): boolean {
  return (
    requestGeneration === generation &&
    customerId === props.customer.id &&
    identityAtStart === actorKey.value
  );
}

async function submit(): Promise<void> {
  if (status.value === 'submitting' || props.blockedByOtherMaintenance) return;
  let command = frozen.value;
  if (!command) {
    command = makeCommand();
    if (!command) return;
    try {
      savePendingCustomerMaintenance(command);
    } catch {
      successMessage.value = '无法保存维护请求，请检查当前浏览器存储后重试。';
      return;
    }
    frozen.value = command;
    emit('pendingChanged', true);
  }
  status.value = 'submitting';
  const requestGeneration = generation;
  const customerId = command.customerId;
  const identityAtStart = actorKey.value;
  try {
    const result: CustomerMaintenanceResult =
      command.action === 'responsible-transfer'
        ? await transferCustomerResponsible(
            command.customerId,
            command.body as Extract<
              PendingCustomerMaintenance['body'],
              { targetUserId: string }
            >,
            command.key,
          )
        : await changeCustomerCooperation(
            command.customerId,
            command.body as Extract<
              PendingCustomerMaintenance['body'],
              { action: CooperationAction }
            >,
            command.key,
          );
    if (!isCurrent(requestGeneration, customerId, identityAtStart)) return;
    clearPendingCustomerMaintenance(command);
    frozen.value = undefined;
    confirmedWrite.value = true;
    emit('pendingChanged', false);
    successMessage.value = '客户维护已成功。';
    if (!result.canReadAfter) {
      successMessage.value = '维护已成功，当前账号已无法继续查看客户资料。';
      emit('unreadable', customerId);
      return;
    }
    await refreshCurrentCustomer(
      requestGeneration,
      customerId,
      identityAtStart,
      true,
    );
  } catch (error) {
    if (!isCurrent(requestGeneration, customerId, identityAtStart)) return;
    if (
      error instanceof ApiError &&
      (error.code === 'CUSTOMER_VERSION_CONFLICT' ||
        error.code === 'CUSTOMER_COOPERATION_STATE_CONFLICT')
    ) {
      clearPendingCustomerMaintenance(command);
      frozen.value = undefined;
      confirmedWrite.value = false;
      emit('pendingChanged', false);
      emit('refreshRequired', true);
      status.value = 'conflict';
      successMessage.value = '客户资料或合作状态已变化。请先刷新当前资料。';
      return;
    }
    status.value = 'unknown';
    successMessage.value = '维护结果尚未确认，原请求已保留。可按原请求重试。';
    if (
      error instanceof ApiError &&
      (error.status === 403 ||
        error.status === 404 ||
        error.code === 'CUSTOMER_NOT_FOUND')
    ) {
      emit('accessUncertain', customerId);
    }
  }
}

async function refreshCurrentCustomer(
  requestGeneration = generation,
  customerId = props.customer.id,
  identityAtStart = actorKey.value,
  afterSuccess = false,
): Promise<void> {
  try {
    const latest = await getCustomer(customerId);
    if (!isCurrent(requestGeneration, customerId, identityAtStart)) return;
    emit('refreshed', latest);
    emit('refreshRequired', false);
    status.value = 'idle';
    refreshFailed.value = false;
    successMessage.value = confirmedWrite.value
      ? '客户维护已成功，资料已刷新。'
      : '';
    if (afterSuccess) selectedAction.value = null;
  } catch {
    if (!isCurrent(requestGeneration, customerId, identityAtStart)) return;
    if (afterSuccess) {
      refreshFailed.value = true;
      status.value = 'refresh-failed';
      emit('refreshRequired', true);
      successMessage.value = '维护已成功，当前资料刷新失败。';
      selectedAction.value = null;
    } else {
      status.value = 'refresh-failed';
      refreshFailed.value = true;
      successMessage.value = confirmedWrite.value
        ? '维护已成功，当前资料刷新失败。'
        : '当前资料刷新失败，请稍后只读重试。';
    }
  }
}

function cancel(): void {
  if (frozen.value || status.value !== 'idle') return;
  selectedAction.value = null;
  reason.value = '';
  targetUserId.value = '';
  successMessage.value = '';
}
</script>

<template>
  <section class="ledger-panel detail-card" data-test="cooperation-panel">
    <h2>合作与负责运营</h2>
    <dl class="detail-grid">
      <div>
        <dt>合作状态</dt>
        <dd>{{ cooperationLabel }}</dd>
      </div>
      <div>
        <dt>负责运营</dt>
        <dd>{{ customer.responsibleOperator.displayName }}</dd>
      </div>
    </dl>
    <p v-if="blockedByOtherMaintenance" role="status">
      其他客户维护结果尚未确认，暂不能提交新的客户维护。
    </p>
    <template v-if="actor && !blockedByOtherMaintenance">
      <div class="cooperation-actions">
        <ElButton
          v-if="customer.cooperationCapabilities.transfer"
          native-type="button"
          data-test="transfer-open"
          :disabled="!canStartAction"
          @click="openAction('responsible-transfer')"
        >
          转派负责运营
        </ElButton>
        <ElButton
          v-if="
            customer.cooperationCapabilities.pause &&
            customer.cooperationStatus === 'COOPERATING'
          "
          native-type="button"
          data-test="pause-open"
          :disabled="!canStartAction"
          @click="openAction('pause')"
        >
          暂停合作
        </ElButton>
        <ElButton
          v-if="
            customer.cooperationCapabilities.terminate &&
            customer.cooperationStatus !== 'TERMINATED'
          "
          native-type="button"
          data-test="terminate-open"
          :disabled="!canStartAction"
          @click="openAction('terminate')"
        >
          终止合作
        </ElButton>
        <ElButton
          v-if="
            customer.cooperationCapabilities.resume &&
            customer.cooperationStatus !== 'COOPERATING'
          "
          native-type="button"
          data-test="resume-open"
          :disabled="!canStartAction"
          @click="openAction('resume')"
        >
          恢复合作
        </ElButton>
      </div>
      <form
        v-if="selectedAction"
        data-test="maintenance-form"
        @submit.prevent="submit"
      >
        <label v-if="selectedAction === 'responsible-transfer'"
          >新的负责运营
          <select
            v-model="targetUserId"
            data-test="operator-select"
            :disabled="!!frozen"
          >
            <option value="">请选择运营</option>
            <option
              v-for="operator in operators"
              :key="operator.id"
              :value="operator.id"
            >
              {{ operator.displayName
              }}{{ operator.teamName ? ` · ${operator.teamName}` : '' }}
            </option>
          </select>
        </label>
        <ElButton
          v-if="
            selectedAction === 'responsible-transfer' &&
            operators.length < totalOperators
          "
          native-type="button"
          :disabled="loadingOperators"
          data-test="operators-more"
          @click="loadOperators()"
        >
          加载更多运营
        </ElButton>
        <label v-if="selectedAction !== 'resume'"
          >原因
          <textarea
            v-model="reason"
            maxlength="500"
            :disabled="!!frozen"
            data-test="maintenance-reason"
          />
        </label>
        <label v-else
          >原因（选填）
          <textarea
            v-model="reason"
            maxlength="500"
            :disabled="!!frozen"
            data-test="maintenance-reason"
          />
        </label>
        <p v-if="status === 'unknown'" role="alert">
          维护结果尚未确认，原请求已保留。
        </p>
        <p v-if="status === 'conflict'" role="alert">
          请先刷新资料，再决定是否发起新的维护。
        </p>
        <ElButton
          native-type="submit"
          type="primary"
          data-test="maintenance-submit"
          :disabled="
            status === 'submitting' ||
            status === 'conflict' ||
            blockedByOtherMaintenance ||
            (status === 'unknown' && !frozen)
          "
        >
          {{ status === 'unknown' ? '按原请求重试' : '确认维护' }}
        </ElButton>
        <ElButton
          v-if="status === 'conflict'"
          native-type="button"
          data-test="maintenance-refresh-conflict"
          @click="refreshCurrentCustomer()"
        >
          刷新客户资料
        </ElButton>
        <ElButton
          v-if="status === 'idle' && !frozen"
          native-type="button"
          @click="cancel"
        >
          取消
        </ElButton>
      </form>
    </template>
    <p v-if="successMessage" role="status">{{ successMessage }}</p>
    <ElButton
      v-if="refreshFailed"
      native-type="button"
      data-test="maintenance-refresh-readonly"
      @click="refreshCurrentCustomer()"
    >
      只读重试刷新
    </ElButton>
  </section>
</template>

<style scoped>
.cooperation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
[data-test='maintenance-form'] {
  display: grid;
  gap: var(--s-3);
  margin-top: var(--s-4);
}
[data-test='maintenance-form'] label {
  display: grid;
  gap: var(--s-1);
}
[data-test='maintenance-form'] textarea {
  min-height: 5rem;
}
</style>
