<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RegisterCaseSettlementActualInput } from '../../api/settlement-actual-registration';

const props = withDefaults(
  defineProps<{
    caseId: string;
    lawyerId?: string | null;
    idempotencyKey: string;
    disabled?: boolean;
    unallocated?: boolean;
  }>(),
  { lawyerId: null, disabled: false },
);
const emit = defineEmits<{
  submit: [input: RegisterCaseSettlementActualInput];
  cancel: [];
}>();
const side = ref<'' | 'CUSTOMER' | 'LAWYER'>('');
const occurredOn = ref('');
const amount = ref('');
const sourceReference = ref('');
const note = ref('');
const attempted = ref(false);
function shanghaiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-');
}
const today = ref(shanghaiToday());
function refreshToday() {
  today.value = shanghaiToday();
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    v,
  );
const validLawyer = computed(() => uuid(props.lawyerId));
const validDate = computed(
  () =>
    /^\d{4}-\d{2}-\d{2}$/u.test(occurredOn.value) &&
    !occurredOn.value.startsWith('0000-') &&
    !Number.isNaN(Date.parse(`${occurredOn.value}T00:00:00.000Z`)) &&
    new Date(`${occurredOn.value}T00:00:00.000Z`).toISOString().slice(0, 10) ===
      occurredOn.value &&
    occurredOn.value <= today.value,
);
const validAmount = computed(() =>
  /^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/u.test(
    amount.value,
  ),
);
const validContext = computed(
  () =>
    uuid(props.caseId) &&
    props.idempotencyKey.length <= 128 &&
    props.idempotencyKey.trim().length > 0,
);
const valid = computed(
  () =>
    validContext.value &&
    side.value !== '' &&
    (side.value !== 'LAWYER' || validLawyer.value) &&
    validDate.value &&
    validAmount.value &&
    sourceReference.value.length <= 200 &&
    note.value.length <= 500,
);
watch(
  () => props.caseId,
  () => {
    side.value = '';
    occurredOn.value = '';
    amount.value = '';
    sourceReference.value = '';
    note.value = '';
    attempted.value = false;
  },
);
function submit() {
  refreshToday();
  attempted.value = true;
  if (props.disabled || !valid.value) return;
  const common = {
    caseId: props.caseId,
    idempotencyKey: props.idempotencyKey,
    amount: amount.value,
    occurredOn: occurredOn.value,
    ...(sourceReference.value.length > 0
      ? { sourceReference: sourceReference.value }
      : {}),
    ...(note.value.length > 0 ? { note: note.value } : {}),
  };
  if (side.value === 'CUSTOMER')
    emit('submit', { ...common, side: 'CUSTOMER' });
  else if (side.value === 'LAWYER' && uuid(props.lawyerId))
    emit('submit', { ...common, side: 'LAWYER', lawyerId: props.lawyerId });
}
</script>

<template>
  <form class="actual-registration" @submit.prevent="submit">
    <h3>{{ unallocated ? '登记待分配款项' : '登记实际回款／律师开票' }}</h3>
    <fieldset :disabled="disabled">
      <label
        >登记类型<select v-model="side" data-test="side">
          <option value="" disabled>请选择</option>
          <option value="CUSTOMER">客户回款</option>
          <option value="LAWYER">律师开票</option>
        </select></label
      >
      <label
        >实际发生日期<input
          v-model="occurredOn"
          type="date"
          :max="today"
          @focus="refreshToday"
          @input="refreshToday"
          data-test="occurred-on"
      /></label>
      <label
        >实际金额（元）<input
          v-model="amount"
          inputmode="decimal"
          data-test="actual-amount"
          placeholder="大于零，最多两位小数"
      /></label>
      <label
        >来源编号<input
          v-model="sourceReference"
          maxlength="200"
          data-test="source-reference"
          placeholder="交易号或发票号码（可选）"
      /></label>
      <label
        >备注<input
          v-model="note"
          maxlength="500"
          data-test="note"
          placeholder="可选"
      /></label>
    </fieldset>
    <p
      v-if="side === 'LAWYER' && !validLawyer"
      role="alert"
      data-test="lawyer-unavailable"
    >
      缺少当前承办律师编号，不能登记律师开票。
    </p>
    <p v-if="!validContext" role="alert">案件或请求信息未就绪，暂不可登记。</p>
    <p v-if="attempted && !validDate" role="alert">
      请填写有效的实际发生日期，不能晚于上海今天。
    </p>
    <p v-if="attempted && !validAmount" role="alert">
      金额须大于零，最多保留两位小数。
    </p>
    <div class="actions">
      <button
        type="button"
        data-test="cancel"
        :disabled="disabled"
        @click="emit('cancel')"
      >
        取消</button
      ><button type="submit" data-test="submit" :disabled="disabled || !valid">
        {{ unallocated ? '登记总额，稍后分配' : '提交登记' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.actual-registration {
  display: grid;
  gap: 12px;
  color: var(--el-text-color-primary);
}
h3,
p {
  margin: 0;
}
fieldset {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 0;
  border: 0;
  margin: 0;
}
label {
  display: grid;
  gap: 4px;
  font-size: var(--el-font-size-base);
}
input,
select {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  font: inherit;
}
p[role='alert'] {
  color: var(--el-color-danger);
  font-size: var(--el-font-size-small);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 600px) {
  fieldset {
    grid-template-columns: 1fr;
  }
}
</style>
