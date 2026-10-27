<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  isCaseHandlingGroupAttempt,
  type CaseHandlingGroupAttempt,
  type CaseHandlingGroupMember,
  type PrepareCaseHandlingGroupSelection,
  type SubmitCaseHandlingGroupAttempt,
  type CaseHandlingGroupCommandResult,
} from '../../api/case-handling-groups';

const props = defineProps<{
  candidates: CaseHandlingGroupMember[];
  actorKey: string;
  contextKey: string;
  pending?: Extract<CaseHandlingGroupAttempt, { kind: 'CREATE' }> | null;
  prepareSelection: PrepareCaseHandlingGroupSelection;
  submitAttempt: SubmitCaseHandlingGroupAttempt;
}>();
const emit = defineEmits<{
  close: [];
  confirmed: [CaseHandlingGroupCommandResult, CaseHandlingGroupAttempt];
}>();
const selected = ref<string[]>(
  props.pending ? [...props.pending.input.caseIds] : [],
);
const prepared = ref<CaseHandlingGroupMember[] | null>(null);
const frozen = ref<Extract<
  CaseHandlingGroupAttempt,
  { kind: 'CREATE' }
> | null>(props.pending ?? null);
const confirmed = ref(false);
const busy = ref(false);
const preparing = ref(false);
const invalidated = ref(false);
const error = ref('');
let epoch = 0;
let mounted = true;
let controller: AbortController | undefined;
const readableMembers = computed(() =>
  invalidated.value
    ? []
    : (prepared.value ??
      props.candidates.filter((member) =>
        selected.value.includes(member.caseId),
      )),
);
const canPrepare = computed(
  () =>
    !invalidated.value &&
    !frozen.value &&
    selected.value.length >= 2 &&
    selected.value.length <= 20 &&
    !busy.value &&
    !preparing.value,
);
const canSubmit = computed(
  () =>
    !invalidated.value &&
    !busy.value &&
    !preparing.value &&
    confirmed.value &&
    (frozen.value !== null || prepared.value !== null),
);
function current(generation: number, actor: string, context: string): boolean {
  return (
    mounted &&
    !invalidated.value &&
    epoch === generation &&
    props.actorKey === actor &&
    props.contextKey === context
  );
}
function toggle(caseId: string, checked: boolean): void {
  if (frozen.value || busy.value || invalidated.value) return;
  controller?.abort();
  epoch += 1;
  preparing.value = false;
  prepared.value = null;
  confirmed.value = false;
  error.value = '';
  selected.value = checked
    ? [...new Set([...selected.value, caseId])]
    : selected.value.filter((id) => id !== caseId);
}
async function prepare(): Promise<void> {
  if (!canPrepare.value) return;
  const ids = [...selected.value];
  if (
    ids.some(
      (id) => !props.candidates.some((candidate) => candidate.caseId === id),
    )
  )
    return;
  const generation = ++epoch;
  const actor = props.actorKey;
  const context = props.contextKey;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  preparing.value = true;
  error.value = '';
  try {
    const result = await props.prepareSelection(ids, { signal });
    if (signal.aborted || !current(generation, actor, context)) return;
    if (
      !result.allowed ||
      result.members.length !== ids.length ||
      new Set(result.members.map((member) => member.caseId.toLowerCase()))
        .size !== ids.length ||
      ids.some(
        (id) =>
          !result.members.some(
            (member) => member.caseId.toLowerCase() === id.toLowerCase(),
          ),
      )
    ) {
      error.value = '当前选案范围或建立组权限不满足要求，整组未提交。';
      return;
    }
    if (new Set(result.members.map((member) => member.customerId)).size !== 1) {
      error.value = '只能将同一客户的案件建立案件系列，整组未提交。';
      return;
    }
    prepared.value = ids.map((id) => ({
      ...result.members.find(
        (member) => member.caseId.toLowerCase() === id.toLowerCase(),
      )!,
    }));
  } catch {
    if (!signal.aborted && current(generation, actor, context))
      error.value = '无法核对当前源案与建立组权限，请重新核对。';
  } finally {
    if (current(generation, actor, context)) preparing.value = false;
  }
}
async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const actor = props.actorKey;
  const context = props.contextKey;
  const generation = ++epoch;
  const attempt = frozen.value ?? {
    kind: 'CREATE' as const,
    actorKey: actor,
    input: {
      groupId: globalThis.crypto.randomUUID(),
      caseIds: [...selected.value],
      idempotencyKey: globalThis.crypto.randomUUID(),
    },
  };
  if (attempt.actorKey !== actor || !isCaseHandlingGroupAttempt(attempt)) {
    error.value = '原请求与当前身份不匹配，未提交。';
    return;
  }
  frozen.value = attempt;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  busy.value = true;
  error.value = '';
  try {
    const outcome = await props.submitAttempt(
      {
        ...attempt,
        input: { ...attempt.input, caseIds: [...attempt.input.caseIds] },
      },
      { actorKey: actor, contextKey: context, signal },
    );
    if (signal.aborted || !current(generation, actor, context)) return;
    if (outcome.kind === 'confirmed')
      emit('confirmed', outcome.result, attempt);
    else error.value = outcome.message;
  } catch {
    if (!signal.aborted && current(generation, actor, context))
      error.value = '建立结果待核对。请保留原请求，只能原样重试。';
  } finally {
    if (current(generation, actor, context)) busy.value = false;
  }
}
watch(
  () => [props.actorKey, props.contextKey],
  () => {
    invalidated.value = true;
    epoch += 1;
    controller?.abort();
    busy.value = false;
    preparing.value = false;
    prepared.value = null;
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
    aria-label="建立案件系列"
  >
    <h2>建立案件系列</h2>
    <p>
      明确选择同一客户2～20件案件。不同阶段的案件也可建立组；原案件的编号、阶段、材料及费用归属均保留。
    </p>
    <p v-if="selected.length > 20 && !invalidated" role="alert">
      每组最多选择20件案件，请调整后重新核对。
    </p>
    <p v-if="invalidated" role="alert">
      当前身份或页面已变化，请关闭后重新读取。
    </p>
    <p v-if="frozen" role="status">
      有一项建立组请求待核对，原选案、组标识和请求键保持不变。核对不会另建请求。
    </p>
    <slot v-if="!invalidated && !frozen" name="candidate-controls" />
    <ul v-if="!invalidated && !frozen" aria-label="明确选择源案">
      <li v-for="member in candidates" :key="member.caseId">
        <label
          ><input
            type="checkbox"
            :checked="selected.includes(member.caseId)"
            :disabled="busy || preparing"
            :data-test="`select-group-case-${member.caseId}`"
            @change="
              toggle(
                member.caseId,
                ($event.target as globalThis.HTMLInputElement).checked,
              )
            "
          />{{ member.businessNo }} · {{ member.customerName }}</label
        >
      </li>
    </ul>
    <ElButton
      v-if="!frozen"
      data-test="prepare-group"
      :disabled="!canPrepare"
      :loading="preparing"
      @click="prepare"
      >核对所选源案与权限</ElButton
    >
    <ul v-if="prepared || frozen" aria-label="当前可读源案">
      <li v-for="member in readableMembers" :key="member.caseId">
        {{ member.businessNo }} · {{ member.customerName }}
      </li>
    </ul>
    <label v-if="(prepared || frozen) && !invalidated"
      ><input
        v-model="confirmed"
        type="checkbox"
        data-test="confirm-create-group"
        :disabled="busy"
      />已核对原源案归属保留，确认{{
        frozen ? '核对原请求' : '建立案件系列'
      }}。</label
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton
      data-test="submit-create-group"
      type="primary"
      :disabled="!canSubmit"
      :loading="busy"
      @click="submit"
      >{{ frozen ? '核对原建立请求' : '建立案件系列' }}</ElButton
    >
    <ElButton
      data-test="close-create-group"
      :disabled="busy"
      @click="emit('close')"
      >{{ frozen ? '保留原请求并关闭' : '取消' }}</ElButton
    >
  </section>
</template>

<style scoped>
.handling-group-panel {
  padding: var(--s-6);
}
.handling-group-panel li {
  margin-block: var(--s-2);
}
.handling-group-panel label {
  line-height: 1.7;
}
.handling-group-panel input[type='checkbox'] {
  margin-inline-end: var(--s-2);
}
</style>
