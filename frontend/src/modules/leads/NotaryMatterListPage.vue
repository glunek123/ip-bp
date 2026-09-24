<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  listNotaryMatters,
  notaryListStages,
  type NotaryListStage,
  type NotaryMatterListItem,
} from '../../api/notary';

const stageLabels: Record<NotaryListStage, string> = {
  PENDING_EVIDENCE: '待取证',
  WAITING_UNBOX: '待取件开箱',
  UNBOX_REVIEW: '开箱待审核',
};
const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<NotaryMatterListItem[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
let request: AbortController | undefined;

const selectedStage = computed<NotaryListStage | undefined>(() => {
  const value = route.query.stage;
  return typeof value === 'string' &&
    notaryListStages.some((stage) => stage === value)
    ? (value as NotaryListStage)
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
  try {
    const result = await listNotaryMatters(
      requestedPage.value,
      20,
      { signal: controller.signal },
      selectedStage.value,
    );
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
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
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
watch(
  () => [route.query.page, route.query.stage],
  () => void load(),
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view">
    <main>
      <div class="page-head">
        <div>
          <h1>公证阶段</h1>
          <p>逐个办理当前账号有权查看的公证事项。</p>
        </div>
      </div>
      <nav class="lead-list-filters" aria-label="公证阶段筛选">
        <RouterLink
          :to="{ path: '/notary-matters' }"
          :class="{ active: selectedStage === undefined }"
          >全部</RouterLink
        >
        <RouterLink
          v-for="stage in notaryListStages"
          :key="stage"
          :to="{ path: '/notary-matters', query: { stage } }"
          :class="{ active: selectedStage === stage }"
          >{{ stageLabels[stage] }}</RouterLink
        >
      </nav>
      <section class="demo-card" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取公证事项</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>公证事项列表暂时无法加载</h2>
          <p>错误不会被当作空列表，可以直接重试。</p>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2>当前没有公证事项</h2>
          <p>线索确认取证并移交后，事项会在这里出现。</p>
        </div>
        <div v-else class="demo-table-wrap">
          <table class="demo-table">
            <thead>
              <tr>
                <th>公证事项编号</th>
                <th>阶段</th>
                <th>来源线索</th>
                <th>公证处</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="matter in items"
                :key="matter.id"
                data-test="matter-row"
              >
                <td>
                  <RouterLink
                    data-test="matter-link"
                    :to="`/notary-matters/${matter.id}`"
                    >{{ matter.businessNo }}</RouterLink
                  >
                </td>
                <td>
                  <span class="pill">{{ stageLabels[matter.stage] }}</span>
                </td>
                <td>
                  <RouterLink
                    data-test="source-lead-link"
                    :to="`/leads/${matter.sourceLead.id}`"
                    >{{ matter.sourceLead.businessNo }}</RouterLink
                  >
                </td>
                <td>{{ matter.notaryOffice.name }}</td>
                <td class="mono">{{ formatTime(matter.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready' && totalPages > 1"
          class="lead-pagination"
          aria-label="公证事项列表分页"
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
