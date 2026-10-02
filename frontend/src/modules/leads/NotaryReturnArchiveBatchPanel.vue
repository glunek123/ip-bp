<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  getNotaryMatter,
  type NotaryReturnAmountInput,
  type NotaryReturnChoice,
  type NotaryReturnPartyKind,
} from '../../api/notary';
import {
  archiveNotaryReturnBatch,
  type ArchiveNotaryReturnBatchInput,
} from '../../api/notary-return-archive-batch';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type AmountDraft = {
  state: '' | 'KNOWN' | 'PENDING';
  amount: string;
  partyKind: '' | NotaryReturnPartyKind;
  partyName: string;
};
type MatterDraft = {
  id: string;
  businessNo: string;
  version: number;
  sampleFeeState: 'KNOWN' | 'PENDING';
  sampleFeeAmount: string | null;
  choice: '' | NotaryReturnChoice;
  reason: string;
  refund: AmountDraft;
  freight: AmountDraft;
};

const props = defineProps<{ matterIds: string[]; scopeKey: string }>();
const emit = defineEmits<{ close: []; completed: [] }>();

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const drafts = ref<MatterDraft[]>([]);
const message = ref('正在读取已选择事项及当前归档能力。');
const readBusy = ref(false);
const submitBusy = ref(false);
const frozenItems = ref<ArchiveNotaryReturnBatchInput[] | null>(null);
const frozenKey = ref('');
const frozenScope = ref('');
let readController: AbortController | undefined;
let readGeneration = 0;

const locked = computed(() => frozenItems.value !== null);
const retryAllowed = computed(
  () => locked.value && frozenScope.value === props.scopeKey,
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
  return { state: '', amount: '', partyKind: '', partyName: '' };
}

function validateAmount(amount: AmountDraft, label: string): string[] {
  if (!amount.state) return [`请选择${label}状态`];
  if (amount.state === 'PENDING') return [];
  if (!/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(amount.amount))
    return [`${label}请输入非负且保留两位小数的金额`];
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

function validateDraft(draft: MatterDraft): string[] {
  const errors: string[] = [];
  if (!draft.choice) errors.push('请选择归档处理方式');
  if (!draft.reason.trim()) errors.push('请填写归档原因');
  if ([...draft.reason.trim()].length > 5000)
    errors.push('归档原因不能超过5000字');
  if (draft.choice === 'RETURN') {
    errors.push(...validateAmount(draft.refund, '退款金额'));
    errors.push(...validateAmount(draft.freight, '运费'));
  } else if (draft.choice === 'REFUND_ONLY') {
    errors.push(...validateAmount(draft.refund, '退款金额'));
  }
  return errors;
}

function amountInput(draft: AmountDraft): NotaryReturnAmountInput {
  if (draft.state === 'PENDING') return { state: 'PENDING' };
  const amount = draft.amount.trim();
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
  const choice = draft.choice as NotaryReturnChoice;
  return {
    matterId: draft.id,
    returnChoice: choice,
    ...(choice === 'RETURN' || choice === 'REFUND_ONLY'
      ? { refund: amountInput(draft.refund) }
      : {}),
    ...(choice === 'RETURN' ? { freight: amountInput(draft.freight) } : {}),
    archiveReason: draft.reason.trim(),
    expectedVersion: draft.version,
  };
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
        matter.stage !== 'WAITING_RETURN' ||
        !matter.capabilities.archiveReturn ||
        matter.issuanceDecision?.decision !== 'NO_ISSUE',
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
      version: matter.version,
      sampleFeeState: matter.evidence?.sampleFeeState ?? 'PENDING',
      sampleFeeAmount: matter.evidence?.sampleFeeAmount ?? null,
      choice: '',
      reason: '',
      refund: emptyAmount(),
      freight: emptyAmount(),
    }));
    state.value = 'ready';
    message.value = '请逐项确认处理方式、适用金额、收付方及归档原因。';
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
  message.value = `正在提交 ${frozenItems.value.length} 项。整批一起归档或一起失败；只记录费用事实，不会付款。`;
  void submitFrozen();
}

async function submitFrozen(): Promise<void> {
  const items = frozenItems.value;
  if (!items || submitBusy.value || !retryAllowed.value) return;
  submitBusy.value = true;
  try {
    await archiveNotaryReturnBatch(items, frozenKey.value);
    if (props.scopeKey !== frozenScope.value) return;
    notifyWorkflowChanged();
    frozenItems.value = null;
    frozenKey.value = '';
    frozenScope.value = '';
    message.value = '所选事项已全部归档。';
    emit('completed');
  } catch (error) {
    if (props.scopeKey !== frozenScope.value) return;
    if (
      error instanceof ApiError &&
      [400, 403, 404, 409].includes(error.status)
    ) {
      frozenItems.value = null;
      frozenKey.value = '';
      frozenScope.value = '';
      state.value = 'failed';
      message.value = '提交被拒绝，请重新读取事项后再提交。';
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
  () => [props.matterIds.join(','), props.scopeKey],
  () => {
    readController?.abort();
    readGeneration += 1;
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
  readController?.abort();
  readGeneration += 1;
});
</script>

<template>
  <section class="demo-card return-archive-batch" aria-label="批量退货归档">
    <header>
      <div>
        <h2>批量退货归档</h2>
        <p>逐项记录本次实际处理。原样品费用仅作参考，不会被改动。</p>
      </div>
      <button
        type="button"
        :disabled="locked || submitBusy"
        @click="emit('close')"
      >
        返回列表
      </button>
    </header>
    <p role="status" data-test="batch-message">{{ message }}</p>
    <p v-if="props.matterIds.length > 50" role="alert">
      最多归档50项；请减少已选择事项。
    </p>
    <div v-if="state === 'loading'" aria-live="polite">正在读取事项详情。</div>
    <div v-else-if="state === 'failed'" class="state-panel">
      <button
        type="button"
        data-test="batch-reload"
        :disabled="locked"
        @click="reloadAfterRejection"
      >
        重新读取事项
      </button>
    </div>
    <form v-else class="batch-matter-list" @submit.prevent="freezeRequest">
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
        <label>
          归档处理方式 <span aria-hidden="true">*</span>
          <select
            v-model="draft.choice"
            :data-test="`choice-${draft.id}`"
            required
          >
            <option value="">请选择</option>
            <option value="RETURN">退回样品</option>
            <option value="KEEP">保留样品</option>
            <option value="REFUND_ONLY">仅退款</option>
          </select>
        </label>
        <div v-if="draft.choice === 'RETURN' || draft.choice === 'REFUND_ONLY'">
          <label>
            退款金额状态 <span aria-hidden="true">*</span>
            <select
              v-model="draft.refund.state"
              :data-test="`refund-state-${draft.id}`"
              required
            >
              <option value="">请选择</option>
              <option value="KNOWN">已知</option>
              <option value="PENDING">待定</option>
            </select>
          </label>
          <template v-if="draft.refund.state === 'KNOWN'">
            <label
              >退款事实金额 <span aria-hidden="true">*</span>
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
          </template>
        </div>
        <div v-if="draft.choice === 'RETURN'">
          <label>
            运费状态 <span aria-hidden="true">*</span>
            <select
              v-model="draft.freight.state"
              :data-test="`freight-state-${draft.id}`"
              required
            >
              <option value="">请选择</option>
              <option value="KNOWN">已知</option>
              <option value="PENDING">待定</option>
            </select>
          </label>
          <template v-if="draft.freight.state === 'KNOWN'">
            <label
              >运费事实金额 <span aria-hidden="true">*</span>
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
          </template>
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
