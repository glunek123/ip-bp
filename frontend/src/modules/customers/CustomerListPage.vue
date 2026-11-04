<script setup lang="ts">
import './customer-workspace.css';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs';
import ListHeaderSearch from '../../shared/ListHeaderSearch.vue';
import { listCustomers, type CustomerSummary } from '../../api/customers';
import { ApiError } from '../../api/http';
import { pinia } from '../../app/pinia';
import { useAuthStore } from '../../stores/auth';
import CustomerNewPage from './CustomerNewPage.vue';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore(pinia);
const state = ref<'loading' | 'ready' | 'failed' | 'forbidden'>('loading');
const items = ref<CustomerSummary[]>([]);
const canCreateDraft = ref(false);
const total = ref(0);
const currentPage = ref(1);
const keyword = ref('');
const cooperation = ref('');
const formError = ref('');
const createOpen = ref(false);
const createForm = ref<{
  requestClose: (done?: () => void) => void;
}>();
const isCooperation = (
  value: unknown,
): value is CustomerSummary['cooperationStatus'] =>
  value === 'COOPERATING' || value === 'PAUSED' || value === 'TERMINATED';
const queryError = computed(() => {
  const { q, cooperationStatus, page } = route.query;
  if (
    q !== undefined &&
    (typeof q !== 'string' || Array.from(q.trim()).length > 200)
  )
    return '客户关键词无效，最多200字。';
  if (cooperationStatus !== undefined && !isCooperation(cooperationStatus))
    return '客户合作状态无效。';
  if (
    page !== undefined &&
    (typeof page !== 'string' ||
      !/^[1-9]\d*$/.test(page) ||
      !Number.isSafeInteger(Number(page)))
  )
    return '客户页码无效。';
  return '';
});
const requestedPage = computed(() =>
  queryError.value ? 1 : Number(route.query.page ?? 1),
);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 20)));
const maintenanceSuccessNotice = ref('');
const actorIdentity = computed(() => {
  const session = auth.session;
  if (session?.principalType !== 'INTERNAL' || !session.department) return '';
  return `${session.user.id}:${session.department.id}:${session.authorizationRevision}`;
});
let activeRequest: AbortController | undefined;

function isAccessLossNotice(value: unknown): value is {
  type: 'access-revoked-after-confirmed-maintenance';
  userId: string;
  departmentId: string;
  authorizationRevision: number;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'access-revoked-after-confirmed-maintenance' &&
    'userId' in value &&
    typeof value.userId === 'string' &&
    'departmentId' in value &&
    typeof value.departmentId === 'string' &&
    'authorizationRevision' in value &&
    typeof value.authorizationRevision === 'number'
  );
}

function consumeMaintenanceSuccessNotice(): void {
  const historyState = router.options.history.state;
  if (
    !Object.prototype.hasOwnProperty.call(
      historyState,
      'customerMaintenanceNotice',
    )
  )
    return;
  const notice = historyState.customerMaintenanceNotice;
  router.options.history.replace(router.options.history.location, {
    ...historyState,
    customerMaintenanceNotice: null,
  });
  const session = auth.session;
  if (
    !isAccessLossNotice(notice) ||
    session?.principalType !== 'INTERNAL' ||
    !session.department ||
    notice.userId !== session.user.id ||
    notice.departmentId !== session.department.id ||
    notice.authorizationRevision !== session.authorizationRevision
  ) {
    return;
  }
  maintenanceSuccessNotice.value =
    '维护已成功，当前账号已无法继续查看客户资料。';
}

watch(
  actorIdentity,
  () => {
    maintenanceSuccessNotice.value = '';
  },
  { flush: 'sync' },
);

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

async function load(): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const session = auth.session;
  const actor = actorIdentity.value;
  items.value = [];
  total.value = 0;
  canCreateDraft.value = false;
  state.value = 'loading';
  if (queryError.value) {
    state.value = 'failed';
    return;
  }
  const page = requestedPage.value;
  try {
    const result = await listCustomers(
      page,
      20,
      { signal: controller.signal },
      {
        ...(typeof route.query.q === 'string' && route.query.q.trim()
          ? { q: route.query.q.trim() }
          : {}),
        ...(isCooperation(route.query.cooperationStatus)
          ? { cooperationStatus: route.query.cooperationStatus }
          : {}),
      },
    );
    if (
      controller.signal.aborted ||
      activeRequest !== controller ||
      session !== auth.session ||
      actor !== actorIdentity.value
    )
      return;
    const lastPage = Math.max(1, Math.ceil(result.total / 20));
    if (page > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    canCreateDraft.value = result.capabilities.createDraft;
    state.value = 'ready';
  } catch (reason) {
    if (
      !controller.signal.aborted &&
      activeRequest === controller &&
      session === auth.session &&
      actor === actorIdentity.value
    )
      state.value =
        reason instanceof ApiError && reason.status === 403
          ? 'forbidden'
          : 'failed';
  }
}

async function applyQuery(clear = false): Promise<void> {
  const q = clear ? '' : keyword.value.trim();
  if (Array.from(q).length > 200) {
    formError.value = '客户关键词最多200字。';
    return;
  }
  formError.value = '';
  const query = { ...route.query };
  delete query.q;
  delete query.cooperationStatus;
  if (q) query.q = q;
  if (!clear && isCooperation(cooperation.value))
    query.cooperationStatus = cooperation.value;
  query.page = '1';
  await router.push({ query });
}
async function goToPage(page: number): Promise<void> {
  if (
    state.value !== 'ready' ||
    page < 1 ||
    page > totalPages.value ||
    page === requestedPage.value
  )
    return;
  await router.push({ query: { ...route.query, page: String(page) } });
}
function beforeCloseCreate(done: () => void): void {
  createForm.value?.requestClose(done);
}
async function onCustomerCreated(): Promise<void> {
  createOpen.value = false;
  await load();
}
watch(
  () => [route.query.q, route.query.cooperationStatus],
  () => {
    keyword.value = typeof route.query.q === 'string' ? route.query.q : '';
    cooperation.value = isCooperation(route.query.cooperationStatus)
      ? route.query.cooperationStatus
      : '';
    formError.value = '';
  },
  { immediate: true, flush: 'sync' },
);
watch(
  [
    () => route.query.q,
    () => route.query.cooperationStatus,
    () => route.query.page,
    () => auth.session,
    actorIdentity,
  ],
  () => void load(),
  { immediate: true, flush: 'sync' },
);

onMounted(() => {
  consumeMaintenanceSuccessNotice();
});
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="page-view customer-workspace customer-list-page">
    <main>
      <h1 class="sr-only">客户管理</h1>
      <p
        v-if="maintenanceSuccessNotice"
        role="status"
        data-test="maintenance-success-notice"
      >
        {{ maintenanceSuccessNotice }}
      </p>
      <ListHeaderSearch
        v-model="keyword"
        placeholder="客户名／证件号／主营类目／地区"
        @search="applyQuery()"
      />
      <form
        aria-label="客户查询"
        class="customer-list-filter-form"
        @submit.prevent="applyQuery()"
      >
        <div class="customer-list-filter-fields">
          <label class="customer-list-filter-field"
            >合作状态<select
              v-model="cooperation"
              data-test="customer-cooperation"
              class="text-input"
            >
              <option value="">全部</option>
              <option value="COOPERATING">合作中</option>
              <option value="PAUSED">已暂停合作</option>
              <option value="TERMINATED">已终止合作</option>
            </select></label
          >
        </div>
        <div
          class="customer-list-filter-actions"
          aria-label="客户列表操作"
          data-test="customer-list-toolbar"
        >
          <RouterLink
            class="customer-action-link"
            to="/customers/deleted-drafts"
            data-test="deleted-drafts-link"
            >已删除草稿</RouterLink
          >
          <ElButton
            v-if="state === 'ready' && canCreateDraft"
            type="primary"
            data-test="create-customer"
            @click="createOpen = true"
          >
            新建客户
          </ElButton>
          <ElButton native-type="submit" data-test="customer-search"
            >查询</ElButton
          >
          <ElButton
            native-type="button"
            data-test="customer-clear"
            @click="applyQuery(true)"
            >清除筛选</ElButton
          >
        </div>
      </form>
      <p v-if="formError || queryError" role="alert">
        {{ formError || queryError }}
      </p>

      <section class="ledger-panel" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取客户</h2>
          <p>只加载当前账号有权查看的记录。</p>
        </div>
        <div v-else-if="state === 'forbidden'" class="state-panel">
          <span class="state-index">权限不足</span>
          <h2>当前账号无权查看客户列表</h2>
          <p>如需查看客户资料，请联系管理员分配相应权限。</p>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>客户列表暂时无法加载</h2>
          <p>已保留当前页面，可以直接重试。</p>
          <ElButton v-if="!queryError" data-test="retry" @click="load"
            >重新加载</ElButton
          >
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2>
            {{
              route.query.q || route.query.cooperationStatus
                ? '当前筛选下没有客户记录'
                : '还没有客户记录'
            }}
          </h2>
          <p>有创建权限时，可从右上角新建一份客户草稿。</p>
        </div>
        <div v-else class="customer-list">
          <div class="list-head" aria-hidden="true">
            <span>客户名称</span><span>资料 / 合作状态</span
            ><span>最近更新</span>
          </div>
          <RouterLink
            v-for="customer in items"
            :key="customer.id"
            class="customer-row"
            :to="`/customers/${customer.id}`"
          >
            <span class="customer-list-name">
              <strong>{{ customer.name }}</strong>
              <span class="mono customer-list-business-id"
                >客户ID {{ customer.businessId ?? '待编号' }}</span
              >
            </span>
            <span class="customer-statuses">
              <span class="status-chip">{{
                customer.profileStatus === 'admitted' ? '已准入' : '草稿'
              }}</span>
              <span
                class="status-chip"
                :class="`status-chip--${customer.cooperationStatus.toLowerCase()}`"
                data-test="cooperation-status"
                >{{
                  customer.cooperationStatus === 'COOPERATING'
                    ? '合作中'
                    : customer.cooperationStatus === 'PAUSED'
                      ? '已暂停合作'
                      : '已终止合作'
                }}</span
              >
            </span>
            <time>{{ formatTime(customer.updatedAt) }}</time>
          </RouterLink>
        </div>
      </section>
      <nav v-if="state === 'ready'" aria-label="客户分页">
        <ElButton
          data-test="customer-prev"
          :disabled="currentPage <= 1"
          @click="goToPage(currentPage - 1)"
          >上一页</ElButton
        >
        <span data-test="customer-total"
          >共 {{ total }} 条 · 第 {{ currentPage }} / {{ totalPages }} 页 ·
          每页20条</span
        >
        <ElButton
          data-test="customer-next"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
          >下一页</ElButton
        >
      </nav>
    </main>
    <ElDrawer
      v-model="createOpen"
      title="新建客户"
      size="min(760px, 100vw)"
      append-to-body
      destroy-on-close
      :before-close="beforeCloseCreate"
    >
      <CustomerNewPage
        ref="createForm"
        embedded
        @saved="onCustomerCreated"
        @close-requested="createOpen = false"
      />
    </ElDrawer>
  </div>
</template>

<style scoped>
.customer-list-page {
  font-size: 13px;
}

.customer-list-page :deep(.el-button) {
  height: var(--app-control-height);
  min-height: var(--app-control-height);
}

.customer-list-filter-form {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.customer-list-filter-fields {
  display: flex;
  align-items: center;
  min-width: 180px;
}

.customer-list-page .customer-list-filter-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  white-space: nowrap;
  color: var(--color-ink-muted);
  font-size: 12px;
}

.customer-list-page .customer-list-filter-field select {
  width: 180px;
  flex: 0 0 180px;
  height: var(--app-control-height);
  min-height: var(--app-control-height);
  padding-block: 4px;
  font-size: 13px;
}

.customer-list-filter-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
  white-space: nowrap;
}

.customer-list-page .list-head,
.customer-list-page .customer-row {
  grid-template-columns: minmax(0, 1fr) 220px 170px;
  padding: 10px 18px;
  gap: 16px;
}

.customer-list-page .list-head {
  padding-block: 8px;
  background: var(--color-surface-2);
  color: var(--color-ink-muted);
  font-size: 12px;
}

.customer-list-page .customer-row {
  min-height: 58px;
}

.customer-list-page .customer-row strong {
  font-size: 13px;
}

.customer-list-page .status-chip {
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.45;
}

.customer-list-page .customer-row time {
  font-size: 12px;
}

.customer-list-page nav[aria-label='客户分页'] {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-hairline);
  color: var(--color-ink-muted);
  font-size: 12px;
}

.customer-list-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.customer-list-business-id {
  display: block;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

@media (max-width: 600px) {
  .customer-list-filter-fields {
    flex: 1 1 100%;
  }

  .customer-list-filter-field {
    width: 100%;
  }

  .customer-list-filter-form {
    align-items: flex-start;
    flex-direction: column;
  }

  .customer-list-filter-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .customer-list-page .list-head,
  .customer-list-page .customer-row {
    grid-template-columns: minmax(0, 1fr) 1fr;
    padding: 10px 14px;
    gap: 10px;
  }

  .customer-list-page .list-head > :last-child {
    display: none;
  }

  .customer-list-page .customer-row time {
    grid-column: 1 / -1;
  }

  .customer-list-page nav[aria-label='客户分页'] {
    gap: 8px;
    padding-inline: 8px;
  }
}
</style>
