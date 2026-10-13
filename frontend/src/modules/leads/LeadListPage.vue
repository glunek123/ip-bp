<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { listLeads, type Lead, type LeadStatus } from '../../api/leads';
import {
  labelLeadPlatform,
  leadStatusCards,
  leadStatusLabels,
} from './lead-options';
import { summarizeLeadProducts } from './lead-display';

const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<Lead[]>([]);
const displayItems = computed(() =>
  items.value.map((lead) => ({
    lead,
    summary: summarizeLeadProducts(lead.products),
    products: [...lead.products].sort((a, b) => a.position - b.position),
  })),
);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
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
      'LIBRARY',
    );
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
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
function formatTime(value: string): string {
  return new Date(value).toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Shanghai',
  });
}
function safeProductUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new globalThis.URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
watch(
  () => [route.query.page, route.query.status],
  () => void load(),
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view business-list-page">
    <main>
      <div class="page-head business-list-toolbar">
        <div>
          <h1>线索库</h1>
          <p>记录当前账号有权查看、尚未移交公证的线索。</p>
        </div>
        <RouterLink
          v-if="state === 'ready' && canCreate"
          to="/leads/new"
          data-test="create-lead"
          ><ElButton type="primary">新建线索</ElButton></RouterLink
        >
      </div>
      <section class="demo-card" aria-live="polite">
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
          <h2 v-if="selectedStatus">
            「{{ leadStatusLabels[selectedStatus] }}」暂无记录
          </h2>
          <h2 v-else>还没有线索记录</h2>
          <p v-if="selectedStatus">可在侧栏切换其他状态查看线索。</p>
          <p v-else>有创建权限时，可从右上角新建待推送线索。</p>
        </div>
        <div
          v-else
          class="demo-table-wrap business-list-scroll"
          tabindex="0"
          role="region"
          aria-label="线索列表，可横向滚动"
        >
          <table class="demo-table business-list-table lead-list-table">
            <colgroup>
              <col style="width: 200px" />
              <col style="width: 140px" />
              <col style="width: 100px" />
              <col style="width: 160px" />
              <col style="width: 160px" />
              <col style="width: 220px" />
              <col style="width: 100px" />
              <col style="width: 120px" />
              <col style="width: 100px" />
              <col style="width: 140px" />
              <col style="width: 120px" />
            </colgroup>
            <thead>
              <tr>
                <th>操作／线索编号</th>
                <th>案件进展</th>
                <th>平台</th>
                <th>店铺名</th>
                <th>店铺ID</th>
                <th>商品链接</th>
                <th class="num">销量</th>
                <th class="num">单价（元）</th>
                <th class="num">评论数</th>
                <th class="num">销售总额（估算／元）</th>
                <th>线索发现日期</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="{ lead, summary, products } in displayItems"
                :key="lead.id"
                data-test="lead-row"
              >
                <td class="business-list-cell--nowrap">
                  <RouterLink
                    :to="`/leads/${lead.id}`"
                    :aria-label="`查看线索 ${lead.businessNo} 详情`"
                  >
                    详情
                  </RouterLink>
                  <div class="mono">{{ lead.businessNo }}</div>
                </td>
                <td class="business-list-cell--nowrap">
                  <span class="pill">{{ leadStatusLabels[lead.status] }}</span>
                </td>
                <td class="business-list-cell--nowrap">
                  {{ labelLeadPlatform(lead.platform) }}
                </td>
                <td class="business-list-cell--text">
                  <details>
                    <summary>{{ lead.shopName }}</summary>
                    <p>客户：{{ lead.displayNames.customerName }}</p>
                    <p>权利主体：{{ lead.displayNames.rightsHolderName }}</p>
                    <p>负责人：{{ lead.displayNames.responsibleUserName }}</p>
                  </details>
                </td>
                <td class="business-list-cell--text mono">
                  {{ lead.shopExternalId || '未登记' }}
                </td>
                <td class="business-list-cell--text">
                  <details v-if="products.length">
                    <summary>
                      {{ products.length }} 件商品 · 查看名称／链接
                    </summary>
                    <ul class="lead-list-products">
                      <li v-for="product in products" :key="product.id">
                        <span>{{ product.title || '未登记商品名称' }}</span>
                        <a
                          v-if="safeProductUrl(product.url)"
                          :href="safeProductUrl(product.url)!"
                          target="_blank"
                          rel="noopener noreferrer"
                          >{{ product.url }}</a
                        >
                        <span v-else>无有效商品链接</span>
                      </li>
                    </ul>
                  </details>
                  <span v-else>未登记商品</span>
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-quantity-total"
                >
                  {{ summary.quantityTotal }}
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-first-unit-price"
                >
                  {{ summary.firstUnitPrice ?? '未登记' }}
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-comment-total"
                >
                  {{ summary.commentTotal }}
                </td>
                <td
                  class="num mono business-list-cell--number"
                  data-test="lead-estimated-amount"
                >
                  {{ summary.estimatedAmount }}
                </td>
                <td class="mono business-list-cell--nowrap">
                  {{ formatTime(lead.foundAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready'"
          class="lead-pagination business-list-footer"
          aria-label="线索列表分页"
        >
          <ElButton
            data-test="previous-page"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
            >上一页</ElButton
          >
          <span
            >共 {{ total }} 条 · 第 {{ currentPage }} /
            {{ totalPages }} 页</span
          >
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

<style scoped>
.lead-list-table {
  min-width: 1560px;
  table-layout: fixed;
}
.lead-list-table details {
  min-width: 0;
}
.lead-list-table summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}
.lead-list-table details:not([open]) summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.lead-list-table details[open] {
  white-space: normal;
  overflow-wrap: anywhere;
}
.lead-list-products {
  margin: 8px 0;
  padding-left: 16px;
}
.lead-list-products a {
  display: block;
  overflow-wrap: anywhere;
}
</style>
