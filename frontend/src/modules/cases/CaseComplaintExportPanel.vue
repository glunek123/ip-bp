<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  complaintExportFailures,
  downloadComplaintZip,
  previewComplaintExport,
  type ComplaintExportPreview,
  type ComplaintExportResultItem,
  type ComplaintExportFailure,
  type ComplaintExportSelection,
} from '../../api/case-complaint-export';

const props = defineProps<{ selectedCases: CaseSummary[]; actorKey: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const preview = ref<ComplaintExportPreview | null>(null);
const selectedVersions = ref<Record<string, boolean>>({});
const results = ref<ComplaintExportResultItem[]>([]);
const failures = ref<ComplaintExportFailure[]>([]);
const loading = ref(false);
const downloading = ref(false);
const error = ref('');
let revision = 0;
const caseIds = computed(() => [
  ...new Set(props.selectedCases.map((item) => item.id)),
]);
const readyItems = computed(
  () => preview.value?.items.filter((item) => item.status === 'READY') ?? [],
);
const unavailableItems = computed(
  () => preview.value?.items.filter((item) => item.status !== 'READY') ?? [],
);
const selections = computed<ComplaintExportSelection[]>(() =>
  (preview.value?.items ?? []).flatMap((item) => {
    if (item.status !== 'READY') return [];
    return item.candidates
      .filter(
        (candidate) =>
          selectedVersions.value[
            `${item.caseId}:${candidate.materialId}:${candidate.contentVersionId}`
          ],
      )
      .map((candidate) => ({
        caseId: item.caseId,
        materialId: candidate.materialId,
        contentVersionId: candidate.contentVersionId,
      }));
  }),
);
const label = (tag: string) =>
  tag === 'CONFIRMED' ? '已确认' : tag === 'SUBMITTED' ? '已提交' : '上传池';
function failureMessage(code?: string): string {
  if (code === 'CASE_UNAVAILABLE') return '案件权限或范围已变化';
  if (code === 'VERSION_UNAVAILABLE') return '所选材料版本不可用';
  if (code === 'SIZE_LIMIT') return '超出导出大小上限';
  return '文件读取失败';
}
async function loadPreview(): Promise<void> {
  if (loading.value || caseIds.value.length < 1) return;
  const current = ++revision;
  const actor = props.actorKey;
  loading.value = true;
  error.value = '';
  results.value = [];
  failures.value = [];
  try {
    const value = await previewComplaintExport(caseIds.value);
    if (current !== revision || actor !== props.actorKey) return;
    preview.value = value;
    selectedVersions.value = {};
  } catch (reason) {
    if (current !== revision || actor !== props.actorKey) return;
    preview.value = null;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权导出案件诉状。'
        : '诉状版本预览失败，请重试。';
  } finally {
    if (current === revision) loading.value = false;
  }
}
async function download(): Promise<void> {
  if (downloading.value || loading.value || selections.value.length < 1) return;
  const current = revision;
  const actor = props.actorKey;
  const chosen = selections.value.map((item) => ({ ...item }));
  downloading.value = true;
  error.value = '';
  try {
    const file = await downloadComplaintZip(chosen);
    if (current !== revision || actor !== props.actorKey) return;
    results.value = file.results;
    failures.value = [];
    const url = globalThis.URL.createObjectURL(file.blob);
    try {
      const anchor = globalThis.document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      anchor.remove();
    } finally {
      globalThis.URL.revokeObjectURL(url);
    }
  } catch (reason) {
    if (current !== revision || actor !== props.actorKey) return;
    failures.value = complaintExportFailures(reason) ?? [];
    error.value =
      reason instanceof ApiError && reason.code === 'CASE_EXPORT_EMPTY'
        ? '所有选择都导出失败；请刷新预览后核对材料和权限。'
        : '下载失败；请刷新预览后重试。';
  } finally {
    if (current === revision) downloading.value = false;
  }
}
watch(
  () => [props.actorKey, caseIds.value.join('|')],
  () => {
    revision += 1;
    preview.value = null;
    selectedVersions.value = {};
    results.value = [];
    failures.value = [];
    loading.value = false;
    downloading.value = false;
    error.value = '';
  },
  { flush: 'sync' },
);
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="case-complaint-export-panel"
  >
    <h2 class="form-section-title">诉状材料预览与下载</h2>
    <p class="field-help">
      预览只读取已上传的诉状版本。明确选择所需版本后下载
      ZIP；此操作不生成诉状，也不推进案件。
    </p>
    <p>
      已选
      {{ caseIds.length }} 件；每次最多20案、100个文件，未压缩文件合计不超过100
      MiB。
    </p>
    <ElButton
      type="primary"
      :loading="loading"
      :disabled="
        loading || downloading || caseIds.length < 1 || caseIds.length > 20
      "
      data-test="complaint-export-preview"
      @click="loadPreview"
      >读取可下载版本</ElButton
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <section v-if="preview" data-test="complaint-export-candidates">
      <div class="complaint-export-columns">
        <section data-test="complaint-export-ready">
          <h3>可下载诉状</h3>
          <p v-if="!readyItems.length">暂无可下载诉状。</p>
          <div
            v-for="item in readyItems"
            :key="item.caseId"
            class="demo-card demo-card--pad"
          >
            <h4>{{ item.businessNo }}</h4>
            <fieldset>
              <legend>明确选择所需诉状版本（可多选）</legend>
              <label
                v-for="candidate in item.candidates"
                :key="candidate.contentVersionId"
                class="complaint-export-option"
              >
                <input
                  v-model="
                    selectedVersions[
                      `${item.caseId}:${candidate.materialId}:${candidate.contentVersionId}`
                    ]
                  "
                  type="checkbox"
                  :disabled="downloading"
                />
                <span
                  >{{ candidate.filename }} ·
                  {{ candidate.tags.map(label).join(' / ') }} ·
                  {{ candidate.sizeBytes }} 字节<br />版本 ID：{{
                    candidate.contentVersionId
                  }}</span
                >
              </label>
            </fieldset>
          </div>
        </section>
        <section data-test="complaint-export-unavailable">
          <h3>缺材料或不可访问</h3>
          <p v-if="!unavailableItems.length">无。</p>
          <div
            v-for="item in unavailableItems"
            :key="item.caseId"
            class="demo-card demo-card--pad"
          >
            <h4>{{ item.businessNo ?? '不可访问案件' }}</h4>
            <p>
              {{
                item.status === 'UNAVAILABLE'
                  ? '当前无权读取此案，或案件已不在当前部门。'
                  : '本案暂无可下载诉状材料。'
              }}
            </p>
          </div>
        </section>
      </div>
      <p>
        已明确选择 {{ selections.length }} 个文件。未选择或缺失的案件不会进入
        ZIP。
      </p>
      <ElButton
        type="primary"
        :loading="downloading"
        :disabled="downloading || loading || !selections.length"
        data-test="complaint-export-download"
        @click="download"
        >下载所选诉状 ZIP</ElButton
      >
    </section>
    <section v-if="results.length" data-test="complaint-export-results">
      <h3>本次导出结果</h3>
      <p v-for="item in results" :key="item.caseId">
        {{
          preview?.items.find((entry) => entry.caseId === item.caseId)
            ?.businessNo ?? item.caseId
        }}：成功 {{ item.successCount }}，失败 {{ item.failCount
        }}{{ item.errorCode ? `；${failureMessage(item.errorCode)}` : '' }}
      </p>
      <p>文件级结果与失败原因记录在 ZIP 内的 manifest.json。</p>
    </section>
    <section v-if="failures.length" data-test="complaint-export-failures">
      <h3>逐文件失败明细</h3>
      <ul>
        <li
          v-for="item in failures"
          :key="`${item.caseId}:${item.materialId}:${item.contentVersionId}`"
        >
          {{
            preview?.items.find((entry) => entry.caseId === item.caseId)
              ?.businessNo ?? item.caseId
          }}： {{ item.filename ?? '文件名不可用' }}；材料
          {{ item.materialId }}；版本 {{ item.contentVersionId }}；
          {{ failureMessage(item.reason) }}。
        </li>
      </ul>
    </section>
    <ElButton text :disabled="downloading" @click="emit('close')"
      >关闭</ElButton
    >
  </section>
</template>
<style scoped>
.complaint-export-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.complaint-export-columns > section {
  min-width: 0;
}
.complaint-export-option {
  display: flex;
  align-items: start;
  gap: 0.5rem;
  overflow-wrap: anywhere;
  margin-block: 0.5rem;
}
@media (max-width: 760px) {
  .complaint-export-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
