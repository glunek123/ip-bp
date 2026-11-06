<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { ApiError } from '../../api/http';
import {
  exportLitigationRefunds,
  followUpLitigationRefund,
  getLitigationRefundCapabilities,
  getLitigationRefundRequest,
  listLitigationRefunds,
  refundStatuses,
  type RefundCapabilities,
  type RefundFollowUpInput,
  type RefundList,
  type RefundRow,
  type RefundStatus,
} from '../../api/litigation-refunds';
import { useAuthStore } from '../../stores/auth';

const labels: Record<RefundStatus, string> = {
  UNKNOWN: '待确认',
  PENDING: '待退',
  SUBMITTED: '已提交',
  RETURNED_UNSETTLED: '已退未结算',
  SETTLED: '客户已收，公司未收',
  RECEIVED: '公司已收',
  CONVERTED_TO_COST: '转成本',
};
type RefundColumn =
  | 'caseNo'
  | 'plaintiff'
  | 'defendant'
  | 'courtNo'
  | 'lawyer'
  | 'party'
  | 'amount'
  | 'status'
  | 'remark';
const columnDefinitions: readonly {
  key: RefundColumn;
  label: string;
  locked?: boolean;
}[] = [
  { key: 'caseNo', label: '案件单号', locked: true },
  { key: 'plaintiff', label: '原告' },
  { key: 'defendant', label: '被告' },
  { key: 'courtNo', label: '案号' },
  { key: 'lawyer', label: '律师' },
  { key: 'party', label: '退费方式' },
  { key: 'amount', label: '退费金额' },
  { key: 'status', label: '退费状态' },
  { key: 'remark', label: '退费备注' },
];
const defaultColumns: Record<RefundColumn, boolean> = {
  caseNo: true,
  plaintiff: true,
  defendant: true,
  courtNo: true,
  lawyer: true,
  party: true,
  amount: true,
  status: true,
  remark: true,
};
const columnVisibility = ref<Record<RefundColumn, boolean>>({
  ...defaultColumns,
});
const auth = useAuthStore();
const ownerScope = computed(
  () =>
    `${auth.session?.user.id ?? 'anonymous'}:${auth.session?.department?.id ?? 'none'}`,
);
const identity = computed(
  () => `${ownerScope.value}:${auth.session?.authorizationRevision ?? ''}`,
);
const filters = reactive({
  plaintiff: '',
  defendant: '',
  courtNo: '',
  lawyer: '',
  status: '' as RefundStatus | '',
});
let suppressFilterWatch = false;
let suppressPageLoad = false;
const capabilities = ref<RefundCapabilities | null>(null);
const result = ref<RefundList | null>(null);
const page = ref(1);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const selected = ref(new Set<string>());
const modalRow = ref<RefundRow | null>(null);
const modalOverlay = ref<globalThis.HTMLElement | null>(null);
const modalStatus = ref<RefundStatus>('UNKNOWN');
const courtRefund = computed(() => modalRow.value?.party === 'COURT');
const selectableStatuses = computed(() =>
  courtRefund.value
    ? refundStatuses.filter((status) => status !== 'CONVERTED_TO_COST')
    : refundStatuses,
);
const remark = ref('');
const reason = ref('');
const saving = ref(false);
type PendingRequest = {
  ownerScope: string;
  caseId: string;
  itemId: string;
  body: RefundFollowUpInput;
};
const pending = ref<PendingRequest | null>(null);
let loadRevision = 0;
let requestController: AbortController | null = null;
const pageCount = computed(() =>
  Math.max(
    1,
    Math.ceil((result.value?.total ?? 0) / (result.value?.pageSize ?? 20)),
  ),
);
const visibleKeys = computed(() =>
  (result.value?.items ?? []).map((row) => `${row.caseId}:${row.itemId}`),
);
const allVisibleSelected = computed(
  () =>
    visibleKeys.value.length > 0 &&
    visibleKeys.value.every((key) => selected.value.has(key)),
);
const someVisibleSelected = computed(
  () =>
    visibleKeys.value.some((key) => selected.value.has(key)) &&
    !allVisibleSelected.value,
);
const unknownMessage = computed(() =>
  result.value && result.value.summary.unknownAmountCount > 0
    ? `另有 ${result.value.summary.unknownAmountCount} 笔金额待定，统计金额仅合计已知金额。`
    : '统计金额仅合计已知金额。',
);
function formatMoney(value: string): string {
  const [integer = '0', fraction = '00'] = value.split('.');
  return `¥${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
function rowKey(row: RefundRow): string {
  return `${row.caseId}:${row.itemId}`;
}
function message(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : '请求失败，请重试';
}
async function load(): Promise<void> {
  const current = ++loadRevision;
  const currentIdentity = identity.value;
  requestController?.abort();
  requestController = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const next = await listLitigationRefunds(
      { ...filters, page: page.value, pageSize: 20 },
      { signal: requestController.signal },
    );
    if (current !== loadRevision || currentIdentity !== identity.value) return;
    result.value = next;
    selected.value = new Set(
      [...selected.value].filter((key) =>
        next.items.some((row) => rowKey(row) === key),
      ),
    );
  } catch (cause) {
    if (
      current === loadRevision &&
      currentIdentity === identity.value &&
      !(cause instanceof globalThis.DOMException && cause.name === 'AbortError')
    )
      error.value = message(cause);
  } finally {
    if (current === loadRevision && currentIdentity === identity.value)
      loading.value = false;
  }
}
async function initialize(): Promise<void> {
  pending.value = loadPending(ownerScope.value);
  const currentIdentity = identity.value;
  try {
    const next = await getLitigationRefundCapabilities();
    if (currentIdentity !== identity.value) return;
    capabilities.value = next;
    if (capabilities.value.read) await load();
  } catch (cause) {
    if (currentIdentity === identity.value) error.value = message(cause);
  }
}
function pendingKey(scope: string): string {
  return `litigation-refund-follow-pending:${scope}`;
}
function loadPending(scope: string): PendingRequest | null {
  const raw = globalThis.sessionStorage.getItem(pendingKey(scope));
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isPendingRequest(value) && value.ownerScope === scope ? value : null;
  } catch {
    return null;
  }
}
function isPendingRequest(value: unknown): value is PendingRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.caseId !== 'string' ||
    typeof candidate.itemId !== 'string' ||
    typeof candidate.body !== 'object' ||
    candidate.body === null ||
    Array.isArray(candidate.body)
  )
    return false;
  const body = candidate.body as Record<string, unknown>;
  return (
    typeof candidate.ownerScope === 'string' &&
    typeof body.expectedInventoryVersionId === 'string' &&
    refundStatuses.includes(body.status as RefundStatus) &&
    (body.remark === null || typeof body.remark === 'string') &&
    (body.reason === null || typeof body.reason === 'string') &&
    typeof body.idempotencyKey === 'string'
  );
}
function storePending(value: PendingRequest | null, scope: string): void {
  if (scope !== ownerScope.value) return;
  pending.value = value;
  if (value)
    globalThis.sessionStorage.setItem(pendingKey(scope), JSON.stringify(value));
  else globalThis.sessionStorage.removeItem(pendingKey(scope));
}
function clearFilters(): void {
  suppressFilterWatch = true;
  Object.assign(filters, {
    plaintiff: '',
    defendant: '',
    courtNo: '',
    lawyer: '',
    status: '',
  });
  suppressFilterWatch = false;
  if (filterTimer !== undefined) globalThis.clearTimeout(filterTimer);
  filterTimer = undefined;
  suppressPageLoad = true;
  page.value = 1;
  suppressPageLoad = false;
  selected.value.clear();
  void load();
}
let filterTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
function scheduleTextFilter(): void {
  if (suppressFilterWatch) return;
  suppressPageLoad = true;
  page.value = 1;
  suppressPageLoad = false;
  selected.value.clear();
  if (filterTimer !== undefined) globalThis.clearTimeout(filterTimer);
  filterTimer = globalThis.setTimeout(() => {
    filterTimer = undefined;
    void load();
  }, 250);
}
function applyStatusFilter(): void {
  if (suppressFilterWatch) return;
  suppressPageLoad = true;
  page.value = 1;
  suppressPageLoad = false;
  selected.value.clear();
  void load();
}
watch(
  () => [filters.plaintiff, filters.defendant, filters.courtNo, filters.lawyer],
  scheduleTextFilter,
  { flush: 'sync' },
);
watch(() => filters.status, applyStatusFilter, { flush: 'sync' });
function togglePageSelection(checked: boolean): void {
  const next = new Set(selected.value);
  for (const key of visibleKeys.value) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  selected.value = next;
}
function restoreDefaultColumns(): void {
  columnVisibility.value = { ...defaultColumns };
}
function openFollow(row: RefundRow): void {
  if (!row.canFollow || pending.value) return;
  modalRow.value = row;
  modalStatus.value = row.status;
  remark.value = row.remark ?? '';
  reason.value = '';
  void nextTick(() => modalOverlay.value?.focus());
}
function closeFollow(): void {
  if (!saving.value) modalRow.value = null;
}
function allowedStatus(row: RefundRow | null, status: RefundStatus): boolean {
  return (
    row === null || !(row.party === 'COURT' && status === 'CONVERTED_TO_COST')
  );
}
function makeKey(): string {
  return globalThis.crypto.randomUUID();
}
async function saveFollow(): Promise<void> {
  const row = modalRow.value;
  if (!row || saving.value || pending.value) return;
  if (!allowedStatus(row, modalStatus.value)) return;
  if (row.archived && !reason.value.trim()) return;
  const scope = ownerScope.value;
  const requestIdentity = identity.value;
  const body: RefundFollowUpInput = {
    expectedInventoryVersionId: row.inventoryVersionId,
    status: modalStatus.value,
    remark: remark.value.trim() || null,
    reason: reason.value.trim() || null,
    idempotencyKey: makeKey(),
  };
  storePending(
    { ownerScope: scope, caseId: row.caseId, itemId: row.itemId, body },
    scope,
  );
  saving.value = true;
  try {
    await followUpLitigationRefund(row.caseId, row.itemId, body);
    if (requestIdentity !== identity.value) return;
    storePending(null, scope);
    modalRow.value = null;
    notice.value = '退费跟进已保存';
    await load();
  } catch (cause) {
    if (requestIdentity !== identity.value) return;
    if (
      cause instanceof ApiError &&
      [400, 401, 403, 404, 409, 413, 415, 422].includes(cause.status)
    ) {
      storePending(null, scope);
      error.value = message(cause);
    } else
      error.value = `保存结果未知。请查询原请求结果；不要新建请求。${message(cause)}`;
  } finally {
    if (requestIdentity === identity.value) saving.value = false;
  }
}
async function recoverPending(): Promise<void> {
  const current = pending.value;
  if (!current || saving.value) return;
  const requestIdentity = identity.value;
  saving.value = true;
  error.value = '';
  try {
    await getLitigationRefundRequest(
      current.caseId,
      current.body.idempotencyKey,
    );
    if (requestIdentity !== identity.value) return;
    storePending(null, current.ownerScope);
    modalRow.value = null;
    notice.value = '已找到原请求回执';
    await load();
  } catch (cause) {
    if (requestIdentity !== identity.value) return;
    if (cause instanceof ApiError && cause.status === 404)
      error.value =
        '服务端未找到回执。核对记录后，可用原请求内容和原键再次提交。';
    else
      error.value = `原请求仍待核查，原请求内容和键已保留。${message(cause)}`;
  } finally {
    if (requestIdentity === identity.value) saving.value = false;
  }
}
async function retryOriginal(): Promise<void> {
  const current = pending.value;
  if (!current || saving.value) return;
  const requestIdentity = identity.value;
  saving.value = true;
  try {
    const receipt = await getLitigationRefundRequest(
      current.caseId,
      current.body.idempotencyKey,
    );
    if (receipt) {
      if (requestIdentity !== identity.value) return;
      storePending(null, current.ownerScope);
      modalRow.value = null;
      notice.value = '已找到原请求回执';
      await load();
      return;
    }
  } catch (cause) {
    if (requestIdentity !== identity.value) return;
    if (!(cause instanceof ApiError && cause.status === 404)) {
      error.value = `原请求仍待核查，原请求内容和键已保留。${message(cause)}`;
      saving.value = false;
      return;
    }
  }
  try {
    await followUpLitigationRefund(
      current.caseId,
      current.itemId,
      current.body,
    );
    if (requestIdentity !== identity.value) return;
    storePending(null, current.ownerScope);
    modalRow.value = null;
    notice.value = '原请求已保存';
    await load();
  } catch (cause) {
    if (requestIdentity !== identity.value) return;
    error.value = `原请求仍待核查，原请求内容和键已保留。${message(cause)}`;
  } finally {
    if (requestIdentity === identity.value) saving.value = false;
  }
}
async function exportAll(): Promise<void> {
  if (!capabilities.value?.export) return;
  const requestIdentity = identity.value;
  try {
    const file = await exportLitigationRefunds({ ...filters });
    if (requestIdentity !== identity.value) return;
    const url = globalThis.URL.createObjectURL(file.blob);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = file.filename || '诉讼退费.xlsx';
    link.click();
    globalThis.URL.revokeObjectURL(url);
  } catch (cause) {
    if (requestIdentity === identity.value) error.value = message(cause);
  }
}
watch(
  page,
  () => {
    selected.value.clear();
    if (!suppressPageLoad) void load();
  },
  { flush: 'sync' },
);
watch(identity, () => {
  if (filterTimer !== undefined) globalThis.clearTimeout(filterTimer);
  filterTimer = undefined;
  capabilities.value = null;
  result.value = null;
  selected.value.clear();
  modalRow.value = null;
  pending.value = loadPending(ownerScope.value);
  saving.value = false;
  void initialize();
});
onMounted(initialize);
onBeforeUnmount(() => {
  if (filterTimer !== undefined) globalThis.clearTimeout(filterTimer);
});
</script>

<template>
  <section class="refund-panel" aria-label="诉讼退费">
    <div class="refund-panel__heading">
      <h2>诉讼退费</h2>
      <button type="button" @click="load">刷新</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="pending" class="refund-panel__recovery" role="status">
      有一笔跟进请求结果未确认。请先查询原回执。
      <button type="button" :disabled="saving" @click="recoverPending">
        查询结果
      </button>
      <button type="button" :disabled="saving" @click="retryOriginal">
        回执不存在时用原请求恢复
      </button>
    </div>
    <template v-if="capabilities?.read">
      <div class="refund-panel__summary" aria-label="退费统计">
        <div>
          <span>未退费合计</span
          ><strong>{{
            formatMoney(result?.summary.unrefundedAmount ?? '0.00')
          }}</strong
          ><small>涉及 {{ result?.summary.unrefundedCount ?? 0 }} 笔退费</small>
        </div>
        <div>
          <span>待结算合计</span
          ><strong>{{
            formatMoney(result?.summary.pendingSettlementAmount ?? '0.00')
          }}</strong>
        </div>
      </div>
      <div class="refund-panel__filters">
        <label>原告<input v-model="filters.plaintiff" type="search" /></label>
        <label>被告<input v-model="filters.defendant" type="search" /></label>
        <label>法院案号<input v-model="filters.courtNo" type="search" /></label>
        <label>律师<input v-model="filters.lawyer" type="search" /></label>
        <label
          >状态<select v-model="filters.status">
            <option value="">全部状态</option>
            <option
              v-for="status in refundStatuses"
              :key="status"
              :value="status"
            >
              {{ labels[status] }}
            </option>
          </select></label
        >
        <div class="refund-panel__actions">
          <button type="button" @click="clearFilters">重置筛选</button
          ><button v-if="capabilities.export" type="button" @click="exportAll">
            导出全部筛选结果
          </button>
          <details class="refund-panel__columns">
            <summary>列设置</summary>
            <label v-for="column in columnDefinitions" :key="column.key"
              ><input
                v-model="columnVisibility[column.key]"
                type="checkbox"
                :disabled="column.locked"
              />{{ column.label }}{{ column.locked ? '（固定）' : '' }}</label
            ><button type="button" @click="restoreDefaultColumns">
              恢复默认
            </button>
          </details>
        </div>
      </div>
      <p class="refund-panel__export-note">
        金额格式：千分位，两位小数。{{
          unknownMessage
        }}
        导出范围为当前筛选条件下全部有权记录，不受勾选和当前页影响。
      </p>
      <p v-if="loading" role="status">正在读取退费记录…</p>
      <div class="refund-panel__table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  aria-label="选择本页记录"
                  type="checkbox"
                  :checked="allVisibleSelected"
                  :indeterminate="someVisibleSelected"
                  @change="
                    togglePageSelection(
                      ($event.target as globalThis.HTMLInputElement).checked,
                    )
                  "
                />
              </th>
              <th>操作</th>
              <th
                v-for="column in columnDefinitions"
                v-show="columnVisibility[column.key]"
                :key="column.key"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in result?.items ?? []"
              :key="rowKey(row)"
              :class="{
                'refund-panel__row--selected': selected.has(rowKey(row)),
              }"
            >
              <td>
                <input
                  type="checkbox"
                  :aria-label="`选择${row.caseNo}`"
                  :checked="selected.has(rowKey(row))"
                  @change="
                    selected.has(rowKey(row))
                      ? selected.delete(rowKey(row))
                      : selected.add(rowKey(row))
                  "
                />
              </td>
              <td>
                <button
                  v-if="row.canFollow && capabilities.follow"
                  type="button"
                  :disabled="!!pending"
                  @click="openFollow(row)"
                >
                  跟进</button
                ><span v-else>—</span>
              </td>
              <td
                v-for="column in columnDefinitions"
                v-show="columnVisibility[column.key]"
                :key="column.key"
              >
                <template v-if="column.key === 'caseNo'"
                  ><span :title="row.caseNo">{{ row.caseNo }}</span></template
                >
                <template v-else-if="column.key === 'plaintiff'"
                  ><span :title="row.plaintiff">{{
                    row.plaintiff
                  }}</span></template
                >
                <template v-else-if="column.key === 'defendant'"
                  ><span :title="row.defendant">{{
                    row.defendant
                  }}</span></template
                >
                <template v-else-if="column.key === 'courtNo'"
                  ><span :title="row.courtNo ?? ''">{{
                    row.courtNo ?? '—'
                  }}</span></template
                >
                <template v-else-if="column.key === 'lawyer'"
                  ><span :title="row.lawyer ?? ''">{{
                    row.lawyer ?? '—'
                  }}</span></template
                >
                <template v-else-if="column.key === 'party'"
                  ><span
                    :title="row.party === 'COURT' ? '法院退费' : '被告径付'"
                    >{{ row.party === 'COURT' ? '法院退费' : '被告径付' }}</span
                  ></template
                >
                <template v-else-if="column.key === 'amount'"
                  ><span
                    :title="
                      row.amount === null ? '金额待定' : formatMoney(row.amount)
                    "
                    >{{
                      row.amount === null ? '金额待定' : formatMoney(row.amount)
                    }}</span
                  ></template
                >
                <template v-else-if="column.key === 'status'"
                  ><span :title="labels[row.status]">{{
                    labels[row.status]
                  }}</span></template
                >
                <template v-else
                  ><span :title="row.remark ?? ''">{{
                    row.remark ?? '—'
                  }}</span></template
                >
              </td>
            </tr>
            <tr v-if="!loading && !result?.items.length">
              <td
                :colspan="
                  2 +
                  columnDefinitions.filter(
                    (column) => columnVisibility[column.key],
                  ).length
                "
              >
                没有符合条件的退费记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="refund-panel__filtered-total">
        当前筛选应退金额：{{
          formatMoney(result?.summary.filteredAmount ?? '0.00')
        }}
        <span>（{{ unknownMessage }}）</span>
      </p>
      <div class="refund-panel__paging">
        <span
          >共 {{ result?.total ?? 0 }} 笔 · 第 {{ page }} / {{ pageCount }} 页 ·
          每页 20 笔</span
        ><button type="button" :disabled="page <= 1" @click="page--">
          上一页</button
        ><button type="button" :disabled="page >= pageCount" @click="page++">
          下一页
        </button>
      </div>
    </template>
    <p v-else-if="capabilities && !capabilities.read">
      当前账号没有诉讼退费查看权限。
    </p>
    <p v-else-if="!error">正在读取诉讼退费权限…</p>
    <div
      v-if="modalRow"
      ref="modalOverlay"
      class="refund-panel__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refund-follow-title"
      tabindex="-1"
      @click.self="closeFollow"
      @keydown.esc.stop.prevent="closeFollow"
    >
      <form
        class="refund-panel__modal"
        @click.stop
        @submit.prevent="saveFollow"
      >
        <div class="refund-panel__modal-heading">
          <h3 id="refund-follow-title">诉讼退费跟进</h3>
          <button
            type="button"
            aria-label="关闭跟进对话框"
            :disabled="saving"
            @click="closeFollow"
          >
            ×
          </button>
        </div>
        <dl class="refund-panel__readonly">
          <div>
            <dt>案件单号</dt>
            <dd :title="modalRow.caseNo">{{ modalRow.caseNo }}</dd>
          </div>
          <div>
            <dt>法院案号</dt>
            <dd :title="modalRow.courtNo ?? ''">
              {{ modalRow.courtNo ?? '待核对' }}
            </dd>
          </div>
          <div>
            <dt>原告</dt>
            <dd :title="modalRow.plaintiff">{{ modalRow.plaintiff }}</dd>
          </div>
          <div>
            <dt>被告</dt>
            <dd :title="modalRow.defendant">{{ modalRow.defendant }}</dd>
          </div>
          <div>
            <dt>退费方式</dt>
            <dd>{{ modalRow.party === 'COURT' ? '法院退费' : '被告径付' }}</dd>
          </div>
          <div>
            <dt>应退金额</dt>
            <dd>
              {{
                modalRow.amount === null
                  ? '金额待定'
                  : formatMoney(modalRow.amount)
              }}
            </dd>
          </div>
          <div class="refund-panel__description">
            <dt>原事项说明</dt>
            <dd :title="modalRow.description">{{ modalRow.description }}</dd>
          </div>
        </dl>
        <label
          >退费状态<select v-model="modalStatus">
            <option
              v-for="status in selectableStatuses"
              :key="status"
              :value="status"
            >
              {{ labels[status] }}
            </option>
          </select></label
        >
        <label>跟进备注<textarea v-model="remark" rows="3" /></label>
        <label v-if="modalRow?.archived"
          >更正原因（归档案件必填）<textarea
            v-model="reason"
            rows="3"
            required
          />
        </label>
        <div class="refund-panel__actions">
          <button
            type="submit"
            :disabled="
              saving || !!pending || (!!modalRow.archived && !reason.trim())
            "
          >
            保存跟进</button
          ><button type="button" :disabled="saving" @click="closeFollow">
            取消
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.refund-panel {
  display: grid;
  gap: 12px;
  color: var(--el-text-color-primary, #303133);
}
.refund-panel__heading,
.refund-panel__paging,
.refund-panel__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.refund-panel__heading {
  justify-content: space-between;
}
.refund-panel h2 {
  margin: 0;
  font-size: 18px;
}
.refund-panel button,
.refund-panel select,
.refund-panel input,
.refund-panel textarea {
  font: inherit;
}
.refund-panel button {
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid #c0c4cc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}
.refund-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.refund-panel__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.refund-panel__summary > div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.refund-panel__summary strong {
  font-size: 18px;
}
.refund-panel__summary small,
.refund-panel__export-note {
  color: #606266;
}
.refund-panel__filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(130px, 1fr));
  gap: 8px;
  align-items: end;
}
.refund-panel__filters label,
.refund-panel__modal label {
  display: grid;
  gap: 4px;
}
.refund-panel__filters input:not([type='checkbox']),
.refund-panel__filters select,
.refund-panel__modal select,
.refund-panel__modal textarea {
  min-height: 32px;
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 4px 8px;
  box-sizing: border-box;
}
.refund-panel__actions {
  grid-column: 1 / -1;
}
.refund-panel__actions {
  position: relative;
}
.refund-panel__columns {
  position: relative;
}
.refund-panel__columns summary {
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid #c0c4cc;
  border-radius: 4px;
  cursor: pointer;
  list-style: none;
}
.refund-panel__columns[open] {
  position: absolute;
  z-index: 4;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  gap: 6px;
  min-width: 150px;
  max-height: 296px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: white;
  box-shadow: 0 4px 14px #0002;
}
.refund-panel__columns label {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.refund-panel__columns input[type='checkbox'] {
  width: 16px;
  min-width: 16px;
  height: 16px;
  min-height: 16px;
  flex: 0 0 16px;
  padding: 0;
}
.refund-panel__columns button {
  min-height: 28px;
  padding: 3px 8px;
}
.refund-panel__filtered-total {
  margin: 0;
  font-weight: 600;
}
.refund-panel__filtered-total span {
  color: #606266;
  font-weight: 400;
}
.refund-panel__export-note {
  margin: -8px 0 0;
  font-size: 12px;
}
.refund-panel__table-wrap {
  overflow: auto;
  border: 1px solid #ebeef5;
}
.refund-panel table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-size: 13px;
}
.refund-panel th,
.refund-panel td {
  padding: 8px;
  border-bottom: 1px solid #ebeef5;
  text-align: left;
}
.refund-panel__row--selected {
  background: #ecf5ff;
}
.refund-panel th {
  background: #f5f7fa;
}
.refund-panel__paging {
  justify-content: flex-end;
}
.refund-panel__recovery {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px;
  background: #fdf6ec;
}
.refund-panel__backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: #0006;
}
.refund-panel__modal {
  display: grid;
  gap: 12px;
  width: min(560px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  margin: 0;
  padding: 20px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: white;
  box-shadow: 0 8px 30px #0002;
}
.refund-panel__modal-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.refund-panel__modal-heading h3 {
  margin: 0;
}
.refund-panel__readonly {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 0;
}
.refund-panel__readonly > div {
  min-width: 0;
}
.refund-panel__readonly dt {
  color: #606266;
  font-size: 12px;
}
.refund-panel__readonly dd {
  overflow: hidden;
  margin: 2px 0 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refund-panel__description {
  grid-column: 1 / -1;
}
.refund-panel__modal form {
  display: grid;
  gap: 12px;
}
@media (max-width: 800px) {
  .refund-panel__summary {
    grid-template-columns: 1fr;
  }
  .refund-panel__filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
