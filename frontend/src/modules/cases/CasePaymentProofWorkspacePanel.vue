<script lang="ts">
import type { CaseClosureWorkspace } from '../../api/case-closure-workspace';
type Selection = {
  recoveryOnly: boolean;
  caseVersion: number;
  stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
  closureVersionId: string;
  payment: Pick<
    CaseClosureWorkspace['effectivePayments'][number],
    'paymentId' | 'versionId'
  >;
};
</script>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { getCaseClosureWorkspace } from '../../api/case-closure-workspace';
import { downloadMaterialVersion } from '../../api/materials';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
import ProofPanel, {
  findPendingProofTarget,
} from './CasePaymentProofSupplementPanel.vue';
import CorrectionPanel, {
  findPendingPaymentCorrection,
} from './CasePaymentCorrectionPanel.vue';
import {
  getCasePaymentHistory,
  type CasePaymentHistory,
  type PaymentReplacement,
  type PaymentCorrectionResult,
} from '../../api/case-payment-correction';
const props = defineProps<{
  actorKey: string;
  caseId: string;
  session?: ListWorkflowSession;
}>();
const emit = defineEmits<{ cancel: [] }>();
const workspace = ref<CaseClosureWorkspace | null>(null);
const display = ref<CaseClosureWorkspace['effectivePayments']>([]);
const selected = ref<Selection | null>(null);
const correction = ref<
  (PaymentReplacement & { paymentId: string; versionId: string }) | null
>(null);
const correctionRecoveryOnly = ref(false);
const history = ref<CasePaymentHistory | null>(null);
const historyError = ref('');
const reviewRequired = ref(false);
const childSession = shallowRef<ListWorkflowSession>();
const state = ref<'idle' | 'submitting' | 'unknown'>('idle');
const loading = ref(false);
const refreshing = ref(false);
const refreshFailed = ref(false);
const paymentChanged = ref(false);
const error = ref('');
let generation = 0;
let controller = new AbortController();
const key = () => JSON.stringify([props.actorKey, props.caseId.toLowerCase()]);
const current = (token: number) =>
  token === generation &&
  (!props.session ||
    (props.session.isCurrent() &&
      props.session.context.actorKey === props.actorKey &&
      props.session.context.recordId.toLowerCase() ===
        props.caseId.toLowerCase()));
const available = computed(
  () =>
    !!workspace.value?.closure.versionId &&
    ['WAITING_ARCHIVE', 'ARCHIVED'].includes(workspace.value.stage),
);
watch(
  () => [props.actorKey, props.caseId, props.session],
  async () => {
    const token = ++generation;
    controller.abort();
    controller = new AbortController();
    workspace.value = null;
    display.value = [];
    selected.value = null;
    correction.value = null;
    history.value = null;
    historyError.value = '';
    reviewRequired.value = false;
    const correctionTarget = findPendingPaymentCorrection(
      props.actorKey,
      props.caseId,
    );
    if (correctionTarget) {
      correction.value = { ...correctionTarget };
      correctionRecoveryOnly.value = true;
    }
    const retained = findPendingProofTarget(props.actorKey, props.caseId);
    if (!selected.value && retained) {
      selected.value = {
        recoveryOnly: true,
        caseVersion: retained.caseVersion,
        stage: retained.stage,
        closureVersionId: retained.expectedClosureVersionId,
        payment: {
          paymentId: retained.paymentId,
          versionId: retained.expectedPaymentVersionId,
        },
      };
    }
    state.value = 'idle';
    refreshing.value = false;
    refreshFailed.value = false;
    paymentChanged.value = false;
    error.value = '';
    const outer = props.session;
    const context = outer?.context ?? {
      actorKey: props.actorKey,
      recordId: props.caseId,
      actionKey: 'payment-proof',
      title: '付款截图',
    };
    const owns = () => current(token);
    childSession.value = {
      context,
      generation: token,
      contextKey: `${key()}:${token}`,
      isCurrent: owns,
      beginSubmit(options) {
        if (
          !owns() ||
          refreshing.value ||
          state.value !== (options?.recovery ? 'unknown' : 'idle')
        )
          return false;
        if (outer && !outer.beginSubmit(options)) return false;
        state.value = 'submitting';
        return true;
      },
      endSubmit(outcome) {
        if (!owns() || state.value !== 'submitting') return false;
        if (
          outer &&
          !outer.endSubmit(outcome === 'success' ? 'completed' : outcome)
        )
          return false;
        state.value = outcome === 'unknown' ? 'unknown' : 'idle';
        return true;
      },
      restoreUnknown() {
        if (!owns() || state.value !== 'idle') return false;
        if (outer && !outer.restoreUnknown()) return false;
        state.value = 'unknown';
        return true;
      },
      deny() {
        outer?.deny();
      },
    };
    loading.value = true;
    if (!current(token)) {
      loading.value = false;
      return;
    }
    try {
      const value = await getCaseClosureWorkspace(props.caseId, {
        signal: controller.signal,
      });
      if (!current(token)) return;
      workspace.value = value;
      display.value = value.effectivePayments;
    } catch {
      if (current(token)) error.value = '无法读取授权付款工作区，请重试读取。';
    } finally {
      if (current(token)) loading.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
  controller.abort();
});
const newProofBlocked = computed(
  () =>
    !available.value ||
    loading.value ||
    refreshing.value ||
    refreshFailed.value ||
    paymentChanged.value ||
    state.value !== 'idle' ||
    !!selected.value,
  // A payment revision and proof must never share one unresolved submission.
);
const paymentActionBlocked = computed(
  () => newProofBlocked.value || !!correction.value,
);
function openCorrection(
  payment: CaseClosureWorkspace['effectivePayments'][number],
) {
  if (!current(generation) || paymentActionBlocked.value) return;
  correction.value = {
    paidOn: payment.paidOn,
    amount: payment.amount,
    payer: payment.payer,
    payee: payment.payee,
    paymentId: payment.paymentId,
    versionId: payment.versionId,
  };
  correctionRecoveryOnly.value = false;
}
async function cancelCorrection() {
  if (!current(generation) || state.value !== 'idle') return;
  correction.value = null;
  await reread();
}
async function corrected(result: PaymentCorrectionResult) {
  if (!current(generation) || state.value !== 'idle') return;
  reviewRequired.value = result.reviewRequired;
  correction.value = null;
  history.value = null;
  await reread();
}
async function readHistory() {
  const token = generation;
  if (!current(token) || paymentActionBlocked.value) return;
  historyError.value = '';
  try {
    const value = await getCasePaymentHistory(props.caseId, {
      signal: controller.signal,
    });
    if (
      !current(token) ||
      correction.value ||
      selected.value ||
      state.value !== 'idle'
    )
      return;
    if (
      value.caseVersion !== workspace.value?.caseVersion ||
      value.stage !== workspace.value?.stage ||
      value.closureVersionId !== workspace.value?.closure.versionId
    ) {
      history.value = null;
      paymentChanged.value = true;
      historyError.value = '付款资料已变化，请重新读取。';
      return;
    }
    const heads = new Map<
      string,
      CasePaymentHistory['paymentHistory'][number]
    >();
    for (const p of value.paymentHistory) {
      const prior = heads.get(p.paymentId);
      if (!prior || prior.revision < p.revision) heads.set(p.paymentId, p);
    }
    const active = [...heads.values()].filter((p) => p.state === 'ACTIVE');
    if (
      active.length !== workspace.value?.effectivePayments.length ||
      active.some(
        (p) =>
          !workspace.value?.effectivePayments.some(
            (current) =>
              current.paymentId === p.paymentId &&
              current.versionId === p.versionId,
          ),
      )
    ) {
      history.value = null;
      paymentChanged.value = true;
      historyError.value = '付款版本已变化，请重新读取。';
      return;
    }
    history.value = value;
  } catch {
    if (current(token)) {
      history.value = null;
      historyError.value = '无法读取付款历史，请重试。';
    }
  }
}
function openProof(payment: CaseClosureWorkspace['effectivePayments'][number]) {
  const w = workspace.value;
  if (
    !current(generation) ||
    paymentActionBlocked.value ||
    !w?.closure.versionId ||
    (w.stage !== 'WAITING_ARCHIVE' && w.stage !== 'ARCHIVED') ||
    !w.effectivePayments.some(
      (p) =>
        p.paymentId === payment.paymentId && p.versionId === payment.versionId,
    )
  )
    return;
  selected.value = {
    recoveryOnly: false,
    caseVersion: w.caseVersion,
    stage: w.stage,
    closureVersionId: w.closure.versionId,
    payment: { paymentId: payment.paymentId, versionId: payment.versionId },
  };
}
async function cancelProof() {
  if (!current(generation) || state.value !== 'idle') return;
  closeProof();
  await reread();
}
function closeProof() {
  if (!current(generation) || state.value !== 'idle') return;
  selected.value = null;
}
async function refreshProof() {
  const token = generation;
  if (!current(token) || refreshing.value || state.value !== 'idle') return;
  closeProof();
  refreshing.value = true;
  refreshFailed.value = false;
  error.value = '';
  try {
    const value = await getCaseClosureWorkspace(props.caseId, {
      signal: controller.signal,
    });
    if (current(token)) {
      paymentChanged.value =
        value.caseVersion !== workspace.value?.caseVersion ||
        value.stage !== workspace.value?.stage ||
        value.closure.versionId !== workspace.value?.closure.versionId ||
        display.value.some(
          (payment) =>
            !value.effectivePayments.some(
              (item) =>
                item.paymentId === payment.paymentId &&
                item.versionId === payment.versionId,
            ),
        );
      display.value = display.value.map((payment) => {
        const latest = value.effectivePayments.find(
          (item) =>
            item.paymentId === payment.paymentId &&
            item.versionId === payment.versionId,
        );
        return latest ? { ...payment, documents: latest.documents } : payment;
      });
    }
  } catch {
    if (current(token)) {
      refreshFailed.value = true;
      error.value =
        '付款截图已保存，但展示刷新失败。请重试读取，不要重复后补。';
    }
  } finally {
    if (current(token)) refreshing.value = false;
  }
}
async function reread() {
  const token = generation;
  if (
    !current(token) ||
    loading.value ||
    refreshing.value ||
    state.value !== 'idle' ||
    selected.value ||
    correction.value
  )
    return;
  loading.value = true;
  history.value = null;
  error.value = '';
  try {
    const value = await getCaseClosureWorkspace(props.caseId, {
      signal: controller.signal,
    });
    if (!current(token)) return;
    workspace.value = value;
    display.value = value.effectivePayments;
    paymentChanged.value = false;
    refreshFailed.value = false;
  } catch {
    if (current(token)) {
      // A retained display is not fresh authorization to start another proof.
      workspace.value = null;
      error.value = '无法读取授权付款工作区，请重试读取。';
    }
  } finally {
    if (current(token)) loading.value = false;
  }
}
async function download(materialId: string, contentVersionId: string) {
  const token = generation;
  if (!current(token)) return;
  try {
    await downloadMaterialVersion(
      materialId,
      contentVersionId,
      controller.signal,
    );
  } catch {
    if (current(token))
      error.value = '指定版本截图下载失败，请核对访问权限后重试。';
  }
}
function close() {
  if (current(generation) && state.value === 'idle' && !refreshing.value)
    emit('cancel');
}
</script>
<template>
  <section>
    <p>查看付款记录、截图和更正历史。权限由服务端重新校验。</p>
    <p v-if="reviewRequired" role="alert">
      付款更正后结清条件不足，需要核查。案件仍保持归档，原归档快照保留。
    </p>
    <p>当前负责人可独立后补有效付款的截图，原付款及回执保持不变。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="paymentChanged" role="alert">
      付款已更新，请重新读取。已确认的截图后补不会重复提交。
    </p>
    <ElButton
      v-if="paymentChanged || (!workspace && !!error)"
      data-test="reread"
      :disabled="loading || refreshing || state !== 'idle' || !!selected"
      @click="reread"
      >重新读取付款工作区</ElButton
    >
    <p v-if="loading" role="status">正在读取付款工作区…</p>
    <p v-else-if="workspace && !available">
      当前阶段或结案版本不足，不能后补截图。
    </p>
    <p v-if="workspace && !display.length">暂无有效付款记录。</p>
    <article
      v-for="payment in display"
      :key="payment.paymentId"
      :data-test="`payment-${payment.paymentId}`"
    >
      <p>
        {{ payment.paidOn }} · {{ payment.amount }} 元 · 付款人：{{
          payment.payer
        }}
        · 收款人：{{ payment.payee }}
      </p>
      <p>付款版本：{{ payment.versionId }}</p>
      <p>原始及后补截图（工作区返回的准确版本引用）：</p>
      <ul>
        <li
          v-for="document in payment.documents"
          :key="`${document.materialId}:${document.contentVersionId}`"
        >
          材料 {{ document.materialId }} · 内容版本
          {{ document.contentVersionId }}
          <ElButton
            data-test="download"
            @click="download(document.materialId, document.contentVersionId)"
            >下载此版本截图</ElButton
          >
        </li>
      </ul>
      <p v-if="!payment.documents.length">暂无截图。</p>
      <ElButton
        v-if="available"
        :data-test="`supplement-${payment.paymentId}`"
        :disabled="paymentActionBlocked"
        @click="openProof(payment)"
        >补此笔截图</ElButton
      >
      <ElButton
        v-if="available"
        :data-test="`correct-${payment.paymentId}`"
        :disabled="paymentActionBlocked"
        @click="openCorrection(payment)"
        >更正／撤销此笔付款</ElButton
      >
    </article>
    <CorrectionPanel
      v-if="correction && childSession"
      :actor-key="actorKey"
      :case-id="caseId"
      :payment="correction"
      :session="childSession"
      :allow-new="!correctionRecoveryOnly"
      @saved="corrected"
      @cancel="cancelCorrection"
    />
    <ElButton
      v-if="workspace"
      data-test="history"
      :disabled="paymentActionBlocked"
      @click="readHistory"
      >查看付款历史</ElButton
    >
    <p v-if="historyError" role="alert">{{ historyError }}</p>
    <section v-if="history" aria-label="付款更正历史">
      <article v-for="item in history.paymentHistory" :key="item.versionId">
        <p>
          第 {{ item.revision }} 版 ·
          {{ item.state === 'VOID' ? '已撤销' : '付款记录' }} ·
          {{ item.paidOn }} · {{ item.amount }} 元 · {{ item.payer }} →
          {{ item.payee }}
        </p>
        <p v-if="item.reason">原因：{{ item.reason }}</p>
        <p>原始截图（属于此历史版本）：</p>
        <ElButton
          v-for="document in item.originalDocuments"
          :key="document.contentVersionId"
          @click="download(document.materialId, document.contentVersionId)"
          >下载原始截图</ElButton
        >
        <p>独立后补截图（属于此历史版本）：</p>
        <ElButton
          v-for="document in item.supplementalDocuments"
          :key="document.contentVersionId"
          @click="download(document.materialId, document.contentVersionId)"
          >下载后补截图</ElButton
        >
      </article>
    </section>
    <ProofPanel
      v-if="selected && childSession && workspace && available"
      :actor-key="actorKey"
      :case-id="caseId"
      :case-version="selected.caseVersion"
      :stage="selected.stage"
      :expected-closure-version-id="selected.closureVersionId"
      :payment-id="selected.payment.paymentId"
      :expected-payment-version-id="selected.payment.versionId"
      :session="childSession"
      :allow-new="!selected.recoveryOnly"
      @supplemented="refreshProof"
      @cancel="cancelProof"
    />
    <ElButton
      v-if="refreshFailed"
      data-test="refresh"
      :disabled="refreshing"
      @click="refreshProof"
      >重试读取截图</ElButton
    >
    <ElButton
      data-test="close"
      :disabled="state !== 'idle' || refreshing"
      @click="close"
      >关闭</ElButton
    >
  </section>
</template>
