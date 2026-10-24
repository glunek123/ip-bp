<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError } from '../../api/http';
import {
  cancelSettlementBill,
  createSettlementBill,
  getSettlementBill,
  getSettlementContext,
  listSettlementBills,
  listSettlementLaunches,
  type CenterLaunch,
  type Page,
  type SettlementBill,
  type SettlementBillDetail,
  type SettlementSide,
  type SettlementCapabilities,
  type SettlementLaunchPage,
} from '../../api/settlements';
import { useAuthStore } from '../../stores/auth';
import FeeCenterPanel from './FeeCenterPanel.vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import {
  ElSelect,
  ElOption,
} from 'element-plus/es/components/select/index.mjs';
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs';
import { previewSettlementBillNumber } from '../../api/settlements';
import {
  loadFinancialPending,
  storeFinancialPending,
  clearFinancialPending,
  isPendingBill,
  isPendingCancel,
} from './financial-pending';

const tab = ref<'CUSTOMER' | 'LAWYER' | 'FEES'>('CUSTOMER');
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const pendingScope = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:center`,
);
let detailRevision = 0;
const capabilities = ref<SettlementCapabilities | null>(null);
let revision = 0;
let request: AbortController | null = null;
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const page = ref(1);
const billPage = ref(1);
const from = ref('');
const to = ref('');
const billQuery = ref('');
const billHistory = ref('');
const matchingIds = ref<string[]>([]);
const summary = ref<SettlementLaunchPage['summary'] | null>(null);
const billPreview = ref('');
let previewRevision = 0;
const launches = ref<Page<CenterLaunch>>({
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
});
const bills = ref<Page<SettlementBill>>({
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
});
const selected = ref(new Set<string>());
const keyword = ref('');
const stage = ref('');
const billState = ref('');
const billDate = ref(today());
const billNote = ref('');
const detail = ref<SettlementBillDetail | null>(null);
const cancelReason = ref('');
let pendingBill: Parameters<typeof createSettlementBill>[0] | null = null;
let pendingCancel: {
  id: string;
  body: Parameters<typeof cancelSettlementBill>[1];
} | null = null;
const unknownBill = ref(false);
const unknownCancel = ref(false);
function rejected(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    [400, 401, 403, 404, 409, 413, 415, 422].includes(cause.status)
  );
}

function today(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (key: string) =>
    parts.find((value) => value.type === key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function message(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : '操作失败，请稍后重试';
}
const side = computed<SettlementSide>(() =>
  tab.value === 'LAWYER' ? 'LAWYER' : 'CUSTOMER',
);
const visible = computed(() => launches.value.items);
const allSelected = computed(
  () =>
    matchingIds.value.length > 0 &&
    matchingIds.value.every((id) => selected.value.has(id)),
);
const selectedCount = computed(() => selected.value.size);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(launches.value.total / launches.value.pageSize)),
);
const billPageCount = computed(() =>
  Math.max(1, Math.ceil(bills.value.total / bills.value.pageSize)),
);
function applyFilter(): void {
  if (page.value !== 1) page.value = 1;
  else void load();
}
function clearFilter(): void {
  keyword.value = '';
  stage.value = '';
  billState.value = '';
  from.value = '';
  to.value = '';
  applyFilter();
}
async function updatePreview(): Promise<void> {
  const current = ++previewRevision;
  billPreview.value = '';
  if (!capabilities.value?.billCreate || !billDate.value) return;
  try {
    const value = await previewSettlementBillNumber(billDate.value);
    if (current === previewRevision) billPreview.value = value;
  } catch {
    if (current === previewRevision) billPreview.value = '';
  }
}
watch(billDate, updatePreview);

async function load(): Promise<void> {
  if (tab.value === 'FEES' || !capabilities.value?.read) return;
  const expected = ++revision;
  request?.abort();
  request = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const [nextLaunches, nextBills] = await Promise.all([
      listSettlementLaunches(
        side.value,
        page.value,
        {
          signal: request.signal,
        },
        {
          keyword: keyword.value,
          stage: stage.value,
          billed: billState.value,
          from: from.value,
          to: to.value,
        },
      ),
      listSettlementBills(
        side.value,
        billPage.value,
        { signal: request.signal },
        { keyword: billQuery.value, billState: billHistory.value },
      ),
    ]);
    if (expected !== revision) return;
    launches.value = nextLaunches;
    matchingIds.value = nextLaunches.matchingIds;
    summary.value = nextLaunches.summary;
    bills.value = nextBills;
    await updatePreview();
  } catch (cause) {
    if (expected === revision) error.value = message(cause);
  } finally {
    if (expected === revision) loading.value = false;
  }
}
async function initialize(): Promise<void> {
  const expected = ++revision;
  request?.abort();
  request = new AbortController();
  capabilities.value = null;
  selected.value = new Set();
  detail.value = null;
  pendingBill = null;
  pendingCancel = null;
  unknownBill.value = false;
  unknownCancel.value = false;
  summary.value = null;
  matchingIds.value = [];
  billPreview.value = '';
  notice.value = '';
  saving.value = false;
  launches.value = { items: [], total: 0, page: 1, pageSize: 100 };
  bills.value = { items: [], total: 0, page: 1, pageSize: 100 };
  error.value = '';
  try {
    const next = await getSettlementContext({ signal: request.signal });
    if (expected !== revision) return;
    capabilities.value = next;
    if (!next.read && next.feeRead) tab.value = 'FEES';
    if (next.read && !next.feeRead && tab.value === 'FEES')
      tab.value = 'CUSTOMER';
    if (!next.read && !next.feeRead)
      error.value = '当前账号未获结算与费用中心读取权限';
    pendingBill = loadFinancialPending(
      pendingScope.value,
      'bill',
      isPendingBill,
    );
    pendingCancel = loadFinancialPending(
      pendingScope.value,
      'cancel',
      isPendingCancel,
    );
    unknownBill.value = pendingBill !== null;
    unknownCancel.value = pendingCancel !== null;
    if (pendingBill && next.read) {
      tab.value = pendingBill.side;
      selected.value = new Set(pendingBill.launchIds);
      billDate.value = pendingBill.billDate;
      billNote.value = pendingBill.note ?? '';
    }
    await load();
    if (pendingCancel && next.read) {
      const originalIdentity = identity.value;
      const value = await getSettlementBill(pendingCancel.id);
      if (originalIdentity === identity.value) {
        detail.value = value;
        cancelReason.value = pendingCancel.body.reason ?? '';
      }
    }
  } catch (cause) {
    if (expected === revision) error.value = message(cause);
  }
}
watch(tab, () => {
  page.value = 1;
  selected.value = new Set(
    pendingBill?.side === side.value ? pendingBill.launchIds : [],
  );
  detail.value = null;
  billPage.value = 1;
  void load();
});
watch(page, () => {
  void load();
});
watch(billPage, () => {
  void load();
});
watch(identity, initialize, { immediate: true });
onBeforeUnmount(() => {
  revision += 1;
  request?.abort();
});
function toggle(id: string): void {
  const next = new Set(selected.value);
  if (unknownBill.value) return;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function toggleAll(): void {
  const next = new Set(selected.value);
  if (unknownBill.value) return;
  if (allSelected.value) for (const id of matchingIds.value) next.delete(id);
  else for (const id of matchingIds.value) next.add(id);
  selected.value = next;
}
async function createBill(): Promise<void> {
  if (
    saving.value ||
    unknownCancel.value ||
    (pendingBill === null && selected.value.size === 0) ||
    !capabilities.value?.billCreate
  )
    return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  pendingBill ??= {
    side: side.value,
    billDate: billDate.value,
    launchIds: [...selected.value],
    note: billNote.value,
    idempotencyKey: globalThis.crypto.randomUUID(),
  };
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  try {
    storeFinancialPending(scope, 'bill', pendingBill);
    submitted = true;
    const original = pendingBill;
    const result = await createSettlementBill(original);
    if (originalIdentity !== identity.value) return;
    notice.value = `账单 ${result.billNo} 已创建，合计 ${result.amount} 元`;
    clearFinancialPending(scope, 'bill', original);
    pendingBill = null;
    unknownBill.value = false;
    selected.value = new Set();
    billNote.value = '';
    await load();
  } catch (cause) {
    if (originalIdentity !== identity.value) return;
    if (rejected(cause) && pendingBill)
      clearFinancialPending(scope, 'bill', pendingBill);
    if (rejected(cause) || !submitted) pendingBill = null;
    unknownBill.value = pendingBill !== null;
    error.value = message(cause);
  } finally {
    if (originalIdentity === identity.value) saving.value = false;
  }
}
async function viewBill(id: string): Promise<void> {
  if (unknownCancel.value) return;
  error.value = '';
  detail.value = null;
  const current = ++detailRevision;
  try {
    const originalIdentity = identity.value;
    const result = await getSettlementBill(id);
    if (originalIdentity === identity.value && current === detailRevision)
      detail.value = result;
  } catch (cause) {
    error.value = message(cause);
  }
}
async function cancelBill(): Promise<void> {
  if (
    detail.value === null ||
    saving.value ||
    unknownBill.value ||
    !capabilities.value?.billCancel
  )
    return;
  if (
    pendingCancel === null &&
    !globalThis.confirm(
      `确认撤销账单 ${detail.value.billNo}？明细将退回未入单。`,
    )
  )
    return;
  saving.value = true;
  error.value = '';
  pendingCancel ??= {
    id: detail.value.id,
    body: {
      reason: cancelReason.value,
      idempotencyKey: globalThis.crypto.randomUUID(),
    },
  };
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  try {
    storeFinancialPending(scope, 'cancel', pendingCancel);
    submitted = true;
    const original = pendingCancel;
    const result = await cancelSettlementBill(original.id, original.body);
    if (originalIdentity !== identity.value) return;
    notice.value = `账单 ${result.billNo} 已撤销，来源明细可重新选择`;
    clearFinancialPending(scope, 'cancel', original);
    pendingCancel = null;
    unknownCancel.value = false;
    cancelReason.value = '';
    detail.value = null;
    await load();
  } catch (cause) {
    if (originalIdentity !== identity.value) return;
    if (rejected(cause) && pendingCancel)
      clearFinancialPending(scope, 'cancel', pendingCancel);
    if (rejected(cause) || !submitted) pendingCancel = null;
    unknownCancel.value = pendingCancel !== null;
    error.value = message(cause);
  } finally {
    if (originalIdentity === identity.value) saving.value = false;
  }
}
</script>

<template>
  <main class="settlement-center">
    <header>
      <h1>结算中心</h1>
      <p>
        发起、入单与财务实际结果分别展示。未接入财务回填时，实际收付与日期保持待定。
      </p>
    </header>
    <div role="tablist" aria-label="结算中心页签" class="tabs">
      <ElButton
        role="tab"
        :disabled="!capabilities?.read || unknownBill || unknownCancel"
        :aria-selected="tab === 'CUSTOMER'"
        @click="tab = 'CUSTOMER'"
      >
        客户结算
      </ElButton>
      <ElButton
        role="tab"
        :disabled="!capabilities?.read || unknownBill || unknownCancel"
        :aria-selected="tab === 'LAWYER'"
        @click="tab = 'LAWYER'"
      >
        律师结算
      </ElButton>
      <ElButton
        role="tab"
        :disabled="!capabilities?.feeRead || unknownBill || unknownCancel"
        :aria-selected="tab === 'FEES'"
        @click="tab = 'FEES'"
      >
        费用中心
      </ElButton>
    </div>
    <p v-if="!capabilities && !error">正在读取结算中心权限…</p>
    <p v-else-if="!capabilities" role="alert">{{ error }}</p>
    <FeeCenterPanel
      v-else-if="tab === 'FEES' && capabilities.feeRead"
      :can-create="capabilities.feeCreate"
      :can-update="capabilities.feeUpdate"
      :can-launch="capabilities.feeLaunch"
      :can-delete="capabilities.feeDelete"
    />
    <template v-else-if="capabilities.read">
      <p v-if="error" role="alert">
        {{ error }} <ElButton @click="load">刷新</ElButton>
      </p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <section class="card">
        <h2>{{ tab === 'CUSTOMER' ? '客户' : '律师' }}结算明细</h2>
        <dl v-if="summary" class="kpis">
          <div>
            <dt>发起金额</dt>
            <dd>{{ summary.launchedAmount }} 元</dd>
          </div>
          <div>
            <dt>已入单金额</dt>
            <dd>{{ summary.billedAmount }} 元</dd>
          </div>
          <div>
            <dt>未入单金额</dt>
            <dd>
              {{ summary.unbilledAmount }} 元 · {{ summary.unbilledCount }} 条
            </dd>
          </div>
          <div>
            <dt>{{ side === 'CUSTOMER' ? '已开票金额' : '已开票待付' }}</dt>
            <dd>{{ summary.invoiceAmount ?? '待财务回填' }}</dd>
          </div>
          <div>
            <dt>{{ side === 'CUSTOMER' ? '实际回款' : '实际打款' }}</dt>
            <dd>
              {{
                (side === 'CUSTOMER'
                  ? summary.receivedAmount
                  : summary.paidAmount) ?? '待财务回填'
              }}
            </dd>
          </div>
          <div>
            <dt>{{ side === 'CUSTOMER' ? '合作客户' : '合作律师' }}</dt>
            <dd>
              {{ summary.cooperatingPayeeCount }}
              {{ side === 'CUSTOMER' ? '家' : '位'
              }}<span v-if="side === 'LAWYER'">
                · {{ summary.knownLawFirmCount }} 家已知律所</span
              >
            </dd>
          </div>
        </dl>
        <div class="filters settlement-filters">
          <label
            >查询案件／主体 <ElInput v-model="keyword" placeholder="案号或名称"
          /></label>
          <label
            >案件阶段
            <ElSelect v-model="stage">
              <ElOption value="" label="全部阶段" />
              <ElOption value="WAITING_ARCHIVE" label="待归档" />
              <ElOption value="ARCHIVED" label="已归档" /> </ElSelect
          ></label>
          <label
            >入单状态
            <ElSelect v-model="billState">
              <ElOption value="" label="全部" />
              <ElOption value="UNBILLED" label="未入账单" />
              <ElOption value="BILLED" label="已入账单" /> </ElSelect
          ></label>
          <label>发起起日<ElInput v-model="from" type="date" /></label
          ><label>发起止日<ElInput v-model="to" type="date" /></label>
          <ElButton @click="applyFilter">查询</ElButton
          ><ElButton @click="clearFilter">清除筛选</ElButton>
        </div>
        <p>
          明细 {{ launches.total }} 条 · 已选
          {{ selectedCount }} 条。勾选会在切换筛选时保留。
        </p>
        <p v-if="loading">正在加载…</p>
        <p v-else-if="visible.length === 0">当前条件下暂无结算明细</p>
        <table v-else>
          <thead>
            <tr>
              <th>
                <ElCheckbox
                  aria-label="全选当前可入单明细"
                  :model-value="allSelected"
                  :disabled="unknownBill"
                  @change="toggleAll"
                />
              </th>
              <th>发起日期</th>
              <th>收付方</th>
              <th>案件</th>
              <th>次数</th>
              <th>金额</th>
              <th>入单</th>
              <th v-if="side === 'CUSTOMER'">已开票</th>
              <th>{{ side === 'CUSTOMER' ? '实际回款' : '实际打款' }}</th>
              <th>{{ side === 'CUSTOMER' ? '回款日期' : '打款日期' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visible" :key="row.id">
              <td>
                <ElCheckbox
                  :aria-label="`选择 ${row.businessNo} 第${row.nth}次`"
                  :model-value="selected.has(row.id)"
                  :disabled="row.billId !== null || unknownBill"
                  @change="toggle(row.id)"
                />
              </td>
              <td>{{ row.launchDate }}</td>
              <td>
                {{ row.payeeName ?? '—'
                }}{{ row.lawFirm ? ` / ${row.lawFirm}` : '' }}
              </td>
              <td>
                <RouterLink :to="`/cases/${row.caseId}`">{{
                  row.businessNo
                }}</RouterLink>
              </td>
              <td>{{ row.nth }}</td>
              <td>{{ row.amount }}</td>
              <td>{{ row.billId ? '已入单' : '未入单' }}</td>
              <td v-if="side === 'CUSTOMER'">{{ row.invoiceAmount ?? '—' }}</td>
              <td>
                {{
                  (side === 'CUSTOMER' ? row.receivedAmount : row.paidAmount) ??
                  '—'
                }}
              </td>
              <td>{{ row.actualPaymentDate ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pager">
          <ElButton :disabled="page <= 1" @click="page -= 1"> 上一页</ElButton
          ><span>{{ page }} / {{ pageCount }}</span
          ><ElButton :disabled="page >= pageCount" @click="page += 1">
            下一页
          </ElButton>
        </div>
        <form
          v-if="capabilities.billCreate"
          class="filters"
          @submit.prevent="createBill"
        >
          <label
            >账单日期
            <ElInput
              v-model="billDate"
              type="date"
              required
              :disabled="unknownBill" /></label
          ><label
            >备注
            <ElInput
              v-model="billNote"
              maxlength="500"
              :disabled="unknownBill" /></label
          ><ElButton
            native-type="submit"
            :disabled="saving || selectedCount === 0"
          >
            合并生成账单（{{ selectedCount }} 条）
          </ElButton>
        </form>
        <p v-if="capabilities.billCreate && billPreview">
          编号预览：{{ billPreview }}（未占号，以创建结果为准）
        </p>
        <p v-if="unknownBill" role="alert">
          账单创建结果尚未确认。<ElButton :disabled="saving" @click="createBill"
            >用原请求重试</ElButton
          >
        </p>
      </section>
      <section class="card">
        <h2>账单</h2>
        <div class="filters">
          <label>账单号／收付方<ElInput v-model="billQuery" /></label
          ><label
            >账单状态<ElSelect v-model="billHistory"
              ><ElOption value="" label="全部" /><ElOption
                value="ACTIVE"
                label="已发起" /><ElOption
                value="CANCELLED"
                label="已撤销" /></ElSelect></label
          ><ElButton
            @click="
              billPage = 1;
              load();
            "
            >查询账单</ElButton
          >
        </div>
        <p v-if="bills.items.length === 0">暂无账单</p>
        <table v-else>
          <thead>
            <tr>
              <th>编号</th>
              <th>账单日期</th>
              <th>收付方</th>
              <th>条数</th>
              <th>金额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="bill in bills.items" :key="bill.id">
              <td>{{ bill.billNo }}</td>
              <td>{{ bill.billDate }}</td>
              <td>{{ bill.payees.join('、') }}</td>
              <td>{{ bill.count }}</td>
              <td>{{ bill.amount }}</td>
              <td>{{ bill.cancelledAt ? '已撤销' : '已发起' }}</td>
              <td>
                <ElButton @click="viewBill(bill.id)">查看</ElButton>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pager">
          <ElButton :disabled="billPage <= 1" @click="billPage -= 1"
            >上一页账单</ElButton
          ><span>{{ billPage }} / {{ billPageCount }}</span
          ><ElButton
            :disabled="billPage >= billPageCount"
            @click="billPage += 1"
            >下一页账单</ElButton
          >
        </div>
      </section>
      <section v-if="detail" class="card" aria-label="账单详情">
        <h2>账单 {{ detail.billNo }}</h2>
        <p>
          {{ detail.billDate }} · {{ detail.amount }} 元 ·
          {{ detail.cancelledAt ? '已撤销' : '已发起' }}
        </p>
        <p v-if="detail.cancellationReason">
          撤销原因：{{ detail.cancellationReason }}
        </p>
        <p v-if="detail.note">备注：{{ detail.note }}</p>
        <table>
          <thead>
            <tr>
              <th>收付方</th>
              <th>案件单号</th>
              <th>发起结算日期</th>
              <th>次数</th>
              <th>金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in detail.items" :key="item.id">
              <td>{{ item.payeeName }}</td>
              <td>
                <RouterLink :to="`/cases/${item.caseId}`">{{
                  item.caseBusinessNo ?? '历史信息未提供'
                }}</RouterLink>
              </td>
              <td>{{ item.launchDate ?? '历史信息未提供' }}</td>
              <td>{{ item.nth }}</td>
              <td>{{ item.amount }}</td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="!detail.cancelledAt && capabilities.billCancel"
          class="filters"
          @submit.prevent="cancelBill"
        >
          <label
            >撤销说明（可选）
            <ElInput
              v-model="cancelReason"
              maxlength="500"
              :disabled="unknownCancel" /></label
          ><ElButton native-type="submit" :disabled="saving">撤销账单</ElButton>
        </form>
        <p v-if="unknownCancel" role="alert">
          撤销结果尚未确认。<ElButton :disabled="saving" @click="cancelBill"
            >用原请求重试撤销</ElButton
          >
        </p>
        <ElButton @click="detail = null">关闭</ElButton>
      </section>
    </template>
    <p v-else role="alert">
      {{ error || '当前账号未获结算与费用中心读取权限' }}
    </p>
  </main>
</template>

<style scoped>
.settlement-center {
  display: grid;
  gap: 16px;
  padding: 24px;
  color: var(--color-ink);
}
.tabs,
.filters,
.pager,
.kpis {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}
.tabs {
  border-bottom: 1px solid var(--color-hairline);
}
.card {
  padding: 16px;
  border: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
  overflow-x: auto;
}
.filters label {
  display: grid;
  gap: 4px;
}
.settlement-filters > label {
  min-width: min(100%, 170px);
}
.settlement-filters > label:first-child {
  flex: 1 1 220px;
}
.settlement-filters :deep(.el-select),
.settlement-filters :deep(.el-input) {
  width: 100%;
  min-width: 0;
}
button,
input,
select {
  padding: 7px 9px;
  border: 1px solid var(--color-hairline-strong);
  background: var(--color-surface-1);
  color: var(--color-ink);
}
button[aria-selected='true'] {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
button:disabled {
  opacity: 0.5;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 9px;
  border-bottom: 1px solid var(--color-hairline);
  text-align: left;
}
.pager {
  justify-content: end;
  margin-top: 12px;
}
</style>
