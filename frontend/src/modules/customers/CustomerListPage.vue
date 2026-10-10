<script setup lang="ts">
import './customer-workspace.css';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { listCustomers, type CustomerSummary } from '../../api/customers';
import { pinia } from '../../app/pinia';
import { useAuthStore } from '../../stores/auth';

const router = useRouter();
const auth = useAuthStore(pinia);
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<CustomerSummary[]>([]);
const canCreateDraft = ref(false);
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
  state.value = 'loading';
  try {
    const result = await listCustomers(1, 20, { signal: controller.signal });
    if (controller.signal.aborted) return;
    items.value = result.items;
    canCreateDraft.value = result.capabilities.createDraft;
    state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'failed';
  }
}

onMounted(() => {
  consumeMaintenanceSuccessNotice();
  void load();
});
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="page-view customer-workspace">
    <main>
      <p
        v-if="maintenanceSuccessNotice"
        role="status"
        data-test="maintenance-success-notice"
      >
        {{ maintenanceSuccessNotice }}
      </p>
      <div class="section-heading">
        <div>
          <p class="section-kicker">客户基础</p>
          <h1>客户管理</h1>
          <p>先建立客户草稿，资料可在后续业务中继续补充。</p>
        </div>
        <div class="customer-heading-actions">
          <RouterLink
            class="customer-action-link"
            to="/customers/deleted-drafts"
            data-test="deleted-drafts-link"
            >已删除草稿</RouterLink
          >
          <RouterLink
            v-if="state === 'ready' && canCreateDraft"
            to="/customers/new"
            data-test="create-customer"
          >
            <ElButton type="primary">新建客户</ElButton>
          </RouterLink>
        </div>
      </div>

      <section class="ledger-panel" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取客户</h2>
          <p>只加载当前账号有权查看的记录。</p>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>客户列表暂时无法加载</h2>
          <p>已保留当前页面，可以直接重试。</p>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2>还没有客户记录</h2>
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
            <strong>{{ customer.name }}</strong>
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
    </main>
  </div>
</template>
