<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  correctCaseJudgment,
  registerCaseJudgment,
  todayShanghai,
  type CaseDetail,
  type CaseFile,
  type CaseJudgmentFact,
  type CorrectCaseJudgmentInput,
  type LawyerCaseDetail,
  type RegisterCaseJudgmentInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type PanelItem = Pick<
  CaseDetail | LawyerCaseDetail,
  | 'id'
  | 'stage'
  | 'version'
  | 'acceptance'
  | 'canRegisterJudgment'
  | 'canCorrectJudgment'
  | 'judgment'
>;
type AmountState = 'KNOWN' | 'PENDING' | '';
type Command =
  | { kind: 'register'; input: RegisterCaseJudgmentInput }
  | { kind: 'correct'; input: CorrectCaseJudgmentInput };
const props = defineProps<{
  item: PanelItem;
  contextKey: string;
  lawyer?: boolean;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();

const judgmentReceivedAt = ref('');
const judgmentAmountState = ref<AmountState>('');
const judgmentAmount = ref('');
const paidLitigationFeeState = ref<AmountState>('');
const paidLitigationFee = ref('');
const correctionReason = ref('');
const selectedFiles = ref(new Set<string>());
const uploadedFiles = ref<CaseFile[]>([]);
const uploadError = ref('');
const uploading = ref(false);
const submitting = ref(false);
const error = ref('');
const success = ref('');
const unknownRequest = ref<Command | null>(null);
let revision = 0;
let active = true;
const downloads = new Set<AbortController>();

type OperationContext = { id: string; contextKey: string; revision: number };
function captureContext(): OperationContext {
  return { id: props.item.id, contextKey: props.contextKey, revision };
}
function isCurrent(context: OperationContext): boolean {
  return (
    active &&
    context.revision === revision &&
    context.id === props.item.id &&
    context.contextKey === props.contextKey
  );
}
function abortDownloads(): void {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}
function allAvailableFiles(): CaseFile[] {
  const unique = new Map<string, CaseFile>();
  for (const file of [
    ...props.item.judgment.availableFiles,
    ...uploadedFiles.value,
  ]) {
    if (supportedMaterial(file)) unique.set(file.contentVersionId, file);
  }
  return [...unique.values()];
}
function resetContext(): void {
  const current = props.item.judgment.current;
  judgmentReceivedAt.value = current?.judgmentReceivedAt ?? '';
  judgmentAmountState.value = current?.judgmentAmountState ?? '';
  judgmentAmount.value = current?.judgmentAmount ?? '';
  paidLitigationFeeState.value = current?.paidLitigationFeeState ?? '';
  paidLitigationFee.value = current?.paidLitigationFee ?? '';
  correctionReason.value = '';
  uploadedFiles.value = [];
  uploadError.value = '';
  uploading.value = false;
  submitting.value = false;
  error.value = '';
  success.value = '';
  unknownRequest.value = null;
  selectedFiles.value = new Set();
  const available = allAvailableFiles();
  if (available.length === 1)
    selectedFiles.value = new Set([available[0]!.contentVersionId]);
}
watch(
  [() => props.item.id, () => props.contextKey],
  () => {
    revision += 1;
    abortDownloads();
    resetContext();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  abortDownloads();
});

const canRegister = computed(
  () =>
    props.item.stage === 'WAITING_JUDGMENT' &&
    props.item.canRegisterJudgment &&
    props.item.judgment.current === null,
);
const canCorrect = computed(
  () =>
    !props.lawyer &&
    props.item.stage === 'WAITING_JUDGMENT' &&
    props.item.canCorrectJudgment &&
    props.item.judgment.current !== null,
);
const canEdit = computed(() => canRegister.value || canCorrect.value);
const availableFiles = computed(allAvailableFiles);
const acceptanceDate = computed(() => props.item.acceptance?.acceptedAt ?? '');
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <= todayShanghai() &&
    value >= acceptanceDate.value
  );
}
function validAmount(state: AmountState, amount: string): boolean {
  if (state === 'PENDING') return true;
  return (
    state === 'KNOWN' && /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(amount.trim())
  );
}
const validReason = computed(() => {
  const reason = correctionReason.value.trim();
  return reason.length >= 1 && reason.length <= 500;
});
const selectedIds = computed(() =>
  availableFiles.value
    .filter((file) => selectedFiles.value.has(file.contentVersionId))
    .map((file) => file.contentVersionId),
);
const ready = computed(
  () =>
    canEdit.value &&
    validDate(judgmentReceivedAt.value) &&
    validAmount(judgmentAmountState.value, judgmentAmount.value) &&
    validAmount(paidLitigationFeeState.value, paidLitigationFee.value) &&
    selectedIds.value.length >= 1 &&
    selectedIds.value.length <= 10 &&
    (!canCorrect.value || validReason.value) &&
    !uploading.value &&
    !submitting.value &&
    unknownRequest.value === null,
);
function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function makeInput(): RegisterCaseJudgmentInput {
  return {
    expectedVersion: props.item.version,
    idempotencyKey: makeKey(),
    judgmentReceivedAt: judgmentReceivedAt.value,
    judgmentAmountState: judgmentAmountState.value as 'KNOWN' | 'PENDING',
    judgmentAmount:
      judgmentAmountState.value === 'KNOWN'
        ? judgmentAmount.value.trim()
        : null,
    paidLitigationFeeState: paidLitigationFeeState.value as 'KNOWN' | 'PENDING',
    paidLitigationFee:
      paidLitigationFeeState.value === 'KNOWN'
        ? paidLitigationFee.value.trim()
        : null,
    judgmentContentVersionIds: selectedIds.value,
  };
}
function isUnknownOutcome(reason: unknown): boolean {
  return (
    reason instanceof ApiError &&
    (reason.status >= 500 ||
      [
        'NETWORK_ERROR',
        'TIMEOUT',
        'INTERNAL_ERROR',
        'INVALID_RESPONSE',
      ].includes(reason.code))
  );
}
function failureMessage(reason: unknown): string {
  if (isUnknownOutcome(reason))
    return '判决命令结果暂时未知。请保留本次请求，并使用相同请求安全重试；刷新详情不能证明本次请求是否成功。';
  if (reason instanceof ApiError && reason.status === 403)
    return '当前账号无权办理此案件。';
  if (
    reason instanceof ApiError &&
    (reason.status === 409 ||
      ['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
        reason.code,
      ))
  )
    return '案件版本或当前状态已变化，请刷新案件后核对。';
  if (reason instanceof ApiError && reason.code === 'VALIDATION_ERROR')
    return '判决信息未通过校验，请核对日期、金额、文件和原因。';
  return '判决操作没有完成，请稍后重试或刷新案件核对。';
}
async function send(command: Command): Promise<void> {
  const context = captureContext();
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    if (command.kind === 'register')
      await registerCaseJudgment(
        context.id,
        command.input,
        props.lawyer ? 'lawyer' : 'internal',
      );
    else await correctCaseJudgment(context.id, command.input);
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value = '判决命令已受理，正在读取案件当前状态。';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent(context)) return;
    error.value = failureMessage(reason);
    if (isUnknownOutcome(reason)) unknownRequest.value = command;
    else if (
      reason instanceof ApiError &&
      (reason.status === 409 ||
        ['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
          reason.code,
        ))
    ) {
      unknownRequest.value = null;
      emit('refresh');
    }
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
async function submit(): Promise<void> {
  if (!ready.value) return;
  const input = makeInput();
  if (canCorrect.value)
    await send({
      kind: 'correct',
      input: { ...input, reason: correctionReason.value.trim() },
    });
  else await send({ kind: 'register', input });
}
async function retry(): Promise<void> {
  if (!unknownRequest.value || submitting.value) return;
  await send(unknownRequest.value);
}
function supportedMaterial(file: CaseFile): boolean {
  const extension = file.originalFilename.toLowerCase().match(/\.[^.]+$/u)?.[0];
  const types = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  return extension !== undefined && types.get(extension) === file.mimeType;
}
function toggleFile(contentVersionId: string): void {
  const next = new Set(selectedFiles.value);
  if (next.has(contentVersionId)) next.delete(contentVersionId);
  else if (next.size < 10) next.add(contentVersionId);
  selectedFiles.value = next;
  error.value = '';
}
async function uploadFiles(event: globalThis.Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  uploadError.value = '';
  if (!files.length || !canEdit.value || unknownRequest.value) return;
  if (availableFiles.value.length + files.length > 10) {
    uploadError.value = '本案最多选择10份判决书版本。';
    return;
  }
  if (
    files.some(
      (file) =>
        file.size > 50 * 1024 * 1024 ||
        !supportedMaterial({
          materialId: 'pending',
          contentVersionId: 'pending',
          originalFilename: file.name,
          mimeType: file.type,
        }),
    )
  ) {
    uploadError.value = '仅支持单份不超过50MiB的PDF、JPEG或PNG判决书。';
    return;
  }
  const context = captureContext();
  uploading.value = true;
  try {
    for (const file of files) {
      if (!isCurrent(context)) return;
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.id,
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        file,
      });
      if (!isCurrent(context)) return;
      const added = {
        materialId: result.materialId,
        contentVersionId: result.contentVersionId,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
      };
      uploadedFiles.value = [...uploadedFiles.value, added];
    }
    const allFiles = allAvailableFiles();
    if (allFiles.length === 1)
      selectedFiles.value = new Set([allFiles[0]!.contentVersionId]);
    else selectedFiles.value = new Set();
    emit('refresh');
  } catch (reason) {
    if (isCurrent(context))
      uploadError.value =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? '该文件不符合判决书格式或大小要求。'
          : '判决书上传失败，请检查连接后重试。';
  } finally {
    if (isCurrent(context)) uploading.value = false;
  }
}
async function download(file: CaseFile): Promise<void> {
  const context = captureContext();
  const controller = new AbortController();
  downloads.add(controller);
  error.value = '';
  try {
    await downloadMaterialVersion(
      file.materialId,
      file.contentVersionId,
      controller.signal,
    );
  } catch {
    if (isCurrent(context) && !controller.signal.aborted)
      error.value = '判决书下载失败，请稍后重试。';
  } finally {
    downloads.delete(controller);
  }
}
function displayAmount(
  state: 'KNOWN' | 'PENDING',
  amount: string | null,
): string {
  return state === 'KNOWN' ? `已知 ${amount}` : '待定';
}
function historyLabel(fact: CaseJudgmentFact): string {
  return fact.kind === 'REGISTER' ? '首次登记' : '受控更正';
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="case-judgment-panel">
    <h2 class="form-section-title">一审判决</h2>
    <p>
      登记后案件仍为待判决；更正不改变阶段。本页只记录事实，不会发起支付。登记不代表判决生效、结算完成或已执行。
    </p>
    <form v-if="canEdit" class="form-stack" @submit.prevent="submit">
      <label>
        <span>收到判决日期 <span class="required-mark">*</span></span>
        <input
          v-model="judgmentReceivedAt"
          data-test="judgment-date"
          type="date"
          required
          :min="acceptanceDate"
          :max="todayShanghai()"
          :disabled="unknownRequest !== null || submitting"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <label>
        <span>判决金额状态 <span class="required-mark">*</span></span>
        <select
          v-model="judgmentAmountState"
          data-test="judgment-amount-state"
          required
          :disabled="unknownRequest !== null || submitting"
        >
          <option disabled value="">请选择</option>
          <option value="KNOWN">已知金额</option>
          <option value="PENDING">待定</option>
        </select>
      </label>
      <label v-if="judgmentAmountState === 'KNOWN'">
        <span>判决金额（元） <span class="required-mark">*</span></span>
        <input
          v-model="judgmentAmount"
          data-test="judgment-amount"
          type="text"
          inputmode="decimal"
          maxlength="17"
          required
          :disabled="unknownRequest !== null || submitting"
        />
      </label>
      <p v-else-if="judgmentAmountState === 'PENDING'" class="field-help">
        判决金额待定；系统会保存空值，不会按0元登记。
      </p>
      <label>
        <span>实缴诉讼费状态 <span class="required-mark">*</span></span>
        <select
          v-model="paidLitigationFeeState"
          data-test="paid-fee-state"
          required
          :disabled="unknownRequest !== null || submitting"
        >
          <option disabled value="">请选择</option>
          <option value="KNOWN">已知金额</option>
          <option value="PENDING">待定</option>
        </select>
      </label>
      <label v-if="paidLitigationFeeState === 'KNOWN'">
        <span>实缴诉讼费（元） <span class="required-mark">*</span></span>
        <input
          v-model="paidLitigationFee"
          data-test="paid-fee-amount"
          type="text"
          inputmode="decimal"
          maxlength="17"
          required
          :disabled="unknownRequest !== null || submitting"
        />
      </label>
      <p v-else-if="paidLitigationFeeState === 'PENDING'" class="field-help">
        实缴诉讼费待定；系统会保存空值，不会按0元登记。
      </p>

      <fieldset class="form-stack">
        <legend>判决书 <span class="required-mark">*</span></legend>
        <p class="field-help">
          至少选择1份本案有效判决书，最多10份；仅支持单份不超过50MiB的PDF、JPEG或PNG。
        </p>
        <ul v-if="availableFiles.length" class="notary-offices-list">
          <li v-for="file in availableFiles" :key="file.contentVersionId">
            <label class="checkbox-row">
              <input
                :data-test="`judgment-file-${file.contentVersionId}`"
                type="checkbox"
                :checked="selectedFiles.has(file.contentVersionId)"
                :disabled="
                  unknownRequest !== null ||
                  submitting ||
                  (!selectedFiles.has(file.contentVersionId) &&
                    selectedFiles.size >= 10)
                "
                @change="toggleFile(file.contentVersionId)"
              />
              {{ file.originalFilename }}
            </label>
            <ElButton text @click="download(file)">下载</ElButton>
          </li>
        </ul>
        <p v-else class="field-help">尚无可选判决书，请先上传。</p>
        <label class="upload-field">
          <span>上传判决书（可多选）</span>
          <input
            data-test="judgment-file-input"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            :disabled="
              !canEdit ||
              uploading ||
              unknownRequest !== null ||
              availableFiles.length >= 10
            "
            @change="uploadFiles"
          />
        </label>
        <p v-if="uploadError" class="submit-error" role="alert">
          {{ uploadError }}
        </p>
      </fieldset>

      <section
        v-if="canCorrect"
        class="form-stack"
        data-test="judgment-correction-form"
      >
        <h3>受控更正</h3>
        <label>
          <span>更正原因 <span class="required-mark">*</span></span>
          <textarea
            v-model="correctionReason"
            data-test="judgment-correction-reason"
            maxlength="500"
            rows="3"
            required
            :disabled="unknownRequest !== null || submitting"
          />
          <span class="field-help">必填，去除首尾空格后1～500个字符。</span>
        </label>
      </section>
      <section
        v-if="ready"
        class="field-help"
        data-test="judgment-review-summary"
      >
        <h3>提交前核对</h3>
        <p>收到判决日期：{{ judgmentReceivedAt }}</p>
        <p>
          判决金额：{{
            displayAmount(
              judgmentAmountState as 'KNOWN' | 'PENDING',
              judgmentAmountState === 'KNOWN' ? judgmentAmount.trim() : null,
            )
          }}
          元
        </p>
        <p>
          实缴诉讼费：{{
            displayAmount(
              paidLitigationFeeState as 'KNOWN' | 'PENDING',
              paidLitigationFeeState === 'KNOWN'
                ? paidLitigationFee.trim()
                : null,
            )
          }}
          元
        </p>
        <p>
          判决书：{{
            availableFiles
              .filter((file) => selectedFiles.has(file.contentVersionId))
              .map((file) => file.originalFilename)
              .join('、')
          }}
        </p>
        <p>
          {{ canCorrect ? '更正后案件仍为待判决。' : '登记后案件仍为待判决。' }}
          本次只记录事实，不会发起支付。
        </p>
      </section>
      <ElButton
        v-if="canCorrect"
        type="primary"
        data-test="judgment-correct"
        :disabled="!ready"
        :loading="submitting"
        @click="submit"
        >提交更正</ElButton
      >
      <ElButton
        v-else
        type="primary"
        native-type="submit"
        data-test="judgment-submit"
        :disabled="!ready"
        :loading="submitting"
        @click="submit"
        >登记一审判决</ElButton
      >
    </form>
    <p v-else-if="item.judgment.current" class="field-help">
      当前账号仅可查看本案判决事实和获准材料。
    </p>

    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <ElButton
      v-if="unknownRequest"
      type="primary"
      data-test="judgment-retry"
      :loading="submitting"
      :disabled="submitting"
      @click="retry"
      >使用相同请求安全重试</ElButton
    >

    <section v-if="item.judgment.current" data-test="judgment-current">
      <h3>当前判决事实</h3>
      <p>收到判决日期：{{ item.judgment.current.judgmentReceivedAt }}</p>
      <p>
        判决金额：{{
          displayAmount(
            item.judgment.current.judgmentAmountState,
            item.judgment.current.judgmentAmount,
          )
        }}
      </p>
      <p>
        实缴诉讼费：{{
          displayAmount(
            item.judgment.current.paidLitigationFeeState,
            item.judgment.current.paidLitigationFee,
          )
        }}
      </p>
      <ul class="notary-offices-list">
        <li
          v-for="file in item.judgment.current.files"
          :key="file.contentVersionId"
        >
          {{ file.originalFilename }}
          <ElButton text @click="download(file)">下载判决书</ElButton>
        </li>
      </ul>
    </section>

    <details v-if="item.judgment.history.length" data-test="judgment-history">
      <summary>
        判决登记与更正历史（{{ item.judgment.history.length }}）
      </summary>
      <ol>
        <li v-for="fact in item.judgment.history" :key="fact.id">
          <strong>{{ historyLabel(fact) }}</strong>
          <p>收到判决日期：{{ fact.judgmentReceivedAt }}</p>
          <p>
            判决金额：{{
              displayAmount(fact.judgmentAmountState, fact.judgmentAmount)
            }}
          </p>
          <p>
            实缴诉讼费：{{
              displayAmount(fact.paidLitigationFeeState, fact.paidLitigationFee)
            }}
          </p>
          <p>记录时间：{{ fact.recordedAt }}</p>
          <p v-if="!lawyer && 'reason' in fact && fact.reason">
            更正原因：{{ fact.reason }}
          </p>
          <ul class="notary-offices-list">
            <li v-for="file in fact.files" :key="file.contentVersionId">
              {{ file.originalFilename }}
              <ElButton text @click="download(file)">下载判决书</ElButton>
            </li>
          </ul>
        </li>
      </ol>
    </details>
  </section>
</template>
