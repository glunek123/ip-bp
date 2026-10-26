<script setup lang="ts" generic="T extends { id: string }">
import { computed, onBeforeUnmount, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs';
import {
  createListWorkflowContext,
  type ListWorkflowContext,
  type ListWorkflowLoad,
  type ListWorkflowReceipt,
  type ListWorkflowRequestState,
  type ListWorkflowSession,
} from './list-workflow-context';

const props = defineProps<{
  modelValue: boolean;
  context: ListWorkflowContext | null;
  loadDetail: (request: ListWorkflowLoad) => Promise<T>;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  success: [receipt: ListWorkflowReceipt];
  closed: [receipt: ListWorkflowReceipt];
  invalidated: [
    receipt: ListWorkflowReceipt & { requestState: ListWorkflowRequestState },
  ];
  blocked: [state: ListWorkflowRequestState];
}>();
defineSlots<{
  default(props: {
    detail: T;
    session: ListWorkflowSession;
    requestState: ListWorkflowRequestState;
  }): unknown;
  loading(props: { context: ListWorkflowContext | null }): unknown;
  error(props: { error: unknown; retry: () => Promise<void> }): unknown;
  denied(props: { error: unknown; retry: () => Promise<void> }): unknown;
}>();

const workflow = createListWorkflowContext<T>(
  (request) => props.loadDetail(request),
  {
    success: (receipt) => emit('success', receipt),
    closed: (receipt) => {
      emit('update:modelValue', false);
      emit('closed', receipt);
    },
    invalidated: (receipt) => emit('invalidated', receipt),
    blocked: (state) => emit('blocked', state),
  },
);
const state = workflow.state;
const visible = computed(
  () => props.modelValue && state.value.status !== 'closed',
);
const locked = computed(() => state.value.requestState !== 'idle');

// Guard USER row/action changes with canLeave() before changing the controlled props.
// Forced route/identity/authorization changes always invalidate immediately, including POST callbacks.
watch(
  () => [
    props.modelValue,
    props.context?.recordId,
    props.context?.actorKey,
    props.context?.actionKey,
  ],
  () => {
    void workflow.sync(props.modelValue ? props.context : null);
  },
  { immediate: true, flush: 'sync' },
);
function beforeClose(done: () => void) {
  if (workflow.requestClose()) done();
}
onBeforeUnmount(workflow.dispose);
defineExpose({
  canLeave: workflow.canLeave,
  requestClose: workflow.requestClose,
});
</script>

<template>
  <ElDrawer
    class="list-workflow-drawer"
    :model-value="visible"
    :title="state.context?.title ?? ''"
    size="min(720px, 100vw)"
    append-to-body
    destroy-on-close
    :before-close="beforeClose"
  >
    <div v-if="state.status === 'loading'" class="workflow-state" role="status">
      <slot name="loading" :context="state.context">正在加载最新资料…</slot>
    </div>
    <div
      v-else-if="state.status === 'error'"
      class="workflow-state"
      role="alert"
    >
      <slot name="error" :error="state.error" :retry="workflow.retry">
        <p>资料加载失败，请重试。</p>
        <ElButton @click="workflow.retry">重新加载</ElButton>
      </slot>
    </div>
    <div
      v-else-if="state.status === 'denied'"
      class="workflow-state"
      role="alert"
    >
      <slot name="denied" :error="state.error" :retry="workflow.retry">
        <p>当前无法访问该记录或办理此操作，请核对权限后重试。</p>
        <ElButton @click="workflow.retry">重新核对</ElButton>
      </slot>
    </div>
    <template
      v-else-if="state.status === 'ready' && state.detail && state.session"
    >
      <p
        v-if="state.requestState === 'unknown'"
        class="workflow-note"
        role="alert"
      >
        请求结果尚未确认，请使用原请求的核对或恢复操作，勿重新提交。
      </p>
      <div :key="state.session.contextKey" class="list-workflow-content">
        <slot
          :detail="state.detail"
          :session="state.session"
          :request-state="state.requestState"
        />
      </div>
    </template>
    <template #footer>
      <ElButton :disabled="locked" @click="workflow.requestClose"
        >取消／返回列表</ElButton
      >
    </template>
  </ElDrawer>
</template>

<style src="../styles/list-workflow.css"></style>
