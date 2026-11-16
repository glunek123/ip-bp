<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  changeCaseResponsibleUser,
  listResponsibleCandidates,
  type CaseDetail,
  type ResponsibleUserCandidate,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{ item: CaseDetail; contextKey: string }>();
const emit = defineEmits<{ changed: [] }>();

const candidates = ref<ResponsibleUserCandidate[]>([]);
const targetId = ref('');
const reason = ref('');
const submitting = ref(false);
const error = ref('');
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    candidates.value = await listResponsibleCandidates(props.item.id);
  } catch {
    error.value = '候选运营暂不可读取，请稍后重试。';
  } finally {
    loading.value = false;
  }
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (!targetId.value) {
    error.value = '请选择新的负责人';
    return;
  }
  const target = candidates.value.find((entry) => entry.id === targetId.value);
  if (
    !globalThis.confirm(
      `确认将案件移交给「${target?.displayName ?? '所选运营'}」？移交后你将失去该案件的办理权限，只有新负责人能把案件再移交回来。`,
    )
  )
    return;
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) {
    error.value = '当前浏览器不能生成安全请求键，尚未发送请求。';
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    await changeCaseResponsibleUser(props.item.id, {
      userId: targetId.value,
      reason: reason.value.trim() || null,
      idempotencyKey: key,
    });
    notifyWorkflowChanged();
    emit('changed');
  } catch (failure) {
    error.value =
      failure instanceof ApiError && failure.status === 409
        ? '案件已变化，请刷新后重试。'
        : '移交未完成，请核对所选运营。';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <details class="case-inline-subblock" data-test="responsible-transfer">
    <summary>移交负责人（当前：{{ item.owner.displayName }}）</summary>
    <p v-if="loading" class="field-help">正在读取候选运营…</p>
    <template v-else>
      <label class="form-field">
        新负责人
        <select
          v-model="targetId"
          class="text-input"
          data-test="responsible-target"
        >
          <option value="">请选择</option>
          <option
            v-for="candidate in candidates"
            :key="candidate.id"
            :value="candidate.id"
            :disabled="candidate.id === item.owner.id"
          >
            {{ candidate.displayName }}
          </option>
        </select>
      </label>
      <label class="form-field">
        移交原因（选填）
        <input
          v-model="reason"
          class="text-input"
          data-test="responsible-reason"
        />
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button
          type="button"
          data-test="responsible-submit"
          :disabled="submitting"
          @click="submit"
        >
          确认移交
        </button>
      </div>
    </template>
  </details>
</template>
