<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  exportNotaryList,
  previewNotaryListExport,
  type NotaryListExportScope,
} from '../../api/notary-list-export';
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
const selectedIds = ref<string[]>([]);
const exportOpen = ref(false);
const exportMode = ref<'SELECTED' | 'FILTERED' | null>(null);
const exportPreview = ref<{ count: number; maxRows: 1000 } | null>(null);
const exportMessage = ref('');
const exportLoading = ref(false);
let listRequest: AbortController | undefined;
let preferenceRequest: AbortController | undefined;
let saveRequest: AbortController | undefined;
let preferenceGeneration = 0;
let saveGeneration = 0;
let currentListScope = '';
let exportPreviewRequest: AbortController | undefined;
let exportRequest: AbortController | undefined;
let exportGeneration = 0;
let currentExportScopeKey = '';

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
const exportScopeKey = computed(() =>
  JSON.stringify({
    userId: auth.session?.user.id ?? '',
    departmentId: auth.session?.department?.id ?? '',
    stage: selectedStage.value ?? null,
    mode: exportMode.value,
    matterIds:
      exportMode.value === 'SELECTED' ? [...selectedIds.value].sort() : [],
  }),
);
const canConfirmExport = computed(
  () =>
    exportPreview.value !== null &&
    currentExportScopeKey === exportScopeKey.value,
);

function buildExportScope(): NotaryListExportScope | null {
  if (exportMode.value === 'SELECTED') {
    if (selectedIds.value.length === 0 || selectedIds.value.length > 1000)
      return null;
    return { mode: 'SELECTED', matterIds: [...selectedIds.value] };
  }
  if (exportMode.value === 'FILTERED') {
    return selectedStage.value
      ? { mode: 'FILTERED', stage: selectedStage.value }
      : { mode: 'FILTERED' };
  }
  return null;
}

function invalidateExport(): void {
  exportGeneration += 1;
  exportPreviewRequest?.abort();
  exportRequest?.abort();
  exportPreviewRequest = undefined;
  exportRequest = undefined;
  exportPreview.value = null;
  currentExportScopeKey = '';
  exportLoading.value = false;
}

function toggleMatter(id: string, checked: boolean): void {
  if (checked) {
    if (selectedIds.value.length >= 1000) {
      exportMessage.value = '最多可选择 1000 项，请缩小范围。';
      return;
    }
    if (!selectedIds.value.includes(id))
      selectedIds.value = [...selectedIds.value, id];
  } else {
    selectedIds.value = selectedIds.value.filter(
      (selectedId) => selectedId !== id,
    );
  }
  invalidateExport();
  exportMessage.value = '';
}

function toggleCurrentPage(checked: boolean): void {
  const pageIds = items.value.map((item) => item.id);
  if (checked) {
    const next = [...new Set([...selectedIds.value, ...pageIds])];
    if (next.length > 1000) {
      exportMessage.value = '最多可选择 1000 项，请缩小范围。';
      return;
    }
    selectedIds.value = next;
  } else {
    selectedIds.value = selectedIds.value.filter((id) => !pageIds.includes(id));
  }
  invalidateExport();
  exportMessage.value = '';
}

function clearSelection(): void {
  selectedIds.value = [];
  invalidateExport();
  exportMessage.value = '';
}

async function requestExportPreview(): Promise<void> {
  if (exportLoading.value) return;
  const scope = buildExportScope();
  if (!scope) {
    exportMessage.value = '请先明确选择导出范围；已勾选事项至少需要选择 1 项。';
    return;
  }
  invalidateExport();
  const generation = exportGeneration;
  const scopeKey = exportScopeKey.value;
  const userId = auth.session?.user.id;
  const departmentId = auth.session?.department?.id;
  const controller = new AbortController();
  exportPreviewRequest = controller;
  exportLoading.value = true;
  exportMessage.value = '正在核对导出范围与数量。';
  try {
    const result = await previewNotaryListExport(scope, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      auth.session?.user.id !== userId ||
      auth.session?.department?.id !== departmentId ||
      scopeKey !== exportScopeKey.value
    )
      return;
    exportPreview.value = result;
    currentExportScopeKey = scopeKey;
    exportMessage.value = `后端核对完成，共 ${result.count} 条。请确认后下载。`;
  } catch (error) {
    if (controller.signal.aborted || generation !== exportGeneration) return;
    exportMessage.value =
      error instanceof Error ? error.message : '预览失败，请重试。';
    if ((error as { code?: string })?.code === 'EXPORT_LIMIT_EXCEEDED')
      exportMessage.value = '导出范围超过 1000 条，请缩小范围后重新预览。';
  } finally {
    if (generation === exportGeneration) exportLoading.value = false;
  }
}

async function confirmExport(): Promise<void> {
  if (exportLoading.value || !canConfirmExport.value || !exportPreview.value)
    return;
  const scope = buildExportScope();
  if (!scope) return;
  const expectedCount = exportPreview.value.count;
  const generation = exportGeneration;
  const scopeKey = exportScopeKey.value;
  const userId = auth.session?.user.id;
  const departmentId = auth.session?.department?.id;
  const controller = new AbortController();
  exportRequest = controller;
  exportLoading.value = true;
  exportMessage.value = '正在生成下载文件。';
  try {
    const file = await exportNotaryList(scope, expectedCount, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== exportGeneration ||
      auth.session?.user.id !== userId ||
      auth.session?.department?.id !== departmentId ||
      scopeKey !== exportScopeKey.value
    )
      return;
    const url = URL.createObjectURL(file.blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    exportMessage.value = '文件已生成并交由浏览器下载。';
    exportPreview.value = null;
    currentExportScopeKey = '';
  } catch (error) {
    if (controller.signal.aborted || generation !== exportGeneration) return;
    const code = (error as { code?: string })?.code;
    exportMessage.value =
      code === 'EXPORT_SCOPE_CHANGED'
        ? '事项数量已变化，请重新预览后下载。'
        : code === 'EXPORT_LIMIT_EXCEEDED'
          ? '导出范围超过 1000 条，请缩小范围后重新预览。'
          : error instanceof Error
            ? error.message
            : '下载失败，请重试。';
    exportPreview.value = null;
    currentExportScopeKey = '';
  } finally {
    if (generation === exportGeneration) exportLoading.value = false;
  }
}

function closeExport(): void {
  invalidateExport();
  exportOpen.value = false;
  exportMode.value = null;
  exportMessage.value = '已取消导出。';
}

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
  () => [
    auth.session?.user.id,
    auth.session?.department?.id,
    selectedStage.value,
  ],
  () => {
    selectedIds.value = [];
    invalidateExport();
    exportOpen.value = false;
    exportMode.value = null;
  },
);
watch(exportScopeKey, () => {
  if (
    currentExportScopeKey !== exportScopeKey.value &&
    (exportPreview.value || exportPreviewRequest || exportRequest)
  )
    invalidateExport();
});
watch(
  () => auth.session?.user.id,
  (userId) => void loadPreference(userId),
  { immediate: true },
);
onBeforeUnmount(() => {
  listRequest?.abort();
  preferenceRequest?.abort();
  saveRequest?.abort();
  invalidateExport();
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
      <section class="export-panel demo-card" aria-label="公证事项清单导出">
        <div class="export-actions">
          <span data-test="selected-count"
            >已选择 {{ selectedIds.length }} 项</span
          >
          <ElButton
            data-test="clear-selection"
            :disabled="selectedIds.length === 0"
            @click="clearSelection"
            >清空选择</ElButton
          >
          <ElButton
            data-test="export-open"
            @click="
              exportOpen = true;
              exportMessage = '';
            "
            >批量导出</ElButton
          >
        </div>
        <div v-if="exportOpen" class="export-options">
          <strong>请明确选择导出范围</strong>
          <label>
            <input
              type="radio"
              name="notary-export-scope"
              data-test="export-mode-selected"
              value="SELECTED"
              :checked="exportMode === 'SELECTED'"
              @change="
                exportMode = 'SELECTED';
                exportMessage = '';
              "
            />
            已勾选事项（{{ selectedIds.length }} 项）
          </label>
          <label>
            <input
              type="radio"
              name="notary-export-scope"
              data-test="export-mode-filtered"
              value="FILTERED"
              :checked="exportMode === 'FILTERED'"
              @change="
                exportMode = 'FILTERED';
                exportMessage = '';
              "
            />
            当前阶段筛选结果（{{
              selectedStage ? stageLabels[selectedStage] : '全部可见事项'
            }}）
          </label>
          <p>
            仅导出事项编号、阶段、来源线索编号、公证处、创建时间五列；不含附件和内部费用。
          </p>
          <p v-if="exportPreview" data-test="export-preview-count">
            预览范围：{{
              exportMode === 'SELECTED' ? '已勾选事项' : '当前阶段筛选结果'
            }}；共 {{ exportPreview.count }} 条（上限
            {{ exportPreview.maxRows }} 条）。
          </p>
          <p v-if="exportMessage" role="status" data-test="export-status">
            {{ exportMessage }}
          </p>
          <div class="export-actions">
            <ElButton
              data-test="export-preview"
              :disabled="
                exportLoading ||
                !exportMode ||
                (exportMode === 'SELECTED' && selectedIds.length === 0)
              "
              @click="requestExportPreview"
              >{{ exportLoading ? '处理中' : '预览数量' }}</ElButton
            >
            <ElButton
              v-if="canConfirmExport"
              data-test="export-confirm"
              :disabled="exportLoading"
              @click="confirmExport"
              >确认下载 {{ exportPreview?.count }} 条</ElButton
            >
            <ElButton data-test="export-cancel" @click="closeExport"
              >取消</ElButton
            >
          </div>
        </div>
      </section>
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
                <th class="selection-column">
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    data-test="select-page"
                    :checked="
                      items.length > 0 &&
                      items.every((matter) => selectedIds.includes(matter.id))
                    "
                    :disabled="items.length === 0"
                    @change="
                      toggleCurrentPage(
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />选择
                </th>
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
                <td class="selection-column">
                  <input
                    type="checkbox"
                    :aria-label="`选择${matter.businessNo}`"
                    data-test="select-matter"
                    :checked="selectedIds.includes(matter.id)"
                    @change="
                      toggleMatter(
                        matter.id,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </td>
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

.export-panel {
  margin-bottom: 1rem;
  padding: 1rem;
}

.export-actions,
.export-options {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.export-options {
  align-items: flex-start;
  flex-direction: column;
  margin-top: 1rem;
}

.selection-column {
  white-space: nowrap;
  width: 5rem;
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
