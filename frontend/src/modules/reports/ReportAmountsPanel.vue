<script lang="ts">
// Presentation seam only. The host supplies server amounts and rate text;
// this component does not aggregate money or choose rounding precision.
export type ReportAmountBucket =
  'LT_100000' | '100000_TO_300000' | '300000_TO_500000' | 'GTE_500000';
export type ReportAmountsView = {
  totalCases: number;
  archivedCases: number;
  knownAmountCases: number;
  unknownAmountCases: number;
  cumulativeAmountText: string | null;
  closureRatePercentText: string | null;
  buckets: ReadonlyArray<{ key: ReportAmountBucket; count: number }>;
};
</script>

<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{
  view: ReportAmountsView | null;
  part?: 'all' | 'total' | 'rate' | 'buckets';
}>();
const bucketDefinitions: ReadonlyArray<{
  key: ReportAmountBucket;
  label: string;
  boundary: string;
}> = [
  {
    key: 'LT_100000',
    label: '10 万以下',
    boundary: '0 元（含）至 10 万元（不含）',
  },
  {
    key: '100000_TO_300000',
    label: '10-30 万',
    boundary: '10 万元（含）至 30 万元（不含）',
  },
  {
    key: '300000_TO_500000',
    label: '30-50 万',
    boundary: '30 万元（含）至 50 万元（不含）',
  },
  { key: 'GTE_500000', label: '50 万以上', boundary: '50 万元（含）以上' },
];
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
const valid = computed(() => {
  const view = props.view;
  if (
    !view ||
    ![
      view.totalCases,
      view.archivedCases,
      view.knownAmountCases,
      view.unknownAmountCases,
    ].every(count)
  )
    return false;
  if (
    view.archivedCases > view.totalCases ||
    view.knownAmountCases + view.unknownAmountCases !== view.totalCases
  )
    return false;
  if (
    view.knownAmountCases === 0
      ? view.cumulativeAmountText !== null
      : typeof view.cumulativeAmountText !== 'string' ||
        !/^(?:0|[1-9]\d*)\.\d{2}$/u.test(view.cumulativeAmountText)
  )
    return false;
  if (
    view.totalCases === 0
      ? view.closureRatePercentText !== null
      : typeof view.closureRatePercentText !== 'string' ||
        !/^(?:100(?:\.0+)?|(?:0|[1-9]\d?)(?:\.\d+)?)$/u.test(
          view.closureRatePercentText,
        )
  )
    return false;
  if (
    !Array.isArray(view.buckets) ||
    view.buckets.length !== 4 ||
    !view.buckets.every(
      (row, i) =>
        row && row.key === bucketDefinitions[i]?.key && count(row.count),
    )
  )
    return false;
  return (
    view.buckets.reduce((sum, row) => sum + row.count, 0) ===
    view.knownAmountCases
  );
});
const rows = computed(() => {
  if (!valid.value || !props.view) return [];
  const maximum = props.view.buckets.reduce(
    (maximum, row) => Math.max(maximum, row.count),
    1,
  );
  return props.view.buckets.map((row, i) => ({
    ...bucketDefinitions[i],
    count: row.count,
    width: `${(row.count / maximum) * 100}%`,
  }));
});
</script>

<template>
  <div
    class="report-amounts"
    :class="{ 'report-amounts--partial': part && part !== 'all' }"
  >
    <section
      class="amount-card"
      aria-label="累计标的额"
      data-test="report-cumulative-amount"
      v-if="!part || part === 'all' || part === 'total'"
    >
      <h2>累计标的额</h2>
      <p v-if="!view" role="status">统计未读取</p>
      <p v-else-if="!valid" role="alert">统计数据无效，请重新读取。</p>
      <template v-else>
        <p v-if="view.cumulativeAmountText !== null" class="amount-value">
          <span data-test="report-cumulative-decimal">{{
            view.cumulativeAmountText
          }}</span>
          <span class="amount-unit">元</span>
        </p>
        <p v-else role="status">
          {{ view.totalCases === 0 ? '暂无数据' : '暂无已知标的额' }}
        </p>
        <p class="amount-note">
          已知金额 {{ view.knownAmountCases }} 件；未知金额
          {{ view.unknownAmountCases }} 件。
        </p>
        <p class="amount-note">
          仅累计已知标的额，0 元计入；未知金额不按 0 元计算。
        </p>
      </template>
    </section>
    <section
      class="amount-card"
      aria-label="结案率"
      data-test="report-closure-rate"
      v-if="!part || part === 'all' || part === 'rate'"
    >
      <h2>结案率</h2>
      <p v-if="!view" role="status">统计未读取</p>
      <p v-else-if="!valid" role="alert">统计数据无效，请重新读取。</p>
      <template v-else>
        <p
          v-if="view.closureRatePercentText !== null"
          class="amount-value"
          data-test="report-closure-percent"
        >
          {{ view.closureRatePercentText }} %
        </p>
        <p v-else role="status">暂无数据</p>
        <p class="amount-note">
          已归档 {{ view.archivedCases }} / 全部 {{ view.totalCases }} 件
        </p>
      </template>
    </section>
    <section
      class="amount-card amount-buckets"
      aria-label="标的额区间分布"
      data-test="report-amount-buckets"
      v-if="!part || part === 'all' || part === 'buckets'"
    >
      <h2>标的额区间分布</h2>
      <p v-if="!view" role="status">统计未读取</p>
      <p v-else-if="!valid" role="alert">统计数据无效，请重新读取。</p>
      <template v-else>
        <p v-if="view.knownAmountCases === 0" role="status">
          {{ view.totalCases === 0 ? '暂无数据' : '暂无已知标的额' }}
        </p>
        <ol v-else class="bucket-list" aria-label="已知标的额分档案件数量">
          <li v-for="row in rows" :key="row.key" :title="row.boundary">
            <div class="bucket-row">
              <span>{{ row.label }}</span
              ><span class="bucket-count">{{ row.count }} 件</span>
            </div>
            <div class="bucket-track" aria-hidden="true">
              <span :style="{ width: row.width }" />
            </div>
            <span class="bucket-boundary">{{ row.boundary }}</span>
          </li>
        </ol>
        <p class="amount-note" data-test="report-amount-coverage">
          已知金额 {{ view.knownAmountCases }} 件；未知金额
          {{ view.unknownAmountCases }} 件，未纳入分档。
        </p>
        <p v-if="view.knownAmountCases > 0" class="amount-note">
          条长比较件数，非占比。
        </p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.report-amounts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}
.report-amounts--partial {
  display: contents;
}
.amount-card {
  min-width: 0;
  padding: var(--s-5);
  border: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
}
.amount-card h2 {
  margin: 0 0 var(--s-4);
  font-size: 1rem;
  color: var(--color-ink);
}
.amount-value {
  font: 600 1.5rem var(--font-mono);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.amount-unit {
  font-size: 0.875rem;
  font-weight: 400;
}
.amount-note,
.bucket-boundary {
  color: var(--color-ink-muted);
  font-size: 0.875rem;
}
.amount-note {
  margin-block: var(--s-3) 0;
}
.amount-buckets {
  grid-column: 1 / -1;
}
.bucket-list {
  display: grid;
  gap: var(--s-3);
  list-style: none;
  padding: 0;
  margin: 0;
}
.bucket-row {
  display: flex;
  justify-content: space-between;
  gap: var(--s-3);
}
.bucket-count {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.bucket-track {
  height: 5px;
  margin-block: var(--s-2);
  background: var(--color-surface-2);
}
.bucket-track span {
  display: block;
  height: 100%;
  background: var(--color-primary);
}
@media (max-width: 640px) {
  .report-amounts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
