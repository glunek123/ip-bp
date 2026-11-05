<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  createCaseSupplement,
  getCaseSupplementRequest,
  getCaseSupplementalWorkspace,
  type CaseSupplementKind,
  type CaseSupplementWorkspace,
  type CreateCaseSupplementInput,
} from '../../api/case-supplements';
import { ApiError } from '../../api/http';
import { uploadMaterialFile, type UploadedMaterial } from '../../api/materials';
import {
  clearPendingCaseSupplement,
  getPendingCaseSupplement,
  setPendingCaseSupplement,
} from './case-supplement-pending';

const props = defineProps<{
  caseId: string;
  initialKind?: CaseSupplementKind;
  workspace?: CaseSupplementWorkspace;
  actorKey: string;
}>();
const emit = defineEmits<{ changed: [] }>();
const kinds: Array<{ value: CaseSupplementKind; label: string }> = [
  { value: 'COURT_PREPAYMENT_NOTICE', label: '法院预缴通知金额' },
  { value: 'COURT_DISCLOSURE', label: '法院披露文本与附件' },
  { value: 'RECORD_RETRIEVAL_DOCUMENT', label: '调档实际文书' },
  { value: 'PRESERVATION_DOCUMENT', label: '保全实际文书' },
  { value: 'EXECUTION_FORMAL_ACCEPTANCE', label: '执行正式受理' },
  { value: 'REFUND_SOURCE_LINK', label: '退款清单来源关联' },
  { value: 'MANUAL_ANNOTATION', label: '人工附记 / 更正说明' },
];
const categoryByKind: Partial<Record<CaseSupplementKind, string>> = {
  COURT_DISCLOSURE: 'CASE_COURT_DISCLOSURE_ATTACHMENT',
  RECORD_RETRIEVAL_DOCUMENT: 'CASE_RECORD_RETRIEVAL_DOCUMENT',
  PRESERVATION_DOCUMENT: 'CASE_PRESERVATION_DOCUMENT',
  EXECUTION_FORMAL_ACCEPTANCE: 'EXECUTION_FORMAL_DOCUMENT',
};
const kind = ref<CaseSupplementKind>(
  props.initialKind ?? 'COURT_PREPAYMENT_NOTICE',
);
const loadedWorkspace = ref<CaseSupplementWorkspace | null>(null);
const workspace = computed(() => props.workspace ?? loadedWorkspace.value);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const amount = ref('');
const trialRoundId = ref('');
const text = ref('');
const eventDate = ref('');
const courtCaseNo = ref('');
const materialKey = ref('');
const uploadFile = ref<globalThis.File | null>(null);
const uploadedMaterial = ref<UploadedMaterial | null>(null);
const uploading = ref(false);
const refundKey = ref('');
const sourceKey = ref('');
const reason = ref('');
const correctingId = ref('');
const materials = computed(
  () =>
    workspace.value?.sources.materials.filter(
      (row) => row.category === categoryByKind[kind.value],
    ) ?? [],
);
const sourceChoices = computed(() => [
  ...(workspace.value?.sources.judgments.map((row) => ({
    value: `JUDGMENT:${row.id}`,
    label: `一审 · ${row.receivedOn} · ${row.trialRoundId}`,
  })) ?? []),
  ...(workspace.value?.sources.secondResults.map((row) => ({
    value: `SECOND_INSTANCE_RESULT:${row.id}`,
    label: `二审 · ${row.receivedOn} · ${row.trialRoundId}`,
  })) ?? []),
]);

async function load() {
  if (props.workspace) return;
  loading.value = true;
  error.value = '';
  try {
    loadedWorkspace.value = await getCaseSupplementalWorkspace(props.caseId);
  } catch {
    error.value = '补录资料加载失败，请重试。';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.caseId,
  () => {
    void load();
    void recoverPending();
  },
);
watch(
  () => props.actorKey,
  () => void recoverPending(),
);
watch(
  () => props.initialKind,
  (value) => {
    if (value) kind.value = value;
  },
);
watch(kind, () => {
  amount.value = '';
  trialRoundId.value = '';
  text.value = '';
  eventDate.value = '';
  courtCaseNo.value = '';
  materialKey.value = '';
  uploadFile.value = null;
  uploadedMaterial.value = null;
  refundKey.value = '';
  sourceKey.value = '';
  correctingId.value = '';
});
onMounted(() => {
  void load();
  void recoverPending();
});

async function recoverPending() {
  const actorKey = props.actorKey;
  const caseId = props.caseId;
  if (!actorKey) return;
  const pending = getPendingCaseSupplement(actorKey, caseId);
  if (pending === 'damaged') {
    error.value = '待确认补录请求记录损坏，请先核对服务器记录。';
    return;
  }
  if (!pending) return;
  try {
    await getCaseSupplementRequest(caseId, pending.input.idempotencyKey);
    clearPendingCaseSupplement(actorKey, caseId, pending.input.idempotencyKey);
    if (props.actorKey === actorKey && props.caseId === caseId) {
      if (!props.workspace) await load();
      emit('changed');
      error.value = '';
    }
  } catch {
    if (props.actorKey === actorKey && props.caseId === caseId)
      error.value = '上次补录结果尚未确认。再次提交将使用原请求编号和原内容。';
  }
}

async function correct(id: string) {
  const entry = workspace.value?.entries.find((row) => row.id === id);
  if (!entry) return;
  kind.value = entry.kind;
  await nextTick();
  correctingId.value = entry.id;
  amount.value = entry.amount ?? '';
  trialRoundId.value = entry.trialRoundId ?? '';
  text.value = entry.text ?? '';
  eventDate.value = entry.eventDate ?? '';
  courtCaseNo.value = entry.courtCaseNo ?? '';
  materialKey.value =
    entry.materialId && entry.contentVersionId
      ? `${entry.materialId}:${entry.contentVersionId}`
      : '';
  sourceKey.value =
    entry.sourceType && entry.sourceId
      ? `${entry.sourceType}:${entry.sourceId}`
      : '';
  refundKey.value =
    entry.inventoryVersionId && entry.inventoryItemId
      ? `${entry.inventoryVersionId}:${entry.inventoryItemId}`
      : '';
  reason.value = '';
}

async function upload() {
  const file = uploadFile.value;
  const category = categoryByKind[kind.value];
  if (!file || !category) return;
  if (!reason.value.trim()) {
    error.value = '请先填写补录原因，再上传文书。';
    return;
  }
  uploading.value = true;
  error.value = '';
  try {
    uploadedMaterial.value = await uploadMaterialFile({
      ownerType: 'CASE',
      ownerId: props.caseId,
      category: category as
        | 'CASE_PRESERVATION_DOCUMENT'
        | 'CASE_COURT_DISCLOSURE_ATTACHMENT'
        | 'CASE_RECORD_RETRIEVAL_DOCUMENT'
        | 'EXECUTION_FORMAL_DOCUMENT',
      purpose: category as
        | 'CASE_PRESERVATION_DOCUMENT'
        | 'CASE_COURT_DISCLOSURE_ATTACHMENT'
        | 'CASE_RECORD_RETRIEVAL_DOCUMENT'
        | 'EXECUTION_FORMAL_DOCUMENT',
      file,
      caseSupplementReason: reason.value.trim(),
    });
    materialKey.value = `${uploadedMaterial.value.materialId}:${uploadedMaterial.value.contentVersionId}`;
  } catch {
    error.value = '文书上传失败，请核对文件类型和本案权限。';
  } finally {
    uploading.value = false;
  }
}

async function save() {
  if (!workspace.value?.canEdit || saving.value) return;
  if (!props.actorKey) {
    error.value = '当前身份未就绪，无法安全提交补录。';
    return;
  }
  const caseId = props.caseId;
  const actorKey = props.actorKey;
  const pending = getPendingCaseSupplement(actorKey, caseId);
  if (pending === 'damaged') {
    error.value = '本案待确认请求记录损坏，请先核对服务器记录，避免重复提交。';
    return;
  }
  const input: CreateCaseSupplementInput = {
    kind: kind.value,
    reason: reason.value.trim(),
    idempotencyKey: globalThis.crypto.randomUUID(),
  };
  if (correctingId.value) input.expectedHeadId = correctingId.value;
  if (!pending && !input.reason) {
    error.value = '请填写本次补录原因。';
    return;
  }
  if (kind.value === 'COURT_PREPAYMENT_NOTICE') input.amount = amount.value;
  if (
    kind.value === 'COURT_PREPAYMENT_NOTICE' ||
    kind.value === 'COURT_DISCLOSURE'
  )
    input.trialRoundId = trialRoundId.value;
  if (kind.value === 'COURT_DISCLOSURE' || kind.value === 'MANUAL_ANNOTATION')
    if (text.value.trim()) input.text = text.value.trim();
  if (kind.value === 'EXECUTION_FORMAL_ACCEPTANCE') {
    if (eventDate.value) input.eventDate = eventDate.value;
    if (courtCaseNo.value.trim()) input.courtCaseNo = courtCaseNo.value.trim();
    input.sourceType = 'EXECUTION_FILING';
    input.sourceId = workspace.value.sources.executionFiling?.id;
  }
  if (kind.value === 'REFUND_SOURCE_LINK') {
    const source = sourceChoices.value.find(
      (row) => row.value === sourceKey.value,
    );
    const refund = workspace.value.sources.refundItems.find(
      (row) =>
        `${row.inventoryVersionId}:${row.inventoryItemId}` === refundKey.value,
    );
    if (source) [input.sourceType, input.sourceId] = source.value.split(':');
    input.inventoryVersionId = refund?.inventoryVersionId;
    input.inventoryItemId = refund?.inventoryItemId;
  }
  const material = materials.value.find(
    (row) => `${row.materialId}:${row.contentVersionId}` === materialKey.value,
  );
  if (material) {
    input.materialId = material.materialId;
    input.contentVersionId = material.contentVersionId ?? undefined;
  }
  if (
    uploadedMaterial.value &&
    materialKey.value ===
      `${uploadedMaterial.value.materialId}:${uploadedMaterial.value.contentVersionId}`
  ) {
    input.materialId = uploadedMaterial.value.materialId;
    input.contentVersionId = uploadedMaterial.value.contentVersionId;
  }
  const submitted = pending?.input ?? input;
  if (!pending) {
    try {
      setPendingCaseSupplement({ actorKey, caseId, input: submitted });
    } catch {
      error.value = '无法保存请求恢复记录，补录未发送。';
      return;
    }
  }
  saving.value = true;
  error.value = '';
  try {
    await createCaseSupplement(caseId, submitted);
    clearPendingCaseSupplement(actorKey, caseId, submitted.idempotencyKey);
    if (props.caseId === caseId && props.actorKey === actorKey) {
      reason.value = '';
      correctingId.value = '';
      uploadedMaterial.value = null;
      if (!props.workspace) await load();
      emit('changed');
    }
  } catch (cause) {
    if (
      cause instanceof ApiError &&
      cause.status >= 400 &&
      cause.status < 500 &&
      cause.status !== 408 &&
      cause.status !== 429
    ) {
      clearPendingCaseSupplement(actorKey, caseId, submitted.idempotencyKey);
      error.value = cause.message;
    } else {
      try {
        await getCaseSupplementRequest(caseId, submitted.idempotencyKey);
        clearPendingCaseSupplement(actorKey, caseId, submitted.idempotencyKey);
        if (props.caseId === caseId && props.actorKey === actorKey) {
          if (!props.workspace) await load();
          emit('changed');
          error.value = '';
        }
      } catch {
        error.value =
          '提交结果尚未确认。再次点击将使用原请求编号和原内容恢复，不会创建新请求。';
      }
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="case-supplements">
    <header>
      <h3>案件资料补录</h3>
      <p>记录来源、记录人和原因。原业务节点与归档结果保持原样。</p>
    </header>
    <p v-if="loading">正在读取补录资料…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="workspace">
      <label
        >资料类型
        <select v-model="kind">
          <option
            v-for="choice in kinds"
            :key="choice.value"
            :value="choice.value"
          >
            {{ choice.label }}
          </option>
        </select></label
      >
      <template v-if="workspace.canEdit">
        <label
          v-if="
            kind === 'COURT_PREPAYMENT_NOTICE' || kind === 'COURT_DISCLOSURE'
          "
          >本案审理轮次
          <select v-model="trialRoundId">
            <option value="">请选择</option>
            <option
              v-for="round in workspace.sources.trialRounds"
              :key="round.id"
              :value="round.id"
            >
              第 {{ round.sequence }} 轮
            </option>
          </select></label
        >
        <label v-if="kind === 'COURT_PREPAYMENT_NOTICE'"
          >通知金额（元）
          <input v-model="amount" inputmode="decimal" placeholder="0.00"
        /></label>
        <label
          v-if="kind === 'COURT_DISCLOSURE' || kind === 'MANUAL_ANNOTATION'"
          >{{ kind === 'COURT_DISCLOSURE' ? '法院披露文本' : '附记内容' }}
          <textarea v-model="text" rows="4" />
        </label>
        <template v-if="kind === 'EXECUTION_FORMAL_ACCEPTANCE'">
          <p v-if="!workspace.sources.executionFiling">
            本案尚无执行立案申请来源，不能登记正式受理。
          </p>
          <label
            >法院正式受理日期 <input v-model="eventDate" type="date"
          /></label>
          <label
            >执行案号 <input v-model="courtCaseNo" maxlength="100"
          /></label>
        </template>
        <template v-if="categoryByKind[kind]">
          <label
            >已上传的对应文书
            <select v-model="materialKey">
              <option value="">
                {{ kind === 'COURT_DISCLOSURE' ? '无附件' : '请选择文书' }}
              </option>
              <option
                v-for="row in materials"
                :key="`${row.materialId}:${row.contentVersionId}`"
                :value="`${row.materialId}:${row.contentVersionId}`"
              >
                {{ row.filename }} · {{ row.linked ? '已关联' : '待关联' }}
              </option>
            </select></label
          >
          <label
            >上传新文书
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              @change="
                uploadFile =
                  ($event.target as HTMLInputElement).files?.[0] ?? null
              "
          /></label>
          <button
            type="button"
            :disabled="uploading || !uploadFile"
            @click="upload"
          >
            {{ uploading ? '上传中…' : '上传文书' }}
          </button>
          <p v-if="uploadedMaterial">
            已上传
            {{
              uploadedMaterial.originalFilename
            }}。请提交补录记录，才能形成案内来源关联。
          </p>
          <ul v-if="materials.some((row) => !row.linked)">
            <li
              v-for="row in materials.filter((item) => !item.linked)"
              :key="`${row.materialId}:${row.contentVersionId}`"
            >
              待关联上传：{{ row.filename }} · 原因
              {{ row.uploadReason ?? '旧记录未知' }} · 上传人
              {{ row.uploadedByUserId ?? '未知' }} · 上传准备时间
              {{ row.uploadedAt ?? '未知' }}
            </li>
          </ul>
        </template>
        <template v-if="kind === 'REFUND_SOURCE_LINK'">
          <label
            >本案判决 / 二审来源
            <select v-model="sourceKey">
              <option value="">请选择</option>
              <option
                v-for="row in sourceChoices"
                :key="row.value"
                :value="row.value"
              >
                {{ row.label }}
              </option>
            </select></label
          >
          <label
            >当前退款清单项目
            <select v-model="refundKey">
              <option value="">请选择</option>
              <option
                v-for="row in workspace.sources.refundItems"
                :key="`${row.inventoryVersionId}:${row.inventoryItemId}`"
                :value="`${row.inventoryVersionId}:${row.inventoryItemId}`"
              >
                {{ row.description }}
              </option>
            </select></label
          >
        </template>
        <label
          >{{ correctingId ? '更正原因' : '补录原因' }}
          <textarea v-model="reason" rows="2" maxlength="1000" />
        </label>
        <button type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : correctingId ? '追加更正' : '追加记录' }}
        </button>
      </template>
      <h4>本案追加记录</h4>
      <p v-if="!workspace.entries.length">尚无补录记录；旧数据保持未知。</p>
      <ol v-else>
        <li v-for="entry in workspace.entries" :key="entry.id">
          <strong>{{
            kinds.find((choice) => choice.value === entry.kind)?.label
          }}</strong>
          · {{ entry.recordedAt }} · 记录人
          {{
            workspace.recorders.find((row) => row.id === entry.recordedByUserId)
              ?.displayName ?? '姓名未记录'
          }}（{{ entry.recordedByUserId }}）<br />{{
            entry.text ?? entry.amount ?? entry.courtCaseNo ?? '已关联资料'
          }}<br />原因：{{ entry.reason
          }}<span v-if="entry.priorEntryId">
            · 更正自 {{ entry.priorEntryId }}</span
          ><br /><button
            v-if="
              workspace.canEdit &&
              !workspace.entries.some((row) => row.priorEntryId === entry.id)
            "
            type="button"
            @click="correct(entry.id)"
          >
            更正此记录
          </button>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.case-supplements {
  display: grid;
  gap: 12px;
}
header h3,
h4,
p {
  margin: 0;
}
label {
  display: grid;
  gap: 4px;
}
input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--border-color, #d8dce5);
  border-radius: 6px;
  padding: 8px;
  background: var(--el-bg-color, #fff);
  color: inherit;
}
button {
  justify-self: start;
  padding: 8px 16px;
}
ol {
  margin: 0;
  padding-left: 22px;
}
li {
  margin-bottom: 10px;
}
</style>
