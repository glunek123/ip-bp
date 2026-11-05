<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { getCaseClosureWorkspace } from '../../api/case-closure-workspace';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import ActualPanel from './CaseSettlementActualPanel.vue';
import type { CaseDetail } from '../../api/cases';
import type { CaseActualSummary } from '../settlements';

const props = defineProps<{
  item: CaseDetail;
  actorKey?: string;
  actorUserId?: string;
  actualEnabled?: boolean;
}>();
const emit = defineEmits<{ 'actual-summary': [summary: CaseActualSummary] }>();
const actualOpen = ref(false);
const savedRefresh = ref(false);
const eligible = computed(
  () =>
    props.actualEnabled === true &&
    !!props.actorKey &&
    props.actorUserId === props.item.owner.id &&
    ['WAITING_ARCHIVE', 'ARCHIVED'].includes(props.item.stage),
);
const context = () => ({
  recordId: props.item.id,
  actorKey: props.actorKey ?? '',
  actionKey: 'settlement-actual',
  title: '实际回款与律师开票',
});
const actualWorkflow = createListWorkflowContext(
  async ({ context: target, signal }) => {
    const workspace = await getCaseClosureWorkspace(target.recordId, {
      signal,
    });
    if (!['WAITING_ARCHIVE', 'ARCHIVED'].includes(workspace.stage))
      throw new ApiError(
        '当前阶段不能在此登记实际结算',
        409,
        'ACTUAL_STAGE_UNAVAILABLE',
      );
    return { id: workspace.caseId, workspace };
  },
);
const actualState = actualWorkflow.state;
const actual = computed(() =>
  actualState.value.status === 'ready'
    ? actualState.value.detail?.workspace.actual
    : undefined,
);
const actualVisible = computed(
  () => actualOpen.value || actualState.value.requestState !== 'idle',
);
watch(
  [eligible, actualState, actual],
  () => {
    const state = actualState.value.status;
    if (!eligible.value) {
      emit('actual-summary', { state: 'UNAVAILABLE' });
    } else if (state === 'loading') {
      emit('actual-summary', { state: 'LOADING' });
    } else if (state === 'denied') {
      emit('actual-summary', { state: 'DENIED' });
    } else if (state === 'error') {
      emit('actual-summary', { state: 'ERROR' });
    } else if (state === 'ready' && actual.value) {
      emit('actual-summary', {
        state: 'READY',
        customerReceiptState: actual.value.customerReceiptState,
        customerReceivedAmount: actual.value.customerReceivedAmount,
        lawyerInvoiceState: actual.value.lawyerInvoiceState,
        lawyerInvoicedAmount: actual.value.lawyerInvoicedAmount,
        scope: actual.value.scope,
      });
    }
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => [
    props.actorKey,
    props.actorUserId,
    props.item.id,
    props.item.stage,
    props.item.owner.id,
    props.actualEnabled,
  ],
  () => {
    actualOpen.value = false;
    savedRefresh.value = false;
    void actualWorkflow.sync(eligible.value ? context() : null);
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(actualWorkflow.dispose);
async function refreshActual(registered = false) {
  if (!eligible.value || !actualWorkflow.canLeave()) return;
  savedRefresh.value = registered;
  await actualWorkflow.sync(context());
}
function toggleActual() {
  if (
    !eligible.value ||
    actualState.value.status !== 'ready' ||
    !actualWorkflow.canLeave()
  )
    return;
  actualOpen.value = !actualOpen.value;
}
function closeActual() {
  if (actualWorkflow.canLeave()) actualOpen.value = false;
}
defineExpose({ canLeave: actualWorkflow.canLeave });
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
    <details class="case-workspace-fees__history">
      <summary>金额来源与历史</summary>
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
    </details>
    <h2>案件收付明细</h2>
    <p data-test="case-payments">
      本区展示来源费用与案件金额事实；未展示实际结算不代表未登记或已结清。
    </p>
    <section
      v-if="eligible"
      aria-label="实际回款与律师开票"
      data-test="actual-finance"
    >
      <h2>实际回款与律师开票</h2>
      <p v-if="actualState.status === 'loading'" role="status">
        正在读取授权实际结算汇总…
      </p>
      <template v-else-if="actualState.status === 'ready' && actual">
        <p data-test="actual-customer">
          客户实际回款：{{
            actual.customerReceiptState === 'RECORDED'
              ? actual.customerReceivedAmount + ' 元'
              : '未知（无可用登记汇总）'
          }}
        </p>
        <p data-test="actual-lawyer">
          律师实际开票：{{
            actual.lawyerInvoiceState === 'RECORDED'
              ? actual.lawyerInvoicedAmount + ' 元'
              : '未知（无可用登记汇总）'
          }}
        </p>
        <p>
          以上按{{
            actual.scope === 'CONSOLIDATION' ? '主案来源分配' : '本案分配'
          }}展示，不代替应结金额或结清核验。
        </p>
        <ElButton
          data-test="open-actual"
          :disabled="actualState.requestState !== 'idle'"
          @click="toggleActual"
          >{{
            actualVisible ? '收起实际登记' : '登记实际回款／律师开票'
          }}</ElButton
        >
        <ActualPanel
          v-if="actualState.session && actualState.detail"
          v-show="actualVisible"
          :actor-key="actorKey ?? ''"
          :case-id="item.id"
          :actual-registration-lawyers="
            actualState.detail.workspace.actualRegistrationLawyers
          "
          :session="actualState.session"
          @registered="refreshActual(true)"
          @cancel="closeActual"
        />
      </template>
      <p
        v-else-if="
          actualState.status === 'denied' || actualState.status === 'error'
        "
        role="alert"
      >
        {{
          savedRefresh
            ? '实际登记已确认，但汇总读取失败，请重试读取，勿重复登记。'
            : '无法读取授权实际结算汇总，请核对权限后重试。'
        }}
        <ElButton data-test="refresh-actual" @click="refreshActual()"
          >重新读取实际汇总</ElButton
        >
      </p>
    </section>
  </section>
</template>
