<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  listClientCases,
  type ClientCase,
  type ClientCaseView,
} from '../../api/client-cases';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const view = computed<ClientCaseView>(() =>
  route.query.view === 'RECORDED' ? 'RECORDED' : 'PENDING',
);
const page = computed(() => {
  const value = route.query.page;
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 1;
});
const pageSize = 20;
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<ClientCase[]>([]);
const total = ref(0);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);
const error = ref('');
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const currentIdentity = identity.value;
  const currentPage = page.value;
  const currentView = view.value;
  const isCurrent = () =>
    !controller.signal.aborted &&
    currentIdentity === identity.value &&
    currentPage === page.value &&
    currentView === view.value;
  items.value = [];
  total.value = 0;
  state.value = 'loading';
  error.value = '';
  try {
    const result = await listClientCases(currentPage, pageSize, currentView, {
      signal: controller.signal,
    });
    if (!isCurrent()) return;
    items.value = result.items;
    total.value = result.total;
    state.value = 'ready';
  } catch (reason) {
    if (!isCurrent()) return;
    items.value = [];
    total.value = 0;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取案件。'
        : '案件列表暂时无法加载，请重试。';
    state.value = 'failed';
  }
}
watch(
  () => [view.value, page.value, identity.value],
  () => void load(),
);
function select(next: ClientCaseView) {
  void router.push({ query: { ...route.query, view: next, page: undefined } });
}
function selectPage(next: number) {
  void router.push({ query: { ...route.query, page: String(next) } });
}
function stageLabel(stage: ClientCase['stage']) {
  if (stage === 'WAITING_COMPLAINT_STAMP') return '诉状待盖章';
  if (stage === 'WAITING_FILING') return '待提交立案';
  if (stage === 'WAITING_FORMAL_ACCEPTANCE') return '待正式立案';
  if (stage === 'WAITING_JUDGMENT') return '待判决';
  if (stage === 'SECOND_INSTANCE') return '二审';
  if (stage === 'WAITING_EXECUTION_DOCUMENTS') return '待写执行材料';
  if (stage === 'WAITING_EXECUTION_CONFIRMATION') return '执行材料待确认';
  if (stage === 'WAITING_EXECUTION_STAMP') return '执行材料待盖章';
  if (stage === 'WAITING_EXECUTION_FILING') return '待申请执行';
  if (stage === 'EXECUTING') return '强制执行中';
  if (stage === 'WAITING_ARCHIVE') return '待归档';
  return '待开庭';
}
load();
onBeforeUnmount(() => request?.abort());
</script>
<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">企业服务</p>
          <h1>案件</h1>
          <p>查看本企业已确认诉状的案件及邮寄办理进度。</p>
        </div>
        <ElButton text :loading="state === 'loading'" @click="load"
          >刷新</ElButton
        >
      </div>
      <div class="segmented-control" role="group" aria-label="案件状态">
        <ElButton
          :type="view === 'PENDING' ? 'primary' : 'default'"
          @click="select('PENDING')"
          >待盖章</ElButton
        ><ElButton
          :type="view === 'RECORDED' ? 'primary' : 'default'"
          @click="select('RECORDED')"
          >已登记</ElButton
        >
      </div>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取案件</h2>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h2>案件列表暂时无法加载</h2>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <section
        v-else
        class="demo-card demo-card--pad"
        data-test="client-case-list"
      >
        <p v-if="items.length === 0" class="field-help">
          {{
            total === 0 ? '当前没有案件。' : '当前页没有案件，请返回上一页。'
          }}
        </p>
        <ul v-else class="notary-offices-list">
          <li v-for="item in items" :key="item.id">
            <RouterLink :to="`/client/cases/${encodeURIComponent(item.id)}`">{{
              item.businessNo
            }}</RouterLink
            ><span class="pill">{{ stageLabel(item.stage) }}</span
            ><span>权利主体：{{ item.rightsHolderName }}</span
            ><span>被告：{{ item.defendantNames.join('、') }}</span
            ><span class="pill">{{
              item.canMailComplaint ? '办理' : '只读'
            }}</span>
          </li>
        </ul>
        <p v-if="items.length && total > items.length" class="field-help">
          当前显示 {{ items.length }} / {{ total }} 项
        </p>
        <div
          v-if="total > pageSize || page > 1"
          class="page-head"
          data-test="client-case-pagination"
        >
          <ElButton text :disabled="page <= 1" @click="selectPage(page - 1)"
            >上一页</ElButton
          >
          <span>第 {{ page }} 页 · 共 {{ total }} 项</span>
          <ElButton
            text
            :disabled="page >= pageCount"
            @click="selectPage(page + 1)"
            >下一页</ElButton
          >
        </div>
      </section>
    </main>
  </div>
</template>
