<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import {
  listCustomerRightsHolders,
  type RightsHolderSummary,
} from '../../api/rights-holders';
import {
  createRightAsset,
  getRightAsset,
  listRightAssets,
  reviseRightAsset,
  withdrawRightAsset,
  type RightAssetDetail,
  type RightAssetFields,
  type RightAssetSummary,
  type RightAssetType,
} from '../../api/right-assets';

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  canEdit: boolean;
}>();
const emit = defineEmits<{
  'version-updated': [customerId: string, version: number];
  'refresh-requested': [customerId: string];
  'customer-not-found': [customerId: string];
}>();

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<RightAssetSummary[]>([]);
const total = ref(0);
const page = ref(1);
const canCreate = ref(false);
const holders = ref<RightsHolderSummary[]>([]);
const detail = ref<RightAssetDetail>();
const mode = ref<'closed' | 'create' | 'revise'>('closed');
const saving = ref(false);
const errorMessage = ref('');
const conflict = ref(false);
const withdrawOpen = ref(false);
const withdrawReason = ref('');
const writeDenied = ref(false);
let request: AbortController | undefined;
let pending: { signature: string; key: string } | undefined;
let generation = 0;

function emptyFields(): RightAssetFields {
  return {
    type: 'TRADEMARK',
    name: '',
    number: null,
    category: '',
    holderId: '',
    ownerText: null,
    trademarkClass: null,
    validFrom: null,
    validTo: null,
    validityMode: 'UNKNOWN',
  };
}
const form = ref<RightAssetFields>(emptyFields());
const numberText = computed({
  get: () => form.value.number ?? '',
  set: (value: string) => {
    form.value.number = value;
  },
});
const ownerText = computed({
  get: () => form.value.ownerText ?? '',
  set: (value: string) => {
    form.value.ownerText = value;
  },
});
const trademarkClass = computed({
  get: () => form.value.trademarkClass ?? '',
  set: (value: string) => {
    form.value.trademarkClass = value;
  },
});
const validFrom = computed({
  get: () => form.value.validFrom ?? '',
  set: (value: string) => {
    form.value.validFrom = value;
  },
});
const validTo = computed({
  get: () => form.value.validTo ?? '',
  set: (value: string) => {
    form.value.validTo = value;
  },
});

const typeLabels: Record<RightAssetType, string> = {
  TRADEMARK: '商标',
  PATENT: '专利',
  COPYRIGHT: '著作权',
  REPUTATION: '知名度证据',
  AUTHORIZATION: '授权书',
  OTHER: '其他',
};
function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function termLabel(fields: RightAssetFields): string {
  if (fields.validFrom && fields.validFrom > todayShanghai())
    return `登记起始日未到：${fields.validFrom}`;
  if (fields.validityMode === 'LONG_TERM')
    return '人工登记为长期，未核验法律效力';
  if (fields.validityMode === 'UNKNOWN') return '截止日期未知，未核验法律效力';
  if (fields.validTo && fields.validTo < todayShanghai())
    return `登记截止日已过：${fields.validTo}；未核验法律效力`;
  return `登记截止日：${fields.validTo ?? '未知'}；未核验法律效力`;
}
function message(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '请求结果未知。请保留当前内容并用原请求重试。';
}
function isCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

async function load(nextPage = page.value): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const ownGeneration = generation;
  state.value = 'loading';
  try {
    const [assets, allHolders] = await Promise.all([
      listRightAssets(props.customerId, nextPage, 20, {
        signal: controller.signal,
      }),
      loadHolders(props.customerId, controller.signal),
    ]);
    if (controller.signal.aborted || ownGeneration !== generation) return;
    items.value = assets.items;
    total.value = assets.total;
    page.value = assets.page;
    canCreate.value = assets.capabilities.create;
    holders.value = allHolders;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted || ownGeneration !== generation) return;
    if (isCode(error, 'CUSTOMER_NOT_FOUND'))
      emit('customer-not-found', props.customerId);
    state.value = 'failed';
  }
}
async function loadHolders(
  customerId: string,
  signal: AbortController['signal'],
): Promise<RightsHolderSummary[]> {
  const all: RightsHolderSummary[] = [];
  for (let index = 1; index <= 100; index += 1) {
    const result = await listCustomerRightsHolders(customerId, index, 100, {
      signal,
    });
    all.push(...result.items);
    if (all.length >= result.total) break;
  }
  return all;
}
async function openDetail(assetId: string): Promise<void> {
  const ownGeneration = generation;
  errorMessage.value = '';
  try {
    const result = await getRightAsset(props.customerId, assetId);
    if (ownGeneration !== generation) return;
    detail.value = result;
    mode.value = 'closed';
    withdrawOpen.value = false;
  } catch (error) {
    if (ownGeneration !== generation) return;
    errorMessage.value = message(error);
  }
}
function openCreate(): void {
  form.value = emptyFields();
  mode.value = 'create';
  detail.value = undefined;
  withdrawOpen.value = false;
  errorMessage.value = '';
  conflict.value = false;
  pending = undefined;
}
function openRevise(): void {
  if (!detail.value) return;
  const fields = detail.value.fields;
  form.value = {
    type: fields.type,
    name: fields.name,
    number: fields.number,
    category: fields.category,
    holderId: fields.holderId,
    ownerText: fields.ownerText,
    trademarkClass: fields.trademarkClass,
    validFrom: fields.validFrom,
    validTo: fields.validTo,
    validityMode: fields.validityMode,
  };
  mode.value = 'revise';
  errorMessage.value = '';
  conflict.value = false;
  pending = undefined;
}
function refreshAfterConflict(): void {
  pending = undefined;
  conflict.value = false;
  errorMessage.value = '请核对新版本与草稿，再次明确提交。';
  emit('refresh-requested', props.customerId);
  void load();
  if (detail.value) void openDetail(detail.value.assetId);
}
function stableKey(body: unknown): string {
  const signature = JSON.stringify(body);
  if (!pending || pending.signature !== signature)
    pending = { signature, key: globalThis.crypto.randomUUID() };
  return pending.key;
}
function normalizedForm(): RightAssetFields {
  return {
    ...form.value,
    name: form.value.name.trim(),
    category: form.value.category.trim(),
    number: form.value.number?.trim() || null,
    ownerText: form.value.ownerText?.trim() || null,
    trademarkClass: form.value.trademarkClass?.trim() || null,
    validFrom: form.value.validFrom || null,
    validTo:
      form.value.validityMode === 'FIXED' ? form.value.validTo || null : null,
  };
}
async function submit(): Promise<void> {
  if (saving.value || conflict.value || mode.value === 'closed') return;
  const fields = normalizedForm();
  if (
    !fields.name ||
    !fields.category ||
    !fields.holderId ||
    (fields.validityMode === 'FIXED' && !fields.validTo)
  ) {
    errorMessage.value = '请填写名称、类别、权利主体及固定期限的真实截止日期。';
    return;
  }
  const customerId = props.customerId;
  const ownGeneration = generation;
  const selected = detail.value;
  const body =
    mode.value === 'create'
      ? { ...fields, expectedCustomerVersion: props.customerVersion }
      : {
          ...fields,
          expectedCustomerVersion: props.customerVersion,
          expectedAssetVersion: selected?.version ?? 0,
        };
  const key = stableKey({
    mode: mode.value,
    customerId,
    assetId: selected?.assetId ?? null,
    body,
  });
  saving.value = true;
  errorMessage.value = '';
  try {
    const result =
      mode.value === 'create'
        ? await createRightAsset(customerId, body, key)
        : await reviseRightAsset(
            customerId,
            selected!.assetId,
            { ...body, expectedAssetVersion: selected!.version },
            key,
          );
    if (ownGeneration !== generation) return;
    pending = undefined;
    mode.value = 'closed';
    conflict.value = false;
    emit('version-updated', customerId, result.customerVersion);
    await load(1);
    await openDetail(result.assetId);
  } catch (error) {
    if (ownGeneration !== generation) return;
    errorMessage.value = message(error);
    if (
      isCode(error, 'CUSTOMER_VERSION_CONFLICT') ||
      isCode(error, 'RIGHT_ASSET_VERSION_CONFLICT') ||
      isCode(error, 'IDEMPOTENCY_CONFLICT')
    )
      conflict.value = true;
    if (isCode(error, 'FORBIDDEN')) writeDenied.value = true;
  } finally {
    if (ownGeneration === generation) saving.value = false;
  }
}
async function submitWithdraw(): Promise<void> {
  if (!detail.value || !withdrawOpen.value || saving.value || conflict.value)
    return;
  const reason = withdrawReason.value.trim();
  if (!reason) {
    errorMessage.value = '请填写撤下原因。';
    return;
  }
  const selected = detail.value;
  const customerId = props.customerId;
  const ownGeneration = generation;
  const body = {
    expectedCustomerVersion: props.customerVersion,
    expectedAssetVersion: selected.version,
    reason,
  };
  const key = stableKey({
    action: 'WITHDRAW',
    customerId,
    assetId: selected.assetId,
    body,
  });
  saving.value = true;
  errorMessage.value = '';
  try {
    const result = await withdrawRightAsset(
      customerId,
      selected.assetId,
      body,
      key,
    );
    if (ownGeneration !== generation) return;
    pending = undefined;
    withdrawOpen.value = false;
    withdrawReason.value = '';
    emit('version-updated', customerId, result.customerVersion);
    await load();
    await openDetail(selected.assetId);
  } catch (error) {
    if (ownGeneration !== generation) return;
    errorMessage.value = message(error);
    if (
      isCode(error, 'CUSTOMER_VERSION_CONFLICT') ||
      isCode(error, 'RIGHT_ASSET_VERSION_CONFLICT') ||
      isCode(error, 'IDEMPOTENCY_CONFLICT')
    )
      conflict.value = true;
    if (isCode(error, 'FORBIDDEN')) writeDenied.value = true;
  } finally {
    if (ownGeneration === generation) saving.value = false;
  }
}
watch(
  () => props.customerId,
  () => {
    generation += 1;
    request?.abort();
    items.value = [];
    detail.value = undefined;
    mode.value = 'closed';
    pending = undefined;
    conflict.value = false;
    writeDenied.value = false;
    withdrawOpen.value = false;
    void load(1);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation += 1;
  request?.abort();
});
</script>

<template>
  <div class="right-assets-panel">
    <header class="right-assets-panel__header">
      <div>
        <h2>权利资产</h2>
        <p>人工登记事实与历史版本；期限提示不代表法律效力核验。</p>
      </div>
      <button
        v-if="state === 'ready' && canEdit && canCreate && !writeDenied"
        type="button"
        @click="openCreate"
      >
        登记权利资产
      </button>
    </header>
    <p v-if="state === 'loading'">正在读取权利资产…</p>
    <div v-else-if="state === 'failed'">
      <p>权利资产读取失败。</p>
      <button type="button" @click="load()">重试读取</button>
    </div>
    <template v-else>
      <p v-if="items.length === 0">暂无人工登记的权利资产。</p>
      <ul v-else class="right-assets-panel__list">
        <li v-for="asset in items" :key="asset.assetId">
          <button type="button" @click="openDetail(asset.assetId)">
            {{ asset.fields.name }}
          </button>
          <span
            >{{ typeLabels[asset.fields.type] }} ·
            {{ asset.withdrawn ? '已撤下' : termLabel(asset.fields) }}</span
          >
        </li>
      </ul>
      <nav v-if="total > 20" aria-label="权利资产分页">
        <button type="button" :disabled="page <= 1" @click="load(page - 1)">
          上一页
        </button>
        <span>第 {{ page }} 页，共 {{ total }} 条</span>
        <button
          type="button"
          :disabled="page * 20 >= total"
          @click="load(page + 1)"
        >
          下一页
        </button>
      </nav>
    </template>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <button v-if="conflict" type="button" @click="refreshAfterConflict">
      明确刷新版本并核对草稿
    </button>
    <section
      v-if="detail"
      class="right-assets-panel__detail"
      aria-label="权利资产详情"
    >
      <h3>{{ detail.fields.name }} · 第 {{ detail.version }} 版</h3>
      <dl>
        <div>
          <dt>类别</dt>
          <dd>{{ detail.fields.category }}</dd>
        </div>
        <div>
          <dt>号码</dt>
          <dd>{{ detail.fields.number || '未知' }}</dd>
        </div>
        <div>
          <dt>权利主体</dt>
          <dd>
            {{
              holders.find((holder) => holder.id === detail?.fields.holderId)
                ?.name || detail.fields.holderId
            }}
          </dd>
        </div>
        <div>
          <dt>登记权利人文字</dt>
          <dd>{{ detail.fields.ownerText || '未填写' }}</dd>
        </div>
        <div>
          <dt>商标分类</dt>
          <dd>{{ detail.fields.trademarkClass || '未填写' }}</dd>
        </div>
        <div>
          <dt>期限</dt>
          <dd>{{ termLabel(detail.fields) }}</dd>
        </div>
      </dl>
      <button
        v-if="detail.capabilities.revise && canEdit && !writeDenied"
        type="button"
        @click="openRevise"
      >
        修订字段
      </button>
      <button
        v-if="detail.capabilities.withdraw && !writeDenied"
        type="button"
        @click="
          withdrawOpen = true;
          conflict = false;
          pending = undefined;
        "
      >
        撤下资产
      </button>
      <div v-if="withdrawOpen">
        <label
          >撤下原因 <input v-model="withdrawReason" maxlength="500"
        /></label>
        <button
          type="button"
          :disabled="saving || conflict"
          @click="submitWithdraw"
        >
          确认撤下
        </button>
      </div>
      <details>
        <summary>历史版本 · {{ detail.history.length }} 条</summary>
        <ol>
          <li v-for="version in detail.history" :key="version.id">
            第 {{ version.version }} 版 ·
            {{
              version.action === 'CREATE'
                ? '登记'
                : version.action === 'REVISE'
                  ? '修订'
                  : '撤下'
            }}
            · {{ version.name }} · {{ version.number || '号码未知' }} ·
            {{ termLabel(version) }}
            <span v-if="version.withdrawReason">
              · 原因：{{ version.withdrawReason }}</span
            >
          </li>
        </ol>
      </details>
    </section>
    <form
      v-if="mode !== 'closed'"
      class="right-assets-panel__form"
      @submit.prevent="submit"
    >
      <h3>{{ mode === 'create' ? '登记权利资产' : '修订权利资产' }}</h3>
      <label
        >资产类型
        <select v-model="form.type">
          <option
            v-for="(label, value) in typeLabels"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select></label
      >
      <label
        >资产名称 <input v-model="form.name" maxlength="200" required
      /></label>
      <label
        >资产号码
        <input v-model="numberText" maxlength="200" placeholder="未知可留空"
      /></label>
      <label
        >资产类别 <input v-model="form.category" maxlength="200" required
      /></label>
      <label
        >权利主体
        <select v-model="form.holderId" required>
          <option value="">请选择当前客户关联的主体</option>
          <option v-for="holder in holders" :key="holder.id" :value="holder.id">
            {{ holder.name }}
          </option>
        </select></label
      >
      <label
        >登记权利人文字
        <input v-model="ownerText" maxlength="200" placeholder="未确认可留空"
      /></label>
      <label
        >商标分类
        <input
          v-model="trademarkClass"
          maxlength="100"
          placeholder="不适用可留空"
      /></label>
      <label>起始日期 <input v-model="validFrom" type="date" /></label>
      <label
        >期限模式
        <select v-model="form.validityMode">
          <option value="UNKNOWN">未知</option>
          <option value="LONG_TERM">明确长期</option>
          <option value="FIXED">固定截止日期</option>
        </select></label
      >
      <label v-if="form.validityMode === 'FIXED'"
        >截止日期 <input v-model="validTo" type="date" required
      /></label>
      <p>只填写已知事实；不会根据文件名或空白日期推断有效状态。</p>
      <button type="submit" :disabled="saving || conflict">
        {{ saving ? '保存中…' : '确认保存' }}
      </button>
      <button
        type="button"
        @click="
          mode = 'closed';
          pending = undefined;
          conflict = false;
        "
      >
        取消
      </button>
    </form>
  </div>
</template>

<style scoped>
.right-assets-panel {
  padding: var(--s-5);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-surface-1);
}
.right-assets-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: var(--s-4);
}
.right-assets-panel__header h2 {
  margin: 0;
}
.right-assets-panel__header p {
  color: var(--color-ink-muted);
}
.right-assets-panel__list {
  padding-left: var(--s-5);
}
.right-assets-panel__list li {
  margin: var(--s-3) 0;
  display: flex;
  gap: var(--s-3);
  flex-wrap: wrap;
}
.right-assets-panel__detail,
.right-assets-panel__form {
  border-top: 1px solid var(--color-hairline);
  margin-top: var(--s-5);
  padding-top: var(--s-4);
}
.right-assets-panel__form {
  display: grid;
  gap: var(--s-3);
}
.right-assets-panel__form label {
  display: grid;
  gap: var(--s-1);
}
.right-assets-panel__form input,
.right-assets-panel__form select {
  max-width: 32rem;
  padding: var(--s-2);
}
button {
  margin-right: var(--s-2);
}
dt {
  color: var(--color-ink-muted);
}
dd {
  margin: 0 0 var(--s-2);
}
</style>
