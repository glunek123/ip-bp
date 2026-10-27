<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import OperationDrawer from '../../app/OperationDrawer.vue';
import { ApiError } from '../../api/http';
import {
  todayShanghai,
  type CaseStage,
  type CaseSummary,
} from '../../api/cases';
import {
  archiveCaseBatch,
  type CaseBatchArchiveInput,
  type CaseBatchArchiveResult,
} from '../../api/case-batches';

type BatchCase = Pick<
  CaseSummary,
  'id' | 'businessNo' | 'stage' | 'version' | 'canEarlyArchive'
>;
const props = defineProps<{
  open: boolean;
  items: BatchCase[];
  contextKey: string;
  identityKey: string;
}>();
const emit = defineEmits<{
  close: [];
  completed: [result: CaseBatchArchiveResult];
  'access-lost': [];
  'pending-state': [pending: boolean];
}>();
const selectedIds = ref<string[]>([]);
const archiveAt = ref(todayShanghai());
const reason = ref('');
const confirmed = ref(false);
const busy = ref(false);
const error = ref('');
const result = ref<CaseBatchArchiveResult | null>(null);
const pending = ref<CaseBatchArchiveInput | null>(null);
const pendingCases = ref<BatchCase[]>([]);
const uncertain = ref(false);
const pendingIdentityKey = ref<string | null>(null);
const pendingBelongsToContext = computed(
  () =>
    pending.value === null || pendingIdentityKey.value === props.identityKey,
);
const epoch = ref(0);
const activeItems = computed(() =>
  pendingCases.value.length ? pendingCases.value : props.items,
);
const eligibleItems = computed(() =>
  activeItems.value.filter(
    (item) => item.canEarlyArchive === true && item.stage !== 'ARCHIVED',
  ),
);
const chosenItems = computed(() =>
  eligibleItems.value.filter((item) => selectedIds.value.includes(item.id)),
);
const canSubmit = computed(
  () =>
    !busy.value &&
    pendingBelongsToContext.value &&
    (result.value === null || uncertain.value) &&
    confirmed.value &&
    (pending.value !== null ||
      (chosenItems.value.length > 0 &&
        chosenItems.value.length <= 20 &&
        archiveAt.value.length === 10 &&
        reason.value.trim().length > 0)),
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
  () => [props.contextKey, props.identityKey],
  () => {
    epoch.value += 1;
    busy.value = false;
    if (!props.identityKey) {
      pending.value = null;
      pendingIdentityKey.value = null;
      pendingCases.value = [];
      uncertain.value = false;
      result.value = null;
      emit('pending-state', false);
    } else if (pending.value) {
      uncertain.value = true;
      error.value =
        '批量提交结果暂时未知。原请求内容与请求键已保留，请显式核实原请求。';
    }
  },
  { flush: 'sync' },
);
watch(
  () =>
    props.items
      .map((item) => `${item.id}:${item.stage}:${item.version}`)
      .join(','),
  () => {
    if (pending.value) return;
    selectedIds.value = props.items
      .filter(
        (item) => item.canEarlyArchive === true && item.stage !== 'ARCHIVED',
      )
      .slice(0, 20)
      .map((item) => item.id);
    error.value = '';
  },
  { immediate: true, flush: 'sync' },
);
function toggle(id: string, checked: boolean): void {
  if (pending.value || busy.value) return;
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter((value) => value !== id);
}
function close(): void {
  if (busy.value || uncertain.value) return;
  emit('close');
}
watch(
  () => props.open,
  (open) => {
    if (!open && !pending.value) {
      selectedIds.value = [];
      result.value = null;
      error.value = '';
      confirmed.value = false;
      reason.value = '';
      archiveAt.value = todayShanghai();
    }
  },
);
async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const generation = epoch.value;
  const input = pending.value ?? {
    idempotencyKey: globalThis.crypto.randomUUID(),
    archiveAt: archiveAt.value,
    reason: reason.value.trim(),
    items: chosenItems.value.map((item) => ({
      id: item.id,
      expectedVersion: item.version,
    })),
  };
  if (!pending.value) pendingCases.value = [...chosenItems.value];
  pending.value = input;
  pendingIdentityKey.value = props.identityKey;
  emit('pending-state', true);
  busy.value = true;
  error.value = '';
  try {
    const response = await archiveCaseBatch(input);
    if (generation !== epoch.value) return;
    if (response.items.some((item) => item.status === 'UNKNOWN')) {
      uncertain.value = true;
      result.value = response;
      error.value = '部分案件结果待核实。原批次内容与请求键已保留。';
    } else {
      uncertain.value = false;
      pending.value = null;
      emit('pending-state', false);
      result.value = response;
      emit('completed', response);
    }
  } catch (cause) {
    if (generation !== epoch.value) return;
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    ) {
      error.value = '当前账号已无权提前归档，请重新读取案件。';
      emit('access-lost');
      pending.value = null;
      emit('pending-state', false);
    } else if (
      cause instanceof ApiError &&
      cause.status >= 400 &&
      cause.status < 500
    ) {
      pending.value = null;
      emit('pending-state', false);
      error.value = cause.message || '批量归档请求未被接受，请检查输入后重试。';
    } else {
      uncertain.value = true;
      error.value =
        '批量提交结果暂时未知。原请求内容与请求键已保留，请显式核实原请求。';
    }
  } finally {
    if (generation === epoch.value) busy.value = false;
  }
}
function statusLabel(status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'): string {
  return status === 'SUCCEEDED'
    ? '已归档'
    : status === 'FAILED'
      ? '失败'
      : '待核实';
}
</script>

<template>
  <OperationDrawer
    :open="open"
    title="批量提前归档"
    size="min(680px, 100vw)"
    :locked="pendingBelongsToContext && (busy || uncertain)"
    @close="pendingBelongsToContext ? close() : emit('close')"
  >
    <div v-if="pendingBelongsToContext" class="batch-archive-panel">
      <p class="batch-archive-intro">
        提前归档会停止后续诉讼办理，不登记结案或款项。最多选择20件案件。
      </p>
      <section v-if="!pending && !result" class="batch-archive-section">
        <h3>选择案件</h3>
        <div class="batch-archive-cases">
          <label
            v-for="item in props.items"
            :key="item.id"
            class="batch-archive-case"
          >
            <input
              type="checkbox"
              :checked="selectedIds.includes(item.id)"
              :disabled="
                item.canEarlyArchive !== true ||
                item.stage === 'ARCHIVED' ||
                busy ||
                (!selectedIds.includes(item.id) && selectedIds.length >= 20)
              "
              @change="
                toggle(item.id, ($event.target as HTMLInputElement).checked)
              "
            />
            <span>{{ item.businessNo }} · {{ stageNames[item.stage] }}</span>
            <span
              v-if="item.canEarlyArchive !== true || item.stage === 'ARCHIVED'"
              class="field-help"
              >当前无提前归档权限</span
            >
          </label>
          <p v-if="props.items.length === 0" class="field-help">
            请先在案件列表中选择案件。
          </p>
        </div>
        <p>本次将处理 {{ chosenItems.length }} 件：</p>
        <ul data-test="batch-archive-review" class="batch-archive-review">
          <li v-for="item in chosenItems" :key="item.id">
            {{ item.businessNo }} · {{ stageNames[item.stage] }}
          </li>
        </ul>
      </section>
      <section v-else-if="pending" class="batch-archive-section">
        <h3>待核实批次 · {{ pendingCases.length }} 件</h3>
        <ul class="batch-archive-review">
          <li v-for="item in pendingCases" :key="item.id">
            {{ item.businessNo }} · {{ stageNames[item.stage] }}
          </li>
        </ul>
      </section>
      <section
        v-if="!pending && !result"
        class="batch-archive-section batch-archive-form"
      >
        <h3>归档信息</h3>
        <label
          >归档日期<input
            v-model="archiveAt"
            type="date"
            :max="todayShanghai()"
            :disabled="busy"
        /></label>
        <label
          >提前归档原因<textarea
            v-model="reason"
            rows="3"
            maxlength="2000"
            :disabled="busy"
          />
        </label>
        <label class="batch-archive-confirm"
          ><input
            v-model="confirmed"
            type="checkbox"
            :disabled="busy"
          />我确认停止所选案件后续诉讼办理并归档。</label
        >
      </section>
      <p v-if="error" :role="uncertain ? 'status' : 'alert'">{{ error }}</p>
      <section v-if="result" class="batch-archive-section">
        <h3>逐案归档结果</h3>
        <ul class="batch-archive-results" aria-label="逐案归档结果">
          <li v-for="item in result.items" :key="item.id">
            {{
              pendingCases.find((candidate) => candidate.id === item.id)
                ?.businessNo ?? item.id
            }}：{{ statusLabel(item.status)
            }}<span v-if="item.code">（{{ item.code }}）</span>
          </li>
        </ul>
      </section>
    </div>
    <p v-else class="pending-owner-notice">
      其他账号有待核实请求，请返回原账号核实。
    </p>
    <template #footer>
      <ElButton
        v-if="pendingBelongsToContext"
        class="action-size--wide"
        type="danger"
        :disabled="!canSubmit"
        :loading="busy"
        data-test="submit-batch-early-archive"
        @click="submit"
        >{{ uncertain ? '核实原批次' : '确认批量归档' }}</ElButton
      >
      <ElButton
        class="action-size--standard"
        :disabled="pendingBelongsToContext && (busy || uncertain)"
        data-test="close-batch-early-archive"
        @click="pendingBelongsToContext ? close() : emit('close')"
        >{{
          pendingBelongsToContext && uncertain ? '保留原请求' : '关闭'
        }}</ElButton
      >
    </template>
  </OperationDrawer>
</template>

<style scoped>
.batch-archive-panel {
  display: grid;
  gap: var(--s-4);
  min-width: 0;
}
.batch-archive-panel :where(h3, p, ul) {
  margin: 0;
}
.batch-archive-intro {
  color: var(--color-ink-muted);
}
.batch-archive-section {
  display: grid;
  gap: var(--s-3);
  min-width: 0;
  padding-bottom: var(--s-4);
  border-bottom: 1px solid var(--color-hairline);
}
.batch-archive-section h3 {
  font-size: 14px;
  font-weight: 600;
}
.batch-archive-cases {
  display: grid;
  gap: var(--s-2);
  max-height: 240px;
  overflow: auto;
}
.batch-archive-panel label {
  display: grid;
  gap: var(--s-1);
}
.batch-archive-panel .batch-archive-case {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-height: 36px;
  padding: var(--s-2);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  background: var(--color-surface-1);
}
.batch-archive-case span:nth-child(2) {
  flex: 1 1 auto;
  overflow-wrap: anywhere;
}
.batch-archive-review,
.batch-archive-results {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  padding: 0;
  list-style: none;
}
.batch-archive-review li,
.batch-archive-results li {
  padding: var(--s-1) var(--s-2);
  border-radius: 6px;
  background: var(--color-surface-2);
  overflow-wrap: anywhere;
}
.batch-archive-panel .batch-archive-confirm {
  display: flex;
  align-items: center;
}
.batch-archive-form :is(input[type='date'], textarea) {
  width: 100%;
  box-sizing: border-box;
}
.batch-archive-panel textarea {
  resize: vertical;
}
</style>
