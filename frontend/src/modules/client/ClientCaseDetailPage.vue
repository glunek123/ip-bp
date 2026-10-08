<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { getClientCase, type ClientCaseDetail } from '../../api/client-cases';
import { ApiError } from '../../api/http';
import { downloadMaterialVersion } from '../../api/materials';
import { useAuthStore } from '../../stores/auth';
import { CaseComplaintMailingPanel } from '../cases';
const route = useRoute();
const auth = useAuthStore();
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const id = computed(() => String(route.params.id));
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const item = ref<ClientCaseDetail>();
const error = ref('');
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const result = await getClientCase(id.value, { signal: controller.signal });
    if (controller.signal.aborted) return;
    item.value = result;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    state.value =
      reason instanceof ApiError &&
      ['RESOURCE_NOT_FOUND', 'NOT_FOUND'].includes(reason.code)
        ? 'missing'
        : 'failed';
    error.value = '案件暂时无法读取，请重试。';
  }
}
async function download(file: {
  materialId: string;
  contentVersionId: string;
}) {
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch {
    error.value = '文件下载失败，请稍后重试。';
  }
}
watch(
  () => [id.value, identity.value],
  () => void load(),
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>
<template>
  <div class="page-view page-view--narrow">
    <main>
      <p><RouterLink to="/client/cases">返回案件列表</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取案件</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>案件不存在或已不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>案件暂时无法读取</h1>
        <p role="alert" class="submit-error">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="item"
        ><div class="page-head">
          <div>
            <p class="eyebrow">案件详情</p>
            <h1>{{ item.businessNo }}</h1>
            <p>
              <span class="pill">{{
                item.stage === 'WAITING_COMPLAINT_STAMP'
                  ? '诉状待盖章'
                  : item.stage === 'WAITING_FILING'
                    ? '待提交立案'
                    : item.stage === 'WAITING_FORMAL_ACCEPTANCE'
                      ? '待正式立案'
                      : item.stage === 'WAITING_JUDGMENT'
                        ? '待判决'
                        : '待开庭'
              }}</span>
              · 权利主体：{{ item.rightsHolderName }}
            </p>
          </div>
          <ElButton text @click="load">刷新</ElButton>
        </div>
        <p>被告：{{ item.defendantNames.join('、') }}</p>
        <p>
          确认标的额：{{
            item.confirmedAmountState === 'KNOWN'
              ? `¥ ${item.confirmedAmount}`
              : '待确认'
          }}
        </p>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">已确认材料</h2>
          <ul>
            <li v-if="item.complaintFile">
              诉状：{{ item.complaintFile.originalFilename
              }}<ElButton
                text
                data-test="client-complaint-download"
                @click="download(item!.complaintFile!)"
                >下载</ElButton
              >
            </li>
            <li
              v-for="(file, index) in item.authorizationFiles"
              :key="file.contentVersionId"
            >
              授权材料：{{ file.originalFilename
              }}<ElButton
                text
                :data-test="
                  index === 0 ? 'client-authorization-download' : undefined
                "
                @click="download(file)"
                >下载</ElButton
              >
            </li>
          </ul>
        </section>
        <CaseComplaintMailingPanel
          :item="item"
          client
          @changed="load"
          @refresh="load"
        />
        <section
          v-if="item.pendingReceiptFiles.length"
          class="demo-card demo-card--pad"
        >
          <h2 class="form-section-title">已上传的邮寄凭证</h2>
          <ul>
            <li
              v-for="file in item.pendingReceiptFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename
              }}<ElButton text @click="download(file)">下载</ElButton>
            </li>
          </ul>
        </section></template
      >
    </main>
  </div>
</template>
