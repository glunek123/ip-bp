<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ElButton from 'element-plus/es/components/button/index';
import ElDialog from 'element-plus/es/components/dialog/index';
import { ApiError } from '../../api/http';
import {
  getNotarySampleFeeRefund,
  normalizeRefundAmount,
  setNotarySampleFeeRefund,
  type NotarySampleFeeRefundSummary,
} from '../../api/notary';

const props = defineProps<{ matterId: string; open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const summary = ref<NotarySampleFeeRefundSummary | null>(null);
const amount = ref('');
const note = ref('');
const busy = ref(false);
const loading = ref(false);
const error = ref('');

const title = '样品费退款';
const formDisabled = computed(
  () => busy.value || loading.value || summary.value?.canRefund === false,
);

/** 现样品费预览：原样品费 − 输入中的退款金额。 */
const netPreview = computed(() => {
  const original = summary.value?.sampleFeeAmount;
  if (original === null || original === undefined) return null;
  const refund = normalizeRefundAmount(amount.value);
  if (refund === null) return null;
  const net = Number(original) - Number(refund);
  return net < 0 ? null : net.toFixed(2);
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    summary.value = await getNotarySampleFeeRefund(props.matterId);
    amount.value = summary.value.refundAmount;
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
    await setNotarySampleFeeRefund(props.matterId, {
      amount: amount.value.trim(),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
    });
    note.value = '';
    await load();
    emit('saved');
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : '保存失败，请重试';
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
          <dt>原样品费</dt>
          <dd class="mono" data-test="dialog-sample-fee">
            {{
              summary.sampleFeeAmount === null
                ? '无'
                : `${summary.sampleFeeAmount} 元`
            }}
          </dd>
        </div>
        <div>
          <dt>退款金额</dt>
          <dd class="mono" data-test="dialog-refund-current">
            {{ summary.refundAmount }} 元
          </dd>
        </div>
        <div>
          <dt>现样品费</dt>
          <dd class="mono" data-test="dialog-net-fee">
            {{
              summary.netSampleFee === null ? '—' : `${summary.netSampleFee} 元`
            }}
          </dd>
        </div>
      </dl>
      <p v-if="summary && !summary.canRefund" class="sample-refund-dialog__hint">
        该事项尚未登记样品费，无法设置退款。
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
        <p class="sample-refund-dialog__hint" data-test="dialog-net-preview">
          保存后现样品费：{{
            netPreview === null ? '—' : `${netPreview} 元`
          }}（原样品费 {{ summary?.sampleFeeAmount ?? '无' }} 元）
        </p>
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
            >保存</ElButton
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
