<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listLawyerCases,
  type CaseStage,
  type CaseStageGroup,
  type LawyerCaseSummary,
} from '../../api/cases';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const router = useRouter();
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
  { value: 'SECOND_INSTANCE', label: '二审' },
  { value: 'WAITING_EXECUTION_DOCUMENTS', label: '待写执行材料' },
  {
    value: 'WAITING_EXECUTION_CONFIRMATION',
    label: '执行材料待确认',
  },
  { value: 'WAITING_EXECUTION_STAMP', label: '执行材料待盖章' },
  { value: 'WAITING_EXECUTION_FILING', label: '待申请执行' },
  { value: 'EXECUTING', label: '强制执行中' },
  { value: 'WAITING_ARCHIVE', label: '待归档' },
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
      stage.value === undefined) ||
    (route.query.stageGroup !== undefined && stageGroup.value === undefined),
);
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.principalType}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`,
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
  const currentStageGroup = stageGroup.value;
  items.value = [];
  total.value = 0;
  counts.value = null;
  state.value = 'loading';
  error.value = '';
  if (invalidFilter.value) {
    error.value = '阶段筛选无效，请清除筛选后重试。';
    state.value = 'failed';
    return;
  }
  if (currentStage !== undefined && currentStageGroup !== undefined) {
    const query = { ...route.query };
    delete query.stageGroup;
    await router.replace({ query });
    return;
  }
  try {
    const result = await listLawyerCases(currentPage, pageSize, currentStage, {
      signal: controller.signal,
      ...(currentStageGroup ? { stageGroup: currentStageGroup } : {}),
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
function canHandle(item: LawyerCaseSummary): boolean {
  return Object.entries(item).some(
    ([name, value]) => name.startsWith('can') && value === true,
  );
}
watch(
  () => [route.query.stage, route.query.stageGroup, identity.value],
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
  <div class="page-view business-list-page">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">律师工作台</p>
          <h1>本人承办案件</h1>
          <p>
            {{
              stageGroup
                ? stageGroup === 'COMPLAINT_PREPARATION'
                  ? '准备起诉文书'
                  : '准备执行文书'
                : stage
                  ? stageLabel(stage)
                  : '全部办理阶段'
            }}
            · 共 {{ total }} 项
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
      <section v-else class="demo-card" data-test="lawyer-case-list">
        <p v-if="items.length === 0" class="field-help demo-card--pad">
          当前阶段没有本人承办案件。
        </p>
        <div
          v-else
          class="business-list-scroll"
          role="region"
          aria-label="本人承办案件列表，可横向滚动"
          tabindex="0"
        >
          <table class="demo-table business-list-table lawyer-case-list-table">
            <caption class="sr-only">
              本人承办案件列表
            </caption>
            <colgroup>
              <col class="lawyer-case-col--identity" />
              <col class="lawyer-case-col--stage" />
              <col class="lawyer-case-col--permission" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">操作／案件编号</th>
                <th scope="col">案件进展</th>
                <th scope="col">办理权限</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td class="business-list-cell--nowrap">
                  <RouterLink
                    :to="`/lawyer/cases/${encodeURIComponent(item.id)}`"
                  >
                    {{ item.businessNo }}
                  </RouterLink>
                </td>
                <td class="business-list-cell--nowrap">
                  <span class="pill">{{ stageLabel(item.stage) }}</span>
                </td>
                <td class="business-list-cell--nowrap">
                  <span class="pill">{{
                    canHandle(item) ? '可办理' : '只读'
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="business-list-footer">
          <p class="field-help" aria-live="polite">
            当前显示 {{ items.length }} / {{ total }} 项
          </p>
          <nav
            v-if="total > pageSize"
            class="lawyer-case-pagination"
            aria-label="本人承办案件分页"
          >
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
          </nav>
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

<style scoped>
.lawyer-case-list-table {
  min-width: 460px;
}

.lawyer-case-col--identity {
  width: 200px;
}

.lawyer-case-col--stage {
  width: 140px;
}

.lawyer-case-col--permission {
  width: 120px;
}

.lawyer-case-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}

.lawyer-case-pagination span {
  white-space: nowrap;
}
</style>
