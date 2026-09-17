<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { getCustomer, type CustomerDetail } from '../../api/customers';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const customer = ref<CustomerDetail>();
let activeRequest: AbortController | undefined;

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function actionLabel(action: string): string {
  return action === 'customer.draft-created' ? '创建客户草稿' : '客户资料变更';
}

async function load(): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  state.value = 'loading';
  try {
    customer.value = await getCustomer(String(route.params.id), {
      signal: controller.signal,
    });
    if (!controller.signal.aborted) state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'CUSTOMER_NOT_FOUND'
        ? 'missing'
        : isCustomerNotFound(error)
          ? 'missing'
          : 'failed';
  }
}

function isCustomerNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'CUSTOMER_NOT_FOUND'
  );
}

onMounted(() => void load());
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/customers">
        <span class="workspace-mark">知</span><span>知产案件管理</span>
      </RouterLink>
      <span class="workspace-context">运营端 · 客户</span>
    </header>
    <main class="workspace-main workspace-main--narrow">
      <RouterLink class="back-link" to="/customers">← 返回客户列表</RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <span class="state-index">读取中</span>
        <h1>正在读取客户资料</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <span class="state-index">404</span>
        <h1>客户不存在或当前不可访问</h1>
        <p>请返回列表，从有权查看的客户中重新选择。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <span class="state-index">连接失败</span>
        <h1>客户资料暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="customer">
        <div class="detail-heading">
          <div>
            <p class="section-kicker">客户详情</p>
            <h1>{{ customer.name }}</h1>
          </div>
          <span class="status-chip status-chip--large">草稿</span>
        </div>
        <section class="ledger-panel detail-card">
          <dl class="detail-grid">
            <div>
              <dt>资料状态</dt>
              <dd>草稿</dd>
            </div>
            <div>
              <dt>客户类别</dt>
              <dd>{{ customer.category || '未填写' }}</dd>
            </div>
            <div>
              <dt>所属地区</dt>
              <dd>{{ customer.region || '未填写' }}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{{ formatTime(customer.updatedAt) }}</dd>
            </div>
          </dl>
          <p class="draft-note">资料尚未准入，可继续补充证件与联系人。</p>
        </section>
        <details class="history-panel">
          <summary>办理历史 · {{ customer.history.length }} 条</summary>
          <ol>
            <li
              v-for="event in customer.history"
              :key="`${event.action}-${event.occurredAt}`"
            >
              <strong>{{ actionLabel(event.action) }}</strong>
              <time>{{ formatTime(event.occurredAt) }}</time>
            </li>
          </ol>
        </details>
      </template>
    </main>
  </div>
</template>
