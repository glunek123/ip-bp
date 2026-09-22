<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createCustomerDraft,
  findCustomerDuplicates,
  type CustomerDuplicateSummary,
} from '../../api/customers';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { useUnsavedForm } from '../../app/use-unsaved-form';

const router = useRouter();
const name = ref('');
const nameError = ref('');
const admissionContactName = ref('');
const admissionContactPhone = ref('');
const admissionContactEmail = ref('');
const admissionContactError = ref('');
const submitError = ref('');
const duplicateNameReason = ref('');
const duplicateNameReasonError = ref('');
const needsDuplicateNameReason = ref(false);
const duplicateMatches = ref<CustomerDuplicateSummary[]>([]);
const saving = ref(false);
const isDirty = ref(false);

useUnsavedForm(isDirty);

async function loadVisibleSameName(name: string): Promise<void> {
  try {
    duplicateMatches.value = (await findCustomerDuplicates({ name })).sameName;
  } catch {
    duplicateMatches.value = [];
  }
}

async function submit(): Promise<void> {
  if (saving.value) return;
  const normalizedName = name.value.trim();
  nameError.value = normalizedName ? '' : '请输入客户名称';
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
  duplicateNameReasonError.value =
    needsDuplicateNameReason.value && !duplicateNameReason.value.trim()
      ? '请说明同名情况下继续创建的原因'
      : '';
  submitError.value = '';
  duplicateMatches.value = [];
  if (
    nameError.value ||
    admissionContactError.value ||
    duplicateNameReasonError.value
  )
    return;

  saving.value = true;
  try {
    const created = await createCustomerDraft({
      name: normalizedName,
      ...(hasContact
        ? {
            admissionContactName: contactName,
            ...(contactPhone ? { admissionContactPhone: contactPhone } : {}),
            ...(contactEmail ? { admissionContactEmail: contactEmail } : {}),
          }
        : {}),
      ...(needsDuplicateNameReason.value
        ? { duplicateNameReason: duplicateNameReason.value.trim() }
        : {}),
    });
    isDirty.value = false;
    await router.push(`/customers/${created.id}`);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === 'CUSTOMER_NAME_REASON_REQUIRED'
    ) {
      needsDuplicateNameReason.value = true;
      submitError.value = '本部门已有同名客户，请核对后说明继续原因';
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
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/customers">← 返回客户列表</RouterLink>
      <div class="section-heading section-heading--form">
        <div>
          <p class="section-kicker">新建客户</p>
          <h1>先保存一份草稿</h1>
          <p>只需客户名称即可开始，证件和联系人稍后补充。</p>
        </div>
      </div>
      <form
        class="form-panel"
        @submit.prevent="submit"
        @input="isDirty = true"
        @change="isDirty = true"
      >
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
          :aria-describedby="nameError ? 'customer-name-error' : undefined"
          @input="nameError = ''"
        />
        <p v-if="nameError" id="customer-name-error" class="field-error">
          {{ nameError }}
        </p>
        <p class="field-help">没有正式证件也可以保存，但暂不能进入正式业务。</p>

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
          >
            同名继续原因
          </label>
          <textarea
            id="duplicate-name-reason"
            v-model="duplicateNameReason"
            name="duplicateNameReason"
            class="text-area"
            maxlength="500"
            :aria-invalid="Boolean(duplicateNameReasonError)"
            @input="duplicateNameReasonError = ''"
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
                {{ [match.category, match.region].filter(Boolean).join(' · ') }}
              </small>
            </span>
            <RouterLink :to="`/customers/${match.id}`">打开已有客户</RouterLink>
          </li>
        </ul>
        <div class="form-actions">
          <RouterLink to="/customers">取消</RouterLink>
          <ElButton
            native-type="submit"
            type="primary"
            :loading="saving"
            :disabled="saving"
          >
            保存草稿
          </ElButton>
        </div>
      </form>
    </main>
  </div>
</template>
