<script lang="ts">
import { reactive } from 'vue';
import type {
  CorrectCasePaymentInput,
  PaymentCorrectionResult,
  PaymentReplacement,
} from '../../api/case-payment-correction';
type Target = {
  actorKey: string;
  caseId: string;
  paymentId: string;
  versionId: string;
} & PaymentReplacement;
type Pending = {
  target: Readonly<Target>;
  input: Readonly<CorrectCasePaymentInput>;
  busy: boolean;
  result?: PaymentCorrectionResult;
  delivered: boolean;
  uncertain: boolean;
};
const pendingCorrections = new Map<string, Pending>();
const identity = (actorKey: string, caseId: string) =>
  JSON.stringify([actorKey, caseId.toLowerCase()]);
export function findPendingPaymentCorrection(actorKey: string, caseId: string) {
  return pendingCorrections.get(identity(actorKey, caseId))?.target;
}
</script>
<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { correctCasePayment } from '../../api/case-payment-correction';
import { ApiError } from '../../api/http';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
const props = withDefaults(
  defineProps<{
    actorKey: string;
    caseId: string;
    payment: PaymentReplacement & { paymentId: string; versionId: string };
    session?: ListWorkflowSession;
    allowNew?: boolean;
  }>(),
  { allowNew: true },
);
const emit = defineEmits<{
  saved: [result: PaymentCorrectionResult];
  cancel: [];
}>();
const kind = ref<'CORRECT' | 'VOID'>('CORRECT'),
  reason = ref(''),
  form = ref<PaymentReplacement>({ ...props.payment });
const pending = shallowRef<Pending>(),
  error = ref(''),
  blocked = ref(false);
let generation = 0;
const current = (token: number) =>
  token === generation &&
  (!props.session ||
    (props.session.isCurrent() &&
      props.session.context.actorKey === props.actorKey &&
      props.session.context.recordId.toLowerCase() ===
        props.caseId.toLowerCase()));
const sameTarget = (p: Pending) =>
  p.target.actorKey === props.actorKey &&
  p.target.caseId.toLowerCase() === props.caseId.toLowerCase() &&
  p.target.paymentId.toLowerCase() === props.payment.paymentId.toLowerCase();
function deliver(p: Pending, token: number) {
  if (!current(token) || !sameTarget(p) || p.delivered || !p.result) return;
  if (props.session && !props.session.endSubmit('completed')) return;
  p.delivered = true;
  pendingCorrections.delete(identity(props.actorKey, props.caseId));
  pending.value = undefined;
  error.value = '';
  emit('saved', p.result);
}
watch(
  () => [
    props.actorKey,
    props.caseId,
    props.payment.paymentId,
    props.payment.versionId,
    props.session,
  ],
  () => {
    const token = ++generation;
    form.value = {
      paidOn: props.payment.paidOn,
      amount: props.payment.amount,
      payer: props.payment.payer,
      payee: props.payment.payee,
    };
    reason.value = '';
    kind.value = 'CORRECT';
    error.value = '';
    blocked.value = false;
    pending.value = pendingCorrections.get(
      identity(props.actorKey, props.caseId),
    );
    if (pending.value && current(token)) {
      props.session?.restoreUnknown();
      if (
        pending.value.result &&
        (!props.session || props.session.beginSubmit({ recovery: true }))
      )
        deliver(pending.value, token);
    }
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => pending.value?.result,
  () => {
    const p = pending.value;
    if (
      p?.result &&
      current(generation) &&
      (!props.session || props.session.beginSubmit({ recovery: true }))
    )
      deliver(p, generation);
  },
);
onBeforeUnmount(() => generation++);
async function save() {
  const token = generation;
  if (!current(token) || blocked.value) return;
  let p = pending.value;
  if (p?.busy) return;
  if (!p) {
    if (props.allowNew === false) return;
    if (
      kind.value === 'CORRECT' &&
      (!/^\d{4}-\d{2}-\d{2}$/u.test(form.value.paidOn) ||
        !/^(?=.*[1-9])(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(
          form.value.amount,
        ) ||
        !form.value.payer.trim() ||
        !form.value.payee.trim())
    ) {
      error.value = '请填写有效付款日期、正金额及付款人、收款人。';
      return;
    }
    if (
      reason.value.length > 500 ||
      form.value.payer.length > 200 ||
      form.value.payee.length > 200
    ) {
      error.value = '填写内容超出允许长度。';
      return;
    }
    const base = {
      paymentId: props.payment.paymentId,
      expectedVersionId: props.payment.versionId,
      idempotencyKey: globalThis.crypto.randomUUID(),
      reason: reason.value.trim() || null,
    };
    const input: CorrectCasePaymentInput =
      kind.value === 'VOID'
        ? { ...base, kind: 'VOID' }
        : {
            ...base,
            kind: 'CORRECT',
            paidOn: form.value.paidOn,
            amount: form.value.amount,
            payer: form.value.payer,
            payee: form.value.payee,
          };
    if (props.session && !props.session.beginSubmit()) return;
    p = reactive({
      target: Object.freeze({
        actorKey: props.actorKey,
        caseId: props.caseId,
        paymentId: props.payment.paymentId,
        versionId: props.payment.versionId,
        paidOn: props.payment.paidOn,
        amount: props.payment.amount,
        payer: props.payment.payer,
        payee: props.payment.payee,
      }),
      input: Object.freeze(input),
      busy: false,
      delivered: false,
      uncertain: false,
    });
    pendingCorrections.set(identity(props.actorKey, props.caseId), p);
    pending.value = p;
  } else if (
    !sameTarget(p) ||
    (props.session && !props.session.beginSubmit({ recovery: true }))
  )
    return;
  if (p.result) {
    deliver(p, token);
    return;
  }
  p.busy = true;
  error.value = '';
  try {
    p.result = await correctCasePayment(p.target.caseId, p.input);
    if (current(token)) deliver(p, token);
  } catch (cause) {
    const unknown =
      p.uncertain ||
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.code === 'INVALID_RESPONSE';
    if (unknown) {
      p.uncertain = true;
      if (current(token)) {
        props.session?.endSubmit('unknown');
        error.value = '结果待确认，请仅重试原请求。';
      }
    } else {
      pendingCorrections.delete(identity(p.target.actorKey, p.target.caseId));
      if (current(token)) {
        pending.value = undefined;
        props.session?.endSubmit('failed');
        blocked.value = cause.status === 403 || cause.status === 409;
        error.value =
          cause.status === 403
            ? '当前账号无权更正此笔付款。'
            : cause.status === 400
              ? '填写内容无效，请核对后重新保存。'
              : '付款资料已变化或请求被拒绝，请取消后重新读取。';
      }
    }
  } finally {
    p.busy = false;
  }
}
function cancel() {
  if (current(generation) && !pending.value) emit('cancel');
}
</script>
<template>
  <section aria-label="更正或撤销付款">
    <p>
      原付款、截图及历史记录保留。归档后的更正不改变归档状态；结清不足时需要核查。
    </p>
    <p>
      当前付款：{{ payment.paidOn }} · {{ payment.amount }} 元 ·
      {{ payment.payer }} → {{ payment.payee }}
    </p>
    <fieldset :disabled="!!pending || allowNew === false">
      <label
        >操作<select v-model="kind" data-test="kind">
          <option value="CORRECT">更正付款</option>
          <option value="VOID">撤销此笔付款</option>
        </select></label
      >
      <template v-if="kind === 'CORRECT'">
        <label
          >付款日期<input v-model="form.paidOn" type="date" data-test="paidOn"
        /></label>
        <label
          >付款金额（元）<input
            v-model="form.amount"
            inputmode="decimal"
            data-test="amount"
        /></label>
        <label
          >付款人<input v-model="form.payer" maxlength="200" data-test="payer"
        /></label>
        <label
          >收款人<input v-model="form.payee" maxlength="200" data-test="payee"
        /></label>
      </template>
      <label
        >原因（选填）<textarea
          v-model="reason"
          maxlength="500"
          data-test="reason"
        />
      </label>
    </fieldset>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton
      data-test="save"
      :disabled="blocked || pending?.busy || (!pending && allowNew === false)"
      @click="save"
      >{{ pending ? '重试原付款请求' : '保存' }}</ElButton
    >
    <ElButton data-test="cancel" :disabled="!!pending" @click="cancel"
      >取消</ElButton
    >
  </section>
</template>
