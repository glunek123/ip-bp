<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  getCaseSettlement,
  updateCaseSettlementTerms,
  type CaseSettlement,
  type LawyerSettlementMode,
  type SettlementSide,
} from '../../api/settlements';

const props = defineProps<{
  caseId: string;
  side: SettlementSide;
  open: boolean;
}>();
const emit = defineEmits<{
  updated: [payload: { side: SettlementSide; amount: string }];
  collapsed: [];
}>();

const settlement = ref<CaseSettlement | null>(null);
const formulaBase = '结案金额';
const formulaPercent = ref('75');
const lawyerMode = ref<LawyerSettlementMode>('FULL_RISK');
const baseFee = ref('0');
const splitPercent = ref('30');
const manualAmount = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');

const lawyerModes: { value: LawyerSettlementMode; label: string }[] = [
  { value: 'FULL_RISK', label: '全风险' },
  { value: 'HALF_RISK', label: '半风险' },
  { value: 'FIXED_FEE', label: '固定费' },
];

const figures = computed(() => settlement.value?.figures ?? null);
const currentAmount = computed(() =>
  props.side === 'CUSTOMER'
    ? (figures.value?.customerAmount ?? '—')
    : (figures.value?.lawyerAmount ?? '—'),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const value = await getCaseSettlement(props.caseId);
    settlement.value = value;
    const parsed = (value.terms?.customerFormula ?? '').match(
      /(\d+(?:\.\d+)?)\s*%/u,
    );
    formulaPercent.value = parsed?.[1] ?? '75';
    lawyerMode.value = value.terms?.lawyerMode ?? 'FULL_RISK';
    baseFee.value = value.terms?.lawyerBaseFee ?? '0';
    splitPercent.value = value.terms?.lawyerSplitPercent ?? '30';
    manualAmount.value =
      (props.side === 'CUSTOMER'
        ? value.terms?.customerManualAmount
        : value.terms?.lawyerManualAmount) ?? '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取结算条件失败';
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.caseId, props.side],
  () => {
    if (props.open) void load();
  },
  { immediate: true },
);

async function apply(): Promise<void> {
  if (saving.value || settlement.value === null) return;
  saving.value = true;
  error.value = '';
  try {
    await updateCaseSettlementTerms(props.caseId, {
      expectedTermsVersion: settlement.value.termsVersion,
      idempotencyKey: globalThis.crypto.randomUUID(),
      side: props.side,
      ...(props.side === 'CUSTOMER'
        ? {
            customerFormula: `${formulaBase} × ${formulaPercent.value.trim() || '0'}%`,
            manualAmount: manualAmount.value.trim() || null,
          }
        : {
            lawyerMode: lawyerMode.value,
            lawyerBaseFee: baseFee.value.trim() || '0',
            lawyerSplitPercent: splitPercent.value.trim() || '0',
            manualAmount: manualAmount.value.trim() || null,
          }),
    });
    await load();
    emit('updated', { side: props.side, amount: currentAmount.value });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '结算条件保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="open" class="settle-editor" data-test="settlement-editor">
    <p v-if="loading" class="field-help">读取中…</p>
    <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
    <template v-if="side === 'CUSTOMER'">
      <label>
        <span>客户结算条件</span>
        <div class="formula">
          <input
            :value="formulaBase"
            readonly
            data-test="settlement-formula-base"
          />
          <span>×</span>
          <input
            v-model="formulaPercent"
            inputmode="decimal"
            maxlength="6"
            data-test="settlement-formula"
          />
          <span>%</span>
        </div>
        <p class="formula-hint">= 结案金额 × {{ formulaPercent || '0' }}%</p>
      </label>
      <label>
        <span>手工指定金额（留空按公式）</span>
        <input
          v-model="manualAmount"
          inputmode="decimal"
          placeholder="留空自动计算"
          data-test="settlement-manual"
        />
      </label>
    </template>
    <template v-else>
      <label>
        <span>律师结算模式</span>
        <select v-model="lawyerMode" data-test="settlement-mode">
          <option
            v-for="mode in lawyerModes"
            :key="mode.value"
            :value="mode.value"
          >
            {{ mode.label }}
          </option>
        </select>
      </label>
      <label>
        <span>基础费（元）</span>
        <input v-model="baseFee" inputmode="decimal" />
      </label>
      <label>
        <span>分成比例（%）</span>
        <input v-model="splitPercent" inputmode="decimal" />
      </label>
      <label>
        <span>手工指定金额（留空自动计算）</span>
        <input v-model="manualAmount" inputmode="decimal" />
      </label>
    </template>
    <p class="field-help">当前：{{ currentAmount }} 元</p>
    <div class="settle-editor__actions">
      <button type="button" :disabled="saving" @click="apply">
        {{ saving ? '保存中…' : '应用' }}
      </button>
      <button type="button" class="link-button" @click="emit('collapsed')">
        收起
      </button>
    </div>
  </section>
</template>

<style scoped>
.settle-editor {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fafafa;
}
.settle-editor label {
  display: grid;
  gap: 4px;
  font-size: 12px;
}
.formula {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 72px auto;
  gap: 6px;
  align-items: center;
}
.formula input[readonly] {
  background: #f5f7fa;
}
.formula-hint {
  margin: 0;
  font-size: 11px;
  color: #909399;
}
.settle-editor__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
