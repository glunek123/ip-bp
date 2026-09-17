<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElPagination } from 'element-plus/es/components/pagination/index.mjs';
import 'element-plus/theme-chalk/el-pagination.css';
import {
  createCustomerRightsHolder,
  findLinkableRightsHolders,
  linkCustomerRightsHolder,
  listCustomerRightsHolders,
  type CreateRightsHolderInput,
  type RightsHolderSummary,
} from '../../api/rights-holders';
import { ApiError } from '../../api/http';

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  canEdit: boolean;
}>();
const emit = defineEmits<{
  'version-updated': [version: number];
  'refresh-requested': [];
  'customer-not-found': [];
}>();

const pageSize = 20;
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const holders = ref<RightsHolderSummary[]>([]);
const holdersTotal = ref(0);
const holdersPage = ref(1);
const capabilities = ref({ create: false, link: false });
const writeDenied = ref(false);
const createOpen = ref(false);
const linkOpen = ref(false);
const name = ref('');
const credit = ref('');
const address = ref('');
const legalRepresentative = ref('');
const duty = ref('');
const nameError = ref('');
const createError = ref('');
const linkError = ref('');
const versionConflict = ref(false);
const saving = ref(false);
const linkableState = ref<'loading' | 'ready' | 'failed'>('loading');
const linkable = ref<RightsHolderSummary[]>([]);
const linkableTotal = ref(0);
const linkablePage = ref(1);
const query = ref('');
const selectedHolderId = ref('');
let activeRequest: AbortController | undefined;
let createRetry: { signature: string; key: string } | undefined;
let linkRetry: { signature: string; key: string } | undefined;

const canCreate = computed(
  () => props.canEdit && !writeDenied.value && capabilities.value.create,
);
const canLink = computed(
  () => props.canEdit && !writeDenied.value && capabilities.value.link,
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
      emit('customer-not-found');
    } else {
      state.value = 'failed';
    }
  }
}

function openCreate(): void {
  createRetry = undefined;
  createOpen.value = true;
  nameError.value = '';
  createError.value = '';
  versionConflict.value = false;
}

function closeCreate(): void {
  createRetry = undefined;
  createOpen.value = false;
}

function denyWrites(): void {
  writeDenied.value = true;
  closeCreate();
  closeLink();
}

function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
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
  saving.value = true;
  try {
    const result = await createCustomerRightsHolder(
      props.customerId,
      input,
      key,
    );
    createRetry = undefined;
    createOpen.value = false;
    name.value = '';
    credit.value = '';
    address.value = '';
    legalRepresentative.value = '';
    duty.value = '';
    emit('version-updated', result.customerVersion);
    holdersPage.value = 1;
    await load(1);
  } catch (error) {
    if (isApiError(error, 'CUSTOMER_ACTION_FORBIDDEN')) {
      denyWrites();
    } else if (isApiError(error, 'CUSTOMER_NOT_FOUND')) {
      createRetry = undefined;
      emit('customer-not-found');
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
    saving.value = false;
  }
}

async function loadLinkable(page = 1): Promise<void> {
  linkableState.value = 'loading';
  linkError.value = '';
  selectedHolderId.value = '';
  try {
    const result = await findLinkableRightsHolders(props.customerId, {
      query: optional(query.value),
      page,
      pageSize: 20,
    });
    linkable.value = result.items;
    linkableTotal.value = result.total;
    linkablePage.value = result.page;
    linkableState.value = 'ready';
  } catch (error) {
    if (isApiError(error, 'CUSTOMER_NOT_FOUND')) {
      emit('customer-not-found');
    } else {
      linkableState.value = 'failed';
    }
  }
}

function openLink(): void {
  linkRetry = undefined;
  linkOpen.value = true;
  versionConflict.value = false;
  void loadLinkable();
}

function closeLink(): void {
  linkRetry = undefined;
  linkOpen.value = false;
}

async function submitLink(): Promise<void> {
  if (saving.value || !selectedHolderId.value) return;
  linkError.value = '';
  versionConflict.value = false;
  const input = {
    expectedCustomerVersion: props.customerVersion,
    rightsHolderId: selectedHolderId.value,
  };
  const signature = JSON.stringify(input);
  const key = commandKey(linkRetry, signature);
  saving.value = true;
  try {
    const result = await linkCustomerRightsHolder(props.customerId, input, key);
    linkRetry = undefined;
    linkOpen.value = false;
    emit('version-updated', result.customerVersion);
    holdersPage.value = 1;
    await load(1);
  } catch (error) {
    if (isApiError(error, 'CUSTOMER_ACTION_FORBIDDEN')) {
      denyWrites();
    } else if (isApiError(error, 'CUSTOMER_NOT_FOUND')) {
      linkRetry = undefined;
      emit('customer-not-found');
    } else if (isApiError(error, 'RIGHTS_HOLDER_ALREADY_LINKED')) {
      linkRetry = undefined;
      await Promise.all([load(1), loadLinkable(1)]);
      linkError.value = '该权利主体已关联，列表已刷新';
    } else {
      linkRetry = { signature, key };
    }
    if (isApiError(error, 'CUSTOMER_VERSION_CONFLICT')) {
      versionConflict.value = true;
      linkError.value = '客户资料已被他人更新，请先刷新客户版本再重试';
    } else if (
      !isApiError(error, 'CUSTOMER_ACTION_FORBIDDEN') &&
      !isApiError(error, 'CUSTOMER_NOT_FOUND') &&
      !isApiError(error, 'RIGHTS_HOLDER_ALREADY_LINKED')
    ) {
      linkError.value = '权利主体关联失败，请稍后重试';
    }
  } finally {
    saving.value = false;
  }
}

function requestRefresh(): void {
  emit('refresh-requested');
}

watch(
  () => props.customerVersion,
  () => {
    createRetry = undefined;
    linkRetry = undefined;
    versionConflict.value = false;
  },
);
onMounted(() => void load());
onBeforeUnmount(() => activeRequest?.abort());
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
      </div>
      <div v-if="canCreate || canLink" class="detail-actions">
        <ElButton
          v-if="canCreate"
          data-test="open-create-holder"
          @click="openCreate"
        >
          新建主体
        </ElButton>
        <ElButton v-if="canLink" data-test="open-link-holder" @click="openLink">
          关联已有主体
        </ElButton>
      </div>
    </div>

    <p v-if="state === 'loading'">正在读取权利主体……</p>
    <div v-else-if="state === 'failed'">
      <p>权利主体暂时无法加载。</p>
      <ElButton data-test="reload-holders" @click="load()">重新加载</ElButton>
    </div>
    <p v-else-if="holders.length === 0">尚未关联权利主体。</p>
    <ul v-else class="duplicate-list">
      <li v-for="holder in holders" :key="holder.id">
        <span>{{ holder.name }}</span>
        <RouterLink
          :to="`/customers/${customerId}/rights-holders/${holder.id}`"
        >
          查看详情
        </RouterLink>
      </li>
    </ul>
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
      <label class="field-label" for="holder-name">主体名称</label>
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

    <section
      v-if="linkOpen"
      class="form-section"
      role="dialog"
      aria-label="关联已有权利主体"
    >
      <h3>关联已有权利主体</h3>
      <label class="field-label" for="holder-query">按名称搜索</label>
      <input
        id="holder-query"
        v-model="query"
        name="query"
        class="text-input"
        maxlength="200"
      />
      <ElButton data-test="search-linkable" @click="loadLinkable(1)"
        >搜索</ElButton
      >
      <p v-if="linkableState === 'loading'">正在读取可关联主体……</p>
      <div v-else-if="linkableState === 'failed'">
        <p>可关联主体暂时无法加载。</p>
        <ElButton @click="loadLinkable(linkablePage)">重新加载</ElButton>
      </div>
      <p v-else-if="linkable.length === 0">没有可关联的权利主体。</p>
      <template v-else>
        <label v-for="holder in linkable" :key="holder.id" class="field-label">
          <input
            v-model="selectedHolderId"
            type="radio"
            name="rightsHolderId"
            :value="holder.id"
          />
          {{ holder.name }}
        </label>
      </template>
      <ElPagination
        v-if="linkableState === 'ready' && linkableTotal > pageSize"
        data-test="linkable-pagination"
        layout="prev, pager, next"
        :current-page="linkablePage"
        :page-size="pageSize"
        :total="linkableTotal"
        @current-change="loadLinkable"
      />
      <p v-if="linkError" class="submit-error" role="alert">{{ linkError }}</p>
      <ElButton
        v-if="versionConflict"
        data-test="refresh-customer-version"
        @click="requestRefresh"
      >
        刷新客户版本
      </ElButton>
      <div class="form-actions">
        <ElButton data-test="cancel-link-holder" @click="closeLink"
          >取消</ElButton
        >
        <ElButton
          data-test="submit-link-holder"
          type="primary"
          :loading="saving"
          :disabled="saving || !selectedHolderId"
          @click="submitLink"
        >
          确认关联
        </ElButton>
      </div>
    </section>
  </section>
</template>
