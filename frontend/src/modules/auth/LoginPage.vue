<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import type { DepartmentChoice } from '../../api/auth';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const departmentId = ref('');
const departments = ref<DepartmentChoice[]>([]);
const submitting = ref(false);
const errorMessage = ref('');
const canSubmit = computed(
  () => username.value.trim().length >= 3 && password.value.length >= 12,
);

function safeReturnPath(principalType: 'INTERNAL' | 'CLIENT'): string {
  const value = route.query.returnTo;
  const safe =
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
      ? value
      : null;
  const clientPath =
    safe === '/client/leads' || safe?.startsWith('/client/leads/');
  if (principalType === 'CLIENT') return clientPath ? safe! : '/client/leads';
  return safe !== null && !clientPath ? safe : '/customers';
}

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.login(
      username.value,
      password.value,
      departmentId.value || undefined,
    );
    if (auth.session === null) throw new Error('登录会话未建立');
    await router.replace(safeReturnPath(auth.session.principalType));
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === 'DEPARTMENT_REQUIRED' &&
      Array.isArray(error.details?.departments)
    ) {
      departments.value = error.details.departments.filter(
        (item): item is DepartmentChoice =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as DepartmentChoice).id === 'string' &&
          typeof (item as DepartmentChoice).name === 'string',
      );
      errorMessage.value = '请选择要进入的部门';
    } else {
      errorMessage.value =
        error instanceof ApiError ? error.message : '登录失败，请稍后重试';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login-shell">
    <section class="login-card">
      <div class="login-brand"><span class="workspace-mark">品知</span></div>
      <p class="section-kicker">Secure access</p>
      <h1>登录品维·知产业务管理</h1>
      <p class="login-intro">
        使用管理员为你创建的内部账号或企业客户账号登录。
      </p>
      <form @submit.prevent="submit">
        <label class="field-label" for="username">用户名</label>
        <input
          id="username"
          v-model="username"
          class="text-input"
          autocomplete="username"
          autofocus
        />
        <label class="field-label field-label--spaced" for="password"
          >密码</label
        >
        <input
          id="password"
          v-model="password"
          class="text-input"
          type="password"
          autocomplete="current-password"
        />
        <template v-if="departments.length > 0">
          <label class="field-label field-label--spaced" for="department"
            >部门</label
          >
          <select id="department" v-model="departmentId" class="text-input">
            <option value="" disabled>请选择部门</option>
            <option v-for="item in departments" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </template>
        <p v-if="errorMessage" class="submit-error" role="alert">
          {{ errorMessage }}
        </p>
        <ElButton
          class="login-submit"
          type="primary"
          native-type="submit"
          :loading="submitting"
          :disabled="!canSubmit"
        >
          登录
        </ElButton>
      </form>
    </section>
  </main>
</template>
