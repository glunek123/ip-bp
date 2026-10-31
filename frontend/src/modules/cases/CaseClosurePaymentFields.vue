<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import {
  ElOption,
  ElSelect,
} from 'element-plus/es/components/select/index.mjs';

export type ClosurePaymentType = 'ONE_TIME' | 'INSTALLMENTS';
export type ClosurePaymentRecord = {
  id: string;
  paymentDate: string;
  amount: string;
  payer: string;
  payee: string;
  receiptName?: string;
  receiptFile?: globalThis.File;
};

const props = withDefaults(
  defineProps<{
    paymentType: ClosurePaymentType;
    records: ClosurePaymentRecord[];
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  'update:paymentType': [value: ClosurePaymentType];
  'update:records': [value: ClosurePaymentRecord[]];
  'receipt-selected': [recordId: string, file: globalThis.File];
}>();

const switchError = ref('');
const rows = computed(() => props.records);
const options = computed(() => [
  { label: '一次性付款', value: 'ONE_TIME' as const },
  { label: '分期付款', value: 'INSTALLMENTS' as const },
]);

function updateRecord(
  id: string,
  key: keyof ClosurePaymentRecord,
  value: string | globalThis.File,
) {
  emit(
    'update:records',
    props.records.map((record) =>
      record.id === id ? { ...record, [key]: value } : record,
    ),
  );
}

function changeType(value: ClosurePaymentType) {
  switchError.value = '';
  if (value === 'ONE_TIME' && props.records.length > 1) {
    switchError.value =
      '当前有多条付款记录。请先自行处理记录，再切换为一次性付款。';
    return;
  }
  emit('update:paymentType', value);
}

function addRecord() {
  if (
    props.disabled ||
    (props.paymentType === 'ONE_TIME' && props.records.length > 0)
  )
    return;
  emit('update:records', [
    ...props.records,
    {
      id: `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paymentDate: '',
      amount: '',
      payer: '',
      payee: '',
    },
  ]);
}

function removeRecord(id: string) {
  if (props.disabled) return;
  emit(
    'update:records',
    props.records.filter((record) => record.id !== id),
  );
}

function clearReceipt(id: string) {
  if (props.disabled) return;
  emit(
    'update:records',
    props.records.map((record) => {
      if (record.id !== id) return record;
      const retained = { ...record };
      delete retained.receiptFile;
      delete retained.receiptName;
      return retained;
    }),
  );
}

function selectReceipt(id: string, event: globalThis.Event) {
  const input = event.target as globalThis.HTMLInputElement;
  const file = input.files?.[0];
  if (!file || props.disabled) return;
  emit(
    'update:records',
    props.records.map((record) =>
      record.id === id
        ? { ...record, receiptFile: file, receiptName: file.name }
        : record,
    ),
  );
  emit('receipt-selected', id, file);
  input.value = '';
}

watch(
  () => props.records.length,
  () => {
    switchError.value = '';
  },
);
</script>

<template>
  <section class="payment-fields" aria-labelledby="payment-fields-title">
    <h3 id="payment-fields-title">付款记录</h3>
    <label class="type-label" for="closure-payment-type">付款类型</label>
    <ElSelect
      id="closure-payment-type"
      :model-value="paymentType"
      :disabled="disabled"
      aria-label="付款类型"
      data-test="payment-type"
      @update:model-value="changeType"
    >
      <ElOption
        v-for="option in options"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </ElSelect>
    <p
      v-if="switchError"
      class="field-error"
      role="alert"
      data-test="switch-error"
    >
      {{ switchError }}
    </p>

    <div v-if="!rows.length" class="empty-state">尚无付款记录</div>
    <fieldset
      v-for="(record, index) in rows"
      :key="record.id"
      class="payment-record"
      :disabled="disabled"
    >
      <legend>第 {{ index + 1 }} 笔付款</legend>
      <div class="record-grid">
        <label :for="`payment-date-${record.id}`">付款日期</label>
        <input
          :id="`payment-date-${record.id}`"
          type="date"
          :value="record.paymentDate"
          :disabled="disabled"
          :data-test="`payment-date-${record.id}`"
          @input="
            updateRecord(
              record.id,
              'paymentDate',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
        <label :for="`payment-amount-${record.id}`">金额</label>
        <ElInput
          :id="`payment-amount-${record.id}`"
          :model-value="record.amount"
          :disabled="disabled"
          inputmode="decimal"
          aria-label="金额"
          :data-test="`payment-amount-${record.id}`"
          @update:model-value="updateRecord(record.id, 'amount', $event)"
        />
        <label :for="`payment-payer-${record.id}`">付款人</label>
        <ElInput
          :id="`payment-payer-${record.id}`"
          :model-value="record.payer"
          :disabled="disabled"
          aria-label="付款人"
          :data-test="`payment-payer-${record.id}`"
          @update:model-value="updateRecord(record.id, 'payer', $event)"
        />
        <label :for="`payment-payee-${record.id}`">收款人</label>
        <ElInput
          :id="`payment-payee-${record.id}`"
          :model-value="record.payee"
          :disabled="disabled"
          aria-label="收款人"
          :data-test="`payment-payee-${record.id}`"
          @update:model-value="updateRecord(record.id, 'payee', $event)"
        />
      </div>
      <div class="receipt-row">
        <label :for="`payment-receipt-${record.id}`">收款截图</label>
        <span
          v-if="record.receiptName"
          class="receipt-name"
          :data-test="`receipt-name-${record.id}`"
          >{{ record.receiptName }}</span
        >
        <input
          :id="`payment-receipt-${record.id}`"
          type="file"
          accept="image/*"
          :disabled="disabled"
          :data-test="`payment-receipt-${record.id}`"
          @change="selectReceipt(record.id, $event)"
        />
        <ElButton
          v-if="record.receiptFile || record.receiptName"
          :disabled="disabled"
          :data-test="`clear-receipt-${record.id}`"
          @click="clearReceipt(record.id)"
          >移除截图</ElButton
        >
      </div>
      <ElButton
        v-if="paymentType === 'INSTALLMENTS'"
        type="danger"
        plain
        :disabled="disabled"
        :data-test="`remove-${record.id}`"
        @click="removeRecord(record.id)"
        >删除此笔</ElButton
      >
    </fieldset>
    <ElButton
      v-if="paymentType === 'INSTALLMENTS' || !rows.length"
      plain
      :disabled="disabled"
      data-test="add-record"
      @click="addRecord"
      >添加付款记录</ElButton
    >
  </section>
</template>

<style scoped>
.payment-fields {
  display: grid;
  gap: 12px;
  color: var(--el-text-color-primary);
}
.payment-fields h3 {
  margin: 0;
  font-size: 16px;
}
.type-label,
.record-grid label,
.receipt-row label {
  font-size: 14px;
  font-weight: 500;
}
.payment-record {
  min-width: 0;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
}
.payment-record legend {
  padding: 0 6px;
  font-weight: 600;
}
.record-grid {
  display: grid;
  grid-template-columns: minmax(90px, 120px) minmax(160px, 1fr);
  align-items: center;
  gap: 12px;
}
.record-grid input[type='date'] {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font: inherit;
}
.receipt-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 14px 0;
}
.receipt-name {
  color: var(--el-text-color-secondary);
}
.field-error {
  margin: 0;
  color: var(--el-color-danger);
}
.empty-state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
@media (max-width: 560px) {
  .record-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
