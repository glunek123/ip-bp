<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { getLead, type Lead, type LeadDetail } from '../../api/leads';
import {
  decideLeadNoEvidenceBatch,
  isLeadNoEvidenceBatchInput,
} from '../../api/lead-no-evidence-batch';
import {
  clearPendingLeadNoEvidenceBatch,
  readPendingLeadNoEvidenceBatches,
  savePendingLeadNoEvidenceBatches,
  sameLeadNoEvidenceBatch,
  type FrozenLeadNoEvidenceBatch,
} from './lead-no-evidence-batch-recovery';

const props = defineProps<{
  leads: Lead[];
  identity: string;
  contextGeneration: string;
  pending?: FrozenLeadNoEvidenceBatch | null;
  beforeSubmit: (identity: string, context: string) => boolean;
}>();
const emit = defineEmits<{
  close: [];
  pending: [FrozenLeadNoEvidenceBatch, string];
  succeeded: [FrozenLeadNoEvidenceBatch, string];
}>();
const rows = ref<LeadDetail[]>([]);
const reasons = ref<string[]>([]);
const loading = ref(false);
const busy = ref(false);
const confirmed = ref(false);
const error = ref('');
const blocked = ref<string[]>([]);
const frozen = ref<FrozenLeadNoEvidenceBatch | null>(props.pending ?? null);
let epoch = 0;
let mounted = true;
let readRequest: AbortController | undefined;
let submitRequest: AbortController | undefined;
function current(
  generation: number,
  identity: string,
  context: string,
): boolean {
  return (
    mounted &&
    epoch === generation &&
    props.identity === identity &&
    props.contextGeneration === context
  );
}
watch(
  () => [
    props.identity,
    props.contextGeneration,
    props.leads.map((lead) => lead.id).join(','),
  ],
  async (_value, _previous, onCleanup) => {
    const generation = ++epoch;
    readRequest?.abort();
    submitRequest?.abort();
    const controller = new AbortController();
    readRequest = controller;
    onCleanup(() => controller.abort());
    busy.value = false;
    loading.value = true;
    rows.value = [];
    reasons.value = [];
    blocked.value = [];
    error.value = '';
    confirmed.value = false;
    frozen.value = props.pending ?? null;
    const identity = props.identity;
    const context = props.contextGeneration;
    const ids =
      props.pending?.input.items.map((item) => item.leadId) ??
      props.leads.map((lead) => lead.id);
    if (
      !/^[^:]+:INTERNAL:[^:]+$/u.test(identity) ||
      ids.length < 1 ||
      ids.length > 20 ||
      new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
    ) {
      blocked.value = ['请选择1～20条不同线索。'];
      loading.value = false;
      return;
    }
    const results = await Promise.allSettled(
      ids.map((id) => getLead(id, { signal: controller.signal })),
    );
    if (controller.signal.aborted || !current(generation, identity, context))
      return;
    const fresh: LeadDetail[] = [];
    results.forEach((result, index) => {
      const name =
        props.leads.find(
          (lead) => lead.id.toLowerCase() === ids[index]!.toLowerCase(),
        )?.businessNo ?? `第${index + 1}项`;
      if (result.status !== 'fulfilled') {
        blocked.value.push(`${name}：无法读取当前线索与权限，整批不可提交。`);
        return;
      }
      const lead = result.value;
      if (
        lead.id.toLowerCase() !== ids[index]!.toLowerCase() ||
        lead.departmentId !== identity.split(':')[2]
      ) {
        blocked.value.push(`${name}：当前线索不可用，整批不可提交。`);
        return;
      }
      if (
        !props.pending &&
        (lead.status !== 'WAITING_EVIDENCE_DECISION' ||
          !lead.capabilities.evidenceDecide ||
          lead.reviewDecision?.result !== 'INFRINGEMENT' ||
          lead.evidenceDecision !== null ||
          !Number.isInteger(lead.version) ||
          lead.version < 1 ||
          lead.version > 2_147_483_646)
      )
        blocked.value.push(
          `${lead.businessNo}：当前状态、客户审核或不取证办理权限不满足要求，整批不可提交。`,
        );
      fresh.push(lead);
    });
    rows.value = fresh;
    reasons.value = props.pending
      ? props.pending.input.items.map((item) => item.reason)
      : fresh.map(() => '');
    loading.value = false;
  },
  { immediate: true, flush: 'sync' },
);
const input = computed(
  () =>
    frozen.value?.input ?? {
      items: rows.value.map((lead, index) => ({
        leadId: lead.id,
        expectedVersion: lead.version,
        reason: reasons.value[index] ?? '',
      })),
    },
);
const ready = computed(
  () =>
    !loading.value &&
    !busy.value &&
    blocked.value.length === 0 &&
    confirmed.value &&
    isLeadNoEvidenceBatchInput(input.value),
);
async function submit(): Promise<void> {
  if (!ready.value) return;
  const identity = props.identity;
  const context = props.contextGeneration;
  const generation = epoch;
  if (
    !current(generation, identity, context) ||
    !props.beforeSubmit(identity, context)
  ) {
    error.value = '当前身份、页面或其他未决请求已变化，批次未发送。';
    return;
  }
  const stored = readPendingLeadNoEvidenceBatches();
  if (
    !stored ||
    (frozen.value
      ? !stored[identity] ||
        !sameLeadNoEvidenceBatch(stored[identity]!, frozen.value)
      : !!stored[identity])
  ) {
    error.value = '原请求存储不可用或已变化，批次未发送。';
    return;
  }
  const attempt: FrozenLeadNoEvidenceBatch = frozen.value ?? {
    identity,
    idempotencyKey: globalThis.crypto.randomUUID(),
    input: { items: input.value.items.map((item) => ({ ...item })) },
  };
  stored[identity] = attempt;
  if (!savePendingLeadNoEvidenceBatches(stored)) {
    error.value = '无法安全保存原请求，批次未发送。';
    return;
  }
  frozen.value = attempt;
  emit('pending', attempt, context);
  if (
    !current(generation, identity, context) ||
    !props.beforeSubmit(identity, context)
  ) {
    error.value = '当前上下文已变化，原批次已保留，未继续发送。';
    return;
  }
  const controller = new AbortController();
  submitRequest = controller;
  busy.value = true;
  error.value = '';
  try {
    await decideLeadNoEvidenceBatch(
      { items: attempt.input.items.map((item) => ({ ...item })) },
      {
        signal: controller.signal,
        headers: { 'Idempotency-Key': attempt.idempotencyKey },
      },
    );
    if (controller.signal.aborted || !current(generation, identity, context))
      return;
    if (!clearPendingLeadNoEvidenceBatch(attempt)) {
      error.value =
        '服务器已返回结果，但本地原请求无法清除，请保留原请求核对。';
      return;
    }
    emit('succeeded', attempt, context);
  } catch {
    if (controller.signal.aborted || !current(generation, identity, context))
      return;
    error.value =
      '整批结果尚未确认。原始内容与请求键已保留，只能核对或原样重试，不会跳过失败项。';
  } finally {
    if (current(generation, identity, context)) busy.value = false;
  }
}
onBeforeUnmount(() => {
  mounted = false;
  epoch += 1;
  readRequest?.abort();
  submitRequest?.abort();
});
</script>

<template>
  <section
    class="demo-card lead-no-evidence-batch"
    role="dialog"
    aria-modal="true"
    aria-labelledby="no-evidence-batch-title"
  >
    <h2 id="no-evidence-batch-title">批量不取证归档</h2>
    <p>
      只处理本次明确选中的1～20条线索。确认后整批归档，不再进入取证安排；任一项不符合要求，整批不提交。
    </p>
    <p>每项原因必填，去除首尾空白后最多5000字。</p>
    <p v-if="loading" role="status">正在逐项核对当前线索、版本和办理权限…</p>
    <p v-if="frozen" role="status" data-test="no-evidence-original">
      已保留原批次。以下原因、顺序和请求键保持原样；核对时服务器会重新检查当前权限。
    </p>
    <ul v-if="blocked.length" role="alert">
      <li v-for="message in blocked" :key="message">{{ message }}</li>
    </ul>
    <ol>
      <li v-for="(lead, index) in rows" :key="lead.id">
        <p>
          {{ lead.businessNo }} · {{ lead.displayNames.customerName }} ·
          {{ lead.shopName }}
        </p>
        <label
          >不取证原因<textarea
            v-model="reasons[index]"
            :disabled="busy || !!frozen"
            :data-test="`no-evidence-reason-${index}`"
          />
        </label>
      </li>
    </ol>
    <label
      ><input
        v-model="confirmed"
        type="checkbox"
        data-test="no-evidence-confirm"
        :disabled="loading || busy || !!blocked.length"
      />我已逐项确认原因，并确认整批不取证归档。</label
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton
      type="primary"
      data-test="no-evidence-submit"
      :disabled="!ready"
      :loading="busy"
      @click="submit"
      >{{ frozen ? '核对原批次' : '整批不取证归档' }}</ElButton
    >
    <ElButton
      data-test="no-evidence-close"
      :disabled="busy"
      @click="emit('close')"
      >{{ frozen ? '保留原批次并关闭' : '取消' }}</ElButton
    >
  </section>
</template>

<style scoped>
.lead-no-evidence-batch {
  padding: var(--s-6);
}
.lead-no-evidence-batch textarea {
  display: block;
  width: 100%;
  min-height: 90px;
  font: inherit;
}
.lead-no-evidence-batch li {
  margin-block: var(--s-4);
}
</style>
