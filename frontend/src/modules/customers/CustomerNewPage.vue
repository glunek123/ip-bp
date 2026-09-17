<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { createCustomerDraft } from '../../api/customers';

const router = useRouter();
const name = ref('');
const nameError = ref('');
const submitError = ref('');
const saving = ref(false);

async function submit(): Promise<void> {
  if (saving.value) return;
  const normalizedName = name.value.trim();
  nameError.value = normalizedName ? '' : '请输入客户名称';
  submitError.value = '';
  if (nameError.value) return;

  saving.value = true;
  try {
    const created = await createCustomerDraft({ name: normalizedName });
    await router.push(`/customers/${created.id}`);
  } catch (error) {
    submitError.value =
      error instanceof ApiError && error.code === 'CUSTOMER_ACTION_FORBIDDEN'
        ? '当前账号没有新建客户的权限'
        : '草稿没有保存成功，请稍后重试';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/customers">
        <span class="workspace-mark">知</span><span>知产案件管理</span>
      </RouterLink>
      <span class="workspace-context">运营端 · 客户</span>
    </header>
    <main class="workspace-main workspace-main--narrow">
      <RouterLink class="back-link" to="/customers">← 返回客户列表</RouterLink>
      <div class="section-heading section-heading--form">
        <div>
          <p class="section-kicker">新建客户</p>
          <h1>先保存一份草稿</h1>
          <p>只需客户名称即可开始，证件和联系人稍后补充。</p>
        </div>
      </div>
      <form class="form-panel" @submit.prevent="submit">
        <label class="field-label" for="customer-name">客户名称</label>
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
        <p v-if="submitError" class="submit-error" role="alert">
          {{ submitError }}
        </p>
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
