<script setup lang="ts">
import { computed } from 'vue';
import type { CaseDetail } from '../../api/cases';

const props = defineProps<{ item: CaseDetail }>();
type AmountRow = {
  key: string;
  label: string;
  state: 'KNOWN' | 'PENDING' | 'UNRECORDED';
  amount: string | null;
  source: string;
  sourceId?: string;
};
const categoryLabels = {
  NOTARY: '公证费',
  SAMPLE: '样品费',
  INVESTIGATION: '调查费',
  DISCLOSURE: '披露费',
} as const;
const sourceFees = computed<AmountRow[]>(() => {
  const rows: AmountRow[] = props.item.fees.map((fee, index) => ({
    key: `fee-${index}`,
    label: categoryLabels[fee.category],
    state: fee.state,
    amount: fee.amount,
    source:
      fee.sourceType === 'NOTARY_CERTIFICATE_FEE'
        ? '公证书费用'
        : '公证事项证据费用',
    sourceId: fee.sourceId,
  }));
  for (const category of [
    'NOTARY',
    'SAMPLE',
    'INVESTIGATION',
    'DISCLOSURE',
  ] as const) {
    if (!props.item.fees.some((fee) => fee.category === category))
      rows.push({
        key: category,
        label: categoryLabels[category],
        state: 'UNRECORDED',
        amount: null,
        source: '未返回来源费用记录',
      });
  }
  return rows;
});
const amounts = computed<AmountRow[]>(() => {
  const item = props.item;
  const claim = item.complaintConfirmation ?? item.complaint;
  const judgment = item.judgment.current;
  const second = item.secondInstance.currentResult;
  const closure = item.closure?.current;
  return [
    {
      key: 'claim',
      label: '诉状请求金额',
      state: claim?.amountState ?? 'UNRECORDED',
      amount: claim?.amount ?? null,
      source: item.complaintConfirmation
        ? '已确认诉状'
        : item.complaint
          ? `起诉提交 · ${item.complaint.submittedAt}`
          : '尚未登记诉状金额',
      sourceId: item.complaintConfirmation?.confirmedComplaintContentVersionId,
    },
    {
      key: 'judgment',
      label: '一审判决金额',
      state: judgment?.judgmentAmountState ?? 'UNRECORDED',
      amount: judgment?.judgmentAmount ?? null,
      source: judgment ? '一审判决' : '尚未登记一审判决金额',
      sourceId: judgment?.id,
    },
    {
      key: 'judgment-fee',
      label: '一审已交诉讼费（登记事实）',
      state: judgment?.paidLitigationFeeState ?? 'UNRECORDED',
      amount: judgment?.paidLitigationFee ?? null,
      source: judgment ? '一审判决' : '尚未登记一审诉讼费',
      sourceId: judgment?.id,
    },
    {
      key: 'second',
      label: '二审裁判金额',
      state: second?.judgmentAmountState ?? 'UNRECORDED',
      amount: second?.judgmentAmount ?? null,
      source: second
        ? `二审结果${second.result === 'REMAND' ? ' · 发回重审，无赔偿金额记录' : ''}`
        : '尚未登记二审裁判金额',
      sourceId: second?.id,
    },
    {
      key: 'second-fee',
      label: '二审已交诉讼费（登记事实）',
      state: second?.paidLitigationFeeState ?? 'UNRECORDED',
      amount: second?.paidLitigationFee ?? null,
      source: second ? '二审结果' : '尚未登记二审诉讼费',
      sourceId: second?.id,
    },
    {
      key: 'closure',
      label: '结案金额',
      state: closure?.closeAmountState ?? 'UNRECORDED',
      amount: closure?.closeAmt ?? null,
      source: closure ? '结案版本' : '尚未登记结案金额',
      sourceId: closure?.id,
    },
  ];
});
const stateLabels = {
  KNOWN: '已知',
  PENDING: '待定',
  UNRECORDED: '未登记',
} as const;
function displayAmount(row: AmountRow): string {
  return row.state === 'KNOWN' && row.amount !== null
    ? `¥ ${row.amount}`
    : stateLabels[row.state];
}
</script>

<template>
  <section class="case-workspace-fees" aria-label="费用管理">
    <h2>来源费用</h2>
    <dl class="case-workspace-fields">
      <div v-for="row in sourceFees" :key="row.key" data-test="source-fee">
        <dt class="case-workspace-field__label">{{ row.label }}</dt>
        <dd class="case-workspace-field__value">
          {{ displayAmount(row) }}
        </dd>
        <dd class="case-workspace-field__help">来源：{{ row.source }}</dd>
        <dd v-if="row.sourceId" class="case-workspace-field__help">
          <details data-test="fee-source-details">
            <summary>来源详情</summary>
            <p>来源标识：{{ row.sourceId }}</p>
          </details>
        </dd>
      </div>
    </dl>
    <h2>案件金额事实</h2>
    <p class="case-workspace-field__help">
      诉状请求、裁判及结案金额按各自来源展示，不代表本案实际收款或付款。
    </p>
    <dl class="case-workspace-fields">
      <div
        v-for="row in amounts"
        :key="row.key"
        :data-test="`amount-${row.key}`"
      >
        <dt class="case-workspace-field__label">{{ row.label }}</dt>
        <dd class="case-workspace-field__value">
          {{ displayAmount(row) }}
        </dd>
        <dd class="case-workspace-field__help">来源：{{ row.source }}</dd>
        <dd v-if="row.sourceId" class="case-workspace-field__help">
          <details data-test="fee-source-details">
            <summary>来源详情</summary>
            <p>来源标识：{{ row.sourceId }}</p>
          </details>
        </dd>
      </div>
    </dl>
    <h2>案件收付明细</h2>
    <p data-test="case-payments">
      尚未登记案件收付明细。当前数据未提供本案实收、实付或结清状态。
    </p>
  </section>
</template>
