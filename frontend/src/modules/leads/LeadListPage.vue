<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { listLeads, type Lead, type LeadStatus } from '../../api/leads';
import { leadStatusCards, leadStatusLabels } from './lead-options';

const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<Lead[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const counts = ref({
  WAITING_PUSH: 0,
  WAITING_REVIEW: 0,
  WAITING_EVIDENCE_DECISION: 0,
  ARCHIVED: 0,
});
const canCreate = ref(false);
let request: AbortController | undefined;

const selectedStatus = computed<LeadStatus | undefined>(() => {
  const value = route.query.status;
  return typeof value === 'string' &&
    leadStatusCards.some((card) => card.status === value)
    ? (value as LeadStatus)
    : undefined;
});
const requestedPage = computed(() => {
  const value = Array.isArray(route.query.page)
    ? route.query.page[0]
    : route.query.page;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
});
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  const page = requestedPage.value;
  const status = selectedStatus.value;
  try {
    const result = await listLeads(
      page,
      20,
      { signal: controller.signal },
      status,
    );
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
    counts.value = result.counts;
    canCreate.value = result.capabilities.create;
    state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'failed';
  }
}
async function goToPage(page: number): Promise<void> {
  if (page < 1 || page > totalPages.value || page === requestedPage.value)
    return;
  await router.push({ query: { ...route.query, page: String(page) } });
}
async function filterBy(status?: LeadStatus): Promise<void> {
  const query = { ...route.query, page: '1', status };
  if (status === undefined) delete query.status;
  await router.push({ query });
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
watch(
  () => [route.query.page, route.query.status],
  () => void load(),
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view">
    <main>
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
      <div class="lead-filter-row" aria-label="筛选线索状态">
        <ElButton
          :type="selectedStatus === undefined ? 'primary' : 'default'"
          data-test="all-statuses"
          @click="filterBy()"
          >全部状态</ElButton
        >
      </div>
      <section class="lead-counter-grid" aria-label="线索阶段计数">
        <button
          v-for="card in leadStatusCards"
          :key="card.status"
          type="button"
          data-test="lead-counter"
          :class="{ 'is-active': selectedStatus === card.status }"
          :aria-pressed="selectedStatus === card.status"
          @click="filterBy(card.status)"
        >
          <span>{{ card.label }}</span
          ><strong>{{ counts[card.status] }}</strong>
        </button>
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
        <nav
          v-if="state === 'ready' && totalPages > 1"
          class="lead-pagination"
          aria-label="线索列表分页"
        >
          <ElButton
            data-test="previous-page"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
            >上一页</ElButton
          >
          <span>第 {{ currentPage }} / {{ totalPages }} 页</span>
          <ElButton
            data-test="next-page"
            :disabled="currentPage >= totalPages"
            @click="goToPage(currentPage + 1)"
            >下一页</ElButton
          >
        </nav>
      </section>
    </main>
  </div>
</template>
