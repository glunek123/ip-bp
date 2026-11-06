<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  correctLitigationRefund,
  getLitigationRefundRequest,
  getLitigationRefundWorkspace,
  recordLitigationRefund,
  type RefundCommandResult,
  type RefundCorrectionInput,
  type RefundRecordInput,
  type RefundRow,
  type RefundSourceOption,
  type RefundStatus,
  type RefundWorkspace,
} from '../../api/litigation-refunds';
import { ApiError } from '../../api/http';

type EditorMode = 'record' | 'correct';
type RefundDraft = {
  sourceKey: string;
  party: 'COURT' | 'DEFENDANT';
  amount: string;
  description: string;
  reason: string;
};
type PendingCommandContext = {
  actorKey: string;
  caseId: string;
  itemId: string;
  requestKey: string;
  busy: boolean;
  uncertain: boolean;
};
type PendingCommand =
  | (PendingCommandContext & {
      mode: 'record';
      body: RefundRecordInput;
    })
  | (PendingCommandContext & {
      mode: 'correct';
      body: RefundCorrectionInput;
    });
type StoredPendingCommand =
  | {
      actorKey: string;
      caseId: string;
      mode: 'record';
      itemId: string;
      requestKey: string;
      body: RefundRecordInput;
    }
  | {
      actorKey: string;
      caseId: string;
      mode: 'correct';
      itemId: string;
      requestKey: string;
      body: RefundCorrectionInput;
    };

const pendingCommands = new Map<string, PendingCommand>();
const pendingStoragePrefix = 'case-litigation-refund:v1:';
const sourceKey = (source: Pick<RefundSourceOption, 'type' | 'id'>) =>
  JSON.stringify([source.type, source.id]);
const commandIdentity = (actorKey: string, caseId: string) =>
  JSON.stringify([actorKey, caseId.toLowerCase()]);
const pendingStorageKey = (actorKey: string, caseId: string) =>
  `${pendingStoragePrefix}${encodeURIComponent(actorKey)}:${encodeURIComponent(caseId.toLowerCase())}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isRecordInput(value: unknown): value is RefundRecordInput {
  return isRecord(value) &&
    hasExactKeys(value, ['itemId', 'expectedInventoryVersionId', 'sourceType', 'sourceId', 'party', 'amount', 'description', 'reason', 'idempotencyKey']) &&
    isUuid(value.itemId) &&
    (value.expectedInventoryVersionId === null || typeof value.expectedInventoryVersionId === 'string') &&
    (value.sourceType === 'JUDGMENT' || value.sourceType === 'SECOND_INSTANCE_RESULT') &&
    typeof value.sourceId === 'string' &&
    (value.party === 'COURT' || value.party === 'DEFENDANT') &&
    (value.amount === null || (typeof value.amount === 'string' && /^(?:0|[1-9]\d*)\.\d{2}$/u.test(value.amount))) &&
    typeof value.description === 'string' && value.description.trim().length > 0 &&
    typeof value.reason === 'string' && value.reason.trim().length > 0 &&
    isUuid(value.idempotencyKey);
}

function isCorrectionInput(value: unknown): value is RefundCorrectionInput {
  return isRecord(value) &&
    hasExactKeys(value, ['expectedInventoryVersionId', 'sourceType', 'sourceId', 'party', 'amount', 'description', 'reason', 'idempotencyKey']) &&
    (value.expectedInventoryVersionId === null || typeof value.expectedInventoryVersionId === 'string') &&
    (value.sourceType === 'JUDGMENT' || value.sourceType === 'SECOND_INSTANCE_RESULT') &&
    typeof value.sourceId === 'string' &&
    (value.party === 'COURT' || value.party === 'DEFENDANT') &&
    (value.amount === null || (typeof value.amount === 'string' && /^(?:0|[1-9]\d*)\.\d{2}$/u.test(value.amount))) &&
    typeof value.description === 'string' && value.description.trim().length > 0 &&
    typeof value.reason === 'string' && value.reason.trim().length > 0 &&
    isUuid(value.idempotencyKey);
}

function isStoredPendingCommand(
  value: unknown,
  actorKey: string,
  caseId: string,
): value is StoredPendingCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['actorKey', 'caseId', 'mode', 'itemId', 'requestKey', 'body']) ||
    value.actorKey !== actorKey ||
    value.caseId !== caseId ||
    !isUuid(value.itemId) ||
    !isUuid(value.requestKey)
  )
    return false;
  if (value.mode === 'record')
    return isRecordInput(value.body) && value.body.itemId === value.itemId && value.body.idempotencyKey === value.requestKey;
  return value.mode === 'correct' && isCorrectionInput(value.body) && value.body.idempotencyKey === value.requestKey;
}

function readPendingCommand(
  actorKey: string,
  caseId: string,
): PendingCommand | 'damaged' | null {
  const key = commandIdentity(actorKey, caseId);
  const inMemory = pendingCommands.get(key);
  if (inMemory) return inMemory;
  try {
    const raw = globalThis.sessionStorage.getItem(pendingStorageKey(actorKey, caseId));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isStoredPendingCommand(value, actorKey, caseId)) return 'damaged';
    let restored: PendingCommand;
    if (value.mode === 'record')
      restored = reactive({ ...value, busy: false, uncertain: true });
    else restored = reactive({ ...value, busy: false, uncertain: true });
    pendingCommands.set(key, restored);
    return restored;
  } catch {
    return 'damaged';
  }
}

function persistPendingCommand(command: PendingCommand): void {
  const stored = {
    actorKey: command.actorKey,
    caseId: command.caseId,
    mode: command.mode,
    itemId: command.itemId,
    requestKey: command.requestKey,
    body: command.body,
  };
  globalThis.sessionStorage.setItem(
    pendingStorageKey(command.actorKey, command.caseId),
    JSON.stringify(stored),
  );
  pendingCommands.set(commandIdentity(command.actorKey, command.caseId), command);
}

function clearPendingCommand(command: PendingCommand): boolean {
  const key = commandIdentity(command.actorKey, command.caseId);
  if (pendingCommands.get(key)?.requestKey === command.requestKey)
    pendingCommands.delete(key);
  const storageKey = pendingStorageKey(command.actorKey, command.caseId);
  try {
    const raw = globalThis.sessionStorage.getItem(storageKey);
    if (raw === null) return true;
    const stored: unknown = JSON.parse(raw);
    if (!isStoredPendingCommand(stored, command.actorKey, command.caseId) || stored.requestKey !== command.requestKey)
      return false;
    globalThis.sessionStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

const props = defineProps<{
  actorKey: string;
  caseId: string;
  refreshKey: string;
}>();
const emit = defineEmits<{ refresh: [] }>();
const workspace = shallowRef<RefundWorkspace>();
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const actionNotice = ref('');
const editorMode = ref<EditorMode | null>(null);
const editingItemId = ref<string | null>(null);
const draft = ref<RefundDraft>(emptyDraft());
const saving = ref(false);
const pending = shallowRef<PendingCommand>();
const recoveryError = ref('');
const generation = ref(0);
const context = computed(() => commandIdentity(props.actorKey, props.caseId));
const canSave = computed(
  () =>
    editorMode.value !== null &&
    workspace.value?.canRecord === true &&
    recoveryError.value === '',
);

function emptyDraft(): RefundDraft {
  return {
    sourceKey: '',
    party: 'COURT',
    amount: '',
    description: '',
    reason: '',
  };
}

function isCurrent(token: number, actorKey: string, caseId: string): boolean {
  return (
    token === generation.value &&
    props.actorKey === actorKey &&
    props.caseId === caseId
  );
}

function sourceLabel(source: RefundSourceOption): string {
  return `${source.label}${source.courtNo ? ` · ${source.courtNo}` : ''}`;
}

function statusLabel(status: RefundStatus): string {
  const labels: Partial<Record<RefundStatus, string>> = {
    UNKNOWN: '待确认',
    PENDING: '待退',
    SUBMITTED: '已提交',
    RETURNED_UNSETTLED: '已退回未结算',
    SETTLED: '客户已收公司未收',
    RECEIVED: '公司已收',
    CONVERTED_TO_COST: '转成本',
  };
  return labels[status] ?? `未识别状态（${status}）`;
}

function formatAmount(raw: string): string | null | undefined {
  const amount = raw.trim();
  if (!amount) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(amount)) return undefined;
  const [whole = '0', fraction = ''] = amount.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function messageFor(error: unknown, operation: 'read' | 'write'): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '当前账号无权读取或登记本案诉讼退费。';
    if (error.status === 404) return '案件或退费事项已不存在，请刷新详情核对。';
    if (error.status === 409) return '案件退费清单已变化，请刷新后核对。';
  }
  return operation === 'read'
    ? '诉讼退费信息暂时无法读取，请重试。'
    : '保存结果暂未确认。请先核对原请求，不要新建另一笔。';
}

async function readWorkspace(): Promise<void> {
  const actorKey = props.actorKey;
  const caseId = props.caseId;
  const token = ++generation.value;
  loading.value = true;
  loadError.value = '';
  actionError.value = '';
  try {
    const result = await getLitigationRefundWorkspace(caseId);
    if (!isCurrent(token, actorKey, caseId)) return;
    workspace.value = result;
    const recovered = readPendingCommand(actorKey, caseId);
    pending.value = recovered === 'damaged' ? undefined : recovered ?? undefined;
    recoveryError.value = recovered === 'damaged'
      ? '原退费请求恢复记录无法读取。请保留当前会话核查；不会发送新请求。'
      : '';
  } catch (error) {
    if (isCurrent(token, actorKey, caseId)) loadError.value = messageFor(error, 'read');
  } finally {
    if (isCurrent(token, actorKey, caseId)) loading.value = false;
  }
}

watch(
  () => [props.actorKey, props.caseId, props.refreshKey],
  ([actorKey, caseId], prior) => {
    const identityChanged =
      !prior || actorKey !== prior[0] || caseId !== prior[1];
    workspace.value = undefined;
    pending.value = undefined;
    if (identityChanged) {
      saving.value = false;
      editorMode.value = null;
      editingItemId.value = null;
      draft.value = emptyDraft();
      actionError.value = '';
      actionNotice.value = '';
      recoveryError.value = '';
    }
    void readWorkspace();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  generation.value += 1;
});

function openRegistration(): void {
  if (!workspace.value?.canRecord || workspace.value.sources.length === 0) return;
  actionError.value = '';
  actionNotice.value = '';
  editingItemId.value = null;
  editorMode.value = 'record';
  draft.value = emptyDraft();
}

function openCorrection(item: RefundRow): void {
  if (!item.canRecord || !workspace.value?.canRecord) return;
  actionError.value = '';
  actionNotice.value = '';
  editorMode.value = 'correct';
  editingItemId.value = item.itemId;
  draft.value = {
    sourceKey:
      item.source && item.source.valid
        ? sourceKey(item.source)
        : '',
    party: item.party,
    amount: item.amount ?? '',
    description: item.description,
    reason: '',
  };
}

function selectedSource(): RefundSourceOption | undefined {
  return workspace.value?.sources.find(
    (source) => sourceKey(source) === draft.value.sourceKey,
  );
}

function validate(): string | null {
  const current = workspace.value;
  if (!current?.canRecord) return '当前账号没有本案退费登记权限。';
  if (!selectedSource()) return '请选择本案当前有效的一审判决或二审结果来源。';
  if (!draft.value.description.trim()) return '请填写退费事项说明。';
  if (draft.value.description.length > 1000)
    return '退费事项说明不能超过1000字。';
  if (!draft.value.reason.trim()) return '请填写登记或更正原因。';
  if (formatAmount(draft.value.amount) === undefined)
    return '金额请填写非负数字，最多保留两位小数；留空表示金额待定。';
  return null;
}

function isUnknown(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(error.code)
  );
}

async function deliver(result: RefundCommandResult, command: PendingCommand, token: number): Promise<void> {
  if (!isCurrent(token, command.actorKey, command.caseId)) return;
  const existing = workspace.value?.items.filter(
    (item) => item.itemId !== result.item.itemId,
  ) ?? [];
  const currentWorkspace = workspace.value;
  if (!currentWorkspace) return;
  workspace.value = {
    ...currentWorkspace,
    inventoryVersionId: result.inventoryVersionId,
    items: [result.item, ...existing],
  };
  if (!clearPendingCommand(command))
    recoveryError.value = '写回执已确认，但浏览器未能清除旧请求恢复记录。请刷新核对后再开始新登记。';
  pending.value = undefined;
  editorMode.value = null;
  editingItemId.value = null;
  actionError.value = '';
  actionNotice.value = command.mode === 'record' ? '退费事项已登记。' : '退费事项资料已更正，原记录保留。';
  emit('refresh');
  await readWorkspace();
}

async function send(command: PendingCommand, token: number): Promise<void> {
  if (command.busy) return;
  command.busy = true;
  saving.value = true;
  actionError.value = '';
  try {
    const result =
      command.mode === 'record'
        ? await recordLitigationRefund(command.caseId, command.body)
        : await correctLitigationRefund(
            command.caseId,
            command.itemId,
            command.body,
          );
    command.busy = false;
    if (isCurrent(token, command.actorKey, command.caseId)) {
      await deliver(result, command, token);
    } else {
      command.uncertain = true;
    }
  } catch (error) {
    command.busy = false;
    if (!isCurrent(token, command.actorKey, command.caseId)) {
      command.uncertain = isUnknown(error);
      return;
    }
    if (isUnknown(error)) {
      command.uncertain = true;
      actionError.value = '保存结果未确认。使用下方原请求核对，系统会先查回执，并只重放同一请求。';
      return;
    }
    if (command.uncertain) {
      actionError.value = '原请求仍未确认。系统保留了原请求内容和幂等键；请继续核对回执。';
      return;
    }
    clearPendingCommand(command);
    pending.value = undefined;
    saving.value = false;
    actionError.value = messageFor(error, 'write');
  } finally {
    if (isCurrent(token, command.actorKey, command.caseId)) saving.value = false;
  }
}

async function verifyAndRetry(): Promise<void> {
  const command = pending.value;
  if (!command || command.busy) return;
  const token = generation.value;
  command.busy = true;
  saving.value = true;
  actionError.value = '';
  try {
    const receipt = await getLitigationRefundRequest(command.caseId, command.requestKey);
    command.busy = false;
    if (isCurrent(token, command.actorKey, command.caseId))
      await deliver(receipt, command, token);
  } catch (error) {
    command.busy = false;
    if (!isCurrent(token, command.actorKey, command.caseId)) return;
    if (error instanceof ApiError && error.status === 404) {
      actionError.value = '尚无写回执，正在用原请求和原幂等键重试。';
      await send(command, token);
      return;
    }
    actionError.value = '回执暂时无法读取。原请求已保留，请稍后再核对。';
  } finally {
    if (isCurrent(token, command.actorKey, command.caseId)) saving.value = false;
  }
}

async function save(): Promise<void> {
  if (!canSave.value || saving.value || pending.value) return;
  const invalid = validate();
  if (invalid) {
    actionError.value = invalid;
    return;
  }
  const source = selectedSource();
  const current = workspace.value;
  if (!source || !current) return;
  const amount = formatAmount(draft.value.amount);
  if (amount === undefined) return;
  const itemId = editingItemId.value ?? globalThis.crypto.randomUUID();
  const requestKey = globalThis.crypto.randomUUID();
  const mode = editorMode.value;
  if (!mode) return;
  const common = {
    expectedInventoryVersionId: current.inventoryVersionId,
    sourceType: source.type,
    sourceId: source.id,
    party: draft.value.party,
    amount,
    description: draft.value.description.trim(),
    reason: draft.value.reason.trim(),
    idempotencyKey: requestKey,
  };
  const commandContext: PendingCommandContext = {
    actorKey: props.actorKey,
    caseId: props.caseId,
    itemId,
    requestKey,
    busy: false,
    uncertain: false,
  };
  const command: PendingCommand = reactive(
    mode === 'record'
      ? { ...commandContext, mode, body: { ...common, itemId } }
      : { ...commandContext, mode, body: common },
  );
  try {
    persistPendingCommand(command);
  } catch {
    actionError.value = '无法保存原请求恢复记录，未发送退费写入。请检查当前浏览器会话后重试。';
    return;
  }
  pending.value = command;
  await send(command, generation.value);
}

function cancel(): void {
  if (saving.value || pending.value) return;
  editorMode.value = null;
  editingItemId.value = null;
  draft.value = emptyDraft();
  actionError.value = '';
}
</script>

<template>
  <section class="demo-card demo-card--pad case-litigation-refund" data-test="case-litigation-refunds">
    <header class="case-litigation-refund__header">
      <div>
        <h2 class="form-section-title">诉讼退费登记</h2>
        <p class="field-help">按本案有效裁判来源登记应退事项。每笔事项单独保存；登记不会生成收付款记录。</p>
      </div>
      <ElButton
        v-if="workspace?.canRecord && workspace.sources.length > 0"
        data-test="refund-register-open"
        @click="openRegistration"
      >登记退费事项</ElButton>
    </header>

    <p v-if="loading" role="status">正在读取本案退费事项…</p>
    <p v-if="loadError" role="alert" class="submit-error">
      {{ loadError }}
      <ElButton text data-test="refund-refresh" @click="readWorkspace">重试</ElButton>
    </p>
    <template v-if="workspace && !loadError">
      <p v-if="workspace.sources.length === 0" class="field-help" data-test="refund-no-source">
        本案当前没有可登记的有效判决或二审结果来源。登记退费前，请先完成相应裁判结果登记。
      </p>
      <p v-else-if="!workspace.canRecord" class="field-help" data-test="refund-read-only">
        当前账号可以查看来源和已登记事项，但没有本案退费登记或更正权限。
      </p>
      <p v-if="actionNotice" role="status">{{ actionNotice }}</p>
      <p v-if="actionError" role="alert" class="submit-error">{{ actionError }}</p>
      <p v-if="recoveryError" role="alert" class="submit-error">{{ recoveryError }}</p>
      <div v-if="pending" class="case-litigation-refund__pending" data-test="refund-pending-request">
        <span>退费写入结果待确认；核对前不能开始另一项写入。</span>
        <ElButton :loading="saving" data-test="refund-request-recover" @click="verifyAndRetry">核对原请求</ElButton>
      </div>
      <form
        v-if="editorMode && !pending"
        class="case-litigation-refund__form"
        data-test="refund-editor"
        @submit.prevent="save"
      >
        <h3>{{ editorMode === 'record' ? '登记退费事项' : '更正已登记事项' }}</h3>
        <label>
          退费来源
          <select v-model="draft.sourceKey" required data-test="refund-source">
            <option value="" disabled>请选择本案有效裁判来源</option>
            <option v-for="source in workspace.sources" :key="sourceKey(source)" :value="sourceKey(source)">
              {{ sourceLabel(source) }}
            </option>
          </select>
        </label>
        <label>
          退费对象
          <select v-model="draft.party" data-test="refund-party">
            <option value="COURT">法院</option>
            <option value="DEFENDANT">被告</option>
          </select>
        </label>
        <label>
          应退金额
          <input v-model="draft.amount" inputmode="decimal" autocomplete="off" data-test="refund-amount" />
          <span class="field-help">留空表示金额待定；填写金额最多保留两位小数。</span>
        </label>
        <label>
          退费事项说明
          <textarea v-model="draft.description" maxlength="1000" rows="3" data-test="refund-description" />
        </label>
        <label>
          {{ editorMode === 'record' ? '登记原因' : '更正原因' }}
          <textarea v-model="draft.reason" rows="2" data-test="refund-reason" />
        </label>
        <div class="case-litigation-refund__actions">
          <ElButton :loading="saving" data-test="refund-save" @click="save">保存</ElButton>
          <ElButton :disabled="saving || !!pending" data-test="refund-cancel" @click="cancel">取消</ElButton>
        </div>
      </form>
      <ul v-if="workspace.items.length" class="case-litigation-refund__items">
        <li v-for="item in workspace.items" :key="item.itemId" :data-test="`refund-item-${item.itemId}`">
          <div class="case-litigation-refund__item-main">
            <strong>{{ item.description }}</strong>
            <span>{{ item.party === 'COURT' ? '法院' : '被告' }} · {{ statusLabel(item.status) }} · {{ item.amount === null ? '金额待定' : `${item.amount} 元` }}</span>
            <span v-if="item.source" :class="{ 'case-litigation-refund__invalid-source': !item.source.valid }">
              来源：{{ item.source.label }} · 审级 {{ item.source.trialRoundId }}<template v-if="!item.source.valid">（来源已失效）</template>
            </span>
            <span v-else>来源关联暂缺，不能据其他记录推断。</span>
            <span v-if="item.archived">归档时状态：{{ item.archiveStatus ? statusLabel(item.archiveStatus) : '未保存归档状态' }}；当前跟进不改变历史归档快照。</span>
            <span v-if="item.remark">跟进备注：{{ item.remark }}</span>
          </div>
          <ElButton
            v-if="item.canRecord && workspace.canRecord"
            text
            data-test="refund-correct"
            :data-item-id="item.itemId"
            :disabled="!!pending || saving || !!recoveryError"
            @click="openCorrection(item)"
          >更正登记资料</ElButton>
        </li>
      </ul>
      <p v-else-if="!loading" class="field-help" data-test="refund-empty">本案尚未登记退费事项。</p>
    </template>
  </section>
</template>

<style scoped>
.case-litigation-refund__header,
.case-litigation-refund__pending,
.case-litigation-refund__actions,
.case-litigation-refund__items > li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.case-litigation-refund__header { margin-bottom: 1rem; }
.case-litigation-refund__header p { margin: 0.35rem 0 0; }
.case-litigation-refund__form { display: grid; gap: 0.8rem; margin: 1rem 0; }
.case-litigation-refund__form label,
.case-litigation-refund__item-main { display: grid; gap: 0.35rem; }
.case-litigation-refund__form input,
.case-litigation-refund__form select,
.case-litigation-refund__form textarea { width: 100%; }
.case-litigation-refund__items { display: grid; gap: 0.8rem; padding: 0; list-style: none; }
.case-litigation-refund__items > li { padding-top: 0.8rem; border-top: 1px solid var(--el-border-color-lighter); }
.case-litigation-refund__invalid-source { color: var(--el-color-danger); }
.case-litigation-refund__pending { align-items: center; padding: 0.8rem; background: var(--el-fill-color-light); }
</style>
