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
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  readPendingLeadCommands,
  sameLeadAttempt,
} from './LeadListWorkflowPanel.vue';
import LeadQuickActionsPanel, {
  type FrozenLeadPush,
} from './LeadQuickActionsPanel.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
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
const pendingPushes = ref(readPendingLeadCommands());
const pendingStorageUnavailable = computed(() => pendingPushes.value === null);
const pendingPush = computed(
  () => pendingPushes.value?.[identity.value] ?? null,
);
const activeLeadId = ref<string | null>(pendingPush.value?.leadId ?? null);
const activeTitle = ref('线索下一步');
function actionTitle(status: LeadStatus): string | null {
  switch (status) {
    case 'WAITING_PUSH':
      return '推送给客户审核';
    case 'WAITING_EVIDENCE_DECISION':
      return '确认取证安排';
    case 'ARCHIVED':
      return '申请撤回归档';
    default:
      return null;
  }
}
function openWorkflow(lead: Lead) {
  if (
    pendingPush.value ||
    pendingStorageUnavailable.value ||
    activeLeadId.value
  )
    return;
  activeTitle.value = actionTitle(lead.status) ?? '线索下一步';
  activeLeadId.value = lead.id;
}
function savePendingPush(): void {
  pendingPushes.value = readPendingLeadCommands();
}
function reopenPendingWorkflow(): void {
  savePendingPush();
  if (!pendingPush.value || activeLeadId.value) return;
  activeTitle.value = '核对未确认的线索请求';
  activeLeadId.value = pendingPush.value.leadId;
}
function handlePushSucceeded(attempt: FrozenLeadPush): void {
  if (
    identity.value !== attempt.identity ||
    activeLeadId.value !== attempt.leadId
  )
    return;
  const pending = readPendingLeadCommands()?.[attempt.identity];
  if (pending && !sameLeadAttempt(pending, attempt)) return;
  notifyWorkflowChanged();
  activeLeadId.value = null;
  savePendingPush();
  void load();
}
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
  items.value = [];
  total.value = 0;
  canCreate.value = false;
  const scope = identity.value;
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
    if (
      controller.signal.aborted ||
      scope !== identity.value ||
      request !== controller
    )
      return;
    const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (page > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
    canCreate.value = result.capabilities.create;
    state.value = 'ready';
  } catch {
    if (
      !controller.signal.aborted &&
      scope === identity.value &&
      request === controller
    )
      state.value = 'failed';
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
  () => [route.query.page, route.query.status, identity.value],
  () => void load(),
  { immediate: true, flush: 'sync' },
);
watch(
  identity,
  (value) => {
    savePendingPush();
    activeLeadId.value = pendingPushes.value?.[value]?.leadId ?? null;
  },
  { flush: 'sync' },
);
watch(
  () => route.fullPath,
  () => {
    activeLeadId.value = pendingPush.value?.leadId ?? null;
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view business-list-page">
    <main :inert="!!activeLeadId">
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
                  <ElButton
                    v-if="actionTitle(lead.status)"
                    type="primary"
                    data-test="lead-quick-action"
                    :disabled="!!pendingPush || pendingStorageUnavailable"
                    @click="openWorkflow(lead)"
                    >{{ actionTitle(lead.status) }}</ElButton
                  >
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
      <p v-if="pendingStorageUnavailable" role="alert">
        无法读取未决请求记录，流程办理暂不可用。
      </p>
      <p v-if="pendingPush && !activeLeadId" role="alert">
        有一项线索请求尚未确认，请先核对原请求。
        <ElButton data-test="reopen-pending-lead" @click="reopenPendingWorkflow"
          >核对未确认请求</ElButton
        >
      </p>
    </main>
    <LeadQuickActionsPanel
      v-if="activeLeadId"
      :lead-id="activeLeadId"
      :identity="identity"
      :title="activeTitle"
      :pending-push="pendingPush"
      @close="activeLeadId = null"
      @pending="savePendingPush"
      @succeeded="handlePushSucceeded"
    />
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
