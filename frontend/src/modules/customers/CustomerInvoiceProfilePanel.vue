<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  createCustomerInvoiceProfile,
  getCustomerInvoiceProfile,
  listCustomerInvoiceVersions,
  reviseCustomerInvoiceProfile,
  type CustomerInvoiceProfileResponse,
  type CustomerInvoiceProfileVersion,
  type ReviseCustomerInvoiceProfileInput,
} from '../../api/customer-agreements-invoice';
import {
  clearPendingCustomerDocumentCommand,
  readPendingCustomerDocumentCommand,
  savePendingCustomerDocumentCommand,
  type PendingCustomerDocumentCommand,
} from './customer-agreements-invoice-pending';

type Actor = { userId: string; departmentId: string };
type InvoiceField = 'invoiceType' | 'invoiceSubject' | 'taxNo' | 'bank';
type InvoiceForm = Record<InvoiceField, string>;

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  canRead: boolean;
  canEdit: boolean;
  actor: Actor | null;
  actorKey: string;
  blockedByOtherMaintenance: boolean;
}>();

const emit = defineEmits<{
  'document-state': [
    kind: 'invoice',
    customerId: string,
    actorKey: string,
    field: 'unknown' | 'stale',
    value: boolean,
  ];
  'version-updated': [customerId: string, actorKey: string, version: number];
  'refresh-requested': [customerId: string, actorKey: string];
  unavailable: [customerId: string, actorKey: string];
}>();

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const data = ref<CustomerInvoiceProfileResponse>();
const form = ref<InvoiceForm>({
  invoiceType: '',
  invoiceSubject: '',
  taxNo: '',
  bank: '',
});
const editing = ref(false);
const submitting = ref(false);
const status = ref<'idle' | 'unknown' | 'conflict' | 'refresh-needed'>('idle');
const message = ref('');
const history = ref<CustomerInvoiceProfileVersion[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);
const historyLoading = ref(false);
const historyOpen = ref(false);
let generation = 0;
let pending: PendingCustomerDocumentCommand | undefined;

const hasProfile = computed(
  () => data.value?.profile !== null && data.value?.profile !== undefined,
);
const canSubmit = computed(
  () =>
    props.canRead &&
    props.canEdit &&
    data.value?.canEdit === true &&
    !props.blockedByOtherMaintenance &&
    !submitting.value &&
    status.value !== 'refresh-needed',
);
const canCancel = computed(
  () =>
    !props.blockedByOtherMaintenance &&
    status.value !== 'unknown' &&
    !submitting.value,
);
const versionCount = 20;

function identity() {
  if (!props.actor) return undefined;
  return {
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customerId,
    kind: 'invoice' as const,
  };
}

function current(
  requestGeneration: number,
  customerId: string,
  actorKey: string,
): boolean {
  return (
    requestGeneration === generation &&
    customerId === props.customerId &&
    actorKey === props.actorKey
  );
}

function setField(field: 'unknown' | 'stale', value: boolean): void {
  emit(
    'document-state',
    'invoice',
    props.customerId,
    props.actorKey,
    field,
    value,
  );
}

function clearSensitiveProjection(): void {
  data.value = undefined;
  history.value = [];
  historyTotal.value = 0;
  historyOpen.value = false;
  form.value = formFromVersion(undefined);
  editing.value = false;
  message.value = '';
}

function formFromVersion(version?: CustomerInvoiceProfileVersion): InvoiceForm {
  return {
    invoiceType: version?.invoiceType ?? '',
    invoiceSubject: version?.invoiceSubject ?? '',
    taxNo: version?.taxNo ?? '',
    bank: version?.bank ?? '',
  };
}

function restorePending(): void {
  pending = undefined;
  const key = identity();
  if (!key) return;
  pending = readPendingCustomerDocumentCommand(key);
  if (pending) {
    status.value = 'unknown';
    editing.value = true;
    form.value = formFromVersion(undefined);
    const body = pending.body;
    if ('bank' in body) {
      form.value = {
        invoiceType: body.invoiceType ?? '',
        invoiceSubject: body.invoiceSubject ?? '',
        taxNo: body.taxNo ?? '',
        bank: body.bank ?? '',
      };
    }
    message.value = '开票资料结果未知，原请求已保留。请按原请求重试。';
    setField('unknown', true);
  } else {
    status.value = 'idle';
    setField('unknown', false);
  }
}

async function refreshCurrent(): Promise<void> {
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  if (!props.canRead) {
    clearSensitiveProjection();
    state.value = 'ready';
    setField('stale', false);
    return;
  }
  state.value = 'loading';
  try {
    const latest = await getCustomerInvoiceProfile(customerId);
    if (!current(ownGeneration, customerId, actorKey)) return;
    data.value = latest;
    state.value = 'ready';
    if (!pending && status.value !== 'refresh-needed') {
      form.value = formFromVersion(latest.profile?.currentVersion);
      editing.value = false;
    }
    if (status.value === 'refresh-needed') {
      form.value = formFromVersion(latest.profile?.currentVersion);
      editing.value = false;
      status.value = 'idle';
      message.value = '开票资料当前版已刷新。';
    }
    setField('stale', false);
    emit('refresh-requested', customerId, actorKey);
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    state.value = 'failed';
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
      return;
    }
    setField('stale', true);
    message.value =
      status.value === 'refresh-needed'
        ? '开票资料已提交，但当前版本刷新失败。请只读刷新。'
        : '开票资料暂时无法刷新，请重试读取。';
  }
}

async function loadHistory(page = 1): Promise<void> {
  const profile = data.value?.profile;
  if (!props.canRead || !profile) return;
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  historyLoading.value = true;
  try {
    const result = await listCustomerInvoiceVersions(
      customerId,
      page,
      versionCount,
    );
    if (!current(ownGeneration, customerId, actorKey)) return;
    history.value = result.items;
    historyPage.value = result.page;
    historyTotal.value = result.total;
    historyOpen.value = true;
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
    } else {
      message.value = '开票历史暂时无法读取，请重试。';
    }
  } finally {
    if (current(ownGeneration, customerId, actorKey))
      historyLoading.value = false;
  }
}

function startEditing(): void {
  if (!canSubmit.value || pending || status.value === 'refresh-needed') return;
  form.value = formFromVersion(data.value?.profile?.currentVersion);
  editing.value = true;
  status.value = 'idle';
  message.value = '';
}

function cancelEditing(): void {
  if (!canCancel.value || pending) return;
  editing.value = false;
  form.value = formFromVersion(data.value?.profile?.currentVersion);
  message.value = '';
}

function makeBody(): PendingCustomerDocumentCommand['body'] {
  const latest = data.value;
  if (!latest) throw new Error('开票资料尚未读取');
  const version = latest.profile?.currentVersion;
  const fields = {
    invoiceType: form.value.invoiceType.trim() || null,
    invoiceSubject: form.value.invoiceSubject.trim() || null,
    taxNo: form.value.taxNo.trim() || null,
    bank: form.value.bank.trim() || null,
  };
  return version
    ? {
        expectedCustomerVersion: props.customerVersion,
        expectedInvoiceVersion: latest.profile!.version,
        ...fields,
      }
    : { expectedCustomerVersion: props.customerVersion, ...fields };
}

async function submit(): Promise<void> {
  if (submitting.value || !canSubmit.value) return;
  const key = identity();
  if (!key) return;
  let command = pending;
  if (!command) {
    try {
      command = {
        userId: props.actor!.userId,
        departmentId: props.actor!.departmentId,
        customerId: props.customerId,
        kind: 'invoice',
        action: hasProfile.value ? 'revise' : 'create',
        body: makeBody(),
        key: globalThis.crypto.randomUUID(),
      } as PendingCustomerDocumentCommand;
      savePendingCustomerDocumentCommand(command);
    } catch {
      message.value = '无法保存开票请求，请检查当前浏览器存储后重试。';
      return;
    }
    pending = command;
    status.value = 'unknown';
    setField('unknown', true);
  }
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  submitting.value = true;
  message.value = '';
  try {
    const result =
      command.action === 'create'
        ? await createCustomerInvoiceProfile(
            customerId,
            command.body as never,
            command.key,
          )
        : await reviseCustomerInvoiceProfile(
            customerId,
            command.body as ReviseCustomerInvoiceProfileInput,
            command.key,
          );
    if (!current(ownGeneration, customerId, actorKey)) return;
    clearPendingCustomerDocumentCommand(key);
    pending = undefined;
    setField('unknown', false);
    status.value = 'refresh-needed';
    editing.value = true;
    message.value = `本次提交已成功（第 ${result.profile?.currentVersion.version ?? '新'} 版），正在刷新当前资料。`;
    setField('stale', true);
    emit('version-updated', customerId, actorKey, result.customerVersion);
    await refreshCurrent();
  } catch (error) {
    if (!current(ownGeneration, customerId, actorKey)) return;
    if (error instanceof ApiError && error.status === 409) {
      clearPendingCustomerDocumentCommand(key);
      pending = undefined;
      setField('unknown', false);
      status.value = 'conflict';
      message.value =
        '开票资料已在其他位置更新。草稿已保留，请刷新当前版并核对后再提交。';
      await refreshCurrent();
      status.value = 'conflict';
      return;
    }
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearSensitiveProjection();
      message.value =
        '当前权限或客户范围已变化。原请求已保留；恢复权限后可按原请求重试。';
      status.value = 'unknown';
      setField('unknown', true);
      setField('stale', true);
      emit('unavailable', customerId, actorKey);
      return;
    }
    const isUnknown =
      !(error instanceof ApiError) ||
      error.status >= 500 ||
      ['BUSY', 'TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(
        error.code,
      );
    if (isUnknown) {
      status.value = 'unknown';
      message.value = '开票资料结果未知，原请求已保留。请按原请求重试。';
      setField('unknown', true);
    } else {
      clearPendingCustomerDocumentCommand(key);
      pending = undefined;
      status.value = 'idle';
      setField('unknown', false);
      message.value =
        error instanceof ApiError
          ? error.message
          : '开票资料未提交，请检查内容后重试。';
    }
  } finally {
    if (current(ownGeneration, customerId, actorKey)) submitting.value = false;
  }
}

watch(
  () => `${props.customerId}:${props.actorKey}:${props.canRead}`,
  () => {
    generation += 1;
    clearSensitiveProjection();
    restorePending();
    if (props.canRead) void refreshCurrent();
    else {
      state.value = 'ready';
      setField('stale', false);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  generation += 1;
});
</script>

<template>
  <section
    class="ledger-panel customer-document-card"
    data-test="invoice-profile-panel"
    aria-labelledby="invoice-profile-heading"
  >
    <header>
      <div>
        <span class="state-index">开票资料</span>
        <h2 id="invoice-profile-heading">客户开票信息</h2>
      </div>
      <button
        v-if="
          canRead &&
          state === 'ready' &&
          !editing &&
          status !== 'refresh-needed' &&
          data?.canEdit &&
          canEdit
        "
        type="button"
        data-test="invoice-edit"
        :disabled="blockedByOtherMaintenance"
        @click="startEditing"
      >
        {{ hasProfile ? '编辑新版本' : '建立开票档案' }}
      </button>
    </header>

    <p v-if="!canRead && status === 'unknown'" role="status">
      开票请求结果未知。读取权限恢复后可按原请求重试。
    </p>
    <p v-else-if="!canRead" data-test="invoice-no-read">
      当前没有开票资料读取权限。
    </p>
    <p v-else-if="state === 'loading'">正在读取开票资料。</p>
    <div v-else-if="state === 'failed'" role="alert">
      <p>{{ message }}</p>
      <button type="button" data-test="invoice-refresh" @click="refreshCurrent">
        只读刷新
      </button>
    </div>
    <template v-else-if="data">
      <template v-if="!editing">
        <p v-if="!data.profile" data-test="invoice-never-created">
          尚未建立开票档案。
        </p>
        <template v-else>
          <p data-test="invoice-version">
            当前第 {{ data.profile.version }} 版
          </p>
          <dl class="detail-grid">
            <div>
              <dt>发票类型</dt>
              <dd>{{ data.profile.currentVersion.invoiceType || '未知' }}</dd>
            </div>
            <div>
              <dt>发票抬头</dt>
              <dd>
                {{ data.profile.currentVersion.invoiceSubject || '未知' }}
              </dd>
            </div>
            <div>
              <dt>税号</dt>
              <dd>{{ data.profile.currentVersion.taxNo || '未知' }}</dd>
            </div>
            <div>
              <dt>开户银行及账号</dt>
              <dd class="invoice-bank">
                {{ data.profile.currentVersion.bank || '未知' }}
              </dd>
            </div>
          </dl>
          <p class="draft-note">资料记录不代表已实际开票。</p>
        </template>
      </template>

      <form
        v-else
        class="customer-document-form"
        data-test="invoice-form"
        @submit.prevent="submit"
      >
        <label
          >发票类型<input
            v-model="form.invoiceType"
            maxlength="100"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label
          >发票抬头<input
            v-model="form.invoiceSubject"
            maxlength="200"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label
          >税号<input
            v-model="form.taxNo"
            maxlength="100"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
        /></label>
        <label
          >开户银行及账号<textarea
            v-model="form.bank"
            maxlength="500"
            rows="3"
            :disabled="
              !canEdit || blockedByOtherMaintenance || status === 'unknown'
            "
          />
        </label>
        <p v-if="status === 'unknown'" role="alert">{{ message }}</p>
        <p v-else-if="status === 'conflict'" role="alert">{{ message }}</p>
        <p v-else-if="status === 'refresh-needed'" role="status">
          {{ message }}
        </p>
        <div class="customer-document-actions">
          <button
            type="submit"
            data-test="invoice-submit"
            :disabled="
              submitting ||
              status === 'refresh-needed' ||
              (!pending && !canSubmit)
            "
          >
            {{ status === 'unknown' ? '按原请求重试' : '保存新版本' }}
          </button>
          <button
            v-if="status === 'refresh-needed'"
            type="button"
            data-test="invoice-refresh-current"
            @click="refreshCurrent"
          >
            只读刷新
          </button>
          <button
            type="button"
            data-test="invoice-cancel"
            :disabled="
              !canCancel || status === 'unknown' || status === 'refresh-needed'
            "
            @click="cancelEditing"
          >
            取消编辑
          </button>
        </div>
      </form>

      <div v-if="data.profile && canRead" class="customer-document-history">
        <button
          type="button"
          data-test="invoice-history-toggle"
          :disabled="historyLoading"
          @click="historyOpen ? (historyOpen = false) : loadHistory(1)"
        >
          {{ historyOpen ? '收起版本历史' : '查看版本历史' }}
        </button>
        <section v-if="historyOpen" aria-label="开票资料版本历史">
          <ol>
            <li v-for="item in history" :key="item.id">
              <strong>第 {{ item.version }} 版</strong>
              <time>{{ item.recordedAt }} · {{ item.recordedByUserId }}</time>
              <p>
                发票类型：{{ item.invoiceType || '未知' }}；发票抬头：{{
                  item.invoiceSubject || '未知'
                }}；税号：{{ item.taxNo || '未知' }}；开户银行及账号：{{
                  item.bank || '未知'
                }}
              </p>
            </li>
          </ol>
          <div class="customer-document-actions">
            <button
              type="button"
              :disabled="historyLoading || historyPage <= 1"
              @click="loadHistory(historyPage - 1)"
            >
              上一页
            </button>
            <span>第 {{ historyPage }} 页，共 {{ historyTotal }} 条</span>
            <button
              type="button"
              :disabled="
                historyLoading || historyPage * versionCount >= historyTotal
              "
              @click="loadHistory(historyPage + 1)"
            >
              下一页
            </button>
          </div>
        </section>
      </div>
      <p v-if="message && !editing" role="status">{{ message }}</p>
    </template>
  </section>
</template>

<style scoped>
.customer-document-card {
  margin-top: var(--s-4);
  padding: var(--s-5);
}
.customer-document-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}
.customer-document-card h2 {
  margin: var(--s-1) 0 var(--s-3);
  font-size: 18px;
}
.customer-document-card button {
  min-height: 36px;
  padding: 0 var(--s-3);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  background: var(--color-surface-1);
  color: var(--color-ink);
  cursor: pointer;
  font: inherit;
}
.customer-document-card button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.customer-document-form {
  display: grid;
  gap: var(--s-3);
  max-width: 620px;
}
.customer-document-form label {
  display: grid;
  gap: var(--s-1);
}
.customer-document-form input,
.customer-document-form textarea {
  min-height: 38px;
  padding: var(--s-2);
  border: 1px solid var(--color-hairline);
  border-radius: 5px;
  font: inherit;
}
.customer-document-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
}
.customer-document-history {
  margin-top: var(--s-4);
}
.customer-document-history ol {
  padding-left: var(--s-5);
}
.customer-document-history li {
  margin: var(--s-3) 0;
}
.customer-document-history time {
  display: block;
  color: var(--color-ink-muted);
  font-size: 13px;
}
.invoice-bank {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
