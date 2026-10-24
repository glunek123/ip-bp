<script lang="ts">
import type { LeadCaseType, LeadPlatform } from '../../api/leads';

// Pure presentation seam; the API decoder supplies the approved snapshot.
export type ReportDistributionsView = {
  totalCases: number;
  types: ReadonlyArray<{ value: LeadCaseType | null; count: number }>;
  platforms: ReadonlyArray<{ value: LeadPlatform | null; count: number }>;
  courts: ReadonlyArray<{ id: string; name: string; count: number }>;
  unrecordedCourtCases: number;
};
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { labelLeadPlatform } from '../leads';

const props = defineProps<{
  view: ReportDistributionsView | null;
  scopeLabel?: string;
}>();
const typeLabels: Record<LeadCaseType, string> = {
  CIVIL: '民事',
  CRIMINAL: '刑事',
  ADMINISTRATIVE: '行政',
  INVESTIGATION: '调查',
  NOTARIZATION: '公证',
  HEARING_REPRESENTATION: '开庭代理',
};
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const label = (value: string) =>
  typeof value === 'string' && value.trim().length > 0;
const valid = computed(() => {
  const view = props.view;
  if (!view) return false;
  if (!count(view.totalCases) || !count(view.unrecordedCourtCases))
    return false;
  for (const rows of [view.types, view.platforms]) {
    if (
      !Array.isArray(rows) ||
      !rows.every(
        (row) =>
          row &&
          count(row.count) &&
          row.count > 0 &&
          (row.value === null || label(row.value)),
      )
    )
      return false;
    if (new Set(rows.map((row) => row.value)).size !== rows.length)
      return false;
    if (rows.reduce((sum, row) => sum + row.count, 0) !== view.totalCases)
      return false;
  }
  if (
    !view.platforms.every(
      (row) =>
        row.value === null || typeof labelLeadPlatform(row.value) === 'string',
    ) ||
    !view.types.every(
      (row) => row.value === null || Object.hasOwn(typeLabels, row.value),
    )
  )
    return false;
  if (
    !Array.isArray(view.courts) ||
    view.courts.length > 5 ||
    !view.courts.every(
      (row) =>
        row &&
        label(row.id) &&
        label(row.name) &&
        count(row.count) &&
        row.count > 0,
    )
  )
    return false;
  if (new Set(view.courts.map((row) => row.id)).size !== view.courts.length)
    return false;
  return (
    view.courts.reduce(
      (sum, row) => sum + row.count,
      view.unrecordedCourtCases,
    ) <= view.totalCases
  );
});
const sections = computed(() => {
  const view = props.view;
  const groups =
    valid.value && view
      ? [
          view.platforms.map((row) => ({
            key: JSON.stringify(row.value),
            label: row.value === null ? '未登记' : labelLeadPlatform(row.value),
            count: row.count,
          })),
          view.types.map((row) => ({
            key: JSON.stringify(row.value),
            label: row.value === null ? '未登记' : typeLabels[row.value],
            count: row.count,
          })),
          view.courts.map((row) => ({
            key: row.id,
            label: row.name,
            count: row.count,
          })),
        ]
      : [[], [], []];
  return [
    { key: 'platforms', title: '平台分布' },
    { key: 'types', title: '案件类型分布' },
    { key: 'courts', title: '立案法院 TOP 5' },
  ].map((section, index) => {
    const rows = groups[index] ?? [];
    const maximum = rows.reduce(
      (maximum, row) => Math.max(maximum, row.count),
      1,
    );
    return {
      ...section,
      rows: rows.map((row) => ({
        ...row,
        width: `${(row.count / maximum) * 100}%`,
      })),
    };
  });
});
</script>

<template>
  <div class="report-distributions">
    <section
      v-for="section in sections"
      :key="section.key"
      class="distribution-card"
      :aria-label="section.title"
      :data-test="`report-distribution-${section.key}`"
    >
      <h2>{{ section.title }}</h2>
      <p v-if="!view" role="status">统计未读取</p>
      <p v-else-if="!valid" role="alert">统计数据无效，请重新读取。</p>
      <template v-else>
        <p v-if="section.rows.length === 0" role="status">
          {{ view.totalCases === 0 ? '暂无数据' : '暂无已登记法院' }}
        </p>
        <ol
          v-else
          class="distribution-list"
          :aria-label="`${section.title}案件数量`"
        >
          <li
            v-for="row in section.rows"
            :key="row.key"
            :data-distribution-key="row.key"
          >
            <div class="distribution-row">
              <span class="distribution-label">{{ row.label }}</span>
              <span class="distribution-count">{{ row.count }} 件</span>
            </div>
            <div class="distribution-track" aria-hidden="true">
              <span :style="{ width: row.width }" />
            </div>
          </li>
        </ol>
        <p
          v-if="section.key === 'courts'"
          class="distribution-note"
          data-test="report-court-coverage"
        >
          仅展示已登记法院的前 5 项；未登记法院
          {{ view.unrecordedCourtCases }} 件。前 5 项不代表全部法院。
        </p>
        <p v-else class="distribution-note">
          {{ scopeLabel ?? '本部门' }}累计案件；未登记单独列示。
        </p>
        <p v-if="section.rows.length" class="distribution-note">
          条长比较件数，非占比。
        </p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.report-distributions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}
.distribution-card {
  min-width: 0;
  padding: var(--s-5);
  border: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
}
.distribution-card h2 {
  margin: 0 0 var(--s-4);
  font-size: 1rem;
  color: var(--color-ink);
}
.distribution-list {
  display: grid;
  gap: var(--s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.distribution-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
}
.distribution-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.distribution-count {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.distribution-track {
  height: 5px;
  margin-top: var(--s-2);
  background: var(--color-surface-2);
}
.distribution-track span {
  display: block;
  height: 100%;
  background: var(--color-primary);
}
.distribution-note {
  margin-block: var(--s-3) 0;
  color: var(--color-ink-muted);
  font-size: 0.875rem;
}
@media (max-width: 640px) {
  .report-distributions {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
