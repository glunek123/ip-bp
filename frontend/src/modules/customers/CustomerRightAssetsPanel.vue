<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import { getCustomer } from '../../api/customers';
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
  type ReviseRightAssetInput,
  type WithdrawRightAssetInput,
  type WriteRightAssetInput,
} from '../../api/right-assets';

type PendingCommand =
  | {
      action: 'CREATE';
      customerId: string;
      body: WriteRightAssetInput;
      key: string;
    }
  | {
      action: 'REVISE';
      customerId: string;
      assetId: string;
      body: ReviseRightAssetInput;
      key: string;
    }
  | {
      action: 'WITHDRAW';
      customerId: string;
      assetId: string;
      body: WithdrawRightAssetInput;
      key: string;
    };

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
const conflictDetailReady = ref(false);
const withdrawOpen = ref(false);
const withdrawReason = ref('');
const writeDenied = ref(false);
const unknownOutcome = ref(false);
const draftOrigin = ref<{
  customerVersion: number;
  assetVersion: number;
  fields: RightAssetFields;
}>();
const confirmedCustomerVersion = ref<number>();
let request: AbortController | undefined;
let detailRequest: AbortController | undefined;
let customerRefreshRequest: AbortController | undefined;
let detailSequence = 0;
let pending: PendingCommand | undefined;
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
function isUnknownOutcome(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status >= 500 ||
    ['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(error.code)
  );
}
function effectiveCustomerVersion(): number {
  return Math.max(props.customerVersion, confirmedCustomerVersion.value ?? 0);
}
function invalidateDetailRequest(): void {
  detailRequest?.abort();
  detailSequence += 1;
}
const canReviseDraft = computed(
  () =>
    mode.value !== 'revise' ||
    !!(
      detail.value?.capabilities.revise &&
      !detail.value.withdrawn &&
      !writeDenied.value
    ),
);
const changedFacts = computed(() => {
  if (
    mode.value !== 'revise' ||
    !draftOrigin.value ||
    !detail.value ||
    detail.value.version === draftOrigin.value.assetVersion
  )
    return [];
  const labels: Partial<Record<keyof RightAssetFields, string>> = {
    type: '类型',
    name: '名称',
    number: '号码',
    category: '类别',
    holderId: '权利主体',
    ownerText: '权利人文字',
    trademarkClass: '商标分类',
    validFrom: '起始日期',
    validTo: '截止日期',
    validityMode: '期限模式',
  };
  return (Object.keys(labels) as (keyof RightAssetFields)[])
    .filter(
      (key) => draftOrigin.value!.fields[key] !== detail.value!.fields[key],
    )
    .map(
      (key) =>
        `${labels[key]}：原版 ${draftOrigin.value!.fields[key] ?? '未填写'}；最新版 ${detail.value!.fields[key] ?? '未填写'}；草稿 ${form.value[key] ?? '未填写'}`,
    );
});

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
async function openDetail(
  assetId: string,
  preserveDraft = false,
): Promise<boolean> {
  if (unknownOutcome.value) return false;
  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;
  const sequence = ++detailSequence;
  const ownGeneration = generation;
  errorMessage.value = '';
  try {
    const result = await getRightAsset(props.customerId, assetId, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      ownGeneration !== generation ||
      sequence !== detailSequence
    )
      return false;
    detail.value = result;
    if (!preserveDraft) {
      mode.value = 'closed';
      withdrawOpen.value = false;
      conflict.value = false;
      conflictDetailReady.value = false;
      confirmedCustomerVersion.value = undefined;
      draftOrigin.value = undefined;
    }
    return true;
  } catch (error) {
    if (
      controller.signal.aborted ||
      ownGeneration !== generation ||
      sequence !== detailSequence
    )
      return false;
    errorMessage.value = message(error);
    return false;
  }
}
function openCreate(): void {
  if (unknownOutcome.value || saving.value) return;
  invalidateDetailRequest();
  form.value = emptyFields();
  mode.value = 'create';
  detail.value = undefined;
  withdrawOpen.value = false;
  errorMessage.value = '';
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
  draftOrigin.value = undefined;
}
function openRevise(): void {
  if (!detail.value || unknownOutcome.value || saving.value) return;
  invalidateDetailRequest();
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
  draftOrigin.value = {
    customerVersion: props.customerVersion,
    assetVersion: detail.value.version,
    fields: { ...form.value },
  };
  errorMessage.value = '';
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
}
function openWithdraw(): void {
  if (
    !detail.value?.capabilities.withdraw ||
    detail.value.withdrawn ||
    unknownOutcome.value ||
    saving.value ||
    writeDenied.value
  )
    return;
  withdrawOpen.value = true;
  conflict.value = false;
}
function cancelDraft(): void {
  if (unknownOutcome.value || saving.value) return;
  invalidateDetailRequest();
  mode.value = 'closed';
  pending = undefined;
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
  draftOrigin.value = undefined;
}
async function refreshAfterConflict(): Promise<void> {
  if (unknownOutcome.value || saving.value) return;
  customerRefreshRequest?.abort();
  const controller = new AbortController();
  customerRefreshRequest = controller;
  const ownGeneration = generation;
  const customerId = props.customerId;
  pending = undefined;
  errorMessage.value = '正在刷新最新版本，草稿保持不变。';
  emit('refresh-requested', props.customerId);
  let currentCustomer;
  try {
    currentCustomer = await getCustomer(customerId, {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || ownGeneration !== generation) return;
    if (isCode(error, 'CUSTOMER_NOT_FOUND'))
      emit('customer-not-found', customerId);
    errorMessage.value = message(error);
    return;
  }
  if (
    controller.signal.aborted ||
    ownGeneration !== generation ||
    !conflict.value
  )
    return;
  await load();
  if (
    controller.signal.aborted ||
    ownGeneration !== generation ||
    !conflict.value
  )
    return;
  const refreshed = detail.value
    ? await openDetail(detail.value.assetId, true)
    : state.value === 'ready';
  if (
    !refreshed ||
    controller.signal.aborted ||
    ownGeneration !== generation ||
    !conflict.value
  )
    return;
  if (
    (mode.value === 'create' &&
      (!canCreate.value || !currentCustomer.capabilities.editRoutine)) ||
    (mode.value === 'revise' && !currentCustomer.capabilities.editRoutine) ||
    (mode.value === 'revise' && !canReviseDraft.value) ||
    (withdrawOpen.value && !detail.value?.capabilities.withdraw)
  ) {
    errorMessage.value = '最新资产已撤下或当前权限不足；原草稿保留供核对。';
    return;
  }
  confirmedCustomerVersion.value = currentCustomer.version;
  conflictDetailReady.value = true;
  conflict.value = false;
  errorMessage.value = '请核对最新事实与原草稿，再次明确提交。';
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
  if (
    saving.value ||
    conflict.value ||
    unknownOutcome.value ||
    mode.value === 'closed' ||
    !canReviseDraft.value ||
    writeDenied.value
  )
    return;
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
  const selected = detail.value;
  if (mode.value === 'revise' && !selected) return;
  pending =
    mode.value === 'create'
      ? {
          action: 'CREATE',
          customerId,
          body: {
            ...fields,
            expectedCustomerVersion: effectiveCustomerVersion(),
          },
          key: globalThis.crypto.randomUUID(),
        }
      : {
          action: 'REVISE',
          customerId,
          assetId: selected!.assetId,
          body: {
            ...fields,
            expectedCustomerVersion: effectiveCustomerVersion(),
            expectedAssetVersion: selected!.version,
          },
          key: globalThis.crypto.randomUUID(),
        };
  await runCommand(pending);
}
async function submitWithdraw(): Promise<void> {
  if (
    !detail.value ||
    !detail.value.capabilities.withdraw ||
    detail.value.withdrawn ||
    !withdrawOpen.value ||
    saving.value ||
    conflict.value ||
    unknownOutcome.value ||
    writeDenied.value
  )
    return;
  const reason = withdrawReason.value.trim();
  if (!reason) {
    errorMessage.value = '请填写撤下原因。';
    return;
  }
  const selected = detail.value;
  const customerId = props.customerId;
  pending = {
    action: 'WITHDRAW',
    customerId,
    assetId: selected.assetId,
    body: {
      expectedCustomerVersion: effectiveCustomerVersion(),
      expectedAssetVersion: selected.version,
      reason,
    },
    key: globalThis.crypto.randomUUID(),
  };
  await runCommand(pending);
}
async function retryUnknown(): Promise<void> {
  if (!unknownOutcome.value || !pending || saving.value) return;
  await runCommand(pending);
}
async function runCommand(command: PendingCommand): Promise<void> {
  const ownGeneration = generation;
  saving.value = true;
  errorMessage.value = '';
  let result;
  try {
    result =
      command.action === 'CREATE'
        ? await createRightAsset(command.customerId, command.body, command.key)
        : command.action === 'REVISE'
          ? await reviseRightAsset(
              command.customerId,
              command.assetId,
              command.body,
              command.key,
            )
          : await withdrawRightAsset(
              command.customerId,
              command.assetId,
              command.body,
              command.key,
            );
  } catch (error) {
    if (ownGeneration !== generation) return;
    if (isUnknownOutcome(error)) {
      unknownOutcome.value = true;
      errorMessage.value = '请求结果未知。请用原请求重试。';
      return;
    }
    pending = undefined;
    unknownOutcome.value = false;
    errorMessage.value = message(error);
    if (
      isCode(error, 'CUSTOMER_VERSION_CONFLICT') ||
      isCode(error, 'RIGHT_ASSET_VERSION_CONFLICT') ||
      isCode(error, 'IDEMPOTENCY_CONFLICT')
    ) {
      conflict.value = true;
      conflictDetailReady.value = false;
      confirmedCustomerVersion.value = undefined;
    }
    if (isCode(error, 'FORBIDDEN')) writeDenied.value = true;
    return;
  } finally {
    if (ownGeneration === generation) saving.value = false;
  }
  if (ownGeneration !== generation) return;
  pending = undefined;
  unknownOutcome.value = false;
  mode.value = 'closed';
  withdrawOpen.value = false;
  withdrawReason.value = '';
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
  draftOrigin.value = undefined;
  emit('version-updated', command.customerId, result.customerVersion);
  await load(command.action === 'CREATE' ? 1 : page.value);
  await openDetail(result.assetId);
}
watch(
  () => props.customerId,
  () => {
    generation += 1;
    request?.abort();
    invalidateDetailRequest();
    customerRefreshRequest?.abort();
    items.value = [];
    detail.value = undefined;
    mode.value = 'closed';
    pending = undefined;
    unknownOutcome.value = false;
    draftOrigin.value = undefined;
    conflict.value = false;
    conflictDetailReady.value = false;
    confirmedCustomerVersion.value = undefined;
    writeDenied.value = false;
    withdrawOpen.value = false;
    void load(1);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation += 1;
  request?.abort();
  invalidateDetailRequest();
  customerRefreshRequest?.abort();
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
        :disabled="saving || unknownOutcome"
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
          <button
            type="button"
            :disabled="saving || unknownOutcome"
            @click="openDetail(asset.assetId)"
          >
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
    <div v-if="unknownOutcome" role="group" aria-label="原请求待确认">
      <p>原请求可能已成功。重试将使用完全相同的内容和幂等键。</p>
      <button type="button" :disabled="saving" @click="retryUnknown">
        用原请求重试
      </button>
    </div>
    <button
      v-if="conflict && !unknownOutcome"
      type="button"
      @click="refreshAfterConflict"
    >
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
        :disabled="saving || unknownOutcome"
        @click="openRevise"
      >
        修订字段
      </button>
      <button
        v-if="detail.capabilities.withdraw && !writeDenied"
        type="button"
        :disabled="saving || unknownOutcome"
        @click="openWithdraw"
      >
        撤下资产
      </button>
      <div v-if="withdrawOpen">
        <label
          >撤下原因
          <input
            v-model="withdrawReason"
            maxlength="500"
            :disabled="saving || unknownOutcome"
        /></label>
        <button
          type="button"
          :disabled="
            saving ||
            conflict ||
            unknownOutcome ||
            !detail.capabilities.withdraw ||
            detail.withdrawn ||
            writeDenied
          "
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
      <p v-if="mode === 'revise' && draftOrigin && detail">
        草稿来源：客户第 {{ draftOrigin.customerVersion }} 版、资产第
        {{ draftOrigin.assetVersion }} 版；最新客户第
        {{ effectiveCustomerVersion() }} 版、最新资产第
        {{ detail.version }} 版。请核对差异后明确提交。
      </p>
      <ul v-if="changedFacts.length">
        <li v-for="fact in changedFacts" :key="fact">{{ fact }}</li>
      </ul>
      <p v-else-if="conflictDetailReady && mode === 'revise'">
        资产登记字段与草稿来源相同；客户版本变化仍需核对。
      </p>
      <fieldset :disabled="saving || unknownOutcome">
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
            <option
              v-for="holder in holders"
              :key="holder.id"
              :value="holder.id"
            >
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
      </fieldset>
      <button
        type="submit"
        :disabled="
          saving || conflict || unknownOutcome || !canReviseDraft || writeDenied
        "
      >
        {{ saving ? '保存中…' : '确认保存' }}
      </button>
      <button
        type="button"
        :disabled="saving || unknownOutcome"
        @click="cancelDraft"
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
