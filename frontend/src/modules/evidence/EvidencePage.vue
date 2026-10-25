<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { downloadMaterialVersion } from '../../api/materials';
import {
  bulkEvidenceStatus,
  exportSelectedEvidence,
  getEvidenceGroup,
  getEvidenceItemGroup,
  getEvidenceSourceGroup,
  listEvidenceGroups,
  listEvidence,
  matchingEvidenceIds,
  saveEvidenceGroup,
  saveEvidenceSourceGroup,
  type EvidenceDraftRow,
  type EvidenceFilter,
  type EvidenceGroup,
  type EvidenceItem,
  type EvidencePage as Page,
  type EvidenceStatus,
  type PaperStatus,
  type SaveEvidenceGroup,
  type BulkEvidenceStatus,
  type EvidenceElectronicFile,
  type EvidenceGroupSummary,
  type EvidenceGroupPage,
} from '../../api/evidence';
import type { LeadPlatform } from '../../api/leads';
import {
  reconcileEvidenceSelection,
  toggleVisibleEvidence,
} from './evidence-selection';
import { evidenceStageLabel, evidenceStages } from './evidence-stage-labels';
import { labelLeadPlatform } from '../leads';

const statusLabels: Record<EvidenceStatus, string> = {
  UNDELIVERED: '未交付',
  IN_STOCK: '在库',
  MAILED_TO_LAWYER: '已邮寄律师',
  DESTROYED: '已销毁',
};
const paperLabels: Record<PaperStatus, string> = {
  NOT_ISSUED: '未出纸质证',
  MAILED_TO_LAWYER: '纸质证邮寄律师',
};
const evidenceProvenanceLabels: Readonly<Record<string, string>> = {
  'notary.certificate_issued': '公证出证',
};
function platformLabel(value: string | null): string {
  if (!value) return '—';
  const label = labelLeadPlatform(value as LeadPlatform);
  return typeof label === 'string' ? label : '—';
}
function provenanceLabel(value: string | null): string {
  if (!value) return '—';
  if (Object.hasOwn(evidenceProvenanceLabels, value)) {
    const label = evidenceProvenanceLabels[value];
    return typeof label === 'string' ? label : '—';
  }
  if (Object.hasOwn(Object.prototype, value)) return '—';
  return /^(?:[a-z][a-z\d]*(?:[._-][a-z\d]+)+|[A-Z][A-Z\d]*(?:_[A-Z\d]+)+)$/u.test(
    value,
  )
    ? '—'
    : value;
}
const statusKeys = Object.keys(statusLabels) as EvidenceStatus[];
const paperKeys = Object.keys(paperLabels) as PaperStatus[];
const filter = ref<EvidenceFilter>({ page: 1, pageSize: 20, stages: [] });
const page = ref<Page | null>(null);
const matchingIds = ref<string[]>([]);
const selected = ref(new Set<string>());
const busy = ref(false);
const saving = ref(false);
const dialogLoading = ref(false);
const error = ref('');
const notice = ref('');
const dialog = ref<'view' | 'edit' | 'bulk' | 'sources' | null>(null);
const group = ref<EvidenceGroup | null>(null);
const sources = ref<EvidenceGroupPage | null>(null);
const sourceQuery = ref('');
const sourcePage = ref(1);
const draft = ref<EvidenceDraftRow[]>([]);
const remark = ref('');
const paperDraft = ref<{ id: string; status: PaperStatus }[]>([]);
const bulkEvidence = ref<EvidenceStatus | ''>('');
const bulkPaper = ref<PaperStatus | ''>('');
const bulkPapers = ref<
  { id: string; number: string | null; selected: boolean }[]
>([]);
const allVisibleSelected = computed(
  () =>
    matchingIds.value.length > 0 &&
    matchingIds.value.every((id) => selected.value.has(id)),
);

let loadSequence = 0;
let loadRequest: AbortController | undefined;
async function load() {
  const sequence = ++loadSequence;
  loadRequest?.abort();
  const request = new AbortController();
  loadRequest = request;
  busy.value = true;
  error.value = '';
  try {
    const [result, ids] = await Promise.all([
      listEvidence(filter.value, { signal: request.signal }),
      matchingEvidenceIds(filter.value, { signal: request.signal }),
    ]);
    if (sequence === loadSequence) {
      page.value = result;
      matchingIds.value = ids;
    }
  } catch (cause) {
    if (sequence === loadSequence) {
      error.value = cause instanceof Error ? cause.message : '证物列表加载失败';
      page.value = null;
      matchingIds.value = [];
    }
  } finally {
    if (sequence === loadSequence) busy.value = false;
  }
}

watch(filter, () => void load(), { deep: true });
onMounted(() => void load());
onBeforeUnmount(() => {
  ++loadSequence;
  loadRequest?.abort();
});

function setFilter<K extends keyof EvidenceFilter>(
  key: K,
  value: EvidenceFilter[K],
) {
  filter.value = { ...filter.value, page: 1, [key]: value };
}

function toggleStage(stage: string) {
  const next = new Set(filter.value.stages);
  if (next.has(stage)) next.delete(stage);
  else next.add(stage);
  setFilter('stages', [...next]);
}

function toggleOne(id: string) {
  if (dialogLoading.value) return;
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleVisible() {
  if (busy.value || dialogLoading.value) return;
  if (!matchingIds.value.length) {
    notice.value = '当前筛选下没有证物';
    return;
  }
  selected.value = toggleVisibleEvidence(selected.value, matchingIds.value);
}

async function openGroup(item: EvidenceItem, mode: 'view' | 'edit') {
  if (dialogLoading.value || saving.value) return;
  dialogLoading.value = true;
  error.value = '';
  notice.value = '';
  try {
    prepareGroup(await getEvidenceGroup(item.groupId), mode);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '证物分组加载失败';
  } finally {
    dialogLoading.value = false;
  }
}

function prepareGroup(loaded: EvidenceGroup, mode: 'view' | 'edit') {
  group.value = loaded;
  draft.value = loaded.items.map((row) => ({
    id: row.id,
    displayCode: row.displayCode ?? '',
    shelfLocation: row.shelfLocation ?? '',
    status: row.status,
    manualStatus: false,
  }));
  const remarks = [...new Set(loaded.items.map((row) => row.remark ?? ''))];
  remark.value = remarks.length === 1 ? (remarks[0] ?? '') : '';
  paperDraft.value = loaded.paperCertificates.map((paper) => ({
    id: paper.id,
    status: paper.status,
  }));
  if (!draft.value.length) addDraftRow();
  dialog.value = mode;
}

async function loadSources() {
  if (dialogLoading.value) return;
  dialogLoading.value = true;
  error.value = '';
  try {
    sources.value = await listEvidenceGroups({
      page: sourcePage.value,
      pageSize: 20,
      query: sourceQuery.value,
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '证物来源加载失败';
    sources.value = null;
  } finally {
    dialogLoading.value = false;
  }
}

async function openSources() {
  if (dialogLoading.value || saving.value) return;
  dialog.value = 'sources';
  notice.value = '';
  await loadSources();
}

async function changeSourcePage(delta: number) {
  if (dialogLoading.value) return;
  sourcePage.value += delta;
  await loadSources();
}

async function editSource(source: EvidenceGroupSummary) {
  if (dialogLoading.value || saving.value) return;
  dialogLoading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const loaded = source.groupId
      ? await getEvidenceGroup(source.groupId)
      : await getEvidenceSourceGroup(source.sourceKind, source.sourceId);
    if (dialog.value === 'sources') prepareGroup(loaded, 'edit');
  } catch (cause) {
    if (dialog.value === 'sources')
      error.value = cause instanceof Error ? cause.message : '证物来源加载失败';
  } finally {
    dialogLoading.value = false;
  }
}

function addDraftRow() {
  draft.value.push({
    displayCode: '',
    shelfLocation: '',
    status: 'UNDELIVERED',
    manualStatus: false,
  });
}

function fillDraftRow(row: EvidenceDraftRow) {
  if (row.manualStatus || row.status !== 'UNDELIVERED') return;
  if (!row.displayCode.trim() || !row.shelfLocation.trim()) return;
  const old = group.value?.items.find((item) => item.id === row.id);
  if (!old || !old.displayCode || !old.shelfLocation) row.status = 'IN_STOCK';
}

type Attempt = { fingerprint: string; key: string };
let groupAttempt: Attempt | undefined;
let bulkAttempt: Attempt | undefined;

async function saveGroup() {
  if (saving.value || !group.value) return;
  saving.value = true;
  error.value = '';
  try {
    const beforeIds = group.value.items.map((item) => item.id);
    const input: SaveEvidenceGroup = {
      expectedGroupVersion: group.value.groupVersion,
      rows: draft.value,
      ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
      paperCertificates: paperDraft.value,
    };
    const fingerprint = JSON.stringify({
      groupId: group.value.groupId,
      sourceKind: group.value.sourceKind,
      sourceId: group.value.sourceId,
      sourceVersion: group.value.sourceVersion,
      input,
    });
    if (groupAttempt?.fingerprint !== fingerprint)
      groupAttempt = { fingerprint, key: globalThis.crypto.randomUUID() };
    const result = group.value.groupId
      ? await saveEvidenceGroup(group.value.groupId, input, groupAttempt.key)
      : await saveEvidenceSourceGroup(
          group.value.sourceKind,
          group.value.sourceId,
          {
            expectedGroupVersion: 0,
            expectedSourceVersion: group.value.sourceVersion,
            rows: draft.value,
            ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
          },
          groupAttempt.key,
        );
    groupAttempt = undefined;
    notice.value = result.changed ? '证物已保存' : '未做任何修改';
    selected.value = reconcileEvidenceSelection(
      selected.value,
      beforeIds.filter(
        (id) => !result.group.items.some((item) => item.id === id),
      ),
    );
    group.value = result.group;
    if (result.changed) {
      dialog.value = null;
      await load();
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '证物保存失败';
  } finally {
    saving.value = false;
  }
}

async function openBulk() {
  if (dialogLoading.value || saving.value) return;
  if (!selected.value.size) {
    notice.value = '请先勾选证物';
    return;
  }
  error.value = '';
  notice.value = '';
  dialogLoading.value = true;
  try {
    const ids = [...selected.value];
    const groups = await Promise.all(ids.map((id) => getEvidenceItemGroup(id)));
    const papers = new Map<
      string,
      { id: string; number: string | null; selected: boolean }
    >();
    groups.forEach((entry) =>
      entry.paperCertificates.forEach((paper) => {
        papers.set(paper.id, {
          id: paper.id,
          number: paper.number,
          selected: false,
        });
      }),
    );
    bulkPapers.value = [...papers.values()];
    bulkEvidence.value = '';
    bulkPaper.value = '';
    dialog.value = 'bulk';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '批量对象加载失败';
  } finally {
    dialogLoading.value = false;
  }
}

async function saveBulk() {
  if (saving.value) return;
  if (!bulkEvidence.value && !bulkPaper.value) {
    notice.value = '没有要更改的状态';
    return;
  }
  const paperIds = bulkPapers.value
    .filter((paper) => paper.selected)
    .map((paper) => paper.id);
  if (bulkPaper.value && !paperIds.length) {
    notice.value = '请明确勾选要更改的纸质公证书';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const input: BulkEvidenceStatus = {
      evidenceIds: [...selected.value],
      paperCertificateIds: paperIds,
      ...(bulkEvidence.value ? { evidenceStatus: bulkEvidence.value } : {}),
      ...(bulkPaper.value ? { paperStatus: bulkPaper.value } : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (bulkAttempt?.fingerprint !== fingerprint)
      bulkAttempt = { fingerprint, key: globalThis.crypto.randomUUID() };
    const result = await bulkEvidenceStatus(input, bulkAttempt.key);
    bulkAttempt = undefined;
    const count = result.changedEvidence + result.changedPaperCertificates;
    notice.value = count ? `已更新 ${count} 条状态` : '没有变化';
    if (count) {
      dialog.value = null;
      await load();
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '批量更改失败';
  } finally {
    saving.value = false;
  }
}

async function exportSelected() {
  if (!selected.value.size) {
    notice.value = '请先勾选证物';
    return;
  }
  error.value = '';
  const requestedIds = [...selected.value];
  try {
    const result = await exportSelectedEvidence(requestedIds);
    downloadFile(
      new globalThis.Blob([result.csv], { type: 'text/csv;charset=utf-8' }),
      result.filename,
    );
    notice.value = `已导出所选 ${requestedIds.length} 件证物`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '证物导出失败';
  }
}

function downloadFile(
  blob: InstanceType<typeof globalThis.Blob>,
  filename: string,
) {
  const url = globalThis.URL.createObjectURL(blob);
  try {
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
}

async function downloadPaperVersion(file: EvidenceElectronicFile) {
  error.value = '';
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '电子公证书下载失败';
  }
}

function paperSummary(item: EvidenceItem, field: 'number' | 'status') {
  const values = item.paperCertificates.map((paper) =>
    field === 'number' ? paper.number || '—' : paperLabels[paper.status],
  );
  return values.length ? values.join(' / ') : '—';
}

function paperIdentity(
  id: string,
  papers: readonly { id: string; number: string | null }[],
): string {
  const paper = papers.find((entry) => entry.id === id);
  const number = paper?.number ?? null;
  if (!number || papers.filter((entry) => entry.number === number).length > 1)
    return `${number || '未编号'} · 记录 ${id}`;
  return number;
}
</script>

<template>
  <main class="evidence-page">
    <header class="page-head">
      <div>
        <h1>证物管理</h1>
        <p>查看证物、纸质公证书及关联案件</p>
      </div>
      <span>{{ page ? `共 ${page.total} 件证物` : '证物数量待加载' }}</span>
      <ElButton
        native-type="button"
        :disabled="dialogLoading"
        @click="openSources"
        >选择案件编辑证物</ElButton
      >
    </header>
    <p v-if="dialogLoading && !dialog" class="message" role="status">
      正在读取所选记录…
    </p>
    <p v-if="error && !dialog" class="message error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice && !dialog" class="message" role="status">{{ notice }}</p>

    <section class="filters" aria-label="证物筛选">
      <div class="status-row">
        <ElButton
          native-type="button"
          :class="{ active: !filter.status }"
          @click="setFilter('status', undefined)"
        >
          全部 {{ page?.counts.statuses.ALL ?? '—' }}
        </ElButton>
        <ElButton
          v-for="status in statusKeys"
          :key="status"
          native-type="button"
          :class="{ active: filter.status === status }"
          @click="setFilter('status', status)"
        >
          {{ statusLabels[status] }} {{ page?.counts.statuses[status] ?? '—' }}
        </ElButton>
      </div>
      <div class="filter-grid">
        <label
          >办案律师<input
            :value="filter.lawyerQuery ?? ''"
            placeholder="搜索办案律师…"
            @input="
              setFilter(
                'lawyerQuery',
                ($event.target as HTMLInputElement).value,
              )
            "
        /></label>
        <label
          >开庭起<input
            type="date"
            :value="filter.hearFrom ?? ''"
            @input="
              setFilter('hearFrom', ($event.target as HTMLInputElement).value)
            "
        /></label>
        <label
          >开庭止<input
            type="date"
            :value="filter.hearTo ?? ''"
            @input="
              setFilter('hearTo', ($event.target as HTMLInputElement).value)
            "
        /></label>
        <label
          >结案起<input
            type="date"
            :value="filter.closeFrom ?? ''"
            @input="
              setFilter('closeFrom', ($event.target as HTMLInputElement).value)
            "
        /></label>
        <label
          >结案止<input
            type="date"
            :value="filter.closeTo ?? ''"
            @input="
              setFilter('closeTo', ($event.target as HTMLInputElement).value)
            "
        /></label>
        <ElButton
          native-type="button"
          @click="
            filter = {
              ...filter,
              hearFrom: undefined,
              hearTo: undefined,
              closeFrom: undefined,
              closeTo: undefined,
              page: 1,
            }
          "
        >
          清除时间
        </ElButton>
      </div>
      <details
        class="stage-filter"
        :open="Boolean(filter.stages?.length)"
        aria-label="按案件进展筛选"
      >
        <summary>
          案件进展筛选 · 已选 {{ filter.stages?.length ?? 0 }} 项 ·
          {{ page?.counts.allStageCases ?? '—' }} 案
        </summary>
        <div class="stage-row" aria-label="案件进展多选">
          <label v-for="stage in evidenceStages" :key="stage.value"
            ><input
              type="checkbox"
              :checked="filter.stages?.includes(stage.value)"
              @change="toggleStage(stage.value)"
            />{{ stage.label }}
            {{ page ? (page.counts.stages[stage.value] ?? 0) : '—' }}</label
          >
          <ElButton
            v-if="filter.stages?.length"
            native-type="button"
            @click="setFilter('stages', [])"
          >
            清除进展
          </ElButton>
        </div>
      </details>
    </section>

    <section class="list-card">
      <div class="actions">
        <span>已勾选 {{ selected.size }} 件证物</span>
        <ElButton
          native-type="button"
          :disabled="dialogLoading"
          @click="openBulk"
          >批量更改状态</ElButton
        >
        <ElButton native-type="button" @click="exportSelected"
          >导出清单</ElButton
        >
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="全选或反选当前筛选集合"
                  :checked="allVisibleSelected"
                  :disabled="busy || dialogLoading"
                  @change="toggleVisible"
                />
              </th>
              <th>操作</th>
              <th>店铺名</th>
              <th>案件进展</th>
              <th>办案律师</th>
              <th>公证书编号</th>
              <th>公证书状态</th>
              <th>证物编号</th>
              <th>货架号</th>
              <th>证物状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in page?.items ?? []" :key="item.id">
              <td>
                <input
                  type="checkbox"
                  :aria-label="`选择证物 ${item.displayCode ?? item.id}`"
                  :disabled="dialogLoading"
                  :checked="selected.has(item.id)"
                  @change="toggleOne(item.id)"
                />
              </td>
              <td>
                <ElButton
                  native-type="button"
                  :disabled="dialogLoading"
                  @click="openGroup(item, 'edit')"
                >
                  编辑</ElButton
                ><ElButton
                  native-type="button"
                  @click="openGroup(item, 'view')"
                  :disabled="dialogLoading"
                >
                  查看
                </ElButton>
              </td>
              <td>{{ item.shopName || '—' }}</td>
              <td>{{ evidenceStageLabel(item.stage) }}</td>
              <td>{{ item.lawyerName || '—' }}</td>
              <td>{{ paperSummary(item, 'number') }}</td>
              <td>{{ paperSummary(item, 'status') }}</td>
              <td>{{ item.displayCode || '—' }}</td>
              <td>{{ item.shelfLocation || '—' }}</td>
              <td>{{ statusLabels[item.status] }}</td>
              <td>{{ item.remark || '—' }}</td>
            </tr>
            <tr v-if="!busy && page && !page.items.length">
              <td colspan="11">没有匹配的证物，请调整筛选条件。</td>
            </tr>
            <tr v-if="busy">
              <td colspan="11">正在加载证物…</td>
            </tr>
            <tr v-if="!busy && !page && error">
              <td colspan="11">
                列表未加载成功
                <ElButton native-type="button" @click="load">重试</ElButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pager">
        <ElButton
          native-type="button"
          :disabled="(filter.page ?? 1) <= 1"
          @click="filter = { ...filter, page: (filter.page ?? 1) - 1 }"
        >
          上一页</ElButton
        ><span>第 {{ filter.page ?? 1 }} 页</span
        ><ElButton
          native-type="button"
          :disabled="
            (filter.page ?? 1) * (filter.pageSize ?? 20) >= (page?.total ?? 0)
          "
          @click="filter = { ...filter, page: (filter.page ?? 1) + 1 }"
        >
          下一页
        </ElButton>
      </div>
    </section>

    <div
      v-if="(dialog === 'view' || dialog === 'edit') && group"
      class="overlay"
      role="presentation"
    >
      <section
        v-if="dialog === 'view'"
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="查看证物与公证书"
      >
        <h2>证物与公证书</h2>
        <p v-if="error" class="message error" role="alert">{{ error }}</p>
        <a
          v-if="group.case.id"
          :href="`/cases/${encodeURIComponent(group.case.id)}`"
          >查看关联案件</a
        >
        <p>
          平台：{{ platformLabel(group.case.platform) }} · 店铺名：{{
            group.case.shopName || '—'
          }}
          · 案号：{{ group.case.caseNo || '—' }}
        </p>
        <p>
          案件进展：{{ evidenceStageLabel(group.case.stage) }} · 办案律师：{{
            group.case.lawyerName || '—'
          }}
        </p>
        <h3>证物（{{ group.items.length }}）</h3>
        <ul>
          <li v-for="item in group.items" :key="item.id">
            {{ item.displayCode || '—' }} · {{ item.shelfLocation || '—' }} ·
            {{ statusLabels[item.status] }} · {{ item.remark || '—' }}
            <p>
              名称：{{ item.name || '—' }} · 类型：{{ item.kind || '—' }} ·
              采集日期：{{ item.collectedOn || '—' }} · 保管人：{{
                item.keeperName || '—'
              }}
            </p>
            <p>来源：{{ provenanceLabel(item.provenance) }}</p>
          </li>
        </ul>
        <p v-if="!group.items.length">该案件暂无证物</p>
        <h3>纸质公证书（{{ group.paperCertificates.length }}）</h3>
        <ul>
          <li v-for="paper in group.paperCertificates" :key="paper.id">
            {{ paperIdentity(paper.id, group.paperCertificates) }} ·
            {{ paperLabels[paper.status] }} · {{ paper.issuedOn || '—' }} ·
            {{ paper.officeName || '—' }}
            <ElButton
              v-for="file in paper.electronicFiles"
              :key="`${file.materialId}:${file.contentVersionId}`"
              native-type="button"
              @click="downloadPaperVersion(file)"
              >下载 {{ file.filename }}</ElButton
            >
          </li>
        </ul>
        <p v-if="!group.paperCertificates.length">暂无纸质公证书</p>
        <ElButton native-type="button" @click="dialog = null">关闭</ElButton>
      </section>
      <section
        v-else-if="dialog === 'edit'"
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="编辑证物"
      >
        <h2>编辑证物</h2>
        <p v-if="error" class="message error" role="alert">{{ error }}</p>
        <p v-if="notice" class="message" role="status">{{ notice }}</p>
        <p>
          {{ group.case.shopName || '—' }} · {{ group.case.caseNo || '—' }} ·
          {{ evidenceStageLabel(group.case.stage) }} ·
          {{ group.case.lawyerName || '—' }}
        </p>
        <label
          >备注<input
            v-model="remark"
            :disabled="saving"
            placeholder="证物备注"
        /></label>
        <h3>纸质公证书</h3>
        <div v-for="paper in paperDraft" :key="paper.id" class="edit-row">
          <span>{{ paperIdentity(paper.id, group.paperCertificates) }}</span
          ><select v-model="paper.status" :disabled="saving">
            <option v-for="status in paperKeys" :key="status" :value="status">
              {{ paperLabels[status] }}
            </option>
          </select>
        </div>
        <h3>证物（{{ draft.length }}）</h3>
        <div
          v-for="(row, index) in draft"
          :key="row.id ?? `new-${index}`"
          class="edit-row"
        >
          <input
            v-model="row.displayCode"
            :disabled="saving"
            aria-label="证物编号"
            placeholder="证物编号"
            @input="fillDraftRow(row)"
          />
          <input
            v-model="row.shelfLocation"
            :disabled="saving"
            aria-label="货架号"
            placeholder="货架号"
            @input="fillDraftRow(row)"
          />
          <select
            v-model="row.status"
            :disabled="saving"
            aria-label="证物状态"
            @change="row.manualStatus = true"
          >
            <option v-for="status in statusKeys" :key="status" :value="status">
              {{ statusLabels[status] }}
            </option>
          </select>
          <ElButton
            native-type="button"
            :aria-label="`移除第 ${index + 1} 行`"
            :disabled="saving"
            @click="draft.splice(index, 1)"
          >
            移除
          </ElButton>
        </div>
        <ElButton native-type="button" :disabled="saving" @click="addDraftRow"
          >+ 添加证物</ElButton
        >
        <footer>
          <ElButton
            native-type="button"
            :disabled="saving"
            @click="dialog = null"
            >取消</ElButton
          ><ElButton native-type="button" :disabled="saving" @click="saveGroup">
            保存
          </ElButton>
        </footer>
      </section>
    </div>
    <div v-if="dialog === 'sources'" class="overlay" role="presentation">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="选择案件编辑证物"
      >
        <h2>选择案件编辑证物</h2>
        <p v-if="dialogLoading" class="message" role="status">
          正在读取真实来源…
        </p>
        <p v-if="error" class="message error" role="alert">{{ error }}</p>
        <label
          >搜索案件／店铺<input
            v-model="sourceQuery"
            placeholder="案件单号或店铺名"
        /></label>
        <ElButton
          native-type="button"
          :disabled="dialogLoading"
          @click="
            sourcePage = 1;
            loadSources();
          "
          >搜索</ElButton
        >
        <table>
          <thead>
            <tr>
              <th>来源单号</th>
              <th>店铺名</th>
              <th>证物件数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="source in sources?.items ?? []"
              :key="`${source.sourceKind}:${source.sourceId}`"
            >
              <td>{{ source.businessNo }}</td>
              <td>{{ source.shopName || '—' }}</td>
              <td>{{ source.activeItemCount }}</td>
              <td>
                <ElButton
                  native-type="button"
                  :disabled="dialogLoading"
                  @click="editSource(source)"
                  >编辑证物</ElButton
                >
              </td>
            </tr>
            <tr v-if="sources && !sources.items.length">
              <td colspan="4">没有匹配的真实案件或已出证公证事项</td>
            </tr>
          </tbody>
        </table>
        <footer>
          <ElButton
            native-type="button"
            :disabled="sourcePage <= 1 || dialogLoading"
            @click="changeSourcePage(-1)"
            >上一页</ElButton
          >
          <span>第 {{ sourcePage }} 页</span>
          <ElButton
            native-type="button"
            :disabled="
              sourcePage * 20 >= (sources?.total ?? 0) || dialogLoading
            "
            @click="changeSourcePage(1)"
            >下一页</ElButton
          >
          <ElButton native-type="button" @click="dialog = null">关闭</ElButton>
        </footer>
      </section>
    </div>
    <div v-if="dialog === 'bulk'" class="overlay" role="presentation">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="批量更改状态"
      >
        <h2>批量更改状态 · {{ selected.size }} 件证物</h2>
        <p v-if="error" class="message error" role="alert">{{ error }}</p>
        <p v-if="notice" class="message" role="status">{{ notice }}</p>
        <label
          >证物状态<select v-model="bulkEvidence" :disabled="saving">
            <option value="">不修改</option>
            <option v-for="status in statusKeys" :key="status" :value="status">
              {{ statusLabels[status] }}
            </option>
          </select></label
        >
        <label
          >纸质公证书状态<select v-model="bulkPaper" :disabled="saving">
            <option value="">不修改</option>
            <option v-for="status in paperKeys" :key="status" :value="status">
              {{ paperLabels[status] }}
            </option>
          </select></label
        >
        <fieldset v-if="bulkPaper">
          <legend>明确选择要修改的纸质公证书</legend>
          <label v-for="paper in bulkPapers" :key="paper.id"
            ><input
              v-model="paper.selected"
              :disabled="saving"
              type="checkbox"
            />{{ paperIdentity(paper.id, bulkPapers) }}</label
          >
          <p v-if="!bulkPapers.length">所选证物没有关联纸质公证书</p>
        </fieldset>
        <footer>
          <ElButton
            native-type="button"
            :disabled="saving"
            @click="dialog = null"
            >取消</ElButton
          ><ElButton native-type="button" :disabled="saving" @click="saveBulk">
            保存
          </ElButton>
        </footer>
      </section>
    </div>
  </main>
</template>

<style scoped>
.evidence-page {
  padding: 24px;
  color: var(--color-ink, #0f1011);
}
.page-head,
.actions,
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
h1 {
  margin: 0;
  font-size: 20px;
}
h2 {
  font-size: 18px;
}
h3 {
  font-size: 14px;
}
.page-head p {
  color: var(--color-ink-muted, #5c5e66);
}
.filters,
.list-card {
  margin-top: 16px;
  padding: 16px;
  background: var(--color-surface-1, #fff);
  border: 1px solid var(--color-hairline, #e5e5e9);
  border-radius: 8px;
}
.status-row,
.stage-row,
.filter-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.stage-filter {
  margin-bottom: 12px;
}
.stage-filter summary {
  width: fit-content;
  cursor: pointer;
  color: var(--color-ink-muted, #5c5e66);
}
.stage-filter .stage-row {
  margin-top: 10px;
}
.filter-grid label,
.modal label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
button,
input,
select {
  min-height: 32px;
  border: 1px solid var(--color-hairline-strong, #d2d2d8);
  border-radius: 6px;
  background: #fff;
  color: inherit;
  padding: 4px 8px;
}
button {
  cursor: pointer;
}
button:hover,
.status-row .active {
  color: var(--color-primary, #5e6ad2);
  border-color: var(--color-primary, #5e6ad2);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
input[type='checkbox'] {
  min-height: auto;
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-size: 12px;
}
th,
td {
  padding: 10px;
  border-bottom: 1px solid var(--color-hairline, #e5e5e9);
  text-align: left;
}
th {
  background: var(--color-surface-2, #f4f4f6);
}
td button {
  margin-right: 4px;
}
.pager {
  justify-content: flex-end;
  margin-top: 12px;
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 16, 17, 0.45);
  display: grid;
  place-items: center;
  z-index: 200;
}
.modal {
  width: min(900px, 94vw);
  max-height: 90vh;
  overflow: auto;
  padding: 24px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 24px 64px rgba(15, 16, 17, 0.14);
}
.edit-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}
.edit-row input {
  flex: 1;
  min-width: 100px;
}
.modal footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.message {
  padding: 8px;
  color: var(--color-info, #2563eb);
}
.message.error {
  color: var(--color-danger, #c4272b);
}
</style>
