<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  getNotaryMatter,
  type NotaryReturnAmountInput,
  type NotaryReturnChoice,
  type NotaryReturnPartyKind,
  type NotaryArchiveType,
} from '../../api/notary';
import {
  archiveNotaryReturnBatch,
  type ArchiveNotaryReturnBatchInput,
} from '../../api/notary-return-archive-batch';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type AmountDraft = {
  state: '' | 'KNOWN';
  amount: string;
  partyKind: '' | NotaryReturnPartyKind;
  partyName: string;
};
type MatterDraft = {
  id: string;
  businessNo: string;
  stage: string;
  version: number;
  sampleFeeState: 'KNOWN' | 'PENDING';
  sampleFeeAmount: string | null;
  archiveType: '' | NotaryArchiveType;
  archiveDate: string;
  notaryFeeAmount: string;
  sampleFeeAmountDraft: string;
  reason: string;
  refund: AmountDraft;
  freight: AmountDraft;
};
type FrozenBatch = {
  items: ArchiveNotaryReturnBatchInput[];
  key: string;
  scopeKey: string;
};

const props = defineProps<{
  matterIds: string[];
  scopeKey: string;
  pendingRequest?: FrozenBatch | null;
}>();
const emit = defineEmits<{
  close: [];
  completed: [];
  frozen: [request: FrozenBatch];
  resolved: [request: FrozenBatch];
}>();

const state = ref<'loading' | 'ready' | 'failed'>(
  props.pendingRequest ? 'failed' : 'loading',
);
const drafts = ref<MatterDraft[]>([]);
const message = ref(
  props.pendingRequest
    ? '原提交结果尚未确认。请在原账号、部门和阶段下显式重试原请求。离开本列表页或刷新会丢失此内存中的请求。'
    : '正在读取已选择事项及当前归档能力。',
);
const readBusy = ref(false);
const submitBusy = ref(false);
const sharedReason = ref('');
const filledReasonCount = ref<number | null>(null);
const loadedScopeKey = ref('');
const frozenItems = ref<ArchiveNotaryReturnBatchInput[] | null>(
  props.pendingRequest?.items ?? null,
);
const frozenKey = ref(props.pendingRequest?.key ?? '');
const frozenScope = ref(props.pendingRequest?.scopeKey ?? '');
let readController: AbortController | undefined;
let readGeneration = 0;
let disposed = false;

const locked = computed(() => frozenItems.value !== null);
const retryAllowed = computed(
  () => locked.value && frozenScope.value === props.scopeKey,
);
const sharedReasonError = computed(() => {
  if (!sharedReason.value) return '';
  const normalized = sharedReason.value.trim();
  if (!normalized) return '请填写非空白的共用归档原因。';
  if ([...normalized].length > 5000)
    return '共用归档原因不能超过 5000 个 Unicode 码点。';
  return '';
});
const canFillSharedReason = computed(
  () =>
    state.value === 'ready' &&
    !readBusy.value &&
    !submitBusy.value &&
    !locked.value &&
    loadedScopeKey.value === props.scopeKey &&
    Boolean(sharedReason.value.trim()) &&
    !sharedReasonError.value,
);
const rowErrors = computed(() => drafts.value.map(validateDraft));
const canSubmit = computed(
  () =>
    state.value === 'ready' &&
    !readBusy.value &&
    !submitBusy.value &&
    !locked.value &&
    drafts.value.length >= 1 &&
    drafts.value.length <= 50 &&
    rowErrors.value.every((errors) => errors.length === 0),
);

function emptyAmount(): AmountDraft {
  return { state: 'KNOWN', amount: '', partyKind: '', partyName: '' };
}

function validateAmount(amount: AmountDraft, label: string): string[] {
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(amount.amount))
    return [`${label}请输入非负金额，最多保留两位小数`];
  if (Number(amount.amount) === 0)
    return amount.partyKind || amount.partyName.trim()
      ? [`${label}为零时不需要填写收付方`]
      : [];
  if (!amount.partyKind) return [`请选择${label}收付方`];
  if (amount.partyKind === 'OTHER' && !amount.partyName.trim())
    return [`请填写${label}收付方名称`];
  if (amount.partyKind !== 'OTHER' && amount.partyName.trim())
    return [`${label}收付方名称仅在选择其他时填写`];
  return [];
}

function normalizedAmount(value: string): string {
  return Number(value).toFixed(2);
}

function validateDraft(draft: MatterDraft): string[] {
  const errors: string[] = [];
  if (!draft.archiveType) errors.push('请选择归档类型');
  if (
    draft.stage !== 'WAITING_RETURN' &&
    [
      'NOT_SHIPPED_REFUND_ONLY',
      'RECEIVED_KEEP',
      'RECEIVED_RETURN_REFUND',
    ].includes(draft.archiveType)
  )
    errors.push('当前阶段不能选择退货处理类型');
  if (!draft.archiveDate) errors.push('请填写归档日期');
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(draft.notaryFeeAmount))
    errors.push('请输入有效公证费');
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(draft.sampleFeeAmountDraft))
    errors.push('请输入有效样品费');
  if (!draft.reason.trim()) errors.push('请填写归档原因');
  if ([...draft.reason.trim()].length > 5000)
    errors.push('归档原因不能超过5000字');
  if (draft.archiveType === 'RECEIVED_RETURN_REFUND') {
    errors.push(...validateAmount(draft.refund, '退款金额'));
    errors.push(...validateAmount(draft.freight, '运费'));
  } else if (draft.archiveType === 'NOT_SHIPPED_REFUND_ONLY') {
    errors.push(...validateAmount(draft.refund, '退款金额'));
  }
  return errors;
}

function amountInput(draft: AmountDraft): NotaryReturnAmountInput {
  const amount = normalizedAmount(draft.amount.trim());
  if (Number(amount) === 0) return { state: 'KNOWN', amount };
  const partyKind = draft.partyKind as NotaryReturnPartyKind;
  return {
    state: 'KNOWN',
    amount,
    partyKind,
    ...(partyKind === 'OTHER' ? { partyName: draft.partyName.trim() } : {}),
  };
}

function buildItem(draft: MatterDraft): ArchiveNotaryReturnBatchInput {
  const type = draft.archiveType as NotaryArchiveType;
  const choice: NotaryReturnChoice | undefined =
    draft.stage !== 'WAITING_RETURN'
      ? undefined
      : type === 'RECEIVED_RETURN_REFUND'
        ? 'RETURN'
        : type === 'NOT_SHIPPED_REFUND_ONLY'
          ? 'REFUND_ONLY'
          : type === 'RECEIVED_KEEP' ||
              type === 'LINK_REMOVED' ||
              type === 'NO_INFRINGEMENT_INFORMATION' ||
              type === 'NO_EVIDENCE'
            ? 'KEEP'
            : undefined;
  return {
    matterId: draft.id,
    ...(choice ? { returnChoice: choice } : {}),
    ...(type === 'RECEIVED_RETURN_REFUND' || type === 'NOT_SHIPPED_REFUND_ONLY'
      ? { refund: amountInput(draft.refund) }
      : {}),
    ...(type === 'RECEIVED_RETURN_REFUND'
      ? { freight: amountInput(draft.freight) }
      : {}),
    archiveType: type,
    archiveDate: draft.archiveDate,
    notaryFeeAmount: normalizedAmount(draft.notaryFeeAmount),
    sampleFeeAmount: normalizedAmount(draft.sampleFeeAmountDraft),
    archiveReason: draft.reason.trim(),
    expectedVersion: draft.version,
  };
}

function fillBlankReasons(): void {
  if (!canFillSharedReason.value) return;
  const reason = sharedReason.value.trim();
  let filled = 0;
  drafts.value = drafts.value.map((draft) => {
    if (draft.reason.trim()) return draft;
    filled += 1;
    return { ...draft, reason };
  });
  filledReasonCount.value = filled;
}

async function loadDetails(): Promise<void> {
  if (locked.value) return;
  readController?.abort();
  const controller = new AbortController();
  readController = controller;
  const generation = ++readGeneration;
  const matterIds = [...props.matterIds];
  if (matterIds.length < 1 || matterIds.length > 50) {
    state.value = 'failed';
    drafts.value = [];
    message.value = '批量归档需要选择1至50项，请返回列表调整选择。';
    return;
  }
  readBusy.value = true;
  loadedScopeKey.value = '';
  state.value = 'loading';
  message.value = '正在读取已选择事项及当前归档能力。';
  drafts.value = [];
  try {
    const details = await Promise.all(
      matterIds.map((id) => getNotaryMatter(id, { signal: controller.signal })),
    );
    if (
      controller.signal.aborted ||
      generation !== readGeneration ||
      (props.scopeKey !== frozenScope.value && locked.value)
    )
      return;
    const invalid = details.some(
      (matter, index) =>
        matter.id !== matterIds[index] ||
        matter.stage === 'ARCHIVED' ||
        (matter.stage === 'WAITING_RETURN'
          ? !matter.capabilities.archiveReturn
          : !matter.capabilities.archiveMatter),
    );
    if (invalid) {
      state.value = 'failed';
      message.value =
        '至少一项已不是可归档状态或当前账号无权归档，请重新读取事项。';
      return;
    }
    drafts.value = details.map((matter) => ({
      id: matter.id,
      businessNo: matter.businessNo,
      stage: matter.stage,
      version: matter.version,
      sampleFeeState: matter.evidence?.sampleFeeState ?? 'PENDING',
      sampleFeeAmount: matter.evidence?.sampleFeeAmount ?? null,
      archiveType: '',
      archiveDate: new Date().toLocaleDateString('en-CA'),
      notaryFeeAmount:
        matter.fees.notary.state === 'KNOWN' ? matter.fees.notary.amount : '',
      sampleFeeAmountDraft:
        matter.evidence?.sampleFeeState === 'KNOWN'
          ? (matter.evidence.sampleFeeAmount ?? '')
          : '',
      reason: '',
      refund: emptyAmount(),
      freight: emptyAmount(),
    }));
    loadedScopeKey.value = props.scopeKey;
    state.value = 'ready';
    message.value = '请逐项填写费用、归档日期、归档类型和原因。';
  } catch (error) {
    if (controller.signal.aborted || generation !== readGeneration) return;
    state.value = 'failed';
    message.value =
      error instanceof Error ? error.message : '读取事项失败，请重试。';
  } finally {
    if (generation === readGeneration) readBusy.value = false;
  }
}

function freezeRequest(): void {
  if (!canSubmit.value) return;
  frozenItems.value = drafts.value.map(buildItem);
  frozenKey.value = globalThis.crypto.randomUUID();
  frozenScope.value = props.scopeKey;
  emit('frozen', {
    items: frozenItems.value,
    key: frozenKey.value,
    scopeKey: frozenScope.value,
  });
  message.value = `正在提交 ${frozenItems.value.length} 项。整批一起归档或一起失败；只记录费用事实，不会付款。`;
  void submitFrozen();
}

async function submitFrozen(): Promise<void> {
  const items = frozenItems.value;
  if (!items || submitBusy.value || !retryAllowed.value) return;
  const request = { items, key: frozenKey.value, scopeKey: frozenScope.value };
  submitBusy.value = true;
  try {
    await archiveNotaryReturnBatch(items, request.key);
    if (disposed || props.scopeKey !== request.scopeKey) return;
    notifyWorkflowChanged();
    emit('resolved', request);
    frozenItems.value = null;
    frozenKey.value = '';
    frozenScope.value = '';
    message.value = '所选事项已全部归档。';
    emit('completed');
  } catch (error) {
    if (disposed || props.scopeKey !== request.scopeKey) return;
    if (
      error instanceof ApiError &&
      [400, 403, 404, 409].includes(error.status)
    ) {
      emit('resolved', request);
      frozenItems.value = null;
      frozenKey.value = '';
      frozenScope.value = '';
      state.value = 'failed';
      message.value = `${error.message} 整批未保存，请重新读取事项后修正。`;
      return;
    }
    message.value =
      '结果尚未确认，已冻结原提交内容。请仅在原账号和阶段下显式重试原请求。';
  } finally {
    submitBusy.value = false;
  }
}

function retryFrozen(): void {
  if (!submitBusy.value && retryAllowed.value) void submitFrozen();
}

function reloadAfterRejection(): void {
  if (locked.value) return;
  void loadDetails();
}

watch(
  () => JSON.stringify([props.matterIds, props.scopeKey]),
  () => {
    readController?.abort();
    readGeneration += 1;
    sharedReason.value = '';
    filledReasonCount.value = null;
    if (locked.value) {
      if (frozenScope.value !== props.scopeKey)
        message.value =
          '当前账号或阶段已变化，冻结请求仅保留，不能在此上下文重试。';
      return;
    }
    void loadDetails();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  readController?.abort();
  readGeneration += 1;
});
</script>

<template>
  <section class="demo-card return-archive-batch" aria-label="批量退货归档">
    <header>
      <div>
        <h2>批量退货归档</h2>
        <p>
          费用逐案记录，原有历史保留；退款金额表示应退金额，不代表已实际退款。
        </p>
      </div>
      <button type="button" @click="emit('close')">返回列表</button>
    </header>
    <p role="status" data-test="batch-message">{{ message }}</p>
    <p v-if="locked && !retryAllowed" role="alert">
      当前账号、部门或阶段已变化。原请求仍未确认，请返回列表；只能回到原上下文后显式重试。
    </p>
    <p v-else-if="props.matterIds.length > 50" role="alert">
      最多归档50项；请减少已选择事项。
    </p>
    <div
      v-if="state === 'loading' && (!locked || retryAllowed)"
      aria-live="polite"
    >
      正在读取事项详情。
    </div>
    <div
      v-else-if="state === 'failed' && (!locked || retryAllowed)"
      class="state-panel"
    >
      <button
        type="button"
        data-test="batch-reload"
        :disabled="locked"
        @click="reloadAfterRejection"
      >
        重新读取事项
      </button>
    </div>
    <form
      v-else-if="!locked || retryAllowed"
      class="batch-matter-list"
      @submit.prevent="freezeRequest"
    >
      <section class="shared-reason" aria-label="共用归档原因">
        <label>
          共用归档原因
          <textarea
            v-model="sharedReason"
            data-test="shared-reason"
            :disabled="
              locked ||
              submitBusy ||
              readBusy ||
              loadedScopeKey !== props.scopeKey
            "
            aria-describedby="shared-reason-help shared-reason-error"
          />
        </label>
        <p id="shared-reason-help">
          填入只会补到当前原因空白的事项；填入后仍是逐项可编辑草稿。请逐项核对归档资格、处理方式、金额和收付方，共用原因不会代替逐项确认。
        </p>
        <p
          v-if="sharedReasonError"
          id="shared-reason-error"
          role="alert"
          data-test="shared-reason-error"
        >
          {{ sharedReasonError }}
        </p>
        <button
          type="button"
          data-test="fill-blank-reasons"
          :disabled="!canFillSharedReason"
          @click="fillBlankReasons"
        >
          填入空白原因
        </button>
        <p
          v-if="filledReasonCount !== null"
          role="status"
          data-test="shared-reason-filled-count"
        >
          已填入 {{ filledReasonCount }} 项；各项原因仍可单独编辑。
        </p>
      </section>
      <fieldset
        v-for="(draft, index) in drafts"
        :key="draft.id"
        class="batch-matter demo-card"
        :disabled="locked || submitBusy || readBusy"
      >
        <legend>{{ draft.businessNo }}</legend>
        <p>
          样品费事实：<span v-if="draft.sampleFeeState === 'KNOWN'"
            >{{ draft.sampleFeeAmount }} 元</span
          >
          <span v-else>待定</span>（仅供核对）
        </p>
        <label
          >公证费 <span aria-hidden="true">*</span
          ><input
            v-model="draft.notaryFeeAmount"
            :data-test="`notary-fee-${draft.id}`"
            inputmode="decimal"
            required
        /></label>
        <label
          >样品费 <span aria-hidden="true">*</span
          ><input
            v-model="draft.sampleFeeAmountDraft"
            :data-test="`sample-fee-${draft.id}`"
            inputmode="decimal"
            required
        /></label>
        <label
          >归档日期 <span aria-hidden="true">*</span
          ><input
            v-model="draft.archiveDate"
            :data-test="`archive-date-${draft.id}`"
            type="date"
            required
        /></label>
        <label>
          归档类型 <span aria-hidden="true">*</span>
          <select
            v-model="draft.archiveType"
            :data-test="`archive-type-${draft.id}`"
            required
          >
            <option value="">请选择</option>
            <option value="LINK_REMOVED">链接下架</option>
            <option value="NO_INFRINGEMENT_INFORMATION">无侵权信息</option>
            <option value="NO_EVIDENCE">不取证</option>
            <option value="NOT_SHIPPED_REFUND_ONLY">不发货-仅退款</option>
            <option value="RECEIVED_KEEP">收到货-不退货</option>
            <option value="RECEIVED_RETURN_REFUND">收到货-退货退款</option>
          </select>
        </label>
        <div
          v-if="
            draft.archiveType === 'RECEIVED_RETURN_REFUND' ||
            draft.archiveType === 'NOT_SHIPPED_REFUND_ONLY'
          "
        >
          <label
            >退款金额 <span aria-hidden="true">*</span>
            <input
              v-model="draft.refund.amount"
              :data-test="`refund-amount-${draft.id}`"
              inputmode="decimal"
              placeholder="例如 0.00"
              required
            />
          </label>
          <label v-if="Number(draft.refund.amount) > 0"
            >退款收付方 <span aria-hidden="true">*</span>
            <select
              v-model="draft.refund.partyKind"
              :data-test="`refund-party-${draft.id}`"
              required
            >
              <option value="">请选择</option>
              <option value="CUSTOMER">客户</option>
              <option value="FIRM">律所</option>
              <option value="MERCHANT">商家</option>
              <option value="OTHER">其他</option>
            </select>
          </label>
          <label v-if="draft.refund.partyKind === 'OTHER'"
            >退款收付方名称 <span aria-hidden="true">*</span>
            <input
              v-model="draft.refund.partyName"
              :data-test="`refund-party-name-${draft.id}`"
              required
            />
          </label>
        </div>
        <div v-if="draft.archiveType === 'RECEIVED_RETURN_REFUND'">
          <label
            >退货运费金额 <span aria-hidden="true">*</span>
            <input
              v-model="draft.freight.amount"
              :data-test="`freight-amount-${draft.id}`"
              inputmode="decimal"
              placeholder="例如 0.00"
              required
            />
          </label>
          <label v-if="Number(draft.freight.amount) > 0"
            >运费收付方 <span aria-hidden="true">*</span>
            <select
              v-model="draft.freight.partyKind"
              :data-test="`freight-party-${draft.id}`"
              required
            >
              <option value="">请选择</option>
              <option value="CUSTOMER">客户</option>
              <option value="FIRM">律所</option>
              <option value="MERCHANT">商家</option>
              <option value="OTHER">其他</option>
            </select>
          </label>
          <label v-if="draft.freight.partyKind === 'OTHER'"
            >运费收付方名称 <span aria-hidden="true">*</span>
            <input
              v-model="draft.freight.partyName"
              :data-test="`freight-party-name-${draft.id}`"
              required
            />
          </label>
        </div>
        <label>
          归档原因 <span aria-hidden="true">*</span>
          <textarea
            v-model="draft.reason"
            :data-test="`reason-${draft.id}`"
            maxlength="5000"
            required
          />
        </label>
        <ul v-if="rowErrors[index].length" class="field-errors">
          <li v-for="error in rowErrors[index]" :key="error">{{ error }}</li>
        </ul>
      </fieldset>
      <p class="batch-submit-explanation">
        将提交
        {{ drafts.length }}
        项：全部一起归档或一起失败，只记录事实，不会发起付款。
      </p>
      <button type="submit" data-test="batch-submit" :disabled="!canSubmit">
        {{ submitBusy ? '正在提交' : `确认归档 ${drafts.length} 项` }}
      </button>
    </form>
    <button
      v-if="locked"
      type="button"
      data-test="batch-retry"
      :disabled="submitBusy || !retryAllowed"
      @click="retryFrozen"
    >
      {{ submitBusy ? '正在重试原请求' : '原请求重试' }}
    </button>
  </section>
</template>
