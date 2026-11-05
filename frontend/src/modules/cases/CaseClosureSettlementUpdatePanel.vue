<script lang="ts">
import { reactive, shallowReactive } from 'vue';
import type SettlementForm from './CaseClosureSettlementUpdateForm.vue';
import type { PaymentProofUpload } from '../../api/payment-proof-upload';
type Draft = Parameters<
  NonNullable<InstanceType<typeof SettlementForm>['$props']['onDraft']>
>[0];
type Preparation = {
  draft: Draft;
  version: number;
  unknown: boolean;
  busy: boolean;
  handles: Map<globalThis.File, PaymentProofUpload>;
  documents: Map<globalThis.File, string>;
};
const preparations = new Map<string, Preparation>();
const proofSelections = new Map<
  string,
  { paymentId: string; versionId: string; unresolved: boolean }
>();
import type {
  UpdateClosureSettlementInput,
  ClosureSettlementUpdateResult,
  ClosureAmountUpdateInput,
  ClosureAmountUpdateResult,
} from '../../api/case-closure-commands';
type Pending = {
  kind: 'combined' | 'amount';
  input: UpdateClosureSettlementInput | ClosureAmountUpdateInput;
  status: 'ready' | 'sending' | 'unknown' | 'confirmed';
  result?: ClosureSettlementUpdateResult | ClosureAmountUpdateResult;
  delivered?: boolean;
};
const commands = new Map<string, Pending>();
</script>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import ActualPanel from './CaseSettlementActualPanel.vue';
import ProofPanel, {
  findPendingProofTarget,
} from './CasePaymentProofSupplementPanel.vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import Form, {
  type SettlementUpdateSource,
} from './CaseClosureSettlementUpdateForm.vue';
import {
  getCaseClosureWorkspace,
  type CaseClosureWorkspace,
} from '../../api/case-closure-workspace';
import {
  updateCaseClosureSettlement,
  updateClosureAmounts,
  type SettlementAmountOverride,
} from '../../api/case-closure-commands';
import { uploadSettlementUpdateDocumentFile } from '../../api/settlement-document-upload';
import { ApiError } from '../../api/http';
import {
  preparePaymentProofUpload,
  finalizePaymentProofUpload,
} from '../../api/payment-proof-upload';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
const props = withDefaults(
  defineProps<{
    actorKey: string;
    caseId: string;
    canCorrectClosure?: boolean;
    session?: ListWorkflowSession;
  }>(),
  { canCorrectClosure: true },
);
const emit = defineEmits<{
  done: [result: ClosureSettlementUpdateResult | ClosureAmountUpdateResult];
  cancel: [];
}>();
const workspace = ref<CaseClosureWorkspace | null>(null);
const error = ref('');
const busy = ref(false);
const pending = ref<Pending | null>(null);
const proofPaymentId = ref('');
const proofAllowNew = ref(false);
const proofState = ref<'idle' | 'submitting' | 'unknown'>('idle');
const proofSession = shallowRef<ListWorkflowSession>();
const proofDisplay = ref<CaseClosureWorkspace['effectivePayments']>([]);
const proofRefreshing = ref(false);
const proofRefreshFailed = ref(false);
const proofSourceChanged = ref(false);
const proofTarget = computed(
  () =>
    workspace.value?.effectivePayments?.find(
      (p) => p.paymentId === proofPaymentId.value,
    ) ?? (proofPaymentId.value ? proofSelections.get(key()) : undefined),
);
const preparation = shallowRef<Preparation | null>(null);
const restoredPending = ref(false);
const confirmedPaymentType = ref<'ONE_TIME' | 'INSTALLMENTS' | ''>('');
const confirmedUnknownAmount = ref(false);
const actualOpen = ref(false);
const actualRequestState = ref<'idle' | 'submitting' | 'unknown'>('idle');
const actualSession = shallowRef<ListWorkflowSession>();
const actualDisplay = ref<CaseClosureWorkspace['actual'] | null>(null);
const actualLawyers = ref<CaseClosureWorkspace['actualRegistrationLawyers']>(
  [],
);
const actualRefreshBusy = ref(false);
const actualReadError = ref('');
const actualAvailable = ref(false);
const actualActorKey = computed(
  () => props.session?.context.actorKey ?? props.actorKey,
);
const actualBlocked = computed(
  () =>
    actualOpen.value ||
    actualRequestState.value !== 'idle' ||
    actualRefreshBusy.value ||
    !!proofPaymentId.value ||
    proofRefreshing.value,
);
let actualReadGeneration = 0;
let generation = 0;
onBeforeUnmount(() => {
  generation++;
});
const key = () => JSON.stringify([props.actorKey, props.caseId]);
const current = (token: number) =>
  token === generation && (!props.session || props.session.isCurrent());
function close() {
  if (actualBlocked.value) return;
  if (
    props.session &&
    (!props.session.isCurrent() ||
      busy.value ||
      (pending.value && pending.value.status !== 'confirmed') ||
      preparation.value)
  )
    return;
  emit('cancel');
}
watch(
  () => [props.actorKey, props.caseId, props.session],
  async () => {
    const token = ++generation;
    workspace.value = null;
    actualOpen.value = false;
    actualRequestState.value = 'idle';
    actualDisplay.value = null;
    actualLawyers.value = [];
    actualReadError.value = '';
    actualAvailable.value = false;
    actualRefreshBusy.value = false;
    actualReadGeneration++;
    const outer = props.session;
    const context = outer?.context ?? {
      recordId: props.caseId,
      actorKey: props.actorKey,
      actionKey: 'settlement-actual',
      title: '实际回款及开票',
    };
    const owns = () => current(token) && context.recordId === props.caseId;
    const retainedProof = findPendingProofTarget(props.actorKey, props.caseId);
    if (!proofSelections.has(key()) && retainedProof)
      proofSelections.set(key(), {
        paymentId: retainedProof.paymentId,
        versionId: retainedProof.expectedPaymentVersionId,
        unresolved: true,
      });
    proofPaymentId.value = proofSelections.get(key())?.paymentId ?? '';
    proofAllowNew.value = false;
    proofState.value = 'idle';
    proofRefreshing.value = false;
    proofRefreshFailed.value = false;
    proofSourceChanged.value = false;
    proofDisplay.value = [];
    proofSession.value = {
      context,
      generation: token,
      contextKey: JSON.stringify([
        context.actorKey,
        context.recordId,
        'proof',
        token,
      ]),
      isCurrent: owns,
      beginSubmit(options) {
        if (
          !owns() ||
          busy.value ||
          pending.value ||
          preparation.value ||
          actualOpen.value ||
          proofState.value !== (options?.recovery ? 'unknown' : 'idle')
        )
          return false;
        if (outer && !outer.beginSubmit(options)) return false;
        proofState.value = 'submitting';
        const selected = proofSelections.get(key());
        if (selected) selected.unresolved = true;
        return true;
      },
      endSubmit(outcome) {
        if (!owns() || proofState.value !== 'submitting') return false;
        if (outer && !outer.endSubmit(outcome)) return false;
        proofState.value = outcome === 'unknown' ? 'unknown' : 'idle';
        const selected = proofSelections.get(key());
        if (selected) selected.unresolved = outcome === 'unknown';
        return true;
      },
      restoreUnknown() {
        if (!owns() || proofState.value !== 'idle') return false;
        if (outer && !outer.restoreUnknown()) return false;
        proofState.value = 'unknown';
        return true;
      },
      deny() {
        outer?.deny();
      },
    };
    actualSession.value = {
      context,
      generation: token,
      contextKey: JSON.stringify([context.actorKey, context.recordId, token]),
      isCurrent: owns,
      beginSubmit(options) {
        if (
          !owns() ||
          busy.value ||
          pending.value ||
          preparation.value ||
          actualRefreshBusy.value ||
          !!proofPaymentId.value ||
          actualRequestState.value !== (options?.recovery ? 'unknown' : 'idle')
        )
          return false;
        if (outer && !outer.beginSubmit(options)) return false;
        actualRequestState.value = 'submitting';
        return true;
      },
      endSubmit(outcome) {
        if (!owns() || actualRequestState.value !== 'submitting') return false;
        if (outer && !outer.endSubmit(outcome)) return false;
        actualRequestState.value = outcome === 'unknown' ? 'unknown' : 'idle';
        return true;
      },
      restoreUnknown() {
        if (!owns() || actualRequestState.value !== 'idle') return false;
        if (outer) {
          outer.endSubmit('unknown');
          outer.restoreUnknown();
          if (!outer.isCurrent()) return false;
        }
        actualRequestState.value = 'unknown';
        actualOpen.value = true;
        return true;
      },
      deny() {
        outer?.deny();
      },
    };
    confirmedPaymentType.value = '';
    confirmedUnknownAmount.value = false;
    error.value = '';
    pending.value = commands.get(key()) ?? null;
    preparation.value = preparations.get(key()) ?? null;
    if (preparation.value) {
      preparation.value.unknown = true;
      props.session?.restoreUnknown();
    }
    restoredPending.value = !!pending.value && !pending.value.delivered;
    if (restoredPending.value) props.session?.restoreUnknown();
    busy.value = false;
    if (!current(token)) return;
    try {
      const value = await getCaseClosureWorkspace(props.caseId);
      if (current(token)) {
        workspace.value = value;
        if (
          value.stage === 'ARCHIVED' &&
          !proofSelections.get(key())?.unresolved
        ) {
          proofSelections.delete(key());
          proofPaymentId.value = '';
        }
        proofDisplay.value = value.effectivePayments;
        actualDisplay.value = value.actual ?? null;
        actualLawyers.value = value.actualRegistrationLawyers;
        actualAvailable.value =
          value.stage === 'WAITING_ARCHIVE' && !!value.closure.versionId;
      }
    } catch {
      if (current(token))
        error.value = '无法读取授权结案工作区，请关闭后重试。';
    }
  },
  { immediate: true },
);
const newProofBlocked = computed(
  () =>
    !workspace.value?.closure.versionId ||
    workspace.value.stage !== 'WAITING_ARCHIVE' ||
    busy.value ||
    !!pending.value ||
    !!preparation.value ||
    actualOpen.value ||
    actualRequestState.value !== 'idle' ||
    actualRefreshBusy.value ||
    proofRefreshing.value ||
    proofRefreshFailed.value ||
    proofSourceChanged.value ||
    !!proofPaymentId.value,
);
function openProof(paymentId: string) {
  const payment = workspace.value?.effectivePayments.find(
    (p) => p.paymentId === paymentId,
  );
  if (!current(generation) || newProofBlocked.value || !payment) return;
  proofSelections.set(key(), {
    paymentId: payment.paymentId,
    versionId: payment.versionId,
    unresolved: false,
  });
  proofAllowNew.value = true;
  proofPaymentId.value = payment.paymentId;
}
async function cancelProof() {
  if (!current(generation) || proofState.value !== 'idle') return;
  closeProof();
  await refreshProof(false);
}
function closeProof() {
  if (proofState.value !== 'idle') return;
  proofSelections.delete(key());
  proofPaymentId.value = '';
  proofAllowNew.value = false;
}
async function refreshProof(saved = true) {
  const token = generation;
  proofRefreshing.value = true;
  proofRefreshFailed.value = false;
  error.value = '';
  closeProof();
  try {
    const value = await getCaseClosureWorkspace(props.caseId);
    if (current(token)) {
      const original = workspace.value;
      proofSourceChanged.value =
        !original ||
        value.caseVersion !== original.caseVersion ||
        value.stage !== original.stage ||
        value.closure.versionId !== original.closure.versionId ||
        value.effectivePayments.length !== original.effectivePayments.length ||
        original.effectivePayments.some(
          (payment) =>
            !value.effectivePayments.some(
              (latest) =>
                latest.paymentId === payment.paymentId &&
                latest.versionId === payment.versionId,
            ),
        );
      proofDisplay.value = value.effectivePayments;
    }
  } catch {
    if (current(token)) {
      proofRefreshFailed.value = true;
      error.value = saved
        ? '付款截图已保存，但材料展示刷新失败；结算草稿仍保留。'
        : '无法重新读取付款截图，请重试读取；结算草稿仍保留。';
    }
  } finally {
    if (current(token)) proofRefreshing.value = false;
  }
}
async function refreshActual() {
  const token = generation;
  const readToken = ++actualReadGeneration;
  const caseId = props.caseId;
  actualRefreshBusy.value = true;
  actualReadError.value = '';
  try {
    const value = await getCaseClosureWorkspace(caseId);
    if (!current(token) || readToken !== actualReadGeneration) return;
    // Keep the original source object and all unsaved settlement inputs intact.
    actualDisplay.value = value.actual;
    actualLawyers.value = value.actualRegistrationLawyers;
    actualAvailable.value =
      value.stage === 'WAITING_ARCHIVE' && !!value.closure.versionId;
    if (!actualAvailable.value) actualOpen.value = false;
  } catch {
    if (current(token) && readToken === actualReadGeneration) {
      actualLawyers.value = [];
      actualAvailable.value = false;
      actualOpen.value = false;
      actualReadError.value =
        '实际登记已确认，但最新汇总读取失败。保留原结算草稿；请重试读取。';
    }
  } finally {
    if (current(token) && readToken === actualReadGeneration)
      actualRefreshBusy.value = false;
  }
}
watch(
  () => [pending.value?.status, props.session] as const,
  ([status]) => {
    const session = props.session;
    const command = pending.value;
    if (
      status !== 'confirmed' ||
      !restoredPending.value ||
      !command ||
      command.delivered ||
      !session?.isCurrent()
    )
      return;
    // A previous view can receive the original POST receipt after this view restored it.
    // Claim the restored unknown request before closing this exact current workflow.
    if (!session.beginSubmit({ recovery: true })) return;
    command.delivered = true;
    restoredPending.value = false;
    if (!session.endSubmit('success')) {
      command.delivered = false;
      if (pending.value === command) restoredPending.value = true;
    }
  },
  { immediate: true },
);
const source = computed<SettlementUpdateSource | null>(() => {
  const w = workspace.value;
  const paymentType =
    w?.closure.paymentType === 'UNKNOWN'
      ? confirmedPaymentType.value
      : w?.closure.paymentType;
  if (
    !w ||
    w.stage !== 'WAITING_ARCHIVE' ||
    !w.closure.versionId ||
    !paymentType ||
    (w.closure.amountState === 'UNKNOWN' && !confirmedUnknownAmount.value)
  )
    return null;
  return {
    expectedClosureVersionId: w.closure.versionId,
    closeAt: w.closure.closeOn,
    closeAmt: w.closure.amountState === 'UNKNOWN' ? null : w.closure.amount,
    paymentType,
    documents: w.documents.map((d) => ({
      id: d.contentVersionId,
      name: `历史文书 ${d.contentVersionId}`,
    })),
    payments: w.effectivePayments.map((p) => ({
      id: p.paymentId,
      versionId: p.versionId,
      paymentDate: p.paidOn,
      amount: p.amount,
      payer: p.payer,
      payee: p.payee,
      receiptIds: p.documents.map((d) => d.contentVersionId),
    })),
    refund: {
      versionId: w.refund.versionId,
      items: w.refund.items,
      completeness: w.refund.declaration,
    },
    settlement: {
      expectedAssessmentVersionId: w.assessment.versionId,
      expectedTermsVersion: w.assessment.termsVersion,
      declaration: w.assessment.declaration,
    },
    customerAmount: w.assessment.customerAmount,
    lawyerAmount: w.assessment.lawyerAmount,
  };
});
function amount(
  value: NonNullable<Draft['settlement']>['customerAmount'],
): SettlementAmountOverride | undefined {
  if (!value) return undefined;
  if (value.mode === 'MANUAL') {
    if (value.amount === undefined) throw new Error('缺少手工金额');
    return { mode: 'MANUAL', amount: value.amount };
  }
  return { mode: value.mode };
}
async function send(admitted = false) {
  const command = pending.value;
  if (
    !command ||
    command.status === 'sending' ||
    command.status === 'confirmed' ||
    busy.value ||
    !current(generation)
  )
    return;
  const token = generation;
  const caseId = props.caseId;
  const identity = key();
  const wasUnknown = command.status === 'unknown';
  const session = props.session;
  if (!admitted && session && !session.beginSubmit({ recovery: wasUnknown }))
    return;
  command.status = 'sending';
  try {
    const result =
      command.kind === 'amount'
        ? await updateClosureAmounts(
            caseId,
            command.input as ClosureAmountUpdateInput,
          )
        : await updateCaseClosureSettlement(
            caseId,
            command.input as UpdateClosureSettlementInput,
          );
    command.status = 'confirmed';
    command.result = result;
    if (current(token)) {
      error.value = '';
      command.delivered = true;
      if (session) {
        if (!session.endSubmit('success')) {
          command.delivered = false;
          if (pending.value === command) restoredPending.value = true;
        }
      } else emit('done', result);
    }
  } catch (cause) {
    const uncertain =
      wasUnknown ||
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.code === 'INVALID_RESPONSE';
    if (!uncertain) {
      if (!current(token)) {
        // A successor view may already protect this in-flight command as unknown.
        // Retain its original request so that successor can safely resolve it.
        command.status = 'unknown';
        return;
      }
      commands.delete(identity);
      if (current(token)) {
        session?.endSubmit('failed');
        pending.value = null;
        error.value =
          '保存被拒绝，请修正资料后重提；权限或版本冲突时请关闭后重新读取工作区。';
      }
      return;
    }
    command.status = 'unknown';
    if (current(token)) {
      session?.endSubmit('unknown');
      error.value = session
        ? '保存结果未确认。请重试原请求；列表正在保护本次操作，确认结果前不能关闭。本次会话保留原请求，刷新页面会丢失恢复信息。'
        : '保存结果未确认。请重试原请求或退出后核对；本次会话保留原请求，刷新页面会丢失恢复信息。';
    }
  }
}
async function submit(draft: Draft, recovery = false) {
  if (
    actualBlocked.value ||
    proofRefreshFailed.value ||
    proofSourceChanged.value ||
    busy.value ||
    pending.value ||
    (preparation.value && !recovery) ||
    !source.value ||
    !workspace.value ||
    !current(generation)
  )
    return;
  if (
    draft.receiptAdditions.some((r) => r.files.length) ||
    draft.paymentRecords.some((p) => p.receiptName && !p.receiptFile)
  ) {
    error.value =
      '原付款截图后补属于独立命令，当前不能与结算更新一起保存。请移除原付款后补截图；新增付款截图可随本次更新提交。';
    return;
  }
  const token = generation;
  const caseId = props.caseId;
  const identity = key();
  const w = workspace.value;
  const session = props.session;
  const s = source.value;
  const onlyAmounts =
    !!draft.settlement &&
    ((draft.settlement.customerAmount &&
      draft.settlement.customerAmount.mode !== 'KEEP') ||
      (draft.settlement.lawyerAmount &&
        draft.settlement.lawyerAmount.mode !== 'KEEP')) &&
    draft.settlement.declaration === s.settlement?.declaration &&
    !draft.refund &&
    draft.closeAt === s.closeAt &&
    draft.closeAmt === s.closeAmt &&
    draft.paymentType === s.paymentType &&
    !draft.paymentRecords.length &&
    !draft.newDocuments.length &&
    !draft.receiptAdditions.some((r) => r.files.length) &&
    draft.preservedDocumentIds.length === s.documents.length &&
    draft.preservedDocumentIds.every((id, i) => id === s.documents[i]?.id) &&
    draft.existingPaymentVersions.length === s.payments.length &&
    draft.existingPaymentVersions.every(
      (id, i) => id === s.payments[i]?.versionId,
    );
  if (onlyAmounts && draft.settlement && !recovery && !preparation.value) {
    if (session && !session.beginSubmit()) return;
    const input: ClosureAmountUpdateInput = {
      idempotencyKey: globalThis.crypto.randomUUID(),
      expectedClosureVersionId: draft.expectedClosureVersionId,
      expectedTermsVersion: draft.settlement.expectedTermsVersion,
      expectedAssessmentVersionId: draft.settlement.expectedAssessmentVersionId,
      customerAmount: amount(draft.settlement.customerAmount) ?? {
        mode: 'KEEP',
      },
      lawyerAmount: amount(draft.settlement.lawyerAmount) ?? { mode: 'KEEP' },
    };
    const command = reactive<Pending>({
      kind: 'amount',
      input,
      status: 'ready',
    });
    commands.set(identity, command);
    pending.value = command;
    await send(true);
    return;
  }
  const retained = preparations.get(identity);
  if (preparation.value && retained !== preparation.value) {
    preparation.value = retained ?? null;
    error.value = '原上传准备已由另一视图处理，请核对当前草稿后重试。';
    return;
  }
  if (retained?.busy) {
    preparation.value = retained;
    error.value = '原草稿上传仍在处理中，请等待原上传结束后重试。';
    return;
  }
  if (
    retained &&
    (retained.version !== w.caseVersion ||
      retained.draft.expectedClosureVersionId !== w.closure.versionId)
  ) {
    preparation.value = retained;
    retained.unknown = true;
    session?.restoreUnknown();
    error.value =
      '案件或结案版本已变化，已保留原草稿与原上传供核对；不能继续上传或提交旧版本。';
    return;
  }
  if (session && !session.beginSubmit({ recovery })) return;
  const prep =
    retained ??
    shallowReactive({
      draft,
      version: w.caseVersion,
      unknown: false,
      busy: false,
      handles: new Map<globalThis.File, PaymentProofUpload>(),
      documents: new Map<globalThis.File, string>(),
    });
  preparations.set(identity, prep);
  preparation.value = prep;
  prep.busy = true;
  busy.value = true;
  try {
    const ids = [...draft.preservedDocumentIds];
    for (const file of draft.newDocuments) {
      const existing = prep.documents.get(file);
      if (existing) {
        ids.push(existing);
        continue;
      }
      const uploaded = await uploadSettlementUpdateDocumentFile(
        caseId,
        draft.expectedClosureVersionId,
        file,
      );
      prep.documents.set(file, uploaded.contentVersionId);
      if (!current(token)) return;
      ids.push(uploaded.contentVersionId);
    }
    const proofIds = new Map<string, string>();
    const context = {
      actorKey: props.actorKey,
      caseId,
      expectedVersion: prep.version,
    };
    for (const payment of draft.paymentRecords) {
      if (!payment.receiptFile) continue;
      if (!current(token)) return;
      let handle = prep.handles.get(payment.receiptFile);
      if (!handle) {
        handle = await preparePaymentProofUpload(context, payment.receiptFile);
        prep.handles.set(payment.receiptFile, handle);
        if (!current(token)) return;
      }
      const contentVersionId = await finalizePaymentProofUpload(
        handle,
        context,
      );
      if (!current(token)) return;
      proofIds.set(payment.id, contentVersionId);
    }
    if (!current(token)) return;
    const input: UpdateClosureSettlementInput = {
      expectedVersion: prep.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      expectedClosureVersionId: draft.expectedClosureVersionId,
      closeAt: draft.closeAt,
      closeAmountState: draft.closeAmountState,
      closeAmt: draft.closeAmt,
      closeContentVersionIds: ids,
      paymentType: draft.paymentType,
      paymentRecords: draft.paymentRecords.map((p) => ({
        paidOn: p.paymentDate,
        amount: p.amount,
        payer: p.payer,
        payee: p.payee,
        screenshotContentVersionId: proofIds.get(p.id) ?? null,
      })),
      ...(draft.refund
        ? {
            refund:
              draft.refund.kind === 'CONFIRM_COMPLETE'
                ? {
                    expectedVersionId: draft.refund.expectedVersionId,
                    kind: 'CONFIRM_COMPLETE' as const,
                  }
                : {
                    expectedVersionId: draft.refund.expectedVersionId,
                    kind: draft.refund.kind,
                    items: draft.refund.items ?? [],
                  },
          }
        : {}),
      ...(draft.settlement
        ? {
            settlement: {
              ...draft.settlement,
              customerAmount: amount(draft.settlement.customerAmount),
              lawyerAmount: amount(draft.settlement.lawyerAmount),
            },
          }
        : {}),
    };
    const command = reactive<Pending>({
      kind: 'combined',
      input,
      status: 'ready',
    });
    commands.set(identity, command);
    pending.value = command;
    preparations.delete(identity);
    preparation.value = null;
  } catch (cause) {
    const uncertain =
      cause instanceof ApiError && cause.code === 'UPLOAD_RESULT_UNKNOWN';
    prep.unknown ||= uncertain;
    if (current(token)) {
      session?.endSubmit(prep.unknown ? 'unknown' : 'failed');
      if (!prep.unknown) {
        preparations.delete(identity);
        preparation.value = null;
      }
      error.value = prep.unknown
        ? '付款截图上传结果未确认，尚未提交结算更新。请重试原草稿与原文件；确认前不能改写本单。'
        : '文书上传或草稿准备未完成，未提交结算更新。请核对后重试。';
    }
  } finally {
    prep.busy = false;
    if (token === generation) busy.value = false;
  }
  if (current(token) && pending.value) await send(true);
}
async function abandonPreparation() {
  const prep = preparation.value;
  const identity = key();
  const token = generation;
  if (
    !prep ||
    preparations.get(identity) !== prep ||
    prep.busy ||
    busy.value ||
    pending.value ||
    commands.has(identity) ||
    actualBlocked.value ||
    !current(token)
  )
    return;
  const session = props.session;
  if (session) {
    if (!session.beginSubmit({ recovery: true }) && !session.beginSubmit())
      return;
    if (!session.endSubmit('failed')) return;
  }
  preparations.delete(identity);
  preparation.value = null;
  workspace.value = null;
  confirmedPaymentType.value = '';
  confirmedUnknownAmount.value = false;
  busy.value = true;
  error.value =
    '已放弃尚未提交的原草稿。已上传候选不会自动关联案件，未删除服务端文件或历史。';
  try {
    const value = await getCaseClosureWorkspace(props.caseId);
    if (current(token)) workspace.value = value;
  } catch {
    if (current(token))
      error.value =
        '已放弃原上传准备，但工作区读取失败，请关闭后重试。已上传候选不会自动关联案件。';
  } finally {
    if (token === generation) busy.value = false;
  }
}
</script>
<template>
  <section>
    <p>
      保存只更新结算资料，案件保持待归档。文书先上传，保存成功后才关联；付款截图后补另行办理。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="proofSourceChanged" role="alert">
      案件或付款记录已变化。当前填写内容仍保留，请先记录所需内容，再关闭并重新打开，核对最新资料后提交。
    </p>
    <ElButton
      v-if="proofRefreshFailed"
      data-test="retry-proof-refresh"
      :disabled="proofRefreshing"
      @click="refreshProof()"
      >重试读取付款资料</ElButton
    >
    <section v-if="preparation?.unknown" aria-label="待恢复的原结算草稿">
      <p>
        正在保留原草稿：结案日期 {{ preparation.draft.closeAt }}；结案金额
        {{ preparation.draft.closeAmt ?? '待确认' }}；恢复时使用以下原付款资料。
      </p>
      <p v-for="row in preparation.draft.paymentRecords" :key="row.id">
        {{ row.paymentDate }} / {{ row.amount }} / {{ row.payer }} →
        {{ row.payee }} / {{ row.receiptFile?.name ?? '无截图' }}
      </p>
      <p>
        原结算及退费修改一并保留。恢复只提交原草稿，确认结果前不能修改本单。
      </p>
    </section>

    <fieldset
      v-if="
        workspace?.stage === 'WAITING_ARCHIVE' &&
        workspace.closure.versionId &&
        !pending
      "
      :disabled="
        busy ||
        actualBlocked ||
        !!preparation ||
        proofRefreshFailed ||
        proofSourceChanged
      "
    >
      <label v-if="workspace.closure.paymentType === 'UNKNOWN'">
        历史付款类型未确认，请明确选择
        <select v-model="confirmedPaymentType" aria-label="确认历史付款类型">
          <option value="">请选择付款类型</option>
          <option value="ONE_TIME">一次性付款</option>
          <option value="INSTALLMENTS">分期付款</option>
        </select>
      </label>
      <label v-if="workspace.closure.amountState === 'UNKNOWN'">
        <input
          v-model="confirmedUnknownAmount"
          type="checkbox"
          aria-label="确认历史金额待确认"
        />
        历史结案金额未确认，明确保留为待确认；下方可取消金额待确认并输入金额（含明确零金额）。
      </label>
    </fieldset>
    <p v-if="pending?.status === 'confirmed'" role="status">
      结算更新保存成功。
    </p>
    <fieldset
      v-else-if="source && !pending"
      :disabled="
        busy ||
        actualBlocked ||
        !!preparation ||
        proofRefreshFailed ||
        proofSourceChanged
      "
    >
      <Form
        :source="source"
        :can-correct-closure="props.canCorrectClosure"
        @draft="submit"
        @cancel="close"
      >
        <template #payment-proof="{ payment }">
          <ElButton
            type="default"
            :data-test="`proof-${payment.id}`"
            :disabled="newProofBlocked"
            @click="openProof(payment.id)"
            >补截图</ElButton
          >
          <p>截图独立后补，不随结算表单提交。</p>
          <p>
            当前截图引用：{{
              proofDisplay
                .find((p) => p.paymentId === payment.id)
                ?.documents.map((d) => d.contentVersionId)
                .join('、') || '暂无'
            }}
          </p>
        </template>
      </Form>
    </fieldset>
    <ProofPanel
      v-if="
        proofTarget &&
        workspace?.closure.versionId &&
        (workspace.stage === 'WAITING_ARCHIVE' ||
          workspace.stage === 'ARCHIVED') &&
        proofSession
      "
      :actor-key="proofSession.context.actorKey"
      :case-id="caseId"
      :case-version="workspace.caseVersion"
      :stage="workspace.stage"
      :expected-closure-version-id="workspace.closure.versionId"
      :payment-id="proofTarget.paymentId"
      :expected-payment-version-id="proofTarget.versionId"
      :session="proofSession"
      :allow-new="proofAllowNew"
      @supplemented="refreshProof()"
      @cancel="cancelProof"
    />
    <p v-if="!source && !pending">
      {{
        workspace
          ? '当前阶段或结案资料不足，不能保存；未知信息须先确认。'
          : '正在读取结案工作区…'
      }}
    </p>
    <section v-if="workspace" data-test="actual-summary">
      <p>
        本案客户实际回款：{{
          actualDisplay?.customerReceivedAmount ?? '未登记／未知'
        }}<template v-if="actualDisplay?.customerReceivedAmount != null">
          元</template
        >；律师实际开票：{{
          actualDisplay?.lawyerInvoicedAmount ?? '未登记／未知'
        }}<template v-if="actualDisplay?.lawyerInvoicedAmount != null">
          元</template
        >。
      </p>
      <p>以上为展示值，不作为归档通过依据。</p>
      <p v-if="actualReadError" role="alert">{{ actualReadError }}</p>
      <ElButton
        v-if="actualReadError"
        :disabled="actualRefreshBusy || actualRequestState !== 'idle'"
        data-test="refresh-actual"
        @click="refreshActual"
        >重试读取实际汇总</ElButton
      >
      <ElButton
        v-if="actualAvailable && !pending"
        data-test="open-actual"
        :disabled="
          busy ||
          !!preparation ||
          actualRequestState !== 'idle' ||
          actualRefreshBusy ||
          !!proofPaymentId
        "
        @click="actualOpen = !actualOpen"
        >{{ actualOpen ? '收起实际登记' : '登记实际回款／律师开票' }}</ElButton
      >
      <ActualPanel
        v-if="actualAvailable && !pending && actualSession"
        v-show="actualOpen"
        :actor-key="actualActorKey"
        :case-id="caseId"
        :actual-registration-lawyers="actualLawyers"
        :session="actualSession"
        @registered="refreshActual"
        @cancel="actualOpen = false"
      />
    </section>
    <ElButton
      v-if="preparation?.unknown"
      :disabled="busy || preparation.busy"
      @click="submit(preparation.draft, true)"
      >重试原付款截图及结算草稿</ElButton
    >
    <ElButton
      v-if="preparation && !pending"
      :disabled="busy || preparation.busy"
      data-test="abandon-preparation"
      @click="abandonPreparation"
      >放弃旧上传准备并重新读取</ElButton
    >
    <ElButton
      v-if="pending && pending.status !== 'confirmed'"
      :disabled="pending.status === 'sending'"
      @click="send()"
      >重试原结算更新请求</ElButton
    >
    <ElButton @click="close">关闭</ElButton>
  </section>
</template>
