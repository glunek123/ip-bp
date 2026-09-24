<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { downloadMaterialVersion } from '../../api/materials';
import {
  getNotaryMatter,
  recordNotaryEvidence,
  type NotaryMatterDetail,
  type RecordNotaryEvidenceInput,
} from '../../api/notary';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const matter = ref<NotaryMatterDetail>();
const downloadError = ref('');
const evidenceDate = ref('');
const sampleFeeState = ref('');
const sampleFeeAmount = ref('');
const logisticsRows = ref([
  { companyState: '', companyValue: '', trackingState: '', trackingValue: '' },
]);
const evidenceErrors = ref<string[]>([]);
const evidenceError = ref('');
const evidenceSuccess = ref('');
const submittingEvidence = ref(false);
let evidenceIdempotencyKey = '';
let evidenceSubmissionFingerprint = '';
let request: AbortController | undefined;

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

async function load(): Promise<void> {
  evidenceIdempotencyKey = '';
  evidenceSubmissionFingerprint = '';
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

function addLogisticsRow(): void {
  logisticsRows.value.push({
    companyState: '',
    companyValue: '',
    trackingState: '',
    trackingValue: '',
  });
}

function removeLogisticsRow(index: number): void {
  if (logisticsRows.value.length > 1) logisticsRows.value.splice(index, 1);
}

async function submitEvidence(): Promise<void> {
  evidenceErrors.value = [];
  evidenceError.value = '';
  evidenceSuccess.value = '';
  const errors: string[] = [];
  if (!evidenceDate.value) errors.push('请选择取证日期');
  if (!sampleFeeState.value) errors.push('请选择样品费用状态');
  if (
    sampleFeeState.value === 'KNOWN' &&
    !/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(sampleFeeAmount.value)
  )
    errors.push('已知样品费用请输入非负且保留两位小数的金额');
  if (logisticsRows.value.length < 1) errors.push('至少登记一条物流信息');
  logisticsRows.value.forEach((row, index) => {
    if (!row.companyState) errors.push(`第${index + 1}条请选择快递公司状态`);
    else if (row.companyState === 'PRESENT' && !row.companyValue.trim())
      errors.push(`第${index + 1}条请填写快递公司`);
    if (!row.trackingState) errors.push(`第${index + 1}条请选择快递单号状态`);
    else if (row.trackingState === 'PRESENT' && !row.trackingValue.trim())
      errors.push(`第${index + 1}条请填写快递单号`);
  });
  evidenceErrors.value = errors;
  if (
    errors.length ||
    !matter.value?.capabilities.recordEvidence ||
    matter.value.stage !== 'PENDING_EVIDENCE'
  )
    return;

  const current = matter.value;
  const feeInput =
    sampleFeeState.value === 'KNOWN'
      ? {
          sampleFeeState: 'KNOWN' as const,
          sampleFeeAmount: sampleFeeAmount.value,
        }
      : { sampleFeeState: 'PENDING' as const };
  const input: RecordNotaryEvidenceInput = {
    evidenceAt: evidenceDate.value,
    ...feeInput,
    logistics: logisticsRows.value.map((row) => ({
      companyState: row.companyState as 'PRESENT' | 'NONE',
      companyValue:
        row.companyState === 'PRESENT' ? row.companyValue.trim() : null,
      trackingState: row.trackingState as 'PRESENT' | 'NONE',
      trackingValue:
        row.trackingState === 'PRESENT' ? row.trackingValue.trim() : null,
    })),
    expectedVersion: current.version,
  };
  submittingEvidence.value = true;
  const fingerprint = JSON.stringify(input);
  if (fingerprint !== evidenceSubmissionFingerprint) {
    evidenceIdempotencyKey = globalThis.crypto.randomUUID();
    evidenceSubmissionFingerprint = fingerprint;
  }
  try {
    const saved = await recordNotaryEvidence(
      current.id,
      input,
      evidenceIdempotencyKey,
    );
    matter.value = {
      ...current,
      stage: saved.stage,
      version: saved.version,
      capabilities: { recordEvidence: false },
      evidence: saved.evidence,
    };
    evidenceIdempotencyKey = '';
    evidenceSubmissionFingerprint = '';
    evidenceSuccess.value = '取证物流已登记，事项已进入待开箱。';
  } catch (error) {
    evidenceError.value =
      error instanceof ApiError &&
      ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_STATE'].includes(
        error.code,
      )
        ? '事项状态或提交内容已变化，请刷新后再试。'
        : '取证物流登记失败，请检查网络或刷新后重试。';
  } finally {
    submittingEvidence.value = false;
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
            <span class="pill">{{
              matter.stage === 'WAITING_UNBOX' ? '等待开箱' : '待公证处取证'
            }}</span>
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
        <section
          v-if="
            matter.stage === 'PENDING_EVIDENCE' &&
            matter.capabilities.recordEvidence
          "
          class="demo-card demo-card--pad"
          data-test="evidence-form"
        >
          <h2 class="form-section-title">登记取证物流</h2>
          <p>提交后事项将进入待开箱。</p>
          <form data-test="record-evidence" @submit.prevent="submitEvidence">
            <label
              >取证日期<RequiredFieldMark />
              <input
                v-model="evidenceDate"
                data-test="evidence-date"
                type="date"
                required
            /></label>
            <label
              >样品费用状态<RequiredFieldMark />
              <select
                v-model="sampleFeeState"
                data-test="sample-fee-state"
                required
              >
                <option value="">请选择</option>
                <option value="KNOWN">已知</option>
                <option value="PENDING">待定</option>
              </select>
            </label>
            <label v-if="sampleFeeState === 'KNOWN'"
              >样品费用（元）<RequiredFieldMark />
              <input
                v-model="sampleFeeAmount"
                data-test="sample-fee-amount"
                inputmode="decimal"
                placeholder="0.00"
                required
            /></label>
            <fieldset v-for="(row, index) in logisticsRows" :key="index">
              <legend>物流 {{ index + 1 }}</legend>
              <label
                >快递公司状态<RequiredFieldMark />
                <select
                  v-model="row.companyState"
                  :data-test="`logistics-company-state-${index}`"
                  required
                >
                  <option value="">请选择</option>
                  <option value="PRESENT">有</option>
                  <option value="NONE">无</option>
                </select>
              </label>
              <label v-if="row.companyState === 'PRESENT'"
                >快递公司<RequiredFieldMark />
                <input
                  v-model="row.companyValue"
                  :data-test="`logistics-company-value-${index}`"
                  required
              /></label>
              <p v-else-if="row.companyState === 'NONE'">未登记快递公司</p>
              <label
                >快递单号状态<RequiredFieldMark />
                <select
                  v-model="row.trackingState"
                  :data-test="`logistics-tracking-state-${index}`"
                  required
                >
                  <option value="">请选择</option>
                  <option value="PRESENT">有</option>
                  <option value="NONE">无</option>
                </select>
              </label>
              <label v-if="row.trackingState === 'PRESENT'"
                >快递单号<RequiredFieldMark />
                <input
                  v-model="row.trackingValue"
                  :data-test="`logistics-tracking-value-${index}`"
                  required
              /></label>
              <p v-else-if="row.trackingState === 'NONE'">未登记快递单号</p>
              <button
                v-if="logisticsRows.length > 1"
                type="button"
                @click="removeLogisticsRow(index)"
              >
                删除此条
              </button>
            </fieldset>
            <button type="button" @click="addLogisticsRow">添加物流</button>
            <ul v-if="evidenceErrors.length" class="field-error" role="alert">
              <li v-for="error in evidenceErrors" :key="error">{{ error }}</li>
            </ul>
            <p v-if="evidenceError" class="field-error" role="alert">
              {{ evidenceError }}
            </p>
            <p v-if="evidenceSuccess" role="status">{{ evidenceSuccess }}</p>
            <ElButton
              data-test="record-evidence-submit"
              native-type="submit"
              :loading="submittingEvidence"
              :disabled="submittingEvidence"
              >登记并进入待开箱</ElButton
            >
          </form>
        </section>
        <section
          v-else-if="matter.evidence"
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
          <p v-if="evidenceSuccess" role="status">{{ evidenceSuccess }}</p>
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
