<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCase,
  matchCase,
  type CaseDetail,
  type MatchCaseInput,
} from '../../api/cases';
import { downloadMaterialVersion } from '../../api/materials';

const route = useRoute();
const id = computed(() => String(route.params.id));
const backTo = computed(() => ({ path: '/cases', query: route.query }));
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const item = ref<CaseDetail>();
const error = ref('');
const downloadError = ref('');
const matchError = ref('');
const matchSuccess = ref('');
const submitting = ref(false);
type DefendantDraft = {
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string;
  phone: string;
  address: string;
};
const defendants = ref<DefendantDraft[]>([
  { kind: 'PERSON', name: '', idNo: '', phone: '', address: '' },
]);
const lawyer = ref({ fullName: '', lawFirm: '', phone: '' });
let submissionFingerprint = '';
let idempotencyKey = '';
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
function addDefendant() {
  if (defendants.value.length >= 20) return;
  defendants.value.push({
    kind: 'PERSON',
    name: '',
    idNo: '',
    phone: '',
    address: '',
  });
}
function removeDefendant(index: number) {
  if (defendants.value.length > 1) defendants.value.splice(index, 1);
}
function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function submitMatch() {
  const current = item.value;
  if (
    !current ||
    current.stage !== 'PENDING_MATCH' ||
    !current.canMatch ||
    submitting.value
  )
    return;
  matchError.value = '';
  matchSuccess.value = '';
  if (defendants.value.some(({ name }) => !name.trim())) {
    matchError.value = '请填写每位被告的名称。';
    return;
  }
  if (!lawyer.value.fullName.trim() || !lawyer.value.lawFirm.trim()) {
    matchError.value = '请填写主办律师姓名和律师事务所。';
    return;
  }
  const input: MatchCaseInput = {
    expectedVersion: current.version,
    idempotencyKey: '',
    defendants: defendants.value.map(
      ({ kind, name, idNo, phone, address }) => ({
        kind,
        name,
        idNo,
        phone,
        address,
      }),
    ),
    lawyer: { ...lawyer.value },
  };
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== submissionFingerprint) {
    submissionFingerprint = fingerprint;
    idempotencyKey = makeKey();
  }
  input.idempotencyKey = idempotencyKey;
  submitting.value = true;
  try {
    await matchCase(current.id, input);
    const fresh = await getCase(current.id);
    item.value = fresh;
    if (fresh.stage === 'WAITING_COMPLAINT' && fresh.matchedAt !== null) {
      matchSuccess.value = '案件匹配已完成，当前阶段为待写诉状。';
      submissionFingerprint = '';
      idempotencyKey = '';
    } else {
      matchError.value =
        '请求已提交，但尚未能从案件详情确认匹配结果；请刷新核实。';
    }
  } catch (reason) {
    if (
      reason instanceof ApiError &&
      (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
    ) {
      matchError.value = '案件状态或版本已变化，正在读取最新信息。';
      try {
        item.value = await getCase(current.id);
      } catch {
        /* Keep the confirmed prior detail visible. */
      }
      submissionFingerprint = '';
      idempotencyKey = '';
    } else if (
      reason instanceof ApiError &&
      (reason.status === 403 ||
        ['ACTION_FORBIDDEN', 'CASE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(
          reason.code,
        ))
    ) {
      matchError.value = '当前账号无权办理此案件。';
    } else if (
      reason instanceof ApiError &&
      ['RESOURCE_NOT_FOUND', 'NOT_FOUND'].includes(reason.code)
    ) {
      matchError.value = '案件不存在或当前账号不可访问。';
    } else if (
      reason instanceof ApiError &&
      reason.code === 'IDEMPOTENCY_CONFLICT'
    ) {
      matchError.value = '请求键已用于不同的匹配信息，请刷新案件后重新提交。';
      submissionFingerprint = '';
      idempotencyKey = '';
    } else if (
      reason instanceof ApiError &&
      reason.code === 'VALIDATION_ERROR'
    ) {
      matchError.value = '匹配信息未通过校验，请检查必填项和字段长度。';
    } else if (
      reason instanceof ApiError &&
      (reason.code === 'NETWORK_ERROR' || reason.code === 'TIMEOUT')
    ) {
      matchError.value =
        '提交结果暂时未知；表单已保留，可安全重试或刷新详情核实。';
    } else {
      matchError.value = '案件匹配未能完成，请检查信息后重试。';
    }
  } finally {
    submitting.value = false;
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
      <p><RouterLink :to="backTo">返回案件列表</RouterLink></p>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取案件</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>案件不存在或已不可访问</h1>
        <p><RouterLink :to="backTo">返回案件列表</RouterLink></p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>案件暂时无法读取</h1>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="item">
        <div class="page-head">
          <div>
            <p class="eyebrow">案件详情</p>
            <h1>{{ item.businessNo }}</h1>
            <p>
              <span class="pill">{{
                item.stage === 'PENDING_MATCH' ? '待匹配' : '待写诉状'
              }}</span>
              · 创建于
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
        <p v-if="matchSuccess" role="status">{{ matchSuccess }}</p>
        <section
          v-if="item.stage === 'PENDING_MATCH' && item.canMatch"
          class="demo-card demo-card--pad"
          data-test="case-match-form"
        >
          <h2 class="form-section-title">匹配当事人与承办律师</h2>
          <p class="field-help">
            提交后将保存全部被告和主办律师，并把案件推进到“待写诉状”。上述信息与阶段变更会一并保存。
          </p>
          <div
            v-for="(defendant, index) in defendants"
            :key="index"
            class="demo-form-grid"
          >
            <h3>被告 {{ index + 1 }}</h3>
            <label
              >主体类型
              <select v-model="defendant.kind" class="text-input">
                <option value="PERSON">自然人</option>
                <option value="ORGANIZATION">组织</option>
              </select></label
            >
            <label
              >名称 <span aria-hidden="true">*</span
              ><input
                v-model="defendant.name"
                class="text-input"
                required
                :aria-required="true"
            /></label>
            <label
              >身份证号（选填）<input
                v-model="defendant.idNo"
                class="text-input"
            /></label>
            <label
              >电话（选填）<input v-model="defendant.phone" class="text-input"
            /></label>
            <label
              >地址（选填）<input
                v-model="defendant.address"
                class="text-input"
            /></label>
            <ElButton
              v-if="defendants.length > 1"
              text
              @click="removeDefendant(index)"
              >移除此被告</ElButton
            >
          </div>
          <ElButton
            text
            :disabled="defendants.length >= 20"
            @click="addDefendant"
            >添加被告（最多 20 位）</ElButton
          >
          <div class="demo-form-grid">
            <h3>主办律师</h3>
            <label
              >律师姓名 <span aria-hidden="true">*</span
              ><input
                v-model="lawyer.fullName"
                class="text-input"
                required
                :aria-required="true"
            /></label>
            <label
              >律师事务所 <span aria-hidden="true">*</span
              ><input
                v-model="lawyer.lawFirm"
                class="text-input"
                required
                :aria-required="true"
            /></label>
            <label
              >电话（选填）<input v-model="lawyer.phone" class="text-input"
            /></label>
          </div>
          <p v-if="matchError" class="submit-error" role="alert">
            {{ matchError }}
          </p>
          <ElButton
            type="primary"
            :loading="submitting"
            :disabled="submitting"
            @click="submitMatch"
            >确认匹配并进入待写诉状</ElButton
          >
        </section>
        <section
          v-else-if="item.stage === 'PENDING_MATCH'"
          class="demo-card demo-card--pad"
          data-test="case-read-only"
        >
          <h2 class="form-section-title">案件只读</h2>
          <p>你可以查看案件和下载获准材料；当前账号不能办理此案。</p>
        </section>
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
          <h2 class="form-section-title">当事人与承办律师</h2>
          <p v-if="item.defendants.length === 0" class="field-help">
            尚未登记被告。
          </p>
          <ul v-else>
            <li v-for="defendant in item.defendants" :key="defendant.id">
              {{ defendant.kind === 'PERSON' ? '自然人' : '组织' }}：{{
                defendant.name
              }}
              <span v-if="defendant.idNo"> · 证件号 {{ defendant.idNo }}</span>
              <span v-if="defendant.phone"> · 电话 {{ defendant.phone }}</span>
              <span v-if="defendant.address">
                · 地址 {{ defendant.address }}</span
              >
            </li>
          </ul>
          <p v-if="item.lawyers.length === 0" class="field-help">
            尚未登记承办律师。
          </p>
          <ul v-else>
            <li v-for="entry in item.lawyers" :key="entry.id">
              {{ entry.fullName }}（{{ entry.lawFirm }}）<span
                v-if="entry.phone"
              >
                · 电话 {{ entry.phone }}</span
              >
            </li>
          </ul>
          <p v-if="item.matchedAt" class="field-help">
            匹配时间：{{
              new Date(item.matchedAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })
            }}
          </p>
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
