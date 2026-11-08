<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElDialog } from 'element-plus/es/components/dialog/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import {
  readPendingLeadDecision,
  savePendingLeadDecision,
  type LeadDecisionAttempt,
} from './lead-decision-recovery';
import { getLead, type Lead, type LeadDetail } from '../../api/leads';
import {
  leadArchiveTypeLabels,
  leadBusinessDate,
  postLeadDecision,
  type LeadNoEvidenceArchiveType,
} from '../../api/lead-decisions';
import { listNotaryOffices, type NotaryOffice } from '../../api/notary';
import {
  labelLeadPlatform,
  leadInfringementTypeLabels,
  leadSourceLabels,
} from './lead-options';

const props = defineProps<{
  leads: readonly Pick<Lead, 'id' | 'businessNo'>[];
  identity: string;
  kind: 'review' | 'confirm';
  bulk?: boolean;
  beforeSubmit?: () => boolean;
}>();
const emit = defineEmits<{ close: []; completed: [] }>();
const details = ref<LeadDetail[]>([]);
const offices = ref<NotaryOffice[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const stale = ref(false);
const result = ref('');
const office = ref('');
const archiveType = ref<LeadNoEvidenceArchiveType | ''>('');
const date = ref(leadBusinessDate(new Date().toISOString()));
const reason = ref('');
const pending = shallowRef(readPendingLeadDecision(props.identity));
const shownLeads = computed(() => pending.value?.leads ?? props.leads);
const controller = new AbortController();
const review = computed(() => (pending.value?.kind ?? props.kind) === 'review');
const batch = computed(() => pending.value?.bulk ?? props.bulk === true);
const title = computed(() =>
  batch.value
    ? review.value
      ? '批量审核'
      : '批量确认'
    : (review.value ? '线索审核' : '线索确认') +
      ' · ' +
      shownLeads.value[0]?.businessNo,
);
const archive = computed(() =>
  ['NO_INFRINGEMENT', 'NO_EVIDENCE'].includes(result.value),
);
const allowTransfer = computed(
  () =>
    details.value.length > 0 &&
    details.value.every((lead) => lead.capabilities.transferToNotary),
);
const allowArchive = computed(
  () =>
    details.value.length > 0 &&
    details.value.every((lead) => lead.capabilities.evidenceDecide),
);
const valid = computed(
  () =>
    !loading.value &&
    !stale.value &&
    details.value.length > 0 &&
    !!result.value &&
    (result.value !== 'EVIDENCE' || (allowTransfer.value && !!office.value)) &&
    (!archive.value ||
      (!!date.value &&
        !!reason.value.trim() &&
        (review.value || (allowArchive.value && !!archiveType.value)))),
);
const locked = computed(() => busy.value || !!pending.value);

async function load() {
  loading.value = true;
  error.value = '';
  details.value = [];
  try {
    const loaded = await Promise.all(
      props.leads.map(async (lead, index) => {
        const detail = await getLead(lead.id, { signal: controller.signal });
        const available = review.value
          ? detail.status === 'WAITING_REVIEW' &&
            detail.capabilities.proxyReview
          : detail.status === 'WAITING_EVIDENCE_DECISION' &&
            (detail.capabilities.evidenceDecide ||
              detail.capabilities.transferToNotary);
        if (!available)
          throw new Error(
            '第 ' + (index + 1) + ' 条线索状态已变化或无权办理。',
          );
        return detail;
      }),
    );
    if (
      !review.value &&
      loaded.every((lead) => lead.capabilities.transferToNotary)
    )
      offices.value = (
        await listNotaryOffices({ signal: controller.signal })
      ).items;
    details.value = loaded;
    stale.value = false;
  } catch (failure) {
    if (!controller.signal.aborted)
      error.value =
        failure instanceof Error ? failure.message : '无法读取待办理线索。';
  } finally {
    loading.value = false;
  }
}

function command() {
  const items = details.value.map((lead) => ({
    leadId: lead.id,
    expectedVersion: lead.version,
  }));
  const first = items[0]!;
  const path = '/' + encodeURIComponent(first.leadId);
  const version = { expectedVersion: first.expectedVersion };
  const archiveFields = {
    archiveDate: date.value,
    reason: reason.value.trim(),
  };
  const key = globalThis.crypto.randomUUID();
  if (review.value) {
    const fields = {
      result: result.value,
      ...(archive.value ? archiveFields : {}),
    };
    return batch.value
      ? { path: '/batch-proxy-reviews', body: { items, ...fields }, key }
      : { path: path + '/proxy-reviews', body: { ...version, ...fields }, key };
  }
  if (result.value === 'EVIDENCE') {
    const fields = { notaryOfficeId: office.value };
    return batch.value
      ? {
          path: '/notary-matters/batch-confirm',
          body: { items, ...fields },
          key,
        }
      : {
          path: path + '/notary-matters/confirm',
          body: { ...version, ...fields },
          key,
        };
  }
  const fields = { ...archiveFields, archiveType: archiveType.value };
  return batch.value
    ? { path: '/batch-no-evidence', body: { items, ...fields }, key }
    : {
        path: path + '/evidence-decisions',
        body: { result: 'NO_EVIDENCE', ...version, ...fields },
        key,
      };
}

const failureLabels: Record<string, string> = {
  NOT_AVAILABLE: '不可办理',
  INVALID_STATE: '状态已变化',
  VERSION_CONFLICT: '资料版本已变化',
  CUSTOMER_NOT_ADMITTED: '客户未准入',
  LEAD_PRODUCTS_REQUIRED: '缺少可移交商品',
  NOTARY_OFFICE_UNAVAILABLE: '公证处不可用',
  CLIENT_ACCOUNT_UNAVAILABLE: '客户审核账号不可用',
};
function failureMessage(failure: ApiError): string {
  const failures = failure.details?.failures;
  if (!Array.isArray(failures)) return failure.message;
  return failures
    .map(
      ({ index, code }) =>
        '第 ' +
        (Number(index) + 1) +
        ' 条：' +
        (failureLabels[String(code)] ?? String(code)),
    )
    .join('；');
}

async function submit() {
  if (busy.value || (!pending.value && !valid.value)) return;
  if (!pending.value && props.beforeSubmit?.() === false) {
    error.value = '还有其他线索请求待核对，本次未发送。';
    return;
  }
  const recovering = !!pending.value;
  const attempt: LeadDecisionAttempt = pending.value ?? {
    ...command(),
    kind: props.kind,
    bulk: props.bulk === true,
    leads: props.leads.map(({ id, businessNo }) => ({ id, businessNo })),
  };
  const identity = props.identity;
  if (!recovering && !savePendingLeadDecision(identity, attempt)) {
    error.value = '无法保留本次请求，本次未发送。';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await postLeadDecision(attempt.path, attempt.body, attempt.key);
    savePendingLeadDecision(identity);
    if (!controller.signal.aborted && identity === props.identity) {
      pending.value = undefined;
      emit('completed');
    }
  } catch (failure) {
    if (controller.signal.aborted || identity !== props.identity) return;
    if (
      !recovering &&
      failure instanceof ApiError &&
      failure.status >= 400 &&
      failure.status < 500
    ) {
      savePendingLeadDecision(identity);
      pending.value = undefined;
      stale.value = failure.status === 409;
      error.value =
        (batch.value ? '本批未保存。' : '未保存。') + failureMessage(failure);
    } else {
      pending.value = attempt;
      error.value =
        failure instanceof ApiError && recovering
          ? failureMessage(failure) + ' 原请求已保留。'
          : '结果尚未确认，请按原请求核对。';
    }
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (pending.value) loading.value = false;
  else void load();
});
onBeforeUnmount(() => controller.abort());
onBeforeRouteLeave(() => !busy.value);
onBeforeRouteUpdate(() => !busy.value);
</script>

<template>
  <ElDialog
    :model-value="true"
    :title="title"
    width="min(820px, calc(100vw - 32px))"
    :show-close="!busy"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @close="emit('close')"
  >
    <p v-if="loading">正在读取线索…</p>
    <div v-if="pending && !details.length">
      <p>有一笔结果尚未确认的办理。</p>
      <ol class="lead-decision__list">
        <li v-for="lead in shownLeads" :key="lead.id">{{ lead.businessNo }}</li>
      </ol>
      <ElButton :disabled="busy" @click="emit('close')">暂时关闭</ElButton>
      <ElButton type="primary" :loading="busy" @click="submit"
        >按原请求核对</ElButton
      >
    </div>
    <form v-if="details.length" class="lead-decision" @submit.prevent="submit">
      <template v-if="batch">
        <p>已选 {{ details.length }} 条线索</p>
        <ol class="lead-decision__list">
          <li v-for="lead in details" :key="lead.id">
            {{ lead.businessNo }} · {{ lead.shopName }}
          </li>
        </ol>
      </template>
      <dl v-else class="lead-decision__facts">
        <template v-for="lead in details" :key="lead.id">
          <div>
            <dt>店铺名</dt>
            <dd>{{ lead.shopName }}</dd>
          </div>
          <template v-if="review">
            <div>
              <dt>平台</dt>
              <dd>{{ labelLeadPlatform(lead.platform) }}</dd>
            </div>
            <div>
              <dt>线索来源</dt>
              <dd>{{ leadSourceLabels[lead.source] }}</dd>
            </div>
            <div>
              <dt>侵权类型</dt>
              <dd>
                {{
                  lead.infringementTypes
                    .map((item) => leadInfringementTypeLabels[item])
                    .join('、') || '—'
                }}
              </dd>
            </div>
            <div>
              <dt>推送日期</dt>
              <dd>{{ leadBusinessDate(lead.pushedAt) }}</dd>
            </div>
          </template>
          <template v-else>
            <div>
              <dt>审核结果</dt>
              <dd>
                {{
                  lead.reviewDecision?.result === 'INFRINGEMENT' ? '侵权' : '—'
                }}
              </dd>
            </div>
            <div>
              <dt>审核日期</dt>
              <dd>
                {{ leadBusinessDate(lead.reviewDecision?.decidedAt ?? null) }}
              </dd>
            </div>
          </template>
        </template>
      </dl>
      <fieldset :disabled="locked">
        <label
          ><span
            >{{ review ? '审核结果' : '确认结果' }}<RequiredFieldMark
          /></span>
          <select v-model="result" required>
            <option value="" disabled>请选择</option>
            <template v-if="review">
              <option value="INFRINGEMENT">侵权</option>
              <option value="NO_INFRINGEMENT">不侵权</option>
            </template>
            <template v-else>
              <option value="EVIDENCE" :disabled="!allowTransfer">取证</option>
              <option value="NO_EVIDENCE" :disabled="!allowArchive">
                不取证
              </option>
            </template>
          </select>
        </label>
        <label v-if="result === 'EVIDENCE'"
          ><span>公证处<RequiredFieldMark /></span>
          <select v-model="office" aria-label="公证处" required>
            <option value="" disabled>请选择公证处</option>
            <option v-for="item in offices" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </label>
        <p v-if="result === 'EVIDENCE' && !offices.length">
          当前没有可用公证处。
        </p>
        <template v-if="archive">
          <label v-if="!review"
            ><span>归档类型<RequiredFieldMark /></span>
            <select v-model="archiveType" required>
              <option value="" disabled>请选择</option>
              <option
                v-for="(label, value) in leadArchiveTypeLabels"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select>
          </label>
          <label
            ><span>归档日期<RequiredFieldMark /></span
            ><input v-model="date" type="date" required
          /></label>
          <label
            ><span>归档原因<RequiredFieldMark /></span
            ><textarea v-model="reason" rows="3" maxlength="5000" required />
          </label>
        </template>
      </fieldset>
      <div class="lead-decision__actions">
        <ElButton native-type="button" :disabled="locked" @click="emit('close')"
          >取消</ElButton
        >
        <ElButton
          type="primary"
          native-type="submit"
          :disabled="busy || (!pending && !valid)"
          :loading="busy"
        >
          {{
            pending ? '按原请求核对' : review ? '提交审核结果' : '提交确认结果'
          }}
        </ElButton>
      </div>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton
      v-if="error && !locked && (stale || !details.length)"
      @click="load"
      >重新读取</ElButton
    >
  </ElDialog>
</template>

<style scoped>
.lead-decision__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 0 0 20px;
}
.lead-decision__facts dt {
  color: var(--color-ink-muted);
}
.lead-decision__facts dd {
  margin: 4px 0 0;
}
.lead-decision__list {
  max-height: 160px;
  overflow-y: auto;
}
.lead-decision fieldset {
  display: grid;
  gap: 12px;
  border: 0;
  padding: 0;
  margin: 0;
  min-inline-size: 0;
}
.lead-decision label {
  display: grid;
  gap: 4px;
}
.lead-decision select,
.lead-decision input,
.lead-decision textarea {
  width: 100%;
}
.lead-decision__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}
</style>
