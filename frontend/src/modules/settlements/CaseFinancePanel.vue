<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getSettlementContext,
  type SettlementCapabilities,
} from '../../api/settlements';
import { useAuthStore } from '../../stores/auth';
import CaseSettlementPanel from './CaseSettlementPanel.vue';
import FeeCenterPanel from './FeeCenterPanel.vue';

const props = defineProps<{ caseId: string }>();
const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const context = ref<SettlementCapabilities | null>(null);
const error = ref('');
let request: AbortController | null = null;
let revision = 0;
async function load(): Promise<void> {
  const expected = ++revision;
  request?.abort();
  request = new AbortController();
  context.value = null;
  error.value = '';
  try {
    const next = await getSettlementContext({ signal: request.signal });
    if (expected === revision) context.value = next;
  } catch (cause) {
    if (expected === revision)
      error.value =
        cause instanceof ApiError
          ? cause.message
          : '暂时无法读取结算与费用权限';
  }
}
watch([identity, () => props.caseId], load, { immediate: true });
onBeforeUnmount(() => {
  revision += 1;
  request?.abort();
});
</script>

<template>
  <div class="case-finance-panel">
    <p v-if="error" role="alert">
      {{ error }} <ElButton @click="load">重新读取</ElButton>
    </p>
    <p v-else-if="!context">正在读取结算与费用权限…</p>
    <template v-else>
      <CaseSettlementPanel
        v-if="context.read"
        :key="`settlement:${identity}:${caseId}`"
        :case-id="caseId"
        :can-update="context.termsUpdate"
        :can-launch="context.launch"
      />
      <FeeCenterPanel
        v-if="context.feeRead"
        :key="`fee:${identity}:${caseId}`"
        :case-id="caseId"
        :can-create="context.feeCreate"
        :can-update="context.feeUpdate"
        :can-launch="context.feeLaunch"
        :can-delete="context.feeDelete"
      />
      <p v-if="!context.read && !context.feeRead">
        当前账号未获结算与费用中心读取权限。
      </p>
    </template>
  </div>
</template>

<style scoped>
.case-finance-panel {
  display: grid;
  gap: 24px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--color-hairline);
}
</style>
