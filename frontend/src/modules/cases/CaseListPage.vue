<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import {
  listCases,
  type CaseStageGroup,
  type CaseStageFilter,
  type CaseSummary,
  type CaseView,
} from '../../api/cases';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.principalType}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`,
);
const view = computed<CaseView>(() =>
  route.query.view === 'department' ? 'department' : 'mine',
);
const stage = computed<CaseStageFilter>(() =>
  route.query.stage === 'PENDING_MATCH' ||
  route.query.stage === 'WAITING_COMPLAINT' ||
  route.query.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
  route.query.stage === 'WAITING_COMPLAINT_STAMP' ||
  route.query.stage === 'WAITING_FILING' ||
  route.query.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
  route.query.stage === 'WAITING_HEARING' ||
  route.query.stage === 'WAITING_JUDGMENT' ||
  route.query.stage === 'SECOND_INSTANCE' ||
  route.query.stage === 'WAITING_EXECUTION_DOCUMENTS' ||
  route.query.stage === 'WAITING_EXECUTION_CONFIRMATION' ||
  route.query.stage === 'WAITING_EXECUTION_STAMP' ||
  route.query.stage === 'WAITING_EXECUTION_FILING' ||
  route.query.stage === 'EXECUTING' ||
  route.query.stage === 'WAITING_ARCHIVE'
    ? route.query.stage
    : 'all',
);
const stageGroup = computed<CaseStageGroup | undefined>(() =>
  route.query.stageGroup === 'COMPLAINT_PREPARATION' ||
  route.query.stageGroup === 'EXECUTION_PREPARATION'
    ? route.query.stageGroup
    : undefined,
);
const invalidFilter = computed(
  () =>
    (route.query.stage !== undefined &&
      route.query.stage !== 'all' &&
      stage.value === 'all') ||
    (route.query.stageGroup !== undefined && stageGroup.value === undefined),
);
const pageSize = 20;
const page = computed(() => {
  const value = route.query.page;
  const parsed =
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(parsed) ? parsed : 1;
});
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);
const requestKey = computed(
  () =>
    `${identity.value}:${view.value}:${stage.value}:${stageGroup.value ?? ''}:${page.value}`,
);
function stageLabel(value: CaseSummary['stage']): string {
  if (value === 'PENDING_MATCH') return '待匹配';
  if (value === 'WAITING_COMPLAINT') return '待写诉状';
  if (value === 'WAITING_COMPLAINT_CONFIRMATION') return '诉状待确认';
  if (value === 'WAITING_COMPLAINT_STAMP') return '诉状待盖章';
  if (value === 'WAITING_FILING') return '待提交立案';
  if (value === 'WAITING_FORMAL_ACCEPTANCE') return '待正式立案';
  if (value === 'WAITING_JUDGMENT') return '待判决';
  if (value === 'SECOND_INSTANCE') return '二审';
  if (value === 'WAITING_EXECUTION_DOCUMENTS') return '待写执行材料';
  if (value === 'WAITING_EXECUTION_CONFIRMATION') return '执行材料待确认';
  if (value === 'WAITING_EXECUTION_STAMP') return '执行材料待盖章';
  if (value === 'WAITING_EXECUTION_FILING') return '待申请执行';
  if (value === 'EXECUTING') return '强制执行中';
  if (value === 'WAITING_ARCHIVE') return '待归档';
  return '待开庭';
}
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<CaseSummary[]>([]);
const total = ref(0);
const error = ref('');
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  items.value = [];
  total.value = 0;
  error.value = '';
  if (invalidFilter.value) {
    error.value = '阶段筛选无效，请清除筛选后重试。';
    state.value = 'failed';
    return;
  }
  if (stage.value !== 'all' && stageGroup.value !== undefined) {
    const query = { ...route.query };
    delete query.stageGroup;
    await router.replace({ query });
    return;
  }
  const currentPage = page.value;
  const currentKey = requestKey.value;
  try {
    const result = await listCases(currentPage, pageSize, {
      signal: controller.signal,
      view: view.value,
      ...(stageGroup.value
        ? {
            stageGroup: stageGroup.value,
          }
        : { stage: stage.value }),
    });
    if (controller.signal.aborted || currentKey !== requestKey.value) return;
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
    if (currentPage > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
    items.value = result.items;
    total.value = result.total;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted || currentKey !== requestKey.value) return;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取案件，请联系管理员核实权限。'
        : '案件列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}
function setView(next: CaseView) {
  if (next === view.value) return;
  void router.push({ query: { ...route.query, view: next, page: '1' } });
}
function goToPage(next: number) {
  if (
    state.value !== 'ready' ||
    next < 1 ||
    next > totalPages.value ||
    next === page.value
  )
    return;
  void router.push({ query: { ...route.query, page: String(next) } });
}
watch(
  () =>
    [
      view.value,
      stage.value,
      stageGroup.value,
      route.query.page,
      identity.value,
      route.query.stage,
      route.query.stageGroup,
    ] as const,
  (next, previous) => {
    const filterChanged =
      previous &&
      next.slice(0, 3).some((value, index) => value !== previous[index]);
    // Canonicalizing a legal mixed bookmark preserves its page and scope.
    if (
      !invalidFilter.value &&
      stage.value !== 'all' &&
      stageGroup.value !== undefined
    ) {
      void load();
      return;
    }
    const canonicalized =
      previous &&
      next[5] === previous[5] &&
      next[1] !== 'all' &&
      previous[2] !== undefined &&
      next[2] === undefined;
    if (
      filterChanged &&
      !canonicalized &&
      next[3] === previous[3] &&
      page.value !== 1
    ) {
      request?.abort();
      items.value = [];
      total.value = 0;
      state.value = 'loading';
      void router.replace({ query: { ...route.query, page: '1' } });
      return;
    }
    if (
      route.query.page !== undefined &&
      route.query.page !== String(page.value)
    ) {
      request?.abort();
      void router.replace({
        query: { ...route.query, page: String(page.value) },
      });
      return;
    }
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">业务管理系统</p>
          <h1>案件</h1>
          <p>
            {{ view === 'mine' ? '我负责的案件' : '本部门全部案件' }} ·
            {{
              stageGroup
                ? stageGroup === 'COMPLAINT_PREPARATION'
                  ? '准备起诉文书'
                  : '准备执行文书'
                : stage === 'all'
                  ? '全部阶段'
                  : stageLabel(stage)
            }}
          </p>
        </div>
        <ElButton text :loading="state === 'loading'" @click="load"
          >刷新</ElButton
        >
      </div>
      <div class="segmented-control" role="group" aria-label="案件范围">
        <ElButton
          :type="view === 'mine' ? 'primary' : 'default'"
          @click="setView('mine')"
          >我负责</ElButton
        >
        <ElButton
          :type="view === 'department' ? 'primary' : 'default'"
          @click="setView('department')"
          >本部门全部</ElButton
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
      <section v-else class="demo-card demo-card--pad" data-test="case-list">
        <p v-if="items.length === 0" class="field-help">当前没有案件。</p>
        <ul v-else class="notary-offices-list">
          <li v-for="item in items" :key="item.id">
            <RouterLink
              :to="{
                path: `/cases/${encodeURIComponent(item.id)}`,
                query: route.query,
              }"
              >{{ item.businessNo }}</RouterLink
            ><span class="pill">{{ stageLabel(item.stage) }}</span>
            <span class="field-help">负责人：{{ item.owner.displayName }}</span>
            <span class="pill">{{
              item.canSubmitExecution ||
              item.canConfirmExecution ||
              item.canMatch ||
              item.canSubmitComplaint ||
              item.canConfirmComplaint ||
              item.canMailComplaint ||
              item.canSubmitFiling ||
              item.canRegisterAcceptance ||
              item.canUploadAcceptanceMaterials
                ? '办理'
                : '只读'
            }}</span
            ><span
              >来源线索 {{ item.sourceLead.businessNo }} · 公证事项
              {{ item.sourceNotaryMatter.businessNo }}</span
            >
          </li>
        </ul>
        <p class="field-help" aria-live="polite">
          当前显示 {{ items.length }} / {{ total }} 项
        </p>
        <div class="page-head" data-test="case-pagination">
          <ElButton
            text
            data-test="previous-page"
            :disabled="page <= 1"
            @click="goToPage(page - 1)"
            >上一页</ElButton
          >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <ElButton
            text
            data-test="next-page"
            :disabled="page >= totalPages"
            @click="goToPage(page + 1)"
            >下一页</ElButton
          >
        </div>
      </section>
    </main>
  </div>
</template>
