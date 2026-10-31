<script lang="ts">
import { reactive } from 'vue';
import type {
  RegisterCaseSettlementActualInput,
  SettlementActualCommandResult,
  SettlementActualCommand,
  SettlementActualCandidate,
} from '../../api/settlement-actual-registration';
type PendingActual = {
  command: SettlementActualCommand;
  status: 'sending' | 'unknown' | 'confirmed';
  result?: SettlementActualCommandResult;
  delivered: boolean;
};
// Session memory only. Never transfer a request between principals or cases.
const pendingActuals = new Map<string, PendingActual>();
</script>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Form from './CaseSettlementActualForm.vue';
import {
  registerCaseSettlementActual,
  sendSettlementActualCommand,
  settlementActualCandidates,
} from '../../api/settlement-actual-registration';
import { ApiError } from '../../api/http';
import type { ListWorkflowSession } from '../../app/list-workflow-context';

const props = defineProps<{
  actorKey: string;
  caseId: string;
  actualRegistrationLawyers: ReadonlyArray<{ id: string; fullName: string }>;
  session?: ListWorkflowSession;
}>();
const emit = defineEmits<{
  registered: [result: SettlementActualCommandResult];
  cancel: [];
}>();
const pending = ref<PendingActual | null>(null);
const selectedLawyer = ref('');
const requestKey = ref('');
const error = ref('');
const mode = ref<'register' | 'create' | 'allocate'>('register');
const candidates = ref<SettlementActualCandidate[]>([]);
const candidatesLoading = ref(false);
const selectedFact = ref('');
const allocationAmount = ref('');
async function loadCandidates() {
  const token = generation;
  candidates.value = [];
  selectedFact.value = '';
  candidatesLoading.value = true;
  try {
    const rows = await settlementActualCandidates(props.caseId);
    if (current(token)) candidates.value = rows;
  } catch {
    if (current(token)) error.value = '可分配款项读取失败，请重试读取。';
  } finally {
    if (current(token)) candidatesLoading.value = false;
  }
}
watch(mode, (value) => {
  if (value === 'allocate' && !pending.value) void loadCandidates();
});
let generation = 0;
onBeforeUnmount(() => generation++);
const identity = () => JSON.stringify([props.actorKey, props.caseId]);
const current = (token: number) =>
  token === generation &&
  (!props.session ||
    (props.session.isCurrent() &&
      props.session.context.recordId === props.caseId &&
      props.session.context.actorKey === props.actorKey));
const lawyerId = computed(() =>
  props.actualRegistrationLawyers.some((l) => l.id === selectedLawyer.value)
    ? selectedLawyer.value
    : null,
);

function deliver(command: PendingActual, token: number) {
  if (!current(token) || command.delivered || !command.result) return;
  const commandIdentity = identity();
  command.delivered = true;
  // Complete this independent command without closing the outer editor.
  if (
    (props.session && !props.session.endSubmit('completed')) ||
    !current(token)
  ) {
    command.delivered = false;
    return;
  }
  pendingActuals.delete(commandIdentity);
  pending.value = null;
  error.value = '';
  selectedLawyer.value = '';
  requestKey.value = globalThis.crypto.randomUUID();
  emit('registered', command.result);
}
watch(
  () => [props.actorKey, props.caseId, props.session],
  () => {
    const token = ++generation;
    mode.value = 'register';
    candidates.value = [];
    selectedFact.value = '';
    allocationAmount.value = '';
    selectedLawyer.value = '';
    requestKey.value = globalThis.crypto.randomUUID();
    error.value = '';
    pending.value = pendingActuals.get(identity()) ?? null;
    if (!current(token) || !pending.value) return;
    // A remount can inherit this very command while the original POST is still
    // in flight. Preserve its lock as unknown until its receipt or exact retry.
    props.session?.endSubmit('unknown');
    props.session?.restoreUnknown();
    if (pending.value.status === 'sending') pending.value.status = 'unknown';
    if (pending.value.status === 'confirmed') {
      if (props.session && !props.session.beginSubmit({ recovery: true }))
        return;
      deliver(pending.value, token);
    }
  },
  { immediate: true },
);
watch(
  () => pending.value?.status,
  (status) => {
    const command = pending.value;
    if (status !== 'confirmed' || !command || !current(generation)) return;
    // A predecessor view may finish the original request after this one mounts.
    if (props.session && !props.session.beginSubmit({ recovery: true })) return;
    deliver(command, generation);
  },
);
watch(
  () => props.actualRegistrationLawyers,
  () => {
    if (pending.value) return; // The original command remains frozen for recovery.
    selectedLawyer.value = '';
    requestKey.value = globalThis.crypto.randomUUID();
  },
);

async function send(
  command: PendingActual,
  recovery: boolean,
  admitted = false,
) {
  const token = generation;
  if (!current(token)) return;
  if (!admitted && props.session && !props.session.beginSubmit({ recovery }))
    return;
  command.status = 'sending';
  const commandIdentity = identity();
  try {
    const result =
      command.command.kind === 'register'
        ? await registerCaseSettlementActual(command.command.input)
        : await sendSettlementActualCommand(command.command);
    command.result = result;
    command.status = 'confirmed';
    deliver(command, token);
  } catch (cause) {
    const uncertain =
      recovery ||
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.code === 'INVALID_RESPONSE';
    if (uncertain || !current(token)) {
      command.status = 'unknown';
      if (current(token)) {
        props.session?.endSubmit('unknown');
        error.value =
          '登记结果未确认，只能重试原请求。刷新页面会丢失本次会话的恢复信息。';
      }
    } else {
      pendingActuals.delete(commandIdentity);
      pending.value = null;
      props.session?.endSubmit('failed');
      requestKey.value = globalThis.crypto.randomUUID();
      error.value = '登记被拒绝。请核对权限、当前律师和资料后重新填写。';
    }
  }
}
async function submit(input: RegisterCaseSettlementActualInput) {
  if (
    pending.value ||
    mode.value === 'allocate' ||
    !current(generation) ||
    input.caseId !== props.caseId ||
    input.idempotencyKey !== requestKey.value ||
    (input.side === 'LAWYER' && input.lawyerId !== lawyerId.value)
  )
    return;
  if (props.session && !props.session.beginSubmit()) return;
  const command = reactive<PendingActual>({
    command: {
      kind: mode.value === 'create' ? 'create' : 'register',
      input: Object.freeze({ ...input }),
    },
    status: 'sending',
    delivered: false,
  });
  pending.value = command;
  pendingActuals.set(identity(), command);
  await send(command, false, true);
}
async function allocate() {
  const fact = candidates.value.find((row) => row.id === selectedFact.value);
  if (
    pending.value ||
    mode.value !== 'allocate' ||
    !current(generation) ||
    !fact ||
    candidatesLoading.value ||
    !/^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/u.test(
      allocationAmount.value,
    )
  )
    return;
  if (props.session && !props.session.beginSubmit()) return;
  const command = reactive<PendingActual>({
    command: {
      kind: 'allocate',
      input: Object.freeze({
        factId: fact.id,
        caseId: props.caseId,
        amount: allocationAmount.value,
        idempotencyKey: requestKey.value,
      }),
    },
    status: 'sending',
    delivered: false,
  });
  pending.value = command;
  pendingActuals.set(identity(), command);
  await send(command, false, true);
}
function retry() {
  if (pending.value?.status === 'unknown') void send(pending.value, true);
}
function cancel() {
  if (!pending.value && current(generation)) emit('cancel');
}
</script>
<template>
  <section>
    <p>
      逐笔登记真实回款或律师实际开票。同一笔款项可按案件分配，不能重复登记。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="!pending">
      <label
        >办理方式<select v-model="mode" data-test="mode">
          <option value="register">登记并全额计入本案</option>
          <option value="create">登记待分配款项</option>
          <option value="allocate">分配已登记款项</option>
        </select></label
      >
      <template v-if="mode === 'allocate'">
        <label
          >已登记款项<select
            v-model="selectedFact"
            data-test="fact"
            :disabled="candidatesLoading"
          >
            <option value="">请选择本人登记的可分配款项</option>
            <option v-for="fact in candidates" :key="fact.id" :value="fact.id">
              {{ fact.side === 'CUSTOMER' ? '客户回款' : '律师开票' }} ·
              {{ fact.occurredOn }} ·
              {{ fact.sourceReference || '未填来源编号' }} · 总额
              {{ fact.amount }}，剩余 {{ fact.remainingAmount }} 元
            </option>
          </select></label
        >
        <button
          type="button"
          @click="loadCandidates"
          :disabled="candidatesLoading"
        >
          重新读取可分配款项
        </button>
        <label
          >本案分配金额（元）<input
            v-model="allocationAmount"
            data-test="allocation-amount"
            inputmode="decimal"
        /></label>
        <button
          data-test="allocate"
          :disabled="!selectedFact || candidatesLoading"
          @click="allocate"
        >
          确认分配至本案
        </button>
        <button @click="cancel">取消</button>
      </template>
      <template v-else>
        <p v-if="mode === 'create'">
          本次只登记真实总额，尚未分配，不计入本案已回款／开票；登记成功后再选择“分配已登记款项”。
        </p>
        <label
          >开票律师
          <select v-model="selectedLawyer" data-test="lawyer">
            <option value="">请明确选择当前律师</option>
            <option
              v-for="lawyer in actualRegistrationLawyers"
              :key="lawyer.id"
              :value="lawyer.id"
            >
              {{ lawyer.fullName }}
            </option>
          </select>
        </label>
        <p v-if="!actualRegistrationLawyers.length">
          当前没有有效律师，仍可登记客户回款。
        </p>
        <Form
          :key="requestKey"
          :case-id="caseId"
          :unallocated="mode === 'create'"
          :lawyer-id="lawyerId"
          :idempotency-key="requestKey"
          @submit="submit"
          @cancel="cancel"
        />
      </template>
    </template>
    <p v-else-if="pending.status === 'sending'" role="status">
      正在确认登记结果…
    </p>
    <button
      v-else-if="pending.status === 'unknown'"
      data-test="retry"
      @click="retry"
    >
      重试原实际登记请求
    </button>
  </section>
</template>
