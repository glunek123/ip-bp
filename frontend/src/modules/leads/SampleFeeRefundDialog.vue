<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ElButton from 'element-plus/es/components/button/index';
import ElDialog from 'element-plus/es/components/dialog/index';
import { ApiError } from '../../api/http';
import {
  appendNotarySampleFeeRefund,
  getNotarySampleFeeRefunds,
  normalizeRefundAmount,
  type NotarySampleFeeRefundSummary,
} from '../../api/notary';

const props = defineProps<{ matterId: string; open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const summary = ref<NotarySampleFeeRefundSummary | null>(null);
const amount = ref('');
const refundedOn = ref(new Date().toLocaleDateString('en-CA'));
const note = ref('');
const busy = ref(false);
const loading = ref(false);
const error = ref('');

const title = '样品费退款更新/登记';
const formDisabled = computed(
  () => busy.value || loading.value || summary.value?.canRefund === false,
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    summary.value = await getNotarySampleFeeRefunds(props.matterId);
  } catch (cause) {
    summary.value = null;
    error.value =
      cause instanceof ApiError ? cause.message : '读取样品费失败，请重试';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    amount.value = '';
    note.value = '';
    refundedOn.value = new Date().toLocaleDateString('en-CA');
    error.value = '';
    void load();
  },
  // 组件可能以 open=true 首次挂载（列表页按需渲染），需要立即加载。
  { immediate: true },
);

// 输入 10 / 10.5 时补齐成 10.00 / 10.50，避免格式导致的提交失败。
function formatAmount(): void {
  const normalized = normalizeRefundAmount(amount.value);
  if (normalized !== null) amount.value = normalized;
}

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    await appendNotarySampleFeeRefund(
      props.matterId,
      {
        amount: amount.value.trim(),
        refundedOn: refundedOn.value,
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
      },
      globalThis.crypto.randomUUID(),
    );
    amount.value = '';
    note.value = '';
    await load();
    emit('saved');
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : '登记失败，请重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="open"
    :title="title"
    width="480px"
    append-to-body
    class="sample-refund-dialog"
    data-test="sample-refund-dialog"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <p v-if="loading" class="sample-refund-dialog__hint">正在读取样品费…</p>
    <template v-else>
      <dl v-if="summary" class="demo-detail-grid sample-refund-dialog__facts">
        <div>
          <dt>样品费</dt>
          <dd class="mono">
            {{ summary.sampleFeeAmount === null ? '无' : `${summary.sampleFeeAmount} 元` }}
          </dd>
        </div>
        <div>
          <dt>已退合计</dt>
          <dd class="mono">{{ summary.totalRefunded }} 元</dd>
        </div>
        <div>
          <dt>可退余额</dt>
          <dd class="mono">
            {{ summary.netSampleFee === null ? '—' : `${summary.netSampleFee} 元` }}
          </dd>
        </div>
      </dl>
      <p v-if="summary && !summary.canRefund" class="sample-refund-dialog__hint">
        该事项当前不能登记退款：仅待退货阶段、且样品费已登记并仍有余额时才可登记。
      </p>
      <form class="sample-refund-dialog__form" @submit.prevent="submit">
        <label
          >退款金额（元）<input
            v-model="amount"
            data-test="dialog-refund-amount"
            inputmode="decimal"
            :disabled="formDisabled"
            required
            @blur="formatAmount"
        /></label>
        <label
          >退款日期<input
            v-model="refundedOn"
            data-test="dialog-refund-date"
            type="date"
            :disabled="formDisabled"
            required
        /></label>
        <label
          >备注<input
            v-model="note"
            data-test="dialog-refund-note"
            maxlength="500"
            :disabled="formDisabled"
        /></label>
        <p v-if="error" role="alert" data-test="dialog-refund-error">
          {{ error }}
        </p>
        <div class="sample-refund-dialog__actions">
          <ElButton data-test="dialog-refund-cancel" @click="emit('close')"
            >关闭</ElButton
          >
          <ElButton
            type="primary"
            native-type="submit"
            :disabled="formDisabled"
            data-test="dialog-refund-submit"
            >登记</ElButton
          >
        </div>
      </form>
    </template>
  </ElDialog>
</template>

<style scoped>
.sample-refund-dialog__facts {
  margin-bottom: 16px;
}
.sample-refund-dialog__hint {
  margin: 0 0 12px;
  color: var(--muted, #6b7280);
  font-size: 12px;
}
.sample-refund-dialog__form {
  display: grid;
  gap: 12px;
}
.sample-refund-dialog__form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.sample-refund-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
