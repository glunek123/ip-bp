<script lang="ts">
import { markRaw, reactive } from 'vue';
import type { PaymentProofUpload } from '../../api/payment-proof-upload';
import type {
  PaymentProofSupplementResult,
  SupplementCasePaymentProofInput,
} from '../../api/case-closure-commands';
type ProofRow = {
  file: globalThis.File;
  handle?: PaymentProofUpload;
  contentVersionId?: string;
  prepareUnknown?: boolean;
};
type PendingProof = {
  target: Readonly<{
    actorKey: string;
    caseId: string;
    caseVersion: number;
    stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
    expectedClosureVersionId: string;
    paymentId: string;
    expectedPaymentVersionId: string;
  }>;
  rows: ProofRow[];
  input?: Readonly<SupplementCasePaymentProofInput>;
  key: string;
  status: 'sending' | 'unknown' | 'confirmed';
  busy: boolean;
  delivered: boolean;
  result?: PaymentProofSupplementResult;
};
// A version refresh must not hide an unresolved request for this payment.
const pendingProofs = new Map<string, PendingProof>();
export function findPendingProofTarget(actorKey: string, caseId: string) {
  return [...pendingProofs.values()].find(
    (entry) =>
      entry.target.actorKey === actorKey &&
      entry.target.caseId.toLowerCase() === caseId.toLowerCase() &&
      !entry.delivered,
  )?.target;
}
</script>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import {
  preparePaymentProofUpload,
  finalizePaymentProofUpload,
} from '../../api/payment-proof-upload';
import { supplementCasePaymentProof } from '../../api/case-closure-commands';
import { ApiError } from '../../api/http';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
const props = withDefaults(
  defineProps<{
    actorKey: string;
    caseId: string;
    caseVersion: number;
    stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
    expectedClosureVersionId: string;
    paymentId: string;
    expectedPaymentVersionId: string;
    session?: ListWorkflowSession;
    allowNew?: boolean;
  }>(),
  { allowNew: true },
);
const emit = defineEmits<{
  supplemented: [result: PaymentProofSupplementResult];
  cancel: [];
}>();
const pending = ref<PendingProof | null>(null);
const files = ref<globalThis.File[]>([]);
const error = ref('');
const preparationAbandoned = ref(false);
let generation = 0;
onBeforeUnmount(() => generation++);
const identity = () =>
  JSON.stringify([
    props.actorKey,
    props.caseId.toLowerCase(),
    props.paymentId.toLowerCase(),
  ]);
const target = () => ({
  actorKey: props.actorKey,
  caseId: props.caseId,
  caseVersion: props.caseVersion,
  stage: props.stage,
  expectedClosureVersionId: props.expectedClosureVersionId,
  paymentId: props.paymentId,
  expectedPaymentVersionId: props.expectedPaymentVersionId,
});
const normalizeTarget = (value: PendingProof['target']) => ({
  ...value,
  caseId: value.caseId.toLowerCase(),
  paymentId: value.paymentId.toLowerCase(),
  expectedClosureVersionId: value.expectedClosureVersionId.toLowerCase(),
  expectedPaymentVersionId: value.expectedPaymentVersionId.toLowerCase(),
});
const sameTarget = (command: PendingProof) =>
  JSON.stringify(normalizeTarget(command.target)) ===
  JSON.stringify(normalizeTarget(target()));
const current = (token: number) =>
  token === generation &&
  (!props.session ||
    (props.session.isCurrent() &&
      props.session.context.actorKey === props.actorKey &&
      props.session.context.recordId.toLowerCase() ===
        props.caseId.toLowerCase()));
const uncertain = (cause: unknown) =>
  !(cause instanceof ApiError) ||
  cause.status === 0 ||
  cause.status >= 500 ||
  cause.code === 'INVALID_RESPONSE' ||
  cause.code === 'UPLOAD_RESULT_UNKNOWN';
function deliver(command: PendingProof, token: number) {
  if (!current(token) || command.delivered || !command.result) return;
  command.delivered = true;
  if (
    (props.session && !props.session.endSubmit('completed')) ||
    !current(token)
  ) {
    command.delivered = false;
    return;
  }
  pendingProofs.delete(identity());
  pending.value = null;
  files.value = [];
  error.value = '';
  emit('supplemented', command.result);
}
watch(
  () => [
    props.actorKey,
    props.caseId,
    props.caseVersion,
    props.stage,
    props.expectedClosureVersionId,
    props.paymentId,
    props.expectedPaymentVersionId,
    props.session,
  ],
  () => {
    ++generation;
    preparationAbandoned.value = false;
    files.value = [];
    error.value = '';
    pending.value = pendingProofs.get(identity()) ?? null;
    if (pending.value && current(generation)) {
      props.session?.endSubmit('unknown');
      props.session?.restoreUnknown();
      if (!pending.value.busy)
        pending.value.status = pending.value.result ? 'confirmed' : 'unknown';
      if (
        pending.value.result &&
        (!props.session || props.session.beginSubmit({ recovery: true }))
      )
        deliver(pending.value, generation);
    }
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => pending.value?.status,
  (status) => {
    if (
      status === 'confirmed' &&
      pending.value &&
      current(generation) &&
      (!props.session || props.session.beginSubmit({ recovery: true }))
    )
      deliver(pending.value, generation);
  },
);
function select(event: globalThis.Event) {
  if (pending.value || !current(generation)) return;
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  files.value = Array.from(target.files ?? []);
  error.value = '';
}
async function send(command: PendingProof, recovery: boolean) {
  const token = generation;
  if (
    command.busy ||
    pendingProofs.get(identity()) !== command ||
    !current(token) ||
    command.rows.some((row) => row.prepareUnknown) ||
    (!command.input && !command.result && !sameTarget(command))
  )
    return;
  if (props.session && !props.session.beginSubmit({ recovery })) {
    if (!recovery) {
      pendingProofs.delete(identity());
      pending.value = null;
    }
    return;
  }
  if (command.result) {
    deliver(command, token);
    return;
  }
  command.busy = true;
  command.status = 'sending';
  const key = identity();
  const context = {
    actorKey: command.target.actorKey,
    caseId: command.target.caseId,
    expectedVersion: command.target.caseVersion,
  };
  let preparing: ProofRow | undefined;
  try {
    for (const row of command.input ? [] : command.rows) {
      if (!current(token)) break;
      if (!row.handle) {
        preparing = row;
        row.handle = markRaw(
          await preparePaymentProofUpload(context, row.file),
        );
        preparing = undefined;
      }
      if (!current(token)) break;
      if (!row.contentVersionId)
        row.contentVersionId = await finalizePaymentProofUpload(
          row.handle,
          context,
        );
    }
    if (!current(token)) {
      command.status = 'unknown';
      return;
    }
    if (!command.input) {
      const ids = command.rows.map((row) => row.contentVersionId);
      if (ids.some((id) => !id)) throw new Error('截图上传尚未完成');
      command.input = Object.freeze({
        idempotencyKey: command.key,
        expectedClosureVersionId: command.target.expectedClosureVersionId,
        paymentId: command.target.paymentId,
        expectedPaymentVersionId: command.target.expectedPaymentVersionId,
        contentVersionIds: ids.filter(
          (id): id is string => typeof id === 'string',
        ),
      });
      Object.freeze(command.input.contentVersionIds);
    }
    command.result = await supplementCasePaymentProof(
      context.caseId,
      command.input,
      { retryOnCsrfInvalid: false },
    );
    command.status = 'confirmed';
    deliver(command, token);
  } catch (cause) {
    const unknown = uncertain(cause) || (recovery && !!command.input);
    if (preparing && unknown) preparing.prepareUnknown = true;
    if (unknown || !current(token)) {
      command.status = 'unknown';
      if (current(token)) {
        props.session?.endSubmit('unknown');
        error.value = command.rows.some((row) => row.prepareUnknown)
          ? '上传草稿创建结果未确认，不能再次创建。请重新查询材料并核对后补记录；本面板不能恢复该草稿。'
          : '结果未确认，只能重试原上传或原后补请求。';
      }
    } else {
      pendingProofs.delete(key);
      pending.value = null;
      props.session?.endSubmit('failed');
      error.value = '后补未完成，请核对图片、权限和案件版本后重新选择。';
    }
  } finally {
    command.busy = false;
  }
}
function submit() {
  if (
    props.allowNew === false ||
    preparationAbandoned.value ||
    pending.value ||
    !current(generation)
  )
    return;
  const existing = pendingProofs.get(identity());
  if (existing) {
    pending.value = existing;
    props.session?.restoreUnknown();
    return;
  }
  if (
    !files.value.length ||
    files.value.length > 10 ||
    files.value.some(
      (file) =>
        !file.size ||
        file.size > 20 * 1024 * 1024 ||
        !(
          (file.type === 'image/png' && /\.png$/iu.test(file.name)) ||
          (file.type === 'image/jpeg' && /\.(jpg|jpeg)$/iu.test(file.name))
        ),
    )
  ) {
    error.value = '请明确选择 1–10 张 PNG/JPEG 图片，每张不超过 20MiB。';
    return;
  }
  const command = reactive<PendingProof>({
    target: Object.freeze(target()),
    rows: files.value.map((file) => ({ file: markRaw(file) })),
    key: globalThis.crypto.randomUUID(),
    status: 'unknown',
    busy: false,
    delivered: false,
  });
  pending.value = command;
  pendingProofs.set(identity(), command);
  void send(command, false);
}
function cancel() {
  if (!pending.value && current(generation)) emit('cancel');
}
function abandonPreparation() {
  const token = generation;
  const key = identity();
  const session = props.session;
  const command = pending.value;
  if (
    !command ||
    pendingProofs.get(identity()) !== command ||
    command.input ||
    command.result ||
    command.busy ||
    !current(token)
  )
    return;
  // No business command was sent. Release only this local preparation; uploaded
  // server materials and all business history remain untouched.
  const stillOwned = () =>
    current(token) &&
    identity() === key &&
    props.session === session &&
    pending.value === command &&
    pendingProofs.get(key) === command;
  if (session) {
    if (!session.beginSubmit({ recovery: true }) || !stillOwned()) return;
    if (!session.endSubmit('failed') || !stillOwned()) return;
  }
  if (!stillOwned()) return;
  pendingProofs.delete(key);
  pending.value = null;
  preparationAbandoned.value = true;
  files.value = [];
  error.value =
    '已放弃本地上传准备，未删除服务端文件或历史记录。请先重新读取案件并核对材料，再准备新的后补。';
}
</script>
<template>
  <section>
    <p>
      独立后补已有付款的截图，不修改付款金额、付款记录或结算信息。此操作不与外层结算表单一起提交。
    </p>
    <p>
      恢复信息只保存在本次页面内存中。刷新、关闭页面或重启会丢失恢复信息；结果未确认时请保留页面并核对记录。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form
      v-if="!pending && allowNew !== false && !preparationAbandoned"
      @submit.prevent="submit"
    >
      <label
        >付款截图<input
          data-test="files"
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          multiple
          @change="select"
      /></label>
      <button type="submit">独立后补截图</button>
      <button type="button" @click="cancel">取消</button>
    </form>
    <template v-else-if="pending">
      <p
        v-if="!pending.input && !pending.result && !sameTarget(pending)"
        role="alert"
      >
        案件、结案或付款版本已变化。原上传仍待核对，不能继续旧目标上传或创建新后补；请先核对材料与后补记录。
      </p>
      <p v-if="pending.rows.some((row) => row.prepareUnknown)" role="alert">
        上传草稿创建结果未确认，不能再次创建。请重新查询材料并核对后补记录；本面板不能恢复该草稿。
      </p>
      <p role="status">
        {{
          pending.busy
            ? '正在确认截图后补结果…'
            : '原后补尚待确认，请勿关闭页面。'
        }}
      </p>
      <button
        v-if="
          !pending.busy &&
          !pending.rows.some((row) => row.prepareUnknown) &&
          (pending.input || pending.result || sameTarget(pending))
        "
        data-test="retry"
        @click="send(pending, true)"
      >
        重试原上传及后补请求
      </button>
      <template v-if="!pending.input && !pending.result && !pending.busy">
        <p>
          尚未发送业务后补命令。可以放弃本地上传准备；服务端文件和历史记录保留。放弃后请先重新读取案件。
        </p>
        <button data-test="abandon-preparation" @click="abandonPreparation">
          放弃旧上传准备
        </button>
      </template>
    </template>
    <template v-else>
      <p>当前入口不能创建新的后补请求，请返回工作区并重新读取。</p>
      <button data-test="close-recovery" @click="cancel">返回工作区</button>
    </template>
  </section>
</template>
