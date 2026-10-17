<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import {
  ElSelect,
  ElOption,
} from 'element-plus/es/components/select/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCaseSettlement,
  launchSettlement,
  updateCaseSettlementTerms,
  type CaseSettlement,
  type LawyerSettlementMode,
  type SettlementSide,
} from '../../api/settlements';
import { todayShanghai } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import { previewSettlement, roundManualSettlement } from './settlement-preview';
import {
  loadFinancialPending,
  storeFinancialPending,
  clearFinancialPending,
  isPendingTerms,
  isPendingLaunch,
} from './financial-pending';
const props = withDefaults(
  defineProps<{ caseId: string; canUpdate?: boolean; canLaunch?: boolean }>(),
  { canUpdate: false, canLaunch: false },
);
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}:${props.caseId}`,
);
const pendingScope = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${props.caseId}`,
);
const detail = ref<CaseSettlement | null>(null);
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const error = ref('');
const notice = ref('');
const saving = ref(false);
const side = ref<SettlementSide>('CUSTOMER');
const formula = ref('');
const mode = ref<LawyerSettlementMode>('FULL_RISK');
const baseFee = ref('0');
const split = ref('30');
const draftAmount = ref('');
const launchAmount = ref('');
const launchDate = ref(todayShanghai());
const launchNote = ref('');
const lawyerId = ref('');
let hydrating = false;
let revision = 0;
let request: AbortController | null = null;
let pendingTerms: Parameters<typeof updateCaseSettlementTerms>[1] | null = null;
let pendingLaunch: Parameters<typeof launchSettlement>[1] | null = null;
const unknownTerms = ref(false);
const unknownLaunch = ref(false);
const uncertain = computed(() => unknownTerms.value || unknownLaunch.value);
const amount = computed(() =>
  side.value === 'CUSTOMER'
    ? detail.value?.figures.customerAmount
    : detail.value?.figures.lawyerAmount,
);
const balance = computed(() =>
  side.value === 'CUSTOMER'
    ? detail.value?.customerBalance
    : detail.value?.lawyerBalance,
);
const preview = computed(() =>
  previewSettlement(detail.value?.figures.basis ?? null, side.value, {
    formula: formula.value,
    mode: mode.value,
    baseFee: baseFee.value,
    splitPercent: split.value,
  }),
);
const sideLaunches = computed(
  () => detail.value?.launches.filter((row) => row.side === side.value) ?? [],
);
const nextNth = computed(
  () => Math.max(0, ...sideLaunches.value.map((row) => row.nth)) + 1,
);
const canLaunch = computed(
  () =>
    props.canLaunch &&
    detail.value?.stage === 'WAITING_ARCHIVE' &&
    amount.value !== null &&
    amount.value !== undefined &&
    balance.value?.remaining != null &&
    !/^0(?:\.0+)?$/u.test(balance.value.remaining) &&
    (side.value === 'CUSTOMER' || detail.value.lawyers.length > 0),
);
const manual = computed(() => {
  if (draftAmount.value === '' || draftAmount.value === preview.value.amount)
    return false;
  try {
    return roundManualSettlement(draftAmount.value) !== preview.value.amount;
  } catch {
    return true;
  }
});
function message(cause: unknown): string {
  return cause instanceof ApiError
    ? cause.message
    : cause instanceof Error
      ? cause.message
      : '操作失败，请稍后重试';
}
function rejected(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    [400, 401, 403, 404, 409, 413, 415, 422].includes(cause.status)
  );
}
function syncSide(): void {
  if (!detail.value) return;
  draftAmount.value =
    pendingTerms?.side === side.value
      ? (pendingTerms.manualAmount ?? preview.value.amount ?? '')
      : (amount.value ?? '');
  launchAmount.value =
    pendingLaunch?.side === side.value
      ? pendingLaunch.amount
      : (balance.value?.remaining ?? '');
  if (pendingLaunch?.side === side.value) {
    launchDate.value = pendingLaunch.launchDate;
    launchNote.value = pendingLaunch.note ?? '';
  }
  lawyerId.value =
    detail.value.lawyers.length === 1 ? detail.value.lawyers[0]!.id : '';
  if (pendingLaunch?.side === 'LAWYER')
    lawyerId.value = pendingLaunch.lawyerId ?? '';
}
watch(
  [formula, mode, baseFee, split],
  () => {
    if (hydrating || uncertain.value) return;
    hydrating = true;
    if (mode.value === 'FULL_RISK') {
      baseFee.value = '0';
      if (/^0(?:\.0+)?$/u.test(split.value)) split.value = '30';
    }
    hydrating = false;
    draftAmount.value = preview.value.amount ?? '';
  },
  { flush: 'sync' },
);
watch(side, syncSide);
async function load(): Promise<void> {
  const current = ++revision;
  request?.abort();
  request = new AbortController();
  state.value = 'loading';
  error.value = '';
  try {
    const next = await getCaseSettlement(props.caseId, {
      signal: request.signal,
    });
    if (current !== revision) return;
    detail.value = next;
    hydrating = true;
    formula.value =
      pendingTerms?.customerFormula ?? next.terms?.customerFormula ?? '';
    mode.value =
      pendingTerms?.lawyerMode ?? next.terms?.lawyerMode ?? 'FULL_RISK';
    baseFee.value =
      pendingTerms?.lawyerBaseFee ?? next.terms?.lawyerBaseFee ?? '0';
    split.value =
      pendingTerms?.lawyerSplitPercent ??
      next.terms?.lawyerSplitPercent ??
      '30';
    hydrating = false;
    syncSide();
    state.value = 'ready';
  } catch (cause) {
    if (current === revision) {
      state.value = 'failed';
      error.value = message(cause);
    }
  }
}
watch(
  identity,
  async () => {
    pendingTerms = null;
    pendingLaunch = null;
    unknownTerms.value = false;
    unknownLaunch.value = false;
    notice.value = '';
    saving.value = false;
    detail.value = null;
    let recoveryError = '';
    const scope = pendingScope.value;
    try {
      pendingTerms = loadFinancialPending(scope, 'terms', isPendingTerms);
      pendingLaunch = loadFinancialPending(scope, 'launch', isPendingLaunch);
      unknownTerms.value = pendingTerms !== null;
      unknownLaunch.value = pendingLaunch !== null;
      if (pendingTerms) side.value = pendingTerms.side;
      if (pendingLaunch) side.value = pendingLaunch.side;
    } catch (cause) {
      recoveryError = message(cause);
    }
    await load();
    if (scope === pendingScope.value && recoveryError)
      error.value = recoveryError;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  revision += 1;
  request?.abort();
});
async function saveTerms(): Promise<void> {
  if (!detail.value || saving.value || !props.canUpdate || unknownLaunch.value)
    return;
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  saving.value = true;
  error.value = '';
  try {
    if (pendingTerms === null) {
      if (preview.value.error) throw new Error(preview.value.error);
      const manualAmount = manual.value
        ? roundManualSettlement(draftAmount.value)
        : null;
      const common = {
        expectedTermsVersion: detail.value.termsVersion,
        side: side.value,
        manualAmount,
        idempotencyKey: globalThis.crypto.randomUUID(),
      };
      pendingTerms =
        side.value === 'CUSTOMER'
          ? { ...common, customerFormula: formula.value }
          : {
              ...common,
              lawyerMode: mode.value,
              lawyerBaseFee: mode.value === 'FULL_RISK' ? '0' : baseFee.value,
              lawyerSplitPercent: split.value,
            };
    }
    storeFinancialPending(scope, 'terms', pendingTerms);
    submitted = true;
    const original = pendingTerms;
    await updateCaseSettlementTerms(props.caseId, original);
    if (originalIdentity !== identity.value) return;
    clearFinancialPending(scope, 'terms', original);
    pendingTerms = null;
    unknownTerms.value = false;
    notice.value = '本案结算条件已保存';
    await load();
  } catch (cause) {
    if (originalIdentity !== identity.value) return;
    if (rejected(cause) && pendingTerms)
      clearFinancialPending(scope, 'terms', pendingTerms);
    if (rejected(cause) || !submitted) pendingTerms = null;
    unknownTerms.value = pendingTerms !== null;
    error.value = message(cause);
  } finally {
    if (originalIdentity === identity.value) saving.value = false;
  }
}
async function launch(): Promise<void> {
  if (
    !detail.value ||
    saving.value ||
    !props.canLaunch ||
    unknownTerms.value ||
    (pendingLaunch === null && !canLaunch.value)
  )
    return;
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  saving.value = true;
  error.value = '';
  pendingLaunch ??= {
    side: side.value,
    amount: launchAmount.value,
    launchDate: launchDate.value,
    note: launchNote.value,
    expectedTermsVersion: detail.value.termsVersion,
    ...(side.value === 'LAWYER' ? { lawyerId: lawyerId.value } : {}),
    idempotencyKey: globalThis.crypto.randomUUID(),
  };
  try {
    storeFinancialPending(scope, 'launch', pendingLaunch);
    submitted = true;
    const original = pendingLaunch;
    const result = await launchSettlement(props.caseId, original);
    if (originalIdentity !== identity.value) return;
    clearFinancialPending(scope, 'launch', original);
    pendingLaunch = null;
    unknownLaunch.value = false;
    launchNote.value = '';
    notice.value = `第${result.nth}次结算已发起，金额${result.amount}元`;
    await load();
  } catch (cause) {
    if (originalIdentity !== identity.value) return;
    if (rejected(cause) && pendingLaunch)
      clearFinancialPending(scope, 'launch', pendingLaunch);
    if (rejected(cause) || !submitted) pendingLaunch = null;
    unknownLaunch.value = pendingLaunch !== null;
    error.value = message(cause);
  } finally {
    if (originalIdentity === identity.value) saving.value = false;
  }
}
</script>

<template>
  <section class="case-settlement">
    <h2>案件结算</h2>
    <p v-if="state === 'loading'">正在读取结算条件…</p>
    <p v-else-if="state === 'failed'" role="alert">
      {{ error }}<ElButton @click="load">重试</ElButton>
    </p>
    <template v-else-if="detail">
      <p>
        {{ detail.businessNo }} · {{ detail.customer.name }} ·
        <RouterLink to="/settlements">前往结算中心</RouterLink>
      </p>
      <div role="tablist" aria-label="结算侧别">
        <ElButton
          role="tab"
          :aria-selected="side === 'CUSTOMER'"
          :disabled="uncertain || saving"
          @click="side = 'CUSTOMER'"
          >客户结算</ElButton
        ><ElButton
          role="tab"
          :aria-selected="side === 'LAWYER'"
          :disabled="uncertain || saving"
          @click="side = 'LAWYER'"
          >律师结算</ElButton
        >
      </div>
      <p>
        结案基数：{{ detail.figures.basis ?? '待定' }} 元；当前保存金额：{{
          amount ?? '待定'
        }}
        元。
      </p>
      <p>
        已发起：{{ balance?.launched }} 元；可发起余额：{{
          balance?.remaining ?? '待定'
        }}
        元。
      </p>
      <p v-if="balance?.overLaunched" role="alert">
        当前保存金额低于历史已发起额。历史记录保留，当前不能继续发起。
      </p>
      <form v-if="props.canUpdate" @submit.prevent="saveTerms">
        <label v-if="side === 'CUSTOMER'"
          >客户结算条件<ElInput
            v-model="formula"
            :disabled="uncertain || saving"
            placeholder="客户结算金额=结案金额×70%"
        /></label>
        <template v-else>
          <label
            >律师结算模式<ElSelect
              v-model="mode"
              :disabled="uncertain || saving"
              ><ElOption value="FULL_RISK" label="全风险" /><ElOption
                value="HALF_RISK"
                label="半风险" /><ElOption
                value="FIXED_FEE"
                label="固定费用" /></ElSelect
          ></label>
          <label
            >基础费（元）<ElInput
              v-model="baseFee"
              inputmode="decimal"
              :disabled="mode === 'FULL_RISK' || uncertain || saving"
          /></label>
          <label
            >分成比例（%）<ElInput
              v-model="split"
              inputmode="decimal"
              :disabled="mode === 'FIXED_FEE' || uncertain || saving"
          /></label>
        </template>
        <label
          >{{ side === 'CUSTOMER' ? '客户' : '律师' }}结算金额（元）<ElInput
            v-model="draftAmount"
            inputmode="decimal"
            :disabled="uncertain || saving"
            placeholder="待定，可手工填写"
        /></label>
        <p v-if="preview.error" role="alert">{{ preview.error }}</p>
        <p v-else>
          试算金额：{{ preview.amount ?? '待定' }} 元；{{
            manual ? '将按手工调整值保存' : '按公式自动计算'
          }}。修改条款后自动重新试算。
        </p>
        <ElButton
          native-type="submit"
          :disabled="saving || unknownLaunch || !!preview.error"
          >{{
            unknownTerms ? '用原请求重试保存' : '保存本案结算条件'
          }}</ElButton
        >
      </form>
      <form v-if="canLaunch || unknownLaunch" @submit.prevent="launch">
        <h3>
          发起第 {{ nextNth }} 次{{ side === 'CUSTOMER' ? '客户' : '律师' }}结算
        </h3>
        <label v-if="side === 'LAWYER'"
          >结算律师<ElSelect v-model="lawyerId" :disabled="uncertain || saving"
            ><ElOption
              v-for="lawyer in detail.lawyers"
              :key="lawyer.id"
              :value="lawyer.id"
              :label="
                lawyer.name + (lawyer.firm ? ' / ' + lawyer.firm : '')
              " /></ElSelect
        ></label>
        <label
          >本次金额（元）<ElInput
            v-model="launchAmount"
            inputmode="decimal"
            :disabled="uncertain || saving" /></label
        ><label
          >发起日期<ElInput
            v-model="launchDate"
            type="date"
            :disabled="uncertain || saving" /></label
        ><label
          >备注<ElInput
            v-model="launchNote"
            :maxlength="500"
            :disabled="uncertain || saving"
        /></label>
        <ElButton
          native-type="submit"
          :disabled="saving || unknownTerms || (side === 'LAWYER' && !lawyerId)"
          >{{ unknownLaunch ? '用原请求重试发起' : '发起结算' }}</ElButton
        >
      </form>
      <p v-else-if="!props.canLaunch">当前账号没有发起结算权限。</p>
      <p v-else-if="detail.stage !== 'WAITING_ARCHIVE'">
        当前案件阶段不可发起结算。
      </p>
      <p v-else-if="side === 'LAWYER' && detail.lawyers.length === 0">
        当前案件没有有效主办律师，请先完成律师匹配。
      </p>
      <p v-else>结算条件待补全，或当前余额已发起完毕。</p>
      <p v-if="uncertain" role="alert">
        操作结果尚未确认。请使用原请求重试，核对结果后继续编辑。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <h3>发起记录</h3>
      <p v-if="sideLaunches.length === 0">暂无发起记录</p>
      <table v-else>
        <thead>
          <tr>
            <th>次数</th>
            <th>日期</th>
            <th>金额</th>
            <th>账单</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sideLaunches" :key="row.id">
            <td>{{ row.nth }}</td>
            <td>{{ row.launchDate }}</td>
            <td>{{ row.amount }}</td>
            <td>{{ row.billId ? '已入单' : '未入单' }}</td>
            <td>{{ row.note ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
<style scoped>
.case-settlement {
  display: grid;
  gap: 12px;
  padding: 16px;
  color: var(--color-ink);
}
.case-settlement form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  padding: 12px;
  border: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
}
.case-settlement label {
  display: grid;
  gap: 4px;
  min-width: 160px;
}
.case-settlement button,
.case-settlement input,
.case-settlement select {
  padding: 7px 9px;
  border: 1px solid var(--color-hairline-strong);
  background: var(--color-surface-1);
  color: var(--color-ink);
}
.case-settlement button[aria-selected='true'] {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.case-settlement table {
  border-collapse: collapse;
  width: 100%;
}
.case-settlement td,
.case-settlement th {
  padding: 8px;
  border-bottom: 1px solid var(--color-hairline);
  text-align: left;
}
</style>
