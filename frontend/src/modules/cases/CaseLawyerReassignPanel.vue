<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  assignCaseLawyer,
  type AssignCaseLawyerResult,
} from '../../api/case-lawyer-assignment';
import {
  listLawyerMatchCandidates,
  type LawyerMatchCandidate,
} from '../../api/cases';
import { ApiError } from '../../api/http';

/**
 * 变更承办律师：只做「选人 + 重新指派」，不推进案件阶段。
 * 幂等键与所选律师绑定：同一个人重试沿用原键，换人则换键。
 */
const props = defineProps<{
  caseId: string;
  caseVersion: number;
  currentLawyerNames: string[];
}>();
const emit = defineEmits<{
  close: [];
  completed: [result: AssignCaseLawyerResult];
}>();

const query = ref('');
const candidates = shallowRef<LawyerMatchCandidate[]>([]);
const selected = ref('');
const error = ref('');
const busy = ref(false);
const loading = ref(false);
const retryable = ref(false);

const pendingKey = ref<string | null>(null);
const pendingFor = ref<string | null>(null);

const currentNames = computed(
  () => props.currentLawyerNames.join('、') || '未指派',
);
const visibleCandidates = computed(() => candidates.value);

async function load(): Promise<void> {
  loading.value = true;
  try {
    candidates.value = await listLawyerMatchCandidates(
      props.caseId,
      query.value,
    );
    error.value = '';
  } catch (reason) {
    candidates.value = [];
    error.value =
      reason instanceof ApiError
        ? reason.message
        : '律师候选暂时无法读取，请重试。';
  } finally {
    loading.value = false;
  }
}

function isUnknownResult(reason: unknown): boolean {
  return (
    !(reason instanceof ApiError) ||
    reason.status === 0 ||
    reason.status >= 500 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(
      reason.code,
    )
  );
}

async function submit(): Promise<void> {
  if (!selected.value || busy.value) return;
  const lawyerAccountId = selected.value;
  if (pendingFor.value !== lawyerAccountId) {
    pendingKey.value = globalThis.crypto.randomUUID();
    pendingFor.value = lawyerAccountId;
  }
  const idempotencyKey = pendingKey.value;
  if (!idempotencyKey) return;
  busy.value = true;
  error.value = '';
  retryable.value = false;
  try {
    const result = await assignCaseLawyer(props.caseId, {
      expectedVersion: props.caseVersion,
      idempotencyKey,
      lawyerAccountId,
    });
    pendingKey.value = null;
    pendingFor.value = null;
    emit('completed', result);
  } catch (reason) {
    // 未知结果保留原请求键：重试是幂等的，不会重复指派。
    retryable.value = isUnknownResult(reason);
    error.value = retryable.value
      ? '提交结果暂时未知，原请求键已保留；请再次点击确认，会用同一个请求键重试。'
      : reason instanceof ApiError
        ? reason.message
        : '变更失败，请重试。';
    if (!retryable.value) {
      pendingKey.value = null;
      pendingFor.value = null;
    }
  } finally {
    busy.value = false;
  }
}

watch(selected, () => {
  if (!busy.value) {
    error.value = '';
    retryable.value = false;
  }
});
watch(query, () => void load());
onMounted(() => void load());
</script>

<template>
  <section class="reassign-panel" data-test="case-reassign-panel">
    <h3>变更承办律师</h3>
    <p class="field-help">当前承办：{{ currentNames }}。仅替换承办人。</p>
    <label class="field-label">
      输入姓名搜索承办律师
      <input
        v-model="query"
        class="text-input"
        data-test="reassign-lawyer-query"
        placeholder="输入姓名搜索承办律师"
      />
    </label>
    <p v-if="loading" role="status">正在读取律师…</p>
    <fieldset
      v-else
      class="reassign-panel__list"
      data-test="reassign-candidates"
    >
      <legend class="sr-only">可选律师</legend>
      <label
        v-for="candidate in visibleCandidates"
        :key="candidate.lawyerAccountId"
        class="reassign-panel__option"
      >
        <input
          v-model="selected"
          type="radio"
          :value="candidate.lawyerAccountId"
          :data-test="`reassign-lawyer-${candidate.lawyerAccountId}`"
        />
        {{ candidate.displayName }}
        <span v-if="candidate.lawFirm" class="field-help">
          · {{ candidate.lawFirm }}
        </span>
      </label>
      <p v-if="!visibleCandidates.length">没有匹配的律师。</p>
    </fieldset>
    <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
    <div class="reassign-panel__actions">
      <ElButton :disabled="busy" @click="emit('close')">取消</ElButton>
      <ElButton
        type="primary"
        data-test="reassign-submit"
        :loading="busy"
        :disabled="busy || !selected"
        @click="submit"
      >
        {{ retryable ? '用相同请求键重试' : '确认变更' }}
      </ElButton>
    </div>
  </section>
</template>

<style scoped>
.reassign-panel {
  display: grid;
  gap: 10px;
}
.reassign-panel__list {
  display: grid;
  gap: 6px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
}
.reassign-panel__option {
  display: flex;
  align-items: center;
  gap: 6px;
}
.reassign-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
