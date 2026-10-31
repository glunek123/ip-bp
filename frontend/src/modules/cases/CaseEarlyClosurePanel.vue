<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import CaseEarlyClosureForm, {
  type EarlyClosureDraft,
} from './CaseEarlyClosureForm.vue';
import {
  recordCaseEarlyClosure,
  type EarlyClosureResult,
  type RecordEarlyClosureInput,
} from '../../api/case-closure-commands';
import { uploadMaterialFile } from '../../api/materials';
import {
  preparePaymentProofUpload,
  finalizePaymentProofUpload,
  type PaymentProofUpload,
} from '../../api/payment-proof-upload';
import { ApiError } from '../../api/http';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
import {
  readEarlyClosureRecovery,
  retainEarlyClosureRecovery,
} from './case-early-closure-recovery';

const props = defineProps<{
  session?: ListWorkflowSession;
  actorKey: string;
  caseId: string;
  stage: RecordEarlyClosureInput['expectedStage'];
  version: number;
}>();
const emit = defineEmits<{ done: [result: EarlyClosureResult]; cancel: [] }>();
const uploading = ref(false);
const uploadRecovery = shallowRef<{
  draft: EarlyClosureDraft;
  actorKey: string;
  caseId: string;
  version: number;
  stage: RecordEarlyClosureInput['expectedStage'];
} | null>(null);
const proofUploads = new WeakMap<globalThis.File, PaymentProofUpload>();
const error = ref('');
const recovery = ref(readEarlyClosureRecovery(props.actorKey, props.caseId));
watch(
  () => [props.actorKey, props.caseId, props.session],
  () => {
    recovery.value = readEarlyClosureRecovery(props.actorKey, props.caseId);
    error.value = '';
    if (
      recovery.value &&
      !recovery.value.consumed &&
      ['ready', 'sending', 'unknown', 'confirmed'].includes(
        recovery.value.status,
      ) &&
      props.session?.isCurrent() &&
      props.session.context.actorKey === props.actorKey &&
      props.session.context.recordId === props.caseId
    )
      props.session.restoreUnknown();
  },
  { immediate: true },
);
const pending = computed(() =>
  recovery.value &&
  ['ready', 'sending', 'unknown'].includes(recovery.value.status)
    ? recovery.value
    : null,
);
const completed = computed(() => recovery.value?.status === 'confirmed');
const busy = computed(
  () => uploading.value || recovery.value?.status === 'sending',
);
const locked = computed(
  () =>
    busy.value ||
    completed.value ||
    pending.value !== null ||
    uploadRecovery.value !== null,
);
const uploads = new WeakMap<
  globalThis.File,
  { actorKey: string; caseId: string; contentVersionId: string }
>();
let active = true;
onBeforeUnmount(() => {
  active = false;
});
function sameIdentity(
  actorKey: string,
  caseId: string,
  session = props.session,
) {
  return (
    active &&
    props.actorKey === actorKey &&
    props.caseId === caseId &&
    props.session === session &&
    (!session ||
      (session.isCurrent() &&
        session.context.actorKey === actorKey &&
        session.context.recordId === caseId))
  );
}
watch(
  () => [recovery.value?.status, props.session],
  () => {
    const command = recovery.value;
    const session = props.session;
    if (
      !command ||
      !session ||
      !sameIdentity(command.actorKey, command.caseId, session)
    )
      return;
    if (command.status === 'rejected') {
      if (session.beginSubmit({ recovery: true })) session.endSubmit('failed');
      return;
    }
    if (command.status !== 'confirmed' || !command.result || command.consumed)
      return;
    // Only a restored unknown session can accept this shared confirmed receipt.
    if (!session.beginSubmit({ recovery: true })) return;
    command.consumed = true;
    if (session.endSubmit('success')) emit('done', command.result);
    else command.consumed = false;
  },
  { immediate: true },
);
async function sendPending(alreadyBegun = false, session = props.session) {
  const command = pending.value;
  if (
    !command ||
    busy.value ||
    !sameIdentity(command.actorKey, command.caseId, session)
  )
    return;
  if (!alreadyBegun && session && !session.beginSubmit({ recovery: true }))
    return;
  const hadUnknownResult = command.status === 'unknown';
  command.status = 'sending';
  error.value = '';
  try {
    const result = await recordCaseEarlyClosure(command.caseId, command.input);
    command.result = result;
    command.status = 'confirmed';
    if (sameIdentity(command.actorKey, command.caseId, session)) {
      command.consumed = true;
      if (!session || session.endSubmit('success')) emit('done', result);
      else command.consumed = false;
    }
  } catch (cause) {
    const uncertain =
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.code === 'INVALID_RESPONSE';
    command.status = uncertain || hadUnknownResult ? 'unknown' : 'rejected';
    if (!sameIdentity(command.actorKey, command.caseId, session)) return;
    session?.endSubmit(uncertain || hadUnknownResult ? 'unknown' : 'failed');
    error.value =
      uncertain || hadUnknownResult
        ? '提交结果尚未确认。可重试原请求，或关闭后重新核对；本次会话保留原内容与请求编号，刷新页面会丢失恢复信息。'
        : '提前结案未完成，请核对案件权限、阶段、版本及填写内容后重试。';
  }
}
async function submit(draft: EarlyClosureDraft, retry = false) {
  const session = props.session;
  if (
    (!retry && locked.value) ||
    busy.value ||
    !sameIdentity(props.actorKey, props.caseId, session)
  )
    return;
  error.value = '';
  if (draft.paymentRecords.some((row) => row.receiptName && !row.receiptFile)) {
    error.value = '付款截图原文件缺失，不能提交。请重新选择文件。';
    return;
  }
  const {
    actorKey,
    caseId,
    version: expectedVersion,
    stage: expectedStage,
  } = props;
  if (
    retry &&
    (!uploadRecovery.value ||
      uploadRecovery.value.actorKey !== actorKey ||
      uploadRecovery.value.caseId !== caseId ||
      uploadRecovery.value.version !== expectedVersion ||
      uploadRecovery.value.stage !== expectedStage)
  ) {
    error.value = '账号、案件或版本已变化，不能重试原上传。请核对原案件。';
    return;
  }
  if (session && !session.beginSubmit()) return;
  uploading.value = true;
  let finalizeAttempted = false;
  let finalizingFile: globalThis.File | undefined;
  const hadUnknownUpload = uploadRecovery.value !== null;
  try {
    const screenshotIds: (string | null)[] = [];
    for (const row of draft.paymentRecords) {
      if (
        !sameIdentity(actorKey, caseId, session) ||
        props.version !== expectedVersion ||
        props.stage !== expectedStage
      )
        return;
      if (!row.receiptFile) {
        screenshotIds.push(null);
        continue;
      }
      const context = { actorKey, caseId, expectedVersion };
      let handle = proofUploads.get(row.receiptFile);
      if (!handle) {
        handle = await preparePaymentProofUpload(context, row.receiptFile);
        proofUploads.set(row.receiptFile, handle);
      }
      if (
        !sameIdentity(actorKey, caseId, session) ||
        props.version !== expectedVersion ||
        props.stage !== expectedStage
      )
        return;
      finalizeAttempted = true;
      finalizingFile = row.receiptFile;
      screenshotIds.push(await finalizePaymentProofUpload(handle, context));
      finalizeAttempted = false;
    }
    const closeContentVersionIds: string[] = [];
    for (const file of draft.closeDocuments) {
      if (!sameIdentity(actorKey, caseId, session)) return;
      const cached = uploads.get(file);
      let contentVersionId =
        cached?.caseId === caseId && cached.actorKey === actorKey
          ? cached.contentVersionId
          : undefined;
      if (!contentVersionId) {
        const uploaded = await uploadMaterialFile({
          ownerType: 'CASE',
          ownerId: caseId,
          category: 'CASE_CLOSURE_DOCUMENT',
          purpose: 'CASE_CLOSURE_DOCUMENT',
          file,
        });
        if (!sameIdentity(actorKey, caseId, session)) return;
        contentVersionId = uploaded.contentVersionId;
        uploads.set(file, { actorKey, caseId, contentVersionId });
      }
      closeContentVersionIds.push(contentVersionId);
    }
    if (!sameIdentity(actorKey, caseId, session)) return;
    if (props.version !== expectedVersion || props.stage !== expectedStage) {
      session?.endSubmit('failed');
      error.value = '案件阶段或版本已变化，请重新打开并核对。';
      return;
    }
    const input: RecordEarlyClosureInput = {
      expectedVersion,
      expectedStage,
      idempotencyKey: globalThis.crypto.randomUUID(),
      closeAt: draft.closeAt,
      closeAmountState: draft.closeAmountState,
      closeAmt: draft.closeAmt,
      closeContentVersionIds,
      paymentType: draft.paymentType,
      paymentRecords: draft.paymentRecords.map((row, index) => ({
        paidOn: row.paymentDate,
        amount: row.amount,
        payer: row.payer,
        payee: row.payee,
        screenshotContentVersionId: screenshotIds[index] ?? null,
      })),
    };
    uploadRecovery.value = null;
    recovery.value = retainEarlyClosureRecovery(actorKey, caseId, input);
  } catch (cause) {
    const uncertain =
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.code === 'INVALID_RESPONSE';
    const needsRecovery = finalizeAttempted && (uncertain || hadUnknownUpload);
    if (!needsRecovery) {
      uploadRecovery.value = null;
      if (finalizeAttempted && finalizingFile)
        proofUploads.delete(finalizingFile);
    }
    if (needsRecovery)
      uploadRecovery.value = {
        draft,
        actorKey,
        caseId,
        version: expectedVersion,
        stage: expectedStage,
      };
    session?.endSubmit('failed');
    if (sameIdentity(actorKey, caseId, session))
      error.value = needsRecovery
        ? '材料上传未完成或结果尚未确认，尚未提交提前结案。只能重试原上传；原文件和恢复信息仅在当前面板保留，关闭或刷新后失效，请先核对。'
        : '材料上传未完成，尚未提交提前结案。请核对权限与文件，可修改或移除截图后重试。';
  } finally {
    if (
      sameIdentity(actorKey, caseId, session) &&
      (props.version !== expectedVersion || props.stage !== expectedStage)
    ) {
      session?.endSubmit('failed');
      error.value = '案件阶段或版本已变化，请重新打开并核对。';
    }
    uploading.value = false;
  }
  if (sameIdentity(actorKey, caseId, session) && pending.value)
    await sendPending(true, session);
}
</script>
<template>
  <section aria-label="提前结案办理">
    <CaseEarlyClosureForm
      :key="JSON.stringify([actorKey, caseId])"
      :disabled="locked"
      @submit="submit"
    />
    <p v-if="uploading" role="status">
      正在上传原文件，上传完成后才会提交提前结案。
    </p>
    <ElButton
      v-if="uploadRecovery"
      data-test="retry-upload"
      :disabled="busy"
      @click="submit(uploadRecovery.draft, true)"
      >重试原上传</ElButton
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="pending" role="status">
      原请求仍待核对。可重试相同请求，或关闭后核对；本次会话保留请求，刷新页面会丢失恢复信息。
    </p>
    <p v-if="completed" role="status">原请求已提交成功，请刷新案件查看。</p>
    <ElButton
      v-if="pending"
      data-test="retry"
      :disabled="busy"
      @click="sendPending()"
      >重试原请求</ElButton
    >
    <ElButton
      v-if="!session"
      data-test="cancel"
      :disabled="busy"
      @click="emit('cancel')"
      >{{ pending ? '关闭并保留待核对请求' : '取消' }}</ElButton
    >
  </section>
</template>
