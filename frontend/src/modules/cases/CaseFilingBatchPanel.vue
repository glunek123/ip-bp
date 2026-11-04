<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  getCase,
  submitCaseFiling,
  type CaseDetail,
  type CaseFile,
  type CaseSummary,
  type SubmitCaseFilingInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import CaseFilingPanel from './CaseFilingPanel.vue';
import {
  filingActorIdentity,
  readFilingBatchState,
  saveFilingBatch,
  clearFilingBatch,
  type FilingBatch,
  type FilingBatchItem,
} from './case-filing-batch-recovery';

const props = defineProps<{ selectedCases: CaseSummary[]; actorKey: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const identity = computed(() => filingActorIdentity(props.actorKey));
const batch = ref<FilingBatch | null>(null);
const activeCaseId = ref('');
const detail = ref<CaseDetail | null>(null);
const loading = ref(false);
const busy = ref(false);
const writeLocked = ref(true);
const recoveryBlocked = ref(false);
const error = ref('');
const readRevision = ref(0);
let generation = 0;
let lockAttempt = 0;
let releaseLock: (() => void) | null = null;
let heldActor: string | null = null;
let readController: AbortController | null = null;
const selected = computed(() => [
  ...new Map(props.selectedCases.map((item) => [item.id, item])).values(),
]);
const activeSaved = computed(
  () =>
    batch.value?.items.find((item) => item.caseId === activeCaseId.value) ??
    null,
);
const activeSummary = computed(
  () =>
    selected.value.find((item) => item.id === activeCaseId.value) ??
    (activeSaved.value
      ? {
          id: activeSaved.value.caseId,
          businessNo: activeSaved.value.businessNo,
        }
      : null),
);
const navigable = computed(() => [
  ...selected.value.map((item) => ({
    id: item.id,
    businessNo: item.businessNo,
  })),
  ...(batch.value?.items
    .filter(
      (item) => !selected.value.some((summary) => summary.id === item.caseId),
    )
    .map((item) => ({ id: item.caseId, businessNo: item.businessNo })) ?? []),
]);
const prepared = computed(
  () => batch.value?.items.filter((item) => item.state === 'PREPARED') ?? [],
);
const unresolved = computed(
  () =>
    batch.value?.items.filter(
      (item) => item.state === 'SENT' || item.state === 'UNKNOWN',
    ) ?? [],
);
type FilingPreviewRow = {
  summary: Pick<CaseSummary, 'id' | 'businessNo'> &
    Partial<Pick<CaseSummary, 'stage' | 'canSubmitFiling'>>;
  saved: FilingBatchItem | null;
};
const previewRows = computed<FilingPreviewRow[]>(() => {
  const selectedById = new Map(selected.value.map((item) => [item.id, item]));
  const storedItems = batch.value?.items ?? [];
  const storedIds = new Set(storedItems.map((item) => item.caseId));
  return [
    ...storedItems.map((saved) => ({
      summary: selectedById.get(saved.caseId) ?? {
        id: saved.caseId,
        businessNo: saved.businessNo,
      },
      saved,
    })),
    ...selected.value
      .filter((summary) => !storedIds.has(summary.id))
      .map((summary) => ({ summary, saved: null })),
  ];
});
function stateLabel(state: FilingBatchItem['state']): string {
  switch (state) {
    case 'PREPARED':
      return '待确认';
    case 'SENT':
      return '提交中';
    case 'UNKNOWN':
      return '待核对';
    case 'COMMITTED':
      return '已成功';
    case 'FAILED':
      return '失败';
    case 'BLOCKED':
      return '受阻';
  }
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
    error.value = '此浏览器不支持批量办理锁，请使用支持的浏览器。';
    return;
  }
  let report: (held: boolean) => void = () => undefined;
  const acquired = new Promise<boolean>((resolve) => {
    report = resolve;
  });
  void globalThis.navigator.locks
    .request(
      `case-filing-batch:${actor}`,
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
    error.value = '另一个窗口正在办理本账号的立案批次；此窗口只读。';
}
function persist(next: FilingBatch): boolean {
  if (writeLocked.value || !saveFilingBatch(next)) {
    error.value = '恢复记录无法安全保存，已停止提交。请核对原批次。';
    return false;
  }
  batch.value = next;
  return true;
}
function replace(item: FilingBatchItem): boolean {
  const original = batch.value;
  if (!original) return false;
  return persist({
    ...original,
    items: original.items.map((entry) =>
      entry.caseId === item.caseId ? item : entry,
    ),
  });
}
async function loadCase(id = activeCaseId.value): Promise<CaseDetail | null> {
  readController?.abort();
  const controller = new AbortController();
  readController = controller;
  const g = generation;
  const actor = props.actorKey;
  loading.value = true;
  try {
    const fresh = await getCase(id, { signal: controller.signal });
    if (
      controller.signal.aborted ||
      g !== generation ||
      actor !== props.actorKey ||
      id !== activeCaseId.value
    )
      return null;
    detail.value = fresh;
    readRevision.value += 1;
    return fresh;
  } catch (reason) {
    if (!controller.signal.aborted && g === generation)
      error.value =
        reason instanceof ApiError && [401, 403, 404].includes(reason.status)
          ? '当前账号无法读取此案，请核对权限。'
          : '案件读取失败，请重试。';
    return null;
  } finally {
    if (readController === controller) {
      readController = null;
      loading.value = false;
    }
  }
}
function select(id: string): void {
  activeCaseId.value = id;
  detail.value = null;
  error.value = '';
  if (id) void loadCase(id);
}
function makeBatch(
  input: SubmitCaseFilingInput,
  details: {
    courtName: string;
    evidenceFiles: CaseFile[];
    screenshotFiles: CaseFile[];
  },
): FilingBatch | null {
  const who = identity.value;
  const summary = activeSummary.value;
  if (
    !who ||
    !summary ||
    writeLocked.value ||
    !detail.value ||
    detail.value.stage !== 'WAITING_FILING' ||
    !detail.value.canSubmitFiling ||
    detail.value.version !== input.expectedVersion
  )
    return null;
  const item: FilingBatchItem = {
    caseId: summary.id,
    businessNo: summary.businessNo,
    input,
    courtName: details.courtName,
    evidenceFiles: details.evidenceFiles,
    screenshotFiles: details.screenshotFiles,
    state: 'PREPARED',
  };
  const old = batch.value;
  if (old) {
    const existing = old.items.find((entry) => entry.caseId === summary.id);
    if (existing && !['PREPARED', 'FAILED', 'BLOCKED'].includes(existing.state))
      return null;
    return {
      ...old,
      items: existing
        ? old.items.map((entry) => (entry.caseId === summary.id ? item : entry))
        : [...old.items, item],
    };
  }
  return {
    identity: who,
    batchId: globalThis.crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    items: [item],
  };
}
function onPrepared(
  input: SubmitCaseFilingInput,
  details: {
    courtName: string;
    evidenceFiles: CaseFile[];
    screenshotFiles: CaseFile[];
  },
): void {
  const next = makeBatch(input, details);
  if (!next) {
    error.value = '此案目前不能保存准备资料，请刷新案件后核对。';
    return;
  }
  if (persist(next)) error.value = '本案资料已保存为准备态；尚未提交立案。';
}
function unknown(reason: unknown): boolean {
  return (
    !(reason instanceof ApiError) ||
    reason.status >= 500 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(reason.code)
  );
}
function filingFactsAgree(
  fresh: CaseDetail,
  input: SubmitCaseFilingInput,
): boolean {
  const fact = fresh.filingSubmission;
  if (!fact) return false;
  const sameVersions = (actual: string[], requested: string[]) =>
    actual.length === requested.length &&
    actual.every((id) => requested.includes(id));
  return (
    fact.court.id === input.courtId &&
    fact.submittedAt === input.submittedAt &&
    (fact.mediationNo ?? '') === (input.mediationNo ?? '') &&
    sameVersions(
      fact.evidenceFiles.map((file) => file.contentVersionId),
      input.filingEvidenceContentVersionIds,
    ) &&
    sameVersions(
      fact.screenshotFiles.map((file) => file.contentVersionId),
      input.filingScreenshotContentVersionIds ?? [],
    )
  );
}
async function sendOne(
  item: FilingBatchItem,
  recovery: boolean,
): Promise<void> {
  if (!batch.value || writeLocked.value) return;
  const startedGeneration = generation;
  const startedActor = props.actorKey;
  const startedBatch = batch.value.batchId;
  const isCurrent = () =>
    startedGeneration === generation &&
    startedActor === props.actorKey &&
    startedBatch === batch.value?.batchId;
  activeCaseId.value = item.caseId;
  const fresh = await loadCase(item.caseId);
  if (!isCurrent()) return;
  if (!fresh) {
    if (recovery)
      replace({
        ...item,
        state: 'UNKNOWN',
        note: '无法读取最新事实；原请求仍待核实。',
      });
    else
      replace({
        ...item,
        state: 'BLOCKED',
        note: '无法重新读取案件与权限，尚未发送。',
      });
    return;
  }
  if (
    !recovery &&
    (fresh.stage !== 'WAITING_FILING' ||
      !fresh.canSubmitFiling ||
      fresh.version !== item.input.expectedVersion)
  ) {
    replace({
      ...item,
      state: 'BLOCKED',
      note: '阶段、版本或权限已变化，尚未发送。',
    });
    return;
  }
  // A changed stage or matching facts are observations, never proof of this request's receipt.
  // A recovery always sends the original body and key to retrieve the authoritative result.
  if (
    !replace({
      ...item,
      state: 'SENT',
      note: recovery
        ? filingFactsAgree(fresh, item.input)
          ? '现有立案事实的关键字段符合原请求；仍在用原键核实回执。'
          : '现有立案事实未与原请求对应；仍在用原键核实回执。'
        : '正在提交。',
    })
  )
    return;
  try {
    const result = await submitCaseFiling(item.caseId, item.input);
    if (!isCurrent()) return;
    if (
      result.id !== item.caseId ||
      result.stage !== 'WAITING_FORMAL_ACCEPTANCE' ||
      result.version !== item.input.expectedVersion + 1 ||
      result.submittedAt !== item.input.submittedAt
    )
      throw new Error('Unexpected filing result');
    if (!replace({ ...item, state: 'COMMITTED', result, note: '立案已提交。' }))
      return;
    error.value = '办理结果见逐案列表。';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent()) return;
    if (recovery || unknown(reason)) {
      replace({
        ...item,
        state: 'UNKNOWN',
        note: '结果未知；已锁定资料与原请求键，需继续核实。',
      });
    } else {
      replace({
        ...item,
        state: 'FAILED',
        note:
          reason instanceof ApiError ? reason.message : '服务端明确拒绝提交。',
      });
    }
  }
}
async function confirm(): Promise<void> {
  if (
    busy.value ||
    writeLocked.value ||
    unresolved.value.length ||
    !prepared.value.length
  )
    return;
  busy.value = true;
  const startedGeneration = generation;
  error.value = '';
  try {
    for (const item of [...prepared.value]) {
      await sendOne(item, false);
      if (startedGeneration !== generation || unresolved.value.length) break;
    }
  } finally {
    busy.value = false;
  }
  if (batch.value?.items.some((item) => item.state === 'COMMITTED'))
    error.value = '办理结果见逐案列表。';
}
async function recover(): Promise<void> {
  if (busy.value || writeLocked.value) return;
  busy.value = true;
  const startedGeneration = generation;
  error.value = '';
  try {
    for (const item of [...unresolved.value]) {
      await sendOne(item, true);
      if (startedGeneration !== generation || unresolved.value.length) break;
    }
  } finally {
    busy.value = false;
  }
  if (batch.value?.items.some((item) => item.state === 'COMMITTED'))
    error.value = '办理结果见逐案列表。';
}
function startAnother(): void {
  if (
    !batch.value ||
    busy.value ||
    writeLocked.value ||
    unresolved.value.length ||
    batch.value.items.some((item) => item.state === 'PREPARED')
  )
    return;
  if (!clearFilingBatch(batch.value)) {
    error.value = '旧批次无法安全归档，未开始新批次。';
    return;
  }
  batch.value = null;
  error.value = '';
}
watch(
  () => props.actorKey,
  (value) => {
    generation += 1;
    readController?.abort();
    batch.value = null;
    detail.value = null;
    activeCaseId.value = '';
    error.value = '';
    recoveryBlocked.value = false;
    const who = filingActorIdentity(value);
    if (!who) {
      release();
      return;
    }
    const read = readFilingBatchState(who);
    if (read.state === 'blocked') {
      recoveryBlocked.value = true;
      writeLocked.value = true;
      error.value =
        '本账号的批次恢复记录无法读取或无效。系统已停止上传与提交，请先核对原请求记录。';
      release();
      return;
    }
    const stored = read.state === 'valid' ? read.batch : null;
    batch.value = stored
      ? {
          ...stored,
          items: stored.items.map((item) =>
            item.state === 'SENT' ? { ...item, state: 'UNKNOWN' } : item,
          ),
        }
      : null;
    if (stored?.items.some((item) => item.state === 'SENT'))
      error.value = '上次提交结果未知；请使用原请求键核实。';
    void acquire(who);
    select(
      stored?.items.find((item) =>
        ['PREPARED', 'FAILED', 'BLOCKED'].includes(item.state),
      )?.caseId ??
        selected.value[0]?.id ??
        stored?.items[0]?.caseId ??
        '',
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation += 1;
  readController?.abort();
  release();
});
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="case-filing-batch-panel">
    <h2 class="form-section-title">批量提交立案</h2>
    <p class="field-help">
      逐案填写并保存准备资料。预览后统一确认，系统按顺序逐案提交。
    </p>
    <p v-if="writeLocked" role="alert">
      当前窗口只读；请在办理窗口完成或关闭后再试。
    </p>
    <p v-if="error" role="status">{{ error }}</p>
    <nav aria-label="选择立案案件">
      <ElButton
        v-for="item in navigable"
        :key="item.id"
        text
        :disabled="busy"
        @click="select(item.id)"
        >{{ item.businessNo }}</ElButton
      >
    </nav>
    <p v-if="loading" role="status">正在读取案件与当前权限…</p>
    <p v-if="activeSaved" class="field-help">
      {{ activeSaved.businessNo }}：{{ stateLabel(activeSaved.state) }}。{{
        activeSaved.note ?? ''
      }}
    </p>
    <CaseFilingPanel
      v-if="
        detail &&
        activeSummary &&
        !writeLocked &&
        (!activeSaved ||
          ['PREPARED', 'FAILED', 'BLOCKED'].includes(activeSaved.state))
      "
      :key="`${actorKey}:${detail.id}:${readRevision}`"
      :item="detail"
      :context-key="`${actorKey}:${detail.id}:${readRevision}`"
      :prepared-input="activeSaved?.input"
      :prepared-evidence-files="activeSaved?.evidenceFiles"
      :prepared-screenshot-files="activeSaved?.screenshotFiles"
      prepare-only
      @prepared="onPrepared"
      @refresh="loadCase()"
    />
    <section v-if="batch || selected.length" data-test="filing-batch-preview">
      <h3>批次预览与结果</h3>
      <ul>
        <li v-for="row in previewRows" :key="row.summary.id">
          {{ row.summary.businessNo }}：{{
            row.saved
              ? stateLabel(row.saved.state)
              : row.summary.stage === 'WAITING_FILING' &&
                  row.summary.canSubmitFiling
                ? '未填写'
                : '受阻'
          }}。
          <template v-if="row.saved">
            法院 {{ row.saved.courtName }}；提交日期
            {{ row.saved.input.submittedAt }}；诉调号
            {{ row.saved.input.mediationNo ?? '未填写' }}； 起诉材料
            {{
              row.saved.evidenceFiles
                .map(
                  (file) =>
                    `${file.originalFilename} (${file.contentVersionId})`,
                )
                .join('、') || '仅合案来源'
            }}； 立案截图
            {{
              row.saved.screenshotFiles
                .map(
                  (file) =>
                    `${file.originalFilename} (${file.contentVersionId})`,
                )
                .join('、') || '无'
            }}； 合案来源版本
            {{
              row.saved.input.consolidationSourceContentVersionIds?.join(
                '、',
              ) || '无'
            }}。
            {{
              row.saved.note ??
              (row.saved.state === 'PREPARED' ? '已准备，尚未提交。' : '')
            }}
          </template>
          <template v-else>尚未保存本案准备资料。</template>
        </li>
      </ul>
      <p>
        已就绪 {{ prepared.length }} 件；待核实
        {{ unresolved.length }}
        件。预先上传材料只保存文件版本，正式提交以后才生成立案事实。
      </p>
      <ElButton
        type="primary"
        :disabled="
          busy || writeLocked || !prepared.length || unresolved.length > 0
        "
        data-test="filing-batch-confirm"
        @click="confirm"
        >统一确认并逐案提交</ElButton
      >
      <ElButton
        v-if="unresolved.length"
        type="primary"
        :disabled="busy || writeLocked"
        data-test="filing-batch-recover"
        @click="recover"
        >核实原请求</ElButton
      >
      <ElButton
        v-if="!unresolved.length && !prepared.length"
        text
        :disabled="busy || writeLocked"
        @click="startAnother"
        >结束此批次并开始新批次</ElButton
      >
    </section>
    <ElButton text :disabled="busy" @click="emit('close')">关闭</ElButton>
  </section>
</template>
