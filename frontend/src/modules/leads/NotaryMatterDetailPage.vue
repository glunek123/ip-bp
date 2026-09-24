<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { downloadMaterialVersion } from '../../api/materials';
import { getNotaryMatter, type NotaryMatterDetail } from '../../api/notary';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const matter = ref<NotaryMatterDetail>();
const downloadError = ref('');
let request: AbortController | undefined;

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
    const current = await getNotaryMatter(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    matter.value = current;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}

async function downloadMaterial(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, contentVersionId);
  } catch {
    downloadError.value = '附件下载失败，请稍后重试';
  }
}

onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink
        v-if="matter"
        class="back-link"
        :to="`/leads/${matter.sourceLead.id}`"
        >← 返回来源线索</RouterLink
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
        <div class="page-head">
          <div>
            <span class="pill">待公证处取证</span>
            <h1>{{ matter.businessNo }}</h1>
          </div>
          <ElButton data-test="refresh-matter" text @click="load"
            >刷新</ElButton
          >
        </div>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-matter-detail"
        >
          <h2 class="form-section-title">批次信息</h2>
          <dl class="demo-detail-grid">
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
