<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listDeletedCustomerDrafts,
  restoreCustomerDraft,
  type DeletedCustomerDraft,
} from '../../api/customers';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';
import {
  clearPendingCustomerDraftCommand,
  listPendingCustomerDraftCommands,
  savePendingCustomerDraftCommand,
  type PendingCustomerDraftCommand,
} from './customer-lifecycle-pending';

const auth = useAuthStore(pinia);
const route = useRoute();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<DeletedCustomerDraft[]>([]);
const page = ref(1);
const total = ref(0);
const pageSize = 20;
const activeId = ref<string>();
const reason = ref('');
const commandState = ref<'idle' | 'submitting' | 'unknown' | 'conflict'>(
  'idle',
);
const frozen = ref<PendingCustomerDraftCommand>();
const refreshNotice = ref(false);

function actorIdentity() {
  const session = auth.session;
  return session?.department
    ? { userId: session.user.id, departmentId: session.department.id }
    : undefined;
}

function recoverPending(): void {
  const actor = actorIdentity();
  const recovered = actor
    ? listPendingCustomerDraftCommands(actor, 'restore-draft')[0]
    : undefined;
  if (!recovered) return;
  frozen.value = recovered;
  activeId.value = recovered.customerId;
  reason.value = recovered.reason ?? '';
  commandState.value = 'unknown';
}

async function load(): Promise<void> {
  state.value = 'loading';
  try {
    const result = await listDeletedCustomerDrafts(page.value, pageSize);
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
    if (page.value > lastPage) {
      page.value = lastPage;
      await load();
      return;
    }
    items.value = result.items;
    total.value = result.total;
    state.value = 'ready';
  } catch {
    state.value = 'failed';
  }
}

async function changePage(next: number): Promise<void> {
  if (
    state.value === 'loading' ||
    next < 1 ||
    next > Math.max(1, Math.ceil(total.value / pageSize))
  )
    return;
  page.value = next;
  activeId.value = frozen.value?.customerId;
  await load();
}

async function locateAuthorizedDraft(customerId: string): Promise<void> {
  state.value = 'loading';
  try {
    let nextPage = 1;
    while (true) {
      const result = await listDeletedCustomerDrafts(nextPage, pageSize);
      if (result.items.some((item) => item.id === customerId)) {
        page.value = nextPage;
        items.value = result.items;
        total.value = result.total;
        activeId.value = customerId;
        state.value = 'ready';
        return;
      }
      if (nextPage * pageSize >= result.total) break;
      nextPage += 1;
    }
    page.value = 1;
    await load();
  } catch {
    state.value = 'failed';
  }
}

function select(item: DeletedCustomerDraft): void {
  if (frozen.value) return;
  activeId.value = item.id;
  reason.value = '';
  commandState.value = 'idle';
  frozen.value = undefined;
}

async function restore(item?: DeletedCustomerDraft): Promise<void> {
  if (commandState.value === 'submitting' || commandState.value === 'conflict')
    return;
  if (!frozen.value) {
    if (!item) return;
    const actor = actorIdentity();
    if (!actor) return;
    const trimmed = reason.value.trim();
    if (trimmed.length > 500) return;
    frozen.value = {
      ...actor,
      action: 'restore-draft',
      customerId: item.id,
      expectedVersion: item.version,
      ...(trimmed ? { reason: trimmed } : {}),
      key: globalThis.crypto.randomUUID(),
    };
    savePendingCustomerDraftCommand(frozen.value);
  }
  const request = frozen.value;
  commandState.value = 'submitting';
  try {
    await restoreCustomerDraft(
      request.customerId,
      {
        expectedVersion: request.expectedVersion,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      },
      request.key,
    );
    clearPendingCustomerDraftCommand(request);
    frozen.value = undefined;
    activeId.value = undefined;
    commandState.value = 'idle';
    await load();
    refreshNotice.value = state.value === 'failed';
  } catch (error) {
    commandState.value =
      error instanceof ApiError && error.status === 409
        ? 'conflict'
        : 'unknown';
  }
}

async function refreshConflict(): Promise<void> {
  if (frozen.value) clearPendingCustomerDraftCommand(frozen.value);
  frozen.value = undefined;
  activeId.value = undefined;
  commandState.value = 'idle';
  await load();
}

onMounted(() => {
  recoverPending();
  const focus = route.query.focus;
  if (
    !frozen.value &&
    typeof focus === 'string' &&
    /^[0-9a-f-]{36}$/i.test(focus)
  )
    void locateAuthorizedDraft(focus);
  else void load();
});
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/customers">← 返回客户列表</RouterLink>
      <div class="section-heading">
        <div>
          <p class="section-kicker">客户基础</p>
          <h1>已删除草稿</h1>
        </div>
      </div>
      <section class="ledger-panel" aria-live="polite">
        <div
          v-if="frozen && !items.some((item) => item.id === frozen?.customerId)"
          data-test="pending-restore-after-empty"
        >
          <p>
            此前对客户
            {{ frozen.customerId }}
            的恢复结果尚不确定。只能用原请求和幂等键重试。
          </p>
          <ElButton
            v-if="commandState !== 'conflict'"
            :loading="commandState === 'submitting'"
            @click="restore()"
            >按原请求重试</ElButton
          >
          <ElButton v-else @click="refreshConflict">刷新列表</ElButton>
        </div>
        <p v-if="refreshNotice" role="alert">
          恢复请求已确认成功，列表刷新失败。请重新加载列表。
        </p>
        <div v-if="state === 'loading'" class="state-panel">
          <h2>正在读取已删除草稿</h2>
        </div>
        <div v-else-if="state === 'failed'" class="state-panel">
          <h2>暂时无法加载</h2>
          <ElButton @click="load">重新加载</ElButton>
        </div>
        <div v-else-if="items.length === 0" class="state-panel">
          <h2>没有可恢复的草稿</h2>
        </div>
        <div v-else class="customer-list">
          <div
            v-for="item in items"
            :key="item.id"
            class="customer-row"
            data-test="deleted-draft-row"
          >
            <strong>{{ item.name }}</strong
            ><span
              >删除于
              {{ new Date(item.deletedAt).toLocaleString('zh-CN') }}</span
            >
            <ElButton
              v-if="item.capabilities.restoreDraft && !frozen"
              @click="select(item)"
              >恢复</ElButton
            >
            <div v-if="activeId === item.id" data-test="restore-draft-confirm">
              <p>恢复原客户 {{ item.name }}（ID：{{ item.id }}）？</p>
              <p v-if="item.deletionReason">
                删除原因：{{ item.deletionReason }}
              </p>
              <label
                >恢复原因（选填）<input
                  v-model="reason"
                  :disabled="!!frozen"
                  maxlength="500"
              /></label>
              <p v-if="commandState === 'unknown'" role="alert">
                结果尚不确定。只能按原请求重试。
              </p>
              <p v-if="commandState === 'conflict'" role="alert">
                草稿状态已变化。请明确刷新列表。
              </p>
              <ElButton
                data-test="restore-draft-submit"
                :loading="commandState === 'submitting'"
                :disabled="commandState === 'conflict'"
                @click="restore(item)"
                >{{
                  commandState === 'unknown' ? '按原请求重试' : '确认恢复'
                }}</ElButton
              >
              <ElButton
                v-if="commandState === 'conflict'"
                @click="refreshConflict"
                >刷新列表</ElButton
              >
              <ElButton
                v-if="commandState === 'idle'"
                @click="activeId = undefined"
                >取消</ElButton
              >
            </div>
          </div>
        </div>
        <nav
          v-if="state === 'ready' && total > pageSize"
          class="pagination"
          aria-label="已删除草稿分页"
        >
          <ElButton
            data-test="deleted-drafts-prev"
            :disabled="page <= 1"
            @click="changePage(page - 1)"
            >上一页</ElButton
          >
          <span data-test="deleted-drafts-page"
            >第 {{ page }} / {{ Math.ceil(total / pageSize) }} 页，共
            {{ total }} 条</span
          >
          <ElButton
            data-test="deleted-drafts-next"
            :disabled="page >= Math.ceil(total / pageSize)"
            @click="changePage(page + 1)"
            >下一页</ElButton
          >
        </nav>
      </section>
    </main>
  </div>
</template>
