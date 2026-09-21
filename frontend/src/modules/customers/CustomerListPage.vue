<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { listCustomers, type CustomerSummary } from '../../api/customers';

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<CustomerSummary[]>([]);
const canCreateDraft = ref(false);
let activeRequest: AbortController | undefined;

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

onMounted(() => void load());
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/customers">
        <span class="workspace-mark">品知</span>
        <span>品维·知产业务管理</span>
      </RouterLink>
      <nav class="workspace-nav" aria-label="主要导航">
        <span class="workspace-context">客户</span>
      </nav>
    </header>
    <main class="workspace-main">
      <div class="section-heading">
        <div>
          <p class="section-kicker">客户基础</p>
          <h1>客户</h1>
          <p>先建立客户草稿，资料可在后续业务中继续补充。</p>
        </div>
        <RouterLink
          v-if="state === 'ready' && canCreateDraft"
          to="/customers/new"
          data-test="create-customer"
        >
          <ElButton type="primary">新建客户</ElButton>
        </RouterLink>
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
            <span>客户名称</span><span>资料状态</span><span>最近更新</span>
          </div>
          <RouterLink
            v-for="customer in items"
            :key="customer.id"
            class="customer-row"
            :to="`/customers/${customer.id}`"
          >
            <strong>{{ customer.name }}</strong>
            <span class="status-chip">{{
              customer.profileStatus === 'admitted' ? '已准入' : '草稿'
            }}</span>
            <time>{{ formatTime(customer.updatedAt) }}</time>
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>
