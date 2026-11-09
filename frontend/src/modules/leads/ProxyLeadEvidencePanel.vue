<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  confirmProxyLeadEvidence,
  getLead,
  type LeadDetail,
} from '../../api/leads';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import { ApiError } from '../../api/http';

type Choice = 'EVIDENCE' | 'NO_EVIDENCE';
type Frozen = {
  identity: string;
  leadId: string;
  key: string;
  result: Choice;
  reason: string | null;
  expectedVersion: number;
};
const props = defineProps<{
  leadId: string;
  identity: string;
  detail: LeadDetail;
}>();
const emit = defineEmits<{ completed: [] }>();
const open = ref(false);
const choice = ref<Choice>('EVIDENCE');
const reason = ref('');
const message = ref('');
const storageKey = 'lead-proxy-evidence-confirmation-v1';
const stableIdentity = (identity: string) =>
  identity.split(':').slice(0, 3).join(':');
const keyFor = (identity: string, leadId: string) =>
  JSON.stringify([stableIdentity(identity), leadId]);
const context = createListWorkflowContext(
  ({ context: requestContext, signal }) =>
    getLead(requestContext.recordId, { signal }),
);
const workflowState = context.state;
const pending = ref<Frozen | null>(null);
const busy = computed(() => context.state.value.requestState === 'submitting');
let generation = 0;
let mounted = true;

function validFrozen(value: unknown): value is Frozen {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.identity === 'string' &&
    typeof item.leadId === 'string' &&
    typeof item.key === 'string' &&
    item.key.length > 0 &&
    item.key.length <= 128 &&
    (item.result === 'EVIDENCE' || item.result === 'NO_EVIDENCE') &&
    Number.isInteger(item.expectedVersion) &&
    (item.expectedVersion as number) >= 1 &&
    (item.result === 'EVIDENCE'
      ? item.reason === null
      : typeof item.reason === 'string' &&
        item.reason.trim().length > 0 &&
        [...item.reason].length <= 5000)
  );
}
function readPending(identity: string, leadId: string): Frozen | null {
  try {
    const raw = globalThis.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const records: unknown = JSON.parse(raw);
    if (!records || typeof records !== 'object' || Array.isArray(records))
      return null;
    const value = (records as Record<string, unknown>)[
      keyFor(identity, leadId)
    ];
    return validFrozen(value) &&
      value.identity === stableIdentity(identity) &&
      value.leadId === leadId
      ? value
      : null;
  } catch {
    return null;
  }
}
function savePending(
  value: Frozen | null,
  identity: string,
  leadId: string,
): boolean {
  try {
    const raw = globalThis.sessionStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return false;
    const records = parsed as Record<string, unknown>;
    if (value) records[keyFor(identity, leadId)] = value;
    else delete records[keyFor(identity, leadId)];
    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}
function current(g: number, identity: string, leadId: string): boolean {
  return (
    mounted &&
    generation === g &&
    props.identity === identity &&
    props.leadId === leadId
  );
}
async function show() {
  if (open.value) return;
  open.value = true;
  message.value = '';
  const g = generation;
  const identity = props.identity;
  const leadId = props.leadId;
  pending.value = readPending(identity, leadId);
  if (pending.value) {
    choice.value = pending.value.result;
    reason.value = pending.value.reason ?? '';
  }
  await context.sync({
    recordId: leadId,
    actorKey: identity,
    actionKey: 'proxy-evidence-confirmation',
    title: '代客户确认取证选择',
  });
  if (!current(g, identity, leadId)) return;
  if (pending.value) context.state.value.session?.restoreUnknown();
}
async function submit() {
  const session = context.state.value.session;
  const fresh = context.state.value.detail;
  if (!session || !fresh || busy.value) return;
  const recovery = pending.value !== null;
  if (
    !recovery &&
    (!fresh.capabilities.proxyConfirmEvidence ||
      fresh.status !== 'WAITING_EVIDENCE_DECISION')
  ) {
    message.value = '最新线索状态或权限已变化，请刷新。';
    return;
  }
  const normalizedReason =
    choice.value === 'NO_EVIDENCE' ? reason.value.trim() : null;
  if (
    !recovery &&
    choice.value === 'NO_EVIDENCE' &&
    (!normalizedReason || [...normalizedReason].length > 5000)
  ) {
    message.value = '请选择原因，长度须为 1 至 5000 个字符。';
    return;
  }
  const attempt: Frozen = pending.value ?? {
    identity: stableIdentity(props.identity),
    leadId: props.leadId,
    key: globalThis.crypto.randomUUID(),
    result: choice.value,
    reason: normalizedReason,
    expectedVersion: fresh.version,
  };
  if (!savePending(attempt, props.identity, props.leadId)) {
    message.value = '原请求无法保存，提交未发送。请检查本机存储。';
    return;
  }
  pending.value = attempt;
  if (!session.beginSubmit({ recovery })) return;
  const g = generation;
  const identity = props.identity;
  const leadId = props.leadId;
  message.value = '';
  try {
    await confirmProxyLeadEvidence(
      leadId,
      attempt.result,
      attempt.expectedVersion,
      attempt.key,
      attempt.reason ?? undefined,
    );
    if (!current(g, identity, leadId) || !session.isCurrent()) return;
    if (!savePending(null, identity, leadId)) {
      session.endSubmit('unknown');
      message.value =
        '服务端已返回成功，但本机未能清除原请求；请保留原请求核对。';
      return;
    }
    pending.value = null;
    session.endSubmit('success');
    open.value = false;
    emit('completed');
  } catch (error) {
    if (!current(g, identity, leadId) || !session.isCurrent()) return;
    if (
      !recovery &&
      error instanceof ApiError &&
      [400, 401, 403, 404, 409].includes(error.status) &&
      savePending(null, identity, leadId)
    ) {
      pending.value = null;
      session.endSubmit('failed');
      message.value = '请求已明确拒绝，没有写入确认。请刷新线索后重新选择。';
      return;
    }
    session.endSubmit('unknown');
    message.value = '结果尚未确认。只能使用原请求和原键核对；不要发起新选择。';
  }
}
function close() {
  if (!context.requestClose()) {
    message.value = '原请求尚未确认，请保留此面板并按原请求核对。';
    return;
  }
  open.value = false;
}
watch(
  () => [props.identity, props.leadId],
  () => {
    generation += 1;
    context.dispose();
    pending.value = null;
    open.value = false;
    message.value = '';
  },
);
onBeforeUnmount(() => {
  mounted = false;
  generation += 1;
  context.dispose();
});
</script>

<template>
  <ElButton data-test="proxy-evidence-open" @click="show"
    >代客户确认取证选择</ElButton
  >
  <section
    v-if="open"
    class="demo-card"
    role="dialog"
    aria-label="代客户确认取证选择"
  >
    <p>将记录当前内部操作人代客户选择，不代表客户账号亲自点击。</p>
    <p v-if="workflowState.status === 'loading'">正在读取最新线索…</p>
    <p v-if="workflowState.status === 'denied'">当前账号无权操作此线索。</p>
    <p v-if="workflowState.status === 'error'">读取线索失败，请重试。</p>
    <template v-if="workflowState.status === 'ready'">
      <template v-if="!pending">
        <label
          ><input
            v-model="choice"
            type="radio"
            value="EVIDENCE"
          />确认取证</label
        >
        <label
          ><input
            v-model="choice"
            type="radio"
            value="NO_EVIDENCE"
          />确认不取证并归档</label
        >
        <label v-if="choice === 'NO_EVIDENCE'"
          >归档原因
          <textarea
            v-model="reason"
            data-test="proxy-evidence-reason"
            maxlength="5000"
          />
        </label>
      </template>
      <p v-else>
        原请求结果未确认：{{
          pending.result === 'EVIDENCE' ? '确认取证' : '不取证归档'
        }}。请原样核对。
      </p>
      <ElButton
        type="primary"
        data-test="proxy-evidence-submit"
        :disabled="busy"
        @click="submit"
      >
        {{ busy ? '正在提交' : pending ? '按原请求核对' : '提交确认' }}
      </ElButton>
    </template>
    <p v-if="message" role="alert">{{ message }}</p>
    <ElButton data-test="proxy-evidence-close" :disabled="busy" @click="close"
      >关闭</ElButton
    >
  </section>
</template>
