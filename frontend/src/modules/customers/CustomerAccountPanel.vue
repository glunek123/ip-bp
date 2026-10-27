<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createClientAccount,
  getClientAccountCapabilities,
  listClientAccounts,
  setClientAccountStatus,
  type ClientAccount,
  type ClientAccountCapabilities,
} from '../../api/client-accounts';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';

const props = defineProps<{ customerId: string; admitted: boolean }>();
const accounts = ref<ClientAccount[]>([]);
const capabilities = ref<ClientAccountCapabilities | null>(null);
const createdAccount = ref<ClientAccount | null>(null);
let requestVersion = 0;
const loading = ref(false);
const submitting = ref(false);
const changingId = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const displayName = ref('');
const username = ref('');
const password = ref('');
const canSubmit = computed(
  () =>
    props.admitted &&
    capabilities.value?.canCreate === true &&
    displayName.value.trim().length > 0 &&
    username.value.trim().length >= 3 &&
    password.value.length >= 12 &&
    !submitting.value,
);
const missingRequirements = computed(() => {
  const missing: string[] = [];
  if (!displayName.value.trim()) missing.push('填写客户侧使用人姓名');
  if (username.value.trim().length < 3)
    missing.push('填写至少 3 个字符的用户名');
  if (password.value.length < 12) missing.push('填写至少 12 个字符的初始密码');
  return missing;
});

async function load(): Promise<void> {
  const version = ++requestVersion;
  accounts.value = [];
  capabilities.value = null;
  createdAccount.value = null;
  if (!props.admitted) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    const access = await getClientAccountCapabilities(props.customerId);
    if (version !== requestVersion) return;
    capabilities.value = access;
    if (access.canManage) {
      const result = await listClientAccounts(props.customerId);
      if (version !== requestVersion) return;
      accounts.value = result;
    }
  } catch (error) {
    if (version !== requestVersion) return;
    accounts.value = [];
    capabilities.value = null;
    errorMessage.value =
      error instanceof ApiError ? error.message : '客户账号暂时无法加载';
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

async function create(): Promise<void> {
  if (!canSubmit.value) return;
  const version = requestVersion;
  const customerId = props.customerId;
  submitting.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const created = await createClientAccount(customerId, {
      displayName: displayName.value.trim(),
      username: username.value.trim(),
      password: password.value,
    });
    if (version !== requestVersion) return;
    displayName.value = '';
    username.value = '';
    password.value = '';
    successMessage.value = '账号已创建并绑定';
    if (capabilities.value?.canManage) {
      await load();
    } else {
      createdAccount.value = created;
    }
  } catch (error) {
    if (version !== requestVersion) return;
    errorMessage.value =
      error instanceof ApiError ? error.message : '客户账号创建失败';
    if (error instanceof ApiError && error.status === 403) await load();
  } finally {
    password.value = '';
    submitting.value = false;
  }
}

async function toggle(account: ClientAccount): Promise<void> {
  if (changingId.value) return;
  const version = requestVersion;
  const customerId = props.customerId;
  if (
    account.bindingActive &&
    !globalThis.window.confirm(
      `确认停用“${account.displayName}”吗？该账号现有登录会立即失效，下一次请求将不能访问本企业线索。`,
    )
  )
    return;
  changingId.value = account.id;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const updated = await setClientAccountStatus(
      customerId,
      account.id,
      !account.bindingActive,
    );
    if (version !== requestVersion) return;
    accounts.value = accounts.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    successMessage.value = updated.bindingActive
      ? '客户账号已启用'
      : '客户账号已停用';
  } catch (error) {
    if (version !== requestVersion) return;
    if (error instanceof ApiError && error.status === 403) await load();
    errorMessage.value =
      error instanceof ApiError ? error.message : '客户账号状态更新失败';
  } finally {
    changingId.value = '';
  }
}

watch(
  () => [props.customerId, props.admitted] as const,
  () => {
    displayName.value = '';
    username.value = '';
    password.value = '';
    successMessage.value = '';
    errorMessage.value = '';
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ledger-panel detail-card" data-test="client-account-panel">
    <div class="panel-heading">
      <div>
        <h2>客户账号</h2>
      </div>
      <ElButton v-if="admitted" text :loading="loading" @click="load"
        >刷新</ElButton
      >
    </div>
    <p v-if="!admitted">客户准入后才可创建客户账号。</p>
    <template v-else>
      <p v-if="createdAccount && !capabilities?.canManage">
        已创建：{{ createdAccount.displayName }}（{{
          createdAccount.username
        }}）
      </p>
      <p v-if="capabilities?.canManage && accounts.length === 0 && !loading">
        尚未绑定客户账号。
      </p>
      <ul
        v-if="capabilities?.canManage && accounts.length"
        class="compact-list"
      >
        <li v-for="account in accounts" :key="account.id">
          <span>
            <strong>{{ account.displayName }}</strong>
            <small class="mono">{{ account.username }}</small>
          </span>
          <ElButton
            text
            :data-test="`toggle-client-${account.id}`"
            :loading="changingId === account.id"
            :disabled="Boolean(changingId)"
            @click="toggle(account)"
          >
            {{ account.bindingActive ? '停用' : '启用' }}
          </ElButton>
        </li>
      </ul>
      <div v-if="capabilities?.canCreate" class="inline-form-grid">
        <label>
          <span>客户侧使用人姓名<RequiredFieldMark /></span>
          <input
            v-model="displayName"
            name="clientDisplayName"
            class="text-input"
            :aria-describedby="
              missingRequirements.length
                ? 'client-account-guidance client-account-missing'
                : 'client-account-guidance'
            "
          />
        </label>
        <label>
          <span>用户名<RequiredFieldMark /></span>
          <input
            v-model="username"
            name="clientUsername"
            class="text-input"
            :aria-describedby="
              missingRequirements.length
                ? 'client-account-guidance client-account-missing'
                : 'client-account-guidance'
            "
          />
        </label>
        <label>
          <span>初始密码<RequiredFieldMark /></span>
          <input
            v-model="password"
            name="clientPassword"
            class="text-input"
            type="password"
            autocomplete="new-password"
            :aria-describedby="
              missingRequirements.length
                ? 'client-account-guidance client-account-missing'
                : 'client-account-guidance'
            "
          />
        </label>
        <p
          id="client-account-guidance"
          class="field-guidance inline-form-grid__guidance"
        >
          用户名至少 3 个字符；初始密码至少 12
          个字符。创建后，该账号将绑定当前客户企业，只能查看本企业已推送线索。
        </p>
        <p
          v-if="missingRequirements.length"
          id="client-account-missing"
          class="field-guidance inline-form-grid__guidance"
          role="status"
        >
          创建前还需：{{ missingRequirements.join('、') }}
        </p>
        <ElButton
          type="primary"
          data-test="create-client-account"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="create"
        >
          创建并绑定
        </ElButton>
      </div>
    </template>
    <p v-if="successMessage" class="success-message" role="status">
      {{ successMessage }}
    </p>
    <p v-if="errorMessage" class="submit-error" role="alert">
      {{ errorMessage }}
    </p>
  </section>
</template>

<style scoped>
.inline-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: var(--s-3) var(--s-4);
}
.inline-form-grid > label {
  display: grid;
  gap: var(--s-1);
  min-width: 0;
}
.inline-form-grid > label > span {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}
.inline-form-grid > label > input {
  width: 100%;
  min-width: 0;
}
.inline-form-grid > :deep(.el-button) {
  grid-column: 1 / -1;
  justify-self: start;
}
@media (max-width: 900px) {
  .inline-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .inline-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
