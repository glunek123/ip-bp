<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listClientNotaryMatters,
  type ClientNotaryListItem,
  type ClientNotaryStage,
} from '../../api/client-notary';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const items = ref<ClientNotaryListItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
let request: AbortController | undefined;
const sourceLeadId = computed(() =>
  typeof route.query.sourceLeadId === 'string'
    ? route.query.sourceLeadId
    : undefined,
);
const stageLabels: Record<ClientNotaryStage, string> = {
  UNBOX_REVIEW: '开箱待审核',
  ISSUANCE_DECISION: '开箱待确认',
  WAITING_CERTIFICATE: '待出证',
  WAITING_RETURN: '待退货',
  ARCHIVED: '已归档',
};
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const result = await listClientNotaryMatters(
      1,
      20,
      { signal: controller.signal },
      sourceLeadId.value,
    );
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}
async function nextPage(next: number): Promise<void> {
  if (next < 1 || next > totalPages.value) return;
  const controller = new AbortController();
  request?.abort();
  request = controller;
  state.value = 'loading';
  try {
    const result = await listClientNotaryMatters(
      next,
      pageSize.value,
      { signal: controller.signal },
      sourceLeadId.value,
    );
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    page.value = result.page;
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
watch(
  () => [route.query.sourceLeadId, route.query.page],
  () => void load(),
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view">
    <main>
      <RouterLink
        v-if="sourceLeadId"
        class="back-link"
        :to="`/client/leads/${sourceLeadId}`"
        >← 返回来源线索</RouterLink
      >
      <div class="page-head">
        <div>
          <h1>{{ sourceLeadId ? '该线索的公证批次' : '公证审核' }}</h1>
          <p>
            {{
              sourceLeadId
                ? '查看该线索的全部公证批次及处理结果。'
                : '当前待审核的开箱批次。'
            }}
          </p>
        </div>
      </div>
      <section class="demo-card" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取公证事项</h2>
        </div>
        <div v-else-if="state === 'missing'" class="state-panel">
          <h2>线索不存在或当前企业不可访问</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>公证事项暂时无法加载</h2>
          <p>错误不会被当作空列表，可以直接重试。</p>
          <ElButton data-test="client-notary-retry" @click="load"
            >重新加载</ElButton
          >
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2>当前没有待审核公证事项</h2>
        </div>
        <div v-else class="demo-table-wrap">
          <table class="demo-table">
            <thead>
              <tr>
                <th>公证事项编号</th>
                <th>阶段</th>
                <th>来源线索</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.id"
                data-test="client-notary-row"
              >
                <td>
                  <RouterLink
                    data-test="client-notary-link"
                    :to="{
                      path: `/client/notary-matters/${item.id}`,
                      query: sourceLeadId ? { sourceLeadId } : {},
                    }"
                    >{{ item.businessNo }}</RouterLink
                  >
                </td>
                <td>
                  <span class="pill">{{ stageLabels[item.stage] }}</span>
                </td>
                <td>{{ item.sourceLeadBusinessNo }}</td>
                <td class="mono">{{ formatTime(item.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready' && totalPages > 1"
          class="lead-pagination"
          aria-label="公证审核列表分页"
        >
          <ElButton :disabled="page <= 1" @click="nextPage(page - 1)"
            >上一页</ElButton
          ><span>第 {{ page }} / {{ totalPages }} 页</span
          ><ElButton :disabled="page >= totalPages" @click="nextPage(page + 1)"
            >下一页</ElButton
          >
        </nav>
      </section>
    </main>
  </div>
</template>
