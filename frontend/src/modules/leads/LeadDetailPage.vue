<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { getLead, type LeadDetail } from '../../api/leads';
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
    const [customer, holder, materials] = await Promise.all([
      getCustomer(current.customerId, { signal: controller.signal }).catch(
        () => null,
      ),
      getCustomerRightsHolder(current.customerId, current.rightsHolderId, {
        signal: controller.signal,
      }).catch(() => null),
      listOwnerMaterials('LEAD', current.id, {
        signal: controller.signal,
      }).catch(() => null),
    ]);
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
            <RouterLink
              v-if="lead.capabilities.edit"
              data-test="edit-lead"
              :to="`/leads/${lead.id}/edit`"
              >编辑线索</RouterLink
            ><ElButton data-test="refresh" text @click="load">刷新</ElButton>
          </div>
        </div>
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
        <section class="demo-card demo-card--pad lead-record-meta">
          <h2 class="form-section-title">记录信息</h2>
          <p class="mono">创建于 {{ formatTime(lead.createdAt) }}</p>
          <p class="mono">
            更新于 {{ formatTime(lead.updatedAt) }} · 版本 {{ lead.version }}
          </p>
        </section>
      </template>
    </main>
  </div>
</template>
