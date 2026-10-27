<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  isNavigationFailure,
  NavigationFailureType,
  useRoute,
  useRouter,
} from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  getCalendarSnapshot,
  getCalendarSummary,
  type CalendarSnapshot,
  type CalendarSummary,
} from '../../api/calendar';
import { ApiError } from '../../api/http';
import {
  createManualCalendar,
  listManualCalendar,
  listRefundCalendar,
  updateManualCalendar,
  type ManualCalendarItem,
  type RefundCalendarDate,
} from '../../api/calendar-reminders';
import { useAuthStore } from '../../stores/auth';
import {
  notifyCalendarSummaryRead,
  notifyWorkflowChanged,
} from '../../app/workflow-events';
import CalendarMonthGrid from './CalendarMonthGrid.vue';
import CalendarStatistics from './CalendarStatistics.vue';
import { calendarMonthLabel, type CalendarEvent } from './calendar-month';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(() => {
  const session = auth.session;
  return session && session.principalType !== 'NOTARY'
    ? JSON.stringify([
        session.user.id,
        session.principalType,
        session.department?.id,
        session.customer?.id,
        session.authorizationRevision,
      ])
    : '';
});
const month = computed(() => {
  const value = route.query.month;
  return value === undefined ? null : typeof value === 'string' ? value : '';
});
const state = ref<'loading' | 'ready' | 'failed' | 'forbidden'>('loading');
const error = ref('');
const snapshot = shallowRef<CalendarSnapshot | null>(null);
const summary = shallowRef<CalendarSummary | null>(null);
const navigationError = ref('');
const manualItems = ref<ManualCalendarItem[]>([]);
const refundDates = ref<RefundCalendarDate[]>([]);
const manualOpen = ref(false);
const manualEditing = ref<ManualCalendarItem | null>(null);
const manualTitle = ref('');
const manualDate = ref('');
const manualNote = ref('');
const manualSaving = ref(false);
const manualError = ref('');
const isInternal = computed(() => auth.session?.principalType === 'INTERNAL');
const monthEvents = computed<CalendarEvent[]>(() => [
  ...(snapshot.value?.events ?? []),
  ...manualItems.value.map((item) => ({
    eventKey: `MANUAL:${item.id}`,
    date: item.eventDate,
    type: 'other' as const,
    title: item.title,
    sub: item.note,
    caseId: null,
  })),
  ...refundDates.value.map((item) => ({
    eventKey: `${item.sourceType}:${item.sourceId}`,
    date: item.dueDate,
    type: 'other' as const,
    title: item.applied ? `${item.title} · 已登记申请` : item.title,
    sub: item.businessNo,
    caseId: item.caseId,
  })),
]);
const navigating = ref(false);
const canRead = computed(
  () => identity.value !== '' && state.value !== 'forbidden',
);
const ready = computed(
  () => canRead.value && state.value === 'ready' && snapshot.value !== null,
);
const eventTypes: CalendarEvent['type'][] = [
  'court',
  'pay',
  'contract',
  'other',
];
const unconnectedTypes = computed(() =>
  eventTypes.filter(
    (type) => summary.value?.metrics[type].state === 'NOT_CONNECTED',
  ),
);
const forbiddenTypes = computed(() =>
  eventTypes.filter(
    (type) => summary.value?.metrics[type].state === 'FORBIDDEN',
  ),
);
let request: AbortController | undefined;
let revision = 0;
let navigationRevision = 0;

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const currentRevision = ++revision;
  const currentIdentity = identity.value;
  const currentMonth = month.value;
  const current = () =>
    !controller.signal.aborted &&
    currentRevision === revision &&
    currentIdentity === identity.value &&
    currentMonth === month.value;
  snapshot.value = null;
  navigationError.value = '';
  error.value = '';
  if (!currentIdentity) {
    summary.value = null;
    state.value = 'forbidden';
    return;
  }
  if (currentMonth !== null && calendarMonthLabel(currentMonth) === null) {
    state.value = 'failed';
    error.value = '月份无效，请使用 YYYY-MM 格式的月份。';
    return;
  }
  state.value = 'loading';
  try {
    if (currentMonth === null) {
      const result = await getCalendarSummary({ signal: controller.signal });
      if (!current()) return;
      summary.value = result;
      const failure = await router.replace({
        query: { ...route.query, month: result.today.slice(0, 7) },
      });
      if (current() && failure) throw new Error('month navigation failed');
      return;
    }
    const [result, personal, refunds] = await Promise.all([
      getCalendarSnapshot(currentMonth, { signal: controller.signal }),
      isInternal.value
        ? listManualCalendar(currentMonth, { signal: controller.signal })
        : Promise.resolve([]),
      isInternal.value
        ? listRefundCalendar(currentMonth, { signal: controller.signal })
        : Promise.resolve([]),
    ]);
    if (!current()) return;
    if (result.month !== currentMonth)
      throw new Error('calendar month mismatch');
    snapshot.value = result;
    manualItems.value = personal;
    refundDates.value = refunds;
    summary.value = result;
    state.value = 'ready';
    if (result.metrics.next30.count !== null)
      notifyCalendarSummaryRead(currentIdentity, result.metrics.next30.count);
  } catch (reason) {
    if (!current()) return;
    notifyCalendarSummaryRead(currentIdentity, null);
    snapshot.value = null;
    manualItems.value = [];
    refundDates.value = [];
    summary.value = null;
    if (
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403)
    ) {
      state.value = 'forbidden';
      error.value =
        reason.status === 401
          ? '登录已失效，请重新登录后查看日历。'
          : '当前账号已无权查看日历，请联系管理员核实权限。';
    } else {
      state.value = 'failed';
      error.value = '日历暂时无法加载，请检查连接后重试。';
    }
  }
}
function openManual(item: ManualCalendarItem | null): void {
  manualEditing.value = item;
  manualTitle.value = item?.title ?? '';
  manualDate.value = item?.eventDate ?? summary.value?.today ?? '';
  manualNote.value = item?.note ?? '';
  manualError.value = '';
  manualOpen.value = true;
}
async function saveManual(): Promise<void> {
  if (manualSaving.value) return;
  manualSaving.value = true;
  manualError.value = '';
  try {
    const input = {
      title: manualTitle.value,
      eventDate: manualDate.value,
      note: manualNote.value || null,
    };
    if (manualEditing.value)
      await updateManualCalendar(manualEditing.value, input);
    else await createManualCalendar(input);
    notifyWorkflowChanged();
    manualOpen.value = false;
    await load();
  } catch (reason) {
    manualError.value =
      reason instanceof ApiError
        ? reason.message
        : '保存失败，请检查输入后重试';
  } finally {
    manualSaving.value = false;
  }
}

async function navigate(
  target: Parameters<typeof router.push>[0],
): Promise<void> {
  if (navigating.value) return;
  const currentNavigation = ++navigationRevision;
  navigating.value = true;
  navigationError.value = '';
  try {
    const failure = await router.push(target);
    if (currentNavigation !== navigationRevision) return;
    if (
      failure &&
      !isNavigationFailure(failure, NavigationFailureType.duplicated)
    ) {
      navigationError.value = '页面跳转未完成，请重试。';
    }
  } catch {
    if (currentNavigation === navigationRevision)
      navigationError.value = '页面跳转暂时失败，请重试。';
  } finally {
    if (currentNavigation === navigationRevision) navigating.value = false;
  }
}
function changeMonth(next: string): void {
  if (!canRead.value || calendarMonthLabel(next) === null) return;
  void navigate({ query: { ...route.query, month: next } });
}
function goToday(): void {
  if (!canRead.value) return;
  if (summary.value) changeMonth(summary.value.today.slice(0, 7));
  else void navigate({ query: { ...route.query, month: undefined } });
}
function openCase(caseId: string): void {
  if (
    !ready.value ||
    !snapshot.value?.events.some((event) => event.caseId === caseId)
  )
    return;
  const audience = auth.session?.principalType;
  const prefix =
    audience === 'CLIENT'
      ? '/client/cases'
      : audience === 'LAWYER'
        ? '/lawyer/cases'
        : '/cases';
  void navigate(`${prefix}/${encodeURIComponent(caseId)}`);
}
watch(
  identity,
  () => {
    summary.value = null;
    navigationRevision += 1;
    navigating.value = false;
  },
  { flush: 'sync' },
);
watch(
  () => [month.value, identity.value],
  () => void load(),
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  revision += 1;
  navigationRevision += 1;
  request?.abort();
  manualItems.value = [];
  refundDates.value = [];
});
</script>

<template>
  <div class="page-view">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">业务日历</p>
          <h1>日历</h1>
          <p>开庭安排与协议到期 · 按当前授权范围展示</p>
        </div>
        <div>
          <ElButton
            aria-label="今天"
            :disabled="!canRead || navigating"
            @click="goToday"
            >今天</ElButton
          >
          <ElButton
            aria-label="刷新日历"
            :loading="state === 'loading'"
            @click="load"
            >刷新</ElButton
          >
          <ElButton
            v-if="isInternal && ready"
            type="primary"
            @click="openManual(null)"
            >新增个人事项</ElButton
          >
        </div>
      </div>
      <CalendarStatistics
        :metrics="summary?.metrics ?? null"
        :window="summary?.window ?? null"
        :can-read="canRead"
        :loading="state === 'loading'"
        :error="error"
      />
      <section
        v-if="isInternal && manualOpen"
        class="calendar-personal-form"
        aria-label="编辑个人事项"
      >
        <h2>{{ manualEditing ? '编辑个人事项' : '新增个人事项' }}</h2>
        <label>标题 <input v-model="manualTitle" maxlength="200" /></label>
        <label>日期 <input v-model="manualDate" type="date" /></label>
        <label>备注 <textarea v-model="manualNote" maxlength="1000" /></label>
        <p v-if="manualError" role="alert">{{ manualError }}</p>
        <div>
          <ElButton :loading="manualSaving" type="primary" @click="saveManual"
            >保存</ElButton
          >
          <ElButton @click="manualOpen = false">关闭</ElButton>
        </div>
      </section>
      <p v-if="navigationError" role="alert" class="submit-error">
        {{ navigationError }}
      </p>
      <p v-if="state === 'forbidden'" role="alert" class="submit-error">
        {{ error || '暂无日历查看权限。' }}
      </p>
      <p v-else-if="month === null && state === 'loading'" role="status">
        正在读取上海当天与日历…
      </p>
      <p v-else-if="month === null && error" role="alert" class="submit-error">
        {{ error }}
      </p>
      <CalendarMonthGrid
        v-if="month !== null"
        :month="month"
        :events="monthEvents"
        :today="summary?.today ?? null"
        :loading="state === 'loading'"
        :error="error"
        :can-read="canRead"
        :unconnected-types="unconnectedTypes"
        :forbidden-types="forbiddenTypes"
        @update:month="changeMonth"
        @open-case="openCase"
      />
      <section
        v-if="isInternal && ready"
        class="calendar-personal"
        aria-label="个人事项"
      >
        <h2>个人事项</h2>
        <p v-if="manualItems.length === 0">本月没有个人事项。</p>
        <ul v-else>
          <li v-for="item in manualItems" :key="item.id">
            <span>{{ item.eventDate }} · {{ item.title }}</span>
            <span v-if="item.note">{{ item.note }}</span>
            <ElButton text @click="openManual(item)">编辑</ElButton>
          </li>
        </ul>
      </section>
      <ElButton
        v-if="state === 'failed' || state === 'forbidden'"
        type="primary"
        @click="load"
        >重新加载</ElButton
      >
    </main>
  </div>
</template>

<style scoped>
.calendar-personal,
.calendar-personal-form {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  background: var(--color-surface-1);
}
.calendar-personal h2,
.calendar-personal-form h2 {
  margin: 0 0 12px;
  font-size: 16px;
}
.calendar-personal ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.calendar-personal li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--color-hairline);
}
.calendar-personal-form {
  display: grid;
  gap: 10px;
  max-width: 520px;
}
.calendar-personal-form label {
  display: grid;
  gap: 4px;
}
.calendar-personal-form input,
.calendar-personal-form textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font: inherit;
}
</style>
