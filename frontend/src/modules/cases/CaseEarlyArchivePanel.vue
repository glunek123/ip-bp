<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import OperationDrawer from '../../app/OperationDrawer.vue';
import { ApiError } from '../../api/http';
import {
  earlyArchiveCase,
  todayShanghai,
  type CaseStage,
  type CaseSummary,
  type EarlyArchiveCaseInput,
  type EarlyArchiveCaseResult,
} from '../../api/cases';

const props = defineProps<{
  item: Pick<
    CaseSummary,
    'id' | 'businessNo' | 'stage' | 'version' | 'canEarlyArchive'
  >;
  contextKey: string;
}>();
const emit = defineEmits<{
  close: [];
  completed: [result: EarlyArchiveCaseResult];
  'access-lost': [];
}>();
const archiveAt = ref(todayShanghai());
const reason = ref('');
const confirmed = ref(false);
const busy = ref(false);
const error = ref('');
const pending = ref<EarlyArchiveCaseInput | null>(null);
const unknown = ref(false);
const epoch = ref(0);
const canSubmit = computed(
  () =>
    !busy.value &&
    props.item.canEarlyArchive === true &&
    props.item.stage !== 'ARCHIVED' &&
    confirmed.value &&
    (pending.value !== null ||
      (archiveAt.value.length === 10 && reason.value.trim().length > 0)),
);
const stageNames: Record<CaseStage, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};
watch(
  () => `${props.item.id}:${props.contextKey}:${props.item.version}`,
  () => {
    epoch.value += 1;
    if (!pending.value) {
      archiveAt.value = todayShanghai();
      reason.value = '';
      confirmed.value = false;
      error.value = '';
    }
  },
  { flush: 'sync' },
);
function close(): void {
  if (busy.value || unknown.value) return;
  emit('close');
}
async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const currentEpoch = epoch.value;
  const input = pending.value ?? {
    expectedVersion: props.item.version,
    idempotencyKey: globalThis.crypto.randomUUID(),
    archiveAt: archiveAt.value,
    reason: reason.value.trim(),
  };
  pending.value = input;
  busy.value = true;
  error.value = '';
  try {
    const result = await earlyArchiveCase(props.item.id, input);
    if (
      currentEpoch !== epoch.value ||
      result.id !== props.item.id ||
      result.fromStage !== props.item.stage ||
      result.version !== input.expectedVersion + 1
    )
      return;
    pending.value = null;
    unknown.value = false;
    emit('completed', result);
    emit('close');
  } catch (cause) {
    if (currentEpoch !== epoch.value) return;
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    ) {
      error.value = '当前账号已无权提前归档，请重新读取案件。';
      emit('access-lost');
    } else if (
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500
    ) {
      unknown.value = true;
      error.value =
        '提交结果暂时未知。原请求内容与请求键已保留，请显式核实原请求。';
    } else {
      pending.value = null;
      error.value = cause.message || '提前归档失败，请检查案件状态后重试。';
    }
  } finally {
    if (currentEpoch === epoch.value) busy.value = false;
  }
}
</script>

<template>
  <OperationDrawer
    :open="true"
    :title="`提前归档 ${item.businessNo}`"
    aria-label="提前归档案件"
    size="min(560px, 100vw)"
    :locked="busy || unknown"
    @close="close"
  >
    <section class="early-archive-panel">
      <p>
        案件当前阶段：{{
          stageNames[item.stage]
        }}。此操作会停止后续诉讼办理并归档，不会登记结案或款项。
      </p>
      <p v-if="unknown" role="status">{{ error }}</p>
      <template v-else>
        <label>
          归档日期
          <input
            v-model="archiveAt"
            type="date"
            :max="todayShanghai()"
            :disabled="pending !== null"
          />
        </label>
        <label>
          提前归档原因
          <textarea
            v-model="reason"
            rows="3"
            maxlength="2000"
            :disabled="pending !== null"
          />
        </label>
        <label class="early-archive-confirm">
          <input v-model="confirmed" type="checkbox" :disabled="busy" />
          我确认停止此案后续诉讼办理并归档。
        </label>
        <p v-if="error" role="alert">{{ error }}</p>
      </template>
    </section>
    <template #footer>
      <ElButton
        class="action-size--wide"
        type="danger"
        :disabled="!canSubmit"
        :loading="busy"
        data-test="submit-early-archive"
        @click="submit"
      >
        {{ unknown ? '核实原请求' : '确认提前归档' }}
      </ElButton>
      <ElButton
        class="action-size--standard"
        :disabled="busy || unknown"
        data-test="close-early-archive"
        @click="close"
        >{{ unknown ? '保留原请求' : '取消' }}</ElButton
      >
    </template>
  </OperationDrawer>
</template>

<style scoped>
.early-archive-panel {
  display: grid;
  gap: var(--s-4);
}
.early-archive-panel p {
  margin: 0;
}
.early-archive-panel label {
  display: grid;
  gap: var(--s-1);
}
.early-archive-panel :is(input[type='date'], textarea) {
  box-sizing: border-box;
  width: 100%;
}
.early-archive-confirm {
  display: flex !important;
  align-items: center;
}
.early-archive-panel textarea {
  resize: vertical;
}
</style>
