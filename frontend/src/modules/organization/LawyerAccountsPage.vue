<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  bindLawyerProfile,
  createLawyerAccount,
  listLawyerAccounts,
  listUnboundLawyerProfiles,
  resetLawyerPassword,
  setLawyerAccountStatus,
  setLawyerBindingStatus,
  type LawyerAccount,
  type UnboundLawyerProfile,
} from '../../api/lawyer-accounts';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const accounts = ref<LawyerAccount[]>([]);
const profiles = ref<UnboundLawyerProfile[]>([]);
const loading = ref(false);
const profileSearchLoading = ref(false);
const saving = ref(false);
const error = ref('');
const profileSearchError = ref('');
const notice = ref('');
const fullName = ref('');
const username = ref('');
const password = ref('');
const lawFirm = ref('');
const phone = ref('');
const query = ref('');
const selectedProfileId = ref('');
const selectedAccountId = ref('');
const resetPasswords = ref<Record<string, string>>({});
const forbidden = ref(false);
const accountPage = ref(1);
const accountPageSize = 20;
const accountTotal = ref(0);
let accountRequest: AbortController | undefined;
let accountRevision = 0;
let profileRequest: AbortController | undefined;
let profileRevision = 0;
let mounted = false;
const identity = computed(() => {
  const session = auth.session;
  return session
    ? `${session.principalType}:${session.user.id}:${session.authorizationRevision}:${session.department?.id ?? ''}`
    : '';
});
const successfulProfileSearch = ref<{
  query: string;
  identity: string;
  accountId: string;
} | null>(null);
const canCreate = computed(
  () =>
    !!fullName.value.trim() &&
    !!username.value.trim() &&
    password.value.length >= 12,
);

function explain(errorValue: unknown): string {
  if (errorValue instanceof ApiError) {
    if (errorValue.code === 'USERNAME_ALREADY_EXISTS')
      return '该用户名已被使用，请选择其他用户名。';
    if (errorValue.code === 'LAWYER_PROFILE_BOUND')
      return '该历史档案已绑定其他律师账号，请核对后重试。';
    if (errorValue.code === 'VERSION_CONFLICT')
      return '账号信息已变化，请刷新后重试。';
    if (errorValue.status === 403 || errorValue.code === 'ACTION_FORBIDDEN')
      return '当前账号没有管理律师账号的权限。';
    return errorValue.message;
  }
  return '操作未完成，请检查连接后重试。';
}

async function refresh(): Promise<void> {
  accountRequest?.abort();
  const controller = new AbortController();
  accountRequest = controller;
  const currentRevision = ++accountRevision;
  const currentIdentity = identity.value;
  loading.value = true;
  error.value = '';
  forbidden.value = false;
  try {
    const page = await listLawyerAccounts(accountPage.value, accountPageSize, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      currentRevision !== accountRevision ||
      currentIdentity !== identity.value
    )
      return;
    accounts.value = page.items;
    accountTotal.value = page.total;
  } catch (reason) {
    if (
      controller.signal.aborted ||
      currentRevision !== accountRevision ||
      currentIdentity !== identity.value
    )
      return;
    accounts.value = [];
    accountTotal.value = 0;
    error.value = explain(reason);
    forbidden.value =
      reason instanceof ApiError &&
      (reason.status === 403 || reason.code === 'ACTION_FORBIDDEN');
  } finally {
    if (currentRevision === accountRevision) loading.value = false;
  }
}

async function searchProfiles(): Promise<void> {
  profileRequest?.abort();
  const controller = new AbortController();
  profileRequest = controller;
  const currentRevision = ++profileRevision;
  const currentQuery = query.value.trim();
  const currentIdentity = identity.value;
  const currentAccountId = selectedAccountId.value;
  selectedProfileId.value = '';
  successfulProfileSearch.value = null;
  profiles.value = [];
  profileSearchError.value = '';
  profileSearchLoading.value = true;
  try {
    const result = await listUnboundLawyerProfiles(currentQuery, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      currentRevision !== profileRevision ||
      currentQuery !== query.value.trim() ||
      currentIdentity !== identity.value ||
      currentAccountId !== selectedAccountId.value
    )
      return;
    profiles.value = result;
    successfulProfileSearch.value = {
      query: currentQuery,
      identity: currentIdentity,
      accountId: currentAccountId,
    };
  } catch (reason) {
    if (
      controller.signal.aborted ||
      currentRevision !== profileRevision ||
      currentQuery !== query.value.trim() ||
      currentIdentity !== identity.value ||
      currentAccountId !== selectedAccountId.value
    )
      return;
    profileSearchError.value = explain(reason);
  } finally {
    if (currentRevision === profileRevision) profileSearchLoading.value = false;
  }
}

function canBindProfile(): boolean {
  const currentSearch = successfulProfileSearch.value;
  return !!(
    currentSearch &&
    currentSearch.query === query.value.trim() &&
    currentSearch.identity === identity.value &&
    currentSearch.accountId === selectedAccountId.value &&
    !profileSearchLoading.value &&
    !profileSearchError.value &&
    selectedAccountId.value &&
    profiles.value.some(
      (profile) => profile.profileId === selectedProfileId.value,
    )
  );
}

async function create(): Promise<void> {
  if (!canCreate.value || saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await createLawyerAccount({
      fullName: fullName.value,
      username: username.value,
      password: password.value,
      lawFirm: lawFirm.value,
      phone: phone.value,
    });
    fullName.value = '';
    username.value = '';
    password.value = '';
    lawFirm.value = '';
    phone.value = '';
    notice.value = '律师账号已创建，并已绑定新建的承办档案。';
    await refresh();
  } catch (reason) {
    error.value = explain(reason);
  } finally {
    saving.value = false;
  }
}

async function bind(): Promise<void> {
  const account = accounts.value.find(
    (item) => item.id === selectedAccountId.value,
  );
  if (!account || !canBindProfile() || saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await bindLawyerProfile(account.id, {
      profileId: selectedProfileId.value,
      expectedAuthorizationRevision: account.authorizationRevision,
    });
    notice.value = '历史承办档案已绑定。已有案件历史不会改变。';
    selectedProfileId.value = '';
    await Promise.all([refresh(), searchProfiles()]);
  } catch (reason) {
    error.value = explain(reason);
  } finally {
    saving.value = false;
  }
}

async function toggleAccount(account: LawyerAccount): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    await setLawyerAccountStatus(
      account.id,
      !account.active,
      account.authorizationRevision,
    );
    notice.value = account.active
      ? '账号已停用；当前会话将失效，历史案件记录会保留。'
      : '账号已启用。';
    await refresh();
  } catch (reason) {
    error.value = explain(reason);
  } finally {
    saving.value = false;
  }
}

async function toggleBinding(
  account: LawyerAccount,
  bindingId: string,
  active: boolean,
  version: number,
): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    await setLawyerBindingStatus(account.id, bindingId, !active, version);
    notice.value = active
      ? '绑定已停用；该律师将不能继续办理该绑定范围内的案件，历史记录保留。'
      : '绑定已启用。';
    await refresh();
  } catch (reason) {
    error.value = explain(reason);
  } finally {
    saving.value = false;
  }
}

async function reset(account: LawyerAccount): Promise<void> {
  const newPassword = resetPasswords.value[account.id] ?? '';
  if (newPassword.length < 12 || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await resetLawyerPassword(
      account.id,
      newPassword,
      account.authorizationRevision,
    );
    resetPasswords.value[account.id] = '';
    notice.value = '密码已重置；旧会话将失效。系统不会显示或回读密码。';
    await refresh();
  } catch (reason) {
    error.value = explain(reason);
  } finally {
    saving.value = false;
  }
}

watch(accountPage, () => void refresh());
watch(selectedAccountId, (next, previous) => {
  if (!mounted || next === previous) return;
  void searchProfiles();
});
watch(identity, (next, previous) => {
  if (!mounted || next === previous) return;
  selectedProfileId.value = '';
  query.value = '';
  profiles.value = [];
  successfulProfileSearch.value = null;
  if (accountPage.value === 1) void refresh();
  else accountPage.value = 1;
  void searchProfiles();
});
onMounted(() => {
  mounted = true;
  void Promise.all([refresh(), searchProfiles()]);
});
onBeforeUnmount(() => {
  mounted = false;
  accountRevision += 1;
  profileRevision += 1;
  accountRequest?.abort();
  profileRequest?.abort();
});
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">系统设置</p>
          <h1>律师账号</h1>
          <p>管理正式登录账号和历史承办档案绑定。</p>
        </div>
        <ElButton text :loading="loading" @click="refresh">刷新</ElButton>
      </div>
      <p class="field-help">
        停用账号会撤销现有会话，但不会删除历史案件关联。停用单个档案绑定会阻止该绑定继续用于承办，历史记录仍保留。绑定历史档案只影响今后的承办权限，不会改写过去的案件记录。
      </p>
      <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <section v-if="!forbidden" class="demo-card demo-card--pad">
        <h2 class="form-section-title">创建律师账号</h2>
        <div class="demo-form-grid">
          <label
            >真实姓名 <span aria-hidden="true">*</span
            ><input v-model="fullName" class="text-input" required
          /></label>
          <label
            >用户名 <span aria-hidden="true">*</span
            ><input
              v-model="username"
              class="text-input"
              autocomplete="off"
              required
          /></label>
          <label
            >初始密码 <span aria-hidden="true">*</span
            ><input
              v-model="password"
              class="text-input"
              type="password"
              autocomplete="new-password"
              minlength="12"
              required
            /><small>至少 12 个字符。密码只提交一次，不会回读。</small></label
          >
          <label
            >律所（选填）<input v-model="lawFirm" class="text-input"
          /></label>
          <label
            >电话（选填）<input v-model="phone" class="text-input"
          /></label>
        </div>
        <ElButton
          type="primary"
          :loading="saving"
          :disabled="!canCreate || saving"
          @click="create"
          >创建并绑定新档案</ElButton
        >
      </section>
      <section v-if="!forbidden" class="demo-card demo-card--pad">
        <h2 class="form-section-title">绑定已有承办档案</h2>
        <p class="field-help">
          只显示本部门有历史承办记录且尚未绑定账号的档案。选择账号后，系统会保存正式绑定。
        </p>
        <div class="demo-form-grid">
          <label
            >搜索历史档案<input
              v-model="query"
              class="text-input"
              @input="searchProfiles"
          /></label>
          <label
            >承办档案<select v-model="selectedProfileId" class="text-input">
              <option value="">请选择档案</option>
              <option
                v-for="profile in profiles"
                :key="profile.profileId"
                :value="profile.profileId"
              >
                {{ profile.fullName }} · {{ profile.lawFirm ?? '律所未填写' }} ·
                {{ profile.phone ?? '电话未填写' }} ·
                {{ profile.caseBusinessNos.join('、') }} ·
                {{ profile.historicalAssignmentCount }} 条历史记录（{{
                  profile.profileId.slice(-6)
                }}）
              </option>
            </select></label
          >
          <label
            >律师账号<select v-model="selectedAccountId" class="text-input">
              <option value="">请选择账号</option>
              <option
                v-for="account in accounts"
                :key="account.id"
                :value="account.id"
              >
                {{ account.displayName }}（{{ account.username }}）
              </option>
            </select></label
          >
        </div>
        <p v-if="profileSearchLoading" class="field-help">正在搜索历史档案</p>
        <p v-if="profileSearchError" class="submit-error" role="alert">
          {{ profileSearchError }}
        </p>
        <p v-if="profiles.length === 0" class="field-help">
          {{ profileSearchError ? '' : '没有可绑定的历史档案。' }}
        </p>
        <ElButton
          :disabled="!canBindProfile() || saving"
          :loading="saving"
          @click="bind"
          >确认绑定</ElButton
        >
      </section>
      <section v-if="!forbidden" class="demo-card demo-card--pad">
        <h2 class="form-section-title">账号与档案</h2>
        <p v-if="loading">正在读取律师账号</p>
        <p v-else-if="accounts.length === 0" class="field-help">
          当前部门暂无律师账号。
        </p>
        <ul v-else class="notary-offices-list">
          <li v-for="account in accounts" :key="account.id">
            <strong>{{ account.displayName }}（{{ account.username }}）</strong
            ><span class="pill">{{ account.active ? '启用' : '停用' }}</span>
            <p v-if="account.profiles.length === 0" class="field-help">
              暂无有效承办档案绑定。
            </p>
            <div
              v-for="profile in account.profiles"
              :key="profile.bindingId"
              class="demo-form-grid"
            >
              <span
                >{{ profile.fullName }} ·
                {{ profile.lawFirm ?? '律所未填写' }} ·
                {{ profile.phone ?? '电话未填写' }}</span
              >
              <span class="pill">{{
                profile.bindingActive ? '绑定启用' : '绑定停用'
              }}</span>
              <ElButton
                text
                :disabled="saving"
                @click="
                  toggleBinding(
                    account,
                    profile.bindingId,
                    profile.bindingActive,
                    profile.bindingVersion,
                  )
                "
                >{{ profile.bindingActive ? '停用绑定' : '启用绑定' }}</ElButton
              >
            </div>
            <div class="demo-form-grid">
              <ElButton
                text
                :disabled="saving"
                @click="toggleAccount(account)"
                >{{ account.active ? '停用账号' : '启用账号' }}</ElButton
              >
              <input
                v-model="resetPasswords[account.id]"
                class="text-input"
                type="password"
                autocomplete="new-password"
                minlength="12"
                placeholder="输入新密码（至少 12 位）"
              />
              <ElButton
                text
                :disabled="
                  saving || (resetPasswords[account.id]?.length ?? 0) < 12
                "
                @click="reset(account)"
                >重置密码</ElButton
              >
            </div>
          </li>
        </ul>
        <div v-if="accountTotal > accountPageSize" class="page-head">
          <ElButton
            text
            :disabled="loading || accountPage <= 1"
            @click="accountPage -= 1"
            >上一页</ElButton
          >
          <span
            >第 {{ accountPage }} /
            {{ Math.ceil(accountTotal / accountPageSize) }} 页</span
          >
          <ElButton
            text
            :disabled="
              loading ||
              accountPage >= Math.ceil(accountTotal / accountPageSize)
            "
            @click="accountPage += 1"
            >下一页</ElButton
          >
        </div>
      </section>
    </main>
  </div>
</template>
