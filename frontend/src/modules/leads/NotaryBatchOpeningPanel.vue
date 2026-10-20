<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import type {
  ListWorkflowContext,
  ListWorkflowSession,
} from '../../app/list-workflow-context';
import { getNotaryMatter, type NotaryMatterDetail } from '../../api/notary';
import NotaryMatterWorkflowPanel from './NotaryMatterWorkflowPanel.vue';

type ResultState = '未提交' | '提交中' | '成功' | '确定失败' | '未知';
type ItemResult = {
  id: string;
  state: ResultState;
  businessNo?: string;
  note?: string;
};
function actorIdentityKey(actorKey: string): string {
  return actorKey.split(':').slice(0, 3).join(':');
}
function hasPendingOpening(actorKey: string, matterId: string): boolean {
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    const key = globalThis.sessionStorage.key(index);
    if (!key?.startsWith('notary-list-request:')) continue;
    try {
      const tuple: unknown = JSON.parse(
        key.slice('notary-list-request:'.length),
      );
      if (
        Array.isArray(tuple) &&
        tuple.length === 3 &&
        typeof tuple[0] === 'string' &&
        actorIdentityKey(tuple[0]) === actorIdentityKey(actorKey) &&
        tuple[1] === matterId &&
        tuple[2] === 'opening-form'
      )
        return true;
    } catch {
      continue;
    }
  }
  return false;
}
const props = defineProps<{ matterIds: string[]; actorKey: string }>();
const emit = defineEmits<{
  close: [successfulIds: string[]];
  completed: [
    failedItems: Array<{ id: string; businessNo?: string; note?: string }>,
  ];
}>();
const results = ref<ItemResult[]>([]);
const activeIndex = ref(0);
const detail = ref<NotaryMatterDetail | null>(null);
const loading = ref(false);
const message = ref('');
const requestState = ref<'idle' | 'submitting' | 'unknown'>('idle');
let generation = 0;
let readRequest: AbortController | undefined;
const active = computed(() => results.value[activeIndex.value] ?? null);
const allSettled = computed(
  () =>
    results.value.length > 0 &&
    results.value.every(
      (item) => item.state === '成功' || item.state === '确定失败',
    ),
);
const failedItems = computed(() =>
  results.value.filter((item) => item.state === '确定失败'),
);
const canLeave = () =>
  requestState.value === 'idle' && active.value?.state !== '未知';
defineExpose({ canLeave });

function current(g: number, actor: string, id: string) {
  return (
    generation === g && props.actorKey === actor && active.value?.id === id
  );
}
async function loadActive() {
  const item = active.value;
  if (!item || loading.value || requestState.value !== 'idle') return;
  const g = generation;
  const actor = props.actorKey;
  const controller = new AbortController();
  readRequest = controller;
  loading.value = true;
  detail.value = null;
  message.value = '';
  try {
    const fresh = await getNotaryMatter(item.id, {
      signal: controller.signal,
    });
    if (controller.signal.aborted || !current(g, actor, item.id)) return;
    detail.value = fresh;
    item.businessNo = fresh.businessNo;
    if (
      (fresh.stage !== 'WAITING_UNBOX' || !fresh.capabilities.recordOpening) &&
      item.state !== '未知'
    ) {
      item.state = '确定失败';
      item.note = '最新事项阶段或权限不允许登记开箱。';
      message.value = item.note;
    }
  } catch (error) {
    if (controller.signal.aborted || !current(g, actor, item.id)) return;
    if (item.state !== '未知') {
      item.state = '确定失败';
      item.note =
        error instanceof ApiError && [401, 403, 404].includes(error.status)
          ? '当前账号无法读取此事项，请核对列表权限。'
          : '读取最新事项失败；请刷新后再决定是否继续。';
    } else {
      item.note =
        error instanceof ApiError && [401, 403, 404].includes(error.status)
          ? '当前账号无法读取此事项；原请求仍未知，不能创建新请求。'
          : '读取事实失败；原请求仍未知，不能创建新请求。';
    }
    message.value = item.note;
  } finally {
    if (readRequest === controller) {
      readRequest = undefined;
      if (current(g, actor, item.id)) loading.value = false;
    }
  }
}

function makeSession(): ListWorkflowSession | null {
  const item = active.value;
  if (
    !item ||
    !detail.value ||
    !['未提交', '提交中', '确定失败', '未知'].includes(item.state)
  )
    return null;
  const generationAtCreate = generation;
  const actor = props.actorKey;
  const context: ListWorkflowContext = {
    recordId: item.id,
    actorKey: actor,
    actionKey: 'opening-form',
    title: `登记开箱 · ${detail.value.businessNo}`,
  };
  const contextKey = JSON.stringify([
    actor,
    item.id,
    'opening-form',
    generationAtCreate,
  ]);
  return Object.freeze({
    context,
    generation: generationAtCreate,
    contextKey,
    isCurrent: () => current(generationAtCreate, actor, item.id),
    beginSubmit({ recovery } = {}) {
      if (
        !current(generationAtCreate, actor, item.id) ||
        loading.value ||
        requestState.value !== (recovery ? 'unknown' : 'idle')
      )
        return false;
      requestState.value = 'submitting';
      item.state = '提交中';
      item.note = undefined;
      return true;
    },
    endSubmit(outcome) {
      if (
        !current(generationAtCreate, actor, item.id) ||
        requestState.value !== 'submitting'
      )
        return false;
      if (outcome === 'success') {
        requestState.value = 'idle';
        item.state = '成功';
        item.note = '开箱资料已保存。';
        detail.value = null;
      } else if (outcome === 'unknown') {
        requestState.value = 'unknown';
        item.state = '未知';
        item.note = '结果未知；只能使用原请求键重试核实。';
      } else {
        if (hasPendingOpening(actor, item.id)) {
          requestState.value = 'idle';
          item.state = '未知';
          item.note =
            '核实请求被拒，原请求仍未确认；读取最新事实后再用原请求键核实。';
          detail.value = null;
          message.value = item.note;
          return true;
        }
        requestState.value = 'idle';
        item.state = '确定失败';
        item.note =
          item.note ?? '提交被确定拒绝。已重新读取事项事实，请核对后再提交。';
        void refreshAfterFailure(generationAtCreate, actor, item.id);
      }
      return true;
    },
    restoreUnknown() {
      if (
        !current(generationAtCreate, actor, item.id) ||
        requestState.value !== 'idle'
      )
        return false;
      requestState.value = 'unknown';
      item.state = '未知';
      return true;
    },
    deny() {
      if (!current(generationAtCreate, actor, item.id)) return;
      if (hasPendingOpening(actor, item.id)) {
        item.state = '未知';
        item.note =
          '核实请求被拒，原请求仍未确认；读取最新事实后再用原请求键核实。';
        requestState.value = 'idle';
        detail.value = null;
        return;
      }
      item.state = '确定失败';
      item.note = '账号、权限或事项已变化，请停止此项并核对列表。';
      requestState.value = 'idle';
      detail.value = null;
    },
  });
}
async function refreshAfterFailure(g: number, actor: string, id: string) {
  readRequest?.abort();
  const controller = new AbortController();
  readRequest = controller;
  loading.value = true;
  try {
    const fresh = await getNotaryMatter(id, { signal: controller.signal });
    if (controller.signal.aborted || !current(g, actor, id)) return;
    detail.value = fresh;
    active.value!.businessNo = fresh.businessNo;
    // Force the child session to be recreated around the latest version.
  } catch {
    if (!controller.signal.aborted && current(g, actor, id))
      message.value = '提交失败后刷新事实也失败，请手动刷新页面。';
  } finally {
    if (readRequest === controller) {
      readRequest = undefined;
      if (current(g, actor, id)) loading.value = false;
    }
  }
}
function rereadUnknown() {
  if (active.value?.state === '未知' && !detail.value && !loading.value)
    void loadActive();
}
const session = computed(() => makeSession());
function next() {
  if (
    !canLeave() ||
    !active.value ||
    !['成功', '确定失败'].includes(active.value.state)
  )
    return;
  const nextIndex = results.value.findIndex(
    (item, index) =>
      index > activeIndex.value &&
      (item.state === '未提交' || item.state === '未知'),
  );
  if (nextIndex < 0) {
    if (allSettled.value) emit('completed', failedItems.value);
    return;
  }
  readRequest?.abort();
  readRequest = undefined;
  generation += 1;
  loading.value = false;
  activeIndex.value = nextIndex;
  detail.value = null;
  void loadActive();
}
function retryFailed() {
  const item = active.value;
  if (!item || item.state !== '确定失败' || requestState.value !== 'idle')
    return;
  item.state = '未提交';
  item.note = undefined;
  // Keep the current panel mounted so unsent photo selections and sender fields
  // survive a deterministic rejection. A previously skipped item has no detail,
  // in which case it must be rebuilt from its own fresh facts.
  if (detail.value)
    void refreshAfterFailure(generation, props.actorKey, item.id);
  else void loadActive();
}
function returnToFailed() {
  const index = results.value.findIndex((item) => item.state === '确定失败');
  if (index < 0 || requestState.value !== 'idle') return;
  generation += 1;
  readRequest?.abort();
  readRequest = undefined;
  loading.value = false;
  activeIndex.value = index;
  detail.value = null;
  message.value = '已返回失败事项；刷新当前事实后可重新提交。';
}
function recordFailure(reason: string) {
  if (active.value?.state === '提交中' || active.value?.state === '确定失败')
    active.value.note = reason;
}
function closePanel() {
  emit(
    'close',
    results.value
      .filter((item) => item.state === '成功')
      .map((item) => item.id),
  );
}
watch(
  () => [props.actorKey, [...props.matterIds].join('|')],
  () => {
    generation += 1;
    readRequest?.abort();
    readRequest = undefined;
    loading.value = false;
    requestState.value = 'idle';
    detail.value = null;
    activeIndex.value = 0;
    results.value = [...new Set(props.matterIds)].map((id) => {
      let unknown = false;
      try {
        unknown = hasPendingOpening(props.actorKey, id);
      } catch {
        unknown = true;
      }
      return {
        id,
        state: unknown ? '未知' : '未提交',
        ...(unknown ? { note: '存在原请求，必须用同一请求键核实。' } : {}),
      };
    });
    if (results.value.length) void loadActive();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  generation += 1;
  readRequest?.abort();
  readRequest = undefined;
});
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="batch-opening-panel">
    <div class="page-head">
      <div>
        <h2>逐项登记开箱</h2>
        <p>每个事项单独核对照片和寄件信息并分别保存；照片不会跨事项归属。</p>
      </div>
      <button
        type="button"
        data-test="batch-opening-close"
        :disabled="!canLeave()"
        @click="closePanel"
      >
        关闭
      </button>
    </div>
    <ol data-test="batch-opening-results">
      <li
        v-for="(item, index) in results"
        :key="item.id"
        :data-test="`opening-item-${item.id}`"
      >
        {{ item.businessNo ?? item.id }}：{{ item.state
        }}<span v-if="item.note">（{{ item.note }}）</span
        ><span v-if="index === activeIndex"> — 当前</span>
      </li>
    </ol>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="loading">正在读取当前事项的最新事实。</p>
    <button
      v-if="active?.state === '未知' && !detail && !loading"
      type="button"
      data-test="batch-opening-reread-unknown"
      @click="rereadUnknown"
    >
      重新读取此事项
    </button>
    <NotaryMatterWorkflowPanel
      v-if="detail && session && active?.state !== '成功'"
      :key="session.contextKey"
      :detail="detail"
      :session="session"
      @failed="recordFailure"
    />
    <div v-if="active?.state === '确定失败'" class="batch-actions">
      <button
        type="button"
        data-test="batch-opening-refresh-retry"
        @click="retryFailed"
      >
        刷新事实后重试此项</button
      ><button
        v-if="
          results.some(
            (item, index) =>
              index > activeIndex &&
              (item.state === '未提交' || item.state === '未知'),
          )
        "
        type="button"
        data-test="batch-opening-next"
        @click="next"
      >
        跳过此项，处理下一项</button
      ><button
        v-else-if="allSettled"
        type="button"
        data-test="batch-opening-finish"
        @click="emit('completed', failedItems)"
      >
        完成并保留 {{ failedItems.length }} 个失败事项
      </button>
    </div>
    <div v-else-if="active?.state === '成功'" class="batch-actions">
      <button
        v-if="
          results.some(
            (item, index) =>
              index > activeIndex &&
              (item.state === '未提交' || item.state === '未知'),
          )
        "
        type="button"
        data-test="batch-opening-next"
        @click="next"
      >
        处理下一项</button
      ><template v-else-if="allSettled"
        ><button
          v-if="failedItems.length"
          type="button"
          data-test="batch-opening-return-failed"
          @click="returnToFailed"
        >
          返回失败事项（{{ failedItems.length }}）</button
        ><button
          type="button"
          data-test="batch-opening-finish"
          @click="emit('completed', failedItems)"
        >
          {{
            failedItems.length
              ? `完成并保留 ${failedItems.length} 个失败事项`
              : '完成'
          }}
        </button></template
      >
    </div>
    <p v-if="active?.state === '未知'" role="alert">
      当前事项锁定。请在上方使用原请求键核实结果后再继续。
    </p>
  </section>
</template>

<style scoped>
.batch-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}
</style>
