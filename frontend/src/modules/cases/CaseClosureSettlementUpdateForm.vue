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
  paymentType: ClosurePaymentType;
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
        <span>结案金额（元）</span>
        <input
          v-model="amount"
          :disabled="unknown"
          inputmode="decimal"
          data-test="amount"
        />
      </label>
    </div>
    <label class="settle-check">
      <input
        v-model="unknown"
        type="checkbox"
        data-test="unknown"
      />结案金额待确认
    </label>

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

    <div class="settle-field">
      <span>结案文书</span>
      <div class="settle-files">
        <span
          v-for="document in source.documents"
          :key="document.id"
          class="settle-file"
        >
          {{ document.name }}（历史材料，保留）
        </span>
        <span
          v-for="(document, index) in documents"
          :key="index"
          class="settle-file"
        >
          {{ document.name }}
          <button
            v-if="canEditClosureFacts"
            type="button"
            class="link-button"
            :data-test="`remove-document-${index}`"
            @click="documents.splice(index, 1)"
          >
            ×
          </button>
        </span>
        <label class="settle-upload">
          <span>＋ 上传</span>
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

    <div class="settle-field">
      <span>付款记录（可多笔，自动汇总已付款）</span>
      <CaseClosurePaymentFields
        :payment-type="paymentType"
        :records="records"
        @update:payment-type="paymentType = $event"
        @update:records="records = $event"
      />
      <template v-if="source.payments.length">
        <p class="settle-hint">原付款记录（截图可后补）</p>
        <article
          v-for="payment in source.payments"
          :key="payment.versionId"
          class="settle-original"
        >
          <span
            >{{ payment.paymentDate }} / {{ payment.amount }} /
            {{ payment.payer }} → {{ payment.payee }}</span
          >
          <slot name="payment-proof" :payment="payment"
            ><input
              type="file"
              multiple
              aria-label="补充原付款截图"
              @change="
                receipts.push({
                  paymentVersionId: payment.versionId,
                  files: files($event),
                })
              "
          /></slot>
        </article>
      </template>
      <p class="settle-hint" data-test="saved-payment-total">
        已保存有效付款合计：<template v-if="savedPaymentTotal !== null"
          >{{ formatPaymentCents(savedPaymentTotal) }} 元</template
        ><template v-else>未知，请重新读取付款记录</template>
      </p>
      <p class="settle-hint" data-test="draft-payment-total">
        本次新增付款合计（待保存）：<template v-if="draftPaymentTotal !== null"
          >{{ formatPaymentCents(draftPaymentTotal) }} 元</template
        ><template v-else>待完善，请补全有效付款资料</template>
      </p>
      <p class="settle-hint">
        以上合计不代表公司已回款，也不表示归档校验已通过。
      </p>
      <p class="settle-total" data-test="payment-total">
        当前表单已付款合计{{
          records.length ? '（含新增待保存）' : ''
        }}：<template v-if="paymentTotal !== null"
          >{{ formatPaymentCents(paymentTotal) }} 元</template
        ><template v-else>待完善，请核对付款资料</template>
      </p>
    </div>

    <section v-if="source.refund">
      <h3>诉讼退费</h3>
      <p>
        当前完整性：{{
          source.refund.completeness === 'COMPLETE'
            ? '已确认完整'
            : source.refund.completeness === 'NOT_APPLICABLE'
              ? '无诉讼退费（0元）'
              : '待确认'
        }}
      </p>
      <ul>
        <li v-for="item in source.refund.items" :key="item.itemId">
          {{ item.party === 'COURT' ? '法院' : '被告' }}：{{ item.description }}
          /
          {{
            item.amount === undefined ||
            item.amount === null ||
            item.amount === ''
              ? '待确认'
              : `${item.amount}元`
          }}
          /
          {{
            refundStatuses.find((status) => status.value === item.status)?.label
          }}
        </li>
      </ul>
      <select v-model="refundKind" aria-label="退费操作">
        <option value="KEEP">保留原清单</option>
        <option value="RECORD">登记清单</option>
        <option value="CONFIRM_COMPLETE" :disabled="!source.refund.versionId">
          确认已登记完整
        </option>
        <option value="DECLARE_NOT_APPLICABLE">无诉讼退费（0元）</option>
      </select>
      <template v-if="refundKind === 'RECORD'">
        <fieldset v-for="item in refundItems" :key="item.itemId">
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
          <input v-model="item.description" aria-label="退费说明" />
          <button
            type="button"
            data-test="remove-refund"
            @click="
              refundItems = refundItems.filter(
                (row) => row.itemId !== item.itemId,
              )
            "
          >
            移除此项（生成新清单，保留历史）
          </button>
        </fieldset>
        <button type="button" @click="addRefund">新增退费</button>
      </template>
    </section>
    <p v-else>尚未取得诉讼退费清单及版本，不能推定不涉及。</p>
    <label v-if="source.settlement" class="settle-field">
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

    <p class="settle-note">
      客户金额按「结算条件」公式自动计算；律师金额按「律师协议」（模式/基础费/分成）自动计算。点击「保存」记录结算、付款与退费状态，案件停留在待归档。
    </p>
    <div class="settle-footer">
      <button type="button" data-test="cancel" @click="emit('cancel')">
        取消
      </button>
      <button type="submit" :disabled="settlementAmountMissing">保存</button>
    </div>
  </form>
</template>
<style scoped>
.settlement-update {
  display: grid;
  gap: 12px;
  color: var(--el-text-color-primary);
}
.settlement-update h2,
.settlement-update h3,
.settlement-update p {
  margin: 0;
}
.settlement-update label {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* 两列对齐的结算卡：不改结构，只收紧排版。 */
.settle-card {
  display: grid;
  gap: 16px;
}
.settle-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 20px;
}
.settle-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.settle-field > span {
  font-size: 12px;
  color: #606266;
}
.settle-inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.settle-inline input[readonly] {
  background: #f5f7fa;
}
.settle-legacy {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #ebeef5;
}
.settle-hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
}
.settle-check {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: #606266;
}
.settle-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.settle-file {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  max-width: 240px;
  padding: 6px 10px;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
}
.settle-upload {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  height: 32px;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
  border: 1px dashed #c0c4cc;
  border-radius: 4px;
}
.settle-upload input {
  display: none;
}
.settle-original {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #606266;
}
.settle-total {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.settle-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #909399;
}
.settle-error {
  margin: 0;
  color: #f56c6c;
}
.settle-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}
</style>
