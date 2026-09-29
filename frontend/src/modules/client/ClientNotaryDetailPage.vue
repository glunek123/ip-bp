<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import { ApiError } from '../../api/http';
import {
  getClientNotaryMatter,
  reviewClientNotaryOpening,
  type ClientNotaryMatterDetail,
} from '../../api/client-notary';
import { downloadMaterialVersion } from '../../api/materials';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const matter = ref<ClientNotaryMatterDetail>();
const result = ref<'' | 'INFRINGEMENT' | 'NO_INFRINGEMENT'>('');
const reason = ref('');
const reviewError = ref('');
const reviewSuccess = ref('');
const downloadError = ref('');
const submitting = ref(false);
const retryLocked = ref(false);
const retryAvailable = ref(false);
let idempotencyKey = '';
let submissionFingerprint = '';
let request: AbortController | undefined;

function makeKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `client-notary-review-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
function isReviewed(value: ClientNotaryMatterDetail | undefined): boolean {
  return (
    (value?.stage === 'ISSUANCE_DECISION' ||
      value?.stage === 'WAITING_CERTIFICATE' ||
      value?.stage === 'WAITING_RETURN' ||
      value?.stage === 'ARCHIVED') &&
    value.reviewDecision !== null
  );
}
function stageLabel(stage: ClientNotaryMatterDetail['stage']): string {
  return stage === 'UNBOX_REVIEW'
    ? '开箱待审核'
    : stage === 'ISSUANCE_DECISION'
      ? '开箱待确认'
      : stage === 'WAITING_CERTIFICATE'
        ? '待出证'
        : stage === 'WAITING_RETURN'
          ? '待退货'
          : '已归档';
}
async function load(): Promise<boolean> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const current = await getClientNotaryMatter(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return false;
    matter.value = current;
    state.value = 'ready';
    return true;
  } catch (error) {
    if (controller.signal.aborted) return false;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
    return false;
  }
}
async function downloadPhoto(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, contentVersionId);
  } catch {
    downloadError.value = '开箱照片下载失败，请稍后重试';
  }
}
async function submitReview(): Promise<void> {
  reviewError.value = '';
  reviewSuccess.value = '';
  const current = matter.value;
  const normalizedReason = reason.value.trim();
  if (
    !current?.capabilities.reviewOpening ||
    current.stage !== 'UNBOX_REVIEW' ||
    submitting.value
  )
    return;
  if (!result.value) {
    reviewError.value = '请选择审核结论';
    return;
  }
  if (result.value === 'NO_INFRINGEMENT' && !normalizedReason) {
    reviewError.value = '请填写不侵权原因';
    return;
  }
  if (
    (result.value === 'NO_INFRINGEMENT' ? normalizedReason : '').length > 2000
  ) {
    reviewError.value = '不侵权原因不能超过 2000 字';
    return;
  }
  const input = {
    result: result.value,
    ...(result.value === 'NO_INFRINGEMENT' ? { reason: normalizedReason } : {}),
    expectedVersion: current.version,
  } as const;
  const fingerprint = JSON.stringify(input);
  if (fingerprint !== submissionFingerprint) {
    submissionFingerprint = fingerprint;
    idempotencyKey = makeKey();
  }
  retryAvailable.value = false;
  submitting.value = true;
  try {
    await reviewClientNotaryOpening(current.id, input, idempotencyKey);
    notifyWorkflowChanged();
    const loaded = await load();
    if (
      loaded &&
      isReviewed(matter.value) &&
      matter.value?.reviewDecision?.result === input.result
    ) {
      reviewSuccess.value = '审核结论已保存。';
      idempotencyKey = '';
      submissionFingerprint = '';
      retryLocked.value = false;
      retryAvailable.value = false;
    } else {
      retryLocked.value = true;
      reviewError.value = '审核已提交，但暂时无法读取保存结果，请刷新确认。';
    }
  } catch (error) {
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'VERSION_CONFLICT' || code === 'INVALID_STATE') {
      idempotencyKey = '';
      submissionFingerprint = '';
      retryLocked.value = false;
      retryAvailable.value = false;
      reviewError.value = '事项状态或版本已变化，请刷新查看最新结论。';
    } else if (code === 'IDEMPOTENCY_CONFLICT') {
      idempotencyKey = '';
      submissionFingerprint = '';
      retryLocked.value = false;
      reviewError.value = '本次审核请求与已提交内容冲突，请刷新后重新审核。';
    } else if (code === 'ACTION_FORBIDDEN' || code === 'FORBIDDEN') {
      retryLocked.value = true;
      reviewError.value = '当前账号无权审核此事项，请刷新登录状态后重试。';
    } else if (code === 'RESOURCE_NOT_FOUND' || code === 'NOT_FOUND') {
      retryLocked.value = true;
      reviewError.value = '事项不存在或当前企业不可访问，请返回列表。';
    } else if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
      retryLocked.value = true;
      retryAvailable.value = true;
      reviewError.value =
        '提交结果暂时未知；结论、原因和请求键已锁定，可安全重试或刷新查看结果。';
    } else {
      retryLocked.value = true;
      reviewError.value = '开箱审核失败，请稍后重试或刷新查看结果。';
    }
  } finally {
    submitting.value = false;
  }
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink
        class="back-link"
        :to="{
          path: '/client/notary-matters',
          query:
            typeof route.query.sourceLeadId === 'string'
              ? { sourceLeadId: route.query.sourceLeadId }
              : {},
        }"
        >← 返回公证审核</RouterLink
      >
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取公证事项</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>公证事项不存在或当前企业不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>公证事项暂时无法加载</h1>
        <ElButton data-test="client-notary-refresh" @click="load"
          >重新加载</ElButton
        >
      </section>
      <template v-else-if="matter">
        <div class="page-head">
          <div>
            <span class="pill">{{ stageLabel(matter.stage) }}</span>
            <h1>{{ matter.businessNo }}</h1>
          </div>
          <ElButton text data-test="client-notary-refresh" @click="load"
            >刷新</ElButton
          >
        </div>
        <section class="demo-card demo-card--pad">
          <h2 class="form-section-title">批次信息</h2>
          <p>来源线索：{{ matter.sourceLead.businessNo }}</p>
          <p>创建时间：{{ formatTime(matter.createdAt) }}</p>
        </section>
        <section class="demo-card">
          <h2 class="card-section-title">本批次商品</h2>
          <div class="demo-table-wrap">
            <table class="demo-table">
              <thead>
                <tr>
                  <th>名称／链接</th>
                  <th class="num">数量</th>
                  <th class="num">单价</th>
                  <th class="num">评论数</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="product in matter.selectedProducts"
                  :key="product.id"
                >
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
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="demo-card demo-card--pad lead-attachments">
          <h2 class="form-section-title">已提交开箱照片</h2>
          <p>开箱时间：{{ formatTime(matter.opening.recordedAt) }}</p>
          <ul>
            <li
              v-for="photo in matter.opening.photos"
              :key="photo.contentVersionId"
            >
              {{ photo.originalFilename }}
              <ElButton
                text
                :data-test="`download-client-opening-photo-${photo.contentVersionId}`"
                @click="downloadPhoto(photo.materialId, photo.contentVersionId)"
                >下载照片</ElButton
              >
            </li>
          </ul>
          <p v-if="downloadError" class="field-error" role="alert">
            {{ downloadError }}
          </p>
        </section>
        <section
          v-if="
            matter.capabilities.reviewOpening && matter.stage === 'UNBOX_REVIEW'
          "
          class="demo-card demo-card--pad"
          data-test="client-opening-review-section"
        >
          <h2 class="form-section-title">开箱审核</h2>
          <form
            data-test="client-opening-review-form"
            @submit.prevent="submitReview"
          >
            <p>确认侵权后进入开箱待确认，由运营决定是否出证。</p>
            <p>不侵权将立即归档，普通入口不能撤回。</p>
            <label
              ><input
                v-model="result"
                data-test="client-review-result"
                type="radio"
                name="client-opening-review-result"
                value="INFRINGEMENT"
                :disabled="submitting || retryLocked"
              />确认侵权</label
            >
            <label
              ><input
                v-model="result"
                data-test="client-review-result-no-infringement"
                type="radio"
                name="client-opening-review-result"
                value="NO_INFRINGEMENT"
                :disabled="submitting || retryLocked"
              />判定不侵权</label
            >
            <label v-if="result === 'NO_INFRINGEMENT'"
              >不侵权原因<RequiredFieldMark /><textarea
                v-model="reason"
                data-test="client-opening-review-reason"
                maxlength="2000"
                required
                :disabled="submitting || retryLocked"
              />
            </label>
            <p v-if="reviewError" class="field-error" role="alert">
              {{ reviewError }}
            </p>
            <p v-if="reviewSuccess" role="status">{{ reviewSuccess }}</p>
            <ElButton
              data-test="client-opening-review-submit"
              native-type="submit"
              :loading="submitting"
              :disabled="submitting || (retryLocked && !retryAvailable)"
              >{{
                retryAvailable ? '使用相同请求键重试' : '提交审核结论'
              }}</ElButton
            >
          </form>
        </section>
        <section
          v-if="isReviewed(matter) && matter.reviewDecision"
          class="demo-card demo-card--pad"
          data-test="client-review-record"
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
          data-test="client-issuance-decision-record"
        >
          <h2 class="form-section-title">出证决定记录</h2>
          <p>
            决定：{{ matter.issuanceDecision.decision }} →
            {{
              matter.issuanceDecision.decision === 'ISSUE' ? '待出证' : '待退货'
            }}
          </p>
          <p>决定时间：{{ formatTime(matter.issuanceDecision.decidedAt) }}</p>
        </section>
        <section
          v-if="matter.returnArchive"
          class="demo-card demo-card--pad"
          data-test="client-return-archive-record"
        >
          <h2 class="form-section-title">退货办理结果</h2>
          <p>结论：事项已归档</p>
          <p>
            办理方式：{{
              matter.returnArchive.returnChoice === 'RETURN'
                ? '退货并退款'
                : matter.returnArchive.returnChoice === 'KEEP'
                  ? '保留商品，不退款'
                  : '不寄回商品，只退款'
            }}
          </p>
          <p>原因：{{ matter.returnArchive.archiveReason }}</p>
          <p>归档时间：{{ formatTime(matter.returnArchive.archivedAt) }}</p>
        </section>
      </template>
    </main>
  </div>
</template>
