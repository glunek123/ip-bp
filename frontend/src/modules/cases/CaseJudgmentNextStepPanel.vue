<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  chooseCaseJudgmentNextStep,
  revokeCaseJudgmentNextStep,
  type CaseDetail,
  type LawyerCaseDetail,
  type ChooseCaseJudgmentNextStepInput,
  type RevokeCaseJudgmentNextStepInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type PanelItem = Pick<
  CaseDetail | LawyerCaseDetail,
  | 'id'
  | 'stage'
  | 'version'
  | 'canChooseJudgmentNextStep'
  | 'canRevokeJudgmentNextStep'
  | 'rightsHolder'
  | 'defendants'
  | 'judgment'
  | 'judgmentNextStep'
>;
type PendingCommand =
  | { kind: 'choose'; input: ChooseCaseJudgmentNextStepInput }
  | { kind: 'revoke'; input: RevokeCaseJudgmentNextStepInput };
const props = defineProps<{
  item: PanelItem;
  contextKey: string;
  lawyer?: boolean;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();
const path = ref<'' | 'APPEAL' | 'EXECUTION'>('');
const plaintiffAppeals = ref(false);
const defendantIds = ref(new Set<string>());
const readinessConfirmed = ref(false);
const revokeReason = ref('');
const pending = ref(false);
const pendingUnknown = ref<PendingCommand | null>(null);
const error = ref('');
const success = ref('');
const confirmation = ref<'' | 'choose' | 'revoke'>('');
let revision = 0;
let mounted = true;

const current = computed(() => props.item.judgmentNextStep.current);
const canChoose = computed(
  () =>
    props.item.judgment.current !== null &&
    current.value === null &&
    props.item.stage === 'WAITING_JUDGMENT' &&
    props.item.canChooseJudgmentNextStep,
);
const canRevoke = computed(
  () =>
    !props.lawyer &&
    props.item.canRevokeJudgmentNextStep &&
    current.value !== null &&
    (props.item.stage === 'SECOND_INSTANCE' ||
      props.item.stage === 'WAITING_EXECUTION_DOCUMENTS'),
);
const validAppeal = computed(
  () =>
    path.value === 'APPEAL' &&
    (plaintiffAppeals.value || defendantIds.value.size > 0),
);
const readyToChoose = computed(
  () =>
    canChoose.value &&
    pendingUnknown.value === null &&
    !pending.value &&
    (path.value === 'APPEAL'
      ? validAppeal.value
      : path.value === 'EXECUTION' && readinessConfirmed.value),
);
const readyToRevoke = computed(
  () =>
    canRevoke.value &&
    pendingUnknown.value === null &&
    !pending.value &&
    revokeReason.value.trim().length >= 1 &&
    revokeReason.value.trim().length <= 500,
);
const hasHistory = computed(
  () => props.item.judgmentNextStep.history.length > 0,
);
function revocationReason(
  revocation: PanelItem['judgmentNextStep']['revocations'][number],
): string | undefined {
  return 'reason' in revocation ? revocation.reason : undefined;
}
const selectedDefendants = computed(() =>
  props.item.defendants.filter((item) => defendantIds.value.has(item.id)),
);
const commandSummary = computed(() =>
  path.value === 'EXECUTION'
    ? '案件将转入“待写执行材料”。这只表示进入材料准备，不代表已经申请强制执行。'
    : `案件将转入“二审”。上诉方：${[
        ...(plaintiffAppeals.value ? ['原告方'] : []),
        ...selectedDefendants.value.map(
          (item) => `${item.name}（${item.id.slice(0, 8)}）`,
        ),
      ].join('、')}。`,
);

watch(
  [() => props.item.id, () => props.contextKey],
  () => {
    revision += 1;
    path.value = '';
    plaintiffAppeals.value = false;
    defendantIds.value = new Set();
    readinessConfirmed.value = false;
    revokeReason.value = '';
    pending.value = false;
    pendingUnknown.value = null;
    error.value = '';
    success.value = '';
    confirmation.value = '';
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  mounted = false;
  revision += 1;
});

function capture() {
  return { id: props.item.id, contextKey: props.contextKey, revision };
}
function currentContext(context: ReturnType<typeof capture>): boolean {
  return (
    mounted &&
    context.revision === revision &&
    context.id === props.item.id &&
    context.contextKey === props.contextKey
  );
}
function isUnknown(reason: unknown): boolean {
  return (
    reason instanceof ApiError &&
    (reason.status >= 500 ||
      [
        'NETWORK_ERROR',
        'TIMEOUT',
        'INTERNAL_ERROR',
        'INVALID_RESPONSE',
      ].includes(reason.code))
  );
}
function toggleDefendant(id: string, checked: boolean): void {
  const next = new Set(defendantIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  defendantIds.value = next;
}
function makeChoiceInput(): ChooseCaseJudgmentNextStepInput {
  const common = {
    expectedVersion: props.item.version,
    idempotencyKey: globalThis.crypto.randomUUID(),
    judgmentId: props.item.judgment.current!.id,
  };
  return path.value === 'EXECUTION'
    ? { ...common, next: 'EXECUTION', executionReadinessConfirmed: true }
    : {
        ...common,
        next: 'APPEAL',
        plaintiffAppeals: plaintiffAppeals.value,
        defendantIds: props.item.defendants
          .filter((item) => defendantIds.value.has(item.id))
          .map((item) => item.id),
      };
}
function openChoiceConfirmation(): void {
  if (!readyToChoose.value) return;
  error.value = '';
  confirmation.value = 'choose';
}
function openRevokeConfirmation(): void {
  if (!readyToRevoke.value) return;
  error.value = '';
  confirmation.value = 'revoke';
}
async function send(command: PendingCommand): Promise<void> {
  const context = capture();
  pending.value = true;
  error.value = '';
  success.value = '';
  confirmation.value = '';
  try {
    if (command.kind === 'choose')
      await chooseCaseJudgmentNextStep(
        context.id,
        command.input,
        props.lawyer ? 'lawyer' : 'internal',
      );
    else await revokeCaseJudgmentNextStep(context.id, command.input);
    if (!currentContext(context)) return;
    pendingUnknown.value = null;
    success.value =
      command.kind === 'choose'
        ? '选择已登记，正在读取最新案件详情。'
        : '选择已撤销，正在读取最新案件详情。';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!currentContext(context)) return;
    if (isUnknown(reason)) {
      pendingUnknown.value = command;
      error.value =
        '操作结果未知。请保留本次请求，并用相同请求安全重试；刷新详情不能确认提交结果。';
    } else if (
      reason instanceof ApiError &&
      (reason.status === 409 ||
        ['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
          reason.code,
        ))
    ) {
      pendingUnknown.value = null;
      error.value =
        '案件版本或状态已变化。旧请求未自动改用新版本，请刷新并核对后重新填写。';
      emit('refresh');
    } else if (
      reason instanceof ApiError &&
      (reason.status === 403 || reason.status === 404)
    ) {
      pendingUnknown.value = null;
      error.value = '当前账号已不能办理此案件，正在核对访问权限。';
      emit('refresh');
    } else {
      error.value = '操作未完成，请核对案件详情后重试。';
    }
  } finally {
    if (currentContext(context)) pending.value = false;
  }
}
async function confirmChoice(): Promise<void> {
  if (!readyToChoose.value || confirmation.value !== 'choose') return;
  await send({ kind: 'choose', input: makeChoiceInput() });
}
async function confirmRevoke(): Promise<void> {
  if (!readyToRevoke.value || confirmation.value !== 'revoke' || !current.value)
    return;
  await send({
    kind: 'revoke',
    input: {
      expectedVersion: props.item.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      choiceId: current.value.id,
      reason: revokeReason.value.trim(),
    },
  });
}
async function retryUnknown(): Promise<void> {
  const command = pendingUnknown.value;
  if (!command || pending.value) return;
  await send(command);
}
function stageName(stage: string): string {
  return stage === 'APPEAL' ? '二审' : '待写执行材料';
}
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="case-judgment-next-step-panel"
  >
    <h2 class="form-section-title">判决后续选择</h2>
    <p>
      本操作只登记本案的后续路径。已登记的一审判决不会被更改；系统不会推断判决生效时间。
    </p>

    <div v-if="current" class="form-stack" data-test="current-next-step">
      <p role="status">
        当前路径：<strong>{{ stageName(current.next) }}</strong>
      </p>
      <p v-if="current.next === 'EXECUTION'">
        办理人已确认核实本案可进入执行准备；这不代表已经申请强制执行。
      </p>
      <p v-if="current.next === 'APPEAL'">
        上诉方：{{
          [
            ...(current.plaintiffRightsHolderId
              ? [`原告方（${current.plaintiffName}）`]
              : []),
            ...current.defendants.map(
              (defendant) =>
                `${defendant.nameSnapshot}（${defendant.defendantId.slice(0, 8)}）`,
            ),
          ].join('、')
        }}
      </p>
    </div>

    <form
      v-if="canChoose && pendingUnknown === null"
      class="form-stack"
      @submit.prevent="openChoiceConfirmation"
    >
      <fieldset :disabled="pending">
        <legend>选择一条后续路径 <span class="required-mark">*</span></legend>
        <label
          ><input
            v-model="path"
            type="radio"
            name="judgment-next"
            value="APPEAL"
          />
          进入二审</label
        >
        <label
          ><input
            v-model="path"
            type="radio"
            name="judgment-next"
            value="EXECUTION"
          />
          转入执行准备</label
        >
      </fieldset>
      <div v-if="path === 'APPEAL'" class="form-stack">
        <p>
          请选择真实上诉方。可选择原告方、一个或多个本案被告，也可同时选择双方；不预先勾选。
        </p>
        <label
          ><input
            v-model="plaintiffAppeals"
            type="checkbox"
            data-plaintiff-appeals="true"
          />
          原告方（{{ item.rightsHolder.name }}）</label
        >
        <label v-for="defendant in item.defendants" :key="defendant.id">
          <input
            type="checkbox"
            :checked="defendantIds.has(defendant.id)"
            :data-defendant-id="defendant.id"
            @change="
              toggleDefendant(
                defendant.id,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          {{ defendant.name }}（身份编号 {{ defendant.id.slice(0, 8) }}）
        </label>
      </div>
      <label v-if="path === 'EXECUTION'">
        <input v-model="readinessConfirmed" type="checkbox" />
        已核实本案可进入执行准备 <span class="required-mark">*</span>
      </label>
      <p>进入执行准备只进入材料准备，不代表已申请执行。</p>
      <button type="submit" :disabled="!readyToChoose">核对并提交选择</button>
    </form>

    <div v-if="canRevoke" class="form-stack">
      <p>
        撤销后案件将退回“待判决”，并保留选择与撤销历史。获权运营可在之后更正判决并重新选择。
      </p>
      <label
        >撤销原因 <span class="required-mark">*</span>
        <textarea
          v-model="revokeReason"
          data-revoke-reason
          maxlength="500"
          rows="3"
        />
      </label>
      <button
        type="button"
        data-revoke-choice
        :disabled="!readyToRevoke"
        @click="openRevokeConfirmation"
      >
        核对并撤销选择
      </button>
    </div>

    <div v-if="pendingUnknown" class="form-stack" role="status">
      <p>原请求仍待核对。案件版本变化时也保留原请求与请求键。</p>
      <button
        type="button"
        data-retry-choice
        :disabled="pending"
        @click="retryUnknown"
      >
        使用原请求和请求键重试
      </button>
    </div>

    <details v-if="hasHistory">
      <summary>
        判决后续选择历史（{{ item.judgmentNextStep.history.length }}）
      </summary>
      <ol>
        <li v-for="choice in item.judgmentNextStep.history" :key="choice.id">
          {{ stageName(choice.next) }}，判决 {{ choice.judgmentId }}，版本
          {{ choice.fromVersion }} → {{ choice.toVersion }}，{{
            choice.recordedAt
          }}
        </li>
      </ol>
      <ol v-if="item.judgmentNextStep.revocations.length">
        <li
          v-for="revocation in item.judgmentNextStep.revocations"
          :key="revocation.id"
        >
          已撤销选择 {{ revocation.choiceId }}，版本
          {{ revocation.fromVersion }} → {{ revocation.toVersion }}，{{
            revocation.recordedAt
          }}<template v-if="revocationReason(revocation)"
            >；原因：{{ revocationReason(revocation) }}</template
          >
        </li>
      </ol>
    </details>

    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div
      v-if="confirmation"
      role="dialog"
      aria-modal="true"
      aria-label="确认案件操作"
      class="form-stack"
    >
      <p>
        {{
          confirmation === 'choose'
            ? commandSummary
            : '撤销后案件将退回待判决，保留原选择和撤销原因。'
        }}
      </p>
      <button
        v-if="confirmation === 'choose'"
        type="button"
        data-confirm-choice
        :disabled="pending"
        @click="confirmChoice"
      >
        确认提交
      </button>
      <button
        v-else
        type="button"
        data-confirm-revoke
        :disabled="pending"
        @click="confirmRevoke"
      >
        确认撤销
      </button>
      <button type="button" @click="confirmation = ''">取消</button>
    </div>
  </section>
</template>
