<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import CaseSettlementAmountEditor from './CaseSettlementAmountEditor.vue';
import CaseClosurePaymentFields, {
  type ClosurePaymentRecord,
  type ClosurePaymentType,
} from './CaseClosurePaymentFields.vue';
type AmountEdit = {
  mode: 'KEEP' | 'AUTOMATIC' | 'MANUAL';
  amount: string | null;
};
type RefundItem = {
  itemId: string;
  party: 'COURT' | 'DEFENDANT';
  status:
    | 'UNKNOWN'
    | 'PENDING'
    | 'SUBMITTED'
    | 'RETURNED_UNSETTLED'
    | 'SETTLED'
    | 'RECEIVED'
    | 'CONVERTED_TO_COST';
  description: string;
  amount?: string | null;
};
type RefundCommand = {
  expectedVersionId: string | null;
  kind: 'RECORD' | 'CONFIRM_COMPLETE' | 'DECLARE_NOT_APPLICABLE';
  items?: RefundItem[];
};
type SettlementCommand = {
  expectedAssessmentVersionId: string | null;
  expectedTermsVersion: number | null;
  declaration: 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
  customerAmount?: { mode: AmountEdit['mode']; amount?: string };
  lawyerAmount?: { mode: AmountEdit['mode']; amount?: string };
};
export type SettlementUpdateSource = {
  refund?: {
    versionId: string | null;
    items: RefundItem[];
    completeness?: 'UNKNOWN' | 'COMPLETE' | 'NOT_APPLICABLE';
  };
  settlement?: SettlementCommand;
  customerAmount?: string | null;
  lawyerAmount?: string | null;
  expectedClosureVersionId: string;
  closeAt: string | null;
  closeAmt: string | null;
  paymentType: ClosurePaymentType | '';
  documents: { id: string; name: string }[];
  payments: (ClosurePaymentRecord & {
    versionId: string;
    receiptIds: string[];
  })[];
};
const props = withDefaults(
  defineProps<{
    source: SettlementUpdateSource;
    caseId?: string;
    canCorrectClosure?: boolean;
  }>(),
  { canCorrectClosure: true },
);
const canEditClosureFacts = computed(() => props.canCorrectClosure !== false);
const caseId = computed(() => props.caseId ?? '');
const editorSide = ref<'CUSTOMER' | 'LAWYER' | null>(null);
function toggleEditor(side: 'CUSTOMER' | 'LAWYER'): void {
  editorSide.value = editorSide.value === side ? null : side;
}
function onTermsUpdated(): void {
  editorSide.value = null;
  emit('refresh');
}
const emit = defineEmits<{
  cancel: [];
  refresh: [];
  draft: [
    value: {
      settlementAmounts: { customer: AmountEdit; lawyer: AmountEdit };
      refund?: RefundCommand;
      settlement?: SettlementCommand;
      expectedClosureVersionId: string;
      closeAt: string | null;
      closeAmt: string | null;
      closeAmountState: 'KNOWN' | 'PENDING';
      paymentType: ClosurePaymentType;
      paymentRecords: ClosurePaymentRecord[];
      preservedDocumentIds: string[];
      newDocuments: globalThis.File[];
      existingPaymentVersions: string[];
      receiptAdditions: {
        paymentVersionId: string;
        files: globalThis.File[];
      }[];
    },
  ];
}>();
const closeAt = ref(props.source.closeAt ?? '');
const amount = ref(props.source.closeAmt ?? '');
const unknown = ref(props.source.closeAmt === null);
const paymentType = ref(props.source.paymentType);
const paymentTypeError = ref('');
const savedPayments = computed(() =>
  props.source.payments.map((payment) => ({
    id: payment.id,
    paymentDate: payment.paymentDate,
    amount: payment.amount,
    payer: payment.payer,
    payee: payment.payee,
    receiptCount: payment.receiptIds.length,
  })),
);
function sourcePayment(id: string): SettlementUpdateSource['payments'][number] {
  return (
    props.source.payments.find((payment) => payment.id === id) ?? {
      id,
      versionId: '',
      paymentDate: '',
      amount: '',
      payer: '',
      payee: '',
      receiptIds: [],
    }
  );
}
function changePaymentType(event: globalThis.Event) {
  const target = event.target as globalThis.HTMLSelectElement;
  const next = target.value as ClosurePaymentType;
  paymentTypeError.value = '';
  // 一次性付款只能有一笔：已保存与新填的都算。
  if (
    next === 'ONE_TIME' &&
    props.source.payments.length + records.value.length > 1
  ) {
    paymentTypeError.value = '已有多笔付款记录，不能改为一次性付款。';
    target.value = paymentType.value;
    return;
  }
  paymentType.value = next;
}

const records = ref<ClosurePaymentRecord[]>([]);
const money = /^\d{1,14}(?:\.\d{1,2})?$/u;
const date = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
function validPayment(record: ClosurePaymentRecord): boolean {
  return (
    date(record.paymentDate) &&
    money.test(record.amount) &&
    /[1-9]/u.test(record.amount) &&
    !!record.payer.trim() &&
    !!record.payee.trim() &&
    record.payer.length <= 200 &&
    record.payee.length <= 200
  );
}
function sumPaymentCents(
  payments: readonly ClosurePaymentRecord[],
): bigint | null {
  let total = 0n;
  for (const payment of payments) {
    if (!money.test(payment.amount)) return null;
    const [whole = '0', fraction = ''] = payment.amount.split('.');
    total += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }
  return total;
}
function formatPaymentCents(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
// The source contains only current effective versions. It excludes superseded
// and voided records; unsaved additions remain a separate preview.
const savedPaymentTotal = computed(() =>
  sumPaymentCents(props.source.payments),
);
const draftPaymentTotal = computed(() =>
  records.value.every(validPayment) ? sumPaymentCents(records.value) : null,
);
const paymentTotal = computed(() =>
  savedPaymentTotal.value === null || draftPaymentTotal.value === null
    ? null
    : savedPaymentTotal.value + draftPaymentTotal.value,
);
const documents = ref<globalThis.File[]>([]);
const receipts = ref<{ paymentVersionId: string; files: globalThis.File[] }[]>(
  [],
);
const error = ref('');
const refundKind = ref<'KEEP' | RefundCommand['kind']>('KEEP');
const refundItems = ref<RefundItem[]>(
  props.source.refund?.items.map((item) => ({ ...item })) ?? [],
);
const declaration = ref(props.source.settlement?.declaration ?? 'UNKNOWN');
const settlementChanged = ref(false);
const customerEdit = ref<AmountEdit>({
  mode: 'KEEP',
  amount: props.source.customerAmount ?? null,
});
const lawyerEdit = ref<AmountEdit>({
  mode: 'KEEP',
  amount: props.source.lawyerAmount ?? null,
});
watch(
  () => props.source,
  (source) => {
    customerEdit.value = {
      mode: 'KEEP',
      amount: source.customerAmount ?? null,
    };
    lawyerEdit.value = { mode: 'KEEP', amount: source.lawyerAmount ?? null };
    closeAt.value = source.closeAt ?? '';
    amount.value = source.closeAmt ?? '';
    unknown.value = source.closeAmt === null;
    paymentType.value = source.paymentType;
    paymentTypeError.value = '';
    records.value = [];
    documents.value = [];
    receipts.value = [];
    refundKind.value = 'KEEP';
    refundItems.value = source.refund?.items.map((item) => ({ ...item })) ?? [];
    declaration.value = source.settlement?.declaration ?? 'UNKNOWN';
    settlementChanged.value = false;
    error.value = '';
  },
  { deep: true, flush: 'sync' },
);
function addRefund() {
  refundItems.value.push({
    itemId: globalThis.crypto.randomUUID(),
    party: 'COURT',
    status: 'UNKNOWN',
    description: '',
    amount: null,
  });
  refundKind.value = 'RECORD';
}
const refundStatuses: { value: RefundItem['status']; label: string }[] = [
  { value: 'UNKNOWN', label: '待确认' },
  { value: 'PENDING', label: '待办理' },
  { value: 'SUBMITTED', label: '已提交' },
  { value: 'RETURNED_UNSETTLED', label: '已退未结算' },
  { value: 'SETTLED', label: '已结算（客户已收，公司未收）' },
  { value: 'RECEIVED', label: '已回款（公司已收）' },
  { value: 'CONVERTED_TO_COST', label: '转成本' },
];
function files(event: globalThis.Event): globalThis.File[] {
  const input = event.target as globalThis.HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  input.value = '';
  return selected;
}
function addDocuments(event: globalThis.Event) {
  if (!canEditClosureFacts.value) return;
  documents.value.push(...files(event));
}
// 声明"涉及结算"时，数据库要求客户与律师应结金额都有值；
// 若保留现有值但现值未知（或手工金额为空），前端应当场拦住，
// 而不是把请求发出去换一个 500。
const settlementAmountMissing = computed(() => {
  if (declaration.value !== 'APPLICABLE') return false;
  // 只在"本次改变了声明"时拦截：改付款、改单侧金额走的是别的命令，
  // 由服务端的 SETTLEMENT_AMOUNT_UNKNOWN 兜底，不该在这里被牵连。
  if (!settlementChanged.value) return false;
  return (['customer', 'lawyer'] as const).some((side) => {
    const edit = side === 'customer' ? customerEdit.value : lawyerEdit.value;
    if (edit.mode === 'MANUAL') return !edit.amount;
    if (edit.mode !== 'KEEP') return false;
    const current =
      side === 'customer'
        ? props.source.customerAmount
        : props.source.lawyerAmount;
    return current == null;
  });
});
function submit() {
  if (settlementAmountMissing.value) {
    error.value =
      '声明涉及结算时，客户与律师应结金额都必须有值；请改为手工金额，或先确认金额。';
    return;
  }
  if (
    canEditClosureFacts.value &&
    props.source.documents.length + documents.value.length > 10
  ) {
    error.value = '结案文书最多保留 10 份，请移除多选的新文书。';
    return;
  }
  if (!paymentType.value) {
    error.value = '请选择付款类型，再保存结案更新。';
    return;
  }
  if (
    (closeAt.value !== '' && !date(closeAt.value)) ||
    (!unknown.value && !money.test(amount.value)) ||
    !records.value.every(validPayment) ||
    (paymentType.value === 'ONE_TIME' &&
      props.source.payments.length + records.value.length > 1)
  ) {
    error.value = '请核对日期、金额和付款资料；一次性付款最多一笔有效记录。';
    return;
  }
  if (
    refundKind.value === 'RECORD' &&
    refundItems.value.some(
      (item) =>
        !item.description.trim() ||
        item.description.length > 1000 ||
        (item.amount !== null &&
          item.amount !== undefined &&
          item.amount !== '' &&
          !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(item.amount)) ||
        (item.party === 'COURT' && item.status === 'CONVERTED_TO_COST'),
    )
  ) {
    error.value =
      '请核对逐笔退费金额和说明；金额可空（待确认），有值须为非负金额并最多两位小数，法院退费不能转成本。';
    return;
  }
  if (
    refundKind.value === 'CONFIRM_COMPLETE' &&
    !props.source.refund?.versionId
  ) {
    error.value = '请先登记退费清单并取得版本，再确认完整。';
    return;
  }
  if (
    [customerEdit.value, lawyerEdit.value].some(
      (edit) =>
        edit.mode === 'MANUAL' &&
        !/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(edit.amount ?? ''),
    )
  ) {
    error.value = '手工应结金额须为非负数，最多两位小数。';
    return;
  }
  emit('draft', {
    settlementAmounts: {
      customer: {
        mode: customerEdit.value.mode,
        amount:
          customerEdit.value.mode === 'MANUAL'
            ? customerEdit.value.amount
            : null,
      },
      lawyer: {
        mode: lawyerEdit.value.mode,
        amount:
          lawyerEdit.value.mode === 'MANUAL' ? lawyerEdit.value.amount : null,
      },
    },
    ...(props.source.refund && refundKind.value !== 'KEEP'
      ? {
          refund: {
            expectedVersionId: props.source.refund.versionId,
            kind: refundKind.value,
            ...(refundKind.value === 'CONFIRM_COMPLETE'
              ? {}
              : {
                  items:
                    refundKind.value === 'DECLARE_NOT_APPLICABLE'
                      ? []
                      : refundItems.value.map((item) => ({
                          ...item,
                          amount:
                            item.amount === undefined ||
                            item.amount === null ||
                            item.amount === ''
                              ? null
                              : item.amount,
                        })),
                }),
          },
        }
      : {}),
    ...(props.source.settlement &&
    (settlementChanged.value ||
      customerEdit.value.mode !== 'KEEP' ||
      lawyerEdit.value.mode !== 'KEEP')
      ? {
          settlement: {
            ...props.source.settlement,
            declaration: declaration.value,
            customerAmount: {
              mode: customerEdit.value.mode,
              ...(customerEdit.value.mode === 'MANUAL' &&
              customerEdit.value.amount !== null
                ? { amount: customerEdit.value.amount }
                : {}),
            },
            lawyerAmount: {
              mode: lawyerEdit.value.mode,
              ...(lawyerEdit.value.mode === 'MANUAL' &&
              lawyerEdit.value.amount !== null
                ? { amount: lawyerEdit.value.amount }
                : {}),
            },
          },
        }
      : {}),
    expectedClosureVersionId: props.source.expectedClosureVersionId,
    closeAt: canEditClosureFacts.value
      ? closeAt.value || null
      : props.source.closeAt,
    closeAmt: unknown.value ? null : amount.value,
    closeAmountState: unknown.value ? 'PENDING' : 'KNOWN',
    paymentType: paymentType.value,
    paymentRecords: records.value.map((r) => ({ ...r })),
    preservedDocumentIds: props.source.documents.map((d) => d.id),
    newDocuments: canEditClosureFacts.value ? [...documents.value] : [],
    existingPaymentVersions: props.source.payments.map((p) => p.versionId),
    receiptAdditions: receipts.value.map((r) => ({
      paymentVersionId: r.paymentVersionId,
      files: [...r.files],
    })),
  });
}
</script>
<template>
  <form class="settlement-update settle-card" @submit.prevent="submit">
    <p
      v-if="!canEditClosureFacts"
      class="settle-note"
      data-test="closure-correction-readonly"
    >
      结案日期和结案文书只读；更正这两项需要原结案更正权限。其他结算和付款办理仍可继续。
    </p>

    <div class="settle-row">
      <label class="settle-field">
        <span>结案日期</span>
        <input
          v-model="closeAt"
          type="date"
          :disabled="!canEditClosureFacts"
          data-test="date"
        />
      </label>
      <label class="settle-field">
        <span class="settle-label">
          结案金额（元）
          <span class="settle-check">
            <input
              v-model="unknown"
              type="checkbox"
              data-test="unknown"
            />金额待确认
          </span>
        </span>
        <input
          v-model="amount"
          :disabled="unknown"
          inputmode="decimal"
          data-test="amount"
        />
      </label>
    </div>

    <div class="settle-row">
      <div class="settle-field">
        <span>客户结算金额（按结算条件自动计算）</span>
        <div class="settle-inline">
          <input :value="source.customerAmount ?? '待确认'" readonly />
          <button
            v-if="caseId"
            type="button"
            data-test="edit-customer-terms"
            @click="toggleEditor('CUSTOMER')"
          >
            修改
          </button>
        </div>
        <p class="settle-hint">= 结案金额 × 客户公式</p>
        <CaseSettlementAmountEditor
          v-if="caseId"
          :case-id="caseId"
          side="CUSTOMER"
          :open="editorSide === 'CUSTOMER'"
          @updated="onTermsUpdated"
          @collapsed="editorSide = null"
        />
        <div v-show="editorSide === 'CUSTOMER'" class="settle-legacy">
          <select
            v-model="customerEdit.mode"
            :aria-label="`customer-mode`"
            data-test="customer-mode"
          >
            <option value="KEEP">保留现有值</option>
            <option value="AUTOMATIC">按原规则自动计算</option>
            <option value="MANUAL">手工修改</option>
          </select>
          <input
            v-if="customerEdit.mode === 'MANUAL'"
            v-model="customerEdit.amount"
            inputmode="decimal"
            :aria-label="`customer-amount`"
            data-test="customer-amount"
          />
        </div>
      </div>
      <div class="settle-field">
        <span>律师结算金额（按律师协议自动计算）</span>
        <div class="settle-inline">
          <input :value="source.lawyerAmount ?? '待确认'" readonly />
          <button
            v-if="caseId"
            type="button"
            data-test="edit-lawyer-terms"
            @click="toggleEditor('LAWYER')"
          >
            修改
          </button>
        </div>
        <p class="settle-hint">= 结算模式 × 基础费 × 分成比例</p>
        <CaseSettlementAmountEditor
          v-if="caseId"
          :case-id="caseId"
          side="LAWYER"
          :open="editorSide === 'LAWYER'"
          @updated="onTermsUpdated"
          @collapsed="editorSide = null"
        />
        <div v-show="editorSide === 'LAWYER'" class="settle-legacy">
          <select
            v-model="lawyerEdit.mode"
            :aria-label="`lawyer-mode`"
            data-test="lawyer-mode"
          >
            <option value="KEEP">保留现有值</option>
            <option value="AUTOMATIC">按原规则自动计算</option>
            <option value="MANUAL">手工修改</option>
          </select>
          <input
            v-if="lawyerEdit.mode === 'MANUAL'"
            v-model="lawyerEdit.amount"
            inputmode="decimal"
            :aria-label="`lawyer-amount`"
            data-test="lawyer-amount"
          />
        </div>
      </div>
    </div>

    <div class="settle-row">
      <label class="settle-field">
        <span>付款类型</span>
        <select
          :value="paymentType"
          aria-label="付款类型"
          data-test="payment-type"
          @change="changePaymentType($event)"
        >
          <option value="">请选择付款类型</option>
          <option value="ONE_TIME">一次性付款</option>
          <option value="INSTALLMENTS">分期付款</option>
        </select>
        <p v-if="paymentTypeError" class="settle-hint settle-hint--error">
          {{ paymentTypeError }}
        </p>
      </label>
      <div class="settle-field">
        <span>结案文书</span>
        <div class="settle-files">
          <span
            v-for="document in source.documents"
            :key="document.id"
            class="settle-file"
          >
            <span class="settle-file__name">{{ document.name }}</span>
            <span class="settle-file__tag">历史材料，保留</span>
          </span>
          <span
            v-for="(document, index) in documents"
            :key="index"
            class="settle-file"
          >
            <span class="settle-file__name">{{ document.name }}</span>
            <button
              v-if="canEditClosureFacts"
              type="button"
              class="settle-file__remove"
              aria-label="移除文书"
              :data-test="`remove-document-${index}`"
              @click="documents.splice(index, 1)"
            >
              ×
            </button>
          </span>
          <label class="settle-upload">
            <span class="settle-upload__plus">＋</span>
            <span>上传</span>
            <input
              type="file"
              multiple
              aria-label="补充结案文书"
              :disabled="!canEditClosureFacts"
              @change="addDocuments($event)"
            />
          </label>
        </div>
      </div>
    </div>

    <section class="settle-block">
      <p class="settle-block__title">付款记录（可多笔，自动汇总已付款）</p>
      <CaseClosurePaymentFields
        :payment-type="paymentType || 'INSTALLMENTS'"
        :records="records"
        :saved="savedPayments"
        :show-type="false"
        @update:records="records = $event"
      >
        <template #saved-action="{ record }">
          <slot name="payment-proof" :payment="sourcePayment(record.id)"
            ><label class="proof-fallback">
              <input
                type="file"
                multiple
                aria-label="补充原付款截图"
                @change="
                  receipts.push({
                    paymentVersionId: sourcePayment(record.id).versionId,
                    files: files($event),
                  })
                "
              />
              <span>补截图</span>
            </label></slot
          >
        </template>
      </CaseClosurePaymentFields>
      <div class="settle-totals">
        <p class="settle-total" data-test="payment-total">
          已付款合计{{ records.length ? '（含新增待保存）' : '' }}：<template
            v-if="paymentTotal !== null"
            >{{ formatPaymentCents(paymentTotal) }} 元</template
          ><template v-else>待完善，请核对付款资料</template>
        </p>
        <p class="settle-hint settle-hint--split">
          <span data-test="saved-payment-total"
            >已保存有效付款合计：<template v-if="savedPaymentTotal !== null"
              >{{ formatPaymentCents(savedPaymentTotal) }} 元</template
            ><template v-else>未知，请重新读取付款记录</template></span
          >
          <span class="settle-dot">·</span>
          <span data-test="draft-payment-total"
            >本次新增付款合计（待保存）：<template
              v-if="draftPaymentTotal !== null"
              >{{ formatPaymentCents(draftPaymentTotal) }} 元</template
            ><template v-else>待完善，请补全有效付款资料</template></span
          >
        </p>
      </div>
    </section>

    <section v-if="source.refund" class="settle-block">
      <div class="settle-block__head">
        <h3 class="settle-block__title">诉讼退费</h3>
        <span class="settle-tag">
          {{
            source.refund.completeness === 'COMPLETE'
              ? '已确认完整'
              : source.refund.completeness === 'NOT_APPLICABLE'
                ? '无诉讼退费（0元）'
                : '待确认'
          }}
        </span>
      </div>
      <ul class="refund-list">
        <li
          v-for="item in source.refund.items"
          :key="item.itemId"
          class="refund-item"
        >
          <span class="refund-cell">{{
            item.party === 'COURT' ? '法院' : '被告'
          }}</span>
          <span class="refund-cell refund-cell--amount">
            {{
              item.amount === undefined ||
              item.amount === null ||
              item.amount === ''
                ? '待确认'
                : `${item.amount}元`
            }}
          </span>
          <span class="refund-cell refund-cell--status">
            {{
              refundStatuses.find((status) => status.value === item.status)
                ?.label
            }}
          </span>
          <span class="refund-desc">{{ item.description }}</span>
        </li>
      </ul>
      <div class="settle-inline settle-inline--narrow">
        <select v-model="refundKind" aria-label="退费操作">
          <option value="KEEP">保留原清单</option>
          <option value="RECORD">登记清单</option>
          <option value="CONFIRM_COMPLETE" :disabled="!source.refund.versionId">
            确认已登记完整
          </option>
          <option value="DECLARE_NOT_APPLICABLE">无诉讼退费（0元）</option>
        </select>
      </div>
      <div v-if="refundKind === 'RECORD'" class="refund-editor">
        <div
          v-for="item in refundItems"
          :key="item.itemId"
          class="refund-editor__row"
        >
          <select v-model="item.party" aria-label="退费对象">
            <option value="COURT">法院</option>
            <option value="DEFENDANT">被告</option>
          </select>
          <input
            v-model="item.amount"
            aria-label="退费金额"
            inputmode="decimal"
            placeholder="待确认"
          />
          <select v-model="item.status" aria-label="退费状态">
            <option
              v-for="status in refundStatuses"
              :key="status.value"
              :value="status.value"
              :disabled="
                status.value === 'CONVERTED_TO_COST' &&
                item.party !== 'DEFENDANT'
              "
            >
              {{ status.label }}
            </option>
          </select>
          <input
            v-model="item.description"
            aria-label="退费说明"
            placeholder="退费说明"
          />
          <button
            type="button"
            class="refund-editor__remove"
            aria-label="移除此项"
            data-test="remove-refund"
            @click="
              refundItems = refundItems.filter(
                (row) => row.itemId !== item.itemId,
              )
            "
          >
            ×
          </button>
        </div>
        <button type="button" class="settle-link" @click="addRefund">
          ＋ 新增退费
        </button>
      </div>
    </section>
    <p v-else class="settle-hint">
      尚未取得诉讼退费清单及版本，不能推定不涉及。
    </p>
    <label v-if="source.settlement" class="settle-field settle-field--narrow">
      <span>是否涉及结算</span>
      <select
        v-model="declaration"
        aria-label="是否涉及结算"
        data-test="declaration"
        @change="settlementChanged = true"
      >
        <option value="UNKNOWN">待确认</option>
        <option value="APPLICABLE">是</option>
        <option value="NOT_APPLICABLE">否</option>
      </select>
    </label>

    <p v-if="error" role="alert" class="settle-error">{{ error }}</p>
    <p
      v-if="settlementAmountMissing"
      class="settle-hint"
      data-test="settlement-amount-required"
    >
      声明涉及结算时，客户与律师金额都必须有值。
    </p>

    <div class="settle-footer">
      <button type="submit" :disabled="settlementAmountMissing">保存</button>
    </div>
  </form>
</template>
<style scoped>
/* 结算卡：两列栅格 + 分段细线，紧凑排版。 */
.settlement-update {
  display: grid;
  gap: 0;
  color: var(--el-text-color-primary);
}
.settlement-update h2,
.settlement-update h3,
.settlement-update p {
  margin: 0;
}
.settlement-update label.settle-field {
  display: grid;
  gap: 4px;
  align-items: center;
}
.settle-card {
  display: grid;
  gap: 0;
}
.settle-card > .settle-row,
.settle-card > .settle-block {
  padding: 12px 0;
  border-top: 1px solid var(--color-hairline);
}
.settle-card > .settle-row:first-of-type {
  padding-top: 0;
  border-top: 0;
}
.settle-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
}
.settle-row > .settle-field {
  align-content: start;
}
.settle-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.settle-field--narrow {
  max-width: 320px;
}
.settle-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.settle-field > span {
  font-size: 12px;
  color: var(--color-ink-muted);
}
.settle-card input,
.settle-card select {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  color: var(--color-ink);
  background: #fff;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
  outline: none;
  transition: border-color 0.15s;
}
.settle-card input:focus,
.settle-card select:focus {
  border-color: var(--color-primary);
}
.settle-card input:disabled {
  color: var(--color-ink-tertiary);
  background: var(--color-surface-2);
}
.settle-inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}
.settle-inline--narrow {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  max-width: 320px;
}
.settle-inline input[readonly] {
  background: var(--color-surface-2);
}
.settle-inline button {
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--color-ink-muted);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
}
.settle-inline button:hover {
  color: var(--color-primary);
  border-color: var(--el-color-primary-light-5);
  background: var(--color-primary-subtle);
}
.settle-legacy {
  display: grid;
  gap: 8px;
  margin-top: 6px;
  padding: 10px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
}
.settle-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-ink-subtle);
}
.settle-hint--error {
  color: var(--color-danger);
}
.settle-hint--split {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
}
.settle-dot {
  color: var(--color-hairline-strong);
}
.proof-fallback {
  display: inline-flex;
}
.proof-fallback input {
  display: none;
}
.proof-fallback span {
  padding: 0 8px;
  font-size: 12px;
  line-height: 24px;
  color: var(--color-ink-muted);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
}
.proof-fallback span:hover {
  color: var(--color-primary);
  border-color: var(--el-color-primary-light-5);
}
.settle-check {
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-ink-subtle);
  cursor: pointer;
}
.settle-label .settle-check input {
  width: 13px;
  height: 13px;
  margin: 0;
  padding: 0;
}
.settle-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.settle-file {
  position: relative;
  display: flex;
  flex: 1 1 calc(50% - 4px);
  flex-direction: column;
  justify-content: space-between;
  min-width: 118px;
  max-width: 168px;
  height: 72px;
  padding: 8px 10px;
  overflow: hidden;
  font-size: 12px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}
.settle-file__name {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-ink-muted);
  word-break: break-all;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.settle-file__tag {
  align-self: flex-start;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: var(--color-ink-subtle);
  background: var(--color-hairline);
  border-radius: 3px;
}
.settle-file__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: var(--color-ink-subtle);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 50%;
}
.settle-file__remove:hover {
  color: var(--color-danger);
  border-color: var(--el-color-danger-light-5);
}
.settle-upload {
  display: flex;
  flex: 1 1 calc(50% - 4px);
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  min-width: 118px;
  max-width: 168px;
  height: 72px;
  font-size: 12px;
  color: var(--color-ink-subtle);
  cursor: pointer;
  background: var(--color-canvas);
  border: 1px dashed var(--color-hairline-strong);
  border-radius: 6px;
}
.settle-upload:hover {
  color: var(--color-primary);
  border-color: var(--el-color-primary-light-5);
}
.settle-upload__plus {
  font-size: 16px;
  line-height: 1;
}
.settle-upload input {
  display: none;
}
.settle-block {
  display: grid;
  gap: 8px;
}
.settle-block__head {
  display: flex;
  gap: 8px;
  align-items: center;
}
.settle-block__title {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-ink-muted);
}
.settle-tag {
  padding: 0 8px;
  font-size: 11px;
  line-height: 20px;
  color: var(--color-primary);
  background: var(--color-primary-subtle);
  border-radius: 3px;
}
.settle-totals {
  display: grid;
  gap: 2px;
  margin-top: 2px;
}
.settle-total {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}
.settle-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-ink-subtle);
}
.settle-error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger);
}
.refund-list {
  display: grid;
  gap: 6px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.refund-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
}
.refund-cell {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  overflow: hidden;
  font-size: 13px;
  color: var(--color-ink);
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--color-surface-2);
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
}
.refund-cell--amount {
  justify-content: flex-end;
}
.refund-cell--status {
  font-size: 12px;
  color: var(--color-ink-muted);
}
.refund-desc {
  grid-column: 1 / -1;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-ink-subtle);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.refund-editor {
  display: grid;
  gap: 6px;
  padding: 10px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
}
.refund-editor__row {
  display: grid;
  grid-template-columns: 84px 96px 150px minmax(0, 1fr) 28px;
  gap: 6px;
  align-items: center;
}
.refund-editor__row input,
.refund-editor__row select {
  height: 30px;
  font-size: 12px;
}
.refund-editor__remove {
  width: 26px;
  height: 26px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: var(--color-ink-subtle);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 50%;
}
.refund-editor__remove:hover {
  color: var(--color-danger);
  border-color: var(--el-color-danger-light-5);
}
.settle-link {
  justify-self: start;
  padding: 0;
  font-size: 12px;
  color: var(--color-primary);
  cursor: pointer;
  background: none;
  border: 0;
}
.settle-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid var(--color-hairline);
}
.settle-footer button {
  height: 32px;
  padding: 0 18px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
  background: #fff;
  color: var(--color-ink-muted);
}
.settle-footer button:hover {
  color: var(--color-primary);
  border-color: var(--el-color-primary-light-5);
  background: var(--color-primary-subtle);
}
.settle-footer button[type='submit'] {
  color: #fff;
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.settle-footer button[type='submit']:hover {
  background: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
}
.settle-footer button[type='submit']:disabled {
  cursor: not-allowed;
  background: var(--el-color-primary-light-5);
  border-color: var(--el-color-primary-light-5);
}
@media (max-width: 560px) {
  .settle-row {
    grid-template-columns: 1fr;
  }
  .refund-item,
  .refund-editor__row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
