<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  defaultCaseListPreference,
  getCaseListPreference,
  saveCaseListPreference,
  type CaseListColumn,
  type CaseListOptionalColumn,
  type CaseListPreference,
  type CaseListPreferenceBucket,
} from '../../api/case-list-preference';

const columnLabels: Record<CaseListColumn, string> = {
  businessNo: '操作／案件编号',
  stage: '案件进展',
  customerName: '客户',
  rightsHolderName: '权利主体',
  platform: '平台',
  shopName: '店铺',
  shopExternalId: '店铺ID',
  defendants: '被告',
  lawyers: '律师',
  court: '法院',
  courtCaseNo: '案号',
  claimAmount: '标的额',
  judgmentAmount: '判决额',
  closureAmount: '结案额',
};

const props = defineProps<{
  bucket: CaseListPreferenceBucket;
  requestGeneration: string | number;
}>();
const emit = defineEmits<{
  change: [
    bucket: CaseListPreferenceBucket,
    preference: CaseListPreference,
    requestGeneration: string | number,
  ];
}>();

const isOpen = ref(false);
const loading = ref(false);
const saving = ref(false);
const status = ref('正在读取列设置');
const saved = ref<CaseListPreference>({
  order: [...defaultCaseListPreference.order],
  hidden: [],
});
const draft = ref<CaseListPreference>({
  order: [...defaultCaseListPreference.order],
  hidden: [],
});
const requestKey = computed(() => `${props.requestGeneration}:${props.bucket}`);
let generation = 0;
let request: AbortController | undefined;

function copy(value: CaseListPreference): CaseListPreference {
  return { order: [...value.order], hidden: [...value.hidden] };
}

function isCurrent(token: number, key: string) {
  return token === generation && key === requestKey.value;
}

async function fetchPreference() {
  request?.abort();
  saving.value = false;
  isOpen.value = false;
  const controller = new AbortController();
  request = controller;
  const token = ++generation;
  const key = requestKey.value;
  loading.value = true;
  status.value = '正在读取列设置';
  saved.value = copy(defaultCaseListPreference);
  draft.value = copy(defaultCaseListPreference);
  try {
    const result = await getCaseListPreference(props.bucket, {
      signal: controller.signal,
    });
    if (controller.signal.aborted || !isCurrent(token, key)) return;
    saved.value = copy(result);
    draft.value = copy(result);
    emit('change', props.bucket, copy(result), props.requestGeneration);
    status.value = '已读取服务器设置';
  } catch {
    if (controller.signal.aborted || !isCurrent(token, key)) return;
    saved.value = copy(defaultCaseListPreference);
    draft.value = copy(defaultCaseListPreference);
    status.value = '列设置未确认，当前显示默认列';
  } finally {
    if (isCurrent(token, key)) loading.value = false;
  }
}

watch(requestKey, () => void fetchPreference(), { immediate: true });

function open() {
  isOpen.value = true;
  draft.value = copy(saved.value);
}

function cancel() {
  draft.value = copy(saved.value);
  isOpen.value = false;
}

function resetDraft() {
  draft.value = copy(defaultCaseListPreference);
}

function toggleColumn(column: CaseListOptionalColumn) {
  draft.value.hidden = draft.value.hidden.includes(column)
    ? draft.value.hidden.filter((entry) => entry !== column)
    : [...draft.value.hidden, column];
}

function move(column: CaseListOptionalColumn, offset: -1 | 1) {
  const index = draft.value.order.indexOf(column);
  const nextIndex = index + offset;
  if (index < 2 || nextIndex < 2 || nextIndex >= draft.value.order.length)
    return;
  const order = [...draft.value.order];
  [order[index], order[nextIndex]] = [order[nextIndex]!, order[index]!];
  draft.value.order = order;
}

async function saveDraft() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const token = ++generation;
  const key = requestKey.value;
  const bucket = props.bucket;
  const snapshot = copy(draft.value);
  saving.value = true;
  status.value = '保存结果未确认';
  try {
    const result = await saveCaseListPreference(bucket, snapshot, {
      signal: controller.signal,
    });
    if (controller.signal.aborted || !isCurrent(token, key)) return;
    saved.value = copy(result);
    draft.value = copy(result);
    emit('change', bucket, copy(result), props.requestGeneration);
    status.value = '已保存';
    isOpen.value = false;
  } catch {
    if (!controller.signal.aborted && isCurrent(token, key))
      status.value = '未确认保存，请重新读取后核对';
  } finally {
    if (isCurrent(token, key)) saving.value = false;
  }
}

onBeforeUnmount(() => {
  generation += 1;
  request?.abort();
});
</script>

<template>
  <section class="case-list-preferences" aria-label="案件列设置">
    <div class="case-list-preferences__summary">
      <ElButton text data-test="open-column-settings" @click="open">
        列设置
      </ElButton>
      <span role="status" aria-live="polite">{{ status }}</span>
    </div>
    <div
      v-if="isOpen"
      class="case-list-preferences__dialog"
      role="dialog"
      aria-modal="true"
      aria-label="案件列设置"
    >
      <h2>案件列设置</h2>
      <p class="field-help">
        当前流程：{{ bucket }}。前两列固定显示；其他列可隐藏或调整顺序。
      </p>
      <ol>
        <li v-for="column in draft.order" :key="column">
          <span>{{ columnLabels[column] }}</span>
          <template v-if="column === 'businessNo' || column === 'stage'">
            <span class="field-help">固定</span>
          </template>
          <template v-else>
            <label>
              <input
                type="checkbox"
                :checked="!draft.hidden.includes(column)"
                @change="toggleColumn(column)"
              />
              显示
            </label>
            <ElButton
              text
              :disabled="draft.order.indexOf(column) === 2"
              :aria-label="`${columnLabels[column]}上移`"
              @click="move(column, -1)"
              >上移</ElButton
            >
            <ElButton
              text
              :disabled="draft.order.indexOf(column) === draft.order.length - 1"
              :aria-label="`${columnLabels[column]}下移`"
              @click="move(column, 1)"
              >下移</ElButton
            >
          </template>
        </li>
      </ol>
      <div class="case-list-preferences__actions">
        <ElButton text @click="resetDraft">恢复默认</ElButton>
        <ElButton text @click="cancel">取消</ElButton>
        <ElButton
          type="primary"
          :loading="saving"
          :disabled="loading || saving"
          @click="saveDraft"
          >保存</ElButton
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.case-list-preferences__summary,
.case-list-preferences__actions,
.case-list-preferences li {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.case-list-preferences__summary span {
  color: var(--color-ink-muted);
  font-size: 12px;
}
.case-list-preferences__dialog {
  position: fixed;
  z-index: var(--z-modal);
  inset: 50% auto auto 50%;
  width: min(620px, calc(100vw - 32px));
  max-height: min(80vh, 720px);
  overflow: auto;
  padding: var(--s-5);
  transform: translate(-50%, -50%);
  background: var(--color-surface-1);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
}
.case-list-preferences__dialog h2 {
  margin: 0 0 var(--s-2);
  font-size: 16px;
}
.case-list-preferences ol {
  display: grid;
  gap: var(--s-2);
  padding: 0;
  list-style: none;
}
.case-list-preferences li {
  min-height: 36px;
  padding-bottom: var(--s-1);
  border-bottom: 1px solid var(--color-hairline);
}
.case-list-preferences li > span:first-child {
  flex: 1;
}
.case-list-preferences__actions {
  justify-content: flex-end;
  margin-top: var(--s-4);
}
</style>
