<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCustomer,
  deleteCustomerDraft,
  type CustomerDetail,
  type CustomerSummary,
} from '../../api/customers';
import CustomerRightsHolderPanel from './CustomerRightsHolderPanel.vue';
import CustomerAdmissionPanel from './CustomerAdmissionPanel.vue';
import CustomerAccountPanel from './CustomerAccountPanel.vue';
import CustomerRightAssetsPanel from './CustomerRightAssetsPanel.vue';
import { labelCustomerType, labelIdentityType } from './customer-labels';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';
import {
  clearPendingCustomerDraftCommand,
  readPendingCustomerDraftCommand,
  savePendingCustomerDraftCommand,
  type PendingCustomerDraftCommand,
} from './customer-lifecycle-pending';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore(pinia);
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const customer = ref<CustomerDetail>();
const activeTab = ref<'basic' | 'assets' | 'settlements'>('basic');
const requests = new Set<AbortController>();
const deletionReason = ref('');
const deletePrompt = ref(false);
const deleteStatus = ref<'idle' | 'submitting' | 'unknown' | 'conflict'>(
  'idle',
);
const frozenDelete = ref<PendingCustomerDraftCommand>();

function pendingIdentity(customerId: string) {
  const session = auth.session;
  if (!session?.department) return undefined;
  return {
    action: 'delete-draft' as const,
    userId: session.user.id,
    departmentId: session.department.id,
    customerId,
  };
}

function restorePending(customerId: string): void {
  const identity = pendingIdentity(customerId);
  frozenDelete.value =
    identity === undefined
      ? undefined
      : readPendingCustomerDraftCommand(identity);
  if (frozenDelete.value) {
    deletionReason.value = frozenDelete.value.reason ?? '';
    deleteStatus.value = 'unknown';
    deletePrompt.value = true;
  } else {
    deleteStatus.value = 'idle';
    deletePrompt.value = false;
  }
}

async function submitDelete(): Promise<void> {
  const current = customer.value;
  if (deleteStatus.value === 'submitting') return;
  if (!frozenDelete.value && (!current || !current.capabilities.deleteDraft))
    return;
  if (frozenDelete.value === undefined) {
    const identity = pendingIdentity(current!.id);
    if (!identity) return;
    const reason = deletionReason.value.trim();
    if (reason.length > 500) return;
    frozenDelete.value = {
      ...identity,
      expectedVersion: current!.version,
      ...(reason.length > 0 ? { reason } : {}),
      key: globalThis.crypto.randomUUID(),
    };
    savePendingCustomerDraftCommand(frozenDelete.value);
  }
  const command = frozenDelete.value;
  deleteStatus.value = 'submitting';
  try {
    await deleteCustomerDraft(
      command.customerId,
      {
        expectedVersion: command.expectedVersion,
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      },
      command.key,
    );
    clearPendingCustomerDraftCommand(command);
    frozenDelete.value = undefined;
    if (String(route.params.id) === command.customerId)
      await router.push('/customers');
  } catch (error) {
    if (String(route.params.id) !== command.customerId) return;
    deleteStatus.value =
      error instanceof ApiError && error.status === 409
        ? 'conflict'
        : 'unknown';
  }
}

async function refreshAfterDeleteConflict(): Promise<void> {
  if (frozenDelete.value) clearPendingCustomerDraftCommand(frozenDelete.value);
  frozenDelete.value = undefined;
  deleteStatus.value = 'idle';
  deletePrompt.value = false;
  await load();
}

function abortRequests(): void {
  for (const controller of requests) controller.abort();
  requests.clear();
}

function isCurrentRequest(
  customerId: string,
  controller: AbortController,
): boolean {
  return (
    !controller.signal.aborted &&
    String(route.params.id) === customerId &&
    customer.value?.id === customerId
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function actionLabel(action: string): string {
  if (action === 'customer.draft-created') return '创建客户草稿';
  if (action === 'customer.duplicate-name-overridden') return '同名核对后继续';
  if (action === 'customer.admitted') return '客户准入完成';
  return '客户资料变更';
}

function profileLabel(status: CustomerSummary['profileStatus']): string {
  return status === 'admitted' ? '已准入' : '草稿';
}

async function load(): Promise<void> {
  const customerId = String(route.params.id);
  const controller = new AbortController();
  requests.add(controller);
  state.value = 'loading';
  try {
    const latest = await getCustomer(customerId, {
      signal: controller.signal,
    });
    if (!controller.signal.aborted && String(route.params.id) === customerId) {
      customer.value = latest;
      state.value = 'ready';
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    if (String(route.params.id) !== customerId) return;
    state.value =
      error instanceof ApiError && error.code === 'CUSTOMER_NOT_FOUND'
        ? 'missing'
        : isCustomerNotFound(error)
          ? 'missing'
          : 'failed';
  } finally {
    requests.delete(controller);
  }
}

function updateCustomerVersion(customerId: string, version: number): void {
  if (
    customer.value?.id !== customerId ||
    String(route.params.id) !== customerId
  ) {
    return;
  }
  if (customer.value) customer.value = { ...customer.value, version };
}

function acceptRefreshedCustomer(latest: CustomerDetail): void {
  if (
    latest.id !== String(route.params.id) ||
    customer.value?.id !== latest.id
  ) {
    return;
  }
  customer.value = latest;
}

async function acceptAdmission(admitted: CustomerSummary): Promise<void> {
  const current = customer.value;
  if (
    current === undefined ||
    current.id !== admitted.id ||
    admitted.id !== String(route.params.id)
  ) {
    return;
  }
  customer.value = {
    ...current,
    ...admitted,
    capabilities: { ...current.capabilities, admit: false },
    history: current.history,
  };
  const controller = new AbortController();
  requests.add(controller);
  try {
    const latest = await getCustomer(admitted.id, {
      signal: controller.signal,
    });
    if (isCurrentRequest(admitted.id, controller)) customer.value = latest;
  } catch {
    // The admitted snapshot is already authoritative; a detail refresh can be retried later.
  } finally {
    requests.delete(controller);
  }
}

async function refreshCustomerVersion(customerId: string): Promise<void> {
  if (
    customer.value?.id !== customerId ||
    customerId !== String(route.params.id)
  ) {
    return;
  }
  const controller = new AbortController();
  requests.add(controller);
  try {
    const latest = await getCustomer(customerId, { signal: controller.signal });
    if (isCurrentRequest(customerId, controller)) customer.value = latest;
  } catch (error) {
    if (isCurrentRequest(customerId, controller) && isCustomerNotFound(error)) {
      returnToCustomerList(customerId);
    }
    // Other failures leave the panel's input and refresh prompt visible.
  } finally {
    requests.delete(controller);
  }
}

function returnToCustomerList(customerId: string): void {
  if (
    customerId !== String(route.params.id) ||
    customer.value?.id !== customerId
  ) {
    return;
  }
  void router.push('/customers');
}

function isCustomerNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'CUSTOMER_NOT_FOUND'
  );
}

watch(
  () => String(route.params.id),
  () => {
    abortRequests();
    restorePending(String(route.params.id));
    customer.value = undefined;
    activeTab.value = 'basic';
    state.value = 'loading';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(abortRequests);
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink class="back-link" to="/customers">← 返回客户列表</RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <span class="state-index">读取中</span>
        <h1>正在读取客户资料</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <span class="state-index">404</span>
        <h1>客户不存在或当前不可访问</h1>
        <p>请返回列表，从有权查看的客户中重新选择。</p>
        <div v-if="frozenDelete" data-test="pending-delete-after-404">
          <p>此前的删除请求结果尚不确定。可用原请求和原幂等键重试。</p>
          <ElButton
            v-if="deleteStatus !== 'conflict'"
            :loading="deleteStatus === 'submitting'"
            @click="submitDelete"
            >按原请求重试</ElButton
          >
          <ElButton v-else @click="refreshAfterDeleteConflict"
            >刷新客户资料</ElButton
          >
        </div>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <span class="state-index">连接失败</span>
        <h1>客户资料暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="customer">
        <div class="detail-heading">
          <div>
            <p class="section-kicker">客户详情</p>
            <h1>{{ customer.name }}</h1>
          </div>
          <div class="detail-actions">
            <ElButton
              v-if="customer.capabilities.deleteDraft && !frozenDelete"
              data-test="delete-draft-open"
              @click="deletePrompt = true"
              >删除草稿</ElButton
            >
            <RouterLink
              v-if="customer.capabilities.editRoutine && !frozenDelete"
              data-test="edit-customer"
              :to="`/customers/${customer.id}/edit`"
            >
              编辑资料
            </RouterLink>
            <span class="status-chip status-chip--large">{{
              profileLabel(customer.profileStatus)
            }}</span>
          </div>
        </div>
        <section
          v-if="
            deletePrompt && (customer.capabilities.deleteDraft || frozenDelete)
          "
          class="ledger-panel detail-card"
          data-test="delete-draft-confirm"
        >
          <h2>删除这份草稿？</h2>
          <p>删除后将从普通客户列表隐藏。可在已删除草稿中恢复原客户。</p>
          <label
            >原因（选填）<input
              v-model="deletionReason"
              :disabled="!!frozenDelete"
              maxlength="500"
          /></label>
          <p v-if="deleteStatus === 'unknown'" role="alert">
            结果尚不确定。重试会使用原请求和同一幂等键。
          </p>
          <p v-if="deleteStatus === 'conflict'" role="alert">
            客户资料已变化。保留当前原因，请明确刷新后再决定。
          </p>
          <ElButton
            data-test="delete-draft-submit"
            :loading="deleteStatus === 'submitting'"
            :disabled="deleteStatus === 'conflict'"
            @click="submitDelete"
            >{{
              deleteStatus === 'unknown' ? '按原请求重试' : '确认删除'
            }}</ElButton
          >
          <ElButton
            v-if="deleteStatus === 'conflict'"
            data-test="delete-draft-refresh"
            @click="refreshAfterDeleteConflict"
            >刷新客户资料</ElButton
          >
          <ElButton v-if="deleteStatus === 'idle'" @click="deletePrompt = false"
            >取消</ElButton
          >
        </section>
        <div class="customer-tabs" role="tablist" aria-label="客户详情">
          <button
            id="customer-tab-button-basic"
            class="customer-tabs__tab"
            type="button"
            role="tab"
            aria-controls="customer-tab-basic"
            :aria-selected="activeTab === 'basic'"
            @click="activeTab = 'basic'"
          >
            基本信息
          </button>
          <button
            id="customer-tab-button-assets"
            class="customer-tabs__tab"
            type="button"
            role="tab"
            aria-controls="customer-tab-assets"
            :aria-selected="activeTab === 'assets'"
            @click="activeTab = 'assets'"
          >
            权利资产
          </button>
          <button
            id="customer-tab-button-settlements"
            class="customer-tabs__tab"
            type="button"
            role="tab"
            aria-controls="customer-tab-settlements"
            :aria-selected="activeTab === 'settlements'"
            @click="activeTab = 'settlements'"
          >
            结算记录
          </button>
        </div>
        <section
          id="customer-tab-basic"
          class="customer-tab-panel"
          role="tabpanel"
          aria-labelledby="customer-tab-button-basic"
          v-show="activeTab === 'basic'"
        >
          <nav class="detail-anchor-nav" aria-label="基本信息快速导航">
            <a href="#customer-profile">客户资料</a>
            <a href="#customer-rights-holders">权利人</a>
            <a href="#customer-admission">身份材料</a>
            <a href="#customer-accounts">企业账号</a>
            <a href="#customer-history">办理历史</a>
          </nav>
          <section id="customer-profile" class="ledger-panel detail-card">
            <dl class="detail-grid">
              <div>
                <dt>资料状态</dt>
                <dd>{{ profileLabel(customer.profileStatus) }}</dd>
              </div>
              <div>
                <dt>客户类别</dt>
                <dd>{{ customer.category || '未填写' }}</dd>
              </div>
              <div>
                <dt>客户组织类型</dt>
                <dd>{{ labelCustomerType(customer.customerType) }}</dd>
              </div>
              <div>
                <dt>身份证明类型</dt>
                <dd>{{ labelIdentityType(customer.identityType) }}</dd>
              </div>
              <div>
                <dt>证件号码</dt>
                <dd>{{ customer.identityNumber || '未填写' }}</dd>
              </div>
              <div>
                <dt>签发国家／地区</dt>
                <dd>{{ customer.issuingCountryOrRegion || '未填写' }}</dd>
              </div>
              <div>
                <dt>证件有效期</dt>
                <dd>
                  {{
                    customer.identityValidityMode === 'LONG_TERM'
                      ? '长期有效'
                      : customer.identityValidityMode === 'NOT_STATED'
                        ? '证件未注明'
                        : customer.identityValidTo || '未填写'
                  }}
                </dd>
              </div>
              <div>
                <dt>所属地区</dt>
                <dd>{{ customer.region || '未填写' }}</dd>
              </div>
              <div>
                <dt>准入联系人</dt>
                <dd>{{ customer.admissionContactName || '未填写' }}</dd>
              </div>
              <div>
                <dt>联系人电话</dt>
                <dd>{{ customer.admissionContactPhone || '未填写' }}</dd>
              </div>
              <div>
                <dt>联系人邮箱</dt>
                <dd>{{ customer.admissionContactEmail || '未填写' }}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{{ formatTime(customer.updatedAt) }}</dd>
              </div>
            </dl>
            <p class="draft-note">
              {{
                customer.profileStatus === 'admitted'
                  ? '客户已完成准入，可用于创建正式线索。'
                  : '资料尚未准入，可继续补充证件与联系人。'
              }}
            </p>
          </section>
          <CustomerRightsHolderPanel
            v-if="!frozenDelete"
            id="customer-rights-holders"
            :customer-id="customer.id"
            :customer-version="customer.version"
            :can-edit="customer.capabilities.editRoutine"
            @version-updated="updateCustomerVersion"
            @refresh-requested="refreshCustomerVersion"
            @customer-not-found="returnToCustomerList"
          />
          <CustomerAdmissionPanel
            v-if="!frozenDelete"
            id="customer-admission"
            :customer="customer"
            @admitted="acceptAdmission"
            @customer-refreshed="acceptRefreshedCustomer"
            @customer-not-found="returnToCustomerList"
          />
          <CustomerAccountPanel
            v-if="!frozenDelete"
            id="customer-accounts"
            :customer-id="customer.id"
            :admitted="customer.profileStatus === 'admitted'"
          />
          <details id="customer-history" class="history-panel">
            <summary>办理历史 · {{ customer.history.length }} 条</summary>
            <ol>
              <li
                v-for="event in customer.history"
                :key="`${event.action}-${event.occurredAt}`"
              >
                <strong>{{ actionLabel(event.action) }}</strong>
                <time>{{ formatTime(event.occurredAt) }}</time>
              </li>
            </ol>
          </details>
        </section>
        <section
          id="customer-tab-assets"
          class="customer-tab-panel"
          role="tabpanel"
          aria-labelledby="customer-tab-button-assets"
          v-show="activeTab === 'assets'"
        >
          <CustomerRightAssetsPanel
            v-if="!frozenDelete"
            :customer-id="customer.id"
            :customer-version="customer.version"
            :can-edit="customer.capabilities.editRoutine"
            @version-updated="updateCustomerVersion"
            @refresh-requested="refreshCustomerVersion"
            @customer-not-found="returnToCustomerList"
          />
        </section>
        <section
          id="customer-tab-settlements"
          class="customer-tab-panel customer-tab-panel--notice"
          role="tabpanel"
          aria-labelledby="customer-tab-button-settlements"
          v-show="activeTab === 'settlements'"
        >
          <h2>结算记录</h2>
          <p>结算记录尚未接通人工台账。</p>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.customer-tabs {
  display: flex;
  gap: var(--s-2);
  margin: 0 0 var(--s-4);
  border-bottom: 1px solid var(--color-hairline);
}

.customer-tabs__tab {
  margin-bottom: -1px;
  padding: var(--s-3) var(--s-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-ink-muted);
  cursor: pointer;
  font: inherit;
}

.customer-tabs__tab[aria-selected='true'] {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 600;
}

.customer-tabs__tab:focus-visible {
  outline: 2px solid var(--color-primary-focus);
  outline-offset: 2px;
}

.customer-tab-panel--notice {
  padding: var(--s-6);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-surface-1);
}

.customer-tab-panel--notice h2 {
  margin: 0 0 var(--s-2);
  font-size: 16px;
}

.customer-tab-panel--notice p {
  margin: 0;
  color: var(--color-ink-muted);
}
</style>
