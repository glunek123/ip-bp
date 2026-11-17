<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getCase,
  mailCaseExecution,
  submitExecution,
  type CaseDetail,
} from '../../api/cases';
import { uploadMaterialFile } from '../../api/materials';

type Mode = 'submission' | 'mailing';
type RowStatus =
  'loading' | 'ready' | 'submitting' | 'done' | 'failed' | 'skipped';

type Row = {
  caseId: string;
  businessNo: string;
  stage: string;
  detail: CaseDetail | null;
  file: globalThis.File | null;
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
  () => rows.value.filter((row) => row.status === 'ready').length,
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

function pickFile(row: Row, event: globalThis.Event): void {
  const input = event.target as globalThis.HTMLInputElement;
  row.file = input.files?.[0] ?? null;
  row.message = row.file ? row.file.name : '';
  if (row.status === 'done' || row.status === 'failed') row.status = 'ready';
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
    if (row.status !== 'ready' || !row.file || !row.detail) continue;
    row.status = 'submitting';
    row.message = '上传中…';
    try {
      const uploaded = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: row.caseId,
        category: isMailing.value ? 'MAIL_RECEIPT' : 'EXECUTION_APPLICATION',
        purpose: isMailing.value ? 'MAIL_RECEIPT' : 'EXECUTION_APPLICATION',
        file: row.file,
      });
      row.message = isMailing.value ? '邮寄中…' : '提交中…';
      if (isMailing.value) {
        const confirmationId = row.detail.executionConfirmation?.id ?? null;
        if (!confirmationId) throw new Error('该案尚未确认执行材料');
        await mailCaseExecution(row.caseId, {
          expectedVersion: row.detail.version,
          idempotencyKey: globalThis.crypto.randomUUID(),
          expectedConfirmationId: confirmationId,
          mailedAt: mailedAt.value,
          mailReceiptContentVersionIds: [uploaded.contentVersionId],
        });
      } else {
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
  if (failedRows.value.length === 0) {
    ElMessage.success(`${title.value}完成，共 ${doneCount.value} 件`);
    emit('done');
  }
}
</script>

<template>
  <section class="exec-batch" data-test="execution-batch-panel">
    <h3>{{ title }}</h3>
    <p class="exec-batch__hint">
      {{
        isMailing
          ? '上传每案的邮寄凭证（快递单照片或 PDF），统一按同一邮寄日期登记。'
          : '为每个案件选择执行申请文书，逐案提交后进入待确认阶段。'
      }}
    </p>
    <label v-if="isMailing" class="exec-batch__date">
      邮寄日期
      <input
        v-model="mailedAt"
        type="date"
        data-test="execution-batch-mailed-at"
      />
    </label>

    <ul class="exec-batch__list">
      <li v-for="row in rows" :key="row.caseId" class="exec-batch__row">
        <div class="exec-batch__meta">
          <strong>{{ row.businessNo }}</strong>
          <span>{{ row.stage }}</span>
        </div>
        <input
          type="file"
          :accept="accept"
          :disabled="
            row.status === 'loading' ||
            row.status === 'submitting' ||
            row.status === 'done'
          "
          :data-test="`execution-batch-file-${row.caseId}`"
          @change="pickFile(row, $event)"
        />
        <div class="exec-batch__state">
          <span>{{ row.message }}</span>
          <button
            v-if="
              row.file && row.status !== 'done' && row.status !== 'submitting'
            "
            type="button"
            class="link-button"
            @click="removeFile(row)"
          >
            移除
          </button>
        </div>
      </li>
    </ul>

    <p v-if="finished" role="status" data-test="execution-batch-result">
      成功 {{ doneCount }} 件，失败 {{ failedRows.length }} 件<template
        v-if="failedRows.length"
        >（{{ failedRows.map((row) => row.businessNo).join('、') }}）</template
      >
    </p>

    <div class="exec-batch__actions">
      <button type="button" :disabled="submitting" @click="emit('close')">
        关闭
      </button>
      <button
        type="button"
        data-test="execution-batch-submit"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ submitting ? '提交中…' : `提交（${readyCount} 件）` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.exec-batch {
  display: grid;
  gap: 12px;
}
.exec-batch__hint {
  margin: 0;
  color: #606266;
  font-size: 13px;
}
.exec-batch__date {
  display: flex;
  gap: 8px;
  align-items: center;
}
.exec-batch__list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 46vh;
  overflow: auto;
}
.exec-batch__row {
  display: grid;
  grid-template-columns: minmax(10rem, 1fr) minmax(10rem, 1.2fr) minmax(
      8rem,
      1fr
    );
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}
.exec-batch__meta {
  display: grid;
  gap: 2px;
  font-size: 13px;
}
.exec-batch__meta span {
  color: #909399;
}
.exec-batch__state {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: #606266;
}
.exec-batch__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
