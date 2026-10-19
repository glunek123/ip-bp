<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  correctNotaryEvidence,
  correctNotaryOpeningSender,
  type CorrectNotaryEvidenceInput,
  type CorrectNotaryOpeningSenderInput,
  type NotaryMatterDetail,
  type NotaryRecordCorrectionResult,
} from '../../api/notary';

type Kind = 'evidence' | 'openingSender';
type FrozenRequest = {
  actorKey: string;
  departmentId: string;
  matterId: string;
  kind: Kind;
  key: string;
  input: CorrectNotaryEvidenceInput | CorrectNotaryOpeningSenderInput;
};
function actorIdentityKey(actorKey: string): string {
  return actorKey.split(':').slice(0, 3).join(':');
}
const props = defineProps<{
  detail: NotaryMatterDetail;
  actorKey: string;
  blocked?: boolean;
  refreshing?: boolean;
}>();
const emit = defineEmits<{
  refreshed: [];
  corrected: [NotaryRecordCorrectionResult];
  locking: [boolean];
}>();
const reason = ref('');
const evidenceAt = ref('');
const rows = ref<
  Array<{
    companyState: '' | 'PRESENT' | 'NONE';
    companyValue: string;
    trackingState: '' | 'PRESENT' | 'NONE';
    trackingValue: string;
  }>
>([]);
const senderName = ref('');
const senderPhone = ref('');
const senderAddress = ref('');
const pending = ref<FrozenRequest | null>(null);
const pendingStorageKey = ref<string | null>(null);
const busy = ref(false);
const storageBlocked = ref(false);
const retryBlocked = ref(false);
const recoveryDenied = ref(false);
const correctionSucceeded = ref(false);
const message = ref('');
const generation = ref(0);
let postRequestController: AbortController | undefined;
const storageKey = computed(
  () =>
    `notary-record-correction:${JSON.stringify([actorIdentityKey(props.actorKey), props.detail.id])}`,
);
const deniedKey = computed(
  () =>
    `notary-record-correction-denied:${JSON.stringify([actorIdentityKey(props.actorKey), props.detail.id])}`,
);
const edits = computed(() => props.detail.recordEdits);
const unknown = computed(() => pending.value !== null);
const pendingSummary = computed(() => {
  const request = pending.value;
  if (!request) return '';
  if (request.kind === 'evidence') {
    const input = request.input as CorrectNotaryEvidenceInput;
    const logistics = input.logistics
      .map(
        (row) =>
          `${row.companyState === 'NONE' ? '无快递公司' : (row.companyValue ?? '未填写')} / ${row.trackingState === 'NONE' ? '无单号' : (row.trackingValue ?? '未填写')}`,
      )
      .join('；');
    return `原请求；可能与当前值不同。事项版本 ${input.expectedVersion}，资料版本 ${input.expectedRevision}；原因：${input.correctionReason}；取证日期：${input.evidenceAt}；物流：${logistics}`;
  }
  const input = request.input as CorrectNotaryOpeningSenderInput;
  return `原请求；可能与当前值不同。事项版本 ${input.expectedVersion}，资料版本 ${input.expectedRevision}；原因：${input.correctionReason}；寄件信息：${input.senderName ?? '未登记'} / ${input.senderPhone ?? '未登记'} / ${input.senderAddress ?? '未登记'}`;
});
function canLeave() {
  return !busy.value && !unknown.value && !storageBlocked.value;
}
defineExpose({ canLeave });

function resetForms() {
  reason.value = '';
  const group = edits.value?.evidence;
  evidenceAt.value =
    group?.effective.evidenceAt ?? props.detail.evidence?.evidenceAt ?? '';
  rows.value = (
    group?.effective.logistics ??
    props.detail.evidence?.logistics ??
    []
  ).map((row) => ({
    companyState: row.companyState,
    companyValue: row.companyValue ?? '',
    trackingState: row.trackingState,
    trackingValue: row.trackingValue ?? '',
  }));
  senderName.value =
    edits.value?.openingSender?.effective.senderName ??
    props.detail.opening?.senderName ??
    '';
  senderPhone.value =
    edits.value?.openingSender?.effective.senderPhone ??
    props.detail.opening?.senderPhone ??
    '';
  senderAddress.value =
    edits.value?.openingSender?.effective.senderAddress ??
    props.detail.opening?.senderAddress ??
    '';
}
function readPending() {
  pending.value = null;
  pendingStorageKey.value = null;
  storageBlocked.value = false;
  retryBlocked.value = false;
  recoveryDenied.value = false;
  try {
    const candidates: string[] = [];
    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
      const key = globalThis.sessionStorage.key(index);
      if (!key?.startsWith('notary-record-correction:')) continue;
      let tuple: unknown;
      try {
        tuple = JSON.parse(key.slice('notary-record-correction:'.length));
      } catch {
        continue;
      }
      if (
        Array.isArray(tuple) &&
        tuple.length === 2 &&
        typeof tuple[0] === 'string' &&
        actorIdentityKey(tuple[0]) === actorIdentityKey(props.actorKey) &&
        tuple[1] === props.detail.id
      )
        candidates.push(key);
    }
    if (candidates.length > 1) throw new Error('ambiguous');
    const savedKey = candidates[0] ?? storageKey.value;
    const saved = globalThis.sessionStorage.getItem(savedKey);
    if (!saved) return;
    const value: unknown = JSON.parse(saved);
    if (typeof value !== 'object' || value === null) throw new Error('invalid');
    const request = value as FrozenRequest;
    if (!validFrozenRequest(request)) throw new Error('invalid');
    pending.value = request;
    pendingStorageKey.value = savedKey;
    let denied = false;
    const denial = globalThis.sessionStorage.getItem(deniedKey.value);
    if (denial) {
      const marker: unknown = JSON.parse(denial);
      if (
        typeof marker !== 'object' ||
        marker === null ||
        !('actorKey' in marker) ||
        typeof marker.actorKey !== 'string' ||
        !('key' in marker) ||
        marker.key !== request.key ||
        actorIdentityKey(marker.actorKey) !== actorIdentityKey(props.actorKey)
      )
        throw new Error('invalid denial marker');
      denied =
        marker.actorKey === props.actorKey && !canCorrectFrozenRequest(request);
      if (!denied) globalThis.sessionStorage.removeItem(deniedKey.value);
    }
    recoveryDenied.value = denied;
    retryBlocked.value = denied;
    message.value = denied
      ? '原请求曾被当前权限拒绝；权限事实恢复前只能查看，不能重试。'
      : '发现未确认的原请求。只能使用原请求键核实结果。';
  } catch {
    storageBlocked.value = true;
    message.value = '原请求记录无法安全读取，已停止更正。';
  }
}
function canCorrectFrozenRequest(request: FrozenRequest): boolean {
  return request.kind === 'evidence'
    ? props.detail.recordEdits?.evidence?.canCorrect === true
    : props.detail.recordEdits?.openingSender?.canCorrect === true;
}
function validFrozenRequest(value: FrozenRequest): boolean {
  if (
    !value ||
    actorIdentityKey(value.actorKey) !== actorIdentityKey(props.actorKey) ||
    value.departmentId !== (props.actorKey.split(':')[2] ?? '') ||
    value.matterId !== props.detail.id ||
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 128 ||
    !value.input ||
    typeof value.input !== 'object'
  )
    return false;
  const input = value.input;
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    typeof input.correctionReason !== 'string' ||
    !input.correctionReason.trim() ||
    input.correctionReason.trim().length > 500
  )
    return false;
  if (value.kind === 'evidence') {
    const evidence = input as CorrectNotaryEvidenceInput;
    return (
      Object.keys(input).sort().join(',') ===
        'correctionReason,evidenceAt,expectedRevision,expectedVersion,logistics' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(evidence.evidenceAt) &&
      Array.isArray(evidence.logistics) &&
      evidence.logistics.length > 0 &&
      evidence.logistics.every(
        (row) =>
          Object.keys(row).sort().join(',') ===
            'companyState,companyValue,trackingState,trackingValue' &&
          (row.companyState === 'PRESENT'
            ? typeof row.companyValue === 'string'
            : row.companyState === 'NONE' && row.companyValue === null) &&
          (row.trackingState === 'PRESENT'
            ? typeof row.trackingValue === 'string'
            : row.trackingState === 'NONE' && row.trackingValue === null),
      )
    );
  }
  if (value.kind === 'openingSender') {
    const sender = input as CorrectNotaryOpeningSenderInput;
    return (
      Object.keys(input).sort().join(',') ===
        'correctionReason,expectedRevision,expectedVersion,senderAddress,senderName,senderPhone' &&
      [sender.senderName, sender.senderPhone, sender.senderAddress].every(
        (field) => field === null || typeof field === 'string',
      ) &&
      (sender.senderName === null || sender.senderName.length <= 200) &&
      (sender.senderPhone === null || sender.senderPhone.length <= 100) &&
      (sender.senderAddress === null || sender.senderAddress.length <= 500)
    );
  }
  return false;
}
watch(
  () => ({
    id: props.detail.id,
    actorKey: props.actorKey,
    identity: actorIdentityKey(props.actorKey),
    recordEdits: props.detail.recordEdits,
  }),
  (current, previous) => {
    const identityChanged =
      !previous ||
      current.id !== previous.id ||
      current.identity !== previous.identity;
    const authorizationChanged =
      !previous || current.actorKey !== previous.actorKey;
    if (identityChanged || authorizationChanged) {
      generation.value += 1;
      postRequestController?.abort();
      postRequestController = undefined;
      busy.value = false;
    }
    if (identityChanged || correctionSucceeded.value) resetForms();
    correctionSucceeded.value = false;
    if (retryBlocked.value && !recoveryDenied.value && !authorizationChanged) {
      if (pendingStorageKey.value)
        globalThis.sessionStorage.removeItem(pendingStorageKey.value);
      pending.value = null;
      pendingStorageKey.value = null;
      storageBlocked.value = false;
      retryBlocked.value = false;
      recoveryDenied.value = false;
      message.value = '权限事实已重新读取。请核对资料后再创建新更正。';
    } else if (
      identityChanged ||
      authorizationChanged ||
      recoveryDenied.value
    ) {
      readPending();
      if (recoveryDenied.value && !identityChanged) {
        message.value =
          '权限事实已重新读取。原请求已保留，请使用原请求键核实。';
      }
    }
  },
  { immediate: true, flush: 'sync' },
);
watch([busy, unknown, storageBlocked], () => emit('locking', !canLeave()), {
  immediate: true,
  flush: 'sync',
});
onBeforeUnmount(() => {
  generation.value += 1;
  postRequestController?.abort();
  postRequestController = undefined;
  busy.value = false;
});

function addRow() {
  rows.value.push({
    companyState: '',
    companyValue: '',
    trackingState: '',
    trackingValue: '',
  });
}
function removeRow(index: number) {
  if (rows.value.length > 1) rows.value.splice(index, 1);
}
function normalizeEvidence(
  input: CorrectNotaryEvidenceInput,
): CorrectNotaryEvidenceInput {
  return {
    ...input,
    correctionReason: input.correctionReason.trim(),
    logistics: input.logistics.map((row) => ({
      companyState: row.companyState,
      companyValue:
        row.companyState === 'PRESENT'
          ? (row.companyValue?.trim() ?? null)
          : null,
      trackingState: row.trackingState,
      trackingValue:
        row.trackingState === 'PRESENT'
          ? (row.trackingValue?.trim() ?? null)
          : null,
    })),
  };
}
function submit(kind: Kind) {
  if (
    busy.value ||
    pending.value ||
    storageBlocked.value ||
    retryBlocked.value ||
    props.blocked ||
    props.refreshing ||
    !reason.value.trim() ||
    reason.value.trim().length > 500 ||
    !props.detail.recordEdits
  )
    return;
  if (kind === 'evidence') {
    if (
      !edits.value?.evidence?.canCorrect ||
      !evidenceAt.value ||
      rows.value.length === 0 ||
      rows.value.some(
        (row) =>
          !row.companyState ||
          !row.trackingState ||
          (row.companyState === 'PRESENT' && !row.companyValue.trim()) ||
          (row.trackingState === 'PRESENT' && !row.trackingValue.trim()),
      )
    ) {
      message.value = '请检查取证日期和每条物流的公司、单号状态及内容。';
      return;
    }
    const input = normalizeEvidence({
      expectedVersion: props.detail.version,
      expectedRevision: edits.value.evidence.revision,
      correctionReason: reason.value,
      evidenceAt: evidenceAt.value,
      logistics: rows.value.map((row) => ({
        companyState: row.companyState as 'PRESENT' | 'NONE',
        companyValue: row.companyState === 'PRESENT' ? row.companyValue : null,
        trackingState: row.trackingState as 'PRESENT' | 'NONE',
        trackingValue:
          row.trackingState === 'PRESENT' ? row.trackingValue : null,
      })),
    });
    void dispatch(kind, input);
  } else {
    if (!edits.value?.openingSender?.canCorrect) {
      message.value = '当前资料或权限不允许更正寄件信息。';
      return;
    }
    const input: CorrectNotaryOpeningSenderInput = {
      expectedVersion: props.detail.version,
      expectedRevision: edits.value.openingSender.revision,
      correctionReason: reason.value.trim(),
      senderName: senderName.value.trim() || null,
      senderPhone: senderPhone.value.trim() || null,
      senderAddress: senderAddress.value.trim() || null,
    };
    void dispatch(kind, input);
  }
}
async function dispatch(
  kind: Kind,
  input: FrozenRequest['input'],
  recovery = false,
) {
  const capturedGeneration = generation.value;
  if (
    busy.value ||
    capturedGeneration !== generation.value ||
    (recovery && !pending.value)
  )
    return;
  let request = pending.value;
  if (!recovery) {
    request = {
      actorKey: props.actorKey,
      departmentId: props.actorKey.split(':')[2] ?? '',
      matterId: props.detail.id,
      kind,
      key: globalThis.crypto.randomUUID(),
      input: JSON.parse(JSON.stringify(input)) as FrozenRequest['input'],
    };
    try {
      globalThis.sessionStorage.setItem(
        storageKey.value,
        JSON.stringify(request),
      );
      pendingStorageKey.value = storageKey.value;
    } catch {
      message.value = '无法保存原请求，尚未提交。请检查会话存储后重试。';
      return;
    }
  }
  if (
    !request ||
    actorIdentityKey(request.actorKey) !== actorIdentityKey(props.actorKey) ||
    request.matterId !== props.detail.id
  )
    return;
  const frozen = request;
  const controller = new AbortController();
  postRequestController = controller;
  busy.value = true;
  message.value = recovery ? '正在用原请求核实结果。' : '';
  try {
    const result =
      kind === 'evidence'
        ? await correctNotaryEvidence(
            frozen.matterId,
            frozen.input as CorrectNotaryEvidenceInput,
            frozen.key,
            { signal: controller.signal },
          )
        : await correctNotaryOpeningSender(
            frozen.matterId,
            frozen.input as CorrectNotaryOpeningSenderInput,
            frozen.key,
            { signal: controller.signal },
          );
    if (
      controller.signal.aborted ||
      capturedGeneration !== generation.value ||
      actorIdentityKey(props.actorKey) !== actorIdentityKey(frozen.actorKey)
    )
      return;
    if (
      pendingStorageKey.value &&
      globalThis.sessionStorage.getItem(pendingStorageKey.value) ===
        JSON.stringify(frozen)
    )
      globalThis.sessionStorage.removeItem(pendingStorageKey.value);
    globalThis.sessionStorage.removeItem(deniedKey.value);
    pending.value = null;
    pendingStorageKey.value = null;
    correctionSucceeded.value = true;
    notifyWorkflowChanged();
    emit('corrected', result);
    emit('refreshed');
    message.value = `更正已记录，资料版本 ${result.revision}。`;
  } catch (error) {
    if (
      controller.signal.aborted ||
      capturedGeneration !== generation.value ||
      actorIdentityKey(props.actorKey) !== actorIdentityKey(frozen.actorKey)
    )
      return;
    const apiError = error instanceof ApiError ? error : null;
    const isUnknown =
      !apiError ||
      apiError.status === 0 ||
      apiError.status >= 500 ||
      ['INVALID_RESPONSE', 'TIMEOUT', 'NETWORK_ERROR'].includes(apiError.code);
    if (isUnknown) {
      pending.value = frozen;
      message.value =
        '提交结果未知。请使用同一请求键核实，不要编辑或重新提交。';
    } else {
      if ([401, 403, 404].includes(apiError.status)) {
        retryBlocked.value = true;
        if (recovery) {
          pending.value = frozen;
          recoveryDenied.value = true;
          try {
            globalThis.sessionStorage.setItem(
              deniedKey.value,
              JSON.stringify({ actorKey: props.actorKey, key: frozen.key }),
            );
          } catch {
            // Keep the original frozen request in memory and fail closed for
            // this mounted panel if a denial marker cannot be persisted.
          }
        } else {
          if (pendingStorageKey.value)
            globalThis.sessionStorage.removeItem(pendingStorageKey.value);
          pending.value = null;
          pendingStorageKey.value = null;
        }
      } else {
        if (pendingStorageKey.value)
          globalThis.sessionStorage.removeItem(pendingStorageKey.value);
        pending.value = null;
        pendingStorageKey.value = null;
      }
      message.value =
        apiError.code === 'VERSION_CONFLICT' ||
        apiError.code === 'INVALID_STATE'
          ? '事项状态或版本已变化，正在重新读取事实。'
          : apiError.status === 403
            ? '当前账号无权更正，请重新核对权限。'
            : apiError.message;
      if (apiError.status === 409) emit('refreshed');
      if ([401, 403, 404].includes(apiError.status)) emit('refreshed');
    }
  } finally {
    if (postRequestController === controller) postRequestController = undefined;
    if (capturedGeneration === generation.value) busy.value = false;
  }
}
function retryUnknown() {
  if (pending.value && !retryBlocked.value && !props.refreshing)
    void dispatch(pending.value.kind, pending.value.input, true);
}
function logisticsSummary(
  rows: Array<{
    companyState: 'PRESENT' | 'NONE';
    companyValue: string | null;
    trackingState: 'PRESENT' | 'NONE';
    trackingValue: string | null;
  }>,
) {
  return (
    rows
      .map(
        (row) =>
          `${row.companyState === 'NONE' ? '无快递公司' : (row.companyValue ?? '未填写')} / ${row.trackingState === 'NONE' ? '无单号' : (row.trackingValue ?? '未填写')}`,
      )
      .join('；') || '无物流记录'
  );
}
function senderSummary(sender: {
  senderName: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
}) {
  return `${sender.senderName ?? '未登记'} / ${sender.senderPhone ?? '未登记'} / ${sender.senderAddress ?? '未登记'}`;
}
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="notary-record-corrections"
  >
    <h2 class="form-section-title">资料更正记录</h2>
    <p>
      更正会追加版本和原因，不改变公证流程阶段或费用、照片事实。已归档事项只读。
    </p>
    <details v-if="edits?.evidence" data-test="evidence-correction-history">
      <summary>
        取证日期与物流（当前资料 v{{ edits.evidence.revision }}）
      </summary>
      <p>
        原始取证日期：{{ edits.evidence.original.evidenceAt }}；当前取证日期：{{
          edits.evidence.effective.evidenceAt
        }}
      </p>
      <p>原始物流：{{ logisticsSummary(edits.evidence.original.logistics) }}</p>
      <p>
        当前物流：{{ logisticsSummary(edits.evidence.effective.logistics) }}
      </p>
      <ol>
        <li v-for="item in edits.evidence.history" :key="item.correctionId">
          v{{ item.revision }} · 原因：{{ item.correctionReason }} · 操作人：{{
            item.actorUserId
          }}
          · 时间：{{ item.recordedAt }}
          <p>
            之前：{{ item.before.evidenceAt }}；{{
              logisticsSummary(item.before.logistics)
            }}
          </p>
          <p>
            之后：{{ item.after.evidenceAt }}；{{
              logisticsSummary(item.after.logistics)
            }}
          </p>
        </li>
      </ol>
    </details>
    <details v-if="edits?.openingSender" data-test="sender-correction-history">
      <summary>
        寄件信息（当前资料 v{{ edits.openingSender.revision }}）
      </summary>
      <p>
        {{ edits.openingSender.original.senderName ?? '未登记' }} /
        {{ edits.openingSender.original.senderPhone ?? '未登记' }} /
        {{ edits.openingSender.original.senderAddress ?? '未登记' }}
      </p>
      <p>
        {{ edits.openingSender.effective.senderName ?? '未登记' }} /
        {{ edits.openingSender.effective.senderPhone ?? '未登记' }} /
        {{ edits.openingSender.effective.senderAddress ?? '未登记' }}
      </p>
      <ol>
        <li
          v-for="item in edits.openingSender.history"
          :key="item.correctionId"
        >
          v{{ item.revision }} · 原因：{{ item.correctionReason }} · 操作人：{{
            item.actorUserId
          }}
          · 时间：{{ item.recordedAt }}
          <p>之前：{{ senderSummary(item.before) }}</p>
          <p>之后：{{ senderSummary(item.after) }}</p>
        </li>
      </ol>
    </details>
    <p v-if="props.detail.recordEdits === undefined" role="status">
      当前详情未提供更正历史，请刷新后核实。
    </p>
    <template v-if="edits">
      <fieldset
        :disabled="
          busy ||
          unknown ||
          storageBlocked ||
          retryBlocked ||
          props.blocked ||
          props.refreshing
        "
        class="correction-form"
      >
        <label
          >更正原因（1–500字）<textarea v-model="reason" maxlength="500" />
        </label>
        <details v-if="edits.evidence?.canCorrect && props.detail.evidence">
          <summary>更正取证日期与物流</summary>
          <label>取证日期<input v-model="evidenceAt" type="date" /></label>
          <fieldset v-for="(row, index) in rows" :key="index">
            <legend>物流 {{ index + 1 }}</legend>
            <label
              >快递公司状态<select v-model="row.companyState">
                <option value="">请选择</option>
                <option value="PRESENT">有</option>
                <option value="NONE">无</option>
              </select></label
            >
            <label v-if="row.companyState === 'PRESENT'"
              >快递公司<input v-model="row.companyValue" maxlength="200"
            /></label>
            <label
              >快递单号状态<select v-model="row.trackingState">
                <option value="">请选择</option>
                <option value="PRESENT">有</option>
                <option value="NONE">无</option>
              </select></label
            >
            <label v-if="row.trackingState === 'PRESENT'"
              >快递单号<input v-model="row.trackingValue" maxlength="100"
            /></label>
            <button
              v-if="rows.length > 1"
              type="button"
              @click="removeRow(index)"
            >
              删除此条
            </button>
          </fieldset>
          <button type="button" @click="addRow">添加物流</button>
          <button
            type="button"
            data-test="correct-evidence"
            @click="submit('evidence')"
          >
            保存取证更正
          </button>
        </details>
        <details v-if="edits.openingSender?.canCorrect && props.detail.opening">
          <summary>更正寄件信息</summary>
          <label
            >寄件人姓名<input v-model="senderName" maxlength="200"
          /></label>
          <label
            >寄件人电话<input v-model="senderPhone" maxlength="100"
          /></label>
          <label
            >寄件人地址<input v-model="senderAddress" maxlength="500"
          /></label>
          <button
            type="button"
            data-test="correct-opening-sender"
            @click="submit('openingSender')"
          >
            保存寄件信息更正
          </button>
        </details>
      </fieldset>
    </template>
    <p v-if="message" role="status" data-test="correction-message">
      {{ message }}
    </p>
    <p v-if="unknown" data-test="pending-correction-summary" role="alert">
      {{ pendingSummary }}
    </p>
    <button
      v-if="unknown"
      type="button"
      data-test="retry-correction"
      :disabled="busy || retryBlocked || props.refreshing"
      @click="retryUnknown"
    >
      {{
        retryBlocked ? '权限事实刷新后可使用原请求键核实' : '使用原请求键核实'
      }}
    </button>
  </section>
</template>

<style scoped>
.correction-form {
  display: grid;
  gap: 0.75rem;
  border: 0;
  padding: 0;
}
.correction-form label {
  display: grid;
  gap: 0.25rem;
}
.correction-form input,
.correction-form textarea,
.correction-form select {
  max-width: 36rem;
}
</style>
