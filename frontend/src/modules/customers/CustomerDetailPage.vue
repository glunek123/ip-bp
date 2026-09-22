<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  getCustomer,
  type CustomerDetail,
  type CustomerSummary,
} from '../../api/customers';
import CustomerRightsHolderPanel from './CustomerRightsHolderPanel.vue';
import CustomerAdmissionPanel from './CustomerAdmissionPanel.vue';

const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const customer = ref<CustomerDetail>();
let activeRequest: AbortController | undefined;

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
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  state.value = 'loading';
  try {
    customer.value = await getCustomer(String(route.params.id), {
      signal: controller.signal,
    });
    if (!controller.signal.aborted) state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'CUSTOMER_NOT_FOUND'
        ? 'missing'
        : isCustomerNotFound(error)
          ? 'missing'
          : 'failed';
  }
}

function updateCustomerVersion(version: number): void {
  if (customer.value) customer.value = { ...customer.value, version };
}

function acceptRefreshedCustomer(latest: CustomerDetail): void {
  customer.value = latest;
}

async function acceptAdmission(admitted: CustomerSummary): Promise<void> {
  const current = customer.value;
  if (current === undefined) return;
  customer.value = {
    ...current,
    ...admitted,
    capabilities: { ...current.capabilities, admit: false },
    history: current.history,
  };
  try {
    customer.value = await getCustomer(admitted.id);
  } catch {
    // The admitted snapshot is already authoritative; a detail refresh can be retried later.
  }
}

async function refreshCustomerVersion(): Promise<void> {
  try {
    customer.value = await getCustomer(String(route.params.id));
  } catch (error) {
    if (isCustomerNotFound(error)) returnToCustomerList();
    // Other failures leave the panel's input and refresh prompt visible.
  }
}

function returnToCustomerList(): void {
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

onMounted(() => void load());
onBeforeUnmount(() => activeRequest?.abort());
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
            <RouterLink
              v-if="customer.capabilities.editRoutine"
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
        <section class="ledger-panel detail-card">
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
              <dt>客户类型</dt>
              <dd>{{ customer.customerType || '未填写' }}</dd>
            </div>
            <div>
              <dt>证件类型</dt>
              <dd>{{ customer.identityType || '未填写' }}</dd>
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
          :customer-id="customer.id"
          :customer-version="customer.version"
          :can-edit="customer.capabilities.editRoutine"
          @version-updated="updateCustomerVersion"
          @refresh-requested="refreshCustomerVersion"
          @customer-not-found="returnToCustomerList"
        />
        <CustomerAdmissionPanel
          :customer="customer"
          @admitted="acceptAdmission"
          @customer-refreshed="acceptRefreshedCustomer"
          @customer-not-found="returnToCustomerList"
        />
        <details class="history-panel">
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
      </template>
    </main>
  </div>
</template>
