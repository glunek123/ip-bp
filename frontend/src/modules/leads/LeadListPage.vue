<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { listLeads, type Lead } from '../../api/leads';
import { leadStatusCards, leadStatusLabels } from './lead-options';

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<Lead[]>([]);
const counts = ref({
  WAITING_PUSH: 0,
  WAITING_REVIEW: 0,
  WAITING_EVIDENCE_DECISION: 0,
  ARCHIVED: 0,
});
const canCreate = ref(false);
let request: AbortController | undefined;

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const result = await listLeads(1, 20, { signal: controller.signal });
    if (controller.signal.aborted) return;
    items.value = result.items;
    counts.value = result.counts;
    canCreate.value = result.capabilities.create;
    state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'failed';
  }
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/leads"
        ><span class="workspace-mark">品知</span
        ><span>品维·知产业务管理</span></RouterLink
      >
      <nav class="workspace-nav">
        <RouterLink to="/customers">客户</RouterLink
        ><span class="workspace-context">运营端 · 线索</span>
      </nav>
    </header>
    <main class="workspace-main">
      <div class="section-heading">
        <div>
          <p class="section-kicker">运营工作台</p>
          <h1>线索</h1>
          <p>记录当前账号有权查看的线索。</p>
        </div>
        <RouterLink
          v-if="state === 'ready' && canCreate"
          to="/leads/new"
          data-test="create-lead"
          ><ElButton type="primary">新建线索</ElButton></RouterLink
        >
      </div>
      <section class="lead-counter-grid" aria-label="线索阶段计数">
        <article
          v-for="card in leadStatusCards"
          :key="card.status"
          data-test="lead-counter"
        >
          <span>{{ card.label }}</span
          ><strong>{{ counts[card.status] }}</strong>
        </article>
      </section>
      <section class="ledger-panel" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取线索</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>线索列表暂时无法加载</h2>
          <p>错误不会被当作空列表，可以直接重试。</p>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2>还没有线索记录</h2>
          <p>有创建权限时，可从右上角新建待推送线索。</p>
        </div>
        <div v-else class="lead-list">
          <div class="list-head lead-list__row" aria-hidden="true">
            <span>线索编号</span><span>店铺</span><span>状态</span
            ><span>最近更新</span>
          </div>
          <RouterLink
            v-for="lead in items"
            :key="lead.id"
            class="lead-list__row lead-row"
            :to="`/leads/${lead.id}`"
            ><strong>{{ lead.businessNo }}</strong
            ><span>{{ lead.shopName }}</span
            ><span class="status-chip">{{ leadStatusLabels[lead.status] }}</span
            ><time>{{ formatTime(lead.updatedAt) }}</time></RouterLink
          >
        </div>
      </section>
    </main>
  </div>
</template>
