<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { ApiError } from '../../api/http';
import {
  createNotaryMatter,
  createNotaryOffice,
  listNotaryOffices,
  type CreateNotaryMatterInput,
  type NotaryOffice,
} from '../../api/notary';
import {
  applyLeadWithdrawal,
  decideLeadNoEvidence,
  getLead,
  pushLead,
  type LeadDetail,
} from '../../api/leads';
import { getCustomer } from '../../api/customers';
import { getCustomerRightsHolder } from '../../api/rights-holders';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
} from '../../api/materials';
import { leadStatusLabels } from './lead-options';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const lead = ref<LeadDetail>();
const customerName = ref('');
const holderName = ref('');
const screenshots = ref<
  Array<{ materialId: string; versionId: string; filename: string }>
>([]);
const downloadError = ref('');
const pushing = ref(false);
const pushError = ref('');
const pushSuccess = ref('');
const withdrawalReason = ref('');
const withdrawalSubmitting = ref(false);
const withdrawalError = ref('');
const withdrawalSuccess = ref('');
const withdrawalRetryLocked = ref(false);
const evidenceReason = ref('');
const evidenceSubmitting = ref(false);
const evidenceError = ref('');
const evidenceSuccess = ref('');
const evidenceRetryLocked = ref(false);
const notaryOffices = ref<NotaryOffice[]>([]);
const notaryOfficeCanCreate = ref(false);
const notaryOfficeLoadError = ref('');
const notaryOfficeName = ref('');
const notaryOfficeCreating = ref(false);
const notaryOfficeError = ref('');
const selectedProductIds = ref<string[]>([]);
const selectedContentVersionIds = ref<string[]>([]);
const notaryOfficeId = ref('');
const batchPurpose = ref('');
const transferSubmitting = ref(false);
const transferRetryLocked = ref(false);
const transferError = ref('');
const transferSuccess = ref('');
let transferKey: string | undefined;
let frozenTransferInput: CreateNotaryMatterInput | undefined;
const normalizedEvidenceReason = computed(() => evidenceReason.value.trim());
const evidenceReasonLength = computed(
  () => [...normalizedEvidenceReason.value].length,
);
const evidenceReasonTooLong = computed(() => evidenceReasonLength.value > 5000);
const normalizedWithdrawalReason = computed(() =>
  withdrawalReason.value.trim(),
);
const withdrawalReasonLength = computed(
  () => [...normalizedWithdrawalReason.value].length,
);
const withdrawalReasonTooLong = computed(
  () => withdrawalReasonLength.value > 5000,
);
let pushKey: string | undefined;
let withdrawalKey: string | undefined;
let frozenWithdrawalReason: string | undefined;
let frozenWithdrawalVersion: number | undefined;
let evidenceKey: string | undefined;
let frozenEvidenceReason: string | undefined;
let frozenEvidenceVersion: number | undefined;
let request: AbortController | undefined;
const labels: Record<string, string> = {
  CIVIL: '民事',
  CRIMINAL: '刑事',
  ADMINISTRATIVE: '行政',
  INVESTIGATION: '调查',
  NOTARIZATION: '公证',
  HEARING_REPRESENTATION: '代开庭',
  TRADEMARK: '商标权',
  SOFTWARE_COPYRIGHT: '软件著作权',
  ART_COPYRIGHT: '美术作品著作权',
  AUDIOVISUAL_COPYRIGHT: '视听作品著作权',
  TEXT_COPYRIGHT: '文字作品著作权',
  INVENTION_PATENT: '发明专利权',
  DESIGN_PATENT: '外观设计专利权',
  UTILITY_MODEL_PATENT: '实用新型专利权',
  UNFAIR_COMPETITION: '不正当竞争',
  NETWORK_DISSEMINATION: '信息网络传播权',
  PORTRAIT_RIGHT: '肖像权',
  OTHER: '其他',
  ONLINE: '线上',
  OFFLINE: '线下',
  TAOBAO: '淘宝',
  TMALL: '天猫',
  PINDUODUO: '拼多多',
  JD: '京东',
  DOUYIN: '抖音',
  ALIBABA_1688: '1688',
  XIAOHONGSHU: '小红书',
  KUAISHOU: '快手',
  XIANYU: '闲鱼',
  WECHAT: '微信',
  MEITUAN: '美团',
  DIANPING: '大众点评',
  MAP: '地图',
};
function label(value: string): string {
  return labels[value] ?? value;
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const current = await getLead(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    lead.value = current;
    const [customer, holder, materials, officeResponse] = await Promise.all([
      getCustomer(current.customerId, { signal: controller.signal }).catch(
        () => null,
      ),
      getCustomerRightsHolder(current.customerId, current.rightsHolderId, {
        signal: controller.signal,
      }).catch(() => null),
      listOwnerMaterials('LEAD', current.id, {
        signal: controller.signal,
      }).catch(() => null),
      current.capabilities.transferToNotary ||
      current.capabilities.createEvidenceBatch
        ? listNotaryOffices({ signal: controller.signal }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (controller.signal.aborted) return;
    notaryOffices.value = officeResponse?.items ?? [];
    notaryOfficeCanCreate.value = officeResponse?.capabilities.create ?? false;
    notaryOfficeLoadError.value =
      (current.capabilities.transferToNotary ||
        current.capabilities.createEvidenceBatch) &&
      officeResponse === null
        ? '公证处列表暂时无法读取，请刷新后重试'
        : '';
    if (
      !notaryOfficeId.value ||
      !notaryOffices.value.some((office) => office.id === notaryOfficeId.value)
    ) {
      notaryOfficeId.value =
        notaryOffices.value.length === 1 ? notaryOffices.value[0]!.id : '';
    }
    selectedProductIds.value = selectedProductIds.value.filter((id) =>
      current.products.some((product) => product.id === id),
    );
    customerName.value = customer?.name ?? current.customerId;
    holderName.value = holder?.name ?? current.rightsHolderId;
    const available = new Map(
      (materials?.items ?? []).flatMap((material) => {
        if (!material.currentVersionId || material.status !== 'ACTIVE')
          return [];
        const version = material.contentVersions.find(
          (candidate) => candidate.id === material.currentVersionId,
        );
        return version
          ? [
              [
                version.id,
                {
                  materialId: material.id,
                  versionId: version.id,
                  filename: version.originalFilename,
                },
              ] as const,
            ]
          : [];
      }),
    );
    screenshots.value = current.leadScreenshotContentVersionIds.flatMap(
      (versionId) => {
        const screenshot = available.get(versionId);
        return screenshot === undefined ? [] : [screenshot];
      },
    );
    selectedContentVersionIds.value = selectedContentVersionIds.value.filter(
      (id) =>
        screenshots.value.some((screenshot) => screenshot.versionId === id),
    );
    if (!controller.signal.aborted) state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}
async function downloadScreenshot(
  materialId: string,
  versionId: string,
): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId);
  } catch {
    downloadError.value = '截图下载失败，请稍后重试';
  }
}
function makePushKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lead-push-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function pushErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '推送失败，请稍后重试';
  const messages: Partial<Record<string, string>> = {
    CLIENT_ACCOUNT_UNAVAILABLE: '客户账号不可用，请先创建或启用企业客户账号',
    CUSTOMER_NOT_ADMITTED: '客户当前不是已准入状态，无法推送',
    LEAD_PRODUCTS_REQUIRED: '线索至少需要一项有效商品才能推送',
    VERSION_CONFLICT: '线索已被其他操作更新，请刷新后重试',
    INVALID_STATE: '线索当前状态不允许推送',
    ACTION_FORBIDDEN: '当前账号无权推送此线索',
    IDEMPOTENCY_CONFLICT: '本次推送请求与已提交请求冲突，请刷新后重试',
    NETWORK_ERROR: '推送结果未知，请重试；系统不会重复推进',
  };
  return messages[error.code] ?? error.message;
}
function withdrawalErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return '申请结果暂时未知，可使用同一原因和请求安全重试';
  if (error.code === 'VERSION_CONFLICT' || error.code === 'INVALID_STATE') {
    withdrawalKey = undefined;
    frozenWithdrawalReason = undefined;
    frozenWithdrawalVersion = undefined;
    withdrawalRetryLocked.value = false;
    return '线索状态已变化，请刷新查看最新结果';
  }
  if (error.code === 'ACTION_FORBIDDEN' || error.code === 'RESOURCE_NOT_FOUND')
    return '当前账号无权申请撤回此线索，请刷新页面或联系管理员';
  if (error.code === 'IDEMPOTENCY_CONFLICT') {
    withdrawalKey = undefined;
    frozenWithdrawalReason = undefined;
    frozenWithdrawalVersion = undefined;
    frozenWithdrawalVersion = undefined;
    withdrawalRetryLocked.value = false;
    return '本次申请请求冲突，请核对线索状态后重新填写';
  }
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')
    return '申请结果暂时未知；原因和请求键已锁定，可安全重试或刷新查看结果';
  return '申请撤回失败，请稍后重试';
}
function makeWithdrawalKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lead-withdraw-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function makeEvidenceKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lead-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function makeTransferKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lead-notary-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
const transferAvailable = computed(
  () =>
    lead.value !== undefined &&
    (lead.value.capabilities.transferToNotary ||
      lead.value.capabilities.createEvidenceBatch),
);
const normalizedBatchPurpose = computed(() => batchPurpose.value.trim());
const transferFormValid = computed(
  () =>
    selectedProductIds.value.length > 0 &&
    notaryOfficeId.value.length > 0 &&
    normalizedBatchPurpose.value.length > 0 &&
    [...normalizedBatchPurpose.value].length <= 500,
);
function toggleSelection(
  values: string[],
  value: string,
  selected: boolean,
): string[] {
  if (selected) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}
function transferErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return '移交结果暂时未知，请使用相同内容安全重试';
  if (
    error.code === 'OFFICE_UNAVAILABLE' ||
    error.code === 'INVALID_SELECTION' ||
    error.code === 'CUSTOMER_NOT_ADMITTED'
  ) {
    transferKey = undefined;
    frozenTransferInput = undefined;
    transferRetryLocked.value = false;
    if (error.code === 'OFFICE_UNAVAILABLE')
      return '所选公证处已不可用，请刷新后重新选择';
    if (error.code === 'INVALID_SELECTION')
      return '所选商品或截图已变化，请刷新后重新选择';
    return '客户当前状态不允许移交，请联系管理员确认客户准入状态';
  }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'INVALID_STATE') {
    transferKey = undefined;
    frozenTransferInput = undefined;
    transferRetryLocked.value = false;
    return '线索状态已变化，请刷新后查看最新结果';
  }
  if (error.code === 'ACTION_FORBIDDEN' || error.code === 'RESOURCE_NOT_FOUND')
    return '当前账号无权移交此线索，或线索当前不可访问';
  if (error.code === 'IDEMPOTENCY_CONFLICT') {
    transferKey = undefined;
    frozenTransferInput = undefined;
    transferRetryLocked.value = false;
    return '本次移交请求与先前请求不同，请刷新线索后重新操作';
  }
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')
    return '提交结果暂时未知；已锁定本次选择和请求键，可安全重试或刷新查看';
  return '移交公证失败；已保留本次选择，可安全重试';
}
async function addNotaryOffice(): Promise<void> {
  if (!notaryOfficeCanCreate.value || notaryOfficeCreating.value) return;
  const name = notaryOfficeName.value.trim();
  if (!name) return;
  notaryOfficeCreating.value = true;
  notaryOfficeError.value = '';
  try {
    const office = await createNotaryOffice(name);
    notaryOffices.value = [...notaryOffices.value, office];
    notaryOfficeId.value = office.id;
    notaryOfficeName.value = '';
  } catch (error) {
    notaryOfficeError.value =
      error instanceof ApiError && error.code === 'ACTION_FORBIDDEN'
        ? '当前账号没有维护公证处的权限'
        : '新增公证处失败，请检查名称后重试';
  } finally {
    notaryOfficeCreating.value = false;
  }
}
async function transferToNotary(): Promise<void> {
  if (!lead.value || !transferAvailable.value || transferSubmitting.value)
    return;
  if (!transferRetryLocked.value && !transferFormValid.value) return;
  const input = frozenTransferInput ?? {
    selectedProductIds: [...selectedProductIds.value],
    selectedContentVersionIds: [...selectedContentVersionIds.value],
    notaryOfficeId: notaryOfficeId.value,
    evidenceMode: 'ONLINE_PURCHASE' as const,
    batchPurpose: normalizedBatchPurpose.value,
    expectedVersion: lead.value.version,
    ...(lead.value.capabilities.createEvidenceBatch
      ? { createNewBatch: true }
      : {}),
  };
  const isNewBatch = input.createNewBatch === true;
  const confirmed = globalThis.window.confirm(
    isNewBatch
      ? `确认新建${lead.value.notaryMatters.length + 1}号取证批次？系统会保留已有批次，并将所选商品、截图和用途作为本批次记录。`
      : `确认将线索 ${lead.value.businessNo} 移交给“${notaryOffices.value.find((item) => item.id === input.notaryOfficeId)?.name ?? '所选公证处'}”？提交后线索将转为“已移交公证”，原线索只读；商品、截图版本和用途会作为取证批次快照保存。`,
  );
  if (!confirmed) return;
  frozenTransferInput ??= input;
  selectedProductIds.value = [...frozenTransferInput.selectedProductIds];
  selectedContentVersionIds.value = [
    ...frozenTransferInput.selectedContentVersionIds,
  ];
  notaryOfficeId.value = frozenTransferInput.notaryOfficeId;
  batchPurpose.value = frozenTransferInput.batchPurpose;
  transferRetryLocked.value = true;
  transferKey ??= makeTransferKey();
  transferError.value = '';
  transferSuccess.value = '';
  transferSubmitting.value = true;
  try {
    await createNotaryMatter(lead.value.id, frozenTransferInput, transferKey);
    transferKey = undefined;
    frozenTransferInput = undefined;
    transferRetryLocked.value = false;
    transferSuccess.value = isNewBatch
      ? '新取证批次已创建，原有批次记录保持不变'
      : '已移交公证，线索已转为只读';
    batchPurpose.value = '';
    selectedProductIds.value = [];
    selectedContentVersionIds.value = [];
    await load();
  } catch (error) {
    transferError.value = transferErrorMessage(error);
  } finally {
    transferSubmitting.value = false;
  }
}
async function archiveNoEvidence(): Promise<void> {
  if (
    !lead.value ||
    !lead.value.capabilities.evidenceDecide ||
    lead.value.status !== 'WAITING_EVIDENCE_DECISION' ||
    evidenceSubmitting.value
  )
    return;
  const reason = evidenceRetryLocked.value
    ? frozenEvidenceReason
    : normalizedEvidenceReason.value;
  if (!reason || [...reason].length > 5000) return;
  if (
    !globalThis.window.confirm(
      '提交后线索将立即归档，运营决定和原因将作为历史记录保留，当前页面不能撤回。确定不取证并归档吗？',
    )
  )
    return;
  frozenEvidenceReason ??= reason;
  frozenEvidenceVersion ??= lead.value.version;
  evidenceReason.value = frozenEvidenceReason;
  evidenceRetryLocked.value = true;
  evidenceKey ??= makeEvidenceKey();
  evidenceError.value = '';
  evidenceSuccess.value = '';
  evidenceSubmitting.value = true;
  try {
    await decideLeadNoEvidence(
      lead.value.id,
      frozenEvidenceReason,
      frozenEvidenceVersion,
      evidenceKey,
    );
    evidenceKey = undefined;
    frozenEvidenceReason = undefined;
    frozenEvidenceVersion = undefined;
    evidenceRetryLocked.value = false;
    evidenceSuccess.value = '已判定不取证，线索已归档';
    await load();
  } catch (error) {
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'VERSION_CONFLICT' || code === 'INVALID_STATE') {
      evidenceKey = undefined;
      frozenEvidenceReason = undefined;
      frozenEvidenceVersion = undefined;
      evidenceRetryLocked.value = false;
      evidenceError.value = '线索状态已变化，请刷新查看最新结果';
    } else if (code === 'ACTION_FORBIDDEN' || code === 'RESOURCE_NOT_FOUND') {
      evidenceError.value = '当前账号无权处理此线索，请刷新登录状态后重试';
    } else if (code === 'IDEMPOTENCY_CONFLICT') {
      evidenceKey = undefined;
      frozenEvidenceReason = undefined;
      frozenEvidenceVersion = undefined;
      evidenceRetryLocked.value = false;
      evidenceError.value = '本次操作未执行，请重新确认后重试';
    } else if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
      evidenceError.value =
        '提交结果暂时未知；原因和请求键已锁定，可安全重试或刷新查看结果';
    } else {
      evidenceError.value =
        '不取证归档失败；原因和请求键已锁定，可安全重试或刷新查看结果';
    }
  } finally {
    evidenceSubmitting.value = false;
  }
}
async function applyWithdrawal(): Promise<void> {
  if (
    !lead.value ||
    !lead.value.capabilities.withdrawApply ||
    lead.value.status !== 'ARCHIVED' ||
    withdrawalSubmitting.value
  )
    return;
  const reason = withdrawalRetryLocked.value
    ? frozenWithdrawalReason
    : normalizedWithdrawalReason.value;
  if (!reason || [...reason].length > 5000) return;
  if (
    !globalThis.window.confirm(
      '提交申请后线索仍保持归档，只有原客户企业确认后才会回到待审核。确定申请撤回归档吗？',
    )
  )
    return;
  frozenWithdrawalReason ??= reason;
  frozenWithdrawalVersion ??= lead.value.version;
  withdrawalReason.value = frozenWithdrawalReason;
  withdrawalRetryLocked.value = true;
  withdrawalKey ??= makeWithdrawalKey();
  withdrawalError.value = '';
  withdrawalSuccess.value = '';
  withdrawalSubmitting.value = true;
  try {
    await applyLeadWithdrawal(
      lead.value.id,
      frozenWithdrawalReason,
      frozenWithdrawalVersion,
      withdrawalKey,
    );
    withdrawalKey = undefined;
    frozenWithdrawalReason = undefined;
    frozenWithdrawalVersion = undefined;
    withdrawalRetryLocked.value = false;
    withdrawalSuccess.value =
      '已提交撤回申请；线索仍保持归档，等待原客户企业确认';
    await load();
  } catch (error) {
    withdrawalError.value = withdrawalErrorMessage(error);
  } finally {
    withdrawalSubmitting.value = false;
  }
}
async function push(): Promise<void> {
  if (!lead.value || !lead.value.capabilities.push || pushing.value) return;
  if (
    !globalThis.window.confirm(
      `确认将线索 ${lead.value.businessNo} 推送给“${customerName.value}”审核吗？状态将变为“线索待审核”，该企业的有效客户账号下一次读取会立即可见，当前阶段将不能继续编辑。`,
    )
  )
    return;
  pushing.value = true;
  pushError.value = '';
  pushSuccess.value = '';
  pushKey ??= makePushKey();
  try {
    await pushLead(lead.value.id, lead.value.version, pushKey);
    pushKey = undefined;
    pushSuccess.value = '已推送给客户审核，客户下次读取立即可见';
    await load();
  } catch (error) {
    pushError.value = pushErrorMessage(error);
  } finally {
    pushing.value = false;
  }
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/leads">← 返回线索列表</RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取线索</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>线索不存在或当前不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>线索详情暂时无法加载</h1>
        <ElButton data-test="refresh" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="lead">
        <div class="page-head">
          <div>
            <span class="pill">{{ leadStatusLabels[lead.status] }}</span>
            <h1>{{ lead.businessNo }}</h1>
          </div>
          <div class="detail-actions">
            <ElButton
              v-if="lead.capabilities.push"
              type="primary"
              data-test="push-lead"
              :loading="pushing"
              :disabled="pushing"
              @click="push"
              >推送客户审核</ElButton
            >
            <RouterLink
              v-if="lead.capabilities.edit"
              data-test="edit-lead"
              :to="`/leads/${lead.id}/edit`"
              >编辑线索</RouterLink
            ><ElButton data-test="refresh" text @click="load">刷新</ElButton>
          </div>
        </div>
        <p v-if="pushSuccess" class="submit-success" data-test="push-success">
          {{ pushSuccess }}
        </p>
        <p
          v-if="pushError"
          class="submit-error"
          data-test="push-error"
          role="alert"
        >
          {{ pushError }}
        </p>
        <p
          v-if="withdrawalSuccess"
          class="submit-success"
          data-test="withdrawal-success"
          role="status"
        >
          {{ withdrawalSuccess }}
        </p>
        <p
          v-if="withdrawalError"
          class="submit-error"
          data-test="withdrawal-error"
          role="alert"
        >
          {{ withdrawalError }}
        </p>
        <p v-if="evidenceSuccess" class="submit-success" role="status">
          {{ evidenceSuccess }}
        </p>
        <p v-if="evidenceError" class="submit-error" role="alert">
          {{ evidenceError }}
        </p>
        <p v-if="transferSuccess" class="submit-success" role="status">
          {{ transferSuccess }}
        </p>
        <p v-if="transferError" class="submit-error" role="alert">
          {{ transferError }}
        </p>
        <section class="demo-card demo-card--pad">
          <dl class="demo-detail-grid" data-test="lead-facts">
            <div>
              <dt>客户</dt>
              <dd>{{ customerName }}</dd>
            </div>
            <div>
              <dt>权利人</dt>
              <dd>{{ holderName }}</dd>
            </div>
            <div>
              <dt>拟办理业务类型</dt>
              <dd>{{ label(lead.caseType) }}</dd>
            </div>
            <div>
              <dt>来源／平台</dt>
              <dd>{{ label(lead.source) }} · {{ label(lead.platform) }}</dd>
            </div>
            <div>
              <dt>店铺</dt>
              <dd>
                {{ lead.shopName
                }}<small v-if="lead.shopExternalId">
                  · {{ lead.shopExternalId }}</small
                >
              </dd>
            </div>
            <div>
              <dt>发现时间</dt>
              <dd class="mono">{{ formatTime(lead.foundAt) }}</dd>
            </div>
            <div>
              <dt>侵权类型</dt>
              <dd>{{ lead.infringementTypes.map(label).join('、') }}</dd>
            </div>
            <div>
              <dt>披露标记</dt>
              <dd>{{ lead.needDisclose ? '需要披露' : '无需披露' }}</dd>
            </div>
            <div class="detail-grid__wide">
              <dt>备注</dt>
              <dd>{{ lead.remark || '未填写' }}</dd>
            </div>
          </dl>
        </section>
        <section class="demo-card" data-test="lead-products-table">
          <h2 class="card-section-title">商品及估算</h2>
          <div class="demo-table-wrap">
            <table class="demo-table">
              <thead>
                <tr>
                  <th>名称／链接</th>
                  <th class="num">数量</th>
                  <th class="num">单价</th>
                  <th class="num">评论数</th>
                  <th class="num">估算额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="product in lead.products" :key="product.id">
                  <td>
                    <strong>{{ product.title || '未命名商品' }}</strong>
                    <a
                      v-if="product.url"
                      class="product-link"
                      :href="product.url"
                      target="_blank"
                      rel="noreferrer"
                      >{{ product.url }}</a
                    >
                  </td>
                  <td class="num mono">{{ product.quantity }}</td>
                  <td class="num mono">{{ product.unitPrice }}</td>
                  <td class="num mono">{{ product.commentCount }}</td>
                  <td class="num mono">{{ product.estimatedAmount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section
          class="demo-card demo-card--pad lead-attachments"
          data-test="lead-attachments"
        >
          <h2 class="form-section-title">截图</h2>
          <p v-if="lead.leadScreenshotContentVersionIds.length === 0">
            未上传截图
          </p>
          <ul v-else-if="screenshots.length">
            <li v-for="screenshot in screenshots" :key="screenshot.versionId">
              <span>{{ screenshot.filename }}</span>
              <ElButton
                text
                :data-test="`download-screenshot-${screenshot.versionId}`"
                @click="
                  downloadScreenshot(
                    screenshot.materialId,
                    screenshot.versionId,
                  )
                "
                >下载</ElButton
              >
            </li>
          </ul>
          <ul v-else>
            <li v-for="id in lead.leadScreenshotContentVersionIds" :key="id">
              {{ id }}
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section
          v-if="lead.reviewDecision"
          class="demo-card demo-card--pad"
          data-test="client-review-record"
        >
          <h2 class="form-section-title">客户审核记录</h2>
          <dl class="demo-detail-grid">
            <div>
              <dt>审核结论</dt>
              <dd>
                {{
                  lead.reviewDecision.result === 'INFRINGEMENT'
                    ? '确认侵权'
                    : '判定不侵权并归档'
                }}
              </dd>
            </div>
            <div v-if="lead.reviewDecision.result === 'NO_INFRINGEMENT'">
              <dt>不侵权原因</dt>
              <dd>{{ lead.reviewDecision.reason }}</dd>
            </div>
            <div>
              <dt>审核人</dt>
              <dd>{{ lead.reviewDecision.reviewerDisplayName }}</dd>
            </div>
            <div v-if="lead.reviewDecision.result === 'NO_INFRINGEMENT'">
              <dt>归档时间</dt>
              <dd class="mono">
                {{ formatTime(lead.reviewDecision.archivedAt) }}
              </dd>
            </div>
            <div>
              <dt>审核时间</dt>
              <dd class="mono">
                {{ formatTime(lead.reviewDecision.decidedAt) }}
              </dd>
            </div>
          </dl>
        </section>
        <section
          v-if="lead.evidenceDecision"
          class="demo-card demo-card--pad"
          data-test="evidence-decision-record"
        >
          <h2 class="form-section-title">运营不取证归档记录</h2>
          <p>决定：不取证并归档</p>
          <p>操作人：{{ lead.evidenceDecision.decidedByDisplayName }}</p>
          <p>决定时间：{{ formatTime(lead.evidenceDecision.decidedAt) }}</p>
          <p>原因：{{ lead.evidenceDecision.reason }}</p>
          <p>归档时间：{{ formatTime(lead.evidenceDecision.archivedAt) }}</p>
        </section>
        <section
          v-if="lead.notaryMatters.length"
          class="demo-card demo-card--pad"
          data-test="notary-matters"
        >
          <h2 class="form-section-title">公证取证批次</h2>
          <p>本线索已进入公证流程；新增批次会保留原有批次记录。</p>
          <ul>
            <li v-for="matter in lead.notaryMatters" :key="matter.id">
              <RouterLink
                :data-test="`matter-link-${matter.id}`"
                :to="`/notary-matters/${matter.id}`"
                >{{ matter.businessNo }}</RouterLink
              >
              · {{ matter.notaryOfficeName }} · {{ matter.batchPurpose }} ·
              {{ formatTime(matter.createdAt) }}
            </li>
          </ul>
        </section>
        <section
          v-if="transferAvailable"
          class="demo-card demo-card--pad"
          data-test="notary-transfer-form"
        >
          <h2 class="form-section-title">
            {{
              lead.capabilities.createEvidenceBatch
                ? '新建取证批次'
                : '移交公证'
            }}
          </h2>
          <p v-if="lead.capabilities.createEvidenceBatch">
            为新的取证安排单独选择商品、截图、公证处和用途。已有批次不会被覆盖或重复推进线索状态。
          </p>
          <p v-else>
            确认侵权后，选择本次交给公证处的商品和截图，补充用途并选择公证处。提交后线索将转为只读，所选内容会保存为取证批次记录。
          </p>
          <p v-if="notaryOfficeLoadError" class="field-error" role="alert">
            {{ notaryOfficeLoadError }}
          </p>
          <fieldset
            class="notary-choice-group"
            :disabled="transferRetryLocked || transferSubmitting"
          >
            <legend>本次取证商品<RequiredFieldMark /></legend>
            <label
              v-for="product in lead.products"
              :key="product.id"
              class="notary-choice"
            >
              <input
                type="checkbox"
                :data-test="`select-product-${product.id}`"
                :checked="selectedProductIds.includes(product.id)"
                @change="
                  selectedProductIds = toggleSelection(
                    selectedProductIds,
                    product.id,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span>{{ product.title || product.url || '未命名商品' }}</span>
            </label>
          </fieldset>
          <fieldset
            v-if="screenshots.length"
            class="notary-choice-group"
            :disabled="transferRetryLocked || transferSubmitting"
          >
            <legend>本次提供的截图（可选）</legend>
            <label
              v-for="screenshot in screenshots"
              :key="screenshot.versionId"
              class="notary-choice"
            >
              <input
                type="checkbox"
                :data-test="`select-evidence-${screenshot.versionId}`"
                :checked="
                  selectedContentVersionIds.includes(screenshot.versionId)
                "
                @change="
                  selectedContentVersionIds = toggleSelection(
                    selectedContentVersionIds,
                    screenshot.versionId,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span>{{ screenshot.filename }}</span>
              <ElButton
                text
                :data-test="`download-transfer-evidence-${screenshot.versionId}`"
                @click.prevent="
                  downloadScreenshot(
                    screenshot.materialId,
                    screenshot.versionId,
                  )
                "
                >查看附件</ElButton
              >
            </label>
          </fieldset>
          <label class="field-label field-label--spaced" for="notary-office">
            公证处<RequiredFieldMark />
          </label>
          <select
            id="notary-office"
            v-model="notaryOfficeId"
            class="text-input"
            data-test="notary-office"
            aria-required="true"
            :disabled="transferRetryLocked || transferSubmitting"
          >
            <option value="">请选择公证处</option>
            <option
              v-for="office in notaryOffices"
              :key="office.id"
              :value="office.id"
            >
              {{ office.name }}
            </option>
          </select>
          <p
            v-if="
              notaryOffices.length === 0 &&
              !notaryOfficeCanCreate &&
              !notaryOfficeLoadError
            "
            class="field-help"
          >
            当前部门还没有可选公证处，请联系管理员维护后再移交。
          </p>
          <div v-if="notaryOfficeCanCreate" class="notary-office-create">
            <label
              class="field-label field-label--spaced"
              for="new-notary-office-name"
            >
              {{ notaryOffices.length ? '需要时可新增公证处' : '新增公证处' }}
            </label>
            <div class="notary-office-create__row">
              <input
                id="new-notary-office-name"
                v-model="notaryOfficeName"
                class="text-input"
                data-test="new-notary-office-name"
                maxlength="200"
                placeholder="填写公证处名称"
                :disabled="notaryOfficeCreating || transferRetryLocked"
              />
              <ElButton
                data-test="create-notary-office"
                :loading="notaryOfficeCreating"
                :disabled="
                  !notaryOfficeName.trim() ||
                  notaryOfficeCreating ||
                  transferRetryLocked
                "
                @click="addNotaryOffice"
                >新增并选择</ElButton
              >
            </div>
            <p v-if="notaryOfficeError" class="field-error" role="alert">
              {{ notaryOfficeError }}
            </p>
          </div>
          <label class="field-label field-label--spaced" for="batch-purpose">
            本批次用途<RequiredFieldMark />
          </label>
          <textarea
            id="batch-purpose"
            v-model="batchPurpose"
            class="text-area"
            data-test="batch-purpose"
            aria-required="true"
            maxlength="500"
            :disabled="transferRetryLocked || transferSubmitting"
            placeholder="例如：对目标店铺商品进行线上购买取证"
          />
          <p class="field-help">
            取证方式：线上购买（当前已启用方式）。用途最多 500 个字符。
          </p>
          <p v-if="transferRetryLocked" class="field-help">
            提交结果未确认，选择和请求键已锁定；可使用相同请求安全重试，或刷新查看服务端结果。
          </p>
          <ElButton
            type="primary"
            data-test="transfer-to-notary"
            :loading="transferSubmitting"
            :disabled="
              transferSubmitting ||
              !transferFormValid ||
              Boolean(notaryOfficeLoadError)
            "
            @click="transferToNotary"
            >{{
              lead.capabilities.createEvidenceBatch
                ? '新建取证批次'
                : '移交公证'
            }}</ElButton
          >
        </section>
        <section
          v-if="
            lead.capabilities.evidenceDecide &&
            lead.status === 'WAITING_EVIDENCE_DECISION'
          "
          class="demo-card demo-card--pad"
          data-test="evidence-decision-form"
        >
          <h2 class="form-section-title">不取证并归档</h2>
          <p>
            提交后线索将立即归档，运营决定及原因会保留为历史记录，当前页面不能撤回。
          </p>
          <label
            class="field-label field-label--spaced"
            for="no-evidence-reason"
          >
            不取证原因<RequiredFieldMark />
          </label>
          <textarea
            id="no-evidence-reason"
            v-model="evidenceReason"
            class="text-area"
            data-test="no-evidence-reason"
            aria-required="true"
            :disabled="evidenceSubmitting || evidenceRetryLocked"
          />
          <p class="field-help" aria-live="polite">
            已输入 {{ evidenceReasonLength }} / 5000 个字符（按 Unicode 码点计）
          </p>
          <p v-if="evidenceReasonTooLong" class="field-error" role="alert">
            原因最多为 5000 个 Unicode 码点，目前为
            {{ evidenceReasonLength }} 个；已保留输入，请删减后再提交。
          </p>
          <p v-if="evidenceRetryLocked" class="field-help">
            提交结果未确认，原因已锁定；可使用同一请求安全重试，或刷新查看服务端结果。
          </p>
          <ElButton
            data-test="archive-no-evidence"
            type="primary"
            :loading="evidenceSubmitting"
            :disabled="
              evidenceSubmitting ||
              !normalizedEvidenceReason ||
              evidenceReasonTooLong
            "
            @click="archiveNoEvidence"
            >不取证并归档</ElButton
          >
        </section>
        <section
          v-if="lead.pendingWithdrawalApplication"
          class="demo-card demo-card--pad"
          data-test="withdrawal-pending"
        >
          <h2 class="form-section-title">待客户确认的撤回申请</h2>
          <p>
            申请人：{{ lead.pendingWithdrawalApplication.applicantDisplayName }}
          </p>
          <p>
            申请时间：{{
              formatTime(lead.pendingWithdrawalApplication.appliedAt)
            }}
          </p>
          <p>申请原因：{{ lead.pendingWithdrawalApplication.reason }}</p>
          <p>线索仍保持归档，等待原客户企业确认。</p>
        </section>
        <section
          v-if="lead.capabilities.withdrawApply"
          class="demo-card demo-card--pad"
          data-test="withdrawal-form"
        >
          <h2 class="form-section-title">申请撤回归档</h2>
          <p>
            说明申请原因。提交后线索仍保持归档；原客户企业确认后才会回到待审核。
          </p>
          <label
            class="field-label field-label--spaced"
            for="withdrawal-reason"
          >
            撤回原因<RequiredFieldMark />
          </label>
          <textarea
            id="withdrawal-reason"
            v-model="withdrawalReason"
            class="text-area"
            data-test="withdrawal-reason"
            aria-required="true"
            :disabled="withdrawalSubmitting || withdrawalRetryLocked"
          />
          <p class="field-help" aria-live="polite">
            已输入 {{ withdrawalReasonLength }} / 5000 个字符（按 Unicode
            码点计）
          </p>
          <p v-if="withdrawalReasonTooLong" class="field-error" role="alert">
            撤回原因最多为 5000 个 Unicode 码点。
          </p>
          <p v-if="withdrawalRetryLocked" class="field-help">
            提交结果未确认，原因已锁定；可使用同一请求安全重试，或刷新查看结果。
          </p>
          <ElButton
            type="primary"
            data-test="apply-withdrawal"
            :loading="withdrawalSubmitting"
            :disabled="
              withdrawalSubmitting ||
              !normalizedWithdrawalReason ||
              withdrawalReasonTooLong
            "
            @click="applyWithdrawal"
            >申请撤回归档</ElButton
          >
        </section>
        <section
          v-if="lead.history?.length"
          class="demo-card demo-card--pad"
          data-test="withdrawal-history"
        >
          <h2 class="form-section-title">审核和撤回历史</h2>
          <ol>
            <li v-for="item in lead.history" :key="item.id">
              {{
                item.kind === 'REVIEW_DECISION'
                  ? '客户审核'
                  : item.kind === 'WITHDRAWAL_APPLICATION'
                    ? '撤回申请'
                    : '客户确认撤回'
              }}
              · {{ formatTime(item.occurredAt) }}
              <span v-if="item.reviewerDisplayName">
                · {{ item.reviewerDisplayName }}</span
              >
              <span v-if="item.applicantDisplayName">
                · {{ item.applicantDisplayName }}</span
              >
              <span v-if="item.result">
                ·
                {{
                  item.result === 'NO_INFRINGEMENT'
                    ? '判定不侵权'
                    : item.result === 'INFRINGEMENT'
                      ? '确认侵权'
                      : item.result
                }}</span
              >
              <span v-if="item.reason"> · {{ item.reason }}</span>
            </li>
          </ol>
        </section>
        <section class="demo-card demo-card--pad lead-record-meta">
          <h2 class="form-section-title">记录信息</h2>
          <p class="mono">创建于 {{ formatTime(lead.createdAt) }}</p>
          <p class="mono">
            更新于 {{ formatTime(lead.updatedAt) }} · 版本 {{ lead.version }}
          </p>
          <p v-if="lead.pushedAt" class="mono" data-test="push-record">
            推送于 {{ formatTime(lead.pushedAt) }} · 操作人
            {{ lead.pushedByDisplayName || '已记录运营人员' }}
          </p>
        </section>
      </template>
    </main>
  </div>
</template>
