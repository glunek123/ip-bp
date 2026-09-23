<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { listClientLeads, type ClientLead } from '../../api/client-leads';

const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<ClientLead[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
let request: AbortController | undefined;

const currentView = computed(() =>
  route.query.view === 'processed' ? 'processed' : 'pending',
);
const queueTitle = computed(() =>
  currentView.value === 'processed' ? '已处理线索' : '待我审核',
);
const emptyTitle = computed(() =>
  currentView.value === 'processed' ? '暂无已处理线索' : '暂无待审核线索',
);
const queueApiView = computed(() =>
  currentView.value === 'processed' ? 'PROCESSED' : 'PENDING',
);
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
    const result = await listClientLeads(
      queueApiView.value,
      requestedPage.value,
      20,
      {
        signal: controller.signal,
      },
    );
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
    state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'failed';
  }
}

async function goToPage(next: number): Promise<void> {
  if (next < 1 || next > totalPages.value || next === requestedPage.value)
    return;
  await router.push({
    query: { view: currentView.value, page: String(next) },
  });
}

async function selectView(view: 'pending' | 'processed'): Promise<void> {
  if (view === currentView.value) return;
  await router.push({ query: { view, page: '1' } });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

watch(
  () => [route.query.view, route.query.page],
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
          <span class="section-kicker">企业线索审核</span>
          <h1>{{ queueTitle }}</h1>
          <p>在待我审核中确认结论；完成后可在已处理中回看</p>
        </div>
      </div>
      <nav class="client-queue-tabs" aria-label="线索队列">
        <ElButton
          data-test="client-view-pending"
          :aria-current="currentView === 'pending' ? 'page' : undefined"
          @click="selectView('pending')"
          >待我审核</ElButton
        >
        <ElButton
          data-test="client-view-processed"
          :aria-current="currentView === 'processed' ? 'page' : undefined"
          @click="selectView('processed')"
          >已处理</ElButton
        >
      </nav>
      <section class="demo-card" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取{{ queueTitle }}</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>{{ queueTitle }}暂时无法加载</h2>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2>{{ emptyTitle }}</h2>
          <p v-if="currentView === 'pending'">运营推送后会立即出现在这里。</p>
        </div>
        <div v-else class="demo-table-wrap">
          <table class="demo-table">
            <thead>
              <tr>
                <th>线索编号</th>
                <th>状态</th>
                <th>权利人</th>
                <th>店铺</th>
                <th class="num">商品数</th>
                <th>推送时间</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="lead in items"
                :key="lead.id"
                data-test="client-lead-row"
              >
                <td>
                  <RouterLink :to="`/client/leads/${lead.id}`">{{
                    lead.businessNo
                  }}</RouterLink>
                </td>
                <td>
                  <span class="pill">{{
                    currentView === 'processed' ? '已确认侵权' : '线索待审核'
                  }}</span>
                </td>
                <td>{{ lead.rightsHolderName }}</td>
                <td>{{ lead.shopName }}</td>
                <td class="num mono">{{ lead.products.length }}</td>
                <td class="mono">{{ formatTime(lead.pushedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready' && totalPages > 1"
          class="lead-pagination"
          :aria-label="`${queueTitle}分页`"
        >
          <ElButton
            data-test="previous-page"
            :disabled="page <= 1"
            @click="goToPage(page - 1)"
            >上一页</ElButton
          >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <ElButton
            data-test="next-page"
            :disabled="page >= totalPages"
            @click="goToPage(page + 1)"
            >下一页</ElButton
          >
        </nav>
      </section>
    </main>
  </div>
</template>
