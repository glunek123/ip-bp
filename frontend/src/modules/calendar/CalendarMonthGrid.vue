<script setup lang="ts">
import { computed } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  buildCalendarMonth,
  calendarMonthLabel,
  moveCalendarMonth,
  type CalendarHearingEvent,
} from './calendar-month';

const props = withDefaults(
  defineProps<{
    month: string;
    events: readonly CalendarHearingEvent[];
    loading?: boolean;
    error?: string | null;
    canRead: boolean;
  }>(),
  { loading: false, error: null },
);
const emit = defineEmits<{
  'update:month': [month: string];
  openCase: [caseId: string];
}>();
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const label = computed(() => calendarMonthLabel(props.month));
const previousMonth = computed(() => moveCalendarMonth(props.month, -1));
const nextMonth = computed(() => moveCalendarMonth(props.month, 1));
const ready = computed(
  () => props.canRead && !props.loading && !props.error && label.value !== null,
);
const cells = computed(() =>
  buildCalendarMonth(props.month, ready.value ? props.events : []),
);
const eventCount = computed(() =>
  cells.value.reduce((count, cell) => count + cell.events.length, 0),
);

function changeMonth(month: string | null): void {
  if (props.canRead && month !== null) emit('update:month', month);
}
function openCase(caseId: string): void {
  if (ready.value) emit('openCase', caseId);
}
</script>

<template>
  <section
    class="calendar-month"
    aria-label="开庭月份日历"
    :aria-busy="loading"
  >
    <header class="calendar-toolbar">
      <h2>{{ label ?? '月份无效' }}</h2>
      <nav aria-label="月份切换">
        <ElButton
          :disabled="!canRead || previousMonth === null"
          aria-label="上个月"
          @click="changeMonth(previousMonth)"
        >
          上个月
        </ElButton>
        <ElButton
          :disabled="!canRead || nextMonth === null"
          aria-label="下个月"
          @click="changeMonth(nextMonth)"
        >
          下个月
        </ElButton>
      </nav>
    </header>

    <p v-if="!canRead" class="calendar-state" role="status">
      暂无日历查看权限。
    </p>
    <p v-else-if="!label" class="calendar-state calendar-error" role="alert">
      月份无效，请提供 YYYY-MM 格式的月份。
    </p>
    <p v-else-if="loading" class="calendar-state" role="status">
      正在加载开庭日历…
    </p>
    <p v-else-if="error" class="calendar-state calendar-error" role="alert">
      {{ error }}
    </p>
    <template v-else>
      <p v-if="eventCount === 0" class="calendar-state" role="status">
        本月暂无开庭安排。
      </p>
      <div class="calendar-scroll">
        <table class="calendar-grid" :aria-label="`${label}开庭安排`">
          <thead>
            <tr>
              <th v-for="weekday in weekdays" :key="weekday" scope="col">
                周{{ weekday }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="week in cells.length / 7" :key="week">
              <td
                v-for="(cell, dayIndex) in cells.slice(
                  (week - 1) * 7,
                  week * 7,
                )"
                :key="cell.date ?? dayIndex"
                :data-date="cell.date"
                :class="{ 'calendar-outside': !cell.inMonth }"
              >
                <time v-if="cell.date" :datetime="cell.date">{{
                  cell.day
                }}</time>
                <ul v-if="cell.events.length" class="calendar-events">
                  <li v-for="event in cell.events" :key="event.eventKey">
                    <ElButton
                      text
                      class="calendar-event"
                      :aria-label="`${event.hearingAt} 开庭：${event.caseLabel?.trim() || '案件名称未提供'}`"
                      @click="openCase(event.caseId)"
                    >
                      开庭 · {{ event.caseLabel?.trim() || '案件名称未提供' }}
                    </ElButton>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.calendar-month {
  overflow: hidden;
  color: var(--color-ink);
  background: var(--color-surface-1);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
}

.calendar-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-4);
}

.calendar-toolbar h2 {
  margin: 0;
  font: 600 14px/1.4 var(--font-text);
}

.calendar-state {
  margin: 0;
  padding: var(--s-4);
  color: var(--color-ink-muted);
}

.calendar-error {
  color: var(--color-danger);
}

.calendar-scroll {
  overflow-x: auto;
}

.calendar-grid {
  width: 100%;
  min-width: 700px;
  table-layout: fixed;
  border-collapse: collapse;
}

.calendar-grid th {
  padding: var(--s-2);
  color: var(--color-ink-subtle);
  background: var(--color-surface-2);
  font-size: 12px;
  font-weight: 500;
}

.calendar-grid td {
  height: 108px;
  padding: var(--s-2);
  vertical-align: top;
  border: 1px solid var(--color-hairline);
}

.calendar-grid time {
  font: 500 13px/1.4 var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.calendar-outside {
  color: var(--color-ink-tertiary);
  background: var(--color-canvas);
}

.calendar-events {
  display: grid;
  gap: var(--s-1);
  margin: var(--s-2) 0 0;
  padding: 0;
  list-style: none;
}

.calendar-event {
  width: 100%;
  height: auto;
  min-height: 26px;
  justify-content: flex-start;
  padding: var(--s-1);
  color: var(--color-primary);
  background: var(--color-primary-subtle);
  font-size: 12px;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}

.calendar-event:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
