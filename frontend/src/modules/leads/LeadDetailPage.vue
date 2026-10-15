<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import { ApiError } from '../../api/http';
import { getLead, type LeadDetail } from '../../api/leads';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
} from '../../api/materials';
import { leadStatusLabels } from './lead-options';
import { summarizeLeadProducts } from './lead-display';
import { useAuthStore } from '../../stores/auth';
import LeadQuickActionsPanel from './LeadQuickActionsPanel.vue';
import {
  readPendingLeadCommands,
  type LeadWorkflowResult,
} from './LeadListWorkflowPanel.vue';
const route = useRoute();
const auth = useAuthStore();
const actorKey = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const requestScopeKey = computed(
  () => `${String(route.params.id)}:${actorKey.value}`,
);
let contextGeneration = 0;
let refreshGeneration = 0;
let request: AbortController | undefined;
const downloadRequests = new Set<AbortController>();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const lead = ref<LeadDetail>();
const customerName = computed(
  () => lead.value?.displayNames.customerName ?? '客户名称不可见',
);
const holderName = computed(
  () => lead.value?.displayNames.rightsHolderName ?? '权利主体名称不可见',
);
const productSummary = computed(() =>
  summarizeLeadProducts(lead.value?.products ?? []),
);
const orderedProducts = computed(() =>
  [...(lead.value?.products ?? [])].sort((a, b) => a.position - b.position),
);
const screenshots = ref<
  Array<{ materialId: string; versionId: string; filename: string }>
>([]);
const downloadError = ref('');
const workflowOpen = ref(false);
const pendingCommands = ref(readPendingLeadCommands());
const pendingPush = computed(
  () => pendingCommands.value?.[actorKey.value] ?? null,
);
const transferredMatter = ref<{ id: string; businessNo: string }>();
const transferSuccess = ref('');
function readPending() {
  pendingCommands.value = readPendingLeadCommands();
}
async function workflowCompleted(result: LeadWorkflowResult) {
  const scope = requestScopeKey.value;
  if (
    result.attempt.identity !== actorKey.value ||
    result.attempt.leadId !== String(route.params.id)
  )
    return;
  notifyWorkflowChanged();
  readPending();
  const expectedRefresh = refreshGeneration + 1;
  await load();
  if (scope !== requestScopeKey.value || refreshGeneration !== expectedRefresh)
    return;
  if (
    result.matter &&
    lead.value?.notaryMatters.some((matter) => matter.id === result.matter?.id)
  ) {
    transferredMatter.value = result.matter;
    transferSuccess.value = '已创建本次公证取证批次，请打开对应事项继续办理。';
  }
}
const workflowGuidance = computed(() => {
  const current = lead.value;
  if (!current) return '';
  switch (current.status) {
    case 'WAITING_PUSH':
      return '下一步由运营核对线索后推送，客户在客户办理端的待审核线索中确认。';
    case 'WAITING_REVIEW':
      return '下一步由客户在客户办理端的待审核线索中审核；运营在此查看客户结论，不能代客户确认。';
    case 'WAITING_EVIDENCE_DECISION':
      return current.capabilities.transferToNotary
        ? '下一步由运营选择商品、截图、公证处及用途，移交公证；也可按实际情况选择不取证归档。'
        : '由运营核对后续安排。当前记录未提供可办理入口，请刷新核对最新记录。';
    case 'TRANSFERRED_TO_NOTARY':
      return '后续按每个公证取证批次分别推进。请打开对应事项查看当前阶段、下一责任人与办理入口。';
    case 'ARCHIVED':
      return current.pendingWithdrawalApplication
        ? '线索保持归档，下一步由原客户企业在客户办理端确认撤回申请。'
        : '线索已归档，归档结论见下方记录；本次流程已结束。';
    default:
      return '请核对当前线索记录后安排后续办理。';
  }
});
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
function safeProductUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new globalThis.URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
async function load(): Promise<void> {
  refreshGeneration += 1;
  const generation = contextGeneration;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  lead.value = undefined;
  screenshots.value = [];
  transferredMatter.value = undefined;
  transferSuccess.value = '';
  try {
    const current = await getLead(String(route.params.id), {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      request !== controller
    )
      return;
    lead.value = current;
    const materials = await listOwnerMaterials('LEAD', current.id, {
      signal: controller.signal,
    }).catch(() => null);
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      request !== controller
    )
      return;
    screenshots.value = (materials?.items ?? []).flatMap((material) => {
      if (
        material.status !== 'ACTIVE' ||
        !material.currentVersionId ||
        !current.leadScreenshotContentVersionIds.includes(
          material.currentVersionId,
        )
      )
        return [];
      const version = material.contentVersions.find(
        (item) => item.id === material.currentVersionId,
      );
      return version
        ? [
            {
              materialId: material.id,
              versionId: version.id,
              filename: version.originalFilename,
            },
          ]
        : [];
    });
    state.value = 'ready';
  } catch (error) {
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      request !== controller
    )
      return;
    lead.value = undefined;
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
  const generation = contextGeneration;
  const controller = new AbortController();
  downloadRequests.add(controller);
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId, controller.signal);
  } catch {
    if (!controller.signal.aborted && generation === contextGeneration)
      downloadError.value = '截图下载失败，请稍后重试';
  } finally {
    downloadRequests.delete(controller);
  }
}
function clearContext() {
  contextGeneration += 1;
  request?.abort();
  for (const controller of downloadRequests) controller.abort();
  downloadRequests.clear();
  lead.value = undefined;
  screenshots.value = [];
  downloadError.value = '';
  transferredMatter.value = undefined;
  transferSuccess.value = '';
  workflowOpen.value = false;
}
watch(
  requestScopeKey,
  () => {
    clearContext();
    readPending();
    workflowOpen.value = pendingPush.value?.leadId === String(route.params.id);
    void load();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(clearContext);
</script>
<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/leads">← 返回线索列表</RouterLink>
      <p
        v-if="pendingPush?.leadId === String(route.params.id) && !workflowOpen"
        role="alert"
      >
        该线索有未确认请求，请先核对原请求。
        <ElButton data-test="reopen-pending-lead" @click="workflowOpen = true"
          >核对未确认请求</ElButton
        >
      </p>
      <section
        v-if="transferredMatter"
        class="demo-card demo-card--pad"
        data-test="handoff-success"
        role="status"
      >
        <h2 class="form-section-title">本次移交成功</h2>
        <p>{{ transferSuccess }}</p>
        <RouterLink
          data-test="handoff-matter-link"
          :to="`/notary-matters/${transferredMatter.id}`"
          >打开 {{ transferredMatter.businessNo }}，继续办理</RouterLink
        >
        <p>请在该事项查看当前阶段、下一责任人与办理入口。</p>
      </section>
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
              @click="workflowOpen = true"
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
        <section class="demo-card demo-card--pad" data-test="lead-workflow">
          <h2 class="form-section-title">流程推进</h2>
          <p>{{ workflowGuidance }}</p>
          <ElButton
            v-if="
              lead.capabilities.transferToNotary ||
              lead.capabilities.createEvidenceBatch ||
              lead.capabilities.evidenceDecide ||
              lead.capabilities.withdrawApply
            "
            data-test="open-lead-workflow"
            type="primary"
            @click="workflowOpen = true"
            >{{
              lead.capabilities.createEvidenceBatch
                ? '新建取证批次'
                : lead.capabilities.withdrawApply
                  ? '申请撤回归档'
                  : '确认取证安排'
            }}</ElButton
          >
          <a v-else-if="lead.notaryMatters.length" href="#notary-matters"
            >查看公证取证批次</a
          >
        </section>
        <section class="demo-card demo-card--pad">
          <dl class="demo-detail-grid" data-test="lead-facts">
            <div>
              <dt>客户</dt>
              <dd>{{ customerName }}</dd>
            </div>
            <div>
              <dt>权利主体</dt>
              <dd>{{ holderName }}</dd>
            </div>
            <div>
              <dt>案件类型</dt>
              <dd>{{ label(lead.caseType) }}</dd>
            </div>
            <div>
              <dt>来源／平台</dt>
              <dd>{{ label(lead.source) }} · {{ label(lead.platform) }}</dd>
            </div>
            <div>
              <dt>负责人</dt>
              <dd>{{ lead.displayNames.responsibleUserName }}</dd>
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
          <div
            class="demo-table-wrap business-list-scroll"
            tabindex="0"
            role="region"
            aria-label="商品明细，可横向滚动"
          >
            <table class="demo-table business-list-table lead-product-table">
              <colgroup>
                <col style="width: 200px" />
                <col style="width: 260px" />
                <col style="width: 100px" />
                <col style="width: 120px" />
                <col style="width: 100px" />
                <col style="width: 160px" />
              </colgroup>
              <thead>
                <tr>
                  <th>商品名称</th>
                  <th>商品链接</th>
                  <th class="num">销量</th>
                  <th class="num">单价（元）</th>
                  <th class="num">评论数</th>
                  <th class="num">销售总额（估算／元）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="product in orderedProducts" :key="product.id">
                  <td class="business-list-cell--text">
                    <details>
                      <summary>{{ product.title || '未登记商品名称' }}</summary>
                      <p>{{ product.title || '未登记商品名称' }}</p>
                    </details>
                  </td>
                  <td class="business-list-cell--text">
                    <details v-if="safeProductUrl(product.url)">
                      <summary>查看商品链接</summary>
                      <a
                        :href="safeProductUrl(product.url)!"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ product.url }}</a
                      >
                    </details>
                    <span v-else>无有效商品链接</span>
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.quantity }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.unitPrice }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.commentCount }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.estimatedAmount }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr data-test="lead-product-summary">
                  <th colspan="2" scope="row">合计（估算）</th>
                  <td class="num mono business-list-cell--number">
                    {{ productSummary.quantityTotal }}
                  </td>
                  <td class="num mono business-list-cell--number">—</td>
                  <td class="num mono business-list-cell--number">
                    {{ productSummary.commentTotal }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ productSummary.estimatedAmount }}
                  </td>
                </tr>
              </tfoot>
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
          id="notary-matters"
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
    <LeadQuickActionsPanel
      v-if="workflowOpen"
      :lead-id="String(route.params.id)"
      :identity="actorKey"
      :pending-push="pendingPush"
      @pending="readPending"
      @completed="workflowCompleted"
      @close="workflowOpen = false"
    />
  </div>
</template>

<style scoped>
.lead-product-table {
  min-width: 940px;
  table-layout: fixed;
}
.lead-product-table .business-list-cell--text {
  overflow-wrap: anywhere;
}
.lead-product-table summary {
  cursor: pointer;
}
.lead-product-table details:not([open]) summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.lead-product-table a {
  overflow-wrap: anywhere;
}
</style>
