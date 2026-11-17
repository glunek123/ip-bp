<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  getCase,
  mailCaseExecution,
  submitExecution,
  type CaseDetail,
} from '../../api/cases';
import { uploadMaterialFile } from '../../api/materials';
import { caseStageLabels } from './case-workspace-read-model';
import type { CaseStage } from '../../api/cases';

type Mode = 'submission' | 'mailing';
type RowStatus =
  'loading' | 'ready' | 'submitting' | 'done' | 'failed' | 'skipped';

type Row = {
  caseId: string;
  businessNo: string;
  stage: string;
  detail: CaseDetail | null;
  file: globalThis.File | null;
  remark: string;
  status: RowStatus;
  message: string;
};

const props = defineProps<{
  mode: Mode;
  cases: { id: string; businessNo: string; stage: string }[];
}>();
const emit = defineEmits<{ close: []; done: [] }>();

const rows = ref<Row[]>(
  props.cases.map((entry) => ({
    caseId: entry.id,
    businessNo: entry.businessNo,
    stage: entry.stage,
    detail: null,
    file: null,
    remark: '',
    status: 'loading',
    message: '读取中…',
  })),
);
const mailedAt = ref(today());
const submitting = ref(false);
const finished = ref(false);

const isMailing = computed(() => props.mode === 'mailing');
const title = computed(() =>
  isMailing.value ? '批量邮寄执行文书' : '批量上传执行文书',
);
const accept = computed(() =>
  isMailing.value ? 'image/*,application/pdf' : 'application/pdf,image/*',
);
const readyCount = computed(
  () =>
    rows.value.filter((row) =>
      isMailing.value
        ? row.status === 'ready'
        : row.status === 'ready' && row.file !== null,
    ).length,
);
const doneCount = computed(
  () => rows.value.filter((row) => row.status === 'done').length,
);
const failedRows = computed(() =>
  rows.value.filter((row) => row.status === 'failed'),
);
const canSubmit = computed(
  () =>
    !submitting.value &&
    readyCount.value > 0 &&
    (!isMailing.value || mailedAt.value !== ''),
);

function today(): string {
  const now = new globalThis.Date();
  const local = new globalThis.Date(now.getTime() + 8 * 3600 * 1000);
  return local.toISOString().slice(0, 10);
}

onMounted(async () => {
  for (const row of rows.value) {
    try {
      const detail = await getCase(row.caseId);
      row.detail = detail;
      row.stage = detail.stage;
      row.status = 'ready';
      row.message = '';
    } catch {
      row.status = 'failed';
      row.message = '读取案件失败';
    }
  }
});

// 用隐藏 input + 按钮触发，避免浏览器原生「Choose File / No file chosen」英文文案。
const sharedInput = ref<globalThis.HTMLInputElement | null>(null);
let pickingCaseId = '';
function triggerPick(caseId: string): void {
  pickingCaseId = caseId;
  sharedInput.value?.click();
}
function onSharedPicked(event: globalThis.Event): void {
  const input = event.target as globalThis.HTMLInputElement;
  const row = rows.value.find((entry) => entry.caseId === pickingCaseId);
  const file = input.files?.[0] ?? null;
  if (row) {
    row.file = file;
    row.message = file ? file.name : '';
    if (row.status === 'done' || row.status === 'failed') row.status = 'ready';
  }
  input.value = '';
}
function statusLabel(status: RowStatus): string {
  if (status === 'loading') return '读取中';
  if (status === 'submitting') return '提交中';
  if (status === 'done') return '已提交';
  if (status === 'failed') return '未完成';
  return '';
}

function removeFile(row: Row): void {
  row.file = null;
  row.message = '';
  if (row.status === 'done' || row.status === 'failed') row.status = 'ready';
}

/** 与单案面板保持一致：直接入口由二审结果或首轮决定是否携带决定书信息。 */
function submissionInput(row: Row, contentVersionId: string) {
  const detail = row.detail!;
  const next = detail.judgmentNextStep.current;
  const directExecutionEntry =
    detail.origin?.kind === 'EXTERNAL_ENTRY' &&
    detail.origin.initialStage === 'WAITING_EXECUTION_DOCUMENTS';
  const directSecondInstanceEntry =
    detail.origin?.kind === 'EXTERNAL_ENTRY' &&
    detail.origin.initialStage === 'SECOND_INSTANCE';
  const trialRoundId =
    detail.secondInstance.currentTrialRoundId ?? next?.trialRoundId;
  if (!trialRoundId) throw new Error('缺少审理轮次');
  if (!next && !directExecutionEntry && !directSecondInstanceEntry)
    throw new Error('缺少判决后续选择');
  const result = detail.secondInstance.currentResult;
  const secondInstanceResultId =
    (next?.next === 'APPEAL' || directSecondInstanceEntry) &&
    result &&
    (result.result === 'CHANGE' || result.result === 'AFFIRM')
      ? result.id
      : null;
  const judgmentNextStepId =
    directExecutionEntry || directSecondInstanceEntry
      ? null
      : (next?.id ?? null);
  const expectedSubmissionId = detail.executionSubmission.current?.id ?? null;
  return {
    expectedVersion: detail.version,
    idempotencyKey: globalThis.crypto.randomUUID(),
    trialRoundId,
    judgmentNextStepId,
    secondInstanceResultId,
    expectedSubmissionId,
    executionApplicationContentVersionIds: [contentVersionId],
    ...(expectedSubmissionId ? { changeReason: '批量上传执行文书' } : {}),
  };
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  finished.value = false;
  for (const row of rows.value) {
    if (row.status !== 'ready' || !row.detail) continue;
    if (!isMailing.value && !row.file) continue;
    row.status = 'submitting';
    row.message = '上传中…';
    try {
      if (isMailing.value) {
        row.message = '邮寄中…';
        const confirmationId = row.detail.executionConfirmation?.id ?? null;
        if (!confirmationId) throw new Error('该案尚未确认执行材料');
        await mailCaseExecution(row.caseId, {
          expectedVersion: row.detail.version,
          idempotencyKey: globalThis.crypto.randomUUID(),
          expectedConfirmationId: confirmationId,
          mailedAt: mailedAt.value,
          remark: row.remark.trim() ? row.remark.trim() : null,
        });
      } else {
        row.message = '上传中…';
        const uploaded = await uploadMaterialFile({
          ownerType: 'CASE',
          ownerId: row.caseId,
          category: 'EXECUTION_APPLICATION',
          purpose: 'EXECUTION_APPLICATION',
          file: row.file!,
        });
        row.message = '提交中…';
        await submitExecution(
          row.caseId,
          submissionInput(row, uploaded.contentVersionId),
        );
      }
      row.status = 'done';
      row.message = isMailing.value ? '已登记邮寄' : '已提交';
    } catch (cause) {
      row.status = 'failed';
      row.message =
        cause instanceof Error && cause.message
          ? cause.message.slice(0, 80)
          : '提交失败';
    }
  }
  submitting.value = false;
  finished.value = true;
  // 不自动关闭：失败时用户要能看到清单，成功时也要能确认结果。
  if (failedRows.value.length === 0)
    ElMessage.success(`${title.value}完成，共 ${doneCount.value} 件`);
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="execution-batch-panel">
    <h2 class="form-section-title">{{ title }}</h2>
    <p class="field-help">
      {{
        isMailing
          ? '按同一邮寄日期登记，备注可逐案填写或留空。'
          : '为每个案件选择执行申请文书，逐案提交后进入执行材料待确认。'
      }}
    </p>

    <div v-if="isMailing" class="exec-batch__field">
      <span class="exec-batch__label">邮寄日期</span>
      <input
        v-model="mailedAt"
        type="date"
        data-test="execution-batch-mailed-at"
      />
    </div>

    <ul class="exec-batch__list">
      <li v-for="row in rows" :key="row.caseId" class="exec-batch__item">
        <div class="exec-batch__head">
          <strong>{{ row.businessNo }}</strong>
          <span class="exec-batch__stage">{{
            caseStageLabels[row.stage as CaseStage] ?? row.stage
          }}</span>
          <span
            v-if="statusLabel(row.status)"
            class="exec-batch__status"
            :class="'exec-batch__status--' + row.status"
            >{{ statusLabel(row.status) }}</span
          >
        </div>
        <div v-if="isMailing" class="exec-batch__body">
          <textarea
            v-model="row.remark"
            class="text-input"
            rows="2"
            maxlength="1000"
            placeholder="备注（选填）"
            :disabled="row.status !== 'ready'"
            :data-test="'execution-batch-remark-' + row.caseId"
          ></textarea>
        </div>
        <div v-else class="exec-batch__body">
          <ElButton
            size="small"
            :disabled="
              row.status === 'loading' ||
              row.status === 'submitting' ||
              row.status === 'done'
            "
            :data-test="'execution-batch-pick-' + row.caseId"
            @click="triggerPick(row.caseId)"
            >选择文件</ElButton
          >
          <span class="exec-batch__file">{{
            row.message || '未选择文件'
          }}</span>
          <ElButton
            v-if="
              row.file && row.status !== 'done' && row.status !== 'submitting'
            "
            text
            size="small"
            @click="removeFile(row)"
            >移除</ElButton
          >
        </div>
      </li>
    </ul>

    <input
      ref="sharedInput"
      class="exec-batch__input"
      type="file"
      :accept="accept"
      @change="onSharedPicked"
    />

    <p
      v-if="finished"
      class="field-help"
      role="status"
      data-test="execution-batch-result"
    >
      成功 {{ doneCount }} 件，失败 {{ failedRows.length }} 件<template
        v-if="failedRows.length"
        >（{{ failedRows.map((row) => row.businessNo).join('、') }}）</template
      >
    </p>

    <div class="exec-batch__actions">
      <ElButton :disabled="submitting" @click="emit('close')">关闭</ElButton>
      <ElButton
        v-if="finished && failedRows.length === 0"
        type="primary"
        data-test="execution-batch-finish"
        @click="emit('done')"
        >完成</ElButton
      >
      <ElButton
        v-else
        type="primary"
        data-test="execution-batch-submit"
        :disabled="!canSubmit"
        @click="submit"
        >{{
          submitting ? '提交中…' : '提交（' + readyCount + ' 件）'
        }}</ElButton
      >
    </div>
  </section>
</template>

<style scoped>
.exec-batch__field {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.exec-batch__label {
  color: #606266;
  font-size: 13px;
  white-space: nowrap;
}
.exec-batch__field input[type='date'] {
  max-width: 220px;
}
.exec-batch__list {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
  max-height: 46vh;
  overflow: auto;
}
.exec-batch__item {
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.exec-batch__head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin-bottom: 8px;
}
.exec-batch__stage {
  color: #909399;
  font-size: 12px;
}
.exec-batch__status {
  font-size: 12px;
}
.exec-batch__status--done {
  color: #67c23a;
}
.exec-batch__status--failed {
  color: #f56c6c;
}
.exec-batch__status--submitting,
.exec-batch__status--loading {
  color: #909399;
}
.exec-batch__body {
  display: flex;
  gap: 8px;
  align-items: center;
}
.exec-batch__file {
  flex: 1;
  color: #606266;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exec-batch__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.exec-batch__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
