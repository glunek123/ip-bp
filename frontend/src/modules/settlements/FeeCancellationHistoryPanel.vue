<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import {
  ElSelect,
  ElOption,
} from 'element-plus/es/components/select/index.mjs';
import { ApiError } from '../../api/http';
import {
  listFeeCancellations,
  getFeeHistory,
  verifyCancelledFeePayment,
  reconcileCancelledFeeRefund,
  type CancelledFee,
  type FeeHistory,
} from '../../api/fee-cancellations';
import { downloadMaterialVersion } from '../../api/materials';
import { uploadMaterialFile } from '../../api/materials';
import MaterialPreviewDialog from '../../app/MaterialPreviewDialog.vue';
import { useAuthStore } from '../../stores/auth';
import {
  loadFinancialPending,
  storeFinancialPending,
  clearFinancialPending,
  isPendingFeePaymentVerification,
  isPendingFeeRefund,
} from './financial-pending';
const auth = useAuthStore();
const scope = () =>
  `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:fee:${props.caseId ?? 'center'}`;
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}:${props.caseId ?? 'center'}`,
);
type PaymentCommand = {
  feeId: string;
  body: {
    amount: string;
    paymentDate: string | null;
    proofMaterialId: string | null;
    proofContentVersionId: string | null;
    idempotencyKey: string;
  };
};
type RefundCommand = {
  feeId: string;
  body: {
    amount: string;
    refundDate: string;
    proofMaterialId: string | null;
    proofContentVersionId: string | null;
    idempotencyKey: string;
  };
};
const props = withDefaults(
  defineProps<{ caseId?: string; canUpdate?: boolean }>(),
  { canUpdate: false },
);
const items = ref<CancelledFee[]>([]);
const history = ref<FeeHistory | null>(null);
const loading = ref(false);
const error = ref('');
const businessNo = ref('');
const type = ref('');
const page = ref(1);
const total = ref(0);
const typeList = [
  '诉讼费',
  '保全费',
  '保全保费',
  '公告费',
  '调档费',
  '调查费',
  '公证费',
  '披露费',
  '样品费',
  '样品费退款',
  '退货运费',
  '律师费',
  '诉讼退费',
  '其他',
];
const amount = ref('');
const date = ref('');
const refundAmount = ref('');
const refundDate = ref('');
const busy = ref(false);
const paymentProof = ref<{
  materialId: string;
  contentVersionId: string;
} | null>(null);
const refundProof = ref<{
  materialId: string;
  contentVersionId: string;
} | null>(null);
const paymentProofInput = ref<InstanceType<
  typeof globalThis.HTMLInputElement
> | null>(null);
const refundProofInput = ref<InstanceType<
  typeof globalThis.HTMLInputElement
> | null>(null);
const pendingPayment = ref<PaymentCommand | null>(null);
const pendingRefund = ref<RefundCommand | null>(null);
const unknownWrite = ref<'payment' | 'refund' | null>(null);
const verifyingCurrentRefund = computed(
  () =>
    unknownWrite.value === 'refund' &&
    pendingRefund.value?.feeId === history.value?.id,
);
const previewMaterial = ref<{
  id: string;
  version: string;
  filename: string;
} | null>(null);
let revision = 0;
let controller: AbortController | null = null;
function label(v: string | null | undefined) {
  return (
    (
      {
        NOT_REQUIRED: '无需退款核对',
        PAYMENT_UNVERIFIED: '收付待核对',
        NO_PAYMENT: '已核实未发生收付',
        REFUND_PENDING: '待退款',
        PARTIAL_REFUND: '部分退款',
        REFUND_RECORDED: '退款已记录',
        DELETED: '已取消',
        VOIDED: '已作废',
        PENDING: '待核退款',
      } as Record<string, string>
    )[v ?? ''] ?? '待核对'
  );
}
function msg(e: unknown) {
  return e instanceof ApiError ? e.message : '请求失败；请刷新并核对记录。';
}
async function load(): Promise<number | null> {
  const rev = ++revision;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  history.value = null;
  try {
    const r = await listFeeCancellations(
      {
        page: page.value,
        pageSize: 50,
        caseId: props.caseId,
        businessNo: businessNo.value,
        type: type.value,
      },
      { signal: controller.signal },
    );
    if (rev !== revision) return null;
    items.value = r.items;
    total.value = r.total;
    return rev;
  } catch (e) {
    if (rev === revision) {
      items.value = [];
      error.value = msg(e);
    }
    return null;
  } finally {
    if (rev === revision) loading.value = false;
  }
}
async function open(row: CancelledFee) {
  const rev = ++revision;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const r = await getFeeHistory(row.id, { signal: controller.signal });
    if (rev === revision) {
      history.value = r;
      try {
        pendingPayment.value = loadFinancialPending(
          scope(),
          'fee-payment',
          isPendingFeePaymentVerification,
        );
        pendingRefund.value = loadFinancialPending(
          scope(),
          'fee-refund',
          isPendingFeeRefund,
        );
        unknownWrite.value =
          pendingPayment.value?.feeId === row.id
            ? 'payment'
            : pendingRefund.value?.feeId === row.id
              ? 'refund'
              : null;
      } catch (e) {
        error.value = msg(e);
      }
    }
  } catch (e) {
    if (rev === revision) error.value = msg(e);
  } finally {
    if (rev === revision) loading.value = false;
  }
}
async function save(kind: 'payment' | 'refund') {
  if (!history.value || !props.canUpdate) return;
  busy.value = true;
  error.value = '';
  const row = history.value;
  const originalIdentity = identity.value;
  const originalScope = scope();
  if (
    (pendingPayment.value && pendingPayment.value.feeId !== row.id) ||
    (pendingRefund.value && pendingRefund.value.feeId !== row.id)
  ) {
    error.value =
      '另一笔费用的核对请求尚未确认，请先打开该笔取消记录并核实结果。';
    busy.value = false;
    return;
  }
  try {
    if (kind === 'payment') {
      pendingPayment.value ??= {
        feeId: row.id,
        body: {
          amount: amount.value,
          paymentDate:
            amount.value === '0' || amount.value === '0.00'
              ? null
              : date.value || null,
          proofMaterialId: paymentProof.value?.materialId ?? null,
          proofContentVersionId: paymentProof.value?.contentVersionId ?? null,
          idempotencyKey: globalThis.crypto.randomUUID(),
        },
      };
      const original = pendingPayment.value;
      storeFinancialPending(originalScope, 'fee-payment', original);
      await verifyCancelledFeePayment(original.feeId, original.body);
      if (identity.value !== originalIdentity) return;
      clearFinancialPending(originalScope, 'fee-payment', original);
      pendingPayment.value = null;
    } else {
      pendingRefund.value ??= {
        feeId: row.id,
        body: {
          amount: refundAmount.value,
          refundDate: refundDate.value,
          proofMaterialId: refundProof.value?.materialId ?? null,
          proofContentVersionId: refundProof.value?.contentVersionId ?? null,
          idempotencyKey: globalThis.crypto.randomUUID(),
        },
      };
      const original = pendingRefund.value;
      storeFinancialPending(originalScope, 'fee-refund', original);
      await reconcileCancelledFeeRefund(original.feeId, original.body);
      if (identity.value !== originalIdentity) return;
      clearFinancialPending(originalScope, 'fee-refund', original);
      pendingRefund.value = null;
    }
    unknownWrite.value = null;
    const refreshedRevision = await load();
    if (
      refreshedRevision === null ||
      revision !== refreshedRevision ||
      identity.value !== originalIdentity
    )
      return;
    const refreshedRow = items.value.find((item) => item.id === row.id);
    if (!refreshedRow || !props.canUpdate) {
      history.value = null;
      return;
    }
    await open(refreshedRow);
  } catch (e) {
    if (identity.value !== originalIdentity) return;
    error.value = msg(e);
    if (
      e instanceof ApiError &&
      [400, 401, 403, 404, 409, 413, 415, 422].includes(e.status)
    ) {
      if (kind === 'payment' && pendingPayment.value) {
        clearFinancialPending(
          originalScope,
          'fee-payment',
          pendingPayment.value,
        );
        pendingPayment.value = null;
      }
      if (kind === 'refund' && pendingRefund.value) {
        clearFinancialPending(originalScope, 'fee-refund', pendingRefund.value);
        pendingRefund.value = null;
      }
      unknownWrite.value = null;
    } else unknownWrite.value = kind;
  } finally {
    if (identity.value === originalIdentity) busy.value = false;
  }
}
async function uploadProof(
  kind: 'payment' | 'refund',
  event: { target: unknown },
) {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !history.value) return;
  const row = history.value;
  const originalIdentity = identity.value;
  const ctx = `${originalIdentity}:${row.id}`;
  busy.value = true;
  try {
    const r = await uploadMaterialFile({
      ownerType: 'CASE',
      ownerId: row.caseId,
      category: 'FEE_PROOF',
      purpose: 'FEE_PROOF',
      file,
    });
    if (ctx !== `${identity.value}:${history.value?.id ?? ''}`) return;
    const pair = {
      materialId: r.materialId,
      contentVersionId: r.contentVersionId,
    };
    if (kind === 'payment') paymentProof.value = pair;
    else refundProof.value = pair;
  } catch (e) {
    if (identity.value === originalIdentity) error.value = msg(e);
  } finally {
    if (identity.value === originalIdentity) busy.value = false;
  }
}
async function preview(material: string | null, version: string | null) {
  if (!material || !version) return;
  previewMaterial.value = { id: material, version, filename: '费用核对凭证' };
}
async function download(material: string | null, version: string | null) {
  if (!material || !version) return;
  const originalIdentity = identity.value;
  try {
    await downloadMaterialVersion(material, version, controller?.signal);
  } catch (e) {
    if (identity.value === originalIdentity) error.value = msg(e);
  }
}
watch(
  [identity, () => props.caseId],
  () => {
    revision++;
    controller?.abort();
    items.value = [];
    history.value = null;
    paymentProof.value = null;
    refundProof.value = null;
    pendingPayment.value = null;
    pendingRefund.value = null;
    unknownWrite.value = null;
    previewMaterial.value = null;
    busy.value = false;
    page.value = 1;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  revision++;
  controller?.abort();
});
</script>
<template>
  <section class="fee-cancellation-history" aria-label="取消费用历史">
    <h3>取消／作废记录</h3>
    <p>
      核对状态仅描述本笔费用的人工记录，不代表案件或账单已结清。未知金额显示为待核对。
    </p>
    <form
      class="operation-bar"
      @submit.prevent="
        page = 1;
        load();
      "
    >
      <label
        >案件编号<ElInput
          v-model="businessNo"
          placeholder="输入案件编号" /></label
      ><label
        >费用类型<ElSelect v-model="type" clearable placeholder="全部类型"
          ><ElOption
            v-for="v in typeList"
            :key="v"
            :value="v"
            :label="v" /></ElSelect></label
      ><ElButton native-type="submit">查询</ElButton
      ><ElButton
        @click="
          businessNo = '';
          type = '';
          page = 1;
          load();
        "
        >清除</ElButton
      >
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading">正在读取取消记录…</p>
    <p v-else-if="!items.length">暂无取消／作废记录</p>
    <div v-else class="fee-cancellation-history__table-scroll">
      <table class="fee-cancellation-history__table">
        <thead>
          <tr>
            <th>案号</th>
            <th>费用</th>
            <th>原状态／金额</th>
            <th>处理</th>
            <th>退款核对</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id">
            <td>{{ row.businessNo }}</td>
            <td>{{ row.type }}</td>
            <td>{{ row.status }}／{{ row.amount }}</td>
            <td>
              {{ label(row.cancellation?.outcome) }} ·
              {{ row.cancellation?.reason }}
            </td>
            <td>
              {{ label(row.cancellation?.reconciliationStatus) }} · 余额
              {{ row.cancellation?.remainingVerifiedPayment ?? '待核对' }}
            </td>
            <td><ElButton link @click="open(row)">查看历史</ElButton></td>
          </tr>
        </tbody>
      </table>
    </div>
    <section
      v-if="history"
      class="fee-cancellation-history__detail"
      aria-label="费用核对详情"
    >
      <h4 class="fee-cancellation-history__detail-title">
        {{ history.businessNo }} · {{ history.type }} ·
        {{ label(history.cancellation?.reconciliationStatus) }}
      </h4>
      <dl class="fee-cancellation-history__facts">
        <div>
          <dt>原费用</dt>
          <dd>
            {{ history.cancellation?.originalAmount ?? history.amount }}（{{
              history.cancellation?.originalStatus ?? history.status
            }}）<br />原因：{{ history.cancellation?.reason ?? '尚未作废' }}
          </dd>
        </div>
        <div>
          <dt>
            {{ history.direction === '收入' ? '原实收核实' : '原实付核实' }}
          </dt>
          <dd>
            {{ history.paymentVerification?.amount ?? '待核对' }} · 日期：{{
              history.paymentVerification?.paymentDate ?? '待核对'
            }}
            <div
              v-if="history.paymentVerification?.proofMaterialId"
              class="fee-cancellation-history__proof-actions"
            >
              <ElButton
                link
                @click="
                  preview(
                    history.paymentVerification.proofMaterialId,
                    history.paymentVerification.proofContentVersionId,
                  )
                "
                >预览收付凭证</ElButton
              >
              <ElButton
                link
                @click="
                  download(
                    history.paymentVerification.proofMaterialId,
                    history.paymentVerification.proofContentVersionId,
                  )
                "
                >下载收付凭证</ElButton
              >
            </div>
            <p class="fee-cancellation-history__remaining">
              核实后剩余收付：{{ history.remainingVerifiedPayment ?? '待核对' }}
            </p>
          </dd>
        </div>
        <div>
          <dt>退款明细</dt>
          <dd>
            <p
              v-if="!history.refunds.length"
              class="fee-cancellation-history__empty"
            >
              暂无
            </p>
            <ul v-else class="fee-cancellation-history__refunds">
              <li v-for="refund in history.refunds" :key="refund.id">
                <span>{{ refund.refundDate }} · {{ refund.amount }} 元</span>
                <span
                  v-if="refund.proofMaterialId"
                  class="fee-cancellation-history__proof-actions"
                >
                  <ElButton
                    link
                    @click="
                      preview(
                        refund.proofMaterialId,
                        refund.proofContentVersionId,
                      )
                    "
                    >预览凭证</ElButton
                  >
                  <ElButton
                    link
                    @click="
                      download(
                        refund.proofMaterialId,
                        refund.proofContentVersionId,
                      )
                    "
                    >下载凭证</ElButton
                  >
                </span>
              </li>
            </ul>
          </dd>
        </div>
      </dl>
      <div
        v-if="canUpdate && history.cancellation?.outcome === 'VOIDED'"
        class="fee-cancellation-history__actions"
      >
        <section class="fee-cancellation-history__action">
          <h5>核实实际收付</h5>
          <div class="fee-cancellation-history__form-grid">
            <label>
              {{
                history.direction === '收入' ? '实际收款金额' : '实际付款金额'
              }}（0 表示已核实未发生收付）
              <ElInput v-model="amount" />
            </label>
            <label>
              收付日期（金额大于0必填）
              <ElInput v-model="date" type="date" />
            </label>
            <div class="fee-cancellation-history__file-picker">
              <span>收付凭证（可选）</span>
              <ElButton
                native-type="button"
                :disabled="busy"
                @click="paymentProofInput?.click()"
                >上传凭证</ElButton
              >
              <input
                ref="paymentProofInput"
                class="fee-cancellation-history__visually-hidden"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                aria-label="收付凭证（可选）"
                :disabled="busy"
                @change="uploadProof('payment', $event)"
              />
              <small v-if="paymentProof">已上传并绑定精确版本</small>
            </div>
          </div>
          <ElButton
            :disabled="busy || history.paymentVerification !== null"
            @click="save('payment')"
            >{{
              unknownWrite === 'payment'
                ? '核实收付结果／重试原请求'
                : '保存收付核对'
            }}</ElButton
          >
        </section>
        <section class="fee-cancellation-history__action">
          <h5>记录一笔退款</h5>
          <p v-if="verifyingCurrentRefund" data-test="locked-refund-request">
            正在核实原请求：{{ pendingRefund?.body.amount }} 元，退款日期
            {{ pendingRefund?.body.refundDate }}。原请求内容已锁定。
          </p>
          <div v-else class="fee-cancellation-history__form-grid">
            <label>
              退款金额
              <ElInput v-model="refundAmount" />
            </label>
            <label>
              实际退款日期
              <ElInput v-model="refundDate" type="date" />
            </label>
            <div class="fee-cancellation-history__file-picker">
              <span>退款凭证（可选）</span>
              <ElButton
                native-type="button"
                :disabled="busy"
                @click="refundProofInput?.click()"
                >上传凭证</ElButton
              >
              <input
                ref="refundProofInput"
                class="fee-cancellation-history__visually-hidden"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                aria-label="退款凭证（可选）"
                :disabled="busy"
                @change="uploadProof('refund', $event)"
              />
              <small v-if="refundProof">已上传并绑定精确版本</small>
            </div>
          </div>
          <ElButton
            :disabled="
              busy ||
              (!verifyingCurrentRefund &&
                (!history.paymentVerification || !refundAmount || !refundDate))
            "
            @click="save('refund')"
            >{{
              unknownWrite === 'refund'
                ? '核实退款结果／重试原请求'
                : '记录退款'
            }}</ElButton
          >
        </section>
      </div>
    </section>
    <MaterialPreviewDialog
      v-if="previewMaterial"
      :material-id="previewMaterial.id"
      :content-version-id="previewMaterial.version"
      :filename="previewMaterial.filename"
      :scope-key="identity"
      @close="previewMaterial = null"
      @unavailable="error = '凭证不可访问或已不存在'"
    />
  </section>
</template>

<style scoped>
.fee-cancellation-history {
  min-width: 0;
}
.fee-cancellation-history__table-scroll {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.fee-cancellation-history__table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  background: var(--color-surface-1);
  font-size: 13px;
}
.fee-cancellation-history__table th,
.fee-cancellation-history__table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-hairline);
  text-align: left;
  vertical-align: top;
}
.fee-cancellation-history__table th {
  background: var(--color-surface-2);
  color: var(--color-ink-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.fee-cancellation-history__table td:last-child {
  white-space: nowrap;
}
.fee-cancellation-history__detail {
  display: grid;
  gap: var(--s-4);
  margin-top: var(--s-5);
  padding-top: var(--s-4);
  border-top: 1px solid var(--color-hairline-strong);
}
.fee-cancellation-history__detail-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.fee-cancellation-history__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-4);
  margin: 0;
}
.fee-cancellation-history__facts > div {
  min-width: 0;
  padding-inline-end: var(--s-3);
  border-inline-end: 1px solid var(--color-hairline);
}
.fee-cancellation-history__facts > div:last-child {
  padding-inline-end: 0;
  border-inline-end: 0;
}
.fee-cancellation-history__facts dt {
  margin-bottom: var(--s-1);
  color: var(--color-ink-muted);
  font-size: 12px;
  font-weight: 600;
}
.fee-cancellation-history__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.fee-cancellation-history__proof-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--s-2);
}
.fee-cancellation-history__remaining,
.fee-cancellation-history__empty {
  margin: var(--s-2) 0 0;
}
.fee-cancellation-history__refunds {
  display: grid;
  gap: var(--s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.fee-cancellation-history__refunds li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-1) var(--s-2);
}
.fee-cancellation-history__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
  padding-top: var(--s-3);
  border-top: 1px solid var(--color-hairline);
}
.fee-cancellation-history__action {
  display: grid;
  align-content: start;
  gap: var(--s-2);
  min-width: 0;
}
.fee-cancellation-history__action h5 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.fee-cancellation-history__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: var(--s-2) var(--s-3);
}
.fee-cancellation-history__form-grid > label {
  display: grid;
  gap: var(--s-1);
  min-width: 0;
  color: var(--color-ink-muted);
  font-size: 12px;
}
.fee-cancellation-history__file-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-1) var(--s-2);
  min-width: 0;
  color: var(--color-ink-muted);
  font-size: 12px;
}
.fee-cancellation-history__file-picker small {
  flex-basis: 100%;
}
.fee-cancellation-history__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
@media (max-width: 920px) {
  .fee-cancellation-history__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fee-cancellation-history__facts > div:nth-child(2) {
    padding-inline-end: 0;
    border-inline-end: 0;
  }
  .fee-cancellation-history__facts > div:last-child {
    grid-column: 1 / -1;
    padding-top: var(--s-3);
    border-top: 1px solid var(--color-hairline);
  }
}
@media (max-width: 680px) {
  .fee-cancellation-history__facts,
  .fee-cancellation-history__actions {
    grid-template-columns: minmax(0, 1fr);
  }
  .fee-cancellation-history__facts > div,
  .fee-cancellation-history__facts > div:nth-child(2) {
    padding: 0 0 var(--s-3);
    border: 0;
    border-bottom: 1px solid var(--color-hairline);
  }
  .fee-cancellation-history__facts > div:last-child {
    grid-column: auto;
    padding: 0;
    border: 0;
  }
}
</style>
