<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch,
  type CSSProperties,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  buildCalendarMonth,
  CALENDAR_EVENT_LABELS,
  calendarEventTitle,
  calendarMonthLabel,
  isCalendarDate,
  moveCalendarMonth,
  type CalendarEvent,
  type CalendarEventInput,
} from './calendar-month';

const props = withDefaults(
  defineProps<{
    month: string;
    events: readonly CalendarEventInput[];
    today?: string | null;
    loading?: boolean;
    error?: string | null;
    canRead: boolean;
  }>(),
  { loading: false, error: null, today: null },
);
const emit = defineEmits<{
  'update:month': [month: string];
  openCase: [caseId: string];
}>();
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const label = computed(() => calendarMonthLabel(props.month));
const previousMonth = computed(() => moveCalendarMonth(props.month, -1));
const nextMonth = computed(() => moveCalendarMonth(props.month, 1));
const todayMonth = computed(() =>
  isCalendarDate(props.today) ? props.today.slice(0, 7) : null,
);
const ready = computed(
  () => props.canRead && !props.loading && !props.error && label.value !== null,
);
const cells = computed(() =>
  buildCalendarMonth(props.month, ready.value ? props.events : []),
);
const eventCount = computed(() =>
  cells.value.reduce((count, cell) => count + cell.events.length, 0),
);
const legacyOnly = computed(
  () =>
    props.events.length > 0 &&
    props.events.every((event) => 'hearingAt' in event),
);
const tooltipId = useId();
const tooltip = ref<globalThis.HTMLElement | null>(null);
const activeEvent = shallowRef<CalendarEvent | null>(null);
const tooltipStyle = ref<CSSProperties>({
  left: '0px',
  top: '0px',
  visibility: 'hidden',
});
const eventNotice = ref<{ title: string; sub: string | null } | null>(null);
const tooltipRows = computed<Array<[string, string | null | undefined]>>(() => {
  const event = activeEvent.value;
  if (!event) return [];
  if (event.type === 'court') {
    const detail = event.courtDetails;
    return [
      ['权利主体', detail?.party],
      ['被告', detail?.defendant],
      ['侵权类型', detail?.reason],
      [
        '开庭日期',
        `${event.date ?? '未知'}${detail?.time ? ` ${detail.time}` : ''}`,
      ],
      ['开庭地点', detail?.place],
      ['承办法官', detail?.judge],
    ];
  }
  if (!event.caseId?.trim() && !event.caseDetails) return [];
  const detail = event.caseDetails;
  return [
    ['客户', detail?.customer],
    ['权利主体', detail?.rightsHolder],
    ['被告', detail?.defendant],
    ['案号', detail?.caseNumber],
    ['标的额', detail?.amount],
  ];
});

function hideTooltip(): void {
  activeEvent.value = null;
}
function clearTransient(): void {
  hideTooltip();
  eventNotice.value = null;
}
watch([() => props.month, () => props.events, ready], clearTransient, {
  deep: true,
  flush: 'sync',
});

function isCurrentEvent(event: CalendarEvent): boolean {
  return ready.value && cells.value.some((cell) => cell.events.includes(event));
}
async function showTooltip(
  event: CalendarEvent,
  trigger: globalThis.Event,
): Promise<void> {
  if (
    !isCurrentEvent(event) ||
    !(trigger.currentTarget instanceof globalThis.HTMLElement)
  )
    return;
  const anchor = trigger.currentTarget.getBoundingClientRect();
  activeEvent.value = event;
  tooltipStyle.value = { left: '0px', top: '0px', visibility: 'hidden' };
  await nextTick();
  if (activeEvent.value !== event || !tooltip.value || !isCurrentEvent(event))
    return;
  const bounds = tooltip.value.getBoundingClientRect();
  const width = globalThis.window.innerWidth;
  const height = globalThis.window.innerHeight;
  const left = Math.max(
    8,
    Math.min(
      anchor.left + anchor.width / 2 - bounds.width / 2,
      width - bounds.width - 8,
    ),
  );
  const preferredTop = anchor.top - bounds.height - 8;
  const top = Math.max(
    8,
    Math.min(
      preferredTop >= 8 ? preferredTop : anchor.bottom + 8,
      height - bounds.height - 8,
    ),
  );
  tooltipStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    visibility: 'visible',
  };
}
function onKeydown(event: globalThis.KeyboardEvent): void {
  if (event.key === 'Escape') hideTooltip();
}
onMounted(() => {
  globalThis.document.addEventListener('click', hideTooltip);
  globalThis.document.addEventListener('keydown', onKeydown);
  globalThis.window.addEventListener('scroll', hideTooltip, true);
  globalThis.window.addEventListener('resize', hideTooltip);
});
onBeforeUnmount(() => {
  globalThis.document.removeEventListener('click', hideTooltip);
  globalThis.document.removeEventListener('keydown', onKeydown);
  globalThis.window.removeEventListener('scroll', hideTooltip, true);
  globalThis.window.removeEventListener('resize', hideTooltip);
});

function changeMonth(month: string | null): void {
  if (props.canRead && month !== null) {
    clearTransient();
    emit('update:month', month);
  }
}
function openEvent(event: CalendarEvent): void {
  if (!isCurrentEvent(event)) return;
  clearTransient();
  if (event.caseId?.trim()) emit('openCase', event.caseId);
  else
    eventNotice.value = {
      title: calendarEventTitle(event),
      sub: event.sub?.trim() || null,
    };
}
</script>

<template>
  <section class="calendar-month" aria-label="月份日历" :aria-busy="loading">
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
          :disabled="!canRead || todayMonth === null"
          aria-label="回到本月"
          @click="changeMonth(todayMonth)"
        >
          回到本月
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
      正在加载{{ legacyOnly ? '开庭' : '' }}日历…
    </p>
    <p v-else-if="error" class="calendar-state calendar-error" role="alert">
      {{ error }}
    </p>
    <template v-else>
      <p v-if="eventCount === 0" class="calendar-state" role="status">
        {{ legacyOnly ? '本月暂无开庭安排。' : '本月暂无事件。' }}
      </p>
      <p v-if="eventNotice" class="calendar-state" role="status">
        {{ eventNotice.title
        }}<span v-if="eventNotice.sub"> · {{ eventNotice.sub }}</span> ·
        未关联案件。
      </p>
      <div class="calendar-scroll">
        <table class="calendar-grid" :aria-label="`${label}日历事件`">
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
                :class="{
                  'calendar-outside': !cell.inMonth,
                  'calendar-today':
                    cell.inMonth &&
                    isCalendarDate(today) &&
                    cell.date === today,
                }"
                :aria-current="
                  cell.inMonth && isCalendarDate(today) && cell.date === today
                    ? 'date'
                    : undefined
                "
              >
                <time v-if="cell.date" :datetime="cell.date">{{
                  cell.day
                }}</time>
                <ul v-if="cell.events.length" class="calendar-events">
                  <li v-for="event in cell.events" :key="event.eventKey">
                    <ElButton
                      text
                      class="calendar-event"
                      :class="`calendar-event-${event.type}`"
                      :aria-label="`${event.date} ${CALENDAR_EVENT_LABELS[event.type]}：${calendarEventTitle(event)}`"
                      :aria-describedby="
                        activeEvent === event ? tooltipId : undefined
                      "
                      @mouseenter="showTooltip(event, $event)"
                      @mouseleave="hideTooltip"
                      @focus="showTooltip(event, $event)"
                      @blur="hideTooltip"
                      @click="openEvent(event)"
                    >
                      {{ calendarEventTitle(event) }}
                    </ElButton>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="calendar-legend" aria-label="事件类型图例">
        <li v-for="(typeLabel, type) in CALENDAR_EVENT_LABELS" :key="type">
          <i :class="`calendar-dot-${type}`" aria-hidden="true"></i
          >{{ typeLabel }}
        </li>
      </ul>
    </template>
    <Teleport to="body">
      <div
        v-if="ready && activeEvent"
        :id="tooltipId"
        ref="tooltip"
        class="calendar-tooltip"
        role="tooltip"
        :style="tooltipStyle"
      >
        <strong>{{ calendarEventTitle(activeEvent) }}</strong>
        <p v-if="activeEvent.sub">{{ activeEvent.sub }}</p>
        <dl v-if="tooltipRows.length">
          <template v-for="[field, value] in tooltipRows" :key="field"
            ><dt>{{ field }}</dt>
            <dd
              :class="{
                'calendar-mono':
                  field === '开庭日期' ||
                  field === '案号' ||
                  field === '标的额',
              }"
            >
              {{ value?.trim() || '未知' }}
            </dd></template
          >
        </dl>
      </div>
    </Teleport>
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

.calendar-today {
  background: var(--color-primary-subtle);
}
.calendar-today time {
  color: var(--color-primary);
  font-weight: 600;
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

.calendar-event-pay {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
}
.calendar-event-contract {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
}
.calendar-event-other {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
}
.calendar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-4);
  margin: 0;
  padding: var(--s-4);
  list-style: none;
  color: var(--color-ink-muted);
  font-size: 12px;
}
.calendar-legend li {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.calendar-legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.calendar-dot-court {
  background: var(--color-primary);
}
.calendar-dot-pay {
  background: var(--color-warning);
}
.calendar-dot-contract {
  background: var(--color-danger);
}
.calendar-dot-other {
  background: var(--color-success);
}
.calendar-tooltip {
  position: fixed;
  z-index: 2000;
  width: 340px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: auto;
  box-sizing: border-box;
  padding: var(--s-4);
  background: var(--color-surface-1);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  box-shadow: 0 4px 12px var(--color-hairline);
  pointer-events: none;
  font: 400 12px/1.5 var(--font-text);
  overflow-wrap: anywhere;
}
.calendar-tooltip strong {
  font-weight: 600;
}
.calendar-tooltip p {
  margin: var(--s-2) 0;
  color: var(--color-ink-muted);
}
.calendar-tooltip dl {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: var(--s-2);
  margin: var(--s-3) 0 0;
}
.calendar-tooltip dt {
  color: var(--color-ink-subtle);
}
.calendar-tooltip dd {
  margin: 0;
}
.calendar-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
