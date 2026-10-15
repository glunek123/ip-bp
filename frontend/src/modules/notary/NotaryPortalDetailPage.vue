<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { downloadMaterialVersion } from '../../api/materials';
import {
  getNotaryPortalMatter,
  type NotaryPortalMatter,
} from '../../api/notary-portal';
import { useAuthStore } from '../../stores/auth';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import NotaryPortalWorkflowPanel from './NotaryPortalWorkflowPanel.vue';
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
const matterId = computed(() => String(route.params.id));
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const matter = ref<NotaryPortalMatter>();
const error = ref('');
const downloadError = ref('');
const certificateSuccess = ref('');
let request: AbortController | undefined;
const workflowGuidance = computed(() => {
  const current = matter.value;
  if (!current) return '';
  if (current.stage === 'WAITING_UNBOX')
    return '下一步由公证处登记开箱照片及有来源的寄件人信息，提交后交客户或获授权运营审核。';
  if (current.stage === 'UNBOX_REVIEW')
    return '开箱材料已提交，下一步由客户或获授权运营审核。公证处可在此查看已保存记录，等待运营通知后续安排。';
  if (current.stage === 'WAITING_CERTIFICATE')
    return '下一步由公证处登记真实公证书及所需材料；完成后由运营接手案件，在内部案件页面继续办理。';
  return current.certificate
    ? '公证事项已出证归档。下一步由运营在内部案件页面接手办理；公证处可在此查看出证结果及附件。'
    : '公证事项已归档。当前未提供出证结果，请联系运营核对归档结论及后续安排。';
});

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  matter.value = undefined;
  try {
    const result = await getNotaryPortalMatter(matterId.value, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    matter.value = result;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    state.value =
      reason instanceof ApiError && reason.status === 404
        ? 'missing'
        : 'failed';
    error.value = '事项暂时无法读取，请刷新重试。';
  }
}
const workflow = createListWorkflowContext<NotaryPortalMatter>(
  async () => {
    if (!matter.value) throw new Error('Missing matter');
    return matter.value;
  },
  { success: () => void load() },
);
const workflowState = workflow.state;
watch(
  matter,
  (current) => {
    if (!current) {
      void workflow.sync(null);
      return;
    }
    let saved: string | undefined;
    try {
      saved = ['opening', 'certificate'].find((action) =>
        globalThis.sessionStorage.getItem(
          'notary-portal-list-request:' +
            JSON.stringify([actorKey.value, current.id, action]),
        ),
      );
    } catch {
      /* The panel blocks dispatch when storage is unavailable. */
    }
    const actionKey =
      saved ??
      (current.capabilities.recordOpening
        ? 'opening'
        : current.capabilities.issueCertificate
          ? 'certificate'
          : null);
    void workflow.sync(
      actionKey
        ? {
            recordId: current.id,
            actorKey: actorKey.value,
            actionKey,
            title: '公证事项办理',
          }
        : null,
    );
  },
  { flush: 'sync' },
);
watch(
  [matterId, actorKey],
  () => {
    certificateSuccess.value = '';
    downloadError.value = '';
    void load();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  request?.abort();
  workflow.dispose();
});
async function download(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, contentVersionId);
  } catch {
    downloadError.value = '照片下载失败，请稍后重试。';
  }
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
</script>
<template>
  <div class="page-view page-view--narrow">
    <main>
      <p><RouterLink to="/notary-portal/matters">返回公证事项</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取事项</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>事项不存在或已不可访问</h1>
        <p>请返回列表刷新。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>事项暂时无法加载</h1>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="matter">
        <p v-if="workflowState.status === 'denied'" role="alert">
          当前无法办理该事项，请核对权限或返回列表刷新。
        </p>
        <div class="page-head">
          <div>
            <p class="eyebrow">公证处办理端</p>
            <h1>{{ matter.businessNo }}</h1>
            <p>
              {{
                matter.stage === 'WAITING_UNBOX'
                  ? '待开箱'
                  : matter.stage === 'UNBOX_REVIEW'
                    ? '开箱待审核'
                    : matter.stage === 'WAITING_CERTIFICATE'
                      ? '待出证'
                      : matter.certificate
                        ? '已出证'
                        : '已归档'
              }}
              · 创建于 {{ formatTime(matter.createdAt) }}
            </p>
          </div>
          <ElButton text @click="load">刷新</ElButton>
        </div>
        <section class="demo-card demo-card--pad" data-test="portal-workflow">
          <h2 class="form-section-title">流程推进</h2>
          <p>{{ workflowGuidance }}</p>
          <a
            v-if="
              matter.stage === 'WAITING_UNBOX' &&
              matter.capabilities.recordOpening
            "
            data-test="portal-workflow-action"
            href="#portal-opening-form"
            >填写开箱材料</a
          >
          <a
            v-else-if="
              matter.stage === 'WAITING_CERTIFICATE' &&
              matter.capabilities.issueCertificate
            "
            data-test="portal-workflow-action"
            href="#portal-certificate-form"
            >填写公证书资料</a
          >
          <p
            v-else-if="
              matter.stage === 'WAITING_UNBOX' ||
              matter.stage === 'WAITING_CERTIFICATE'
            "
          >
            当前记录未提供可办理入口，请刷新核对最新记录。
          </p>
        </section>
        <p v-if="matter.issuanceDecision" class="field-help">
          已审核同意出证：{{ matter.issuanceDecision.actorDisplayName }} ·
          {{ formatTime(matter.issuanceDecision.decidedAt) }}
        </p>
        <section v-if="matter.evidence" class="demo-card demo-card--pad">
          <h2 class="form-section-title">取证与物流</h2>
          <p>取证日期：{{ matter.evidence.evidenceAt }}</p>
          <ul>
            <li v-for="row in matter.evidence.logistics" :key="row.id">
              快递公司：{{
                row.companyState === 'NONE' ? '无' : row.companyValue
              }}；快递单号：{{
                row.trackingState === 'NONE' ? '无' : row.trackingValue
              }}
            </li>
          </ul>
        </section>
        <NotaryPortalWorkflowPanel
          v-if="workflowState.session && workflowState.status === 'ready'"
          :key="workflowState.session.contextKey"
          :detail="matter"
          :session="workflowState.session"
        />
        <section
          v-if="matter.opening"
          class="demo-card demo-card--pad"
          data-test="notary-saved-opening"
        >
          <h2 class="form-section-title">已保存的开箱记录</h2>
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
                data-test="notary-opening-photo-download"
                @click="download(photo.materialId, photo.contentVersionId)"
                >下载照片</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="submit-error" role="alert">
            {{ downloadError }}
          </p>
        </section>

        <section
          v-if="matter.stage === 'ARCHIVED' && matter.certificate"
          class="demo-card demo-card--pad"
          data-test="certificate-record"
        >
          <h2 class="form-section-title">已登记公证书</h2>
          <p>
            编号：{{ matter.certificate.certificateNo }} · 日期：{{
              matter.certificate.certificateDate
            }}
          </p>
          <p>案件编号：{{ matter.certificate.caseBusinessNo || '暂不可用' }}</p>
          <p>公证书文件</p>
          <ul>
            <li
              v-for="file in matter.certificate.files"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename
              }}<ElButton
                text
                :data-test="`download-certificate-${file.contentVersionId}`"
                @click="download(file.materialId, file.contentVersionId)"
                >下载</ElButton
              >
            </li>
          </ul>
          <p v-if="matter.certificate.disclosureFiles.length">披露文件</p>
          <ul>
            <li
              v-for="file in matter.certificate.disclosureFiles"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename
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
        <p
          v-if="certificateSuccess"
          class="submit-success"
          role="status"
          data-test="certificate-success"
        >
          {{ certificateSuccess }}
        </p>
      </template>
    </main>
  </div>
</template>
