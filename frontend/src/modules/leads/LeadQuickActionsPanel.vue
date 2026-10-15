<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { getLead, pushLead, type LeadDetail } from '../../api/leads';
import { leadStatusCards } from './lead-options';

export type FrozenLeadPush = {
  leadId: string;
  expectedVersion: number;
  idempotencyKey: string;
  identity: string;
};

const props = defineProps<{
  leadId: string;
  identity: string;
  pendingPush: FrozenLeadPush | null;
}>();
const route = useRoute();
const returnTo = computed(() => {
  const rawPage = route.query.page;
  const page =
    typeof rawPage === 'string' && /^[1-9]\d*$/u.test(rawPage) ? rawPage : '1';
  const rawStatus = route.query.status;
  const allowedStatuses = new Set<string>(
    leadStatusCards.map((card) => card.status),
  );
  const query = new globalThis.URLSearchParams({ page });
  if (typeof rawStatus === 'string' && allowedStatuses.has(rawStatus)) {
    query.set('status', rawStatus);
  }
  return `/leads?${query.toString()}`;
});
const emit = defineEmits<{
  close: [];
  pending: [
    identity: string,
    value: FrozenLeadPush | null,
    settledAttempt?: FrozenLeadPush,
  ];
  succeeded: [attempt: FrozenLeadPush];
}>();

const detail = ref<LeadDetail>();
const state = ref<'loading' | 'ready' | 'failed' | 'denied' | 'unknown'>(
  'loading',
);
const busy = ref(false);
const errorMessage = ref('');
let request: AbortController | undefined;
let generation = 0;
const pendingStorageKey = 'dev-cor:lead-quick-actions:pending-push';
type StoredAttempt = FrozenLeadPush & { status: 'PENDING' | 'SETTLED' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStoredAttempts(): Record<string, StoredAttempt> | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingStorageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const entries: Record<string, StoredAttempt> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      if (
        !isRecord(value) ||
        value.identity !== identity ||
        typeof value.leadId !== 'string' ||
        typeof value.expectedVersion !== 'number' ||
        !Number.isInteger(value.expectedVersion) ||
        typeof value.idempotencyKey !== 'string' ||
        (value.status !== 'PENDING' && value.status !== 'SETTLED')
      )
        return null;
      entries[identity] = {
        leadId: value.leadId,
        expectedVersion: value.expectedVersion,
        idempotencyKey: value.idempotencyKey,
        identity,
        status: value.status,
      };
    }
    return entries;
  } catch {
    return null;
  }
}

function writeStoredAttempts(attempts: Record<string, StoredAttempt>): boolean {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return false;
    if (Object.keys(attempts).length === 0) {
      storage.removeItem(pendingStorageKey);
    } else {
      storage.setItem(pendingStorageKey, JSON.stringify(attempts));
    }
    return true;
  } catch {
    return false;
  }
}

function persistAttempt(value: FrozenLeadPush): boolean {
  const attempts = readStoredAttempts();
  if (!attempts) return false;
  attempts[value.identity] = { ...value, status: 'PENDING' };
  return writeStoredAttempts(attempts);
}

function persistSettledAttempt(value: FrozenLeadPush): boolean {
  const attempts = readStoredAttempts();
  if (!attempts) return false;
  const current = attempts[value.identity];
  if (!current || !sameFrozenAttempt(current, value)) return false;
  delete attempts[value.identity];
  return writeStoredAttempts(attempts);
}

function sameFrozenAttempt(
  left: FrozenLeadPush,
  right: FrozenLeadPush,
): boolean {
  return (
    left.identity === right.identity &&
    left.leadId === right.leadId &&
    left.expectedVersion === right.expectedVersion &&
    left.idempotencyKey === right.idempotencyKey
  );
}

const matchingPending = () =>
  props.pendingPush?.leadId === props.leadId &&
  props.pendingPush.identity === props.identity
    ? props.pendingPush
    : null;

async function load(): Promise<void> {
  const currentGeneration = ++generation;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  detail.value = undefined;
  errorMessage.value = '';
  try {
    const current = await getLead(props.leadId, { signal: controller.signal });
    if (
      controller.signal.aborted ||
      currentGeneration !== generation ||
      request !== controller
    )
      return;
    detail.value = current;
    state.value =
      current.capabilities.edit || current.capabilities.push
        ? 'ready'
        : 'denied';
  } catch {
    if (!controller.signal.aborted && currentGeneration === generation) {
      state.value = 'failed';
    }
  }
}

function close(): void {
  if (busy.value || matchingPending()) return;
  emit('close');
}

function isUnknown(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status === 408 ||
    error.status >= 500 ||
    error.code === 'INVALID_RESPONSE'
  );
}

async function pushCurrent(): Promise<void> {
  if (busy.value || props.identity === '' || matchingPending()) return;
  const capturedLeadId = props.leadId;
  const capturedIdentity = props.identity;
  const capturedGeneration = generation;
  busy.value = true;
  errorMessage.value = '';
  try {
    const latest = await getLead(capturedLeadId);
    if (
      capturedGeneration !== generation ||
      capturedIdentity !== props.identity ||
      capturedLeadId !== props.leadId
    )
      return;
    if (!latest.capabilities.push) {
      detail.value = latest;
      state.value = latest.capabilities.edit ? 'ready' : 'denied';
      errorMessage.value = '当前线索已不能推送，请核对最新权限和线索状态。';
      return;
    }
    const frozen: FrozenLeadPush = {
      leadId: capturedLeadId,
      expectedVersion: latest.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      identity: capturedIdentity,
    };
    if (!globalThis.window.confirm('确认推送此线索？')) return;
    if (!persistAttempt(frozen)) {
      state.value = 'failed';
      errorMessage.value = '无法安全保存原请求标识，尚未发起推送。';
      return;
    }
    emit('pending', capturedIdentity, frozen);
    state.value = 'unknown';
    await sendFrozen(frozen);
  } catch {
    errorMessage.value = '线索信息无法刷新，尚未发起推送。';
    state.value = 'failed';
  } finally {
    busy.value = false;
  }
}

async function sendFrozen(frozen: FrozenLeadPush): Promise<void> {
  busy.value = true;
  state.value = 'unknown';
  errorMessage.value = '';
  try {
    await pushLead(
      frozen.leadId,
      frozen.expectedVersion,
      frozen.idempotencyKey,
    );
    if (!persistSettledAttempt(frozen)) return;
    emit('pending', frozen.identity, null, frozen);
    emit('succeeded', frozen);
  } catch (error) {
    if (isUnknown(error)) {
      errorMessage.value =
        '推送结果尚未确认。请使用同一请求重试核对，不要重新办理。';
    } else {
      const failureMessage =
        error instanceof ApiError && error.status === 403
          ? '推送权限已变化，请核对最新权限。'
          : '线索状态或版本已变化，请核对线索后再办理。';
      if (!persistSettledAttempt(frozen)) return;
      emit('pending', frozen.identity, null, frozen);
      await load();
      errorMessage.value = failureMessage;
    }
  } finally {
    busy.value = false;
  }
}

async function retryFrozen(): Promise<void> {
  const frozen = matchingPending();
  if (!frozen || busy.value || props.identity !== frozen.identity) return;
  await sendFrozen(frozen);
}

watch(
  () => [props.leadId, props.identity],
  () => {
    if (!props.pendingPush) {
      void load();
    } else if (props.pendingPush) {
      state.value = 'unknown';
      detail.value = undefined;
    }
  },
);
watch(
  () => props.pendingPush,
  (value) => {
    if (value) {
      state.value = 'unknown';
      detail.value = undefined;
    }
  },
);
onMounted(() => {
  if (props.pendingPush) state.value = 'unknown';
  else void load();
});
onBeforeUnmount(() => {
  generation += 1;
  request?.abort();
});
</script>

<template>
  <div class="lead-quick-actions-backdrop" @click.self="close">
    <section
      class="lead-quick-actions-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-quick-actions-title"
      data-test="lead-quick-actions-panel"
    >
      <div class="page-head">
        <h2 id="lead-quick-actions-title">办理线索</h2>
        <ElButton
          data-test="close-quick-actions"
          :disabled="busy || !!pendingPush"
          @click="close"
          >关闭</ElButton
        >
      </div>
      <p v-if="state === 'loading'" role="status">正在核对最新线索权限…</p>
      <div v-else-if="state === 'unknown'" role="alert">
        <p>
          {{ errorMessage || '推送结果尚未确认。请使用同一请求重试核对。' }}
        </p>
        <ElButton
          data-test="retry-unknown-push"
          :disabled="
            busy ||
            !matchingPending() ||
            matchingPending()?.identity !== identity
          "
          @click="retryFrozen"
          >按原请求重试核对</ElButton
        >
      </div>
      <div v-else-if="state === 'failed'" role="alert">
        <p>{{ errorMessage || '暂时无法读取线索权限。' }}</p>
        <ElButton data-test="retry-lead-read" @click="load">重新读取</ElButton>
      </div>
      <div v-else-if="state === 'denied'">
        <p>当前账号无可用的快捷办理权限。</p>
      </div>
      <template v-else-if="detail">
        <p>{{ detail.businessNo }} · {{ detail.shopName }}</p>
        <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
        <RouterLink
          v-if="detail.capabilities.edit"
          :to="{
            path: `/leads/${detail.id}/edit`,
            query: { returnTo: returnTo },
          }"
          data-test="quick-edit-lead"
          >编辑线索</RouterLink
        >
        <ElButton
          v-if="detail.capabilities.push"
          data-test="quick-push-lead"
          :disabled="busy || !!pendingPush"
          @click="pushCurrent"
          >推送线索</ElButton
        >
        <RouterLink :to="`/leads/${detail.id}`" data-test="quick-open-detail"
          >查看详情</RouterLink
        >
      </template>
    </section>
  </div>
</template>

<style scoped>
.lead-quick-actions-backdrop {
  position: fixed;
  z-index: 2000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(15 23 42 / 45%);
}
.lead-quick-actions-panel {
  width: min(100%, 480px);
  padding: 24px;
  border-radius: 12px;
  background: var(--el-bg-color, white);
  box-shadow: 0 16px 48px rgb(15 23 42 / 20%);
}
</style>
