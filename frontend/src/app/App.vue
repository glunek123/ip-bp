<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../api/http';
import { getOrganizationManagementContext } from '../api/organization';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const loggingOut = ref(false);
const logoutError = ref('');
const canViewPeople = ref(false);

watch(
  () =>
    auth.session === null
      ? null
      : `${auth.session.user.id}:${auth.session.authorizationRevision}`,
  async (identity) => {
    canViewPeople.value = false;
    if (identity === null) return;
    try {
      await getOrganizationManagementContext();
      if (
        auth.session !== null &&
        `${auth.session.user.id}:${auth.session.authorizationRevision}` ===
          identity
      ) {
        canViewPeople.value = true;
      }
    } catch {
      canViewPeople.value = false;
    }
  },
  { immediate: true },
);

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  logoutError.value = '';
  try {
    await auth.logout();
    await router.replace('/login');
  } catch (error) {
    logoutError.value =
      error instanceof ApiError
        ? error.message
        : '退出登录失败，请检查连接后重试';
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div v-if="auth.session" class="session-bar">
    <span
      >{{ auth.session.user.displayName }} ·
      {{ auth.session.department.name }}</span
    >
    <RouterLink
      v-if="canViewPeople"
      to="/settings/people-access"
      data-test="people-access-nav"
      >人员与权限</RouterLink
    >
    <ElButton
      text
      data-test="logout"
      :loading="loggingOut"
      :disabled="loggingOut"
      @click="logout"
      >退出登录</ElButton
    >
    <p v-if="logoutError" class="session-error" role="alert">
      {{ logoutError }}
    </p>
  </div>
  <RouterView />
</template>
