<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import {
  ElSelect,
  ElOption,
} from 'element-plus/es/components/select/index.mjs';
import { ElDialog } from 'element-plus/es/components/dialog/index.mjs';
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs';
import { ApiError } from '../../api/http';
import {
  batchFees,
  createFee,
  listFees,
  listFinancialCaseOptions,
  updateFee,
  updateFeeProof,
  type FeeRow,
  type FeeSelectionSource,
  type FinancialCaseOption,
} from '../../api/settlements';
import { todayShanghai } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import { formatSettlementAmount } from '../customers';
import CaseFeeEntryDialog from './CaseFeeEntryDialog.vue';
import {
  loadFinancialPending,
  storeFinancialPending,
  clearFinancialPending,
  isPendingFee,
  isPendingFeeBatch,
  isPendingFeeProof,
} from './financial-pending';
import {
  uploadMaterialFile,
  downloadMaterialVersion,
} from '../../api/materials';

const props = withDefaults(
  defineProps<{
    caseId?: string;
    canCreate?: boolean;
    canUpdate?: boolean;
    canLaunch?: boolean;
    canDelete?: boolean;
  }>(),
  { canCreate: false, canUpdate: false, canLaunch: false, canDelete: false },
);
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}:${props.caseId ?? 'center'}`,
);
const pendingScope = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:fee:${props.caseId ?? 'center'}`,
);
let active = true;
function sameContext(original: string): boolean {
  return active && original === identity.value;
}
const types = [
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
const ordinaryStatuses = ['未发起', '发起', '已支付'];
const refundStatuses = ['退原告', '退律所'];
function isZeroFeeAmount(amount: string): boolean {
  try {
    return formatSettlementAmount(amount) === '¥0.00';
  } catch {
    return false;
  }
}
const filters = reactive({
  type: '',
  status: '',
  direction: '',
  from: '',
  to: '',
});
const page = ref(1);
const rows = ref<FeeRow[]>([]);
const total = ref(0);
const matchingIds = ref<string[]>([]);
const selected = ref(new Set<string>());
const selectionSources = new Map<string, FeeSelectionSource>();
const expandedGroups = ref(new Set<string>());
const tableRows = computed<Array<{ row: FeeRow; key: string; isNet: boolean }>>(
  () =>
    rows.value.flatMap((row) => {
      if (!row.sourceRows)
        return [{ row, key: `source:${row.id}`, isNet: false }];
      return [
        { row, key: `net:${row.id}`, isNet: true },
        ...(expandedGroups.value.has(row.id)
          ? row.sourceRows.map((source) => ({
              row: source,
              key: `source:${source.id}`,
              isNet: false,
            }))
          : []),
      ];
    }),
);
function toggleGroup(id: string): void {
  const next = new Set(expandedGroups.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedGroups.value = next;
}
const summary = ref<{
  expense: string;
  income: string;
  pending: string;
  pendingCount: number;
} | null>(null);
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const saving = ref(false);
const error = ref('');
const notice = ref('');
const showCreate = ref(false);
const showCaseCreate = ref(false);
const form = reactive({
  caseId: props.caseId ?? '',
  type: '诉讼费',
  direction: '支出' as '收入' | '支出',
  status: '未发起',
  amount: '',
  feeDate: todayShanghai(),
  note: '',
});
const caseOptions = ref<FinancialCaseOption[]>([]);
const caseQuery = ref('');
const casePage = ref(1);
const caseTotal = ref(0);
const caseLoading = ref(false);
const columns = reactive({
  type: true,
  direction: true,
  amount: true,
  status: true,
  date: true,
  platform: true,
  shop: true,
  defendant: true,
  case: true,
  note: true,
});
const columnLabels = {
  type: '费用类型',
  direction: '方向',
  amount: '金额',
  status: '状态',
  date: '日期',
  platform: '平台',
  shop: '店铺',
  defendant: '被告',
  case: '案号',
  note: '备注',
} as const;
const columnKeys = Object.keys(columnLabels) as Array<
  keyof typeof columnLabels
>;
try {
  const saved: unknown = JSON.parse(
    globalThis.localStorage.getItem('dev-cor.fee-columns.v1') ?? 'null',
  );
  if (saved !== null && typeof saved === 'object' && !Array.isArray(saved))
    for (const key of columnKeys)
      if (key in saved && typeof Reflect.get(saved, key) === 'boolean')
        columns[key] = Reflect.get(saved, key) === true;
} catch {
  /* Column preferences do not affect financial facts. */
}
watch(columns, () => {
  try {
    globalThis.localStorage.setItem(
      'dev-cor.fee-columns.v1',
      JSON.stringify(columns),
    );
  } catch {
    /* Storage may be unavailable. */
  }
});
let requestRevision = 0;
let request: AbortController | null = null;
let caseRevision = 0;
let pendingCreate: Parameters<typeof createFee>[0] | null = null;
let pendingBatch: {
  command: 'launch' | 'delete';
  body: Parameters<typeof batchFees>[1];
} | null = null;
const unknownCreate = ref(false);
const unknownBatch = ref(false);
const noteDrafts = reactive<Record<string, string>>({});
const unknownUpdate = ref(false);
const proofInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(
  null,
);
let proofTarget: FeeRow | null = null;
let pendingProof: {
  feeId: string;
  body: Parameters<typeof updateFeeProof>[1];
} | null = null;
const unknownProof = ref(false);
function chooseProof(row: FeeRow): void {
  if (row.sourceRows || !props.canUpdate || saving.value || unknownProof.value)
    return;
  proofTarget = row;
  proofInput.value?.click();
}
async function saveProof(): Promise<void> {
  if (pendingProof === null || !props.canUpdate) return;
  if (!active) return;
  saving.value = true;
  error.value = '';
  const original = pendingProof;
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  try {
    storeFinancialPending(scope, 'proof', original);
    submitted = true;
    await updateFeeProof(original.feeId, original.body);
    if (!sameContext(originalIdentity)) return;
    clearFinancialPending(scope, 'proof', original);
    pendingProof = null;
    unknownProof.value = false;
    notice.value =
      original.body.contentVersionId === null
        ? '凭证已移除，文件历史保留'
        : '凭证已保存';
    await load();
  } catch (cause) {
    if (!sameContext(originalIdentity)) return;
    if (rejected(cause)) clearFinancialPending(scope, 'proof', original);
    if (rejected(cause) || !submitted) pendingProof = null;
    unknownProof.value = pendingProof !== null;
    error.value = message(cause);
  } finally {
    if (sameContext(originalIdentity)) saving.value = false;
  }
}
async function uploadProof(event: { target: unknown }): Promise<void> {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const file = input.files?.[0];
  const row = proofTarget;
  input.value = '';
  proofTarget = null;
  if (!file || !row || !props.canUpdate || saving.value || unknownProof.value)
    return;
  const originalIdentity = identity.value;
  saving.value = true;
  error.value = '';
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'CASE',
      ownerId: row.caseId,
      category: 'FEE_PROOF',
      purpose: 'FEE_PROOF',
      file,
    });
    if (!sameContext(originalIdentity)) return;
    pendingProof = {
      feeId: row.id,
      body: {
        expectedVersion: row.version,
        materialId: uploaded.materialId,
        contentVersionId: uploaded.contentVersionId,
        idempotencyKey: globalThis.crypto.randomUUID(),
      },
    };
    await saveProof();
  } catch (cause) {
    if (sameContext(originalIdentity)) error.value = message(cause);
  } finally {
    if (sameContext(originalIdentity)) saving.value = false;
  }
}
async function clearProof(row: FeeRow): Promise<void> {
  if (row.sourceRows) return;
  if (
    !props.canUpdate ||
    saving.value ||
    unknownProof.value ||
    !globalThis.confirm('确认移除此费用的当前凭证？原文件及引用历史保留。')
  )
    return;
  pendingProof = {
    feeId: row.id,
    body: {
      expectedVersion: row.version,
      materialId: null,
      contentVersionId: null,
      idempotencyKey: globalThis.crypto.randomUUID(),
    },
  };
  await saveProof();
}
async function downloadProof(row: FeeRow): Promise<void> {
  if (row.sourceRows) return;
  if (!row.proofMaterialId || !row.proofContentVersionId) return;
  try {
    await downloadMaterialVersion(
      row.proofMaterialId,
      row.proofContentVersionId,
      request?.signal,
    );
  } catch (cause) {
    error.value = message(cause);
  }
}
const allSelected = computed(
  () =>
    matchingIds.value.length > 0 &&
    matchingIds.value.every((id) => selected.value.has(id)),
);
const zeroOnlySelection = computed(() => {
  const sourceRows = [...selected.value].map((id) => selectionSources.get(id));
  return (
    sourceRows.length > 0 &&
    sourceRows.every((row) => row !== undefined && isZeroFeeAmount(row.amount))
  );
});
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / 100)));
const formStatuses = computed(() =>
  form.type === '诉讼退费' ? refundStatuses : ordinaryStatuses,
);
watch(
  () => form.type,
  () => {
    if (!formStatuses.value.includes(form.status))
      form.status = formStatuses.value[0]!;
  },
);
function message(cause: unknown): string {
  return cause instanceof ApiError
    ? cause.message
    : '请求失败，请保留原请求重试';
}
function rejected(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    [400, 401, 403, 404, 409, 413, 415, 422].includes(cause.status)
  );
}

async function load(): Promise<void> {
  const revision = ++requestRevision;
  request?.abort();
  request = new AbortController();
  state.value = 'loading';
  error.value = '';
  try {
    const result = await listFees(
      {
        page: page.value,
        ...(props.caseId ? { caseId: props.caseId } : {}),
        ...Object.fromEntries(
          Object.entries(filters).filter(([, value]) => value),
        ),
      },
      { signal: request.signal },
    );
    if (revision !== requestRevision) return;
    rows.value = result.items;
    for (const row of result.items.flatMap((row) => row.sourceRows ?? [row]))
      noteDrafts[row.id] = row.note ?? '';
    for (const source of result.matchingSources ?? [])
      selectionSources.set(source.id, source);
    unknownUpdate.value = false;
    total.value = result.total;
    matchingIds.value = result.matchingIds;
    summary.value = result.summary;
    state.value = 'ready';
  } catch (cause) {
    if (revision === requestRevision) {
      state.value = 'failed';
      rows.value = [];
      matchingIds.value = [];
      summary.value = null;
      error.value = message(cause);
    }
  }
}
watch(
  [identity, () => props.caseId],
  async () => {
    selected.value = new Set();
    selectionSources.clear();
    expandedGroups.value = new Set();
    rows.value = [];
    pendingCreate = null;
    pendingBatch = null;
    pendingProof = null;
    proofTarget = null;
    unknownProof.value = false;
    saving.value = false;
    unknownCreate.value = false;
    unknownBatch.value = false;
    unknownUpdate.value = false;
    showCaseCreate.value = false;
    form.caseId = props.caseId ?? '';
    form.type = '诉讼费';
    form.direction = '支出';
    form.status = '未发起';
    form.amount = '';
    form.feeDate = todayShanghai();
    form.note = '';
    caseRevision += 1;
    caseOptions.value = [];
    caseQuery.value = '';
    caseTotal.value = 0;
    caseLoading.value = false;
    summary.value = null;
    error.value = '';
    notice.value = '';
    showCreate.value = false;
    page.value = 1;
    const scope = pendingScope.value;
    let recoveryError = '';
    try {
      pendingCreate = loadFinancialPending(scope, 'create', isPendingFee);
      pendingBatch = loadFinancialPending(scope, 'batch', isPendingFeeBatch);
      pendingProof = loadFinancialPending(scope, 'proof', isPendingFeeProof);
      unknownCreate.value = pendingCreate !== null;
      unknownBatch.value = pendingBatch !== null;
      unknownProof.value = pendingProof !== null;
      if (pendingCreate) {
        const original = pendingCreate;
        Object.assign(form, {
          caseId: original.caseId,
          type: original.type,
          direction: original.direction,
          status: original.status,
          amount: original.amount,
          feeDate: original.feeDate,
          note: original.note ?? '',
        });
        showCreate.value = props.canCreate;
      }
      if (pendingBatch) selected.value = new Set(pendingBatch.body.ids);
    } catch (cause) {
      recoveryError = message(cause);
    }
    await load();
    if (scope === pendingScope.value && recoveryError)
      error.value = recoveryError;
  },
  { immediate: true },
);
watch(page, () => {
  void load();
});
function applyFilter(): void {
  if (page.value !== 1) page.value = 1;
  else void load();
}
function clearFilter(): void {
  Object.assign(filters, {
    type: '',
    status: '',
    direction: '',
    from: '',
    to: '',
  });
  applyFilter();
}
function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function toggleAll(): void {
  const next = new Set(selected.value);
  if (allSelected.value) for (const id of matchingIds.value) next.delete(id);
  else for (const id of matchingIds.value) next.add(id);
  selected.value = next;
}

async function searchCases(query: string, append = false): Promise<void> {
  const revision = ++caseRevision;
  if (!append) {
    caseQuery.value = query;
    casePage.value = 1;
    caseOptions.value = [];
  }
  caseLoading.value = true;
  try {
    const result = await listFinancialCaseOptions(query, casePage.value);
    if (revision !== caseRevision) return;
    caseOptions.value = append
      ? [...caseOptions.value, ...result.items]
      : result.items;
    caseTotal.value = result.total;
  } catch (cause) {
    if (revision === caseRevision) error.value = message(cause);
  } finally {
    if (revision === caseRevision) caseLoading.value = false;
  }
}
function openCreate(): void {
  if (!props.canCreate) return;
  if (props.caseId) {
    showCaseCreate.value = true;
    return;
  }
  showCreate.value = true;
  if (!props.caseId) void searchCases('');
}
async function saveCreate(): Promise<void> {
  if (saving.value || !props.canCreate) return;
  pendingCreate ??= { ...form, idempotencyKey: globalThis.crypto.randomUUID() };
  saving.value = true;
  error.value = '';
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  const original = pendingCreate;
  try {
    storeFinancialPending(scope, 'create', original);
    submitted = true;
    await createFee(original);
    if (!sameContext(originalIdentity)) return;
    clearFinancialPending(scope, 'create', original);
    pendingCreate = null;
    unknownCreate.value = false;
    showCreate.value = false;
    notice.value = '费用已创建';
    form.amount = '';
    form.note = '';
    await load();
  } catch (cause) {
    if (!sameContext(originalIdentity)) return;
    if (rejected(cause)) clearFinancialPending(scope, 'create', original);
    if (rejected(cause) || !submitted) pendingCreate = null;
    unknownCreate.value = pendingCreate !== null;
    error.value = message(cause);
  } finally {
    if (sameContext(originalIdentity)) saving.value = false;
  }
}
async function batch(
  command: 'launch' | 'delete',
  explicitIds?: string[],
): Promise<void> {
  const requestedIds = explicitIds ?? [...selected.value];
  if (saving.value || (pendingBatch === null && requestedIds.length === 0))
    return;
  if (
    (pendingBatch?.command ?? command) === 'launch'
      ? !props.canLaunch
      : !props.canDelete
  )
    return;
  if (pendingBatch === null) {
    const originals = requestedIds.map((id) => selectionSources.get(id));
    if (originals.some((row) => row === undefined)) {
      error.value = '所选原始费用信息不完整，请刷新并重新选择。';
      return;
    }
    const details = originals
      .map(
        (row) =>
          `${row!.businessNo} · ${row!.type}：${row!.amount} 元（${row!.status}）`,
      )
      .join('\n');
    const zeroLaunchNote =
      command === 'launch' &&
      originals.some((row) => row !== undefined && isZeroFeeAmount(row.amount))
        ? '\n其中零元费用将跳过并保留“未发起”状态。'
        : '';
    if (
      !globalThis.confirm(
        `${command === 'delete' ? `确认从费用台账移除 ${requestedIds.length} 条原始费用？历史记录将保留。` : '确认按以下原始金额分别发起未发起费用？'}${zeroLaunchNote}\n${details}\n样品净额仅用于展示，不作为财务指令。`,
      )
    )
      return;
  }
  pendingBatch ??= {
    command,
    body: {
      ids: [...requestedIds],
      idempotencyKey: globalThis.crypto.randomUUID(),
    },
  };
  saving.value = true;
  error.value = '';
  const originalIdentity = identity.value;
  const scope = pendingScope.value;
  let submitted = false;
  const original = pendingBatch;
  try {
    storeFinancialPending(scope, 'batch', original);
    submitted = true;
    const result = await batchFees(original.command, original.body);
    if (!sameContext(originalIdentity)) return;
    clearFinancialPending(scope, 'batch', original);
    const skippedZeroCount =
      original.command === 'launch'
        ? original.body.ids.filter((id) => {
            const row = selectionSources.get(id);
            return (
              row !== undefined &&
              isZeroFeeAmount(row.amount) &&
              !result.processedIds.includes(id)
            );
          }).length
        : 0;
    notice.value = `${result.processedCount} 条费用已${original.command === 'delete' ? '移除' : '发起'}，合计 ${result.amount} 元${skippedZeroCount > 0 ? `，${skippedZeroCount} 条零元费用已跳过` : ''}`;
    pendingBatch = null;
    unknownBatch.value = false;
    const remainingSelection = new Set(selected.value);
    for (const id of result.processedIds) remainingSelection.delete(id);
    selected.value = remainingSelection;
    await load();
  } catch (cause) {
    if (!sameContext(originalIdentity)) return;
    if (rejected(cause)) clearFinancialPending(scope, 'batch', original);
    if (rejected(cause) || !submitted) pendingBatch = null;
    unknownBatch.value = pendingBatch !== null;
    error.value = message(cause);
  } finally {
    if (sameContext(originalIdentity)) saving.value = false;
  }
}
async function setStatus(row: FeeRow, status: unknown): Promise<void> {
  if (
    row.sourceRows ||
    typeof status !== 'string' ||
    saving.value ||
    status === row.status ||
    !props.canUpdate ||
    unknownUpdate.value ||
    (status === '发起' && isZeroFeeAmount(row.amount))
  )
    return;
  saving.value = true;
  error.value = '';
  const originalIdentity = identity.value;
  try {
    await updateFee(row.id, { expectedVersion: row.version, status });
    if (!sameContext(originalIdentity)) return;
    await load();
  } catch (cause) {
    if (!sameContext(originalIdentity)) return;
    unknownUpdate.value = !rejected(cause);
    error.value = message(cause);
  } finally {
    if (sameContext(originalIdentity)) saving.value = false;
  }
}
async function setNote(row: FeeRow, value: unknown): Promise<void> {
  if (
    row.sourceRows ||
    typeof value !== 'string' ||
    saving.value ||
    !props.canUpdate ||
    unknownUpdate.value ||
    value === (row.note ?? '')
  )
    return;
  const originalIdentity = identity.value;
  saving.value = true;
  error.value = '';
  try {
    await updateFee(row.id, {
      expectedVersion: row.version,
      note: value.trim(),
    });
    if (originalIdentity !== identity.value) return;
    notice.value = '费用备注已保存';
    await load();
  } catch (cause) {
    if (originalIdentity !== identity.value) return;
    unknownUpdate.value = !rejected(cause);
    error.value = message(cause);
  } finally {
    if (originalIdentity === identity.value) saving.value = false;
  }
}
onBeforeUnmount(() => {
  active = false;
  requestRevision += 1;
  caseRevision += 1;
  request?.abort();
});
</script>

<template>
  <section class="fee-center">
    <header class="fee-center__heading">
      <div>
        <h2>费用中心</h2>
        <p>
          案件费用明细与费用中心使用同一条费用记录。发起不代表财务已接收或实际支付。
        </p>
      </div>
      <ElButton
        v-if="props.canCreate"
        type="primary"
        :disabled="saving"
        @click="openCreate"
        >新增费用</ElButton
      >
    </header>
    <div v-if="summary" class="fee-center__metrics">
      <div>
        <span>支出合计</span><strong>{{ summary.expense }} 元</strong>
      </div>
      <div>
        <span>收入合计</span><strong>{{ summary.income }} 元</strong>
      </div>
      <div>
        <span>待支付</span><strong>{{ summary.pending }} 元</strong
        ><small>{{ summary.pendingCount }} 笔已发起支出</small>
      </div>
    </div>
    <form class="fee-center__filters" @submit.prevent="applyFilter">
      <label
        >费用类型<ElSelect
          v-model="filters.type"
          clearable
          placeholder="全部类型"
          ><ElOption
            v-for="type in types"
            :key="type"
            :value="type"
            :label="type" /></ElSelect></label
      ><label
        >状态<ElSelect v-model="filters.status" clearable placeholder="全部状态"
          ><ElOption
            v-for="status in [...ordinaryStatuses, ...refundStatuses]"
            :key="status"
            :value="status"
            :label="status" /></ElSelect></label
      ><label
        >方向<ElSelect
          v-model="filters.direction"
          clearable
          placeholder="全部方向"
          ><ElOption value="支出" label="支出" /><ElOption
            value="收入"
            label="收入" /></ElSelect></label
      ><label>日期从<ElInput v-model="filters.from" type="date" /></label
      ><label>日期至<ElInput v-model="filters.to" type="date" /></label
      ><ElButton native-type="submit">查询</ElButton
      ><ElButton @click="clearFilter">清除</ElButton>
    </form>
    <div class="fee-center__toolbar">
      <span>已选 {{ selected.size }} 条 · 当前筛选 {{ total }} 条</span
      ><ElButton
        v-if="props.canLaunch"
        :disabled="
          saving || selected.size === 0 || unknownBatch || zeroOnlySelection
        "
        @click="batch('launch')"
        >批量发起</ElButton
      ><ElButton
        v-if="props.canDelete"
        type="danger"
        plain
        :disabled="saving || selected.size === 0 || unknownBatch"
        @click="batch('delete')"
        >删除</ElButton
      >
      <details>
        <summary>展示列</summary>
        <div class="fee-center__columns">
          <ElCheckbox
            v-for="key in columnKeys"
            :key="key"
            v-model="columns[key]"
            >{{ columnLabels[key] }}</ElCheckbox
          >
        </div>
      </details>
    </div>
    <p v-if="zeroOnlySelection" role="status">
      零元费用仅保留记录，不可发起；混选时零元费用将跳过。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="unknownBatch" role="status">
      结果尚未确认。<ElButton :disabled="saving" @click="batch('launch')"
        >重试原批量请求</ElButton
      >
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="state === 'loading'">正在读取费用…</p>
    <div v-else-if="state === 'failed'">
      <ElButton @click="load">重新读取</ElButton>
    </div>
    <p v-else-if="rows.length === 0">当前条件下暂无费用</p>
    <div v-else class="fee-center__table">
      <table>
        <thead>
          <tr>
            <th>
              <ElCheckbox
                :model-value="allSelected"
                aria-label="全选当前筛选费用"
                :disabled="unknownBatch"
                @change="toggleAll"
              />
            </th>
            <th
              v-for="key in columnKeys.filter((column) => columns[column])"
              :key="key"
            >
              {{ columnLabels[key] }}
            </th>
            <th>凭证</th>
            <th v-if="props.canDelete">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ row, key, isNet } in tableRows" :key="key">
            <td>
              <ElButton v-if="isNet" link @click="toggleGroup(row.id)">{{
                expandedGroups.has(row.id) ? '收起原始费用' : '展开原始费用'
              }}</ElButton>
              <ElCheckbox
                v-else
                :model-value="selected.has(row.id)"
                :aria-label="`选择 ${row.businessNo} ${row.type}`"
                :disabled="unknownBatch"
                @change="toggle(row.id)"
              />
            </td>
            <td v-if="columns.type">
              {{ row.type }}<small v-if="isNet">净额 · 仅展示</small>
              <small>
                ·
                {{
                  row.source === 'auto'
                    ? '公证来源'
                    : row.source === 'manual'
                      ? '手工登记'
                      : '来源待定'
                }}</small
              >
            </td>
            <td v-if="columns.direction">{{ row.direction }}</td>
            <td v-if="columns.amount" class="money">{{ row.amount }}</td>
            <td v-if="columns.status">
              <ElSelect
                v-if="!isNet"
                :model-value="row.status"
                :disabled="
                  saving || unknownBatch || unknownUpdate || !props.canUpdate
                "
                @change="setStatus(row, $event)"
                ><ElOption
                  v-for="status in row.type === '诉讼退费'
                    ? refundStatuses
                    : ordinaryStatuses"
                  :key="status"
                  :value="status"
                  :disabled="status === '发起' && isZeroFeeAmount(row.amount)"
                  :label="status" /></ElSelect
              ><small v-if="isZeroFeeAmount(row.amount) && !isNet">
                零元费用仅保留记录，不可标记为发起 </small
              ><span v-else-if="isNet">{{ row.status }}（代表状态）</span>
            </td>
            <td v-if="columns.date">{{ row.feeDate }}</td>
            <td v-if="columns.platform">{{ row.platform ?? '—' }}</td>
            <td v-if="columns.shop">{{ row.shopName ?? '—' }}</td>
            <td v-if="columns.defendant">
              {{ row.defendantNames.join('、') || '—' }}
            </td>
            <td v-if="columns.case">
              <RouterLink :to="`/cases/${row.caseId}`">{{
                row.courtCaseNo ?? row.businessNo
              }}</RouterLink>
            </td>
            <td v-if="columns.note">
              <ElInput
                v-if="props.canUpdate && !isNet"
                v-model="noteDrafts[row.id]"
                :aria-label="`${row.businessNo} ${row.type}备注`"
                :maxlength="500"
                :disabled="saving || unknownUpdate"
                @change="setNote(row, $event)"
              /><span v-else>{{ isNet ? '—' : row.note || '—' }}</span>
            </td>
            <td>
              <span v-if="isNet">凭证见各笔原始费用</span
              ><template v-else>
                <ElButton
                  v-if="row.proofContentVersionId"
                  link
                  @click="downloadProof(row)"
                  >{{ row.proofOriginalFilename || '下载凭证' }}</ElButton
                ><span v-else>未上传</span
                ><template v-if="props.canUpdate"
                  ><ElButton
                    link
                    :disabled="saving || unknownProof"
                    @click="chooseProof(row)"
                    >{{
                      row.proofContentVersionId ? '替换' : '上传凭证/发票'
                    }}</ElButton
                  ><ElButton
                    v-if="row.proofContentVersionId"
                    link
                    :disabled="saving || unknownProof"
                    @click="clearProof(row)"
                    >移除凭证</ElButton
                  ></template
                >
              </template>
            </td>
            <td v-if="props.canDelete">
              <ElButton
                v-if="!isNet"
                link
                type="danger"
                :disabled="saving || unknownBatch"
                @click="batch('delete', [row.id])"
                >移除费用</ElButton
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="fee-center__pager">
      <ElButton :disabled="page <= 1 || state === 'loading'" @click="page -= 1"
        >上一页</ElButton
      ><span>{{ page }} / {{ pageCount }}</span
      ><ElButton
        :disabled="page >= pageCount || state === 'loading'"
        @click="page += 1"
        >下一页</ElButton
      >
    </div>
    <input
      ref="proofInput"
      type="file"
      accept=".pdf,.jpg,.jpeg,.png"
      hidden
      @change="uploadProof"
    />
    <p v-if="unknownProof" role="alert">
      凭证保存结果尚未确认。请保留原请求核对。<ElButton
        :disabled="saving"
        @click="saveProof"
        >用原请求重试保存</ElButton
      >
    </p>
    <p v-if="unknownUpdate" role="alert">
      费用修改结果尚未确认。<ElButton :disabled="saving" @click="load"
        >刷新并核对当前费用</ElButton
      >
    </p>
    <CaseFeeEntryDialog
      v-if="props.caseId && props.canCreate"
      :key="identity + props.caseId"
      v-model:open="showCaseCreate"
      :case-id="props.caseId"
      :can-create="props.canCreate"
      @saved="load"
    />
    <ElDialog
      v-model="showCreate"
      title="新增费用"
      width="min(680px, 94vw)"
      :close-on-click-modal="!unknownCreate"
      ><form class="fee-center__create" @submit.prevent="saveCreate">
        <label v-if="!props.caseId"
          >关联案件<ElSelect
            v-model="form.caseId"
            filterable
            remote
            :remote-method="searchCases"
            :loading="caseLoading"
            :disabled="saving || unknownCreate"
            placeholder="搜索店铺、权利主体、被告或案号"
            ><ElOption
              v-for="item in caseOptions"
              :key="item.id"
              :value="item.id"
              :label="`${item.businessNo} · ${item.shopName ?? item.customerName} · ${item.rightsHolderName}`" /></ElSelect
          ><ElButton
            v-if="caseOptions.length < caseTotal"
            text
            :disabled="caseLoading"
            @click="
              casePage += 1;
              searchCases(caseQuery, true);
            "
            >加载更多案件</ElButton
          ></label
        ><label
          >费用类型<ElSelect
            v-model="form.type"
            :disabled="saving || unknownCreate"
            ><ElOption
              v-for="type in types"
              :key="type"
              :value="type"
              :label="type" /></ElSelect></label
        ><label
          >方向<ElSelect
            v-model="form.direction"
            :disabled="saving || unknownCreate"
            ><ElOption value="支出" label="支出" /><ElOption
              value="收入"
              label="收入" /></ElSelect></label
        ><label
          >金额（元）<ElInput
            v-model="form.amount"
            :disabled="saving || unknownCreate"
            inputmode="decimal"
            placeholder="填写正金额" /></label
        ><label
          >状态<ElSelect
            v-model="form.status"
            :disabled="saving || unknownCreate"
            ><ElOption
              v-for="status in formStatuses"
              :key="status"
              :value="status"
              :label="status" /></ElSelect></label
        ><label
          >日期<ElInput
            v-model="form.feeDate"
            type="date"
            :disabled="saving || unknownCreate" /></label
        ><label
          >备注<ElInput
            v-model="form.note"
            maxlength="500"
            :disabled="saving || unknownCreate"
        /></label>
        <p v-if="unknownCreate" role="status">
          结果尚未确认，重试将使用原案件、金额、日期及请求键。
        </p>
        <ElButton
          type="primary"
          native-type="submit"
          :loading="saving"
          :disabled="!form.caseId"
          >{{ unknownCreate ? '重试原创建请求' : '创建费用' }}</ElButton
        >
      </form></ElDialog
    >
  </section>
</template>

<style scoped>
.fee-center {
  display: grid;
  gap: 16px;
  color: var(--color-ink);
}
.fee-center__heading,
.fee-center__toolbar,
.fee-center__pager {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.fee-center__heading {
  justify-content: space-between;
}
h2,
p {
  margin: 0;
}
.fee-center__heading p {
  color: var(--color-ink-muted);
  font-size: 12px;
  margin-top: 6px;
}
.fee-center__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--color-hairline);
}
.fee-center__metrics > div {
  display: grid;
  gap: 6px;
  padding: 16px;
  border-right: 1px solid var(--color-hairline);
}
.fee-center__metrics > div:last-child {
  border-right: 0;
}
.fee-center__metrics span,
small {
  color: var(--color-ink-muted);
  font-size: 12px;
}
.fee-center__metrics strong {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.fee-center__filters,
.fee-center__create {
  display: flex;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
}
label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  min-width: 140px;
}
.fee-center__create label {
  flex: 1 1 220px;
}
.fee-center__create label:first-child {
  flex-basis: 100%;
}
.fee-center__toolbar > span {
  margin-right: auto;
  font-size: 12px;
}
.fee-center__columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.fee-center__table {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}
th,
td {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid var(--color-hairline);
  font-size: 12px;
}
th {
  color: var(--color-ink-muted);
  background: var(--color-surface-2);
  font-weight: 500;
}
td .el-select {
  width: 110px;
}
.money {
  font-variant-numeric: tabular-nums;
}
.fee-center__pager {
  justify-content: end;
  font-size: 12px;
}
[role='alert'] {
  color: var(--color-danger);
}
@media (max-width: 700px) {
  .fee-center__metrics {
    grid-template-columns: 1fr;
  }
  .fee-center__metrics > div {
    border-right: 0;
    border-bottom: 1px solid var(--color-hairline);
  }
}
</style>
