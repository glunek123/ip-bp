<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElPagination } from 'element-plus/es/components/pagination/index.mjs';
import 'element-plus/theme-chalk/el-pagination.css';
import {
  createCustomerRightsHolder,
  listCustomerRightsHolders,
  type CreateRightsHolderInput,
  type RightsHolderSummary,
} from '../../api/rights-holders';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  canEdit: boolean;
}>();
const emit = defineEmits<{
  'version-updated': [customerId: string, version: number];
  'refresh-requested': [customerId: string];
  'customer-not-found': [customerId: string];
}>();

const pageSize = 20;
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const holders = ref<RightsHolderSummary[]>([]);
const holdersTotal = ref(0);
const holdersPage = ref(1);
const capabilities = ref({ create: false });
const writeDenied = ref(false);
const createOpen = ref(false);
const name = ref('');
const credit = ref('');
const address = ref('');
const legalRepresentative = ref('');
const duty = ref('');
const nameError = ref('');
const createError = ref('');
const versionConflict = ref(false);
const saving = ref(false);
let activeRequest: AbortController | undefined;
let createRetry: { signature: string; key: string } | undefined;
let formIntentGeneration = 0;

const canCreate = computed(
  () => props.canEdit && !writeDenied.value && capabilities.value.create,
);

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function commandKey(
  previous: { signature: string; key: string } | undefined,
  signature: string,
): string {
  return previous?.signature === signature
    ? previous.key
    : globalThis.crypto.randomUUID();
}

async function load(page = holdersPage.value): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  state.value = 'loading';
  try {
    const result = await listCustomerRightsHolders(
      props.customerId,
      page,
      pageSize,
      { signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    holders.value = result.items;
    holdersTotal.value = result.total;
    holdersPage.value = result.page;
    capabilities.value = result.capabilities;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    if (isApiError(error, 'CUSTOMER_NOT_FOUND')) {
      emit('customer-not-found', props.customerId);
    } else {
      state.value = 'failed';
    }
  }
}

function openCreate(): void {
  formIntentGeneration += 1;
  saving.value = false;
  createRetry = undefined;
  createOpen.value = true;
  nameError.value = '';
  createError.value = '';
  versionConflict.value = false;
}

function closeCreate(): void {
  formIntentGeneration += 1;
  saving.value = false;
  createRetry = undefined;
  createOpen.value = false;
}

function denyWrites(): void {
  writeDenied.value = true;
  closeCreate();
}

function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

function isCurrentFormIntent(generation: number): boolean {
  return generation === formIntentGeneration && createOpen.value;
}

function createPayload(): CreateRightsHolderInput {
  return {
    expectedCustomerVersion: props.customerVersion,
    name: name.value.trim(),
    ...(optional(credit.value) ? { credit: optional(credit.value) } : {}),
    ...(optional(address.value) ? { address: optional(address.value) } : {}),
    ...(optional(legalRepresentative.value)
      ? { legalRepresentative: optional(legalRepresentative.value) }
      : {}),
    ...(optional(duty.value) ? { duty: optional(duty.value) } : {}),
  };
}

async function submitCreate(): Promise<void> {
  if (saving.value) return;
  nameError.value = name.value.trim() ? '' : '请填写权利主体名称';
  createError.value = '';
  versionConflict.value = false;
  if (nameError.value) return;
  const input = createPayload();
  const signature = JSON.stringify(input);
  const key = commandKey(createRetry, signature);
  const intentGeneration = formIntentGeneration;
  saving.value = true;
  try {
    const result = await createCustomerRightsHolder(
      props.customerId,
      input,
      key,
    );
    if (!isCurrentFormIntent(intentGeneration)) return;
    createRetry = undefined;
    createOpen.value = false;
    name.value = '';
    credit.value = '';
    address.value = '';
    legalRepresentative.value = '';
    duty.value = '';
    emit('version-updated', props.customerId, result.customerVersion);
    holdersPage.value = 1;
    await load(1);
  } catch (error) {
    if (!isCurrentFormIntent(intentGeneration)) return;
    if (isApiError(error, 'CUSTOMER_ACTION_FORBIDDEN')) {
      denyWrites();
    } else if (isApiError(error, 'CUSTOMER_NOT_FOUND')) {
      createRetry = undefined;
      emit('customer-not-found', props.customerId);
    } else {
      createRetry = { signature, key };
    }
    if (isApiError(error, 'CUSTOMER_VERSION_CONFLICT')) {
      versionConflict.value = true;
      createError.value = '客户资料已被他人更新，请先刷新客户版本再重试';
    } else if (
      !isApiError(error, 'CUSTOMER_ACTION_FORBIDDEN') &&
      !isApiError(error, 'CUSTOMER_NOT_FOUND')
    ) {
      createError.value = '权利主体创建失败，请稍后重试';
    }
  } finally {
    if (intentGeneration === formIntentGeneration) saving.value = false;
  }
}

function requestRefresh(): void {
  emit('refresh-requested', props.customerId);
}

watch(
  () => props.customerVersion,
  () => {
    formIntentGeneration += 1;
    saving.value = false;
    createRetry = undefined;
    versionConflict.value = false;
  },
);
onMounted(() => void load());
onBeforeUnmount(() => {
  formIntentGeneration += 1;
  activeRequest?.abort();
});
</script>

<template>
  <section
    class="ledger-panel detail-card"
    aria-labelledby="rights-holder-title"
  >
    <div class="detail-heading">
      <div>
        <p class="section-kicker">客户关联</p>
        <h2 id="rights-holder-title">权利主体</h2>
        <p class="field-guidance">知识产权实际所属方，可与当前客户企业不同。</p>
      </div>
      <div v-if="canCreate" class="detail-actions">
        <ElButton data-test="open-create-holder" @click="openCreate">
          新建权利主体
        </ElButton>
      </div>
    </div>

    <p v-if="state === 'loading'">正在读取权利主体……</p>
    <div v-else-if="state === 'failed'">
      <p>权利主体暂时无法加载。</p>
      <ElButton data-test="reload-holders" @click="load()">重新加载</ElButton>
    </div>
    <p v-else-if="holders.length === 0">尚未关联权利主体。</p>
    <div v-else class="holder-table-wrap">
      <table class="holder-table">
        <thead>
          <tr>
            <th scope="col">权利主体</th>
            <th scope="col">统一社会信用代码</th>
            <th scope="col">住所地</th>
            <th scope="col">法定代表人</th>
            <th scope="col">职务</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="holder in holders" :key="holder.id">
            <td>{{ holder.name }}</td>
            <td>{{ holder.credit || '—' }}</td>
            <td>{{ holder.address || '—' }}</td>
            <td>{{ holder.legalRepresentative || '—' }}</td>
            <td>{{ holder.duty || '—' }}</td>
            <td>
              <RouterLink
                :to="`/customers/${customerId}/rights-holders/${holder.id}`"
              >
                查看详情
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ElPagination
      v-if="state === 'ready' && holdersTotal > pageSize"
      data-test="holder-pagination"
      layout="prev, pager, next"
      :current-page="holdersPage"
      :page-size="pageSize"
      :total="holdersTotal"
      @current-change="load"
    />
    <p v-if="writeDenied" class="submit-error" role="alert">
      当前账号没有编辑此客户的权限
    </p>

    <section
      v-if="createOpen"
      class="form-section"
      role="dialog"
      aria-label="新建权利主体"
    >
      <h3>新建权利主体</h3>
      <label class="field-label" for="holder-name"
        >权利主体名称<RequiredFieldMark
      /></label>
      <input
        id="holder-name"
        v-model="name"
        name="name"
        class="text-input"
        maxlength="200"
      />
      <p v-if="nameError" class="field-error">{{ nameError }}</p>
      <label class="field-label field-label--spaced" for="holder-credit"
        >统一社会信用代码</label
      >
      <input
        id="holder-credit"
        v-model="credit"
        name="credit"
        class="text-input"
        maxlength="100"
      />
      <label class="field-label field-label--spaced" for="holder-address"
        >地址</label
      >
      <input
        id="holder-address"
        v-model="address"
        name="address"
        class="text-input"
        maxlength="500"
      />
      <label
        class="field-label field-label--spaced"
        for="holder-legal-representative"
        >法定代表人</label
      >
      <input
        id="holder-legal-representative"
        v-model="legalRepresentative"
        name="legalRepresentative"
        class="text-input"
        maxlength="100"
      />
      <label class="field-label field-label--spaced" for="holder-duty"
        >职务</label
      >
      <input
        id="holder-duty"
        v-model="duty"
        name="duty"
        class="text-input"
        maxlength="100"
      />
      <p v-if="createError" class="submit-error" role="alert">
        {{ createError }}
      </p>
      <ElButton
        v-if="versionConflict"
        data-test="refresh-customer-version"
        @click="requestRefresh"
      >
        刷新客户版本
      </ElButton>
      <div class="form-actions">
        <ElButton data-test="cancel-create-holder" @click="closeCreate"
          >取消</ElButton
        >
        <ElButton
          data-test="submit-create-holder"
          type="primary"
          :loading="saving"
          :disabled="saving"
          @click="submitCreate"
        >
          创建并关联
        </ElButton>
      </div>
    </section>
  </section>
</template>

<style scoped>
.holder-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.holder-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

.holder-table th,
.holder-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  text-align: left;
  vertical-align: top;
}

.holder-table th {
  white-space: nowrap;
}
</style>
