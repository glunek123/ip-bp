<script lang="ts">
import type { CaseDetail } from '../../api/cases';
// Component adapter seam only. These view models are not production API DTOs.
export type GroupResourceSection = 'materials' | 'notary-summary' | 'ledger';
type SourceIdentity = { caseId: string; businessNo: string };
export type GroupMaterialView = SourceIdentity & {
  kind: 'material';
  materialId: string;
  contentVersionId: string;
  fileName: string;
  versionLabel: string;
  metadata?: string;
};
export type GroupFeeView = SourceIdentity & {
  sourceId: string;
  label: string;
  amount: string | null;
  stateLabel: string;
} & (
    | { kind: 'ledger' }
    | {
        kind: 'notary-summary';
        sourceType: CaseDetail['fees'][number]['sourceType'];
        category: CaseDetail['fees'][number]['category'];
      }
  );
export type GroupResourcePageView = {
  items: Array<GroupMaterialView | GroupFeeView>;
  page: number;
  pageSize: number;
  total: number;
};
export type GroupResourceReadContext = {
  groupId: string;
  section: GroupResourceSection;
  page: number;
  pageSize: number;
  signal: globalThis.AbortSignal;
};
export type LoadGroupResourcePage = (
  context: GroupResourceReadContext,
) => Promise<GroupResourcePageView>;
export type DownloadGroupMaterial = (
  material: GroupMaterialView,
  options: { signal: globalThis.AbortSignal },
) => Promise<void>;
</script>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import type { CaseHandlingGroupDetail } from '../../api/case-handling-groups';

const props = defineProps<{
  group: Pick<CaseHandlingGroupDetail, 'id' | 'revision' | 'status'>;
  actorKey: string;
  // Host includes auth revision, session generation and full route in this key.
  contextKey: string;
  loadPage: LoadGroupResourcePage;
  downloadMaterial: DownloadGroupMaterial;
}>();
const sections: Array<{ key: GroupResourceSection; label: string }> = [
  { key: 'materials', label: '材料' },
  { key: 'notary-summary', label: '原公证费用摘要' },
  { key: 'ledger', label: '完整费用账' },
];
const section = ref<GroupResourceSection | null>(null);
const projection = ref<GroupResourcePageView | null>(null);
const busy = ref(false);
const downloading = ref(false);
const error = ref('');
const downloadError = ref('');
let epoch = 0;
let mounted = true;
let readController: AbortController | undefined;
let downloadController: AbortController | undefined;
function identity(): string {
  return JSON.stringify([
    props.actorKey,
    props.contextKey,
    props.group.id,
    props.group.revision,
    props.group.status,
  ]);
}
function clear(): void {
  epoch += 1;
  readController?.abort();
  downloadController?.abort();
  projection.value = null;
  busy.value = false;
  downloading.value = false;
  error.value = '';
  downloadError.value = '';
}
function current(generation: number, key: string): boolean {
  return mounted && generation === epoch && key === identity();
}
function readError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403)
    return section.value === 'ledger'
      ? '当前无完整费用账读取权限。'
      : '当前无权读取这些资料。';
  if (cause instanceof ApiError && cause.status === 404)
    return '办理组或资料不存在，或当前不可读取。';
  return '资料读取失败，请重新查看。';
}
async function load(
  nextSection: GroupResourceSection,
  page = 1,
): Promise<void> {
  clear();
  section.value = nextSection;
  const generation = epoch;
  const key = identity();
  const groupId = props.group.id;
  readController = new AbortController();
  const signal = readController.signal;
  busy.value = true;
  try {
    const result = await props.loadPage({
      groupId,
      section: nextSection,
      page,
      pageSize: 20,
      signal,
    });
    if (!signal.aborted && current(generation, key)) projection.value = result;
  } catch (cause) {
    if (!signal.aborted && current(generation, key))
      error.value = readError(cause);
  } finally {
    if (current(generation, key)) busy.value = false;
  }
}
async function download(item: GroupMaterialView): Promise<void> {
  if (
    busy.value ||
    downloading.value ||
    !projection.value?.items.includes(item)
  )
    return;
  const generation = epoch;
  const key = identity();
  downloadController = new AbortController();
  const signal = downloadController.signal;
  downloading.value = true;
  downloadError.value = '';
  try {
    await props.downloadMaterial({ ...item }, { signal });
  } catch (cause) {
    if (!signal.aborted && current(generation, key))
      downloadError.value = readError(cause);
  } finally {
    if (current(generation, key)) downloading.value = false;
  }
}
watch(
  identity,
  () => {
    clear();
    section.value = null;
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  mounted = false;
  clear();
});
</script>

<template>
  <section class="group-resources" aria-label="组内材料与费用">
    <h2>组内材料与费用</h2>
    <p>仅显示当前可读的来源案资料；解除办理组后仍按来源案权限读取。</p>
    <div class="resource-actions" aria-label="选择资料类别">
      <ElButton
        v-for="entry in sections"
        :key="entry.key"
        :data-test="`view-${entry.key}`"
        :aria-pressed="section === entry.key"
        @click="load(entry.key)"
        >{{ entry.label }}</ElButton
      >
    </div>
    <p v-if="!section" role="status">选择资料类别后读取。</p>
    <p v-if="section === 'notary-summary'">原公证费用摘要不代表完整费用账。</p>
    <p v-if="section === 'ledger'">
      完整费用账需单独读取权限，不与公证摘要合并计算。
    </p>
    <p v-if="busy" role="status">正在读取资料…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="downloadError" role="alert">{{ downloadError }}</p>
    <template v-if="projection">
      <p v-if="!projection.items.length" role="status">
        当前页没有可显示的资料。
      </p>
      <ul v-else aria-label="当前页来源资料">
        <li
          v-for="item in projection.items"
          :key="
            item.kind === 'material'
              ? `${item.caseId}:${item.materialId}:${item.contentVersionId}`
              : item.kind === 'notary-summary'
                ? `${item.caseId}:${item.sourceType}:${item.sourceId}:${item.category}`
                : `${item.caseId}:${item.kind}:${item.sourceId}`
          "
        >
          <RouterLink :to="`/cases/${encodeURIComponent(item.caseId)}`">{{
            item.businessNo
          }}</RouterLink>
          <template v-if="item.kind === 'material'">
            <span>{{ item.fileName }} · {{ item.versionLabel }}</span>
            <details v-if="item.metadata">
              <summary>原材料信息</summary>
              {{ item.metadata }}
            </details>
            <ElButton :disabled="downloading" @click="download(item)"
              >下载原版本</ElButton
            >
          </template>
          <template v-else>
            <span v-if="item.kind === 'notary-summary'">{{
              item.sourceType === 'NOTARY_MATTER_EVIDENCE'
                ? '来源：公证事项证据'
                : '来源：公证书费用'
            }}</span>
            <span
              >{{ item.label }} · {{ item.stateLabel }} ·
              {{ item.amount === null ? '金额未知' : item.amount }}</span
            >
          </template>
        </li>
      </ul>
      <nav aria-label="资料分页">
        <ElButton
          data-test="resources-prev"
          :disabled="projection.page <= 1"
          @click="section && load(section, projection.page - 1)"
          >上一页</ElButton
        >
        <span>第 {{ projection.page }} 页</span>
        <ElButton
          data-test="resources-next"
          :disabled="projection.page * projection.pageSize >= projection.total"
          @click="section && load(section, projection.page + 1)"
          >下一页</ElButton
        >
      </nav>
    </template>
  </section>
</template>

<style scoped>
.group-resources {
  padding: var(--s-5);
}
.resource-actions,
.group-resources nav,
.group-resources li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-3);
  align-items: center;
}
.group-resources ul {
  padding: 0;
  list-style: none;
}
.group-resources li {
  padding-block: var(--s-3);
  border-bottom: 1px solid var(--color-hairline);
}
</style>
