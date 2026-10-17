<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../api/http';
import { getCalendarSummary } from '../api/calendar';
import { getSettlementContext } from '../api/settlements';
import { listEvidence } from '../api/evidence';
import { listCases, type CaseStage, type CaseStageGroup } from '../api/cases';
import { listLawyerCases } from '../api/cases';
import { listLeads, type LeadStatus } from '../api/leads';
import { getOrganizationManagementContext } from '../api/organization';
import { listLawyerAccounts } from '../api/lawyer-accounts';
import {
  listNotaryMatters,
  listNotaryOffices,
  type NotaryListStage,
} from '../api/notary';
import { leadStatusCards } from '../modules/leads/lead-options';
import { useAuthStore } from '../stores/auth';
import {
  calendarSummaryReadEvent,
  workflowChangedEvent,
} from './workflow-events';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const canViewPeople = ref(false);
const canViewNotaryOffices = ref(false);
const canManageLawyerAccounts = ref(false);
const canViewNotaryMatters = ref(false);
const canViewCases = ref(false);
const caseReadError = ref('');
const caseReadLoading = ref(false);
const caseReadRevision = ref(0);
let deniedCaseIdentity: string | null = null;
const leadCounts = ref<Record<LeadStatus, number> | null>(null);
const notaryCounts = ref<Record<NotaryListStage, number> | null>(null);
const caseCounts = ref<Record<CaseStage, number> | null>(null);
const calendarCount = ref<number | null>(null);
let calendarSummaryRevision = 0;
const countRevision = ref(0);
const expandedGroup = ref<'cases' | 'leads' | 'notary' | 'settings' | null>(
  null,
);
type CaseStageCard = { label: string; stages: readonly CaseStage[] } & (
  | { stage: CaseStage; stageGroup?: never }
  | { stage?: never; stageGroup: CaseStageGroup }
);
const caseStageCards: readonly CaseStageCard[] = [
  { stage: 'PENDING_MATCH', stages: ['PENDING_MATCH'], label: '案件待匹配' },
  {
    stageGroup: 'COMPLAINT_PREPARATION',
    stages: [
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
    ],
    label: '准备起诉文书',
  },
  { stage: 'WAITING_FILING', stages: ['WAITING_FILING'], label: '待提交立案' },
  {
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    stages: ['WAITING_FORMAL_ACCEPTANCE'],
    label: '待正式立案',
  },
  { stage: 'WAITING_HEARING', stages: ['WAITING_HEARING'], label: '待开庭' },
  { stage: 'WAITING_JUDGMENT', stages: ['WAITING_JUDGMENT'], label: '待判决' },
  { stage: 'SECOND_INSTANCE', stages: ['SECOND_INSTANCE'], label: '二审' },
  {
    stageGroup: 'EXECUTION_PREPARATION',
    stages: [
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
    ],
    label: '准备执行文书',
  },
  {
    stage: 'WAITING_EXECUTION_FILING',
    stages: ['WAITING_EXECUTION_FILING'],
    label: '待申请执行',
  },
  { stage: 'EXECUTING', stages: ['EXECUTING'], label: '强制执行中' },
  { stage: 'WAITING_ARCHIVE', stages: ['WAITING_ARCHIVE'], label: '待归档' },
  { stage: 'ARCHIVED', stages: ['ARCHIVED'], label: '已归档' },
];
function caseCardSelected(card: CaseStageCard): boolean {
  return selectedCaseStage.value !== undefined
    ? card.stages.some((stage) => stage === selectedCaseStage.value)
    : card.stageGroup !== undefined &&
        card.stageGroup === selectedCaseStageGroup.value;
}
function caseCardCount(card: CaseStageCard): number {
  return card.stages.reduce(
    (sum, stage) => sum + (caseCounts.value?.[stage] ?? 0),
    0,
  );
}
const notaryStageCards: ReadonlyArray<{
  stage: NotaryListStage;
  label: string;
}> = [
  { stage: 'PENDING_EVIDENCE', label: '待取证' },
  { stage: 'WAITING_UNBOX', label: '待取件开箱' },
  { stage: 'UNBOX_REVIEW', label: '开箱待审核' },
  { stage: 'ISSUANCE_DECISION', label: '开箱待确认' },
  { stage: 'WAITING_CERTIFICATE', label: '待出证' },
  { stage: 'WAITING_RETURN', label: '待退货' },
  { stage: 'ARCHIVED', label: '已归档' },
];
const loggingOut = ref(false);
const logoutError = ref('');
const isClient = computed(() => auth.session?.principalType === 'CLIENT');
const isNotary = computed(() => auth.session?.principalType === 'NOTARY');
const isLawyer = computed(() => auth.session?.principalType === 'LAWYER');
const calendarPath = computed(() =>
  isClient.value
    ? '/client/calendar'
    : isLawyer.value
      ? '/lawyer/calendar'
      : '/calendar',
);
const homePath = computed(() =>
  isClient.value
    ? '/client/leads'
    : isNotary.value
      ? '/notary-portal/matters'
      : isLawyer.value
        ? '/lawyer/cases'
        : '/customers',
);

const identity = computed(() =>
  auth.session === null
    ? null
    : `${auth.session.user.id}:${auth.session.principalType}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`,
);
const calendarIdentity = computed(() => {
  const session = auth.session;
  return session === null
    ? null
    : JSON.stringify([
        session.user.id,
        session.principalType,
        session.department?.id,
        session.customer?.id,
        session.authorizationRevision,
      ]);
});
watch(
  [calendarIdentity, countRevision],
  async ([currentIdentity], _previous, onCleanup) => {
    calendarCount.value = null;
    if (currentIdentity === null || isNotary.value) return;
    const controller = new AbortController();
    const requestRevision = calendarSummaryRevision;
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      const summary = await getCalendarSummary({ signal: controller.signal });
      if (
        current &&
        calendarIdentity.value === currentIdentity &&
        requestRevision === calendarSummaryRevision
      )
        calendarCount.value = summary.metrics.next30.count;
    } catch {
      if (current && requestRevision === calendarSummaryRevision)
        calendarCount.value = null;
    }
  },
  { immediate: true },
);
function acceptCalendarSummary(event: globalThis.Event): void {
  if (calendarIdentity.value === null || isNotary.value) return;
  if (!(event instanceof globalThis.CustomEvent)) return;
  const detail: unknown = event.detail;
  if (
    detail === null ||
    typeof detail !== 'object' ||
    !('identity' in detail) ||
    detail.identity !== calendarIdentity.value ||
    !('count' in detail) ||
    (detail.count !== null &&
      (typeof detail.count !== 'number' ||
        !Number.isSafeInteger(detail.count) ||
        detail.count < 0))
  )
    return;
  calendarSummaryRevision += 1;
  calendarCount.value = detail.count;
}

function createReadNavigation(
  read: (signal: globalThis.AbortSignal) => Promise<boolean>,
  failureMessage: string,
) {
  const visible = ref(false);
  const error = ref('');
  const loading = ref(false);
  const retryRevision = ref(0);
  let deniedIdentity: string | null = null;
  let failedIdentity: string | null = null;
  watch(
    [identity, () => route.fullPath, countRevision, retryRevision],
    async ([currentIdentity, , , currentRetry], previous, onCleanup) => {
      loading.value = false;
      if (currentIdentity !== previous?.[0]) {
        visible.value = false;
        error.value = '';
        deniedIdentity = null;
        failedIdentity = null;
      }
      if (
        currentIdentity === null ||
        isClient.value ||
        isNotary.value ||
        isLawyer.value ||
        deniedIdentity === currentIdentity ||
        (failedIdentity === currentIdentity && currentRetry === previous?.[3])
      )
        return;
      const controller = new AbortController();
      let current = true;
      onCleanup(() => {
        current = false;
        controller.abort();
      });
      loading.value = true;
      try {
        const allowed = await read(controller.signal);
        if (!current || identity.value !== currentIdentity) return;
        visible.value = allowed;
        error.value = '';
        failedIdentity = null;
        if (!allowed) deniedIdentity = currentIdentity;
      } catch (cause) {
        if (!current || identity.value !== currentIdentity) return;
        if (cause instanceof ApiError && cause.status === 403) {
          visible.value = false;
          error.value = '';
          deniedIdentity = currentIdentity;
          failedIdentity = null;
        } else {
          error.value = failureMessage;
          failedIdentity = currentIdentity;
        }
      } finally {
        if (current && identity.value === currentIdentity)
          loading.value = false;
      }
    },
    { immediate: true },
  );
  return {
    visible,
    error,
    loading,
    retry: () => {
      if (!loading.value) retryRevision.value += 1;
    },
  };
}
const {
  visible: canViewSettlements,
  error: settlementReadError,
  loading: settlementReadLoading,
  retry: retrySettlements,
} = createReadNavigation(async (signal) => {
  const context = await getSettlementContext({ signal });
  return context.read || context.feeRead;
}, '结算导航暂时无法读取，请重试。');
const {
  visible: canViewEvidence,
  error: evidenceReadError,
  loading: evidenceReadLoading,
  retry: retryEvidence,
} = createReadNavigation(async (signal) => {
  await listEvidence({ page: 1, pageSize: 1 }, { signal });
  return true;
}, '证物导航暂时无法读取，请重试。');
onMounted(() =>
  globalThis.window.addEventListener(
    calendarSummaryReadEvent,
    acceptCalendarSummary,
  ),
);
onBeforeUnmount(() =>
  globalThis.window.removeEventListener(
    calendarSummaryReadEvent,
    acceptCalendarSummary,
  ),
);
const breadcrumbs = computed(() =>
  Array.isArray(route.meta.breadcrumbs)
    ? route.meta.breadcrumbs.filter(
        (item): item is string => typeof item === 'string',
      )
    : [],
);
const isCustomerRoute = computed(() => route.path.startsWith('/customers'));
const isCaseRoute = computed(
  () => route.path === '/cases' || route.path.startsWith('/cases/'),
);
const isLawyerCaseRoute = computed(
  () =>
    route.path === '/lawyer/cases' || route.path.startsWith('/lawyer/cases/'),
);
const isCaseContext = computed(
  () => isCaseRoute.value || isLawyerCaseRoute.value,
);
const selectedCaseView = computed(() =>
  isCaseRoute.value && route.query.view === 'department'
    ? 'department'
    : 'mine',
);
const selectedCaseStage = computed(() =>
  isCaseContext.value &&
  typeof route.query.stage === 'string' &&
  route.query.stage !== 'all'
    ? route.query.stage
    : undefined,
);
const selectedCaseStageGroup = computed(() =>
  isCaseContext.value &&
  (route.query.stage === undefined || route.query.stage === 'all') &&
  (route.query.stageGroup === 'COMPLAINT_PREPARATION' ||
    route.query.stageGroup === 'EXECUTION_PREPARATION')
    ? route.query.stageGroup
    : undefined,
);
const allCaseStagesSelected = computed(
  () =>
    isCaseContext.value &&
    (route.query.stage === undefined || route.query.stage === 'all') &&
    route.query.stageGroup === undefined,
);
function caseViewQuery(view: 'mine' | 'department') {
  return {
    view,
    ...(isCaseRoute.value
      ? { stage: route.query.stage, stageGroup: route.query.stageGroup }
      : {}),
  };
}
const isLeadRoute = computed(
  () => route.path === '/leads' || route.path.startsWith('/leads/'),
);
const isNotaryRoute = computed(() => route.path.startsWith('/notary-matters'));
const isSettingsRoute = computed(
  () => route.path === '/notary-offices' || route.path.startsWith('/settings/'),
);
const isClientLeadRoute = computed(() =>
  route.path.startsWith('/client/leads'),
);
const isClientCaseRoute = computed(() =>
  route.path.startsWith('/client/cases'),
);
const isClientNotaryRoute = computed(() =>
  route.path.startsWith('/client/notary-matters'),
);
const selectedLeadStatus = computed(() =>
  typeof route.query.status === 'string' ? route.query.status : undefined,
);
const selectedNotaryStage = computed(() =>
  typeof route.query.stage === 'string' ? route.query.stage : undefined,
);
const leadTotal = computed(() =>
  leadCounts.value === null
    ? null
    : leadStatusCards.reduce(
        (total, card) => total + leadCounts.value![card.status],
        0,
      ),
);
const notaryTotal = computed(() =>
  notaryCounts.value === null
    ? null
    : notaryStageCards.reduce(
        (total, card) => total + notaryCounts.value![card.stage],
        0,
      ),
);
const caseTotal = computed(() =>
  caseCounts.value === null
    ? null
    : Object.values(caseCounts.value).reduce(
        (total, count) => total + count,
        0,
      ),
);
const userInitial = computed(
  () => auth.session?.user.displayName.trim().slice(0, 1) || '用',
);

watch(
  () => route.path,
  (path) => {
    if (path.startsWith('/cases')) expandedGroup.value = 'cases';
    else if (path.startsWith('/notary-matters')) expandedGroup.value = 'notary';
    else if (path.startsWith('/leads')) expandedGroup.value = 'leads';
    else if (path === '/notary-offices' || path.startsWith('/settings/'))
      expandedGroup.value = 'settings';
  },
  { immediate: true },
);

watch(
  identity,
  async (currentIdentity, _previousIdentity, onCleanup) => {
    canViewPeople.value = false;
    canManageLawyerAccounts.value = false;
    if (
      currentIdentity === null ||
      isClient.value ||
      isNotary.value ||
      isLawyer.value
    )
      return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      await getOrganizationManagementContext({ signal: controller.signal });
      if (current && identity.value === currentIdentity) {
        canViewPeople.value = true;
      }
    } catch {
      if (current) canViewPeople.value = false;
    }
  },
  { immediate: true },
);

watch(
  identity,
  async (currentIdentity, _previous, onCleanup) => {
    canManageLawyerAccounts.value = false;
    if (
      currentIdentity === null ||
      isClient.value ||
      isNotary.value ||
      isLawyer.value
    )
      return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      await listLawyerAccounts(1, 1, { signal: controller.signal });
      if (current && identity.value === currentIdentity)
        canManageLawyerAccounts.value = true;
    } catch {
      if (current) canManageLawyerAccounts.value = false;
    }
  },
  { immediate: true },
);

watch(
  identity,
  async (currentIdentity, _previousIdentity, onCleanup) => {
    canViewNotaryOffices.value = false;
    if (
      currentIdentity === null ||
      isClient.value ||
      isNotary.value ||
      isLawyer.value
    )
      return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      await listNotaryOffices({ signal: controller.signal });
      if (current && identity.value === currentIdentity)
        canViewNotaryOffices.value = true;
    } catch {
      if (current) canViewNotaryOffices.value = false;
    }
  },
  { immediate: true },
);

watch(
  [identity, () => route.fullPath, countRevision],
  async ([currentIdentity], previous, onCleanup) => {
    if (currentIdentity !== previous?.[0]) {
      leadCounts.value = null;
      notaryCounts.value = null;
      canViewNotaryMatters.value = false;
    }
    if (
      currentIdentity === null ||
      isClient.value ||
      isNotary.value ||
      isLawyer.value
    )
      return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      const [leadResult, notaryResult] = await Promise.allSettled([
        listLeads(1, 1, { signal: controller.signal }, undefined, 'LIBRARY'),
        listNotaryMatters(1, 1, { signal: controller.signal }),
      ]);
      if (!current || identity.value !== currentIdentity) return;
      if (leadResult.status === 'fulfilled')
        leadCounts.value = leadResult.value.counts;
      else leadCounts.value = null;
      if (notaryResult.status === 'fulfilled') {
        notaryCounts.value = notaryResult.value.counts;
        canViewNotaryMatters.value = true;
      } else {
        notaryCounts.value = null;
        canViewNotaryMatters.value = false;
      }
    } catch {
      if (current) {
        leadCounts.value = null;
        notaryCounts.value = null;
      }
    }
  },
  { immediate: true },
);

watch(
  [identity, () => route.fullPath, countRevision, caseReadRevision],
  async ([currentIdentity], previous, onCleanup) => {
    caseCounts.value = null;
    caseReadLoading.value = false;
    if (currentIdentity !== previous?.[0]) {
      canViewCases.value = false;
      caseReadError.value = '';
      deniedCaseIdentity = null;
    }
    if (
      currentIdentity === null ||
      isClient.value ||
      isNotary.value ||
      isLawyer.value ||
      deniedCaseIdentity === currentIdentity
    )
      return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    caseReadLoading.value = true;
    try {
      const result = await listCases(1, 1, {
        signal: controller.signal,
        view: selectedCaseView.value,
      });
      if (!current || identity.value !== currentIdentity) return;
      caseCounts.value = result.counts;
      canViewCases.value = true;
      caseReadError.value = '';
    } catch (error) {
      if (!current || identity.value !== currentIdentity) return;
      if (error instanceof ApiError && error.status === 403) {
        canViewCases.value = false;
        caseReadError.value = '';
        deniedCaseIdentity = currentIdentity;
      } else {
        caseReadError.value = '案件导航暂时无法读取，请重试。';
      }
    } finally {
      if (current && identity.value === currentIdentity)
        caseReadLoading.value = false;
    }
  },
  { immediate: true },
);

watch(
  [identity, () => route.fullPath, countRevision],
  async ([currentIdentity], _previous, onCleanup) => {
    if (currentIdentity === null || !isLawyer.value) return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      const result = await listLawyerCases(1, 1, undefined, {
        signal: controller.signal,
      });
      if (current && identity.value === currentIdentity)
        caseCounts.value = result.counts;
    } catch {
      if (current && identity.value === currentIdentity)
        caseCounts.value = null;
    }
  },
  { immediate: true },
);

function refreshCounters(): void {
  countRevision.value += 1;
}
onMounted(() =>
  globalThis.window.addEventListener(workflowChangedEvent, refreshCounters),
);
onBeforeUnmount(() =>
  globalThis.window.removeEventListener(workflowChangedEvent, refreshCounters),
);

function closeDrawer(): void {
  drawerOpen.value = false;
}

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  logoutError.value = '';
  try {
    await auth.logout();
    await router.replace('/login');
  } catch (error) {
    logoutError.value =
      error instanceof ApiError
        ? error.message
        : '退出登录失败，请检查连接后重试';
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div class="app-shell" data-test="app-shell">
    <button
      v-if="drawerOpen"
      class="app-sidebar-backdrop"
      type="button"
      aria-label="关闭导航"
      @click="closeDrawer"
    />
    <aside class="app-sidebar" data-test="app-sidebar" :data-open="drawerOpen">
      <RouterLink class="app-brand" :to="homePath" @click="closeDrawer">
        <span class="app-brand__mark" aria-hidden="true">品</span>
        <span>
          <strong>品维·知产</strong>
          <small>{{
            isClient
              ? '企业审核端'
              : isNotary
                ? '公证处办理端'
                : isLawyer
                  ? '律师办理端'
                  : '业务管理系统'
          }}</small>
        </span>
      </RouterLink>

      <nav v-if="!isNotary" class="app-nav" aria-label="日期事件导航">
        <RouterLink
          class="app-nav__item"
          :class="{ active: route.path === calendarPath }"
          data-test="calendar-nav"
          :to="calendarPath"
          @click="closeDrawer"
        >
          <span>日历</span>
          <span
            v-if="calendarCount !== null"
            class="app-nav__badge"
            data-test="calendar-count"
            >{{ calendarCount }}</span
          >
        </RouterLink>
      </nav>
      <nav v-if="isNotary" class="app-nav" aria-label="公证处导航">
        <p class="app-nav__label">公证处工作台</p>
        <RouterLink
          class="app-nav__item"
          data-test="notary-portal-nav"
          to="/notary-portal/matters"
          @click="closeDrawer"
        >
          <span>公证事项</span>
        </RouterLink>
      </nav>
      <nav v-else-if="isLawyer" class="app-nav" aria-label="律师导航">
        <p class="app-nav__label">律师工作台</p>
        <RouterLink
          class="app-nav__item"
          :class="{ active: isLawyerCaseRoute }"
          data-test="lawyer-case-nav"
          to="/lawyer/cases"
          @click="closeDrawer"
        >
          <span>本人案件</span
          ><span v-if="caseTotal !== null" class="app-nav__badge">{{
            caseTotal
          }}</span>
        </RouterLink>
        <div class="app-subnav" aria-label="本人案件阶段">
          <RouterLink
            class="app-subnav__item"
            :class="{
              active: route.path === '/lawyer/cases' && allCaseStagesSelected,
            }"
            to="/lawyer/cases"
            @click="closeDrawer"
            ><span>全部阶段</span
            ><span v-if="caseTotal !== null" class="app-nav__badge">{{
              caseTotal
            }}</span></RouterLink
          >
          <div
            v-for="card in caseStageCards"
            :key="card.stageGroup ?? card.stage"
            :data-test="
              card.stageGroup === 'COMPLAINT_PREPARATION'
                ? 'lawyer-complaint-preparation-nav'
                : card.stageGroup === 'EXECUTION_PREPARATION'
                  ? 'lawyer-execution-preparation-nav'
                  : undefined
            "
          >
            <RouterLink
              class="app-subnav__item"
              :class="{
                active: isLawyerCaseRoute && caseCardSelected(card),
              }"
              :data-test="
                card.stageGroup === 'COMPLAINT_PREPARATION'
                  ? 'complaint-preparation-stage'
                  : card.stageGroup === 'EXECUTION_PREPARATION'
                    ? 'execution-preparation-stage'
                    : 'case-stage'
              "
              :to="{
                path: '/lawyer/cases',
                query: {
                  ...(card.stageGroup
                    ? { stageGroup: card.stageGroup }
                    : { stage: card.stage }),
                },
              }"
              @click="closeDrawer"
            >
              <span>{{ card.label }}</span
              ><span v-if="caseCounts" class="app-nav__badge">{{
                caseCardCount(card)
              }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>
      <nav v-else class="app-nav" aria-label="主要导航">
        <p class="app-nav__label">工作台</p>
        <div v-if="!isClient" class="app-nav__group">
          <RouterLink
            class="app-nav__item"
            :class="{ active: isLeadRoute }"
            data-test="lead-nav"
            to="/leads"
            @click="closeDrawer"
          >
            <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 3.5h14v13H3zM6 7h8M6 10h8M6 13h5" />
            </svg>
            <span>线索库</span>
            <span v-if="leadTotal !== null" class="app-nav__badge">{{
              leadTotal
            }}</span>
          </RouterLink>
          <button
            class="app-nav__expand"
            type="button"
            data-test="lead-expand"
            :aria-expanded="expandedGroup === 'leads'"
            aria-label="展开或收起线索库"
            @click="expandedGroup = expandedGroup === 'leads' ? null : 'leads'"
          >
            {{ expandedGroup === 'leads' ? '⌄' : '›' }}
          </button>
        </div>

        <div
          v-if="!isClient && expandedGroup === 'leads'"
          class="app-subnav"
          aria-label="线索状态"
        >
          <RouterLink
            class="app-subnav__item"
            :class="{ active: selectedLeadStatus === undefined }"
            to="/leads"
            @click="closeDrawer"
          >
            <span>全部</span>
            <span v-if="leadTotal !== null" class="app-nav__badge">{{
              leadTotal
            }}</span>
          </RouterLink>
          <RouterLink
            v-for="card in leadStatusCards"
            :key="card.status"
            class="app-subnav__item"
            :class="{ active: selectedLeadStatus === card.status }"
            data-test="lead-counter"
            :to="{ path: '/leads', query: { status: card.status } }"
            @click="closeDrawer"
          >
            <span>{{ card.label }}</span>
            <span v-if="leadCounts" class="app-nav__badge">{{
              leadCounts[card.status]
            }}</span>
          </RouterLink>
        </div>

        <div v-if="!isClient && canViewNotaryMatters" class="app-nav__group">
          <RouterLink
            class="app-nav__item"
            :class="{ active: isNotaryRoute }"
            data-test="notary-nav"
            to="/notary-matters"
            @click="closeDrawer"
          >
            <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 2.5h8l3 3v12H5zM8 9h5M8 12h5M8 15h4" />
            </svg>
            <span>公证阶段</span>
            <span v-if="notaryTotal !== null" class="app-nav__badge">{{
              notaryTotal
            }}</span>
          </RouterLink>
          <button
            class="app-nav__expand"
            type="button"
            data-test="notary-expand"
            :aria-expanded="expandedGroup === 'notary'"
            aria-label="展开或收起公证阶段"
            @click="
              expandedGroup = expandedGroup === 'notary' ? null : 'notary'
            "
          >
            {{ expandedGroup === 'notary' ? '⌄' : '›' }}
          </button>
        </div>
        <div
          v-if="!isClient && canViewNotaryMatters && expandedGroup === 'notary'"
          class="app-subnav"
          aria-label="公证阶段状态"
        >
          <RouterLink
            class="app-subnav__item"
            :class="{
              active: isNotaryRoute && selectedNotaryStage === undefined,
            }"
            to="/notary-matters"
            @click="closeDrawer"
          >
            <span>全部</span
            ><span v-if="notaryTotal !== null" class="app-nav__badge">{{
              notaryTotal
            }}</span>
          </RouterLink>
          <RouterLink
            v-for="card in notaryStageCards"
            :key="card.stage"
            class="app-subnav__item"
            :class="{
              active: isNotaryRoute && selectedNotaryStage === card.stage,
            }"
            data-test="notary-counter"
            :to="{ path: '/notary-matters', query: { stage: card.stage } }"
            @click="closeDrawer"
          >
            <span>{{ card.label }}</span
            ><span v-if="notaryCounts" class="app-nav__badge">{{
              notaryCounts[card.stage]
            }}</span>
          </RouterLink>
        </div>

        <div
          v-if="!isClient && caseReadError"
          class="app-nav__status"
          data-test="case-nav-error"
          role="status"
        >
          <p>{{ caseReadError }}</p>
          <ElButton
            text
            size="small"
            data-test="case-nav-retry"
            :loading="caseReadLoading"
            :disabled="caseReadLoading"
            @click="caseReadRevision += 1"
            >重新读取案件导航</ElButton
          >
        </div>
        <div v-if="!isClient && canViewCases" class="app-nav__group">
          <RouterLink
            class="app-nav__item"
            :class="{ active: isCaseRoute }"
            data-test="case-nav"
            to="/cases"
            @click="closeDrawer"
          >
            <span>案件</span>
            <span v-if="caseTotal !== null" class="app-nav__badge">{{
              caseTotal
            }}</span>
          </RouterLink>
          <button
            class="app-nav__expand"
            type="button"
            data-test="case-expand"
            :aria-expanded="expandedGroup === 'cases'"
            aria-label="展开或收起案件"
            @click="expandedGroup = expandedGroup === 'cases' ? null : 'cases'"
          >
            {{ expandedGroup === 'cases' ? '⌄' : '›' }}
          </button>
        </div>
        <div
          v-if="!isClient && canViewCases && expandedGroup === 'cases'"
          class="app-subnav"
          aria-label="案件范围与阶段"
        >
          <RouterLink
            class="app-subnav__item"
            :class="{ active: isCaseRoute && selectedCaseView === 'mine' }"
            data-test="case-view-mine"
            :to="{
              path: '/cases',
              query: caseViewQuery('mine'),
            }"
            @click="closeDrawer"
            >我负责</RouterLink
          >
          <RouterLink
            class="app-subnav__item"
            :class="{
              active: isCaseRoute && selectedCaseView === 'department',
            }"
            data-test="case-view-department"
            :to="{
              path: '/cases',
              query: caseViewQuery('department'),
            }"
            @click="closeDrawer"
            >本部门全部</RouterLink
          >
          <RouterLink
            class="app-subnav__item"
            :class="{
              active: isCaseRoute && allCaseStagesSelected,
            }"
            :to="{ path: '/cases', query: { view: selectedCaseView } }"
            @click="closeDrawer"
          >
            <span>全部阶段</span>
            <span v-if="caseTotal !== null" class="app-nav__badge">{{
              caseTotal
            }}</span>
          </RouterLink>
          <div
            v-for="card in caseStageCards"
            :key="card.stageGroup ?? card.stage"
            :data-test="
              card.stageGroup === 'COMPLAINT_PREPARATION'
                ? 'complaint-preparation-nav'
                : card.stageGroup === 'EXECUTION_PREPARATION'
                  ? 'execution-preparation-nav'
                  : undefined
            "
          >
            <RouterLink
              class="app-subnav__item"
              :class="{ active: isCaseRoute && caseCardSelected(card) }"
              :data-test="
                card.stageGroup === 'COMPLAINT_PREPARATION'
                  ? 'complaint-preparation-stage'
                  : card.stageGroup === 'EXECUTION_PREPARATION'
                    ? 'execution-preparation-stage'
                    : 'case-stage'
              "
              :to="{
                path: '/cases',
                query: {
                  view: selectedCaseView,
                  ...(card.stageGroup
                    ? { stageGroup: card.stageGroup }
                    : { stage: card.stage }),
                },
              }"
              @click="closeDrawer"
            >
              <span>{{ card.label }}</span
              ><span v-if="caseCounts" class="app-nav__badge">{{
                caseCardCount(card)
              }}</span>
            </RouterLink>
          </div>
        </div>
        <RouterLink
          v-if="!isClient && canViewSettlements"
          class="app-nav__item"
          :class="{ active: route.path === '/settlements' }"
          data-test="settlement-nav"
          to="/settlements"
          @click="closeDrawer"
          ><span>结算中心</span></RouterLink
        >
        <div v-if="settlementReadError" data-test="settlement-nav-error">
          <p role="alert">{{ settlementReadError }}</p>
          <ElButton
            data-test="settlement-nav-retry"
            :disabled="settlementReadLoading"
            @click="retrySettlements"
            >重新读取结算导航</ElButton
          >
        </div>
        <RouterLink
          v-if="canViewEvidence"
          class="app-nav__item"
          :class="{ active: route.path === '/evidence' }"
          data-test="evidence-nav"
          to="/evidence"
          @click="closeDrawer"
          ><span>证物</span></RouterLink
        >
        <div v-if="evidenceReadError" data-test="evidence-nav-error">
          <p role="alert">{{ evidenceReadError }}</p>
          <ElButton
            data-test="evidence-nav-retry"
            :disabled="evidenceReadLoading"
            @click="retryEvidence"
            >重新读取证物导航</ElButton
          >
        </div>
        <RouterLink
          v-if="isClient"
          class="app-nav__item"
          :class="{ active: isClientLeadRoute }"
          data-test="client-lead-nav"
          to="/client/leads"
          @click="closeDrawer"
        >
          <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 3.5h14v13H3zM6 7h8M6 10h8M6 13h5" />
          </svg>
          <span>线索审核</span>
        </RouterLink>
        <RouterLink
          v-if="isClient"
          class="app-nav__item"
          :class="{ active: isClientCaseRoute }"
          data-test="client-case-nav"
          to="/client/cases"
          @click="closeDrawer"
          ><span>案件</span></RouterLink
        >
        <RouterLink
          v-if="isClient"
          class="app-nav__item"
          :class="{ active: isClientNotaryRoute }"
          data-test="client-notary-nav"
          to="/client/notary-matters"
          @click="closeDrawer"
        >
          <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 2.5h8l3 3v12H5zM8 9h5M8 12h5M8 15h4" />
          </svg>
          <span>公证审核</span>
        </RouterLink>

        <template v-if="!isClient">
          <p class="app-nav__label app-nav__label--spaced">工具栏</p>
          <RouterLink
            class="app-nav__item"
            :class="{ active: isCustomerRoute }"
            data-test="customer-nav"
            to="/customers"
            @click="closeDrawer"
          >
            <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 4.5h12v11H4zM7 2.5h6v4H7z" />
            </svg>
            <span>客户管理</span>
          </RouterLink>
        </template>

        <template
          v-if="
            !isClient &&
            (canViewPeople || canViewNotaryOffices || canManageLawyerAccounts)
          "
        >
          <p class="app-nav__label app-nav__label--spaced">系统</p>
          <button
            class="app-nav__item app-nav__settings"
            type="button"
            data-test="settings-expand"
            :class="{ active: isSettingsRoute }"
            :aria-expanded="expandedGroup === 'settings'"
            @click="
              expandedGroup = expandedGroup === 'settings' ? null : 'settings'
            "
          >
            <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="3" />
              <path
                d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.5 1.5M14.5 14.5 16 16M16 4l-1.5 1.5M5.5 14.5 4 16"
              />
            </svg>
            <span>设置</span>
          </button>
          <div v-if="expandedGroup === 'settings'" class="app-subnav">
            <RouterLink
              v-if="canViewNotaryOffices"
              class="app-subnav__item"
              :class="{ active: route.path === '/notary-offices' }"
              data-test="notary-offices-nav"
              to="/notary-offices"
              @click="closeDrawer"
            >
              <span>公证处</span>
            </RouterLink>
            <RouterLink
              v-if="canViewPeople"
              class="app-subnav__item"
              :class="{ active: route.path === '/settings/people-access' }"
              data-test="people-access-nav"
              to="/settings/people-access"
              @click="closeDrawer"
            >
              <span>人员与权限</span>
            </RouterLink>
            <RouterLink
              v-if="canManageLawyerAccounts"
              class="app-subnav__item"
              :class="{ active: route.path === '/settings/lawyer-accounts' }"
              data-test="lawyer-accounts-nav"
              to="/settings/lawyer-accounts"
              @click="closeDrawer"
              ><span>律师账号</span></RouterLink
            >
          </div>
        </template>
      </nav>

      <footer v-if="auth.session" class="app-user">
        <span class="app-user__avatar" aria-hidden="true">{{
          userInitial
        }}</span>
        <span class="app-user__identity">
          <strong>{{ auth.session.user.displayName }}</strong>
          <small>{{
            auth.session.customer?.name ??
            auth.session.department?.name ??
            auth.session.notaryOffice?.name ??
            (isLawyer ? '律师工作台' : '')
          }}</small>
        </span>
        <ElButton
          text
          data-test="logout"
          :loading="loggingOut"
          :disabled="loggingOut"
          aria-label="退出登录"
          @click="logout"
          >退出</ElButton
        >
        <p
          v-if="logoutError"
          class="app-user__error"
          role="alert"
          data-test="logout-error"
        >
          {{ logoutError }}
        </p>
      </footer>
    </aside>

    <div class="app-main">
      <header class="app-topbar">
        <button
          class="mobile-nav-toggle"
          data-test="mobile-nav-toggle"
          type="button"
          :aria-expanded="drawerOpen"
          aria-label="打开导航"
          @click="drawerOpen = !drawerOpen"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <nav
          class="app-breadcrumbs"
          data-test="breadcrumbs"
          aria-label="面包屑"
        >
          <template
            v-for="(item, index) in breadcrumbs"
            :key="`${item}-${index}`"
          >
            <span
              v-if="index > 0"
              class="app-breadcrumbs__separator"
              aria-hidden="true"
              >/</span
            >
            <span :class="{ current: index === breadcrumbs.length - 1 }">{{
              item
            }}</span>
          </template>
        </nav>
      </header>
      <main
        class="app-content"
        :class="{
          'app-content--case-workspace': route.meta.caseWorkspace === true,
        }"
      >
        <slot />
      </main>
    </div>
  </div>
</template>
