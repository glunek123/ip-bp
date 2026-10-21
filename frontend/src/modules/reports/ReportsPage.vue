<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getReportsCapability,
  getReportsCenter,
  type ReportsCenter,
  type ReportsView,
} from '../../api/reports';
import { useAuthStore } from '../../stores/auth';
import { createReportsExportController } from '../../api/reports-export';
import ReportSummaryPanel, {
  type LoadReportSummary,
} from './ReportSummaryPanel.vue';
import ReportDistributionsPanel from './ReportDistributionsPanel.vue';
import ReportAmountsPanel, {
  type ReportAmountsView,
} from './ReportAmountsPanel.vue';

const auth = useAuthStore();
const route = useRoute();
const sessionEpoch = ref(0);
watch(
  () => auth.session,
  () => {
    sessionEpoch.value += 1;
  },
  { flush: 'sync' },
);
const actorKey = computed(
  () => `${auth.session?.principalType ?? ''}:${auth.session?.user.id ?? ''}`,
);
const scopeKey = computed(() => auth.session?.department?.id ?? '');
const requestedView = ref<ReportsView>();
const confirmedView = ref<ReportsView>();
const availableViews = ref<ReportsView[]>([]);
const identityContext = computed(() =>
  JSON.stringify([
    actorKey.value,
    scopeKey.value,
    auth.session?.authorizationRevision,
    sessionEpoch.value,
    route.fullPath,
  ]),
);
const contextKey = computed(() =>
  JSON.stringify([identityContext.value, requestedView.value]),
);
const access = ref<'checking' | 'allowed' | 'denied'>('checking');
const capabilityFailed = ref(false);
const overview = ref<ReportsCenter | null>(null);
const selectedView = computed(
  () => requestedView.value ?? confirmedView.value ?? '',
);
const viewLabel = computed(() =>
  selectedView.value === 'mine'
    ? '本人负责'
    : selectedView.value === 'department'
      ? '本部门全部'
      : '当前范围',
);
function changeView(event: globalThis.Event): void {
  const value = (event.target as globalThis.HTMLSelectElement).value;
  if (
    (value === 'mine' || value === 'department') &&
    availableViews.value.includes(value)
  )
    requestedView.value = value;
}
const amountsView = computed<ReportAmountsView | null>(() =>
  overview.value
    ? {
        totalCases: overview.value.totalCases,
        archivedCases: overview.value.archivedCases,
        knownAmountCases: overview.value.money.knownCases,
        unknownAmountCases: overview.value.money.unknownCases,
        cumulativeAmountText: overview.value.money.total.amount,
        closureRatePercentText: overview.value.closureRate.percent,
        buckets: overview.value.money.buckets.map((row, i) => ({
          key: (
            [
              'LT_100000',
              '100000_TO_300000',
              '300000_TO_500000',
              'GTE_500000',
            ] as const
          )[i]!,
          count: row.count,
        })),
      }
    : null,
);
let epoch = 0;
let active = true;
let mounted = true;
let capabilityController: AbortController | undefined;
const exporting = ref(false),
  exportError = ref(''),
  exportDeniedKey = ref('');
let exportGeneration = 0;
const exportContextKey = computed(() =>
  JSON.stringify([
    contextKey.value,
    epoch,
    overview.value?.view ?? confirmedView.value,
  ]),
);
const canExport = computed(
  () =>
    mounted &&
    active &&
    access.value === 'allowed' &&
    overview.value !== null &&
    overview.value.view === selectedView.value &&
    overview.value.exportViews.includes(overview.value.view) &&
    exportDeniedKey.value !== exportContextKey.value,
);
const csvExport = createReportsExportController(() => ({
  actorKey: actorKey.value,
  contextKey: exportContextKey.value,
  view: overview.value?.view ?? confirmedView.value ?? 'mine',
  canExport: canExport.value,
}));
function invalidateExport(): void {
  exportGeneration += 1;
  csvExport.cancel();
  exporting.value = false;
  exportError.value = '';
  exportDeniedKey.value = '';
}
async function exportCurrentReport(): Promise<void> {
  if (!canExport.value || exporting.value) return;
  const generation = exportGeneration,
    key = exportContextKey.value;
  exporting.value = true;
  exportError.value = '';
  try {
    await csvExport.download();
  } catch (cause) {
    if (generation !== exportGeneration || key !== exportContextKey.value)
      return;
    if (cause instanceof ApiError && cause.status === 401) {
      clear();
      access.value = 'denied';
      return;
    }
    if (cause instanceof ApiError && cause.status === 403) {
      exportDeniedKey.value = key;
      exportError.value = '当前范围暂不可导出，请刷新报表后重试。';
    } else exportError.value = '报表导出失败，请稍后重试。';
  } finally {
    if (generation === exportGeneration) exporting.value = false;
  }
}
function clear(): void {
  invalidateExport();
  epoch += 1;
  capabilityController?.abort();
  capabilityController = undefined;
  overview.value = null;
  access.value = 'checking';
  capabilityFailed.value = false;
}
function current(
  generation: number,
  key: string,
  signal: globalThis.AbortSignal,
): boolean {
  return (
    mounted &&
    active &&
    !signal.aborted &&
    epoch === generation &&
    contextKey.value === key
  );
}
async function checkAccess(): Promise<void> {
  clear();
  if (!mounted || !active) return;
  if (auth.session?.principalType !== 'INTERNAL' || !scopeKey.value) {
    access.value = 'denied';
    return;
  }
  const generation = epoch,
    key = contextKey.value;
  capabilityController = new AbortController();
  const signal = capabilityController.signal;
  try {
    const capability = await getReportsCapability({ signal });
    if (current(generation, key, signal))
      access.value = capability.canRead ? 'allowed' : 'denied';
  } catch (cause) {
    if (!current(generation, key, signal)) return;
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    )
      access.value = 'denied';
    else capabilityFailed.value = true;
  }
}
const loadApprovedAverage: LoadReportSummary = async (options) => {
  invalidateExport();
  const generation = epoch,
    key = contextKey.value;
  overview.value = null;
  try {
    if (access.value !== 'allowed' || !active || !mounted)
      throw new ApiError('当前无法读取报表', 403, 'FORBIDDEN');
    const result = await getReportsCenter(
      requestedView.value ?? confirmedView.value,
      options,
    );
    if (!current(generation, key, options.signal) || access.value !== 'allowed')
      throw new Error('Stale report context');
    overview.value = result;
    confirmedView.value = result.view;
    availableViews.value = [...result.availableViews];
    if (result.status === 'VALUE')
      return { kind: 'value', decimalText: result.amount };
    if (result.status === 'NO_RECORDS')
      return { kind: 'no-records', messageText: '暂无数据' };
    return {
      kind: 'unavailable',
      messageText: '已归档案件暂无已知标的额，平均标的额暂不可用。',
    };
  } catch (cause) {
    if (current(generation, key, options.signal)) {
      overview.value = null;
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.status === 403)
      )
        access.value = 'denied';
    }
    throw cause;
  }
};
watch(
  identityContext,
  () => {
    clear();
    requestedView.value = undefined;
    confirmedView.value = undefined;
    availableViews.value = [];
    const queued = epoch;
    void Promise.resolve().then(() => {
      if (epoch === queued && mounted && active) return checkAccess();
    });
  },
  { immediate: true, flush: 'sync' },
);
watch(
  requestedView,
  () => {
    invalidateExport();
    epoch += 1;
    capabilityController?.abort();
    overview.value = null;
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  active = false;
  clear();
});
onActivated(() => {
  if (!active) {
    active = true;
    void checkAccess();
  }
});
onBeforeUnmount(() => {
  mounted = false;
  active = false;
  clear();
});
</script>

<template>
  <main class="page-view reports-page">
    <header class="page-head">
      <div>
        <h1>数据报表</h1>
        <p class="reports-subtitle">
          {{ viewLabel }} · 当前案件数：<span data-test="report-header-count">{{
            overview ? overview.totalCases : '统计未读取'
          }}</span>
        </p>
      </div>
      <label
        v-if="availableViews.length && access === 'allowed'"
        class="reports-view-picker"
        >统计范围
        <select
          data-test="report-view"
          :value="selectedView"
          @change="changeView"
        >
          <option v-for="view in availableViews" :key="view" :value="view">
            {{ view === 'mine' ? '本人负责' : '本部门全部' }}
          </option>
        </select>
      </label>
      <div class="reports-export">
        <ElButton
          :disabled="!canExport || exporting"
          :loading="exporting"
          data-test="export-reports"
          aria-describedby="reports-export-note"
          @click="exportCurrentReport"
          >导出报表</ElButton
        >
        <p id="reports-export-note">
          {{
            overview && !canExport
              ? '当前范围暂不可导出'
              : exporting
                ? '正在准备报表…'
                : overview
                  ? '导出当前范围报表'
                  : '请先读取当前范围报表'
          }}
        </p>
        <p v-if="exportError" role="alert" data-test="report-export-error">
          {{ exportError }}
        </p>
      </div>
    </header>
    <div class="reports-kpis" aria-label="报表指标">
      <section class="reports-card" aria-label="案件总数">
        <h2>案件总数</h2>
        <p data-test="report-total-count">
          {{ overview ? `${overview.totalCases} 件` : '统计未读取' }}
        </p>
        <p data-test="report-in-progress-count">
          进行中：{{
            overview ? `${overview.inProgressCases} 件` : '统计未读取'
          }}
        </p>
      </section>
      <ReportAmountsPanel :view="amountsView" part="total" />
      <section
        v-if="capabilityFailed"
        class="reports-card"
        aria-label="已归档案件平均标的额"
      >
        <h2>已归档案件平均标的额</h2>
        <p role="alert">报表读取权限暂时无法核对，请重试。</p>
        <ElButton data-test="retry-report-capability" @click="checkAccess"
          >重试</ElButton
        >
      </section>
      <ReportSummaryPanel
        v-else
        :actor-key="actorKey"
        :context-key="contextKey"
        :scope-key="scopeKey"
        :access="access"
        :load="loadApprovedAverage"
      />
      <ReportAmountsPanel :view="amountsView" part="rate" />
    </div>
    <p class="reports-definition">
      平均标的额口径：当前范围累计已归档案件，仅计标的金额已知的案件，0元计入；无样本显示“暂无数据”，人民币保留两位小数。
    </p>
    <p v-if="overview" class="reports-definition" data-test="report-metadata">
      已归档 {{ overview.archivedCases }} 件，均值仅含已知标的额 · 口径
      {{ overview.definitionVersion }} · 生成时间
      <time :datetime="overview.generatedAt">{{ overview.generatedAt }}</time>
    </p>
    <ReportDistributionsPanel
      :view="
        overview
          ? { totalCases: overview.totalCases, ...overview.distributions }
          : null
      "
      :scope-label="viewLabel"
    />
    <ReportAmountsPanel :view="amountsView" part="buckets" />
  </main>
</template>

<style scoped>
.reports-kpis,
.reports-distributions {
  display: grid;
  gap: var(--s-4);
}
.reports-kpis {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.reports-distributions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.reports-card {
  padding: var(--s-5);
  border: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
}
.reports-card h2 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-ink);
}
.reports-card p,
.reports-subtitle,
.reports-definition,
.reports-export p {
  color: var(--color-ink-muted);
}
.reports-definition {
  margin-block: var(--s-4);
}
.reports-export p {
  margin-block: var(--s-2) 0;
  font-size: 0.875rem;
}
@media (max-width: 1100px) {
  .reports-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .reports-kpis,
  .reports-distributions {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
