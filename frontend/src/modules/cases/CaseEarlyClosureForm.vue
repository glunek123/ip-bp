<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import CaseClosurePaymentFields, {
  type ClosurePaymentRecord,
  type ClosurePaymentType,
} from './CaseClosurePaymentFields.vue';

export type EarlyClosureDraft = {
  closeAt: string;
  closeAmountState: 'KNOWN' | 'PENDING';
  closeAmt: string | null;
  closeDocuments: globalThis.File[];
  paymentType: ClosurePaymentType;
  paymentRecords: ClosurePaymentRecord[];
};

const props = withDefaults(defineProps<{ disabled?: boolean }>(), {
  disabled: false,
});
const emit = defineEmits<{
  submit: [draft: EarlyClosureDraft];
  'document-selected': [file: globalThis.File];
  'payment-receipt-selected': [recordId: string, file: globalThis.File];
}>();

const closeAt = ref('');
const amountState = ref<'KNOWN' | 'PENDING'>('KNOWN');
const amount = ref('');
const closeDocuments = ref<globalThis.File[]>([]);
const paymentType = ref<ClosurePaymentType>('ONE_TIME');
const paymentRecords = ref<ClosurePaymentRecord[]>([]);
const attempted = ref(false);

const amountPattern = /^\d{1,14}(?:\.\d{1,2})?$/u;
function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
const dateValid = computed(() => isValidDate(closeAt.value));
const paymentRowsValid = computed(() =>
  paymentRecords.value.every(
    (record) =>
      isValidDate(record.paymentDate) &&
      amountPattern.test(record.amount) &&
      /[1-9]/u.test(record.amount) &&
      record.payer.trim().length > 0 &&
      record.payer.length <= 200 &&
      record.payee.trim().length > 0 &&
      record.payee.length <= 200,
  ),
);
const amountValid = computed(
  () => amountState.value === 'PENDING' || amountPattern.test(amount.value),
);
const documentsValid = computed(() => closeDocuments.value.length <= 10);
const formValid = computed(
  () =>
    dateValid.value &&
    amountValid.value &&
    documentsValid.value &&
    paymentRowsValid.value &&
    (paymentType.value !== 'ONE_TIME' || paymentRecords.value.length <= 1),
);

function selectDocuments(event: globalThis.Event) {
  const input = event.target as globalThis.HTMLInputElement;
  const files = Array.from(input.files ?? []);
  closeDocuments.value = [...closeDocuments.value, ...files];
  for (const file of files) emit('document-selected', file);
  input.value = '';
}

function removeDocument(index: number) {
  closeDocuments.value = closeDocuments.value.filter(
    (_, current) => current !== index,
  );
}

function submit() {
  attempted.value = true;
  if (props.disabled || !formValid.value) return;
  emit('submit', {
    closeAt: closeAt.value,
    closeAmountState: amountState.value,
    closeAmt: amountState.value === 'KNOWN' ? amount.value : null,
    closeDocuments: [...closeDocuments.value],
    paymentType: paymentType.value,
    paymentRecords: paymentRecords.value.map((record) => ({ ...record })),
  });
}
</script>

<template>
  <form class="early-closure-form" @submit.prevent="submit">
    <h2>提前结案</h2>
    <p class="form-help">提交后案件进入待归档。结案文书和付款截图可后补。</p>

    <div class="field-grid">
      <label for="early-closure-date">结案日期</label>
      <input
        id="early-closure-date"
        v-model="closeAt"
        type="date"
        :disabled="disabled"
        data-test="close-date"
      />

      <label for="early-closure-amount-state">结案金额状态</label>
      <select
        id="early-closure-amount-state"
        v-model="amountState"
        :disabled="disabled"
        data-test="amount-state"
      >
        <option value="KNOWN">已确认</option>
        <option value="PENDING">待确认</option>
      </select>

      <label for="early-closure-amount">结案金额</label>
      <ElInput
        id="early-closure-amount"
        v-model="amount"
        inputmode="decimal"
        :disabled="disabled || amountState === 'PENDING'"
        aria-label="结案金额"
        data-test="close-amount"
      />
    </div>
    <p
      v-if="attempted && !dateValid"
      class="field-error"
      role="alert"
      data-test="date-error"
    >
      请填写有效的结案日期。
    </p>
    <p
      v-if="attempted && !amountValid"
      class="field-error"
      role="alert"
      data-test="amount-error"
    >
      请填写有效金额，或将金额状态设为待确认。
    </p>

    <section class="documents" aria-labelledby="closure-documents-title">
      <h3 id="closure-documents-title">结案文书</h3>
      <p>可以稍后补充文书。</p>
      <input
        type="file"
        multiple
        :disabled="disabled"
        data-test="closure-documents"
        @change="selectDocuments"
      />
      <p v-if="attempted && !documentsValid" class="field-error" role="alert">
        结案文书最多上传 10 份。
      </p>
      <ul v-if="closeDocuments.length">
        <li
          v-for="(file, index) in closeDocuments"
          :key="`${file.name}-${index}`"
        >
          <span>{{ file.name }}</span>
          <ElButton
            type="danger"
            plain
            :disabled="disabled"
            :data-test="`remove-document-${index}`"
            @click="removeDocument(index)"
            >移除</ElButton
          >
        </li>
      </ul>
    </section>

    <CaseClosurePaymentFields
      :payment-type="paymentType"
      :records="paymentRecords"
      :disabled="disabled"
      @update:payment-type="paymentType = $event"
      @update:records="paymentRecords = $event"
      @receipt-selected="
        (id, file) => emit('payment-receipt-selected', id, file)
      "
    />
    <p
      v-if="attempted && !paymentRowsValid"
      class="field-error"
      role="alert"
      data-test="payment-error"
    >
      请补全每笔付款的有效日期、大于零的金额、付款人和收款人。
    </p>
    <ElButton
      native-type="submit"
      type="primary"
      :disabled="disabled"
      data-test="submit"
      >确认提前结案</ElButton
    >
  </form>
</template>

<style scoped>
.early-closure-form {
  display: grid;
  gap: 16px;
  color: var(--el-text-color-primary);
}
.early-closure-form h2,
.early-closure-form h3,
.form-help,
.documents p {
  margin: 0;
}
.early-closure-form h2 {
  font-size: 18px;
}
.early-closure-form h3 {
  font-size: 16px;
}
.form-help,
.documents p {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.field-grid {
  display: grid;
  grid-template-columns: minmax(100px, 140px) minmax(180px, 1fr);
  align-items: center;
  gap: 12px;
}
.field-grid label {
  font-size: 14px;
  font-weight: 500;
}
.field-grid input[type='date'],
.field-grid select {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font: inherit;
}
.documents {
  display: grid;
  gap: 8px;
}
.documents ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 20px;
}
.documents li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.field-error {
  margin: 0;
  color: var(--el-color-danger);
}
@media (max-width: 560px) {
  .field-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
