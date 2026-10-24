<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  RouterLink,
  useRoute,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { labelLeadPlatform } from './lead-options';
import type { CaseStage } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import { downloadMaterialVersion } from '../../api/materials';
import {
  getNotaryMatter,
  type NotaryMatterDetail,
  type NotaryReturnChoice,
  type NotaryReturnAmountSummary,
} from '../../api/notary';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import NotaryMatterWorkflowPanel from './NotaryMatterWorkflowPanel.vue';
import NotaryRecordCorrectionPanel from './NotaryRecordCorrectionPanel.vue';
const route = useRoute();
const auth = useAuthStore();
const actorKey = computed(() =>
  [
    auth.session?.user.id ?? '',
    auth.session?.principalType ?? '',
    auth.session?.department?.id ?? '',
    auth.session?.authorizationRevision ?? '',
  ].join(':'),
);
const requestScopeKey = computed(
  () => String(route.params.id) + ':' + actorKey.value,
);
let contextGeneration = 0;
let request: AbortController | undefined;
let correctionRefreshRequest: AbortController | undefined;
const downloadRequests = new Set<AbortController>();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
type DetailElement = InstanceType<typeof globalThis.HTMLElement>;
const detailRoot = ref<DetailElement>();
const matter = ref<NotaryMatterDetail>();
const correctionPanel = ref<{ canLeave: () => boolean }>();
const correctionLocked = ref(false);
const correctionRefreshing = ref(false);
const correctionRefreshError = ref(false);
const downloadError = ref('');
const caseStageLabels: Record<CaseStage, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};

const workflowGuidance = computed(() => {
  const current = matter.value;
  if (!current) return { text: '' };
  const unavailable = '当前记录未提供本账号的办理入口，请刷新核对最新记录。';
  switch (current.stage) {
    case 'PENDING_EVIDENCE':
      return {
        text: '下一步由运营登记真实取证日期、样品费及物流，保存后进入开箱环节。',
        ...(current.capabilities.recordEvidence
          ? { anchor: 'evidence-form', action: '填写取证物流' }
          : { text: `由运营核对取证物流。${unavailable}` }),
      };
    case 'WAITING_UNBOX':
      return {
        text: '下一步由公证处在公证处办理端登记开箱材料；获授权的运营也可在本页登记。',
        ...(current.capabilities.recordOpening
          ? { anchor: 'opening-form', action: '填写开箱材料' }
          : {}),
      };
    case 'UNBOX_REVIEW':
      return {
        text: '下一步由客户在客户办理端审核开箱材料；获授权的运营也可在本页办理开箱审核。',
        ...(current.capabilities.reviewOpening
          ? { anchor: 'review-form', action: '查看并审核开箱材料' }
          : {}),
      };
    case 'ISSUANCE_DECISION':
      return {
        text: '下一步由运营根据审核结论决定是否出证；不出证将进入退货归档分支。',
        ...(current.capabilities.decideIssuance
          ? { anchor: 'issuance-form', action: '办理出证决定' }
          : { text: `下一步由运营决定是否出证。${unavailable}` }),
      };
    case 'WAITING_CERTIFICATE':
      return {
        text: '下一步由公证处在公证处办理端的待出证事项中登记真实公证书和所需材料。完成后由运营接手案件，运营在本页查看结果。',
      };
    case 'WAITING_RETURN':
      return {
        text: '已决定不出证，下一步由运营办理退货归档，按实际情况记录退货、保留或仅退款。',
        ...(current.capabilities.archiveReturn
          ? { anchor: 'return-archive-form', action: '填写退货归档资料' }
          : {
              text: `已决定不出证，下一步由运营核对退货归档安排。${unavailable}`,
            }),
      };
    case 'ARCHIVED':
      return {
        text: current.linkedCase
          ? '公证事项已归档，下一步由运营进入下方案件，按案件当前阶段继续办理。'
          : current.certificateSummary
            ? '公证事项已出证归档，由运营核对案件后续安排。当前没有可展示的关联案件入口，请刷新核对记录。'
            : '公证事项已归档，本次公证流程结束；归档结论见下方记录。',
      };
  }
  return { text: '当前阶段未提供办理说明，请刷新核对当前事项记录。' };
});

function feeLabel(fee: NotaryMatterDetail['fees']['notary']): string {
  return fee.state === 'KNOWN'
    ? `${fee.amount} 元`
    : fee.state === 'PENDING'
      ? '待定'
      : '未登记';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function returnChoiceLabel(choice: NotaryReturnChoice): string {
  return choice === 'RETURN'
    ? '退货并退款'
    : choice === 'KEEP'
      ? '保留商品，不退款'
      : '不寄回商品，只退款';
}

function returnPartyLabel(kind: string | null): string {
  return kind === 'CUSTOMER'
    ? '客户'
    : kind === 'FIRM'
      ? '我方'
      : kind === 'MERCHANT'
        ? '商家／平台'
        : kind === 'OTHER'
          ? '其他'
          : '';
}

function returnAmountLabel(
  label: string,
  amount: NotaryReturnAmountSummary | null,
): string {
  if (!amount) return `${label}：不适用`;
  if (amount.state === 'PENDING') return `${label}：待定`;
  const party = amount.partyKind
    ? `；${amount.partyKind === 'OTHER' ? amount.partyName : returnPartyLabel(amount.partyKind)}`
    : '';
  return `${label}：${amount.amount} 元${party}`;
}

async function downloadMaterial(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  const generation = contextGeneration;
  const controller = new AbortController();
  downloadRequests.add(controller);
  downloadError.value = '';
  try {
    await downloadMaterialVersion(
      materialId,
      contentVersionId,
      controller.signal,
    );
  } catch {
    if (controller.signal.aborted || generation !== contextGeneration) return;
    downloadError.value = '附件下载失败，请稍后重试';
  } finally {
    downloadRequests.delete(controller);
  }
}
async function load(): Promise<boolean> {
  const generation = contextGeneration;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  matter.value = undefined;
  if (!auth.session || auth.session.principalType !== 'INTERNAL') {
    state.value = 'missing';
    return false;
  }
  try {
    const current = await getNotaryMatter(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted || generation !== contextGeneration)
      return false;
    matter.value = current;
    state.value = 'ready';
    return generation === contextGeneration && !controller.signal.aborted;
  } catch (error) {
    if (controller.signal.aborted || generation !== contextGeneration)
      return false;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
    return false;
  }
}
async function refreshCorrectionFacts(): Promise<void> {
  if (correctionRefreshing.value) return;
  const generation = contextGeneration;
  const matterId = String(route.params.id);
  const controller = new AbortController();
  correctionRefreshRequest = controller;
  correctionRefreshing.value = true;
  correctionRefreshError.value = false;
  try {
    const fresh = await getNotaryMatter(matterId, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      String(route.params.id) !== matterId ||
      !auth.session ||
      auth.session.principalType !== 'INTERNAL'
    )
      return;
    matter.value = fresh;
    state.value = 'ready';
  } catch {
    // Keep the current correction form and its conflict message available.
    if (!controller.signal.aborted && generation === contextGeneration)
      correctionRefreshError.value = true;
  } finally {
    if (correctionRefreshRequest === controller) {
      correctionRefreshRequest = undefined;
      if (generation === contextGeneration) correctionRefreshing.value = false;
    }
  }
}

const workflow = createListWorkflowContext<NotaryMatterDetail>(
  async () => {
    if (!matter.value) throw new Error('Missing matter');
    return matter.value;
  },
  { success: () => void load() },
);
const workflowState = workflow.state;
function canLeaveDetail() {
  return (
    workflowState.value.requestState === 'idle' &&
    (correctionPanel.value?.canLeave() ?? true)
  );
}
onBeforeRouteLeave(canLeaveDetail);
onBeforeRouteUpdate(canLeaveDetail);
function actorIdentityKey(value: string): string {
  return value.split(':').slice(0, 3).join(':');
}
function hasPendingWorkflowRequest(
  recordId: string,
  actionKey: string,
): boolean {
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    const key = globalThis.sessionStorage.key(index);
    if (!key?.startsWith('notary-list-request:')) continue;
    try {
      const tuple: unknown = JSON.parse(
        key.slice('notary-list-request:'.length),
      );
      if (
        Array.isArray(tuple) &&
        tuple.length === 3 &&
        typeof tuple[0] === 'string' &&
        actorIdentityKey(tuple[0]) === actorIdentityKey(actorKey.value) &&
        tuple[1] === recordId &&
        tuple[2] === actionKey
      )
        return true;
    } catch {
      continue;
    }
  }
  return false;
}
watch(
  matter,
  (current) => {
    if (!current) {
      void workflow.sync(null);
      return;
    }
    const actions = [
      'evidence-form',
      'opening-form',
      'review-form',
      'issuance-form',
      'return-archive-form',
    ];
    let saved: string | undefined;
    try {
      saved = actions.find(
        (action) =>
          globalThis.sessionStorage.getItem(
            'notary-list-request:' +
              JSON.stringify([actorKey.value, current.id, action]),
          ) || hasPendingWorkflowRequest(current.id, action),
      );
    } catch {
      /* The panel blocks dispatch when storage is unavailable. */
    }
    const actionKey = saved ?? workflowGuidance.value.anchor;
    void workflow.sync(
      actionKey
        ? {
            recordId: current.id,
            actorKey: actorKey.value,
            actionKey,
            title: workflowGuidance.value.action ?? '',
          }
        : null,
    );
  },
  { flush: 'sync' },
);
function clearContext() {
  contextGeneration += 1;
  correctionRefreshRequest?.abort();
  correctionRefreshRequest = undefined;
  correctionRefreshing.value = false;
  correctionRefreshError.value = false;
  request?.abort();
  for (const controller of downloadRequests) controller.abort();
  downloadRequests.clear();
  matter.value = undefined;
  correctionLocked.value = false;
  downloadError.value = '';
  workflow.dispose();
}
watch(
  requestScopeKey,
  () => {
    clearContext();
    void load();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(clearContext);
watch(
  [() => route.hash, () => state.value, () => matter.value?.id],
  () => {
    if (state.value !== 'ready') return;
    const anchor = route.hash.slice(1);
    if (
      ![
        'evidence-form',
        'opening-form',
        'saved-opening',
        'review-form',
        'issuance-form',
        'return-archive-form',
        'certificate-summary',
      ].includes(anchor)
    )
      return;
    const target = detailRoot.value?.querySelector<DetailElement>(`#${anchor}`);
    target?.scrollIntoView?.({ block: 'start' });
    target?.focus({ preventScroll: true });
  },
  { flush: 'post' },
);
</script>
<template>
  <div ref="detailRoot" class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/notary-matters"
        >← 返回公证阶段</RouterLink
      >
      <RouterLink
        v-if="matter"
        class="back-link"
        :to="`/leads/${matter.sourceLead.id}`"
        >查看来源线索</RouterLink
      >
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取取证批次</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>取证批次不存在或当前不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>取证批次暂时无法加载</h1>
        <ElButton data-test="refresh-matter" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="matter">
        <p v-if="workflowState.status === 'denied'" role="alert">
          当前账号无权审核此事项，或事项不存在或当前不可访问，请返回列表核对。
        </p>
        <div class="page-head">
          <div>
            <span class="pill">{{
              matter.stage === 'UNBOX_REVIEW'
                ? '开箱审核中'
                : matter.stage === 'ISSUANCE_DECISION'
                  ? '开箱待确认'
                  : matter.stage === 'WAITING_CERTIFICATE'
                    ? '待出证'
                    : matter.stage === 'WAITING_RETURN'
                      ? '待退货'
                      : matter.stage === 'ARCHIVED'
                        ? '已归档'
                        : matter.stage === 'WAITING_UNBOX'
                          ? '等待开箱'
                          : '待公证处取证'
            }}</span>
            <h1>{{ matter.businessNo }}</h1>
          </div>
          <ElButton
            data-test="refresh-matter"
            text
            :disabled="
              workflowState.requestState !== 'idle' ||
              (correctionPanel && !correctionPanel.canLeave())
            "
            @click="load"
            >刷新</ElButton
          >
        </div>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-case-summary"
        >
          <h2 class="form-section-title">流程推进与诉讼流转</h2>
          <p data-test="notary-workflow">{{ workflowGuidance.text }}</p>
          <RouterLink
            v-if="workflowGuidance.anchor"
            data-test="notary-workflow-action"
            :to="{ hash: `#${workflowGuidance.anchor}` }"
            >{{ workflowGuidance.action }}</RouterLink
          >
          <p v-if="matter.linkedCase">
            已流转诉讼 · {{ caseStageLabels[matter.linkedCase.stage] }} ·
            <RouterLink
              data-test="linked-case"
              :to="`/cases/${matter.linkedCase.id}`"
              >进入案件 {{ matter.linkedCase.businessNo }}</RouterLink
            >
          </p>
          <p v-else>暂无可见案件</p>
        </section>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-matter-detail"
        >
          <h2 class="form-section-title">批次信息</h2>
          <dl class="demo-detail-grid">
            <div>
              <dt>客户</dt>
              <dd>{{ matter.sourceSummary.customer.name }}</dd>
            </div>
            <div>
              <dt>权利主体</dt>
              <dd>{{ matter.sourceSummary.rightsHolder.name }}</dd>
            </div>
            <div>
              <dt>平台</dt>
              <dd>{{ labelLeadPlatform(matter.sourceSummary.platform) }}</dd>
            </div>
            <div>
              <dt>店铺名</dt>
              <dd>{{ matter.sourceSummary.shopName }}</dd>
            </div>
            <div>
              <dt>店铺ID</dt>
              <dd class="mono">
                {{ matter.sourceSummary.shopExternalId ?? '未登记' }}
              </dd>
            </div>
            <div>
              <dt>推送日期</dt>
              <dd class="mono">{{ matter.transferredAt }}</dd>
            </div>
            <div>
              <dt>取证日期</dt>
              <dd class="mono">{{ matter.evidenceAt ?? '未登记' }}</dd>
            </div>
            <div>
              <dt>开箱照片</dt>
              <dd>
                {{
                  matter.openingSummary
                    ? `${matter.openingSummary.photoCount} 张`
                    : '未登记'
                }}
              </dd>
            </div>
            <div>
              <dt>发货人</dt>
              <dd>{{ matter.openingSummary?.senderName ?? '未登记' }}</dd>
            </div>
            <div>
              <dt>发货电话</dt>
              <dd class="mono">
                {{ matter.openingSummary?.senderPhone ?? '未登记' }}
              </dd>
            </div>
            <div class="detail-grid__wide">
              <dt>发货地址</dt>
              <dd>{{ matter.openingSummary?.senderAddress ?? '未登记' }}</dd>
            </div>
            <div>
              <dt>来源线索</dt>
              <dd>
                <RouterLink
                  data-test="notary-matter-source-lead"
                  :to="`/leads/${matter.sourceLead.id}`"
                  >{{ matter.sourceLead.businessNo }}</RouterLink
                >
              </dd>
            </div>
            <div>
              <dt>公证处</dt>
              <dd>{{ matter.notaryOffice.name }}</dd>
            </div>
            <div>
              <dt>办理方式</dt>
              <dd>线上购买</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd class="mono">{{ formatTime(matter.createdAt) }}</dd>
            </div>
            <div class="detail-grid__wide">
              <dt>本批次用途</dt>
              <dd>{{ matter.batchPurpose }}</dd>
            </div>
          </dl>
        </section>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-fee-summary"
        >
          <h2 class="form-section-title">费用摘要</h2>
          <dl class="demo-detail-grid">
            <div>
              <dt>公证费</dt>
              <dd class="mono">{{ feeLabel(matter.fees.notary) }}</dd>
            </div>
            <div>
              <dt>调查费</dt>
              <dd class="mono">{{ feeLabel(matter.fees.investigation) }}</dd>
            </div>
            <div>
              <dt>样品费</dt>
              <dd class="mono">{{ feeLabel(matter.fees.sample) }}</dd>
            </div>
          </dl>
        </section>

        <section
          id="certificate-summary"
          tabindex="-1"
          class="demo-card demo-card--pad"
          data-test="notary-certificate-summary"
        >
          <h2 class="form-section-title">公证书</h2>
          <template v-if="matter.certificateSummary">
            <dl class="demo-detail-grid">
              <div>
                <dt>公证书编号</dt>
                <dd class="mono">
                  {{ matter.certificateSummary.certificateNo }}
                </dd>
              </div>
              <div>
                <dt>出证日期</dt>
                <dd class="mono">
                  {{ matter.certificateSummary.certificateDate }}
                </dd>
              </div>
              <div>
                <dt>出证登记时间</dt>
                <dd class="mono">
                  {{ formatTime(matter.certificateSummary.issuedAt) }}
                </dd>
              </div>
              <div>
                <dt>需要披露</dt>
                <dd>
                  {{ matter.certificateSummary.needDisclose ? '是' : '否' }}
                </dd>
              </div>
            </dl>
            <p v-if="matter.stage === 'ARCHIVED'">本事项已出证归档。</p>
          </template>
          <p v-else>未登记公证书</p>
          <ul v-if="matter.certificateFiles.length">
            <li
              v-for="file in matter.certificateFiles"
              :key="`${file.purpose}:${file.contentVersionId}`"
            >
              {{
                file.purpose === 'NOTARY_CERTIFICATE'
                  ? '公证书文件'
                  : '披露材料'
              }}：{{ file.originalFilename }}
              <ElButton
                text
                :data-test="`download-certificate-${file.contentVersionId}`"
                @click="
                  downloadMaterial(file.materialId, file.contentVersionId)
                "
                >下载附件</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>

        <NotaryMatterWorkflowPanel
          v-if="workflowState.session && workflowState.status === 'ready'"
          :key="workflowState.session.contextKey"
          :detail="matter"
          :session="workflowState.session"
          :disabled="
            correctionLocked || correctionRefreshing || correctionRefreshError
          "
        />
        <NotaryRecordCorrectionPanel
          v-if="matter"
          :key="`${matter.id}:${actorKey}`"
          ref="correctionPanel"
          :detail="matter"
          :actor-key="actorKey"
          :blocked="workflowState.requestState !== 'idle'"
          :refreshing="correctionRefreshing || correctionRefreshError"
          @refreshed="refreshCorrectionFacts"
          @locking="correctionLocked = $event"
        />
        <p
          v-if="correctionRefreshing"
          role="status"
          data-test="correction-refreshing"
        >
          正在重新读取更正事实，读取完成前不能开始新更正或核实原请求。
        </p>
        <p
          v-if="correctionRefreshError"
          role="alert"
          data-test="correction-refresh-error"
        >
          最新事实读取失败。请重试读取；读取成功前不能开始新更正。
          <ElButton
            data-test="retry-correction-refresh"
            @click="refreshCorrectionFacts"
          >
            重新读取
          </ElButton>
        </p>
        <section
          id="saved-opening"
          tabindex="-1"
          v-if="matter.opening"
          class="demo-card demo-card--pad"
          data-test="saved-opening"
        >
          <h2 class="form-section-title">开箱记录</h2>
          <p>寄件人：{{ matter.opening.senderName || '未登记' }}</p>
          <p>电话：{{ matter.opening.senderPhone || '未登记' }}</p>
          <p>地址：{{ matter.opening.senderAddress || '未登记' }}</p>
          <p>登记时间：{{ formatTime(matter.opening.recordedAt) }}</p>
          <ul>
            <li
              v-for="photo in matter.opening.photos"
              :key="photo.contentVersionId"
            >
              {{ photo.originalFilename }}
              <ElButton
                text
                :data-test="`download-opening-photo-${photo.contentVersionId}`"
                @click="
                  downloadMaterial(photo.materialId, photo.contentVersionId)
                "
                >下载照片</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>

        <section
          v-if="matter.reviewDecision"
          class="demo-card demo-card--pad"
          data-test="opening-review-record"
        >
          <h2 class="form-section-title">开箱审核记录</h2>
          <p>
            审核结论：{{
              matter.reviewDecision.result === 'INFRINGEMENT'
                ? '确认侵权'
                : '判定不侵权'
            }}
          </p>
          <p>审核人：{{ matter.reviewDecision.actorDisplayName }}</p>
          <p>审核时间：{{ formatTime(matter.reviewDecision.decidedAt) }}</p>
          <p v-if="matter.reviewDecision.reason">
            原因：{{ matter.reviewDecision.reason }}
          </p>
          <p v-if="matter.stage === 'ISSUANCE_DECISION'">
            下一步：由运营决定是否出证。
          </p>
          <p v-else-if="matter.stage === 'ARCHIVED'">
            该事项已归档，普通入口不能撤回。
          </p>
        </section>

        <section
          v-if="matter.issuanceDecision"
          class="demo-card demo-card--pad"
          data-test="issuance-decision-record"
        >
          <h2 class="form-section-title">出证决定记录</h2>
          <p>
            决定：{{
              matter.issuanceDecision.decision === 'ISSUE' ? '同意出证' : '退货'
            }}
            →
            {{
              matter.issuanceDecision.decision === 'ISSUE' ? '待出证' : '待退货'
            }}
          </p>
          <p>决定人：{{ matter.issuanceDecision.actorDisplayName }}</p>
          <p>决定时间：{{ formatTime(matter.issuanceDecision.decidedAt) }}</p>
        </section>

        <section
          v-if="matter.returnArchive"
          class="demo-card demo-card--pad"
          data-test="return-archive-record"
        >
          <h2 class="form-section-title">退货归档记录</h2>
          <p>
            办理方式：{{ returnChoiceLabel(matter.returnArchive.returnChoice) }}
          </p>
          <p>归档原因：{{ matter.returnArchive.archiveReason }}</p>
          <p>归档人：{{ matter.returnArchive.actorDisplayName }}</p>
          <p>归档时间：{{ formatTime(matter.returnArchive.archivedAt) }}</p>
          <p>{{ returnAmountLabel('退款', matter.returnArchive.refund) }}</p>
          <p>
            {{ returnAmountLabel('退货运费', matter.returnArchive.freight) }}
          </p>
        </section>

        <section
          v-if="matter.evidence"
          class="demo-card demo-card--pad"
          data-test="saved-evidence"
        >
          <h2 class="form-section-title">取证物流记录</h2>
          <p>取证日期：{{ matter.evidence.evidenceAt }}</p>
          <p>
            样品费用：{{
              matter.evidence.sampleFeeState === 'PENDING'
                ? '待定'
                : `${matter.evidence.sampleFeeAmount} 元`
            }}
          </p>
          <ul>
            <li v-for="row in matter.evidence.logistics" :key="row.id">
              快递公司：{{
                row.companyState === 'NONE' ? '无' : row.companyValue
              }}；快递单号：{{
                row.trackingState === 'NONE' ? '无' : row.trackingValue
              }}
            </li>
          </ul>
          <p>登记时间：{{ formatTime(matter.evidence.recordedAt) }}</p>
        </section>
        <section class="demo-card" data-test="notary-matter-products">
          <h2 class="card-section-title">本批次商品</h2>
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
                <tr
                  v-for="product in matter.selectedProducts"
                  :key="product.id"
                >
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
          data-test="notary-matter-materials"
        >
          <h2 class="form-section-title">本批次截图</h2>
          <p v-if="matter.selectedMaterials.length === 0">本批次未选择截图。</p>
          <ul v-else>
            <li
              v-for="material in matter.selectedMaterials"
              :key="material.contentVersionId"
            >
              <span>{{ material.originalFilename }}</span>
              <ElButton
                text
                :data-test="`download-matter-material-${material.contentVersionId}`"
                @click="
                  downloadMaterial(
                    material.materialId,
                    material.contentVersionId,
                  )
                "
                >下载附件</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.demo-detail-grid dd,
.demo-card li,
.demo-card p {
  overflow-wrap: anywhere;
}

.demo-detail-grid .mono {
  font-variant-numeric: tabular-nums;
}

section[id] {
  scroll-margin-top: 1rem;
}
</style>
