<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { CaseDetail, CaseFile } from '../../api/cases';
import { ApiError, type RequestOptions } from '../../api/http';
import type { OwnerMaterial } from '../../api/materials';

const props = defineProps<{
  item: CaseDetail;
  contextKey: string;
  listCaseMaterials: (
    caseId: string,
    options?: RequestOptions,
  ) => Promise<{ items: OwnerMaterial[]; total: number }>;
  downloadVersion: (
    materialId: string,
    contentVersionId: string,
    signal?: globalThis.AbortSignal,
  ) => Promise<void>;
}>();
const emit = defineEmits<{ 'open-upload': [] }>();
type FileRow = CaseFile & { key: string; sources: string[] };
const pool = ref<OwnerMaterial[]>([]);
const loadState = ref<'loading' | 'ready' | 'denied' | 'failed'>('loading');
const downloadMessage = ref('');
const invalidFiles = ref(new Set<string>());
const downloading = ref(new Set<string>());
let revision = 0;
let active = true;
let loadController: AbortController | undefined;
const downloadControllers = new Map<string, AbortController>();

function fileKey(file: CaseFile): string {
  return JSON.stringify([file.materialId, file.contentVersionId]);
}
const rows = computed(() => {
  const files = new Map<string, FileRow>();
  function add(items: readonly CaseFile[], source: string): void {
    for (const file of items) {
      const key = fileKey(file);
      if (invalidFiles.value.has(key)) continue;
      const existing = files.get(key);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      } else files.set(key, { ...file, key, sources: [source] });
    }
  }
  const item = props.item;
  add(item.certificate.files, '来源公证书');
  add(item.certificate.disclosureFiles, '来源披露材料');
  add(item.complaint?.complaintFiles ?? [], '起诉诉状');
  add(item.complaint?.authorizationFiles ?? [], '起诉授权材料');
  add(
    item.complaintConfirmation?.complaintFile
      ? [item.complaintConfirmation.complaintFile]
      : [],
    '已确认诉状',
  );
  add(item.complaintMailing?.receiptFiles ?? [], '诉状邮寄回执');
  add(item.filingSubmission?.evidenceFiles ?? [], '立案证据');
  add(item.filingSubmission?.screenshotFiles ?? [], '立案截图');
  add(item.acceptance?.files ?? [], '当前受理材料');
  for (const entry of item.acceptances)
    add(entry.files, `受理历史 ${entry.id}`);
  for (const [category, group] of Object.entries(item.acceptanceMaterials)) {
    add(group.available, `${category} 可用材料`);
    add(group.frozen, `${category} 冻结材料`);
    add(group.later, `${category} 后续材料`);
  }
  add(item.judgment.current?.files ?? [], '当前一审判决');
  for (const entry of item.judgment.history)
    add(entry.files, `一审判决历史 ${entry.id}`);
  add(item.judgment.availableFiles, '可用判决材料');
  const second = item.secondInstance;
  add(second.currentProgress?.documentFiles ?? [], '当前二审文书');
  add(second.currentProgress?.serviceFiles ?? [], '当前二审送达材料');
  for (const entry of second.progresses) {
    add(entry.documentFiles, `二审文书历史 ${entry.id}`);
    add(entry.serviceFiles, `二审送达历史 ${entry.id}`);
  }
  add(second.currentResult?.files ?? [], '当前二审裁判');
  for (const entry of second.results)
    add(entry.files, `二审裁判历史 ${entry.id}`);
  add(item.executionSubmission.current?.files ?? [], '当前执行申请');
  for (const entry of item.executionSubmission.submissions)
    add(entry.files, `执行申请历史 ${entry.id}`);
  add(item.executionSubmission.availableFiles, '可用执行材料');
  add(item.executionConfirmation?.files ?? [], '已确认执行材料');
  add(item.executionMailing?.files ?? [], '执行邮寄回执');
  add(item.executionFiling?.files ?? [], '执行立案凭证');
  add(item.executionFinish?.files ?? [], '执行结束依据');
  add(item.closure?.current.files ?? [], '当前结案材料');
  for (const entry of item.closure?.history ?? [])
    add(entry.files, `结案历史 ${entry.id}`);
  for (const material of pool.value) {
    if (
      material.ownerType !== 'CASE' ||
      material.ownerId !== item.id ||
      material.status !== 'ACTIVE'
    )
      continue;
    for (const version of material.contentVersions) {
      if (version.status !== 'AVAILABLE') continue;
      add(
        [
          {
            materialId: material.id,
            contentVersionId: version.id,
            originalFilename: version.originalFilename,
            mimeType: version.mimeType,
          },
        ],
        `本案上传池 · ${material.category} · ${version.id === material.currentVersionId ? '当前版本' : '历史版本'}`,
      );
    }
  }
  return [...files.values()];
});

// This requests the existing stage editor; it never grants generic upload access.
const canOpenUpload = computed(() => {
  const item = props.item;
  switch (item.stage) {
    case 'WAITING_COMPLAINT':
      return item.canSubmitComplaint;
    case 'WAITING_COMPLAINT_STAMP':
      return item.canMailComplaint && !item.complaintMailing;
    case 'WAITING_FILING':
      return item.canSubmitFiling;
    case 'WAITING_FORMAL_ACCEPTANCE':
    case 'WAITING_HEARING':
      return item.canUploadAcceptanceMaterials;
    case 'WAITING_JUDGMENT':
      return (
        (item.canRegisterJudgment && !item.judgment.current) ||
        (item.canCorrectJudgment &&
          !!item.judgment.current &&
          !item.judgmentNextStep.current)
      );
    case 'SECOND_INSTANCE':
      return (
        !!item.secondInstance.currentTrialRoundId &&
        item.judgmentNextStep.current?.next === 'APPEAL' &&
        item.judgmentNextStep.current.trialRoundId ===
          item.secondInstance.currentTrialRoundId &&
        (item.canSaveSecondInstance ||
          (item.canRegisterSecondInstanceResult &&
            !item.secondInstance.currentResult))
      );
    case 'WAITING_EXECUTION_DOCUMENTS':
    case 'WAITING_EXECUTION_CONFIRMATION':
      return item.canSubmitExecution && !item.executionConfirmation;
    case 'WAITING_EXECUTION_STAMP':
      return (
        item.canMailExecution &&
        !!item.executionConfirmation &&
        !item.executionMailing
      );
    case 'WAITING_EXECUTION_FILING':
      return (
        item.canSubmitExecutionFiling &&
        !!item.executionMailing &&
        !item.executionFiling
      );
    case 'EXECUTING':
      return (
        item.canFinishExecution &&
        !!item.executionFiling &&
        !item.executionFinish
      );
    case 'WAITING_ARCHIVE':
      return (
        !!item.executionFinish &&
        ((item.canRecordClosure && !item.closure) ||
          (item.canCorrectClosure && !!item.closure))
      );
    default:
      return false;
  }
});
function openUpload(): void {
  if (active && canOpenUpload.value) emit('open-upload');
}
async function load(): Promise<void> {
  if (!active) return;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const currentRevision = revision;
  const caseId = props.item.id;
  const contextKey = props.contextKey;
  const isCurrent = () =>
    active &&
    !controller.signal.aborted &&
    currentRevision === revision &&
    caseId === props.item.id &&
    contextKey === props.contextKey;
  pool.value = [];
  loadState.value = 'loading';
  try {
    const result = await props.listCaseMaterials(caseId, {
      signal: controller.signal,
    });
    if (!isCurrent()) return;
    pool.value = result.items;
    loadState.value = 'ready';
  } catch (error) {
    if (!isCurrent()) return;
    loadState.value =
      error instanceof ApiError && [403, 404].includes(error.status)
        ? 'denied'
        : 'failed';
  }
}
function cancel(): void {
  revision += 1;
  loadController?.abort();
  for (const controller of downloadControllers.values()) controller.abort();
  downloadControllers.clear();
  downloading.value = new Set();
}
watch(
  [() => props.item.id, () => props.contextKey],
  () => {
    cancel();
    pool.value = [];
    invalidFiles.value = new Set();
    downloadMessage.value = '';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(cancel);
onDeactivated(() => {
  active = false;
  cancel();
});
onActivated(() => {
  active = true;
});

async function download(row: FileRow): Promise<void> {
  if (
    !active ||
    downloading.value.has(row.key) ||
    invalidFiles.value.has(row.key)
  )
    return;
  const currentRevision = revision;
  const caseId = props.item.id;
  const contextKey = props.contextKey;
  const controller = new AbortController();
  downloadControllers.set(row.key, controller);
  downloading.value.add(row.key);
  downloadMessage.value = '';
  try {
    await props.downloadVersion(
      row.materialId,
      row.contentVersionId,
      controller.signal,
    );
  } catch (error) {
    if (
      !active ||
      controller.signal.aborted ||
      currentRevision !== revision ||
      caseId !== props.item.id ||
      contextKey !== props.contextKey
    )
      return;
    if (error instanceof ApiError && [403, 404].includes(error.status)) {
      invalidFiles.value.add(row.key);
      downloadMessage.value =
        '该文件版本已不可访问，已移除失效引用。其他文件仍可查看。';
    } else downloadMessage.value = '文件下载失败，请重试。';
  } finally {
    if (
      currentRevision === revision &&
      downloadControllers.get(row.key) === controller
    ) {
      downloadControllers.delete(row.key);
      downloading.value.delete(row.key);
    }
  }
}
</script>

<template>
  <section class="case-workspace-files" aria-label="文件管理">
    <div class="case-workspace-section__header">
      <h2>案件文件</h2>
      <ElButton v-if="canOpenUpload" data-test="open-upload" @click="openUpload"
        >进入本阶段材料表单</ElButton
      >
    </div>
    <p class="case-workspace-field__help">
      按精确版本下载；来源与历史材料保留原关联。上传通过已有阶段表单办理。
    </p>
    <p v-if="loadState === 'loading'" role="status">正在加载本案上传材料…</p>
    <p v-else-if="loadState === 'denied'" role="alert">
      本案上传池不存在或无访问权限；以下仅显示案件详情已授权的文件引用。
    </p>
    <p v-else-if="loadState === 'failed'" role="alert">
      本案上传材料加载失败；已授权的文件引用仍可查看。
    </p>
    <ElButton
      v-if="loadState === 'failed'"
      data-test="retry-files"
      @click="load"
      >重新加载材料</ElButton
    >
    <p v-if="downloadMessage" role="alert">{{ downloadMessage }}</p>
    <p v-if="rows.length === 0 && loadState === 'ready' && !downloadMessage">
      尚未登记文件
    </p>
    <ul v-if="rows.length" class="case-workspace-fields">
      <li v-for="row in rows" :key="row.key" data-test="workspace-file">
        <span class="case-workspace-field__value">{{
          row.originalFilename
        }}</span>
        <p class="case-workspace-field__help">
          {{ row.mimeType }} · 精确版本：{{ row.contentVersionId }}
        </p>
        <p class="case-workspace-field__help">
          来源：{{ row.sources.join('；') }}
        </p>
        <ElButton
          :loading="downloading.has(row.key)"
          :disabled="downloading.has(row.key)"
          :aria-label="`下载 ${row.originalFilename} 版本 ${row.contentVersionId}`"
          @click="download(row)"
          >下载此版本</ElButton
        >
      </li>
    </ul>
  </section>
</template>
