<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  correctCaseExecutionFilingFeedback,
  correctLawyerCaseExecutionFilingFeedback,
  getCase,
  getLawyerCase,
  recordCaseExecutionFilingFeedback,
  recordLawyerCaseExecutionFilingFeedback,
  submitCaseExecutionFilingSupplement,
  submitLawyerCaseExecutionFilingSupplement,
  correctCaseExecutionFilingSupplement,
  correctLawyerCaseExecutionFilingSupplement,
  type CaseDetail,
  type CaseFile,
  type LawyerCaseDetail,
  type CorrectExecutionFilingFeedbackInput,
  type RecordExecutionFilingFeedbackInput,
  type SubmitExecutionFilingSupplementInput,
  type CorrectExecutionFilingSupplementInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  uploadCaseExecutionFilingSupplementFile,
  uploadLawyerCaseExecutionFilingSupplementFile,
  type ExecutionFilingSupplementUploadTarget,
} from '../../api/materials';
import {
  clearFollowupPending,
  findFollowupPending,
  saveFollowupPending,
  type FollowupPending,
} from './case-execution-filing-followup-recovery';

const props = defineProps<{
  item: CaseDetail | LawyerCaseDetail;
  actorKey: string;
  lawyer?: boolean;
}>();
const emit = defineEmits<{ refresh: [] }>();
const feedbackOn = ref('');
const courtCaseNo = ref('');
const content = ref('');
const correctionReason = ref('');
const editingId = ref<string | null>(null);
const feedbackRevision = ref<number | null>(null);
const supplementOpen = ref(false);
const supplementRootId = ref<string | null>(null);
const supplementRevision = ref(0);
const supplementCorrection = ref(false);
const submittedOn = ref('');
const supplementNote = ref('');
const supplementReason = ref('');
const supplementFiles = ref<CaseFile[]>([]);
const uploading = ref(false);
const uploadMessage = ref('');
const pending = ref<FollowupPending[]>([]);
const damaged = ref(false);
const busy = ref(false);
const denied = ref(false);
const conflict = ref(false);
const error = ref('');
const success = ref('');
let generation = 0;
let supplementFormGeneration = 0;
let mounted = true;
const postControllers = new Set<AbortController>();
const readControllers = new Set<AbortController>();
const downloadControllers = new Set<AbortController>();
const uploadControllers = new Set<AbortController>();
const filing = computed(() => props.item.executionFilingFollowups);
const filingId = computed(() => props.item.executionFiling?.id ?? null);
const editable = computed(
  () =>
    props.item.stage === 'EXECUTING' &&
    filing.value != null &&
    filingId.value != null &&
    filing.value.filingId.toLowerCase() === filingId.value.toLowerCase(),
);
const selected = computed(() =>
  filing.value?.feedbacks.find((entry) => entry.feedbackId === editingId.value),
);
const staleFeedbackEdit = computed(
  () =>
    editingId.value !== null &&
    (selected.value === undefined ||
      selected.value.current.revision !== feedbackRevision.value),
);
const selectedSupplement = computed(() =>
  filing.value?.supplements.find(
    (entry) => entry.supplementId === supplementRootId.value,
  ),
);
const staleSupplementEdit = computed(
  () =>
    supplementOpen.value &&
    supplementCorrection.value &&
    (selectedSupplement.value === undefined ||
      selectedSupplement.value.current.revision !== supplementRevision.value),
);
const canWrite = computed(
  () =>
    editable.value &&
    !damaged.value &&
    !denied.value &&
    !conflict.value &&
    pending.value.length === 0 &&
    !busy.value &&
    (editingId.value
      ? !!selected.value?.canCorrect
      : !!filing.value?.canRecordFeedback),
);
const validDate = (value: string) => {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};
const validText = (value: string, maximum: number) =>
  value.trim().length > 0 &&
  Array.from(value.trim()).length -
    (value.trim().match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/gu)?.length ?? 0) <=
    maximum;
const recorded = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
const ready = computed(
  () =>
    canWrite.value &&
    !staleFeedbackEdit.value &&
    validDate(feedbackOn.value) &&
    (courtCaseNo.value === '' || validText(courtCaseNo.value, 100)) &&
    validText(content.value, 2000) &&
    (!editingId.value ||
      (validText(correctionReason.value, 500) &&
        (selected.value?.current.feedbackOn !== (feedbackOn.value || null) ||
          selected.value?.current.courtCaseNo !== (courtCaseNo.value || null) ||
          selected.value?.current.content !== content.value))),
);
const supplementReady = computed(() => {
  if (
    !supplementOpen.value ||
    !supplementRootId.value ||
    !editable.value ||
    damaged.value ||
    denied.value ||
    conflict.value ||
    busy.value ||
    uploading.value ||
    pending.value.length
  )
    return false;
  if (staleSupplementEdit.value) return false;
  if (
    supplementCorrection.value
      ? !selectedSupplement.value?.canCorrect || supplementRevision.value < 1
      : !filing.value?.canSubmitSupplement || supplementRevision.value !== 0
  )
    return false;
  const versions = supplementFiles.value.map((file) =>
    file.contentVersionId.toLowerCase(),
  );
  const original = selectedSupplement.value?.current;
  const changed =
    !supplementCorrection.value ||
    original?.submittedOn !== (submittedOn.value || null) ||
    original?.note !== (supplementNote.value || null) ||
    original?.files.length !== versions.length ||
    (original?.files.some(
      (file, index) => file.contentVersionId.toLowerCase() !== versions[index],
    ) ??
      false);
  return (
    validDate(submittedOn.value) &&
    (supplementNote.value === '' || validText(supplementNote.value, 2000)) &&
    (!supplementCorrection.value || validText(supplementReason.value, 500)) &&
    versions.length >= 1 &&
    versions.length <= 10 &&
    new Set(versions).size === versions.length &&
    changed
  );
});
function resetForm() {
  editingId.value = null;
  feedbackRevision.value = null;
  feedbackOn.value = '';
  courtCaseNo.value = '';
  content.value = '';
  correctionReason.value = '';
}
function resetSupplement() {
  supplementFormGeneration += 1;
  supplementOpen.value = false;
  supplementRootId.value = null;
  supplementRevision.value = 0;
  supplementCorrection.value = false;
  submittedOn.value = '';
  supplementNote.value = '';
  supplementReason.value = '';
  supplementFiles.value = [];
  uploading.value = false;
  uploadMessage.value = '';
}
function abortAll() {
  for (const controller of [
    ...postControllers,
    ...readControllers,
    ...downloadControllers,
    ...uploadControllers,
  ])
    controller.abort();
  postControllers.clear();
  readControllers.clear();
  downloadControllers.clear();
  uploadControllers.clear();
}
function hydratePending() {
  const id = filingId.value;
  if (!id || !props.actorKey) {
    pending.value = [];
    damaged.value = false;
    return;
  }
  const recovered = findFollowupPending(props.actorKey, props.item.id, id);
  damaged.value = recovered === 'damaged';
  pending.value = recovered === 'damaged' ? [] : recovered;
}
watch(
  [
    () => props.actorKey,
    () => props.item.id,
    () => filingId.value,
    () => props.lawyer,
  ],
  () => {
    generation += 1;
    abortAll();
    busy.value = false;
    denied.value = false;
    conflict.value = false;
    error.value = '';
    success.value = '';
    resetForm();
    resetSupplement();
    hydratePending();
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => props.item.executionFilingFollowups,
  (next, previous) => {
    if (next !== previous) conflict.value = false;
  },
);
onDeactivated(() => {
  mounted = false;
  generation += 1;
  supplementFormGeneration += 1;
  if (uploading.value)
    uploadMessage.value = '离开页面时上传结果未确认，文件未加入本次补交。';
  abortAll();
  busy.value = false;
  uploading.value = false;
});
onActivated(() => {
  mounted = true;
  hydratePending();
});
onBeforeUnmount(() => {
  mounted = false;
  generation += 1;
  abortAll();
});
function edit(id: string) {
  const target = filing.value?.feedbacks.find(
    (entry) => entry.feedbackId === id,
  );
  if (
    !editable.value ||
    !target?.canCorrect ||
    pending.value.length ||
    damaged.value ||
    denied.value ||
    conflict.value
  )
    return;
  editingId.value = id;
  feedbackRevision.value = target.current.revision;
  feedbackOn.value = target.current.feedbackOn ?? '';
  courtCaseNo.value = target.current.courtCaseNo ?? '';
  content.value = target.current.content;
  correctionReason.value = '';
  error.value = '';
  success.value = '';
}
function beginSupplement(rootId?: string) {
  if (
    supplementOpen.value ||
    !editable.value ||
    damaged.value ||
    denied.value ||
    conflict.value ||
    pending.value.length ||
    busy.value ||
    uploading.value
  )
    return;
  const root = rootId
    ? filing.value?.supplements.find((entry) => entry.supplementId === rootId)
    : undefined;
  if (rootId ? !root?.canCorrect : !filing.value?.canSubmitSupplement) return;
  supplementFormGeneration += 1;
  supplementOpen.value = true;
  supplementCorrection.value = !!root;
  supplementRootId.value = root?.supplementId ?? globalThis.crypto.randomUUID();
  supplementRevision.value = root?.current.revision ?? 0;
  submittedOn.value = root?.current.submittedOn ?? '';
  supplementNote.value = root?.current.note ?? '';
  supplementReason.value = '';
  supplementFiles.value =
    root?.current.files.map((file) => ({ ...file })) ?? [];
  uploadMessage.value = '';
  error.value = '';
  success.value = '';
}
function cancelSupplement() {
  if (busy.value) return;
  for (const controller of uploadControllers) controller.abort();
  uploadControllers.clear();
  resetSupplement();
}
function removeSupplementFile(id: string) {
  if (busy.value || uploading.value) return;
  supplementFiles.value = supplementFiles.value.filter(
    (file) => file.contentVersionId !== id,
  );
}
function uploadTarget(): ExecutionFilingSupplementUploadTarget | null {
  if (!filingId.value || !supplementRootId.value) return null;
  return {
    filingId: filingId.value,
    supplementId: supplementRootId.value,
    expectedRevision: supplementRevision.value,
  };
}
async function uploadSupplement(event: globalThis.Event) {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const chosen = Array.from(input.files ?? []);
  input.value = '';
  const target = uploadTarget();
  if (
    !supplementOpen.value ||
    !target ||
    !editable.value ||
    staleSupplementEdit.value ||
    damaged.value ||
    denied.value ||
    conflict.value ||
    busy.value ||
    uploading.value ||
    pending.value.length
  )
    return;
  if (!chosen.length || chosen.length + supplementFiles.value.length > 10) {
    uploadMessage.value = '每次补交最多选择 10 个已确认文件。';
    return;
  }
  const allowed = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  if (
    chosen.some(
      (file) =>
        file.size <= 0 ||
        file.size > 50 * 1024 * 1024 ||
        allowed.get(file.name.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? '') !==
          file.type,
    )
  ) {
    uploadMessage.value = '仅支持单个不超过 50 MiB 的 PDF、JPG 或 PNG 文件。';
    return;
  }
  const snapshot = generation;
  const formSnapshot = supplementFormGeneration;
  const actor = props.actorKey;
  const caseId = props.item.id;
  const lawyer = !!props.lawyer;
  uploading.value = true;
  uploadMessage.value = '';
  try {
    for (const file of chosen) {
      const controller = new AbortController();
      uploadControllers.add(controller);
      try {
        const uploaded = lawyer
          ? await uploadLawyerCaseExecutionFilingSupplementFile(
              caseId,
              target,
              file,
              { signal: controller.signal },
            )
          : await uploadCaseExecutionFilingSupplementFile(
              caseId,
              target,
              file,
              { signal: controller.signal },
            );
        if (
          !isCurrent(snapshot, actor, caseId, target.filingId) ||
          formSnapshot !== supplementFormGeneration ||
          !supplementOpen.value ||
          supplementRootId.value !== target.supplementId ||
          supplementRevision.value !== target.expectedRevision
        )
          return;
        if (
          uploaded.executionSupplement.filingId.toLowerCase() !==
            target.filingId.toLowerCase() ||
          uploaded.executionSupplement.supplementId.toLowerCase() !==
            target.supplementId.toLowerCase() ||
          uploaded.executionSupplement.expectedRevision !==
            target.expectedRevision
        )
          throw new Error('上传锚点不一致');
        if (
          supplementFiles.value.some(
            (entry) =>
              entry.contentVersionId.toLowerCase() ===
              uploaded.contentVersionId.toLowerCase(),
          )
        )
          throw new Error('重复内容版本');
        supplementFiles.value = [
          ...supplementFiles.value,
          {
            materialId: uploaded.materialId,
            contentVersionId: uploaded.contentVersionId,
            originalFilename: uploaded.originalFilename,
            mimeType: uploaded.mimeType,
          },
        ];
      } finally {
        uploadControllers.delete(controller);
      }
    }
  } catch (failure) {
    if (
      !isCurrent(snapshot, actor, caseId, target.filingId) ||
      formSnapshot !== supplementFormGeneration ||
      !supplementOpen.value
    )
      return;
    if (
      failure instanceof ApiError &&
      (failure.status === 401 || failure.status === 403)
    ) {
      denied.value = true;
      uploadMessage.value = '当前身份或权限已变化，请刷新核对。';
      emit('refresh');
    } else if (failure instanceof ApiError && failure.status === 409) {
      conflict.value = true;
      uploadMessage.value = '补交锚点或版本已变化，请刷新核对。';
      emit('refresh');
    } else {
      uploadMessage.value = '本次上传未确认，未加入补交文件；可重新选文件。';
    }
  } finally {
    if (
      isCurrent(snapshot, actor, caseId, target.filingId) &&
      formSnapshot === supplementFormGeneration
    )
      uploading.value = false;
  }
}
function isCurrent(
  snapshot: number,
  actor: string,
  caseId: string,
  id: string,
) {
  return (
    mounted &&
    snapshot === generation &&
    actor === props.actorKey &&
    caseId === props.item.id &&
    id === filingId.value
  );
}
function matchesRead(
  result: CaseDetail | LawyerCaseDetail,
  request: FollowupPending,
) {
  const followups = result.executionFilingFollowups;
  if (
    !followups ||
    followups.filingId.toLowerCase() !== request.identity.filingId.toLowerCase()
  )
    return false;
  if (request.identity.command.endsWith('feedback')) {
    const root = followups.feedbacks.find(
      (entry) =>
        entry.feedbackId.toLowerCase() ===
        request.identity.rootId.toLowerCase(),
    );
    const body = request.body as
      RecordExecutionFilingFeedbackInput | CorrectExecutionFilingFeedbackInput;
    return (
      !!root &&
      root.history.some(
        (version) =>
          version.revision === body.expectedRevision + 1 &&
          version.feedbackOn === body.feedbackOn &&
          version.courtCaseNo === body.courtCaseNo &&
          version.content === body.content,
      )
    );
  }
  const root = followups.supplements.find(
    (entry) =>
      entry.supplementId.toLowerCase() ===
      request.identity.rootId.toLowerCase(),
  );
  const body = request.body as
    | SubmitExecutionFilingSupplementInput
    | CorrectExecutionFilingSupplementInput;
  return (
    !!root &&
    root.history.some(
      (version) =>
        version.revision === body.expectedRevision + 1 &&
        version.submittedOn === body.submittedOn &&
        version.note === body.note &&
        version.files.length === body.contentVersionIds.length &&
        version.files.every(
          (file, index) =>
            file.contentVersionId.toLowerCase() ===
            body.contentVersionIds[index]?.toLowerCase(),
        ),
    )
  );
}
async function send(request: FollowupPending) {
  if (busy.value || denied.value || conflict.value || damaged.value) return;
  const id = filingId.value;
  if (
    !id ||
    id.toLowerCase() !== request.identity.filingId.toLowerCase() ||
    props.actorKey !== request.identity.actor ||
    props.item.id !== request.identity.caseId
  )
    return;
  busy.value = true;
  error.value = '';
  success.value = '';
  const snapshot = generation;
  const post = new AbortController();
  postControllers.add(post);
  try {
    if (request.identity.command === 'record-feedback') {
      const body = request.body as RecordExecutionFilingFeedbackInput;
      if (props.lawyer)
        await recordLawyerCaseExecutionFilingFeedback(props.item.id, id, body, {
          signal: post.signal,
        });
      else
        await recordCaseExecutionFilingFeedback(props.item.id, id, body, {
          signal: post.signal,
        });
    } else if (request.identity.command === 'correct-feedback') {
      const body = request.body as CorrectExecutionFilingFeedbackInput;
      if (props.lawyer)
        await correctLawyerCaseExecutionFilingFeedback(
          props.item.id,
          id,
          request.identity.rootId,
          body,
          { signal: post.signal },
        );
      else
        await correctCaseExecutionFilingFeedback(
          props.item.id,
          id,
          request.identity.rootId,
          body,
          { signal: post.signal },
        );
    } else if (request.identity.command === 'submit-supplement') {
      const body = request.body as SubmitExecutionFilingSupplementInput;
      if (props.lawyer)
        await submitLawyerCaseExecutionFilingSupplement(
          props.item.id,
          id,
          body,
          { signal: post.signal },
        );
      else
        await submitCaseExecutionFilingSupplement(props.item.id, id, body, {
          signal: post.signal,
        });
    } else if (request.identity.command === 'correct-supplement') {
      const body = request.body as CorrectExecutionFilingSupplementInput;
      if (props.lawyer)
        await correctLawyerCaseExecutionFilingSupplement(
          props.item.id,
          id,
          request.identity.rootId,
          body,
          { signal: post.signal },
        );
      else
        await correctCaseExecutionFilingSupplement(
          props.item.id,
          id,
          request.identity.rootId,
          body,
          { signal: post.signal },
        );
    }
    if (
      !isCurrent(snapshot, request.identity.actor, request.identity.caseId, id)
    )
      return;
    const read = new AbortController();
    readControllers.add(read);
    try {
      const result = props.lawyer
        ? await getLawyerCase(props.item.id, { signal: read.signal })
        : await getCase(props.item.id, { signal: read.signal });
      if (
        !isCurrent(
          snapshot,
          request.identity.actor,
          request.identity.caseId,
          id,
        )
      )
        return;
      if (!matchesRead(result, request)) throw new Error('回读未找到本次记录');
      clearFollowupPending(request);
      hydratePending();
      resetForm();
      resetSupplement();
      success.value = '已登记并回读本次记录。';
      emit('refresh');
    } finally {
      readControllers.delete(read);
    }
  } catch (failure) {
    if (
      !isCurrent(snapshot, request.identity.actor, request.identity.caseId, id)
    )
      return;
    if (
      failure instanceof ApiError &&
      (failure.status === 401 || failure.status === 403)
    ) {
      error.value = '当前身份或权限已变化，请重新登录或刷新核对。';
      denied.value = true;
      generation += 1;
      abortAll();
      emit('refresh');
    } else if (
      failure instanceof ApiError &&
      (failure.status === 409 || failure.code === 'INVALID_STATE')
    ) {
      try {
        clearFollowupPending(request);
        hydratePending();
      } catch {
        damaged.value = true;
      }
      conflict.value = true;
      error.value = '记录版本或状态已变化。请刷新后核对，再填写新的请求。';
      emit('refresh');
    } else if (
      failure instanceof ApiError &&
      failure.status >= 400 &&
      failure.status < 500
    ) {
      try {
        clearFollowupPending(request);
        hydratePending();
      } catch {
        damaged.value = true;
      }
      error.value = '登记未完成，请检查内容后重试。';
    } else {
      error.value = '提交结果尚未确认。可刷新核对，或显式重试同一请求。';
    }
  } finally {
    postControllers.delete(post);
    if (
      isCurrent(snapshot, request.identity.actor, request.identity.caseId, id)
    )
      busy.value = false;
  }
}
function submit() {
  if (!ready.value || !filingId.value || !props.actorKey) return;
  const root = selected.value;
  const revision = feedbackRevision.value;
  if (root && revision === null) return;
  const body = root
    ? {
        idempotencyKey: globalThis.crypto.randomUUID(),
        expectedRevision: revision!,
        feedbackOn: feedbackOn.value || null,
        courtCaseNo: courtCaseNo.value || null,
        content: content.value,
        correctionReason: correctionReason.value,
      }
    : {
        idempotencyKey: globalThis.crypto.randomUUID(),
        expectedRevision: 0 as const,
        feedbackId: globalThis.crypto.randomUUID(),
        feedbackOn: feedbackOn.value || null,
        courtCaseNo: courtCaseNo.value || null,
        content: content.value,
      };
  const request: FollowupPending = {
    identity: {
      actor: props.actorKey,
      caseId: props.item.id,
      filingId: filingId.value,
      command: root ? 'correct-feedback' : 'record-feedback',
      rootId:
        root?.feedbackId ?? ('feedbackId' in body ? body.feedbackId! : ''),
    },
    body,
  };
  try {
    saveFollowupPending(request);
    hydratePending();
    void send(request);
  } catch {
    damaged.value = true;
    error.value = '原请求恢复记录无法安全保存，请先检查浏览器会话存储。';
  }
}
function submitSupplement() {
  if (
    !supplementReady.value ||
    !supplementRootId.value ||
    !filingId.value ||
    !props.actorKey
  )
    return;
  const fields = {
    idempotencyKey: globalThis.crypto.randomUUID(),
    submittedOn: submittedOn.value || null,
    note: supplementNote.value || null,
    contentVersionIds: supplementFiles.value.map(
      (file) => file.contentVersionId,
    ),
  };
  const body:
    | SubmitExecutionFilingSupplementInput
    | CorrectExecutionFilingSupplementInput = supplementCorrection.value
    ? {
        ...fields,
        expectedRevision: supplementRevision.value,
        correctionReason: supplementReason.value,
      }
    : { ...fields, expectedRevision: 0, supplementId: supplementRootId.value };
  const request: FollowupPending = {
    identity: {
      actor: props.actorKey,
      caseId: props.item.id,
      filingId: filingId.value,
      command: supplementCorrection.value
        ? 'correct-supplement'
        : 'submit-supplement',
      rootId: supplementRootId.value,
    },
    body,
  };
  try {
    saveFollowupPending(request);
    hydratePending();
    void send(request);
  } catch {
    damaged.value = true;
    error.value = '原请求恢复记录无法安全保存，请先检查浏览器会话存储。';
  }
}
async function download(materialId: string, versionId: string) {
  const controller = new AbortController();
  downloadControllers.add(controller);
  const snapshot = generation;
  try {
    await downloadMaterialVersion(materialId, versionId, controller.signal);
  } catch {
    if (mounted && snapshot === generation && !controller.signal.aborted)
      error.value = '文件下载失败。';
  } finally {
    downloadControllers.delete(controller);
  }
}
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="execution-filing-followup-panel"
  >
    <h2 class="form-section-title">执行申请后续资料</h2>
    <p v-if="item.executionFiling === null">
      本案没有本地执行申请记录。外部转入资料按原来源展示。
    </p>
    <p v-else-if="item.executionFilingFollowups === undefined">
      后续资料尚未提供，请刷新后核对。
    </p>
    <template v-else-if="filing">
      <p v-if="filing.feedbacks.length === 0">
        已提交执行申请，尚未登记法院反馈；这不表示法院已受理。
      </p>
      <p v-if="damaged" role="alert">
        恢复记录已损坏，已停止新写入；请核对原请求。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="success" role="status">{{ success }}</p>
      <div v-if="pending.length" data-test="followup-pending">
        <p>
          原请求待核对。请先刷新核对；仍未见记录时，使用相同内容和请求键重试。
        </p>
        <p v-for="request in pending" :key="request.identity.rootId">
          {{
            request.identity.command === 'record-feedback'
              ? '登记法院反馈'
              : request.identity.command === 'correct-feedback'
                ? '更正法院反馈'
                : '补交记录'
          }}
          <ElButton
            :disabled="busy || damaged || denied || conflict"
            @click="send(request)"
            >重试原请求</ElButton
          >
        </p>
      </div>
      <section
        v-if="editable && (filing.canRecordFeedback || selected?.canCorrect)"
        aria-label="登记或更正法院反馈"
        :inert="pending.length > 0 || busy"
      >
        <h3>{{ editingId ? '更正法院反馈' : '登记法院反馈' }}</h3>
        <p v-if="editingId">原值：{{ selected?.current.content }}</p>
        <p v-if="staleFeedbackEdit" role="alert">
          这条反馈已更新。请取消更正后重新打开。
        </p>
        <label
          >法院反馈日期（未知可留空）<input
            v-model="feedbackOn"
            class="text-input"
            type="date"
            data-test="followup-feedback-date"
        /></label>
        <label
          >法院案号（未知可留空）<input
            v-model="courtCaseNo"
            class="text-input"
            data-test="followup-court-no"
        /></label>
        <label
          >反馈内容<textarea
            v-model="content"
            class="text-input"
            data-test="followup-content"
          />
        </label>
        <label v-if="editingId"
          >更正原因<textarea
            v-model="correctionReason"
            class="text-input"
            data-test="followup-reason"
          />
        </label>
        <ElButton
          :disabled="!ready"
          data-test="followup-submit"
          @click="submit"
          >{{ editingId ? '确认更正' : '登记反馈' }}</ElButton
        >
        <ElButton v-if="editingId" :disabled="busy" @click="resetForm"
          >取消更正</ElButton
        >
      </section>
      <section aria-label="法院反馈记录">
        <h3>法院反馈</h3>
        <ol>
          <li v-for="root in filing.feedbacks" :key="root.feedbackId">
            <p>
              反馈日期：{{ root.current.feedbackOn ?? '未知' }}；法院案号：{{
                root.current.courtCaseNo ?? '未知'
              }}
            </p>
            <p>{{ root.current.content }}</p>
            <p>登记时间：{{ recorded(root.current.recordedAt) }}</p>
            <ElButton
              v-if="
                editable &&
                root.canCorrect &&
                !pending.length &&
                !damaged &&
                !denied &&
                !conflict
              "
              @click="edit(root.feedbackId)"
              >更正这条反馈</ElButton
            >
            <details>
              <summary>查看登记与更正历史（{{ root.history.length }}）</summary>
              <ol>
                <li v-for="version in root.history" :key="version.id">
                  第 {{ version.revision }} 版：{{ version.content }}；反馈日期
                  {{ version.feedbackOn ?? '未知' }}；法院案号
                  {{ version.courtCaseNo ?? '未知' }}；登记时间
                  {{ recorded(version.recordedAt) }}
                  <span
                    v-if="
                      'correctionReason' in version && version.correctionReason
                    "
                    >；更正原因：{{ version.correctionReason }}</span
                  >
                </li>
              </ol>
            </details>
          </li>
        </ol>
      </section>
      <section aria-label="补交材料记录">
        <h3>补交材料</h3>
        <ElButton
          v-if="
            editable &&
            filing.canSubmitSupplement &&
            !supplementOpen &&
            !pending.length &&
            !damaged &&
            !denied &&
            !conflict
          "
          data-test="supplement-open"
          @click="beginSupplement()"
          >登记补交材料</ElButton
        >
        <div
          v-if="supplementOpen && editable"
          :inert="pending.length > 0 || busy"
          data-test="supplement-form"
        >
          <h4>{{ supplementCorrection ? '更正补交记录' : '登记补交材料' }}</h4>
          <p v-if="supplementCorrection">
            原值：{{ selectedSupplement?.current.note ?? '无说明' }}；原文件
            {{ selectedSupplement?.current.files.length ?? 0 }} 个。
          </p>
          <p v-if="staleSupplementEdit" role="alert">
            这条补交记录已更新。请取消更正后重新打开。
          </p>
          <label
            >实际补交日期（未知可留空）<input
              v-model="submittedOn"
              type="date"
              class="text-input"
              data-test="supplement-date"
          /></label>
          <label
            >补交说明（可留空）<textarea
              v-model="supplementNote"
              class="text-input"
              data-test="supplement-note"
            />
          </label>
          <label v-if="supplementCorrection"
            >更正原因<textarea
              v-model="supplementReason"
              class="text-input"
              data-test="supplement-reason"
            />
          </label>
          <label
            >选择补交文件（PDF、JPG、PNG；每个不超过 50 MiB，最多 10 个）<input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              multiple
              :disabled="
                uploading ||
                busy ||
                damaged ||
                denied ||
                conflict ||
                staleSupplementEdit ||
                pending.length > 0
              "
              data-test="supplement-upload"
              @change="uploadSupplement"
          /></label>
          <p v-if="uploading" role="status">
            正在准备补交文件；文件确认后仍需单独登记。
          </p>
          <p v-if="uploadMessage" role="alert">{{ uploadMessage }}</p>
          <p v-if="supplementFiles.length === 0">尚无已确认的补交文件。</p>
          <ol>
            <li v-for="file in supplementFiles" :key="file.contentVersionId">
              <ElButton
                link
                class="followup-file-link"
                @click="download(file.materialId, file.contentVersionId)"
                >{{ file.originalFilename }}</ElButton
              >
              <ElButton
                :disabled="busy || uploading"
                @click="removeSupplementFile(file.contentVersionId)"
                >移除本次选择</ElButton
              >
            </li>
          </ol>
          <ElButton
            :disabled="!supplementReady"
            data-test="supplement-submit"
            @click="submitSupplement"
            >{{
              supplementCorrection ? '确认更正补交记录' : '确认登记补交'
            }}</ElButton
          >
          <ElButton
            :disabled="busy || pending.length > 0"
            data-test="supplement-cancel"
            @click="cancelSupplement"
            >取消</ElButton
          >
          <p>上传成功只准备文件。点击确认登记后才保存补交事实。</p>
        </div>
        <p v-if="filing.supplements.length === 0">
          尚未登记补交材料；无需先登记法院反馈。
        </p>
        <ol>
          <li v-for="root in filing.supplements" :key="root.supplementId">
            <ElButton
              v-if="
                editable &&
                root.canCorrect &&
                !supplementOpen &&
                !pending.length &&
                !damaged &&
                !denied &&
                !conflict
              "
              data-test="supplement-correct"
              @click="beginSupplement(root.supplementId)"
              >更正这条补交记录</ElButton
            >
            <p>
              补交日期：{{ root.current.submittedOn ?? '未知' }}；说明：{{
                root.current.note ?? '无'
              }}
            </p>
            <p>登记时间：{{ recorded(root.current.recordedAt) }}</p>
            <ul>
              <li
                v-for="file in root.current.files"
                :key="file.contentVersionId"
              >
                <ElButton
                  link
                  class="followup-file-link"
                  @click="download(file.materialId, file.contentVersionId)"
                  >{{ file.originalFilename }}</ElButton
                >
              </li>
            </ul>
            <details>
              <summary>查看补交与更正历史（{{ root.history.length }}）</summary>
              <ol>
                <li v-for="version in root.history" :key="version.id">
                  第 {{ version.revision }} 版：{{
                    version.submittedOn ?? '日期未知'
                  }}；{{ version.note ?? '无说明' }}；登记时间
                  {{ recorded(version.recordedAt) }}
                  <span
                    v-if="
                      'correctionReason' in version && version.correctionReason
                    "
                    >；更正原因：{{ version.correctionReason }}</span
                  >
                  <ul>
                    <li
                      v-for="file in version.files"
                      :key="file.contentVersionId"
                    >
                      <ElButton
                        link
                        class="followup-file-link"
                        @click="
                          download(file.materialId, file.contentVersionId)
                        "
                        >{{ file.originalFilename }}</ElButton
                      >
                    </li>
                  </ul>
                </li>
              </ol>
            </details>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style scoped>
.followup-file-link {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  height: auto;
  white-space: normal;
  text-align: left;
  vertical-align: top;
}

.followup-file-link :deep(span) {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
