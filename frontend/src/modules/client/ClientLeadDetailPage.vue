<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { getClientLead, type ClientLead } from '../../api/client-leads';
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
const label = (value: string) => labels[value] ?? value;
const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });

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
      <RouterLink class="back-link" to="/client/leads"
        >← 返回待审核线索</RouterLink
      >
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
            <span class="pill">线索待审核</span>
            <h1>{{ lead.businessNo }}</h1>
            <p>推送于 {{ formatTime(lead.pushedAt) }}</p>
          </div>
          <ElButton data-test="refresh" text @click="load">刷新</ElButton>
        </div>
        <section class="demo-card demo-card--pad">
          <dl class="demo-detail-grid" data-test="client-lead-facts">
            <div>
              <dt>权利主体</dt>
              <dd>{{ lead.rightsHolderName }}</dd>
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
          </dl>
        </section>
        <section class="demo-card" data-test="client-lead-products">
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
          <p>本页面当前仅供查看，审核操作将在后续切片开放。</p>
        </section>
      </template>
    </main>
  </div>
</template>
