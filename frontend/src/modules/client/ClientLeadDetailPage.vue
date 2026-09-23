<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { ApiError } from '../../api/http';
import {
  getClientLead,
  reviewClientLead,
  reviewClientLeadNoInfringement,
  type ClientLead,
} from '../../api/client-leads';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
} from '../../api/materials';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const lead = ref<ClientLead>();
const screenshots = ref<
  Array<{ materialId: string; versionId: string; filename: string }>
>([]);
const downloadError = ref('');
const reviewError = ref('');
const reviewSuccess = ref('');
const reviewing = ref(false);
const noInfringementReason = ref('');
const noInfringementRetryLocked = ref(false);
let reviewKey: string | undefined;
let noInfringementKey: string | undefined;
let frozenNoInfringementReason: string | undefined;
let request: AbortController | undefined;

const returnTo = computed(() => {
  const view =
    route.query.view === 'processed' ||
    (!route.query.view &&
      (lead.value?.status === 'WAITING_EVIDENCE_DECISION' ||
        lead.value?.status === 'ARCHIVED'))
      ? 'processed'
      : 'pending';
  const page = Array.isArray(route.query.page)
    ? route.query.page[0]
    : route.query.page;
  return {
    path: '/client/leads',
    query: {
      ...(view === 'processed' || route.query.view === 'pending'
        ? { view }
        : {}),
      ...(page ? { page } : {}),
    },
  };
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
const label = (value: string) => labels[value] ?? value;
const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });

function makeReviewKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `client-lead-review-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

async function confirmInfringement(): Promise<void> {
  if (!lead.value || !lead.value.capabilities.review || reviewing.value) return;
  if (
    !globalThis.window.confirm(
      '确认后线索将进入“线索待确认”，由运营决定是否取证；当前入口不能撤回。确定确认侵权吗？',
    )
  )
    return;

  reviewKey ??= makeReviewKey();
  reviewError.value = '';
  reviewSuccess.value = '';
  reviewing.value = true;
  try {
    await reviewClientLead(lead.value.id, lead.value.version, reviewKey);
    reviewKey = undefined;
    reviewSuccess.value = '已确认侵权，等待运营确认是否取证';
    await load();
  } catch (error) {
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'VERSION_CONFLICT' || code === 'INVALID_STATE') {
      reviewError.value = '线索状态已变化，请刷新查看最新结果';
    } else if (code === 'IDEMPOTENCY_CONFLICT') {
      reviewKey = undefined;
      reviewError.value = '本次操作未执行，请重新确认后重试';
    } else if (code === 'ACTION_FORBIDDEN') {
      reviewError.value = '当前账号无权审核此线索，请刷新登录状态后重试';
    } else if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
      reviewError.value = '提交结果暂时未知，请重试；系统会安全处理重复请求';
    } else {
      reviewError.value = '确认侵权失败，请稍后重试';
    }
  } finally {
    reviewing.value = false;
  }
}

async function confirmNoInfringement(): Promise<void> {
  if (
    !lead.value ||
    !lead.value.capabilities.review ||
    reviewing.value ||
    lead.value.status !== 'WAITING_REVIEW'
  )
    return;
  const normalizedReason = noInfringementRetryLocked.value
    ? frozenNoInfringementReason
    : noInfringementReason.value.trim();
  if (!normalizedReason) return;
  if (
    !globalThis.window.confirm(
      '提交后线索将归档，当前版本不能在页面直接撤回。确定判定不侵权吗？',
    )
  )
    return;

  frozenNoInfringementReason ??= normalizedReason;
  noInfringementReason.value = frozenNoInfringementReason;
  noInfringementRetryLocked.value = true;
  noInfringementKey ??= makeReviewKey();
  reviewError.value = '';
  reviewSuccess.value = '';
  reviewing.value = true;
  try {
    await reviewClientLeadNoInfringement(
      lead.value.id,
      lead.value.version,
      frozenNoInfringementReason,
      noInfringementKey,
    );
    noInfringementKey = undefined;
    frozenNoInfringementReason = undefined;
    noInfringementRetryLocked.value = false;
    reviewSuccess.value = '已判定不侵权，线索已归档';
    await load();
  } catch (error) {
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'VERSION_CONFLICT' || code === 'INVALID_STATE') {
      noInfringementKey = undefined;
      frozenNoInfringementReason = undefined;
      noInfringementRetryLocked.value = false;
      reviewError.value = '线索状态已变化，请刷新查看最新结果';
    } else if (code === 'IDEMPOTENCY_CONFLICT') {
      noInfringementKey = undefined;
      frozenNoInfringementReason = undefined;
      noInfringementRetryLocked.value = false;
      reviewError.value = '本次操作未执行，请重新确认后重试';
    } else if (code === 'ACTION_FORBIDDEN') {
      reviewError.value = '当前账号无权审核此线索，请刷新登录状态后重试';
    } else if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
      reviewError.value =
        '提交结果暂时未知；原因和请求键已锁定，可安全重试或刷新查看结果';
    } else {
      reviewError.value =
        '判定不侵权失败；原因和请求键已锁定，可安全重试或刷新查看结果';
    }
  } finally {
    reviewing.value = false;
  }
}

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const current = await getClientLead(String(route.params.id), {
      signal: controller.signal,
    });
    const materials = await listOwnerMaterials('LEAD', current.id, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const allowed = new Set(current.leadScreenshotContentVersionIds);
    screenshots.value = materials.items.flatMap((material) =>
      material.status === 'ACTIVE'
        ? material.contentVersions
            .filter((version) => allowed.has(version.id))
            .map((version) => ({
              materialId: material.id,
              versionId: version.id,
              filename: version.originalFilename,
            }))
        : [],
    );
    lead.value = current;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}

async function download(materialId: string, versionId: string): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId);
  } catch {
    downloadError.value = '截图下载失败，请稍后重试';
  }
}

onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" :to="returnTo"
        >← 返回{{
          returnTo.query.view === 'processed' ? '已处理线索' : '待审核线索'
        }}</RouterLink
      >
      <p v-if="reviewSuccess" role="status" class="submit-success">
        {{ reviewSuccess }}
      </p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取线索</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>线索不存在或当前企业不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>线索详情暂时无法加载</h1>
        <ElButton data-test="refresh" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="lead">
        <div class="page-head">
          <div>
            <span class="pill">{{
              lead.status === 'WAITING_REVIEW'
                ? '线索待审核'
                : lead.status === 'WAITING_EVIDENCE_DECISION'
                  ? '线索待确认'
                  : '线索已归档'
            }}</span>
            <h1>{{ lead.businessNo }}</h1>
            <p>推送于 {{ formatTime(lead.pushedAt) }}</p>
          </div>
          <ElButton data-test="refresh" text @click="load">刷新</ElButton>
        </div>
        <section class="demo-card demo-card--pad">
          <dl class="demo-detail-grid" data-test="client-lead-facts">
            <div>
              <dt>权利人</dt>
              <dd>{{ lead.rightsHolderName }}</dd>
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
          </dl>
        </section>
        <section class="demo-card" data-test="client-lead-products">
          <h2 class="card-section-title">商品及估算</h2>
          <div class="demo-table-wrap">
            <table class="demo-table">
              <thead>
                <tr>
                  <th>名称／链接</th>
                  <th class="num">销量</th>
                  <th class="num">单价（元）</th>
                  <th class="num">评论数</th>
                  <th class="num">预估销售额（元）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="product in lead.products" :key="product.id">
                  <td>
                    <strong>{{ product.title || '未命名商品' }}</strong
                    ><a
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
          data-test="client-lead-attachments"
        >
          <h2 class="form-section-title">允许查看的截图</h2>
          <p v-if="screenshots.length === 0">未提供可查看截图</p>
          <ul v-else>
            <li v-for="item in screenshots" :key="item.versionId">
              <span>{{ item.filename }}</span
              ><ElButton
                text
                :data-test="`download-screenshot-${item.versionId}`"
                @click="download(item.materialId, item.versionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section class="demo-card demo-card--pad">
          <template v-if="lead.reviewDecision">
            <section
              class="client-review-record"
              data-test="client-review-record"
            >
              <h2 class="form-section-title">客户审核记录</h2>
              <p>
                审核结论：{{
                  lead.reviewDecision.result === 'INFRINGEMENT'
                    ? '确认侵权'
                    : '判定不侵权并归档'
                }}
              </p>
              <p v-if="lead.reviewDecision.result === 'NO_INFRINGEMENT'">
                不侵权原因：{{ lead.reviewDecision.reason }}
              </p>
              <p>审核人：{{ lead.reviewDecision.reviewerDisplayName }}</p>
              <p>审核时间：{{ formatTime(lead.reviewDecision.decidedAt) }}</p>
              <p v-if="lead.reviewDecision.result === 'INFRINGEMENT'">
                下一步：等待运营确认是否取证
              </p>
              <p v-else>
                归档时间：{{ formatTime(lead.reviewDecision.archivedAt) }}
              </p>
            </section>
          </template>
          <template v-else>
            <p>
              确认后，线索将进入“线索待确认”，由运营决定是否取证；当前入口不能撤回。
            </p>
            <ElButton
              v-if="
                lead.capabilities.review && lead.status === 'WAITING_REVIEW'
              "
              data-test="confirm-infringement"
              type="primary"
              :loading="reviewing"
              :disabled="reviewing"
              @click="confirmInfringement"
              >确认侵权</ElButton
            >
            <template
              v-if="
                lead.capabilities.review && lead.status === 'WAITING_REVIEW'
              "
            >
              <label
                class="field-label field-label--spaced"
                for="no-infringement-reason"
                >不侵权原因<RequiredFieldMark
              /></label>
              <textarea
                id="no-infringement-reason"
                v-model="noInfringementReason"
                class="text-area"
                data-test="no-infringement-reason"
                aria-required="true"
                maxlength="5000"
                :disabled="reviewing || noInfringementRetryLocked"
              />
              <p v-if="noInfringementRetryLocked" class="field-help">
                提交结果未确认，原因已锁定；可使用同一请求安全重试，或刷新查看服务端结果。
              </p>
              <ElButton
                data-test="confirm-no-infringement"
                type="primary"
                :loading="reviewing"
                :disabled="reviewing || !noInfringementReason.trim()"
                @click="confirmNoInfringement"
                >判定不侵权并归档</ElButton
              >
            </template>
          </template>
          <p v-if="reviewError" class="field-error" role="alert">
            {{ reviewError }}
          </p>
          <p v-if="!lead.reviewDecision">
            当前可查看线索内容；如需补充或反馈，请联系负责运营。
          </p>
        </section>
      </template>
    </main>
  </div>
</template>
