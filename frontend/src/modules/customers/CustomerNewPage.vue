<script setup lang="ts">
import './customer-workspace.css';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createCustomerDraft,
  findCustomerDuplicates,
  getCustomerCreationContext,
  type CustomerCreationContext,
  type CustomerDuplicateSummary,
} from '../../api/customers';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { useUnsavedForm } from '../../app/use-unsaved-form';
import type { AgreementValidityMode } from '../../api/customer-agreements-invoice';

const router = useRouter();
const props = withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false,
});
const embedded = computed(() => props.embedded);
const emit = defineEmits<{
  saved: [customerId: string];
  closeRequested: [];
}>();
const name = ref('');
const identityNumber = ref('');
const category = ref('');
const region = ref('');
const responsibleUserId = ref('');
const agreementTitle = ref('');
const model = ref('');
const settlementMethod = ref('');
const settlementFormula = ref('');
const agreementValidityMode = ref<AgreementValidityMode>('UNKNOWN');
const agreementEffectiveFrom = ref('');
const agreementEffectiveTo = ref('');
const creationContext = ref<CustomerCreationContext>();
const creationContextLoading = ref(false);
const creationContextError = ref('');
const additionalFieldsError = ref('');
let contextRequest: AbortController | undefined;
const regionOptions = [
  '华东',
  '华南',
  '华北',
  '华中',
  '西南',
  '西北',
  '东北',
  '海外',
];
const hasAgreementFields = computed(() =>
  Boolean(
    agreementTitle.value.trim() ||
    model.value ||
    settlementMethod.value ||
    settlementFormula.value.trim() ||
    agreementValidityMode.value !== 'UNKNOWN' ||
    agreementEffectiveFrom.value ||
    agreementEffectiveTo.value,
  ),
);

async function loadCreationContext(): Promise<void> {
  contextRequest?.abort();
  const request = new AbortController();
  contextRequest = request;
  creationContextLoading.value = true;
  creationContextError.value = '';
  try {
    const current = await getCustomerCreationContext({
      signal: request.signal,
    });
    if (request.signal.aborted) return;
    creationContext.value = current;
    responsibleUserId.value = current.responsibleUserId;
  } catch {
    if (!request.signal.aborted)
      creationContextError.value =
        '无法读取新建客户的运营和合作信息权限，请重试。';
  } finally {
    if (contextRequest === request) creationContextLoading.value = false;
  }
}
onMounted(() => {
  void loadCreationContext();
});
onBeforeUnmount(() => contextRequest?.abort());
const customerManagerName = ref('');
const managerError = ref('');
const nameError = ref('');
const admissionContactName = ref('');
const admissionContactPhone = ref('');
const admissionContactEmail = ref('');
const admissionContactError = ref('');
const submitError = ref('');
const duplicateConflict = ref('');
const duplicateMatches = ref<CustomerDuplicateSummary[]>([]);
const saving = ref(false);
const isDirty = ref(false);
useUnsavedForm(isDirty);

function requestClose(done?: () => void): void {
  if (saving.value) return;
  if (
    isDirty.value &&
    !globalThis.window.confirm('当前填写内容尚未保存，确认关闭吗？')
  )
    return;
  isDirty.value = false;
  if (done) done();
  else emit('closeRequested');
}
defineExpose({ requestClose });

async function loadVisibleSameName(name: string): Promise<void> {
  try {
    duplicateMatches.value = (await findCustomerDuplicates({ name })).sameName;
  } catch {
    duplicateMatches.value = [];
  }
}

async function submit(): Promise<void> {
  if (saving.value) return;
  if (
    !creationContext.value ||
    creationContextLoading.value ||
    creationContextError.value
  ) {
    submitError.value = '请先成功读取新建客户可选项后再保存。';
    return;
  }
  const normalizedName = name.value.trim();
  nameError.value = normalizedName ? '' : '请输入客户名称';
  const manager = customerManagerName.value.trim();
  managerError.value =
    Array.from(manager).length > 100 ? '客户经理最多100字' : '';
  const contactName = admissionContactName.value.trim();
  const contactPhone = admissionContactPhone.value.trim();
  const contactEmail = admissionContactEmail.value.trim();
  const hasContact = Boolean(contactName || contactPhone || contactEmail);
  admissionContactError.value = '';
  if (hasContact && !contactName) {
    admissionContactError.value = '请填写联系人姓名';
  } else if (hasContact && !contactPhone && !contactEmail) {
    admissionContactError.value = '联系人至少填写电话或邮箱';
  } else if (
    contactPhone &&
    !/^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u.test(contactPhone)
  ) {
    admissionContactError.value = '联系人电话格式不正确';
  } else if (
    contactEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)
  ) {
    admissionContactError.value = '联系人邮箱格式不正确';
  }
  submitError.value = '';
  additionalFieldsError.value = '';
  if (category.value.trim().length > 100 || region.value.trim().length > 100)
    additionalFieldsError.value = '主营类目和区域分别最多100字。';
  else if (
    !creationContext.value.operators.some(
      (operator) => operator.id === responsibleUserId.value,
    )
  )
    additionalFieldsError.value = '请选择当前可用的运营。';
  else if (
    hasAgreementFields.value &&
    !creationContext.value.canSetInitialAgreement
  )
    additionalFieldsError.value = '当前账号没有维护合作协议的权限。';
  else if (
    agreementTitle.value.trim().length > 200 ||
    settlementFormula.value.trim().length > 500
  )
    additionalFieldsError.value = '合作协议名称最多200字，结算条件最多500字。';
  else if (
    hasAgreementFields.value &&
    agreementValidityMode.value === 'FIXED' &&
    !agreementEffectiveTo.value
  )
    additionalFieldsError.value = '请选择合作协议截止日。';
  else if (
    agreementValidityMode.value === 'FIXED' &&
    agreementEffectiveFrom.value &&
    agreementEffectiveTo.value < agreementEffectiveFrom.value
  )
    additionalFieldsError.value = '合作协议截止日不能早于生效日。';
  duplicateMatches.value = [];
  if (
    nameError.value ||
    managerError.value ||
    admissionContactError.value ||
    additionalFieldsError.value
  )
    return;

  saving.value = true;
  try {
    const created = await createCustomerDraft({
      name: normalizedName,
      ...(manager ? { customerManagerName: manager } : {}),
      ...(identityNumber.value.trim()
        ? {
            identityType: 'BUSINESS_LICENSE',
            identityNumber: identityNumber.value.trim(),
          }
        : {}),
      ...(category.value.trim() ? { category: category.value.trim() } : {}),
      ...(region.value ? { region: region.value } : {}),
      ...(responsibleUserId.value !== creationContext.value.responsibleUserId
        ? { responsibleUserId: responsibleUserId.value }
        : {}),
    });
    isDirty.value = false;
    if (props.embedded) emit('saved', created.id);
    else await router.push(`/customers/${created.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CUSTOMER_DUPLICATE') {
      duplicateConflict.value = error.message || '该客户已存在，不能重复新建';
      await loadVisibleSameName(normalizedName);
    } else if (
      error instanceof ApiError &&
      error.code === 'CUSTOMER_DUPLICATE_CONFLICT'
    ) {
      submitError.value = '客户信息与现有记录冲突，请核对后再试';
    } else {
      submitError.value =
        error instanceof ApiError && error.code === 'CUSTOMER_ACTION_FORBIDDEN'
          ? '当前账号没有新建客户的权限'
          : '草稿没有保存成功，请稍后重试';
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    class="page-view customer-workspace customer-form-page"
    :class="{ 'customer-form-page--embedded': embedded }"
  >
    <main>
      <RouterLink v-if="!embedded" class="back-link" to="/customers"
        >← 返回客户列表</RouterLink
      >
      <div v-if="!embedded" class="section-heading section-heading--form">
        <div>
          <p class="section-kicker">客户管理</p>
          <h1>新建客户</h1>
          <p>合作文件可在创建后补传。</p>
        </div>
      </div>
      <form
        class="form-panel"
        @submit.prevent="submit"
        @input="isDirty = true"
        @change="isDirty = true"
      >
        <p v-if="creationContextLoading" class="field-help" role="status">
          正在读取可选运营和合作信息权限…
        </p>
        <p v-if="creationContextError" class="field-error" role="alert">
          {{ creationContextError }}
          <ElButton native-type="button" @click="loadCreationContext"
            >重新读取</ElButton
          >
        </p>
        <fieldset class="customer-create-scope" :disabled="saving">
          <div class="customer-new-fields">
            <fieldset class="form-section customer-create-section">
              <legend>主体信息</legend>
              <div class="customer-new-fields__wide">
                <label class="field-label" for="customer-name"
                  >客户名称<RequiredFieldMark
                /></label>
                <input
                  id="customer-name"
                  v-model="name"
                  name="name"
                  class="text-input"
                  :class="{ 'text-input--invalid': nameError }"
                  autocomplete="organization"
                  maxlength="200"
                  :aria-invalid="Boolean(nameError)"
                  :aria-describedby="
                    nameError ? 'customer-name-error' : undefined
                  "
                  @input="nameError = ''"
                />
                <p
                  v-if="nameError"
                  id="customer-name-error"
                  class="field-error"
                >
                  {{ nameError }}
                </p>
              </div>
              <div class="customer-new-fields__wide">
                <label class="field-label" for="customer-identity-number"
                  >统一社会信用代码</label
                >
                <input
                  id="customer-identity-number"
                  v-model="identityNumber"
                  name="identityNumber"
                  class="text-input"
                  maxlength="100"
                  placeholder="填写实际信用代码或证件号码"
                />
                <p class="field-help">证件可后补；保存后仍需准入。</p>
              </div>
              <div>
                <label class="field-label" for="customer-category"
                  >主营类目</label
                >
                <input
                  id="customer-category"
                  v-model="category"
                  name="category"
                  class="text-input"
                  maxlength="100"
                  placeholder="如：家居日用 · 保温杯"
                />
              </div>
              <div>
                <label class="field-label" for="customer-region">区域</label>
                <select
                  id="customer-region"
                  v-model="region"
                  name="region"
                  class="text-input"
                >
                  <option value="">未填写</option>
                  <option
                    v-for="option in regionOptions"
                    :key="option"
                    :value="option"
                  >
                    {{ option }}
                  </option>
                </select>
              </div>
              <div>
                <label class="field-label" for="customer-manager-name"
                  >客户经理</label
                >
                <input
                  id="customer-manager-name"
                  v-model="customerManagerName"
                  name="customerManagerName"
                  class="text-input"
                  maxlength="100"
                  :aria-invalid="Boolean(managerError)"
                />
                <p v-if="managerError" class="field-error" role="alert">
                  {{ managerError }}
                </p>
              </div>
              <div>
                <label class="field-label" for="customer-responsible"
                  >运营</label
                >
                <select
                  id="customer-responsible"
                  v-model="responsibleUserId"
                  name="responsibleUserId"
                  class="text-input"
                  :disabled="!creationContext || creationContextLoading"
                >
                  <option v-if="!creationContext" value="">正在读取…</option>
                  <option
                    v-for="operator in creationContext?.operators ?? []"
                    :key="operator.id"
                    :value="operator.id"
                  >
                    {{ operator.displayName }}
                  </option>
                </select>
              </div>
            </fieldset>
          </div>
        </fieldset>
        <p v-if="additionalFieldsError" class="field-error" role="alert">
          {{ additionalFieldsError }}
        </p>
        <section
          v-if="duplicateConflict"
          class="ledger-panel detail-card duplicate-conflict"
          role="alertdialog"
          data-test="duplicate-customer-dialog"
        >
          <h2>客户已存在，不能重复新建</h2>
          <p data-test="duplicate-customer-message">{{ duplicateConflict }}</p>
          <p>
            请返回客户列表核对该客户资料；同名但信用代码不同的主体请先核对证件号码。
          </p>
          <ElButton
            data-test="duplicate-customer-close"
            @click="duplicateConflict = ''"
            >关闭</ElButton
          >
        </section>
        <p v-if="submitError" class="submit-error" role="alert">
          {{ submitError }}
        </p>
        <ul v-if="duplicateMatches.length" class="duplicate-list">
          <li v-for="match in duplicateMatches" :key="match.id">
            <span>
              {{ match.name }}
              <small v-if="match.category || match.region">
                {{ [match.category, match.region].filter(Boolean).join(' · ') }}
              </small>
            </span>
            <RouterLink :to="`/customers/${match.id}`">打开已有客户</RouterLink>
          </li>
        </ul>
        <div class="form-actions">
          <RouterLink v-if="!embedded" to="/customers">取消</RouterLink>
          <ElButton
            v-else
            native-type="button"
            data-test="customer-new-cancel"
            :disabled="saving"
            @click="requestClose()"
            >取消</ElButton
          >
          <ElButton
            native-type="submit"
            type="primary"
            :loading="saving"
            :disabled="
              saving ||
              !creationContext ||
              creationContextLoading ||
              Boolean(creationContextError)
            "
          >
            保存草稿
          </ElButton>
        </div>
      </form>
    </main>
  </div>
</template>
