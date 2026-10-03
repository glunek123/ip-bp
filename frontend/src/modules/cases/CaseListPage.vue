<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listCases,
  type CaseStageFilter,
  type CaseSummary,
  type CaseView,
} from '../../api/cases';

const route = useRoute();
const router = useRouter();
const view = computed<CaseView>(() =>
  route.query.view === 'department' ? 'department' : 'mine',
);
const stage = computed<CaseStageFilter>(() =>
  route.query.stage === 'PENDING_MATCH' ||
  route.query.stage === 'WAITING_COMPLAINT' ||
  route.query.stage === 'WAITING_COMPLAINT_CONFIRMATION' ||
  route.query.stage === 'WAITING_COMPLAINT_STAMP'
    ? route.query.stage
    : 'all',
);
function stageLabel(value: CaseSummary['stage']): string {
  if (value === 'PENDING_MATCH') return '待匹配';
  if (value === 'WAITING_COMPLAINT') return '待写诉状';
  if (value === 'WAITING_COMPLAINT_CONFIRMATION') return '诉状待确认';
  if (value === 'WAITING_COMPLAINT_STAMP') return '诉状待盖章';
  return '待提交立案';
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
  error.value = '';
  try {
    const result = await listCases(1, 20, {
      signal: controller.signal,
      view: view.value,
      stage: stage.value,
    });
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取案件，请联系管理员核实权限。'
        : '案件列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}
function setView(next: CaseView) {
  void router.push({ query: { ...route.query, view: next } });
}
watch(
  () => [route.query.view, route.query.stage],
  () => void load(),
);
onMounted(() => void load());
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
            {{ stage === 'all' ? '全部阶段' : stageLabel(stage) }}
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
              item.canMatch ||
              item.canSubmitComplaint ||
              item.canConfirmComplaint ||
              item.canMailComplaint
                ? '办理'
                : '只读'
            }}</span
            ><span
              >来源线索 {{ item.sourceLead.businessNo }} · 公证事项
              {{ item.sourceNotaryMatter.businessNo }}</span
            >
          </li>
        </ul>
        <p v-if="total > items.length" class="field-help">
          当前显示 {{ items.length }} / {{ total }} 项
        </p>
      </section>
    </main>
  </div>
</template>
