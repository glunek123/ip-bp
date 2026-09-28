<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { getCase, type CaseDetail } from '../../api/cases';
import { downloadMaterialVersion } from '../../api/materials';

const route = useRoute();
const id = computed(() => String(route.params.id));
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const item = ref<CaseDetail>();
const error = ref('');
const downloadError = ref('');
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  error.value = '';
  try {
    const result = await getCase(id.value, { signal: controller.signal });
    if (controller.signal.aborted) return;
    item.value = result;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    state.value =
      reason instanceof ApiError && reason.status === 404
        ? 'missing'
        : 'failed';
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取该案件。'
        : '案件暂时无法读取，请刷新重试。';
  }
}
async function download(materialId: string, versionId: string) {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId);
  } catch {
    downloadError.value = '文件下载失败，请稍后重试。';
  }
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <p><RouterLink to="/cases">返回案件列表</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取案件</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>案件不存在或已不可访问</h1>
        <p><RouterLink to="/cases">返回案件列表</RouterLink></p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>案件暂时无法读取</h1>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="item">
        <div class="page-head">
          <div>
            <p class="eyebrow">案件只读</p>
            <h1>{{ item.businessNo }}</h1>
            <p>
              <span class="pill">待匹配</span> · 创建于
              {{
                new Date(item.createdAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  hour12: false,
                })
              }}
            </p>
          </div>
          <ElButton text @click="load">刷新</ElButton>
        </div>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">来源与归属</h2>
          <p>部门：{{ item.department.name }}</p>
          <p>客户：{{ item.customer.name }}</p>
          <p>权利主体：{{ item.rightsHolder.name }}</p>
          <p>负责人：{{ item.owner.displayName }}</p>
          <p>来源线索：{{ item.sourceLead.businessNo }}</p>
          <p>来源公证事项：{{ item.sourceNotaryMatter.businessNo }}</p>
          <p>法院案号：未登记</p>
        </section>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">公证书</h2>
          <p>证书编号：{{ item.certificate.certificateNo }}</p>
          <p>出证日期：{{ item.certificate.certificateDate }}</p>
          <p>披露：{{ item.certificate.needDisclose ? '需要' : '不需要' }}</p>
          <ul>
            <li
              v-for="file in item.certificate.files"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <ul v-if="item.certificate.disclosureFiles.length">
            <li
              v-for="file in item.certificate.disclosureFiles"
              :key="file.contentVersionId"
            >
              披露材料：{{ file.originalFilename
              }}<ElButton
                text
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="submit-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">来源费用（只读）</h2>
          <ul>
            <li
              v-for="(fee, index) in item.fees"
              :key="`${fee.category}-${fee.sourceId}-${index}`"
            >
              {{
                fee.category === 'NOTARY'
                  ? '公证费'
                  : fee.category === 'SAMPLE'
                    ? '样品费'
                    : fee.category === 'INVESTIGATION'
                      ? '调查费'
                      : '披露费'
              }}：{{
                fee.state === 'PENDING' ? '待确认' : `¥ ${fee.amount}`
              }}（来自{{
                fee.sourceType === 'NOTARY_MATTER_EVIDENCE'
                  ? '公证事项取证记录'
                  : '公证出证'
              }}）
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>
