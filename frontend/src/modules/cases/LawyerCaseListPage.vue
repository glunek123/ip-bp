<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listLawyerCases,
  type CaseStage,
  type LawyerCaseSummary,
} from '../../api/cases';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const auth = useAuthStore();
const stages: Array<{ value: CaseStage; label: string }> = [
  { value: 'PENDING_MATCH', label: '待匹配' },
  { value: 'WAITING_COMPLAINT', label: '待写诉状' },
  { value: 'WAITING_COMPLAINT_CONFIRMATION', label: '诉状待确认' },
  { value: 'WAITING_COMPLAINT_STAMP', label: '诉状待盖章' },
  { value: 'WAITING_FILING', label: '待提交立案' },
  { value: 'WAITING_FORMAL_ACCEPTANCE', label: '待正式立案' },
  { value: 'WAITING_HEARING', label: '待开庭' },
  { value: 'WAITING_JUDGMENT', label: '待判决' },
];
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<LawyerCaseSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const error = ref('');
let request: AbortController | undefined;
let revision = 0;
const stage = computed(
  () => stages.find((item) => item.value === route.query.stage)?.value,
);
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const counts = ref<Record<CaseStage, number> | null>(null);

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const currentRevision = ++revision;
  const currentIdentity = identity.value;
  const currentPage = page.value;
  const currentStage = stage.value;
  items.value = [];
  state.value = 'loading';
  error.value = '';
  try {
    const result = await listLawyerCases(currentPage, pageSize, currentStage, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      currentRevision !== revision ||
      currentIdentity !== identity.value
    )
      return;
    items.value = result.items;
    total.value = result.total;
    counts.value = result.counts;
    state.value = 'ready';
  } catch (reason) {
    if (
      controller.signal.aborted ||
      currentRevision !== revision ||
      currentIdentity !== identity.value
    )
      return;
    items.value = [];
    counts.value = null;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号已不能读取这些案件，请重新登录或联系管理员。'
        : '案件列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}

function stageLabel(value: CaseStage): string {
  return stages.find((item) => item.value === value)?.label ?? value;
}
watch(
  () => [route.query.stage, identity.value],
  () => {
    if (page.value === 1) void load();
    else page.value = 1;
  },
);
watch(page, () => void load());
onMounted(() => void load());
onBeforeUnmount(() => {
  revision += 1;
  request?.abort();
});
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">律师工作台</p>
          <h1>本人承办案件</h1>
          <p>
            {{ stage ? stageLabel(stage) : '全部办理阶段' }} · 共 {{ total }} 项
          </p>
        </div>
        <ElButton text :loading="state === 'loading'" @click="load"
          >刷新</ElButton
        >
      </div>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取本人案件</h2>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h2>案件列表暂时无法加载</h2>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <section
        v-else
        class="demo-card demo-card--pad"
        data-test="lawyer-case-list"
      >
        <p v-if="items.length === 0" class="field-help">
          当前阶段没有本人承办案件。
        </p>
        <ul v-else class="notary-offices-list">
          <li v-for="item in items" :key="item.id">
            <RouterLink :to="`/lawyer/cases/${encodeURIComponent(item.id)}`">{{
              item.businessNo
            }}</RouterLink
            ><span class="pill">{{ stageLabel(item.stage) }}</span
            ><span class="pill">{{
              item.canSubmitComplaint ||
              item.canConfirmComplaint ||
              item.canMailComplaint ||
              item.canSubmitFiling ||
              item.canRegisterAcceptance ||
              item.canUploadAcceptanceMaterials
                ? '可办理'
                : '只读'
            }}</span>
          </li>
        </ul>
        <p v-if="items.length && total > items.length" class="field-help">
          当前显示 {{ items.length }} / {{ total }} 项
        </p>
        <div v-if="total > pageSize" class="page-head">
          <ElButton text :disabled="page <= 1" @click="page -= 1"
            >上一页</ElButton
          >
          <span>第 {{ page }} / {{ Math.ceil(total / pageSize) }} 页</span>
          <ElButton
            text
            :disabled="page >= Math.ceil(total / pageSize)"
            @click="page += 1"
            >下一页</ElButton
          >
        </div>
      </section>
      <span class="sr-only" aria-hidden="true">{{
        counts
          ? Object.values(counts).reduce((sum, value) => sum + value, 0)
          : ''
      }}</span>
    </main>
  </div>
</template>
