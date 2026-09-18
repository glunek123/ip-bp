<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  findCustomerDuplicates,
  getCustomer,
  updateCustomerDraft,
  type CustomerDetail,
  type CustomerDuplicateSummary,
} from '../../api/customers';
import { ApiError } from '../../api/http';

const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'missing' | 'denied' | 'failed'>(
  'loading',
);
const expectedVersion = ref(0);
const name = ref('');
const customerType = ref('');
const identityType = ref('');
const identityNumber = ref('');
const issuingCountryOrRegion = ref('');
const category = ref('');
const region = ref('');
const admissionContactName = ref('');
const admissionContactPhone = ref('');
const admissionContactEmail = ref('');
const originalAdmissionContact = ref({ name: '', phone: '', email: '' });
const duplicateNameReason = ref('');
const needsDuplicateNameReason = ref(false);
const duplicateMatches = ref<CustomerDuplicateSummary[]>([]);
const latestSnapshot = ref<CustomerDetail | null>(null);
const nameError = ref('');
const identityError = ref('');
const admissionContactError = ref('');
const duplicateNameReasonError = ref('');
const submitError = ref('');
const saving = ref(false);
let activeRequest: AbortController | undefined;

function editable(value: string): string {
  return value.trim();
}

function setOriginalAdmissionContact(customer: CustomerDetail): void {
  originalAdmissionContact.value = {
    name: customer.admissionContactName ?? '',
    phone: customer.admissionContactPhone ?? '',
    email: customer.admissionContactEmail ?? '',
  };
}

function validateAdmissionContact(): boolean {
  const contactName = admissionContactName.value.trim();
  const contactPhone = admissionContactPhone.value.trim();
  const contactEmail = admissionContactEmail.value.trim();
  const original = originalAdmissionContact.value;
  admissionContactError.value = '';
  if (
    (original.name && !contactName) ||
    (original.phone && !contactPhone) ||
    (original.email && !contactEmail)
  ) {
    admissionContactError.value = '本轮暂不支持删除联系人信息';
  } else if ((contactName || contactPhone || contactEmail) && !contactName) {
    admissionContactError.value = '请填写联系人姓名';
  } else if (contactName && !contactPhone && !contactEmail) {
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
  return admissionContactError.value.length === 0;
}

function admissionContactPayload(): {
  admissionContactName?: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
} {
  const contactName = admissionContactName.value.trim();
  const contactPhone = admissionContactPhone.value.trim();
  const contactEmail = admissionContactEmail.value.trim();
  return {
    ...(contactName ? { admissionContactName: contactName } : {}),
    ...(contactPhone ? { admissionContactPhone: contactPhone } : {}),
    ...(contactEmail ? { admissionContactEmail: contactEmail } : {}),
  };
}

async function loadVisibleDuplicates(
  query: Parameters<typeof findCustomerDuplicates>[0],
  kind: 'sameName' | 'exactIdentity',
): Promise<void> {
  try {
    duplicateMatches.value = (await findCustomerDuplicates(query))[kind];
  } catch {
    duplicateMatches.value = [];
  }
}

async function prepareVersionConflict(): Promise<void> {
  try {
    const latest = await getCustomer(String(route.params.id));
    if (!latest.capabilities.editRoutine) {
      state.value = 'denied';
      return;
    }
    latestSnapshot.value = latest;
    const matches = await findCustomerDuplicates({
      name: name.value.trim(),
      identityType: identityType.value.trim(),
      identityNumber: identityNumber.value.trim(),
      excludeCustomerId: String(route.params.id),
    });
    duplicateMatches.value = [
      ...matches.exactIdentity,
      ...matches.sameName.filter(
        (candidate) =>
          !matches.exactIdentity.some((exact) => exact.id === candidate.id),
      ),
    ];
    submitError.value = `客户资料已被他人更新，已读取最新版本 ${latest.version}。请核对后选择如何继续。`;
  } catch {
    submitError.value = '客户资料已被他人更新，但最新版本读取失败，请稍后重试';
  }
}

async function retryLatest(): Promise<void> {
  if (latestSnapshot.value === null) return;
  expectedVersion.value = latestSnapshot.value.version;
  setOriginalAdmissionContact(latestSnapshot.value);
  latestSnapshot.value = null;
  await submit();
}

function useLatestSnapshot(): void {
  const latest = latestSnapshot.value;
  if (latest === null) return;
  expectedVersion.value = latest.version;
  name.value = latest.name;
  customerType.value = latest.customerType ?? '';
  identityType.value = latest.identityType ?? '';
  identityNumber.value = latest.identityNumber ?? '';
  issuingCountryOrRegion.value = latest.issuingCountryOrRegion ?? '';
  category.value = latest.category ?? '';
  region.value = latest.region ?? '';
  admissionContactName.value = latest.admissionContactName ?? '';
  admissionContactPhone.value = latest.admissionContactPhone ?? '';
  admissionContactEmail.value = latest.admissionContactEmail ?? '';
  setOriginalAdmissionContact(latest);
  latestSnapshot.value = null;
  duplicateMatches.value = [];
  submitError.value = '';
}

async function load(): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  state.value = 'loading';
  try {
    const customer = await getCustomer(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    if (!customer.capabilities.editRoutine) {
      state.value = 'denied';
      return;
    }
    expectedVersion.value = customer.version;
    name.value = customer.name;
    customerType.value = customer.customerType ?? '';
    identityType.value = customer.identityType ?? '';
    identityNumber.value = customer.identityNumber ?? '';
    issuingCountryOrRegion.value = customer.issuingCountryOrRegion ?? '';
    category.value = customer.category ?? '';
    region.value = customer.region ?? '';
    admissionContactName.value = customer.admissionContactName ?? '';
    admissionContactPhone.value = customer.admissionContactPhone ?? '';
    admissionContactEmail.value = customer.admissionContactEmail ?? '';
    setOriginalAdmissionContact(customer);
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'CUSTOMER_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}

async function submit(): Promise<void> {
  if (saving.value) return;
  nameError.value = name.value.trim() ? '' : '请输入客户名称';
  const hasIdentityType = Boolean(identityType.value.trim());
  const hasIdentityNumber = Boolean(identityNumber.value.trim());
  identityError.value =
    hasIdentityType === hasIdentityNumber
      ? ''
      : '证件类型和证件号码需要同时填写';
  validateAdmissionContact();
  duplicateNameReasonError.value =
    needsDuplicateNameReason.value && !duplicateNameReason.value.trim()
      ? '请说明同名情况下继续保存的原因'
      : '';
  submitError.value = '';
  duplicateMatches.value = [];
  latestSnapshot.value = null;
  if (
    nameError.value ||
    identityError.value ||
    admissionContactError.value ||
    duplicateNameReasonError.value
  )
    return;

  saving.value = true;
  try {
    await updateCustomerDraft(String(route.params.id), {
      expectedVersion: expectedVersion.value,
      name: name.value.trim(),
      customerType: editable(customerType.value),
      identityType: editable(identityType.value),
      identityNumber: editable(identityNumber.value),
      issuingCountryOrRegion: editable(issuingCountryOrRegion.value),
      category: editable(category.value),
      region: editable(region.value),
      ...admissionContactPayload(),
      ...(needsDuplicateNameReason.value
        ? { duplicateNameReason: duplicateNameReason.value.trim() }
        : {}),
    });
    await router.push(`/customers/${String(route.params.id)}`);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'CUSTOMER_NAME_REASON_REQUIRED') {
        needsDuplicateNameReason.value = true;
        submitError.value = '本部门已有同名客户，请核对后说明继续原因';
        await loadVisibleDuplicates(
          {
            name: name.value.trim(),
            excludeCustomerId: String(route.params.id),
          },
          'sameName',
        );
      } else if (error.code === 'CUSTOMER_IDENTITY_DUPLICATE') {
        submitError.value = '本部门已有相同证件号码的客户';
        await loadVisibleDuplicates(
          {
            identityType: identityType.value.trim(),
            identityNumber: identityNumber.value.trim(),
            excludeCustomerId: String(route.params.id),
          },
          'exactIdentity',
        );
      } else if (error.code === 'CUSTOMER_DUPLICATE_CONFLICT') {
        submitError.value = '客户信息与现有记录冲突，请核对后再试';
      } else if (error.code === 'CUSTOMER_VERSION_CONFLICT') {
        await prepareVersionConflict();
      } else if (error.code === 'CUSTOMER_ACTION_FORBIDDEN') {
        submitError.value = '当前账号没有编辑此客户的权限';
      } else {
        submitError.value = '客户资料没有保存成功，请稍后重试';
      }
    } else {
      submitError.value = '客户资料没有保存成功，请稍后重试';
    }
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/customers">
        <span class="workspace-mark">品知</span><span>品维·知产业务管理</span>
      </RouterLink>
      <span class="workspace-context">运营端 · 客户</span>
    </header>
    <main class="workspace-main workspace-main--narrow">
      <RouterLink
        class="back-link"
        :to="`/customers/${String(route.params.id)}`"
      >
        ← 返回客户详情
      </RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <span class="state-index">读取中</span>
        <h1>正在读取客户资料</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <span class="state-index">404</span>
        <h1>客户不存在或当前不可访问</h1>
      </section>
      <section v-else-if="state === 'denied'" class="state-panel ledger-panel">
        <span class="state-index">无编辑权限</span>
        <h1>当前账号没有编辑此客户的权限</h1>
        <p>仍可返回详情查看已有资料。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <span class="state-index">连接失败</span>
        <h1>客户资料暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else>
        <div class="section-heading section-heading--form">
          <div>
            <p class="section-kicker">编辑客户</p>
            <h1>基础资料</h1>
            <p>保存后立即生效，并自动记录本次修改。</p>
          </div>
        </div>
        <form class="form-panel" @submit.prevent="submit">
          <label class="field-label" for="customer-name">客户名称</label>
          <input
            id="customer-name"
            v-model="name"
            name="name"
            class="text-input"
            maxlength="200"
          />
          <p v-if="nameError" class="field-error">{{ nameError }}</p>

          <label class="field-label field-label--spaced" for="customer-type"
            >客户类型</label
          >
          <input
            id="customer-type"
            v-model="customerType"
            name="customerType"
            class="text-input"
            maxlength="50"
          />

          <label class="field-label field-label--spaced" for="identity-type"
            >证件类型</label
          >
          <input
            id="identity-type"
            v-model="identityType"
            name="identityType"
            class="text-input"
            maxlength="50"
          />

          <label class="field-label field-label--spaced" for="identity-number"
            >证件号码</label
          >
          <input
            id="identity-number"
            v-model="identityNumber"
            name="identityNumber"
            class="text-input"
            maxlength="100"
          />
          <p v-if="identityError" class="field-error">{{ identityError }}</p>

          <label class="field-label field-label--spaced" for="issuing-region"
            >签发国家／地区</label
          >
          <input
            id="issuing-region"
            v-model="issuingCountryOrRegion"
            name="issuingCountryOrRegion"
            class="text-input"
            maxlength="100"
          />

          <label class="field-label field-label--spaced" for="category"
            >客户类别</label
          >
          <input
            id="category"
            v-model="category"
            name="category"
            class="text-input"
            maxlength="100"
          />

          <label class="field-label field-label--spaced" for="region"
            >所属地区</label
          >
          <input
            id="region"
            v-model="region"
            name="region"
            class="text-input"
            maxlength="100"
          />

          <fieldset class="form-section">
            <legend>准入联系人（可选）</legend>
            <p class="field-help">填写联系人时，电话或邮箱至少填写一种。</p>
            <label class="field-label" for="admission-contact-name"
              >联系人姓名</label
            >
            <input
              id="admission-contact-name"
              v-model="admissionContactName"
              name="admissionContactName"
              class="text-input"
              autocomplete="name"
              maxlength="100"
              @input="admissionContactError = ''"
            />
            <label
              class="field-label field-label--spaced"
              for="admission-contact-phone"
              >电话</label
            >
            <input
              id="admission-contact-phone"
              v-model="admissionContactPhone"
              name="admissionContactPhone"
              class="text-input"
              autocomplete="tel"
              maxlength="30"
              @input="admissionContactError = ''"
            />
            <label
              class="field-label field-label--spaced"
              for="admission-contact-email"
              >邮箱</label
            >
            <input
              id="admission-contact-email"
              v-model="admissionContactEmail"
              name="admissionContactEmail"
              class="text-input"
              autocomplete="email"
              maxlength="254"
              @input="admissionContactError = ''"
            />
            <p v-if="admissionContactError" class="field-error">
              {{ admissionContactError }}
            </p>
          </fieldset>

          <template v-if="needsDuplicateNameReason">
            <label
              class="field-label field-label--spaced"
              for="duplicate-name-reason"
              >同名继续原因</label
            >
            <textarea
              id="duplicate-name-reason"
              v-model="duplicateNameReason"
              name="duplicateNameReason"
              class="text-area"
              maxlength="500"
            />
            <p v-if="duplicateNameReasonError" class="field-error">
              {{ duplicateNameReasonError }}
            </p>
          </template>

          <p v-if="submitError" class="submit-error" role="alert">
            {{ submitError }}
          </p>
          <ul v-if="duplicateMatches.length" class="duplicate-list">
            <li v-for="match in duplicateMatches" :key="match.id">
              <span>
                {{ match.name }}
                <small v-if="match.category || match.region">
                  {{
                    [match.category, match.region].filter(Boolean).join(' · ')
                  }}
                </small>
              </span>
              <RouterLink :to="`/customers/${match.id}`"
                >打开已有客户</RouterLink
              >
            </li>
          </ul>
          <div v-if="latestSnapshot" class="version-conflict-actions">
            <ElButton name="retryLatest" type="primary" @click="retryLatest">
              基于最新版本重新提交
            </ElButton>
            <ElButton name="useLatest" @click="useLatestSnapshot">
              放弃本次修改，载入最新资料
            </ElButton>
          </div>
          <div class="form-actions">
            <RouterLink :to="`/customers/${String(route.params.id)}`"
              >取消</RouterLink
            >
            <ElButton
              native-type="submit"
              type="primary"
              :loading="saving"
              :disabled="saving"
            >
              保存修改
            </ElButton>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>
