<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../api/http';
import { listLeads, type LeadStatus } from '../api/leads';
import { getOrganizationManagementContext } from '../api/organization';
import { leadStatusCards } from '../modules/leads/lead-options';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const canViewPeople = ref(false);
const leadCounts = ref<Record<LeadStatus, number> | null>(null);
const loggingOut = ref(false);
const logoutError = ref('');
const isClient = computed(() => auth.session?.principalType === 'CLIENT');
const homePath = computed(() =>
  isClient.value ? '/client/leads' : '/customers',
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
const isClientLeadRoute = computed(() =>
  route.path.startsWith('/client/leads'),
);
const selectedLeadStatus = computed(() =>
  typeof route.query.status === 'string' ? route.query.status : undefined,
);
const userInitial = computed(
  () => auth.session?.user.displayName.trim().slice(0, 1) || '用',
);

watch(
  identity,
  async (currentIdentity, _previousIdentity, onCleanup) => {
    canViewPeople.value = false;
    if (currentIdentity === null || isClient.value) return;
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
  [identity, () => route.fullPath],
  async ([currentIdentity], _previous, onCleanup) => {
    leadCounts.value = null;
    if (currentIdentity === null || isClient.value || !isLeadRoute.value)
      return;
    const controller = new AbortController();
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    try {
      const result = await listLeads(1, 1, { signal: controller.signal });
      if (current && identity.value === currentIdentity && isLeadRoute.value) {
        leadCounts.value = result.counts;
      }
    } catch {
      if (current) leadCounts.value = null;
    }
  },
  { immediate: true },
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
          <small>{{ isClient ? '企业审核端' : '业务管理系统' }}</small>
        </span>
      </RouterLink>

      <nav class="app-nav" aria-label="主要导航">
        <p class="app-nav__label">工作台</p>
        <RouterLink
          v-if="!isClient"
          class="app-nav__item"
          :class="{ active: isCustomerRoute }"
          data-test="customer-nav"
          to="/customers"
          @click="closeDrawer"
        >
          <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 4.5h12v11H4zM7 2.5h6v4H7z" />
          </svg>
          <span>客户</span>
        </RouterLink>
        <RouterLink
          v-if="!isClient"
          class="app-nav__item"
          :class="{ active: isLeadRoute }"
          data-test="lead-nav"
          to="/leads"
          @click="closeDrawer"
        >
          <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 3.5h14v13H3zM6 7h8M6 10h8M6 13h5" />
          </svg>
          <span>线索</span>
        </RouterLink>

        <div
          v-if="!isClient && isLeadRoute"
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

        <template v-if="!isClient && canViewPeople">
          <p class="app-nav__label app-nav__label--spaced">系统</p>
          <RouterLink
            class="app-nav__item"
            :class="{ active: route.path === '/settings/people-access' }"
            data-test="people-access-nav"
            to="/settings/people-access"
            @click="closeDrawer"
          >
            <svg class="app-nav__icon" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="7" cy="7" r="3" />
              <path
                d="M2.5 16c.5-3 2-4.5 4.5-4.5s4 1.5 4.5 4.5M13 6h4M15 4v4M13 12.5h4M13 15.5h4"
              />
            </svg>
            <span>人员与权限</span>
          </RouterLink>
        </template>
      </nav>

      <footer v-if="auth.session" class="app-user">
        <span class="app-user__avatar" aria-hidden="true">{{
          userInitial
        }}</span>
        <span class="app-user__identity">
          <strong>{{ auth.session.user.displayName }}</strong>
          <small>{{
            auth.session.customer?.name ?? auth.session.department?.name
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
