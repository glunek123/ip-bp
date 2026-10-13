<script setup lang="ts">
import { computed } from 'vue';

// Presentation inputs only. Counts come from the authorized server projection,
// never from the events in the selected month.
const props = withDefaults(
  defineProps<{
    counts: {
      upcoming30: number | null;
      court: number | null;
      pay: number | null;
      contract: number | null;
      other: number | null;
    } | null;
    canRead: boolean;
    loading?: boolean;
    error?: string | null;
  }>(),
  { loading: false, error: null },
);
const cards = computed(() => [
  { key: 'upcoming30', label: '30天内待办', count: props.counts?.upcoming30 },
  { key: 'court', label: '开庭', count: props.counts?.court },
  { key: 'pay', label: '缴费截止', count: props.counts?.pay },
  { key: 'contract', label: '协议到期', count: props.counts?.contract },
  { key: 'other', label: '重要节点', count: props.counts?.other },
]);
function displayCount(count: number | null | undefined): string {
  if (!props.canRead) return '无查看权限';
  if (props.loading) return '加载中';
  if (props.error) return '暂不可用';
  if (!props.counts) return '待加载';
  return count === null || count === undefined ? '未接入' : String(count);
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
        <dd>{{ displayCount(card.count) }}</dd>
      </div>
    </dl>
    <p v-if="canRead && !loading && !error && counts" class="field-help">
      统计范围为当前有权查看的全部已接入事件，不随切月变化。30天内待办以服务端当天为起点，包含当天及第30天；未接入类别不计入。
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
