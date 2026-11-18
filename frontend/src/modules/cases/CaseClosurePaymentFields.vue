<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
export type ClosureSavedPayment = {
  id: string;
  paymentDate: string;
  amount: string;
  payer: string;
  payee: string;
  receiptCount?: number;
};

const props = withDefaults(
  defineProps<{
    paymentType: ClosurePaymentType;
    records: ClosurePaymentRecord[];
    saved?: ClosureSavedPayment[];
    showType?: boolean;
    disabled?: boolean;
  }>(),
  { saved: () => [], showType: true, disabled: false },
);

const emit = defineEmits<{
  'update:paymentType': [value: ClosurePaymentType];
  'update:records': [value: ClosurePaymentRecord[]];
  'receipt-selected': [recordId: string, file: globalThis.File];
}>();

const switchError = ref('');
const rows = computed(() => props.records);
const savedRows = computed(() => props.saved ?? []);
const totalRows = computed(() => rows.value.length + savedRows.value.length);
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
  if (value === 'ONE_TIME' && totalRows.value > 1) {
    switchError.value =
      '当前有多条付款记录。请先自行处理记录，再切换为一次性付款。';
    return;
  }
  emit('update:paymentType', value);
}

function addRecord() {
  if (
    props.disabled ||
    (props.paymentType === 'ONE_TIME' && totalRows.value > 0)
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
    <div v-if="showType" class="payment-type">
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
    </div>
    <p
      v-if="switchError"
      class="field-error"
      role="alert"
      data-test="switch-error"
    >
      {{ switchError }}
    </p>

    <div class="payment-table-wrap">
      <table class="payment-table">
        <colgroup>
          <col class="col-index" />
          <col class="col-date" />
          <col class="col-amount" />
          <col class="col-party" />
          <col class="col-party" />
          <col class="col-receipt" />
          <col class="col-action" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">序号</th>
            <th scope="col">付款日期</th>
            <th scope="col">付款金额</th>
            <th scope="col">付款人</th>
            <th scope="col">收款人</th>
            <th scope="col">付款凭证</th>
            <th scope="col"><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(record, index) in savedRows"
            :key="`saved-${record.id}`"
            class="payment-record payment-record--saved"
          >
            <td class="cell-index">{{ index + 1 }}</td>
            <td>
              <span class="cell-static">{{ record.paymentDate || '—' }}</span>
            </td>
            <td>
              <span class="cell-static cell-static--amount">{{
                record.amount || '—'
              }}</span>
            </td>
            <td>
              <span class="cell-static">{{ record.payer || '—' }}</span>
            </td>
            <td>
              <span class="cell-static">{{ record.payee || '—' }}</span>
            </td>
            <td>
              <span class="cell-static cell-static--muted">
                {{
                  record.receiptCount
                    ? `已存 ${record.receiptCount} 张`
                    : '暂无截图'
                }}
              </span>
            </td>
            <td class="cell-action">
              <slot name="saved-action" :record="record" />
            </td>
          </tr>
          <tr
            v-for="(record, index) in rows"
            :key="record.id"
            class="payment-record"
          >
            <td class="cell-index">{{ savedRows.length + index + 1 }}</td>
            <td>
              <input
                class="cell-input cell-input--date"
                type="date"
                :value="record.paymentDate"
                :disabled="disabled"
                :aria-label="`第 ${savedRows.length + index + 1} 笔付款日期`"
                :data-test="`payment-date-${record.id}`"
                @input="
                  updateRecord(
                    record.id,
                    'paymentDate',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </td>
            <td>
              <ElInput
                :model-value="record.amount"
                :disabled="disabled"
                inputmode="decimal"
                aria-label="金额"
                :data-test="`payment-amount-${record.id}`"
                @update:model-value="updateRecord(record.id, 'amount', $event)"
              />
            </td>
            <td>
              <ElInput
                :model-value="record.payer"
                :disabled="disabled"
                aria-label="付款人"
                :data-test="`payment-payer-${record.id}`"
                @update:model-value="updateRecord(record.id, 'payer', $event)"
              />
            </td>
            <td>
              <ElInput
                :model-value="record.payee"
                :disabled="disabled"
                aria-label="收款人"
                :data-test="`payment-payee-${record.id}`"
                @update:model-value="updateRecord(record.id, 'payee', $event)"
              />
            </td>
            <td class="cell-receipt">
              <label
                class="receipt-box"
                :class="{ 'is-filled': !!record.receiptName }"
                :title="record.receiptName || '上传付款凭证'"
              >
                <input
                  type="file"
                  accept="image/*"
                  :disabled="disabled"
                  :data-test="`payment-receipt-${record.id}`"
                  @change="selectReceipt(record.id, $event)"
                />
                <span class="receipt-text">{{
                  record.receiptName || '上传截图'
                }}</span>
              </label>
              <button
                v-if="record.receiptName"
                type="button"
                class="receipt-clear"
                :disabled="disabled"
                aria-label="移除截图"
                :data-test="`clear-receipt-${record.id}`"
                @click="clearReceipt(record.id)"
              >
                ×
              </button>
            </td>
            <td class="cell-action">
              <button
                v-if="paymentType === 'INSTALLMENTS'"
                type="button"
                class="row-remove"
                :disabled="disabled"
                aria-label="删除此笔"
                :data-test="`remove-${record.id}`"
                @click="removeRecord(record.id)"
              >
                ×
              </button>
            </td>
          </tr>
          <tr v-if="!totalRows">
            <td colspan="7" class="empty-state">尚无付款记录</td>
          </tr>
        </tbody>
      </table>
      <button
        v-if="paymentType === 'INSTALLMENTS' || !totalRows"
        type="button"
        class="add-record"
        :disabled="disabled"
        data-test="add-record"
        @click="addRecord"
      >
        ＋ 增加一笔
      </button>
    </div>
  </section>
</template>

<style scoped>
.payment-fields {
  display: grid;
  gap: 8px;
  color: var(--el-text-color-primary);
}
.payment-type {
  display: grid;
  gap: 4px;
  max-width: 320px;
}
.type-label {
  font-size: 12px;
  color: var(--color-ink-muted);
}
.payment-table-wrap {
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}
.payment-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.payment-table th {
  padding: 7px 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-ink-subtle);
  text-align: left;
  white-space: nowrap;
  background: var(--color-surface-2);
}
.payment-table td {
  padding: 4px 6px;
  vertical-align: middle;
}
.col-index {
  width: 40px;
}
.col-date {
  width: 118px;
}
.col-amount {
  width: 88px;
}
.col-receipt {
  width: 124px;
}
.col-action {
  width: 88px;
}
.cell-index {
  font-size: 12px;
  color: var(--color-ink-subtle);
  text-align: center;
}
.cell-input,
.cell-input--date {
  width: 100%;
  height: 30px;
  padding: 0 6px;
  font: inherit;
  font-size: 13px;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
}
.cell-input--date {
  padding: 0 4px;
}
.cell-static {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  overflow: hidden;
  font-size: 13px;
  color: var(--color-ink-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--color-surface-2);
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
}
.cell-static--amount {
  justify-content: flex-end;
}
.cell-static--muted {
  font-size: 12px;
  color: var(--color-ink-tertiary);
}
.cell-receipt {
  position: relative;
}
.receipt-box {
  position: relative;
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-ink-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
  border: 1px dashed var(--color-hairline-strong);
  border-radius: 4px;
}
.receipt-box.is-filled {
  padding-right: 26px;
  color: var(--color-ink-muted);
  border-style: solid;
}
.receipt-box input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.receipt-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.receipt-clear,
.row-remove {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: var(--color-ink-subtle);
  background: #fff;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transform: translateY(-50%);
}
.receipt-clear:hover,
.row-remove:hover {
  color: var(--color-danger);
  background: var(--el-color-danger-light-9);
}
.row-remove {
  position: static;
  display: block;
  margin: 0 auto;
  transform: none;
}
.cell-action {
  text-align: center;
}
.empty-state {
  padding: 22px 8px;
  font-size: 13px;
  color: var(--color-ink-tertiary);
  text-align: center;
}
.add-record {
  display: block;
  width: 100%;
  height: 34px;
  font-size: 13px;
  color: var(--color-ink-muted);
  cursor: pointer;
  background: #fff;
  border: 0;
  border-top: 1px solid var(--color-hairline);
}
.add-record:hover:not(:disabled) {
  color: var(--color-primary);
  background: var(--color-surface-2);
}
.add-record:disabled {
  color: var(--color-hairline-strong);
  cursor: not-allowed;
}
.field-error {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 640px) {
  .payment-table {
    min-width: 560px;
  }
}
</style>
