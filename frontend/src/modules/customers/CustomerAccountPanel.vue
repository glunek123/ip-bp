<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createClientAccount,
  listClientAccounts,
  setClientAccountStatus,
  type ClientAccount,
} from '../../api/client-accounts';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';

const props = defineProps<{ customerId: string; admitted: boolean }>();
const accounts = ref<ClientAccount[]>([]);
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
  if (!props.admitted) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    accounts.value = await listClientAccounts(props.customerId);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiError ? error.message : '客户账号暂时无法加载';
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await createClientAccount(props.customerId, {
      displayName: displayName.value.trim(),
      username: username.value.trim(),
      password: password.value,
    });
    displayName.value = '';
    username.value = '';
    password.value = '';
    successMessage.value = '账号已创建并绑定';
    await load();
  } catch (error) {
    errorMessage.value =
      error instanceof ApiError ? error.message : '客户账号创建失败';
  } finally {
    submitting.value = false;
  }
}

async function toggle(account: ClientAccount): Promise<void> {
  if (changingId.value) return;
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
      props.customerId,
      account.id,
      !account.bindingActive,
    );
    accounts.value = accounts.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    successMessage.value = updated.bindingActive
      ? '客户账号已启用'
      : '客户账号已停用';
  } catch (error) {
    errorMessage.value =
      error instanceof ApiError ? error.message : '客户账号状态更新失败';
  } finally {
    changingId.value = '';
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="ledger-panel detail-card" data-test="client-account-panel">
    <div class="panel-heading">
      <div>
        <p class="section-kicker">企业登录账号</p>
        <h2>客户账号</h2>
      </div>
      <ElButton v-if="admitted" text :loading="loading" @click="load"
        >刷新</ElButton
      >
    </div>
    <p v-if="!admitted">客户准入后才可创建客户账号。</p>
    <template v-else>
      <p v-if="accounts.length === 0 && !loading">尚未绑定客户账号。</p>
      <ul v-else class="compact-list">
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
      <div class="inline-form-grid">
        <label>
          <span>客户侧使用人姓名<RequiredFieldMark /></span>
          <input
            v-model="displayName"
            name="clientDisplayName"
            class="text-input"
          />
        </label>
        <label>
          <span>用户名<RequiredFieldMark /></span>
          <input v-model="username" name="clientUsername" class="text-input" />
        </label>
        <label>
          <span>初始密码<RequiredFieldMark /></span>
          <input
            v-model="password"
            name="clientPassword"
            class="text-input"
            type="password"
            autocomplete="new-password"
          />
        </label>
        <p class="field-guidance inline-form-grid__guidance">
          用户名至少 3 个字符；初始密码至少 12
          个字符。创建后，该账号将绑定当前客户企业，只能查看本企业已推送线索。
        </p>
        <p
          v-if="missingRequirements.length"
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
