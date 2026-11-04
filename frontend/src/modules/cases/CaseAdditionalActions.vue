<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { CaseDetail } from '../../api/cases';
import { getCase } from '../../api/cases';
import ListWorkflowDrawer from '../../app/ListWorkflowDrawer.vue';
import type {
  ListWorkflowContext,
  ListWorkflowLoad,
} from '../../app/list-workflow-context';
import CaseListWorkflowPanel, {
  decodeCaseListRequest,
  type CaseListAction,
} from './CaseListWorkflowPanel.vue';
import { resolveCaseListActions } from './case-workspace-actions';

const props = defineProps<{
  item: CaseDetail;
  identity: string;
  actorUserId?: string;
  disabled?: boolean;
  closureRegistrationSucceeded?: boolean;
}>();
const emit = defineEmits<{
  success: [action: CaseListAction];
  closureRecorded: [];
  continueClosureSettlement: [];
  refresh: [];
}>();

const actionLabels: Partial<Record<CaseListAction, string>> = {
  'early-closure': '提前结案',
  'settlement-update': '结算更新',
  'payment-proof': '付款记录',
  'record-closure': '登记结案资料',
};
const availableActions = computed(() =>
  resolveCaseListActions(props.item).filter((action) => {
    if (
      !['early-closure', 'settlement-update', 'payment-proof'].includes(
        action.intent,
      )
    )
      return false;
    if (action.intent === 'settlement-update') return !!props.item.closure;
    return true;
  }),
);
const bridgeStatus = computed<'hidden' | 'ready' | 'denied' | 'unconfirmed'>(
  () => {
    if (!props.closureRegistrationSucceeded) return 'hidden';
    if (props.item.stage !== 'WAITING_ARCHIVE' || !props.item.closure)
      return 'unconfirmed';
    return props.item.canUpdateClosureSettlement === true ? 'ready' : 'denied';
  },
);

const recoveryAction = ref<CaseListAction | null>(null);
const recoveryError = ref('');
const drawerOpen = ref(false);
const workflowContext = ref<ListWorkflowContext | null>(null);
const selectedAction = ref<CaseListAction | null>(null);
const drawer = ref<{
  canLeave: () => boolean;
  requestClose: () => boolean;
} | null>(null);
const controlsDisabled = computed(
  () =>
    props.disabled === true || drawerOpen.value || recoveryError.value !== '',
);

function readRecovery() {
  recoveryAction.value = null;
  recoveryError.value = '';
  if (!props.identity) return;
  const key = `case-list-workflow:v1:${encodeURIComponent(props.identity)}:${encodeURIComponent(props.item.id)}`;
  try {
    const raw = globalThis.sessionStorage.getItem(key);
    if (raw === null) return;
    const decoded = decodeCaseListRequest(JSON.parse(raw));
    if (
      !decoded ||
      decoded.actor !== props.identity ||
      decoded.caseId !== props.item.id
    )
      throw new Error('Invalid original request');
    recoveryAction.value = decoded.action;
  } catch {
    recoveryError.value =
      '无法核对本案原办理请求。请保留当前会话并联系管理员；未发送新请求。';
  }
}

watch(() => [props.identity, props.item.id], readRecovery, {
  immediate: true,
  flush: 'sync',
});

function openAction(action: CaseListAction, recovery = false) {
  if (
    controlsDisabled.value ||
    !props.identity ||
    (recoveryAction.value && !recovery)
  )
    return;
  if (
    recovery &&
    (recoveryAction.value !== action || recoveryError.value !== '')
  )
    return;
  selectedAction.value = action;
  workflowContext.value = {
    recordId: props.item.id,
    actorKey: props.identity,
    actionKey: action,
    title: `${props.item.businessNo} · ${recovery ? '核对原办理请求' : (actionLabels[action] ?? '案件办理')}`,
  };
  drawerOpen.value = true;
}

function loadWorkflow(request: ListWorkflowLoad) {
  return getCase(request.context.recordId, { signal: request.signal });
}

function handleSuccess() {
  const action = selectedAction.value;
  if (!action) return;
  if (action === 'record-closure') emit('closureRecorded');
  emit('success', action);
}

function closeWorkflow() {
  drawerOpen.value = false;
  workflowContext.value = null;
  selectedAction.value = null;
  readRecovery();
}

onBeforeUnmount(() => {
  drawer.value?.requestClose();
});

defineExpose({
  canLeave: () => drawer.value?.canLeave() !== false,
  isBusy: () => drawerOpen.value || drawer.value?.canLeave() === false,
});
</script>

<template>
  <section
    v-if="
      availableActions.length ||
      recoveryAction ||
      recoveryError ||
      item.stage === 'WAITING_ARCHIVE' ||
      bridgeStatus !== 'hidden'
    "
    class="case-additional-actions"
    aria-label="结案和付款操作"
    data-test="case-additional-actions"
  >
    <p
      v-if="
        item.stage === 'WAITING_ARCHIVE' &&
        !item.closure &&
        item.canRecordClosure
      "
      class="field-help"
      data-test="closure-recording-required"
    >
      当前缺少结案资料。请先使用案件主操作登记结案资料；保存后会重新读取权限，再由你明确选择是否继续结算更新。
    </p>
    <p
      v-else-if="item.stage === 'WAITING_ARCHIVE' && !item.closure"
      class="field-help"
      role="alert"
      data-test="closure-recording-unavailable"
    >
      当前缺少结案资料，且当前账号没有登记权限。请联系有权限的负责人。
    </p>
    <div v-if="availableActions.length" class="operation-bar">
      <ElButton
        v-for="action in availableActions"
        :key="action.intent"
        :disabled="controlsDisabled || !!recoveryAction"
        :data-case-action="action.intent"
        @click="openAction(action.intent)"
        >{{ actionLabels[action.intent] ?? action.label }}</ElButton
      >
    </div>
    <div v-if="recoveryError || recoveryAction" class="state-panel">
      <p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
      <template v-else>
        <p role="status">本案有一条尚待核对的原办理请求。</p>
        <ElButton
          :disabled="controlsDisabled"
          data-test="recover-case-list-action"
          @click="openAction(recoveryAction!, true)"
          >核对原办理请求</ElButton
        >
      </template>
    </div>
    <div v-if="bridgeStatus !== 'hidden'" data-test="closure-settlement-bridge">
      <template v-if="bridgeStatus === 'ready'">
        <p role="status">
          结案资料已登记并重新读取。结算更新不会自动提交财务变更。
        </p>
        <ElButton
          type="primary"
          :disabled="controlsDisabled"
          data-test="continue-closure-settlement"
          @click="
            openAction('settlement-update');
            emit('continueClosureSettlement');
          "
          >继续结算更新</ElButton
        >
      </template>
      <p v-else-if="bridgeStatus === 'denied'" role="alert">
        结案资料已登记，但当前账号没有更新结算的权限。请联系有权限的负责人。
      </p>
      <template v-else>
        <p role="alert">
          结案资料已提交，但最新资料或阶段尚未确认。请重新读取后核对；不会自动提交结算。
        </p>
        <ElButton :disabled="controlsDisabled" @click="emit('refresh')"
          >重新读取</ElButton
        >
      </template>
    </div>
    <ListWorkflowDrawer
      ref="drawer"
      v-model="drawerOpen"
      :context="workflowContext"
      :load-detail="loadWorkflow"
      @success="handleSuccess"
      @closed="closeWorkflow"
    >
      <template #default="{ detail, session, requestState }">
        <CaseListWorkflowPanel
          v-if="selectedAction"
          :item="detail"
          :action="selectedAction"
          :session="session"
          :request-state="requestState"
          :actor-user-id="actorUserId"
          @cancel="drawer?.requestClose()"
        />
      </template>
    </ListWorkflowDrawer>
  </section>
</template>

<style scoped>
.case-additional-actions {
  display: grid;
  gap: var(--s-2);
}
.case-additional-actions .operation-bar {
  flex-wrap: wrap;
}
</style>
