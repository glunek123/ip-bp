<script setup lang="ts">
import { computed } from 'vue';
import { RouterView } from 'vue-router';
import { ElConfigProvider } from 'element-plus/es/components/config-provider/index.mjs';
import zhCn from 'element-plus/es/locale/lang/zh-cn.mjs';
import { useAuthStore } from '../stores/auth';
import AppShell from './AppShell.vue';

const auth = useAuthStore();
const sessionKey = computed(() =>
  auth.session
    ? `${auth.session.principalType}:${auth.session.user.id}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`
    : '',
);
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <AppShell v-if="auth.session">
      <RouterView v-slot="{ Component, route }">
        <KeepAlive :key="sessionKey" include="CaseDetailPage">
          <component
            :is="Component"
            :key="
              route.meta.caseWorkspace
                ? `case:${String(route.params.id)}`
                : route.path
            "
          />
        </KeepAlive>
      </RouterView>
    </AppShell>
    <RouterView v-else />
  </ElConfigProvider>
</template>
