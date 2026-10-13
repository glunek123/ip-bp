<script setup lang="ts">
import { computed } from 'vue';
import type { CalendarMetric, CalendarSummary } from '../../api/calendar';

// Presentation inputs only. Counts come from the authorized server projection,
// never from the events in the selected month.
const props = withDefaults(
  defineProps<{
    metrics: CalendarSummary['metrics'] | null;
    window: CalendarSummary['window'] | null;
    canRead: boolean;
    loading?: boolean;
    error?: string | null;
  }>(),
  { loading: false, error: null },
);
const cards = computed(() => [
  { key: 'next30', label: '30天内待办', metric: props.metrics?.next30 },
  { key: 'court', label: '开庭', metric: props.metrics?.court },
  { key: 'pay', label: '缴费截止', metric: props.metrics?.pay },
  { key: 'contract', label: '协议到期', metric: props.metrics?.contract },
  { key: 'other', label: '重要节点', metric: props.metrics?.other },
]);
const ready = computed(
  () =>
    props.canRead && !props.loading && !props.error && props.metrics !== null,
);
function displayCount(metric: CalendarMetric | undefined): string {
  if (!props.canRead) return '无查看权限';
  if (props.loading) return '加载中';
  if (props.error) return '暂不可用';
  if (!metric) return '待加载';
  if (metric.state === 'NOT_CONNECTED') return '未接入';
  if (metric.state === 'FORBIDDEN') return '无查看权限';
  return String(metric.count);
}
</script>

<template>
  <section
    class="calendar-statistics"
    aria-label="日历统计"
    :aria-busy="loading"
  >
    <dl class="calendar-statistics-cards">
      <div v-for="card in cards" :key="card.key" :data-statistic="card.key">
        <dt>{{ card.label }}</dt>
        <dd>{{ displayCount(card.metric) }}</dd>
        <p
          v-if="
            ready &&
            card.metric?.state === 'AVAILABLE' &&
            card.metric.nearestDate
          "
          class="field-help"
        >
          最近：<time :datetime="card.metric.nearestDate">{{
            card.metric.nearestDate
          }}</time>
        </p>
      </div>
    </dl>
    <p v-if="ready" class="field-help">
      统计范围为当前有权查看的全部已接入事件，不随切月变化。30天内待办<span
        v-if="window"
        >（{{ window.from }}至{{ window.through }}，含两端）</span
      >以服务端上海当天为起点；未接入类别不计入。
    </p>
  </section>
</template>

<style scoped>
.calendar-statistics-cards {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--s-4);
  margin: 0 0 var(--s-4);
}
.calendar-statistics-cards > div {
  padding: var(--s-4);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-surface-1);
}
.calendar-statistics-cards dt {
  color: var(--color-ink-muted);
}
.calendar-statistics-cards dd {
  margin: var(--s-3) 0 0;
  font: 600 24px/1.3 var(--font-mono);
  color: var(--color-ink);
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .calendar-statistics-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
