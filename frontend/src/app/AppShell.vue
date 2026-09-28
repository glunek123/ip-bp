<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../api/http';
import { listLeads, type LeadStatus } from '../api/leads';
import { getOrganizationManagementContext } from '../api/organization';
import {
  listNotaryMatters,
  listNotaryOffices,
  type NotaryListStage,
} from '../api/notary';
import { leadStatusCards } from '../modules/leads/lead-options';
import { useAuthStore } from '../stores/auth';
import { workflowChangedEvent } from './workflow-events';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const canViewPeople = ref(false);
const canViewNotaryOffices = ref(false);
const canViewNotaryMatters = ref(false);
const leadCounts = ref<Record<LeadStatus, number> | null>(null);
const notaryCounts = ref<Record<NotaryListStage, number> | null>(null);
const countRevision = ref(0);
const expandedGroup = ref<'leads' | 'notary' | 'settings' | null>(null);
const notaryStageCards: ReadonlyArray<{
  stage: NotaryListStage;
  label: string;
}> = [
  { stage: 'PENDING_EVIDENCE', label: '待取证' },
  { stage: 'WAITING_UNBOX', label: '待取件开箱' },
  { stage: 'UNBOX_REVIEW', label: '开箱待审核' },
  { stage: 'ISSUANCE_DECISION', label: '开箱待确认' },
  { stage: 'ARCHIVED', label: '已归档' },
];
const loggingOut = ref(false);
const logoutError = ref('');
const isClient = computed(() => auth.session?.principalType === 'CLIENT');
const isNotary = computed(() => auth.session?.principalType === 'NOTARY');
const homePath = computed(() =>
  isClient.value
    ? '/client/leads'
    : isNotary.value
      ? '/notary-portal/matters'
      : '/customers',
);

const identity = computed(() =>
  auth.session === null
    ? null
    : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const breadcrumbs = computed(() =>
  Array.isArray(route.meta.breadcrumbs)
    ? route.meta.breadcrumbs.filter(
        (item): item is string => typeof item === 'string',
      )
    : [],
);
const isCustomerRoute = computed(() => route.path.startsWith('/customers'));
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
const userInitial = computed(
  () => auth.session?.user.displayName.trim().slice(0, 1) || '用',
);

watch(
  () => route.path,
  (path) => {
    if (path.startsWith('/notary-matters')) expandedGroup.value = 'notary';
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
    if (currentIdentity === null || isClient.value || isNotary.value) return;
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
  async (currentIdentity, _previousIdentity, onCleanup) => {
    canViewNotaryOffices.value = false;
    if (currentIdentity === null || isClient.value || isNotary.value) return;
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
    if (currentIdentity === null || isClient.value || isNotary.value) return;
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
            isClient ? '企业审核端' : isNotary ? '公证处办理端' : '业务管理系统'
          }}</small>
        </span>
      </RouterLink>

      <nav v-if="isNotary" class="app-nav" aria-label="公证处导航">
        <p class="app-nav__label">公证处工作台</p>
        <RouterLink
          class="app-nav__item"
          data-test="notary-portal-nav"
          to="/notary-portal/matters"
          @click="closeDrawer"
        >
          <span>待开箱事项</span>
        </RouterLink>
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

        <template v-if="!isClient && (canViewPeople || canViewNotaryOffices)">
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
            auth.session.notaryOffice?.name
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
        <p v-if="logoutError" class="app-user__error" role="alert">
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
      <main class="app-content"><slot /></main>
    </div>
  </div>
</template>
