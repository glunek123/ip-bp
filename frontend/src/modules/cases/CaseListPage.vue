<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  RouterLink,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { labelLeadPlatform } from '../leads/index';
import ListWorkflowDrawer from '../../app/ListWorkflowDrawer.vue';
import type {
  ListWorkflowContext,
  ListWorkflowLoad,
} from '../../app/list-workflow-context';
import CaseListWorkflowPanel, {
  decodeCaseListRequest,
} from './CaseListWorkflowPanel.vue';
import {
  primaryCaseAction,
  resolveCaseListActions,
  type CaseActionIntent,
} from './case-workspace-actions';
import {
  getExternalEntryOptions,
  getCase,
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
  route.query.stage === 'WAITING_ARCHIVE' ||
  route.query.stage === 'ARCHIVED'
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
const listQuery = computed(() =>
  Object.fromEntries(
    Object.entries(route.query).filter(([key]) =>
      ['view', 'page', 'stage', 'stageGroup'].includes(key),
    ),
  ),
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
  if (value === 'ARCHIVED') return '已归档';
  return '待开庭';
}
function listActions(item: CaseSummary) {
  const recovery = pendingActions.value.get(item.id);
  if (recovery)
    return [
      {
        id: 'recovery',
        section: 'case-info' as const,
        intent: recovery,
        label: '核对原办理请求',
      },
    ];
  const actions = resolveCaseListActions(item);
  const primary =
    actions.find((action) => action.intent === 'choose-next-step') ??
    primaryCaseAction(item.stage, actions);
  return primary
    ? [primary, ...actions.filter((action) => action !== primary)]
    : actions;
}
const pendingActions = ref(new Map<string, CaseActionIntent>());
const missingPendingActions = computed(() =>
  [...pendingActions.value].filter(
    ([id]) => !items.value.some((item) => item.id === id),
  ),
);
function readPendingActions() {
  const result = new Map<string, CaseActionIntent>();
  const prefix = `case-list-workflow:v1:${encodeURIComponent(identity.value)}:`;
  try {
    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
      try {
        const key = globalThis.sessionStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const raw = globalThis.sessionStorage.getItem(key);
        if (!raw) continue;
        const value: unknown = JSON.parse(raw);
        const pending = decodeCaseListRequest(value);
        if (
          pending &&
          pending.actor === identity.value &&
          key === `${prefix}${encodeURIComponent(pending.caseId)}`
        )
          result.set(pending.caseId, pending.action);
      } catch {
        /* Opening a fresh detail still fails closed if storage is inaccessible. */
      }
    }
  } catch {
    /* Storage restrictions must not prevent reading the case list. */
  }
  pendingActions.value = result;
}
function enterRecovery(id: string, action: CaseActionIntent) {
  if (!identity.value || openingAction.value) return;
  selectedAction.value = action;
  workflowContext.value = {
    recordId: id,
    actorKey: identity.value,
    actionKey: action,
    title: '核对原案件办理请求',
  };
  drawerOpen.value = true;
}
const drawer = ref<{
  canLeave: () => boolean;
  requestClose: () => boolean;
} | null>(null);
const drawerOpen = ref(false);
const workflowContext = ref<ListWorkflowContext | null>(null);
const selectedAction = ref<CaseActionIntent | null>(null);
const openingAction = computed(
  () => drawer.value !== null && !drawer.value.canLeave(),
);
function enterAction(item: CaseSummary, action: CaseActionIntent) {
  if (
    !identity.value ||
    openingAction.value ||
    (drawerOpen.value &&
      workflowContext.value?.recordId === item.id &&
      selectedAction.value === action)
  )
    return;
  const entry = listActions(item).find((entry) => entry.intent === action);
  if (!entry) return;
  selectedAction.value = action;
  workflowContext.value = {
    recordId: item.id,
    actorKey: identity.value,
    actionKey: action,
    title: `${item.businessNo} · ${entry.label}`,
  };
  drawerOpen.value = true;
}
function loadWorkflow(request: ListWorkflowLoad) {
  return getCase(request.context.recordId, { signal: request.signal });
}
function closeWorkflow() {
  drawerOpen.value = false;
  workflowContext.value = null;
  selectedAction.value = null;
}
function leaveWorkflow() {
  if (drawer.value && !drawer.value.canLeave()) return false;
  closeWorkflow();
  return true;
}
onBeforeRouteLeave(leaveWorkflow);
onBeforeRouteUpdate(leaveWorkflow);
watch(identity, closeWorkflow, { flush: 'sync' });
const amountColumns = [
  { key: 'claimAmount', label: '标的额' },
  { key: 'judgmentAmount', label: '判决额' },
  { key: 'closureAmount', label: '结案额' },
] as const;
const nameColumns = ['customerName', 'rightsHolderName'] as const;
type DisplayAmount =
  CaseSummary['displaySummary'][(typeof amountColumns)[number]['key']];
function amountLabel(amount: DisplayAmount): string {
  if (amount.state === 'UNRECORDED') return '未登记';
  if (amount.state === 'PENDING') return '待定';
  return amount.amount ?? '未登记';
}
function amountSourceLabel(source: DisplayAmount['sourceType']): string {
  if (source === 'COMPLAINT_CONFIRMATION') return '诉状确认';
  if (source === 'COMPLAINT_SUBMISSION') return '已提交诉状';
  if (source === 'FIRST_INSTANCE_JUDGMENT') return '一审判决';
  if (source === 'SECOND_INSTANCE_RESULT') return '二审结果';
  if (source === 'CASE_CLOSURE_VERSION') return '结案登记';
  return '未登记';
}
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const canCreateExternalEntry = ref(false);
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
  readPendingActions();
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
  canCreateExternalEntry.value = false;
  void getExternalEntryOptions({ signal: controller.signal })
    .then((result) => {
      if (!controller.signal.aborted && currentKey === requestKey.value)
        canCreateExternalEntry.value = result.canCreate;
    })
    .catch(() => {
      if (!controller.signal.aborted && currentKey === requestKey.value)
        canCreateExternalEntry.value = false;
    });
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
    readPendingActions();
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
  <div class="page-view business-list-page">
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
        <div class="case-list-head-actions">
          <ElButton
            v-if="canCreateExternalEntry"
            type="primary"
            @click="router.push('/cases/external-entry')"
            >转入／补录案件</ElButton
          >
          <ElButton text :loading="state === 'loading'" @click="load"
            >刷新</ElButton
          >
        </div>
      </div>
      <section
        v-if="missingPendingActions.length"
        class="state-panel"
        aria-label="未确认的案件办理请求"
      >
        <p>原办理请求尚待确认。即使案件已离开当前筛选，仍可核对原请求。</p>
        <ElButton
          v-for="[id, action] in missingPendingActions"
          :key="id"
          :disabled="openingAction"
          @click="enterRecovery(id, action)"
          >核对原办理请求</ElButton
        >
      </section>
      <div
        class="segmented-control business-list-toolbar"
        role="group"
        aria-label="案件范围"
      >
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
      <section v-else class="demo-card" data-test="case-list">
        <p v-if="items.length === 0" class="field-help demo-card--pad">
          当前没有案件。
        </p>
        <div
          v-else
          class="business-list-scroll"
          role="region"
          aria-label="案件列表，可横向滚动"
          tabindex="0"
        >
          <table class="demo-table business-list-table case-list-table">
            <caption class="sr-only">
              案件列表
            </caption>
            <colgroup>
              <col class="case-list-col--identity" />
              <col class="case-list-col--stage" />
              <col class="case-list-col--name" />
              <col class="case-list-col--name" />
              <col class="case-list-col--platform" />
              <col class="case-list-col--name" />
              <col class="case-list-col--identity" />
              <col class="case-list-col--name" />
              <col class="case-list-col--name" />
              <col class="case-list-col--name" />
              <col class="case-list-col--identity" />
              <col
                v-for="column in amountColumns"
                :key="column.key"
                class="case-list-col--amount"
              />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">操作／案件编号</th>
                <th scope="col">案件进展</th>
                <th scope="col">客户</th>
                <th scope="col">权利主体</th>
                <th scope="col">平台</th>
                <th scope="col">店铺</th>
                <th scope="col">店铺ID</th>
                <th scope="col">被告</th>
                <th scope="col">律师</th>
                <th scope="col">法院</th>
                <th scope="col">案号</th>
                <th
                  v-for="column in amountColumns"
                  :key="column.key"
                  scope="col"
                  class="num"
                >
                  {{ column.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td class="business-list-cell--nowrap">
                  <RouterLink
                    class="mono"
                    :to="{
                      path: `/cases/${encodeURIComponent(item.id)}`,
                      query: listQuery,
                    }"
                    >{{ item.businessNo }}</RouterLink
                  >
                  <div class="case-list-actions">
                    <ElButton
                      v-for="(action, index) in listActions(item)"
                      :key="action.intent"
                      :text="index !== 0"
                      type="primary"
                      :data-case-action="action.intent"
                      :disabled="openingAction"
                      @click="enterAction(item, action.intent)"
                    >
                      {{ action.label }}
                    </ElButton>
                    <span
                      v-if="listActions(item).length === 0"
                      class="field-help"
                      >当前无可办操作</span
                    >
                  </div>
                  <details class="case-list-context">
                    <summary :title="item.owner.displayName">
                      负责人：{{ item.owner.displayName }}
                    </summary>
                    <p>负责人：{{ item.owner.displayName }}</p>
                    <p v-if="item.sourceLead">
                      来源线索：<span class="mono case-list-identifier">{{
                        item.sourceLead.businessNo
                      }}</span>
                    </p>
                    <p v-if="item.sourceNotaryMatter">
                      公证事项：<span class="mono case-list-identifier">{{
                        item.sourceNotaryMatter.businessNo
                      }}</span>
                    </p>
                    <p v-if="item.origin?.kind === 'EXTERNAL_ENTRY'">
                      案件来源：{{
                        item.origin.entryKind === 'EXTERNAL_TRANSFER'
                          ? '外部转入'
                          : '历史补录'
                      }}
                      · {{ item.origin.stageReachedOn }}
                    </p>
                  </details>
                </td>
                <td class="business-list-cell--nowrap">
                  <span class="pill">{{ stageLabel(item.stage) }}</span>
                </td>
                <td
                  v-for="column in nameColumns"
                  :key="column"
                  class="business-list-cell--text"
                >
                  <details class="case-list-name">
                    <summary :title="item.displaySummary[column]">
                      {{ item.displaySummary[column] }}
                    </summary>
                    <p>{{ item.displaySummary[column] }}</p>
                  </details>
                </td>
                <td class="business-list-cell--nowrap">
                  {{
                    item.displaySummary.source.platform
                      ? labelLeadPlatform(item.displaySummary.source.platform)
                      : '未提供'
                  }}
                </td>
                <td class="business-list-cell--text">
                  <details class="case-list-name">
                    <summary
                      :title="item.displaySummary.source.shopName ?? '未提供'"
                    >
                      {{ item.displaySummary.source.shopName ?? '未提供' }}
                    </summary>
                    <p>{{ item.displaySummary.source.shopName ?? '未提供' }}</p>
                  </details>
                </td>
                <td class="mono business-list-cell--nowrap">
                  {{ item.displaySummary.source.shopExternalId ?? '未登记' }}
                </td>
                <td class="business-list-cell--text">
                  <details
                    v-if="item.displaySummary.defendants.length"
                    class="case-list-name"
                  >
                    <summary>
                      {{
                        item.displaySummary.defendants
                          .map((defendant) => defendant.name)
                          .join('、')
                      }}
                    </summary>
                    <ul>
                      <li
                        v-for="defendant in item.displaySummary.defendants"
                        :key="defendant.id"
                      >
                        {{ defendant.name }}
                      </li>
                    </ul>
                  </details>
                  <span v-else>未登记</span>
                </td>
                <td class="business-list-cell--text">
                  <details
                    v-if="item.displaySummary.lawyers.length"
                    class="case-list-name"
                  >
                    <summary>
                      {{
                        item.displaySummary.lawyers
                          .map((lawyer) => lawyer.fullName)
                          .join('、')
                      }}
                    </summary>
                    <ul>
                      <li
                        v-for="lawyer in item.displaySummary.lawyers"
                        :key="lawyer.id"
                      >
                        {{ lawyer.fullName }}
                      </li>
                    </ul>
                  </details>
                  <span v-else>未登记</span>
                </td>
                <td class="business-list-cell--text">
                  <details
                    v-if="item.displaySummary.court"
                    class="case-list-name"
                  >
                    <summary :title="item.displaySummary.court.name">
                      {{ item.displaySummary.court.name }}
                    </summary>
                    <p>{{ item.displaySummary.court.name }}</p>
                  </details>
                  <span v-else>未登记</span>
                </td>
                <td class="mono business-list-cell--nowrap">
                  {{ item.displaySummary.courtCaseNo ?? '未登记' }}
                </td>
                <td
                  v-for="column in amountColumns"
                  :key="column.key"
                  class="mono business-list-cell--number"
                >
                  <span>{{
                    amountLabel(item.displaySummary[column.key])
                  }}</span>
                  <details
                    v-if="item.displaySummary[column.key].sourceId !== null"
                    class="case-list-amount-source"
                  >
                    <summary>
                      {{
                        amountSourceLabel(
                          item.displaySummary[column.key].sourceType,
                        )
                      }}
                    </summary>
                    <p>
                      来源记录：{{ item.displaySummary[column.key].sourceId }}
                    </p>
                  </details>
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
            class="case-list-pagination"
            aria-label="案件分页"
            data-test="case-pagination"
          >
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
          </nav>
        </div>
      </section>
    </main>
    <ListWorkflowDrawer
      ref="drawer"
      v-model="drawerOpen"
      :context="workflowContext"
      :load-detail="loadWorkflow"
      @success="load"
    >
      <template #default="{ detail, session, requestState }">
        <CaseListWorkflowPanel
          v-if="selectedAction"
          :item="detail"
          :action="selectedAction"
          :session="session"
          :request-state="requestState"
        />
      </template>
    </ListWorkflowDrawer>
  </div>
</template>

<style scoped>
.case-list-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-1);
  white-space: normal;
}
.case-list-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.case-list-table {
  min-width: 2600px;
}

.case-list-col--identity {
  width: 200px;
}

.case-list-col--stage {
  width: 140px;
}

.case-list-col--name {
  width: 180px;
}

.case-list-col--platform {
  width: 100px;
}

.case-list-col--amount {
  width: 160px;
}

.case-list-name summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  cursor: pointer;
  white-space: normal;
  overflow-wrap: anywhere;
}

.case-list-name p,
.case-list-name ul,
.case-list-context p,
.case-list-amount-source p {
  margin: var(--s-2) 0 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.case-list-context,
.case-list-amount-source {
  margin-top: var(--s-2);
  color: var(--color-ink-muted);
  font-size: 12px;
}

.case-list-identifier {
  white-space: nowrap;
  word-break: normal;
}

.case-list-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}

.case-list-pagination span {
  white-space: nowrap;
}
</style>
