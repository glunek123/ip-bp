<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  isCaseHandlingGroupAttempt,
  type CaseHandlingGroupAttempt,
  type CaseHandlingGroupDetail,
  type CaseHandlingGroupCommandResult,
  type SubmitCaseHandlingGroupAttempt,
} from '../../api/case-handling-groups';
const props = defineProps<{
  detail: CaseHandlingGroupDetail;
  actorKey: string;
  contextKey: string;
  pending?: Extract<CaseHandlingGroupAttempt, { kind: 'DISSOLVE' }> | null;
  submitAttempt: SubmitCaseHandlingGroupAttempt;
}>();
const emit = defineEmits<{
  close: [];
  confirmed: [CaseHandlingGroupCommandResult, CaseHandlingGroupAttempt];
}>();
const frozen = ref<Extract<
  CaseHandlingGroupAttempt,
  { kind: 'DISSOLVE' }
> | null>(props.pending ?? null);
const confirmed = ref(false);
const busy = ref(false);
const error = ref('');
const invalidated = ref(false);
let epoch = 0;
let mounted = true;
let controller: AbortController | undefined;
const canRequest = computed(
  () =>
    !invalidated.value &&
    (frozen.value !== null ||
      (props.detail.status === 'ACTIVE' && props.detail.canDissolve)),
);
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
function current(generation: number, actor: string, context: string): boolean {
  return (
    mounted &&
    !invalidated.value &&
    epoch === generation &&
    props.actorKey === actor &&
    props.contextKey === context
  );
}
async function dissolve(): Promise<void> {
  if (!canRequest.value || !confirmed.value || busy.value) return;
  const actor = props.actorKey;
  const context = props.contextKey;
  const generation = ++epoch;
  const attempt = frozen.value ?? {
    kind: 'DISSOLVE' as const,
    actorKey: actor,
    groupId: props.detail.id,
    input: {
      expectedRevision: props.detail.revision,
      idempotencyKey: globalThis.crypto.randomUUID(),
    },
  };
  if (
    attempt.actorKey !== actor ||
    attempt.groupId !== props.detail.id ||
    !isCaseHandlingGroupAttempt(attempt)
  ) {
    error.value = '原解除请求与当前组或身份不匹配，未提交。';
    return;
  }
  frozen.value = attempt;
  busy.value = true;
  error.value = '';
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  try {
    const outcome = await props.submitAttempt(
      { ...attempt, input: { ...attempt.input } },
      { actorKey: actor, contextKey: context, signal },
    );
    if (signal.aborted || !current(generation, actor, context)) return;
    if (outcome.kind === 'confirmed')
      emit('confirmed', outcome.result, attempt);
    else error.value = outcome.message;
  } catch {
    if (!signal.aborted && current(generation, actor, context))
      error.value = '解除结果待核对。请保留原请求，只能原样重试。';
  } finally {
    if (current(generation, actor, context)) busy.value = false;
  }
}
watch(
  [() => props.actorKey, () => props.contextKey, () => props.detail.id],
  () => {
    invalidated.value = true;
    epoch += 1;
    controller?.abort();
    busy.value = false;
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  mounted = false;
  epoch += 1;
  controller?.abort();
});
</script>

<template>
  <section
    class="demo-card handling-group-panel"
    role="dialog"
    aria-modal="true"
    aria-label="案件系列详情"
  >
    <h2>案件系列</h2>
    <p v-if="invalidated" role="alert">
      当前身份、组或页面已变化，请重新读取。
    </p>
    <template v-else>
      <p>
        {{ detail.status === 'ACTIVE' ? '办理中' : '已解除' }} · 建立于
        {{ formatTime(detail.createdAt) }}
      </p>
      <p>
        成员各自保留原案编号、阶段、材料和费用归属。请从原案入口查看已获准的资料与历史。
      </p>
      <ul aria-label="当前可读源案">
        <li v-for="member in detail.members" :key="member.caseId">
          <RouterLink :to="`/cases/${encodeURIComponent(member.caseId)}`">{{
            member.businessNo
          }}</RouterLink>
          · {{ member.customerName }}
          <RouterLink
            :to="{
              path: `/cases/${encodeURIComponent(member.caseId)}`,
              query: { tab: 'files' },
            }"
            >原案材料</RouterLink
          >
          <RouterLink
            :to="{
              path: `/cases/${encodeURIComponent(member.caseId)}`,
              query: { tab: 'fees' },
            }"
            >原案费用</RouterLink
          >
        </li>
      </ul>
      <p v-if="!detail.members.length">
        当前没有可显示的源案。本组不会额外授予源案读取权限。
      </p>
      <p v-if="frozen" role="status">
        有一项解除请求待核对，原组、版本和请求键保持不变。
      </p>
      <label v-if="canRequest"
        ><input
          v-model="confirmed"
          type="checkbox"
          :disabled="busy"
          data-test="confirm-dissolve-group"
        />已核对解除后各原案及其历史仍完整保留，确认{{
          frozen ? '核对原解除请求' : '解除案件系列'
        }}。</label
      >
      <p v-if="error" role="alert">{{ error }}</p>
      <ElButton
        v-if="canRequest"
        type="primary"
        data-test="dissolve-group"
        :disabled="!confirmed || busy"
        :loading="busy"
        @click="dissolve"
        >{{ frozen ? '核对原解除请求' : '解除案件系列' }}</ElButton
      >
    </template>
    <ElButton
      data-test="close-group-detail"
      :disabled="busy"
      @click="emit('close')"
      >{{ frozen ? '保留原请求并关闭' : '关闭' }}</ElButton
    >
  </section>
</template>

<style scoped>
.handling-group-panel {
  padding: var(--s-6);
}
.handling-group-panel li {
  margin-block: var(--s-3);
}
.handling-group-panel a + a {
  margin-inline-start: var(--s-3);
}
.handling-group-panel input {
  margin-inline-end: var(--s-2);
}
</style>
