<script lang="ts">
export type { FrozenLeadPush } from './LeadListWorkflowPanel.vue';
</script>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  RouterLink,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
} from 'vue-router';
import ListWorkflowDrawer from '../../app/ListWorkflowDrawer.vue';
import type { ListWorkflowLoad } from '../../app/list-workflow-context';
import { getLead } from '../../api/leads';
import { leadStatusCards } from './lead-options';
import LeadListWorkflowPanel, {
  readPendingLeadCommands,
  type FrozenLeadPush,
  type LeadWorkflowResult,
} from './LeadListWorkflowPanel.vue';

const props = defineProps<{
  leadId: string;
  identity: string;
  pendingPush: FrozenLeadPush | null;
  title?: string;
}>();
const emit = defineEmits<{
  close: [];
  pending: [
    identity: string,
    value: FrozenLeadPush | null,
    settledAttempt?: FrozenLeadPush,
  ];
  succeeded: [attempt: FrozenLeadPush];
  completed: [result: LeadWorkflowResult];
}>();
const route = useRoute();
const open = ref(true);
const drawer = ref<{ canLeave: () => boolean }>();
const completed = ref<LeadWorkflowResult>();
const context = computed(() => ({
  recordId: props.leadId,
  actorKey: props.identity,
  actionKey: 'lead-workflow',
  title: props.title ?? '线索下一步',
}));
const returnTo = computed(() => {
  if (route.path !== '/leads') return undefined;
  const page =
    typeof route.query.page === 'string' && /^[1-9]\d*$/u.test(route.query.page)
      ? route.query.page
      : '1';
  const query = new globalThis.URLSearchParams({ page });
  if (
    typeof route.query.status === 'string' &&
    leadStatusCards.some((item) => item.status === route.query.status)
  )
    query.set('status', route.query.status);
  return `/leads?${query.toString()}`;
});
async function loadDetail(request: ListWorkflowLoad) {
  return getLead(request.context.recordId, { signal: request.signal });
}
function pendingChanged() {
  const pending = readPendingLeadCommands()?.[props.identity] ?? null;
  emit('pending', props.identity, pending, completed.value?.attempt);
}
function commandCompleted(result: LeadWorkflowResult) {
  completed.value = result;
  pendingChanged();
}
function succeeded() {
  const result = completed.value;
  if (
    !result ||
    result.attempt.identity !== props.identity ||
    result.attempt.leadId !== props.leadId
  )
    return;
  emit('completed', result);
  emit('succeeded', result.attempt);
}
watch(
  () => [props.leadId, props.identity],
  () => {
    completed.value = undefined;
  },
  { flush: 'sync' },
);
onBeforeRouteLeave(() => drawer.value?.canLeave() ?? true);
onBeforeRouteUpdate(() => drawer.value?.canLeave() ?? true);
</script>

<template>
  <ListWorkflowDrawer
    ref="drawer"
    v-model="open"
    :context="context"
    :load-detail="loadDetail"
    @closed="emit('close')"
    @success="succeeded"
  >
    <template #default="{ detail, session, requestState }">
      <LeadListWorkflowPanel
        :detail="detail"
        :session="session"
        @pending="pendingChanged"
        @completed="commandCompleted"
      />
      <RouterLink
        v-if="detail.capabilities.edit && requestState === 'idle'"
        :to="{
          path: `/leads/${detail.id}/edit`,
          query: returnTo ? { returnTo } : {},
        }"
        data-test="quick-edit-lead"
        >编辑线索资料（不推进阶段）</RouterLink
      >
    </template>
  </ListWorkflowDrawer>
</template>
