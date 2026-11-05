<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  listLawyerMatchCandidates,
  type CaseSummary,
  type LawyerMatchCandidate,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  assignCaseLawyer,
  getLawyerAssignmentCapability,
  validAssignCaseLawyerResult,
  type LawyerAssignmentCapability,
} from '../../api/case-lawyer-assignment';
import {
  clearLawyerAssignmentBatch,
  filingActorIdentity,
  readLawyerAssignmentBatch,
  saveLawyerAssignmentBatch,
  type LawyerAssignmentBatch,
  type LawyerAssignmentBatchItem,
} from './case-lawyer-assignment-batch-recovery';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{ selectedCases: CaseSummary[]; actorKey: string }>();
const emit = defineEmits<{ changed: []; close: [] }>();
const identity = computed(() => filingActorIdentity(props.actorKey));
const selected = computed(() => [
  ...new Map(props.selectedCases.map((item) => [item.id, item])).values(),
]);
const capabilities = ref<
  Record<string, LawyerAssignmentCapability | { error: string }>
>({});
const candidates = ref<LawyerMatchCandidate[]>([]);
const targetId = ref('');
const batch = ref<LawyerAssignmentBatch | null>(null);
const loading = ref(false);
const busy = ref(false);
const writeLocked = ref(true);
const recoveryBlocked = ref(false);
const error = ref('');
let generation = 0;
let lockAttempt = 0;
let releaseLock: (() => void) | null = null;
let heldActor: string | null = null;
const unresolved = computed(
  () =>
    batch.value?.items.filter(
      (item) => item.state === 'SENT' || item.state === 'UNKNOWN',
    ) ?? [],
);
const prepared = computed(
  () => batch.value?.items.filter((item) => item.state === 'PREPARED') ?? [],
);
function stateLabel(state: LawyerAssignmentBatchItem['state']): string {
  switch (state) {
    case 'PREPARED':
      return '待确认';
    case 'SENT':
      return '提交中';
    case 'UNKNOWN':
      return '待核对';
    case 'ASSIGNED':
      return '已成功';
    case 'NO_CHANGE':
      return '无需变更';
    case 'SKIPPED':
      return '已跳过';
    case 'FAILED':
      return '失败';
    case 'BLOCKED':
      return '受阻';
  }
}
const target = computed(
  () =>
    candidates.value.find(
      (candidate) => candidate.lawyerAccountId === targetId.value,
    ) ?? null,
);
const currentName = (id: string | undefined) => {
  if (!id) return '未分配';
  const candidate = candidates.value.find(
    (item) => item.lawyerAccountId === id,
  );
  return candidate
    ? `${candidate.displayName}（${candidate.username}）`
    : '姓名暂不可读取';
};
function currentFor(caseId: string): string | undefined {
  const cap = capabilities.value[caseId];
  return cap && !('error' in cap)
    ? cap.currentAssignment?.lawyerAccountId
    : undefined;
}
function blockedReason(caseId: string): string {
  const cap = capabilities.value[caseId];
  if (!cap) return '尚未完成分配权限预检。';
  if ('error' in cap) {
    switch (cap.error) {
      case 'ACTION_FORBIDDEN':
      case 'CASE_ACTION_FORBIDDEN':
        return '当前账号无此案的分配权限，或案件不在授权范围内。';
      case 'NOT_FOUND':
      case 'CASE_NOT_FOUND':
        return '案件不存在或当前账号无法读取该案。';
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        return '分配权限读取超时或网络失败，请重试。';
      case 'INVALID_RESPONSE':
        return '分配权限服务返回异常，请稍后重试或联系管理员核对。';
      default:
        return '无法读取该案的分配权限，请重试。';
    }
  }
  if (cap.reason === 'INVALID_STATE') return '当前案件阶段不支持律师分配。';
  if (cap.reason === 'LAWYER_ASSIGNMENT_CONFLICT')
    return '案件承办关系存在冲突，请先核对案件信息。';
  return '当前案件不可办理律师分配。';
}
function planned(caseId: string): string {
  const cap = capabilities.value[caseId];
  if (!cap || 'error' in cap || !cap.canAssign) return blockedReason(caseId);
  if (!target.value) return '待选择目标律师';
  if (!cap.currentAssignment) return '可分配';
  return cap.currentAssignment.lawyerAccountId === target.value.lawyerAccountId
    ? '无需变更'
    : '将跳过（已有其他律师）';
}
function release(): void {
  lockAttempt += 1;
  releaseLock?.();
  releaseLock = null;
  heldActor = null;
  writeLocked.value = true;
}
async function acquire(actor: string): Promise<void> {
  if (heldActor === actor && releaseLock) {
    writeLocked.value = false;
    return;
  }
  release();
  const attempt = lockAttempt;
  if (!globalThis.navigator.locks?.request) {
    error.value = '此浏览器无法安全办理批量律师分配。';
    return;
  }
  let report: (held: boolean) => void = () => undefined;
  const acquired = new Promise<boolean>((resolve) => {
    report = resolve;
  });
  void globalThis.navigator.locks
    .request(
      `case-lawyer-assignment:${actor}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          report(false);
          return;
        }
        await new Promise<void>((resolve) => {
          if (attempt !== lockAttempt || identity.value !== actor) {
            report(false);
            resolve();
            return;
          }
          releaseLock = resolve;
          report(true);
        });
      },
    )
    .catch(() => report(false));
  const held = await acquired;
  if (
    held &&
    attempt === lockAttempt &&
    identity.value === actor &&
    !recoveryBlocked.value
  ) {
    heldActor = actor;
    writeLocked.value = false;
  } else if (held && attempt === lockAttempt) release();
  else if (!held && attempt === lockAttempt && identity.value === actor)
    error.value = '另一个窗口正在办理本账号的分配批次；此窗口只读。';
}
function persist(next: LawyerAssignmentBatch): boolean {
  if (writeLocked.value || !saveLawyerAssignmentBatch(next)) {
    error.value = '原请求恢复记录无法安全保存，已停止写入。';
    return false;
  }
  batch.value = next;
  return true;
}
function replace(item: LawyerAssignmentBatchItem): boolean {
  if (!batch.value) return false;
  return persist({
    ...batch.value,
    items: batch.value.items.map((entry) =>
      entry.caseId === item.caseId ? item : entry,
    ),
  });
}
async function preflight(): Promise<void> {
  if (
    loading.value ||
    busy.value ||
    batch.value ||
    selected.value.length < 1 ||
    selected.value.length > 20
  )
    return;
  const g = generation;
  const actor = props.actorKey;
  loading.value = true;
  error.value = '';
  capabilities.value = {};
  candidates.value = [];
  targetId.value = '';
  try {
    const rows: Record<string, LawyerAssignmentCapability | { error: string }> =
      {};
    for (const item of selected.value) {
      try {
        rows[item.id] = await getLawyerAssignmentCapability(item.id);
      } catch (reason) {
        rows[item.id] = {
          error: reason instanceof ApiError ? reason.code : 'READ_FAILED',
        };
      }
      if (g !== generation || actor !== props.actorKey) return;
    }
    capabilities.value = rows;
    const first = selected.value.find((item) => {
      const cap = rows[item.id];
      return cap && !('error' in cap) && cap.canAssign;
    });
    if (first) candidates.value = await listLawyerMatchCandidates(first.id);
    if (g !== generation || actor !== props.actorKey) return;
  } catch {
    if (g === generation) error.value = '律师候选读取失败，请重试。';
  } finally {
    if (g === generation) loading.value = false;
  }
}
function prepare(): void {
  const who = identity.value;
  const chosen = target.value;
  if (
    !who ||
    !chosen ||
    batch.value ||
    writeLocked.value ||
    recoveryBlocked.value
  )
    return;
  const items: LawyerAssignmentBatchItem[] = selected.value.flatMap(
    (summary) => {
      const cap = capabilities.value[summary.id];
      if (!cap || 'error' in cap || !cap.canAssign) return [];
      return [
        {
          caseId: summary.id,
          businessNo: summary.businessNo,
          state: 'PREPARED' as const,
          input: {
            expectedVersion: cap.caseVersion,
            idempotencyKey: globalThis.crypto.randomUUID(),
            lawyerAccountId: chosen.lawyerAccountId,
            lawyerProfileId: chosen.lawyerProfileId,
          },
        },
      ];
    },
  );
  if (!items.length) {
    error.value = '没有可办理的案件。';
    return;
  }
  const next: LawyerAssignmentBatch = {
    identity: who,
    batchId: globalThis.crypto.randomUUID(),
    target: {
      lawyerAccountId: chosen.lawyerAccountId,
      lawyerProfileId: chosen.lawyerProfileId,
      displayName: chosen.displayName,
      username: chosen.username,
    },
    items,
  };
  if (persist(next))
    error.value = '批次已保存。请核对当前律师与目标律师后确认；尚未提交。';
}
function uncertain(reason: unknown): boolean {
  return (
    !(reason instanceof ApiError) ||
    reason.status >= 500 ||
    reason.status === 403 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(reason.code)
  );
}
async function sendOne(
  item: LawyerAssignmentBatchItem,
  recovery: boolean,
): Promise<void> {
  if (!batch.value || writeLocked.value) return;
  const g = generation;
  const actor = props.actorKey;
  const id = batch.value.batchId;
  const current = () =>
    g === generation && actor === props.actorKey && id === batch.value?.batchId;
  try {
    const cap = await getLawyerAssignmentCapability(item.caseId);
    if (!current()) return;
    if (
      !recovery &&
      (!cap.canAssign || cap.caseVersion !== item.input.expectedVersion)
    ) {
      replace({
        ...item,
        state: 'BLOCKED',
        note: '阶段、关系、版本或权限已变化，未发送。',
      });
      return;
    }
  } catch (reason) {
    if (!current()) return;
    replace({
      ...item,
      state: recovery ? 'UNKNOWN' : 'BLOCKED',
      note:
        reason instanceof ApiError && reason.status === 403
          ? '权限已撤销，原请求是否成功仍待核实。'
          : '无法重新读取案件与分配权限。',
    });
    return;
  }
  if (
    !replace({
      ...item,
      state: 'SENT',
      note: recovery ? '正在用原请求键核实。' : '正在分配。',
    })
  )
    return;
  try {
    const result = await assignCaseLawyer(item.caseId, item.input);
    if (!current()) return;
    if (!validAssignCaseLawyerResult(result, item.caseId, item.input))
      throw new Error('Unexpected assignment result');
    if (
      !replace({
        ...item,
        state: result.outcome,
        result,
        note:
          result.outcome === 'ASSIGNED'
            ? '已分配；案件仍待匹配。'
            : result.outcome === 'NO_CHANGE'
              ? '原律师不变。'
              : '已有其他律师，已跳过。',
      })
    )
      return;
    error.value = '办理结果见逐案列表。';
    if (result.outcome === 'ASSIGNED') {
      notifyWorkflowChanged();
      emit('changed');
    }
  } catch (reason) {
    if (!current()) return;
    replace({
      ...item,
      state: recovery || uncertain(reason) ? 'UNKNOWN' : 'FAILED',
      note:
        recovery || uncertain(reason)
          ? '结果未知；资料与原请求键已锁定。'
          : reason instanceof ApiError
            ? reason.message
            : '服务端明确拒绝。',
    });
  }
}
async function confirm(): Promise<void> {
  if (
    busy.value ||
    writeLocked.value ||
    !prepared.value.length ||
    unresolved.value.length
  )
    return;
  busy.value = true;
  const g = generation;
  error.value = '';
  try {
    for (const item of [...prepared.value]) {
      await sendOne(item, false);
      if (g !== generation || unresolved.value.length) break;
    }
  } finally {
    busy.value = false;
  }
  if (
    batch.value?.items.some((item) =>
      ['ASSIGNED', 'NO_CHANGE', 'SKIPPED'].includes(item.state),
    )
  )
    error.value = '办理结果见逐案列表。';
}
async function recover(): Promise<void> {
  if (busy.value || writeLocked.value || !unresolved.value.length) return;
  busy.value = true;
  const g = generation;
  error.value = '';
  try {
    for (const item of [...unresolved.value]) {
      await sendOne(item, true);
      if (g !== generation || unresolved.value.length) break;
    }
  } finally {
    busy.value = false;
  }
  if (
    batch.value?.items.some((item) =>
      ['ASSIGNED', 'NO_CHANGE', 'SKIPPED'].includes(item.state),
    )
  )
    error.value = '办理结果见逐案列表。';
}
function startAnother(): void {
  if (
    !batch.value ||
    writeLocked.value ||
    busy.value ||
    unresolved.value.length ||
    prepared.value.length
  )
    return;
  if (!clearLawyerAssignmentBatch(batch.value)) {
    error.value = '旧批次无法安全收尾。';
    return;
  }
  batch.value = null;
  capabilities.value = {};
  candidates.value = [];
  targetId.value = '';
  error.value = '';
}
watch(
  () => props.actorKey,
  (value) => {
    generation += 1;
    batch.value = null;
    capabilities.value = {};
    candidates.value = [];
    targetId.value = '';
    error.value = '';
    recoveryBlocked.value = false;
    const who = filingActorIdentity(value);
    if (!who) {
      release();
      return;
    }
    const stored = readLawyerAssignmentBatch(who);
    if (stored.state === 'blocked') {
      recoveryBlocked.value = true;
      error.value = '本账号分配批次恢复记录损坏或不可读；已阻止新分配和上传。';
      release();
      return;
    }
    if (stored.state === 'valid') {
      batch.value = {
        ...stored.batch,
        items: stored.batch.items.map((item) =>
          item.state === 'SENT' ? { ...item, state: 'UNKNOWN' } : item,
        ),
      };
      if (stored.batch.items.some((item) => item.state === 'SENT'))
        error.value = '上次请求结果未知；必须用原请求键核实。';
    }
    void acquire(who);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation += 1;
  release();
});
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="case-lawyer-assignment-batch-panel"
  >
    <h2 class="form-section-title">批量仅分配律师</h2>
    <p class="field-help">
      本动作只建立承办关系，不补被告、不生成匹配完成回执，也不推进阶段。后续仍须逐案正式匹配。
    </p>
    <p v-if="writeLocked" role="alert">当前窗口只读，无法新建或提交请求。</p>
    <p v-if="error" role="status">{{ error }}</p>
    <ElButton
      v-if="!batch"
      :disabled="
        loading ||
        busy ||
        recoveryBlocked ||
        selected.length < 1 ||
        selected.length > 20
      "
      data-test="assignment-preflight"
      @click="preflight"
      >逐案读取分配权限与候选</ElButton
    >
    <p v-if="loading" role="status">正在逐案核对权限…</p>
    <template v-if="!batch && candidates.length">
      <label
        >目标律师账号
        <select
          v-model="targetId"
          class="text-input"
          data-test="assignment-target"
        >
          <option value="">请选择有效真实律师账号</option>
          <option
            v-for="candidate in candidates"
            :key="candidate.lawyerAccountId"
            :value="candidate.lawyerAccountId"
          >
            {{ candidate.displayName }}（{{ candidate.username }}）
          </option>
        </select>
      </label>
      <ElButton
        :disabled="!target || writeLocked"
        data-test="assignment-prepare"
        @click="prepare"
        >保存批次并核对</ElButton
      >
    </template>
    <section
      v-if="Object.keys(capabilities).length"
      data-test="assignment-preview"
    >
      <h3>逐案预览</h3>
      <ul>
        <li v-for="item in selected" :key="item.id">
          {{ item.businessNo }}：当前
          {{ currentName(currentFor(item.id)) }}
          → 目标
          {{ target?.displayName ?? batch?.target.displayName ?? '未选择' }}；
          <strong :data-test="`assignment-status-${item.id}`">{{
            planned(item.id)
          }}</strong>
        </li>
      </ul>
    </section>
    <section v-if="batch" data-test="assignment-results">
      <h3>批次结果</h3>
      <p>
        目标律师：{{ batch.target.displayName }}（{{ batch.target.username }}）
      </p>
      <ul>
        <li v-for="item in batch.items" :key="item.caseId">
          {{ item.businessNo }}：{{ stateLabel(item.state) }}。{{
            item.note ?? ''
          }}<span v-if="item.result?.currentAssignment">
            当前承办律师
            {{
              currentName(item.result.currentAssignment.lawyerAccountId)
            }}</span
          >
        </li>
      </ul>
      <ElButton
        type="primary"
        :disabled="
          busy || writeLocked || !prepared.length || unresolved.length > 0
        "
        data-test="assignment-confirm"
        @click="confirm"
        >统一确认并逐案分配</ElButton
      >
      <ElButton
        v-if="unresolved.length"
        :disabled="busy || writeLocked"
        data-test="assignment-recover"
        @click="recover"
        >核实原请求</ElButton
      >
      <ElButton
        v-if="!prepared.length && !unresolved.length"
        text
        :disabled="busy || writeLocked"
        @click="startAnother"
        >结束此批次并开始新批次</ElButton
      >
    </section>
    <ElButton text :disabled="busy" @click="emit('close')">关闭</ElButton>
  </section>
</template>
