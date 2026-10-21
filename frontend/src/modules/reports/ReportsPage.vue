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
  getReportsOverview,
  type ReportsOverview,
} from '../../api/reports';
import { useAuthStore } from '../../stores/auth';
import ReportSummaryPanel, {
  type LoadReportSummary,
} from './ReportSummaryPanel.vue';

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
const contextKey = computed(() =>
  JSON.stringify([
    actorKey.value,
    scopeKey.value,
    auth.session?.authorizationRevision,
    sessionEpoch.value,
    route.fullPath,
  ]),
);
const access = ref<'checking' | 'allowed' | 'denied'>('checking');
const capabilityFailed = ref(false);
const overview = ref<ReportsOverview | null>(null);
let epoch = 0;
let active = true;
let mounted = true;
let capabilityController: AbortController | undefined;
function clear(): void {
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
const distributions = [
  { key: 'platforms', title: '平台分布' },
  { key: 'types', title: '案件类型分布' },
  { key: 'courts', title: '立案法院 TOP 5' },
  { key: 'amount-buckets', title: '标的额区间分布' },
];
const loadApprovedAverage: LoadReportSummary = async (options) => {
  const generation = epoch,
    key = contextKey.value;
  overview.value = null;
  try {
    if (access.value !== 'allowed' || !active || !mounted)
      throw new ApiError('当前无法读取报表', 403, 'FORBIDDEN');
    const result = await getReportsOverview(options);
    if (!current(generation, key, options.signal) || access.value !== 'allowed')
      throw new Error('Stale report context');
    overview.value = result;
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
  contextKey,
  () => {
    clear();
    const queued = epoch;
    void Promise.resolve().then(() => {
      if (epoch === queued && mounted && active) return checkAccess();
    });
  },
  { immediate: true, flush: 'sync' },
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
          本部门 · 当前案件数：<span data-test="report-header-count">{{
            overview ? overview.totalCases : '统计未读取'
          }}</span>
        </p>
      </div>
      <div class="reports-export">
        <ElButton
          disabled
          data-test="export-reports"
          aria-describedby="reports-export-note"
          >导出报表</ElButton
        >
        <p id="reports-export-note">导出范围与权限待确认</p>
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
      <section
        class="reports-card"
        aria-label="累计标的额"
        data-test="report-pending-total-amount"
      >
        <h2>累计标的额</h2>
        <p role="status">口径待确认</p>
      </section>
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
      <section
        class="reports-card"
        aria-label="结案率"
        data-test="report-pending-close-rate"
      >
        <h2>结案率</h2>
        <p role="status">口径待确认</p>
      </section>
    </div>
    <p class="reports-definition">
      平均标的额口径：本部门累计已归档案件，仅计标的金额已知的案件，0元计入；无样本显示“暂无数据”，人民币保留两位小数。
    </p>
    <p v-if="overview" class="reports-definition" data-test="report-metadata">
      已归档 {{ overview.archivedCases }} 件，均值仅含已知标的额 · 口径
      {{ overview.definitionVersion }} · 生成时间
      <time :datetime="overview.generatedAt">{{ overview.generatedAt }}</time>
    </p>
    <div class="reports-distributions" aria-label="分布与法院统计">
      <section
        v-for="item in distributions"
        :key="item.key"
        class="reports-card"
        :aria-label="item.title"
        :data-test="`report-pending-${item.key}`"
      >
        <h2>{{ item.title }}</h2>
        <p role="status">口径待确认</p>
      </section>
    </div>
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
