<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  listNotaryMatters,
  notaryListStages,
  type NotaryListStage,
  type NotaryMatterListItem,
} from '../../api/notary';
import {
  defaultNotaryListPreference,
  getNotaryListPreference,
  saveNotaryListPreference,
  type NotaryListPreference,
  type NotaryListPreferenceColumn,
} from '../../api/notary-list-preference';
import { useAuthStore } from '../../stores/auth';

const stageLabels: Record<NotaryListStage, string> = {
  PENDING_EVIDENCE: '待取证',
  WAITING_UNBOX: '待取件开箱',
  UNBOX_REVIEW: '开箱待审核',
  ISSUANCE_DECISION: '开箱待确认',
  WAITING_CERTIFICATE: '待出证',
  WAITING_RETURN: '待退货',
  ARCHIVED: '已归档',
};
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<NotaryMatterListItem[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const preferenceState = ref<'loading' | 'ready' | 'failed'>('loading');
const savedPreference = ref<NotaryListPreference>({
  order: [...defaultNotaryListPreference.order],
  hidden: [],
});
const draftOrder = ref<NotaryListPreferenceColumn[]>([
  ...defaultNotaryListPreference.order,
]);
const draftHidden = ref<NotaryListPreference['hidden']>([]);
const settingsOpen = ref(false);
const preferenceMessage = ref('正在读取个人列设置。');
const saving = ref(false);
let listRequest: AbortController | undefined;
let preferenceRequest: AbortController | undefined;
let saveRequest: AbortController | undefined;
let preferenceGeneration = 0;
let saveGeneration = 0;
let currentListScope = '';

const selectedStage = computed<NotaryListStage | undefined>(() => {
  const value = route.query.stage;
  return typeof value === 'string' &&
    notaryListStages.some((stage) => stage === value)
    ? (value as NotaryListStage)
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
const columnLabels: Record<NotaryListPreferenceColumn, string> = {
  businessNo: '公证事项编号',
  stage: '阶段',
  sourceLead: '来源线索',
  notaryOffice: '公证处',
  createdAt: '创建时间',
};
const optionalColumns = computed(() =>
  draftOrder.value.filter(isOptionalColumn),
);
const visibleColumns = computed(() =>
  savedPreference.value.order.filter(
    (column) =>
      !isOptionalColumn(column) ||
      !savedPreference.value.hidden.includes(column),
  ),
);

function isOptionalColumn(
  column: NotaryListPreferenceColumn,
): column is Exclude<NotaryListPreferenceColumn, 'businessNo' | 'stage'> {
  return column !== 'businessNo' && column !== 'stage';
}

function copyPreference(
  preference: NotaryListPreference,
): NotaryListPreference {
  return { order: [...preference.order], hidden: [...preference.hidden] };
}

function setDraft(preference: NotaryListPreference): void {
  draftOrder.value = [...preference.order];
  draftHidden.value = [...preference.hidden];
}

async function loadPreference(userId: string | undefined): Promise<void> {
  preferenceRequest?.abort();
  saveRequest?.abort();
  preferenceGeneration += 1;
  saveGeneration += 1;
  const generation = preferenceGeneration;
  saving.value = false;
  settingsOpen.value = false;
  savedPreference.value = copyPreference(defaultNotaryListPreference);
  setDraft(defaultNotaryListPreference);
  if (!userId) {
    preferenceState.value = 'failed';
    preferenceMessage.value = '当前账号信息不可用，无法读取个人列设置。';
    return;
  }

  const controller = new AbortController();
  preferenceRequest = controller;
  preferenceState.value = 'loading';
  preferenceMessage.value = '正在读取个人列设置。';
  try {
    const preference = await getNotaryListPreference({
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== preferenceGeneration ||
      auth.session?.user.id !== userId
    )
      return;
    savedPreference.value = copyPreference(preference);
    setDraft(preference);
    preferenceState.value = 'ready';
    preferenceMessage.value = '个人列设置已加载。';
  } catch {
    if (
      controller.signal.aborted ||
      generation !== preferenceGeneration ||
      auth.session?.user.id !== userId
    )
      return;
    preferenceState.value = 'failed';
    preferenceMessage.value =
      '个人列设置读取失败。列表仍可使用默认列，请重试读取。';
  }
}

function moveDraftColumn(
  column: NotaryListPreferenceColumn,
  direction: -1 | 1,
) {
  if (!isOptionalColumn(column)) return;
  const optional = optionalColumns.value;
  const index = optional.indexOf(column);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= optional.length) return;
  const next = [...optional];
  [next[index], next[target]] = [next[target], next[index]];
  draftOrder.value = ['businessNo', 'stage', ...next];
}

function toggleDraftColumn(
  column: NotaryListPreferenceColumn,
  hidden: boolean,
): void {
  if (column === 'businessNo' || column === 'stage') return;
  draftHidden.value = hidden
    ? [...new Set([...draftHidden.value, column])]
    : draftHidden.value.filter((item) => item !== column);
}

async function savePreference(preference: NotaryListPreference): Promise<void> {
  const userId = auth.session?.user.id;
  if (preferenceState.value !== 'ready' || !userId || saving.value) return;
  saveRequest?.abort();
  const controller = new AbortController();
  saveRequest = controller;
  const generation = ++saveGeneration;
  saving.value = true;
  preferenceMessage.value = '正在保存个人列设置。';
  try {
    const saved = await saveNotaryListPreference(preference, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== saveGeneration ||
      auth.session?.user.id !== userId
    )
      return;
    savedPreference.value = copyPreference(saved);
    setDraft(saved);
    preferenceMessage.value = '个人列设置已保存。';
  } catch {
    if (
      controller.signal.aborted ||
      generation !== saveGeneration ||
      auth.session?.user.id !== userId
    )
      return;
    preferenceMessage.value = '保存失败，草稿仍保留，可以重试。';
  } finally {
    if (generation === saveGeneration) saving.value = false;
  }
}

function saveDraft(): Promise<void> {
  return savePreference({
    order: [...draftOrder.value],
    hidden: [...draftHidden.value],
  });
}

function cancelDraft(): void {
  setDraft(savedPreference.value);
  settingsOpen.value = false;
  preferenceMessage.value = '已取消未保存的列设置。';
}

function resetDraft(): Promise<void> {
  setDraft(defaultNotaryListPreference);
  return savePreference(copyPreference(defaultNotaryListPreference));
}

async function load(): Promise<void> {
  listRequest?.abort();
  const userId = auth.session?.user.id;
  const departmentId = auth.session?.department?.id;
  const scope = `${userId ?? ''}:${departmentId ?? ''}`;
  if (currentListScope && currentListScope !== scope) {
    items.value = [];
    total.value = 0;
  }
  currentListScope = scope;
  if (!userId) {
    items.value = [];
    total.value = 0;
    state.value = 'ready';
    return;
  }
  const controller = new AbortController();
  listRequest = controller;
  state.value = 'loading';
  try {
    const result = await listNotaryMatters(
      requestedPage.value,
      20,
      { signal: controller.signal },
      selectedStage.value,
    );
    if (
      controller.signal.aborted ||
      auth.session?.user.id !== userId ||
      auth.session?.department?.id !== departmentId
    )
      return;
    items.value = result.items;
    total.value = result.total;
    currentPage.value = result.page;
    pageSize.value = result.pageSize;
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
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
watch(
  () => [
    route.query.page,
    route.query.stage,
    auth.session?.user.id,
    auth.session?.department?.id,
  ],
  () => void load(),
  { immediate: true },
);
watch(
  () => auth.session?.user.id,
  (userId) => void loadPreference(userId),
  { immediate: true },
);
onBeforeUnmount(() => {
  listRequest?.abort();
  preferenceRequest?.abort();
  saveRequest?.abort();
});
</script>

<template>
  <div class="page-view">
    <main>
      <div class="page-head">
        <div>
          <h1>公证阶段</h1>
          <p>逐个办理当前账号有权查看的公证事项。</p>
        </div>
        <ElButton
          data-test="column-settings-toggle"
          :disabled="preferenceState !== 'ready' || saving"
          @click="settingsOpen = !settingsOpen"
          >列设置</ElButton
        >
      </div>
      <section
        v-if="settingsOpen"
        class="column-settings demo-card"
        aria-label="公证事项列设置"
      >
        <div class="column-settings-fixed">
          <strong>始终显示</strong>
          <span>公证事项编号、阶段</span>
        </div>
        <div class="column-settings-options">
          <div
            v-for="(column, index) in optionalColumns"
            :key="column"
            class="column-setting-row"
            data-test="column-option"
          >
            <label>
              <input
                type="checkbox"
                :checked="
                  !draftHidden.includes(
                    column as Exclude<
                      NotaryListPreferenceColumn,
                      'businessNo' | 'stage'
                    >,
                  )
                "
                :data-column-key="column"
                @change="
                  toggleDraftColumn(
                    column,
                    !($event.target as HTMLInputElement).checked,
                  )
                "
              />
              {{ columnLabels[column] }}
            </label>
            <ElButton
              :disabled="saving || index === 0"
              :aria-label="`上移${columnLabels[column]}`"
              @click="moveDraftColumn(column, -1)"
              >上移</ElButton
            >
            <ElButton
              :disabled="saving || index === optionalColumns.length - 1"
              :aria-label="`下移${columnLabels[column]}`"
              @click="moveDraftColumn(column, 1)"
              >下移</ElButton
            >
          </div>
        </div>
        <div class="column-settings-actions">
          <ElButton
            data-test="save-columns"
            :disabled="saving"
            @click="saveDraft"
          >
            {{ saving ? '保存中' : '保存' }}
          </ElButton>
          <ElButton
            data-test="cancel-columns"
            :disabled="saving"
            @click="cancelDraft"
          >
            取消
          </ElButton>
          <ElButton
            data-test="reset-columns"
            :disabled="saving"
            @click="resetDraft"
          >
            恢复默认
          </ElButton>
        </div>
      </section>
      <p
        class="column-preference-message"
        role="status"
        data-test="column-preference-status"
      >
        {{ preferenceMessage }}
        <ElButton
          v-if="preferenceState === 'failed'"
          data-test="retry-preference"
          @click="loadPreference(auth.session?.user.id)"
          >重试读取</ElButton
        >
      </p>
      <section class="demo-card" aria-live="polite">
        <div v-if="state === 'loading'" class="state-panel">
          <span class="state-index">读取中</span>
          <h2>正在读取公证事项</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <span class="state-index">连接失败</span>
          <h2>公证事项列表暂时无法加载</h2>
          <p>错误不会被当作空列表，可以直接重试。</p>
          <ElButton data-test="retry" @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <span class="state-index">0 条记录</span>
          <h2 v-if="selectedStage">
            「{{ stageLabels[selectedStage] }}」暂无记录
          </h2>
          <h2 v-else>当前没有公证事项</h2>
          <p v-if="selectedStage">可在侧栏切换其他阶段查看公证事项。</p>
          <p v-else>线索确认取证并移交后，事项会在这里出现。</p>
        </div>
        <div v-else class="demo-table-wrap">
          <table class="demo-table">
            <thead>
              <tr>
                <th v-for="column in visibleColumns" :key="column">
                  {{ columnLabels[column] }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="matter in items"
                :key="matter.id"
                data-test="matter-row"
              >
                <td v-for="column in visibleColumns" :key="column">
                  <template v-if="column === 'businessNo'">
                    <RouterLink
                      data-test="matter-link"
                      :to="`/notary-matters/${matter.id}`"
                      >{{ matter.businessNo }}</RouterLink
                    >
                  </template>
                  <template v-else-if="column === 'stage'">
                    <span class="pill">{{ stageLabels[matter.stage] }}</span>
                  </template>
                  <template v-else-if="column === 'sourceLead'">
                    <RouterLink
                      data-test="source-lead-link"
                      :to="`/leads/${matter.sourceLead.id}`"
                      >{{ matter.sourceLead.businessNo }}</RouterLink
                    >
                  </template>
                  <template v-else-if="column === 'notaryOffice'">
                    {{ matter.notaryOffice.name }}
                  </template>
                  <template v-else>
                    <span class="mono">{{ formatTime(matter.createdAt) }}</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="state === 'ready' && totalPages > 1"
          class="lead-pagination"
          aria-label="公证事项列表分页"
        >
          <ElButton
            data-test="previous-page"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
            >上一页</ElButton
          >
          <span>第 {{ currentPage }} / {{ totalPages }} 页</span>
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
.column-settings {
  margin-bottom: 1rem;
}

.column-settings-fixed,
.column-setting-row,
.column-settings-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.column-settings-options {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.column-setting-row label {
  align-items: center;
  display: inline-flex;
  flex: 1;
  gap: 0.5rem;
}

.column-settings-actions {
  margin-top: 1rem;
}

.column-preference-message {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
}
</style>
