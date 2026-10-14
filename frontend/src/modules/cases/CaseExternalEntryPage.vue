<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createExternalCaseEntry,
  getExternalEntryOptions,
  todayShanghai,
  type CaseStage,
  type ExternalCaseEntryInput,
  type ExternalEntryKind,
  type ExternalEntryOptions,
} from '../../api/cases';
import type { InfringementType } from '../../api/leads';

type DefendantDraft = {
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string;
  phone: string;
  address: string;
};

const router = useRouter();
const options = ref<ExternalEntryOptions | null>(null);
const loading = ref(true);
const submitting = ref(false);
const loadError = ref('');
const submitError = ref('');
const uncertainRequest = ref<ExternalCaseEntryInput | null>(null);
const entryKind = ref<ExternalEntryKind | ''>('');
const initialStage = ref<CaseStage | ''>('');
const stageReachedOn = ref('');
const source = ref('');
const reason = ref('');
const customerId = ref('');
const rightsHolderId = ref('');
const lawyerAccountId = ref('');
const lawyerProfileId = ref('');
const defendants = ref<DefendantDraft[]>([]);
const known = ref<ExternalCaseEntryInput['known']>({
  courtId: null,
  courtCaseNo: null,
  acceptedOn: null,
  secondInstanceAcceptedOn: null,
  platform: null,
  shopName: null,
  shopExternalId: null,
  caseType: null,
  infringementTypes: null,
});
const selectedCustomer = computed(() =>
  options.value?.customers.find((item) => item.id === customerId.value),
);
const rightsHolders = computed(
  () => selectedCustomer.value?.rightsHolders ?? [],
);
const selectedStage = computed<CaseStage | null>(() =>
  initialStage.value === '' ? null : initialStage.value,
);
const needsMatch = computed(() => selectedStage.value === 'PENDING_MATCH');
const isArchived = computed(() => selectedStage.value === 'ARCHIVED');
const canSubmit = computed(
  () =>
    options.value?.canCreate === true &&
    (!isArchived.value || options.value.canCreateArchived) &&
    entryKind.value !== '' &&
    selectedStage.value !== null &&
    stageReachedOn.value !== '' &&
    source.value.trim() !== '' &&
    reason.value.trim() !== '' &&
    customerId.value !== '' &&
    rightsHolderId.value !== '' &&
    (known.value.infringementTypes === null ||
      known.value.infringementTypes.length > 0) &&
    !submitting.value &&
    uncertainRequest.value === null,
);

async function loadOptions() {
  loading.value = true;
  loadError.value = '';
  try {
    options.value = await getExternalEntryOptions();
  } catch (error) {
    options.value = null;
    loadError.value =
      error instanceof ApiError && error.status === 403
        ? '当前账号没有转入／补录权限。'
        : '当前无法读取转入／补录所需的正式选项，请刷新后重试。';
  } finally {
    loading.value = false;
  }
}
function addDefendant() {
  defendants.value.push({
    kind: 'ORGANIZATION',
    name: '',
    idNo: '',
    phone: '',
    address: '',
  });
}
function removeDefendant(index: number) {
  defendants.value.splice(index, 1);
}
function setCustomer(value: string) {
  customerId.value = value;
  rightsHolderId.value = '';
}
function setLawyer(value: string) {
  const selected = options.value?.lawyers.find(
    (item) => item.accountId === value,
  );
  lawyerAccountId.value = selected?.accountId ?? '';
  lawyerProfileId.value = selected?.profileId ?? '';
}
function toggleInfringement(value: InfringementType, checked: boolean) {
  if (known.value.infringementTypes === null) return;
  const selected = new Set(known.value.infringementTypes);
  if (checked) selected.add(value);
  else selected.delete(value);
  known.value.infringementTypes = [...selected];
}
function createInput(idempotencyKey: string): ExternalCaseEntryInput {
  const selected = selectedStage.value;
  if (selected === null || entryKind.value === '')
    throw new Error('案件阶段或录入类型未选择');
  return {
    idempotencyKey,
    entryKind: entryKind.value,
    initialStage: selected,
    stageReachedOn: stageReachedOn.value,
    source: source.value.trim(),
    reason: reason.value.trim(),
    customerId: customerId.value,
    rightsHolderId: rightsHolderId.value,
    defendants: needsMatch.value
      ? []
      : defendants.value
          .filter((defendant) => defendant.name.trim() !== '')
          .map((defendant) => ({
            kind: defendant.kind,
            name: defendant.name.trim(),
            ...(defendant.idNo.trim() ? { idNo: defendant.idNo.trim() } : {}),
            ...(defendant.phone.trim()
              ? { phone: defendant.phone.trim() }
              : {}),
            ...(defendant.address.trim()
              ? { address: defendant.address.trim() }
              : {}),
          })),
    lawyerAccountId:
      needsMatch.value || lawyerAccountId.value === ''
        ? null
        : lawyerAccountId.value,
    lawyerProfileId:
      needsMatch.value || lawyerProfileId.value === ''
        ? null
        : lawyerProfileId.value,
    known: {
      ...known.value,
      courtCaseNo: known.value.courtCaseNo?.trim() || null,
      shopName: known.value.shopName?.trim() || null,
      shopExternalId: known.value.shopExternalId?.trim() || null,
      infringementTypes:
        known.value.infringementTypes === null
          ? null
          : [...known.value.infringementTypes],
    },
  };
}
async function submit(input = createInput(globalThis.crypto.randomUUID())) {
  if (input.initialStage === 'ARCHIVED' && !options.value?.canCreateArchived) {
    submitError.value = '直接录入已归档案件需要额外授权。';
    return;
  }
  submitError.value = '';
  submitting.value = true;
  try {
    const created = await createExternalCaseEntry(input);
    uncertainRequest.value = null;
    await router.replace(`/cases/${encodeURIComponent(created.id)}`);
  } catch (error) {
    const uncertain =
      !(error instanceof ApiError) || error.status >= 500 || error.status === 0;
    uncertainRequest.value = uncertain ? input : null;
    submitError.value = uncertain
      ? '提交结果暂时无法确认。请保留原请求并使用下方按钮按原内容重试。'
      : error instanceof ApiError && error.status === 403
        ? '当前授权或案件范围已变化，请重新读取选项。'
        : '案件未能保存。请检查真实资料、日期和当前授权后重试。';
  } finally {
    submitting.value = false;
  }
}
function submitForm() {
  if (!canSubmit.value) return;
  const selected = selectedStage.value;
  if (selected === null) return;
  if (isArchived.value && !options.value?.canCreateArchived) {
    submitError.value = '直接录入已归档案件需要额外授权。';
    return;
  }
  const blankNames =
    !needsMatch.value &&
    defendants.value.some((defendant) => defendant.name.trim() === '');
  if (blankNames) {
    submitError.value = '请补齐已添加的被告真实姓名，或移除空白行。';
    return;
  }
  void submit();
}
function stageNextAction(stage: CaseStage | null): string {
  if (stage === 'PENDING_MATCH')
    return '待匹配：在后续正常匹配时录入真实被告和承办律师。';
  if (stage === 'WAITING_COMPLAINT')
    return '下一步需提交真实起诉材料和实际金额状态。';
  if (stage === 'WAITING_COMPLAINT_CONFIRMATION')
    return '下一步需选择并确认真实当前诉状版本。';
  if (stage === 'WAITING_COMPLAINT_STAMP')
    return '下一步需登记真实邮寄日期和回执。';
  if (stage === 'WAITING_FILING') return '下一步需提交真实法院立案资料。';
  if (stage === 'WAITING_FORMAL_ACCEPTANCE')
    return '下一步需登记真实法院受理信息。';
  if (stage === 'WAITING_HEARING') return '下一步需登记真实开庭排期。';
  if (stage === 'WAITING_JUDGMENT')
    return '下一步需登记真实判决及独立的后续选择。';
  if (stage === 'SECOND_INSTANCE') return '下一步需录入真实二审资料或结果。';
  if (stage === 'WAITING_EXECUTION_DOCUMENTS')
    return '下一步需提交真实执行材料。';
  if (stage === 'WAITING_EXECUTION_CONFIRMATION')
    return '下一步需确认真实当前执行材料。';
  if (stage === 'WAITING_EXECUTION_STAMP')
    return '下一步需登记真实邮寄日期和回执。';
  if (stage === 'WAITING_EXECUTION_FILING')
    return '下一步需提交真实执行立案资料。';
  if (stage === 'EXECUTING')
    return '下一步需登记真实执行结束日期、原因和依据。';
  if (stage === 'WAITING_ARCHIVE')
    return '下一步需登记真实结案资料，再按正常流程归档。';
  if (stage === 'ARCHIVED')
    return '已归档案件只记录本次补录来源，不创建旧归档事实。';
  return '请选择实际当前阶段。';
}
onMounted(() => void loadOptions());
</script>

<template>
  <div class="page-view case-external-entry-page">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">案件</p>
          <h1>转入／补录案件</h1>
          <p>记录真实当前状态和资料来源；没有的信息保留未知。</p>
        </div>
        <ElButton text @click="router.push('/cases')">返回案件</ElButton>
      </div>

      <section
        v-if="loading"
        class="state-panel ledger-panel"
        aria-live="polite"
      >
        <h2>正在读取正式选项</h2>
      </section>
      <section v-else-if="loadError" class="state-panel ledger-panel">
        <h2>暂时无法录入</h2>
        <p class="submit-error" role="alert">{{ loadError }}</p>
        <ElButton type="primary" @click="loadOptions">重新读取</ElButton>
      </section>
      <section v-else-if="options" class="demo-card demo-card--pad">
        <p v-if="!options.canCreate" class="field-help" role="status">
          当前账号没有转入／补录权限。客户和律师候选不会在未授权时显示。
        </p>
        <template v-else>
          <p class="field-help">
            当前负责人：{{
              options.currentUser.displayName
            }}。录入只记录当前状态，不补造未在本系统发生的流程事实。
          </p>
          <form class="case-entry-form" @submit.prevent="submitForm">
            <div class="demo-form-grid">
              <label>
                录入类型 <span aria-hidden="true">*</span>
                <select
                  v-model="entryKind"
                  required
                  :disabled="uncertainRequest !== null"
                >
                  <option value="" disabled>请选择</option>
                  <option value="EXTERNAL_TRANSFER">
                    外部转入（在办案件）
                  </option>
                  <option value="HISTORICAL_BACKFILL">历史案件补录</option>
                </select>
              </label>
              <label>
                当前阶段 <span aria-hidden="true">*</span>
                <select
                  v-model="initialStage"
                  required
                  :disabled="uncertainRequest !== null"
                >
                  <option value="" disabled>请选择实际阶段</option>
                  <option
                    v-for="stage in options.dictionaries.stages"
                    :key="stage.value"
                    :value="stage.value"
                    :disabled="
                      stage.value === 'ARCHIVED' && !options.canCreateArchived
                    "
                  >
                    {{ stage.label
                    }}{{ stage.value === 'ARCHIVED' ? ' · 需额外授权' : '' }}
                  </option>
                </select>
              </label>
              <label>
                当前阶段真实业务日期 <span aria-hidden="true">*</span>
                <input
                  v-model="stageReachedOn"
                  type="date"
                  required
                  :max="todayShanghai()"
                  :disabled="uncertainRequest !== null"
                />
              </label>
              <label>
                资料来源 <span aria-hidden="true">*</span>
                <input
                  v-model="source"
                  type="text"
                  maxlength="500"
                  required
                  placeholder="填写实际来源，例如外部系统、客户提供的案件资料"
                  :disabled="uncertainRequest !== null"
                />
              </label>
              <label class="case-entry-form__wide">
                转入／补录原因 <span aria-hidden="true">*</span>
                <textarea
                  v-model="reason"
                  maxlength="500"
                  rows="3"
                  required
                  :disabled="uncertainRequest !== null"
                />
              </label>
              <label>
                客户 <span aria-hidden="true">*</span>
                <select
                  :value="customerId"
                  required
                  :disabled="uncertainRequest !== null"
                  @change="
                    setCustomer(($event.target as HTMLSelectElement).value)
                  "
                >
                  <option value="" disabled>请选择已准入客户</option>
                  <option
                    v-for="customer in options.customers"
                    :key="customer.id"
                    :value="customer.id"
                  >
                    {{ customer.name }}
                  </option>
                </select>
              </label>
              <label>
                权利主体 <span aria-hidden="true">*</span>
                <select
                  v-model="rightsHolderId"
                  required
                  :disabled="!selectedCustomer || uncertainRequest !== null"
                >
                  <option value="" disabled>
                    请选择该客户已关联的权利主体
                  </option>
                  <option
                    v-for="holder in rightsHolders"
                    :key="holder.id"
                    :value="holder.id"
                  >
                    {{ holder.name }}
                  </option>
                </select>
              </label>
            </div>

            <section
              class="case-entry-subsection"
              aria-labelledby="entry-parties-title"
            >
              <div class="case-entry-subsection__head">
                <div>
                  <h2 id="entry-parties-title">真实当事人与承办</h2>
                  <p class="field-help">
                    不确定的被告和律师可以留空；只录入已核实的当前信息。
                  </p>
                </div>
                <ElButton
                  v-if="!needsMatch"
                  :disabled="uncertainRequest !== null"
                  @click="addDefendant"
                  >添加被告</ElButton
                >
              </div>
              <p v-if="needsMatch" class="field-help" role="note">
                案件待匹配阶段不在转入时添加被告或律师。请在后续正常匹配时录入真实被告和有效承办律师。
              </p>
              <template v-else>
                <div
                  v-for="(defendant, index) in defendants"
                  :key="index"
                  class="case-entry-defendant"
                >
                  <label>
                    类型
                    <select
                      v-model="defendant.kind"
                      :disabled="uncertainRequest !== null"
                    >
                      <option value="ORGANIZATION">组织</option>
                      <option value="PERSON">个人</option>
                    </select>
                  </label>
                  <label>
                    真实姓名／名称
                    <input
                      v-model="defendant.name"
                      type="text"
                      maxlength="200"
                      :disabled="uncertainRequest !== null"
                    />
                  </label>
                  <label>
                    身份证件号码（已知时）
                    <input
                      v-model="defendant.idNo"
                      type="text"
                      maxlength="100"
                      :disabled="uncertainRequest !== null"
                    />
                  </label>
                  <label>
                    电话（已知时）
                    <input
                      v-model="defendant.phone"
                      type="text"
                      maxlength="100"
                      :disabled="uncertainRequest !== null"
                    />
                  </label>
                  <label class="case-entry-form__wide">
                    地址（已知时）
                    <input
                      v-model="defendant.address"
                      type="text"
                      maxlength="500"
                      :disabled="uncertainRequest !== null"
                    />
                  </label>
                  <ElButton
                    text
                    type="danger"
                    :disabled="uncertainRequest !== null"
                    @click="removeDefendant(index)"
                    >移除</ElButton
                  >
                </div>
                <label class="case-entry-lawyer">
                  当前承办律师（可选）
                  <select
                    :value="lawyerAccountId"
                    :disabled="uncertainRequest !== null"
                    @change="
                      setLawyer(($event.target as HTMLSelectElement).value)
                    "
                  >
                    <option value="">暂不指定</option>
                    <option
                      v-for="lawyer in options.lawyers"
                      :key="lawyer.accountId"
                      :value="lawyer.accountId"
                    >
                      {{ lawyer.fullName
                      }}{{ lawyer.firm ? ` · ${lawyer.firm}` : '' }}
                    </option>
                  </select>
                </label>
              </template>
            </section>

            <details class="case-entry-known">
              <summary>已知资料（可选；未知项保留为空）</summary>
              <div class="demo-form-grid">
                <label>
                  法院（已知时）
                  <select
                    v-model="known.courtId"
                    :disabled="uncertainRequest !== null"
                  >
                    <option :value="null">未知</option>
                    <option
                      v-for="court in options.dictionaries.courts"
                      :key="court.id"
                      :value="court.id"
                    >
                      {{ court.name }}
                    </option>
                  </select>
                </label>
                <label>
                  法院案号（已知时）
                  <input
                    v-model="known.courtCaseNo"
                    type="text"
                    maxlength="200"
                    :disabled="uncertainRequest !== null"
                  />
                </label>
                <label>
                  受理日期（已知时）
                  <input
                    v-model="known.acceptedOn"
                    type="date"
                    :max="todayShanghai()"
                    :disabled="uncertainRequest !== null"
                  />
                </label>
                <label>
                  二审受理日期（已知时）
                  <input
                    v-model="known.secondInstanceAcceptedOn"
                    type="date"
                    :max="todayShanghai()"
                    :disabled="uncertainRequest !== null"
                  />
                </label>
                <label>
                  平台（已知时）
                  <select
                    v-model="known.platform"
                    :disabled="uncertainRequest !== null"
                  >
                    <option :value="null">未知</option>
                    <option
                      v-for="item in options.dictionaries.platforms"
                      :key="item.value"
                      :value="item.value"
                    >
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <label>
                  店铺（已知时）
                  <input
                    v-model="known.shopName"
                    type="text"
                    maxlength="200"
                    :disabled="uncertainRequest !== null"
                  />
                </label>
                <label>
                  店铺ID（已知时）
                  <input
                    v-model="known.shopExternalId"
                    type="text"
                    maxlength="200"
                    :disabled="uncertainRequest !== null"
                  />
                </label>
                <label>
                  案件类型（已知时）
                  <select
                    v-model="known.caseType"
                    :disabled="uncertainRequest !== null"
                  >
                    <option :value="null">未知</option>
                    <option
                      v-for="item in options.dictionaries.caseTypes"
                      :key="item.value"
                      :value="item.value"
                    >
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <fieldset class="case-entry-form__wide">
                  <legend>侵权类型（已知时）</legend>
                  <label class="case-entry-unknown-choice">
                    <input
                      type="checkbox"
                      :checked="known.infringementTypes === null"
                      :disabled="uncertainRequest !== null"
                      @change="
                        known.infringementTypes = (
                          $event.target as HTMLInputElement
                        ).checked
                          ? null
                          : []
                      "
                    />
                    侵权类型未知
                  </label>
                  <div
                    v-if="known.infringementTypes !== null"
                    class="case-entry-options"
                  >
                    <label
                      v-for="item in options.dictionaries.infringementTypes"
                      :key="item.value"
                      class="case-entry-unknown-choice"
                    >
                      <input
                        type="checkbox"
                        :value="item.value"
                        :checked="known.infringementTypes.includes(item.value)"
                        :disabled="uncertainRequest !== null"
                        @change="
                          toggleInfringement(
                            item.value,
                            ($event.target as HTMLInputElement).checked,
                          )
                        "
                      />
                      {{ item.label }}
                    </label>
                  </div>
                  <p
                    v-if="known.infringementTypes?.length === 0"
                    class="field-help"
                  >
                    请选择真实已知类型，或勾选“侵权类型未知”。
                  </p>
                </fieldset>
              </div>
            </details>

            <section class="case-entry-next" aria-live="polite">
              <h2>录入后的正常流程</h2>
              <p>{{ stageNextAction(selectedStage) }}</p>
              <p
                v-if="isArchived && !options.canCreateArchived"
                class="submit-error"
              >
                直接录入已归档案件需要高风险授权。
              </p>
            </section>
            <p v-if="submitError" class="submit-error" role="alert">
              {{ submitError }}
            </p>
            <div class="case-entry-actions">
              <ElButton :disabled="submitting" @click="router.push('/cases')"
                >取消</ElButton
              >
              <ElButton
                v-if="uncertainRequest"
                type="primary"
                :loading="submitting"
                @click="submit(uncertainRequest)"
              >
                按原请求重试
              </ElButton>
              <ElButton
                v-else
                type="primary"
                native-type="submit"
                :loading="submitting"
                :disabled="!canSubmit"
              >
                保存真实当前状态
              </ElButton>
            </div>
          </form>
        </template>
      </section>
    </main>
  </div>
</template>
