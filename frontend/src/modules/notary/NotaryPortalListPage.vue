<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  RouterLink,
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from 'vue-router';
import ListWorkflowDrawer from '../../app/ListWorkflowDrawer.vue';
import type {
  ListWorkflowContext,
  ListWorkflowLoad,
} from '../../app/list-workflow-context';
import NotaryPortalWorkflowPanel from './NotaryPortalWorkflowPanel.vue';
import { useAuthStore } from '../../stores/auth';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listNotaryPortalMatters,
  getNotaryPortalMatter,
  type NotaryPortalMatterSummary,
} from '../../api/notary-portal';

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const workflowOpen = ref(false);
const workflowContext = ref<ListWorkflowContext | null>(null);
const workflowDrawer = ref<{ canLeave: () => boolean }>();
function loadWorkflowDetail({ context, signal }: ListWorkflowLoad) {
  return getNotaryPortalMatter(context.recordId, { signal });
}
function actionFor(matter: NotaryPortalMatterSummary) {
  for (const [actionKey, label] of [
    ['opening', '登记开箱'],
    ['certificate', '登记公证书'],
  ] as const) {
    try {
      if (
        globalThis.sessionStorage.getItem(
          `notary-portal-list-request:${JSON.stringify([identity.value, matter.id, actionKey])}`,
        )
      )
        return { actionKey, label: `恢复${label}请求` };
    } catch {
      /* Opening the panel reports unavailable storage before any POST. */
    }
  }
  return matter.stage === 'WAITING_UNBOX'
    ? { actionKey: 'opening', label: '登记开箱' }
    : matter.stage === 'WAITING_CERTIFICATE'
      ? { actionKey: 'certificate', label: '登记公证书' }
      : null;
}
function openWorkflow(matter: NotaryPortalMatterSummary) {
  if (workflowDrawer.value && !workflowDrawer.value.canLeave()) return;
  const action = actionFor(matter);
  if (!action) return;
  workflowContext.value = {
    recordId: matter.id,
    actorKey: identity.value,
    actionKey: action.actionKey,
    title: `${action.label} · ${matter.businessNo}`,
  };
  workflowOpen.value = true;
}

function pendingRequests(): ListWorkflowContext[] {
  const requests: ListWorkflowContext[] = [];
  try {
    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
      const key = globalThis.sessionStorage.key(index);
      if (!key?.startsWith('notary-portal-list-request:')) continue;
      const parts: unknown = JSON.parse(
        key.slice('notary-portal-list-request:'.length),
      );
      if (
        !Array.isArray(parts) ||
        parts.length !== 3 ||
        parts[0] !== identity.value ||
        typeof parts[1] !== 'string' ||
        typeof parts[2] !== 'string' ||
        !['opening', 'certificate'].includes(parts[2])
      )
        continue;
      requests.push({
        actorKey: identity.value,
        recordId: parts[1],
        actionKey: parts[2],
        title: '核对未确认的公证请求',
      });
    }
  } catch {
    return requests;
  }
  return requests;
}
function resumeWorkflow(context: ListWorkflowContext) {
  if (workflowDrawer.value && !workflowDrawer.value.canLeave()) return;
  workflowContext.value = context;
  workflowOpen.value = true;
}

function canLeaveWorkflow() {
  return workflowDrawer.value?.canLeave() ?? true;
}
onBeforeRouteLeave(canLeaveWorkflow);
onBeforeRouteUpdate(canLeaveWorkflow);
watch(
  [identity, () => route.fullPath],
  () => {
    workflowOpen.value = false;
    workflowContext.value = null;
  },
  { flush: 'sync' },
);
const matters = ref<NotaryPortalMatterSummary[]>([]);
const total = ref(0);
const page = computed(() => {
  const value = Number(route.query.page);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
});
const stage = computed<'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED'>(
  () =>
    route.query.stage === 'WAITING_CERTIFICATE' ||
    route.query.stage === 'ARCHIVED'
      ? route.query.stage
      : 'WAITING_UNBOX',
);
const stageOptions = [
  { stage: 'WAITING_UNBOX', label: '待开箱' },
  { stage: 'WAITING_CERTIFICATE', label: '待出证' },
  { stage: 'ARCHIVED', label: '已出证' },
] as const;
const error = ref('');
let request: AbortController | undefined;

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  error.value = '';
  try {
    const result = await listNotaryPortalMatters(page.value, 20, {
      signal: controller.signal,
      ...(stage.value === 'WAITING_UNBOX' ? {} : { stage: stage.value }),
    });
    if (controller.signal.aborted) return;
    matters.value = result.items;
    total.value = result.total;
    const lastPage = Math.max(1, Math.ceil(result.total / 20));
    if (result.items.length === 0 && page.value > lastPage) {
      await router.replace({
        query: { ...route.query, page: String(lastPage) },
      });
      return;
    }
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前公证处账号暂时无权读取事项，请联系管理员核实账号状态。'
        : '事项列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}
function selectStage(
  value: 'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED',
) {
  if (stage.value === value) return;
  void router.push({ query: { ...route.query, stage: value, page: '1' } });
}
function goToPage(value: number) {
  void router.push({ query: { ...route.query, page: String(value) } });
}
const stageLabel = () =>
  stage.value === 'WAITING_UNBOX'
    ? '待开箱'
    : stage.value === 'WAITING_CERTIFICATE'
      ? '待出证'
      : '已出证';

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
watch([identity, page, stage], () => void load(), { immediate: true });
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">公证处办理端</p>
          <h1>公证事项</h1>
          <p>这里只显示分派给当前公证处的办理事项。</p>
        </div>
        <ElButton
          data-test="refresh-notary-portal"
          text
          :loading="state === 'loading'"
          @click="load"
          >刷新</ElButton
        >
      </div>
      <nav class="notary-portal-segments" aria-label="事项阶段">
        <button
          v-for="item in stageOptions"
          :key="item.stage"
          type="button"
          :aria-current="stage === item.stage ? 'page' : undefined"
          :data-test="`notary-segment-${item.stage.toLowerCase()}`"
          @click="selectStage(item.stage)"
        >
          {{ item.label }}
        </button>
      </nav>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取{{ stageLabel() }}事项</h2>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h2>事项列表暂时无法加载</h2>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <section
        v-else
        class="demo-card demo-card--pad"
        data-test="notary-portal-list"
      >
        <p v-if="matters.length === 0" class="field-help">
          当前没有{{ stageLabel() }}事项。
        </p>
        <ul v-else class="notary-offices-list">
          <li v-for="matter in matters" :key="matter.id">
            <ElButton
              v-if="actionFor(matter)"
              type="primary"
              data-test="notary-portal-action"
              @click="openWorkflow(matter)"
              >{{ actionFor(matter)?.label }}</ElButton
            >
            <RouterLink
              data-test="notary-portal-row"
              :to="`/notary-portal/matters/${encodeURIComponent(matter.id)}`"
              >{{ matter.businessNo }}</RouterLink
            >
            <span class="pill">{{
              matter.stage === 'WAITING_UNBOX'
                ? '待开箱'
                : matter.stage === 'WAITING_CERTIFICATE'
                  ? '待出证'
                  : '已出证'
            }}</span
            ><span>{{ formatTime(matter.createdAt) }}</span>
          </li>
        </ul>
        <div v-if="total > 20" class="pagination-row">
          <ElButton text :disabled="page <= 1" @click="goToPage(page - 1)"
            >上一页</ElButton
          >
          <span>第 {{ page }} 页 · 共 {{ total }} 项</span>
          <ElButton
            text
            :disabled="page * 20 >= total"
            @click="goToPage(page + 1)"
            >下一页</ElButton
          >
        </div>
      </section>
      <section v-if="pendingRequests().length" aria-label="未确认的公证请求">
        <p>尚有请求结果未确认，事项可能已经离开当前筛选。请核对原请求。</p>
        <ElButton
          v-for="pending in pendingRequests()"
          :key="pending.recordId + pending.actionKey"
          data-test="notary-resume-request"
          @click="resumeWorkflow(pending)"
          >核对未确认的公证请求</ElButton
        >
      </section>
      <ListWorkflowDrawer
        ref="workflowDrawer"
        v-model="workflowOpen"
        :context="workflowContext"
        :load-detail="loadWorkflowDetail"
        @success="load"
      >
        <template #default="{ detail, session }"
          ><NotaryPortalWorkflowPanel :detail="detail" :session="session"
        /></template>
      </ListWorkflowDrawer>
    </main>
  </div>
</template>
