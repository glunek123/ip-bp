<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import {
  createNotaryOffice,
  listNotaryOffices,
  type NotaryOffice,
} from '../../api/notary';
import {
  createNotaryOfficeAccount,
  listNotaryOfficeAccounts,
  setNotaryOfficeAccountActive,
  type NotaryOfficeAccount,
} from '../../api/notary-office-accounts';

const state = ref<'loading' | 'ready' | 'forbidden' | 'failed'>('loading');
const offices = ref<NotaryOffice[]>([]);
const canCreate = ref(false);
const officeName = ref('');
const creating = ref(false);
const createError = ref('');
const createSuccess = ref('');
let request: AbortController | undefined;
const selectedOfficeId = ref<string | null>(null);
const officeAccounts = ref<NotaryOfficeAccount[]>([]);
const accountLoading = ref(false);
const canManageAccounts = ref(false);
const accountError = ref('');
const accountSuccess = ref('');
const accountName = ref('');
const accountUsername = ref('');
const accountPassword = ref('');
const creatingAccount = ref(false);
const changingAccountId = ref<string | null>(null);

async function toggleAccounts(office: NotaryOffice): Promise<void> {
  if (selectedOfficeId.value === office.id) {
    selectedOfficeId.value = null;
    return;
  }
  selectedOfficeId.value = office.id;
  accountLoading.value = true;
  accountError.value = '';
  accountSuccess.value = '';
  try {
    officeAccounts.value = await listNotaryOfficeAccounts(office.id);
    canManageAccounts.value = true;
  } catch (error) {
    canManageAccounts.value = false;
    accountError.value =
      error instanceof ApiError && error.status === 403
        ? '当前账号没有维护该公证处账号的权限'
        : '账号列表暂时无法加载，请重试';
  } finally {
    accountLoading.value = false;
  }
}

async function addAccount(officeId: string): Promise<void> {
  if (creatingAccount.value || accountPassword.value.length < 12) return;
  creatingAccount.value = true;
  accountError.value = '';
  accountSuccess.value = '';
  try {
    const account = await createNotaryOfficeAccount(officeId, {
      displayName: accountName.value,
      username: accountUsername.value,
      password: accountPassword.value,
    });
    officeAccounts.value = [...officeAccounts.value, account];
    accountName.value = '';
    accountUsername.value = '';
    accountPassword.value = '';
    accountSuccess.value = '公证处账号已创建';
  } catch (error) {
    accountError.value =
      error instanceof ApiError && error.status === 403
        ? '当前账号没有创建公证处账号的权限'
        : '创建账号失败，请核对信息后重试';
  } finally {
    creatingAccount.value = false;
  }
}

async function toggleAccount(account: NotaryOfficeAccount): Promise<void> {
  if (!selectedOfficeId.value || changingAccountId.value) return;
  changingAccountId.value = account.id;
  accountError.value = '';
  try {
    const updated = await setNotaryOfficeAccountActive(
      selectedOfficeId.value,
      account.id,
      !account.accountActive,
    );
    officeAccounts.value = officeAccounts.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    accountSuccess.value = updated.accountActive ? '账号已启用' : '账号已停用';
  } catch {
    accountError.value = '账号状态更新失败，请刷新列表确认';
  } finally {
    changingAccountId.value = null;
  }
}

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const result = await listNotaryOffices({ signal: controller.signal });
    if (controller.signal.aborted) return;
    offices.value = result.items;
    canCreate.value = result.capabilities.create;
    state.value = 'ready';
    createError.value = '';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError &&
      (error.status === 403 || error.code === 'ACTION_FORBIDDEN')
        ? 'forbidden'
        : 'failed';
  }
}

function creationError(error: unknown): string {
  if (!(error instanceof ApiError))
    return '新增结果暂时未知，请刷新公证处列表确认后再操作';
  if (error.code === 'OFFICE_EXISTS')
    return '该公证处已存在，请检查名称或联系管理员';
  if (error.code === 'ACTION_FORBIDDEN' || error.status === 403)
    return '当前账号没有维护公证处的权限，请联系部门管理员';
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')
    return '新增结果暂时未知，请刷新列表确认后再操作';
  return '新增公证处失败，请检查名称后重试';
}

async function addOffice(): Promise<void> {
  const name = officeName.value.trim();
  if (!canCreate.value || creating.value || !name) return;
  creating.value = true;
  createError.value = '';
  createSuccess.value = '';
  try {
    const office = await createNotaryOffice(name);
    offices.value = [...offices.value, office].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    );
    officeName.value = '';
    createSuccess.value = '公证处已新增，可在移交线索时选择';
  } catch (error) {
    createError.value = creationError(error);
  } finally {
    creating.value = false;
  }
}

onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取公证处</h1>
      </section>
      <section
        v-else-if="state === 'forbidden'"
        class="state-panel ledger-panel"
      >
        <h1>当前账号无权查看公证处</h1>
        <p>如需维护或查看，请联系部门管理员分配相应权限。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>公证处列表暂时无法加载</h1>
        <ElButton
          data-test="refresh-notary-offices"
          type="primary"
          @click="load"
          >重新加载</ElButton
        >
      </section>
      <template v-else>
        <div class="page-head">
          <div>
            <p class="eyebrow">部门业务设置</p>
            <h1>公证处</h1>
            <p>维护本部门可选公证处，后续移交线索时可从本部门公证处中选择。</p>
          </div>
          <ElButton
            data-test="refresh-notary-offices"
            text
            :loading="creating"
            @click="load"
            >刷新</ElButton
          >
        </div>
        <p v-if="createSuccess" class="submit-success" role="status">
          {{ createSuccess }}
        </p>
        <p v-if="createError" class="submit-error" role="alert">
          {{ createError }}
        </p>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-offices-list"
        >
          <h2 class="form-section-title">可用公证处</h2>
          <p v-if="offices.length === 0" class="field-help">
            当前部门还没有可用公证处。{{
              canCreate
                ? '新增一项后即可在移交时选择。'
                : '如需新增公证处，请联系部门管理员。'
            }}
          </p>
          <ul v-else class="notary-offices-list">
            <li v-for="office in offices" :key="office.id">
              <span>{{ office.name }}</span>
              <span class="pill">可用</span>
              <ElButton
                text
                :data-test="`office-accounts-${office.id}`"
                @click="toggleAccounts(office)"
                >账号管理</ElButton
              >
            </li>
          </ul>
        </section>
        <section
          v-if="selectedOfficeId"
          class="demo-card demo-card--pad"
          data-test="notary-office-accounts"
        >
          <h2 class="form-section-title">公证处账号</h2>
          <p>账号固定绑定此公证处；停用后该账号的后续请求将失效。</p>
          <p v-if="accountLoading">正在读取账号</p>
          <p v-if="accountError" class="submit-error" role="alert">
            {{ accountError }}
          </p>
          <p v-if="accountSuccess" class="submit-success" role="status">
            {{ accountSuccess }}
          </p>
          <ul v-if="!accountLoading && officeAccounts.length">
            <li
              v-for="account in officeAccounts"
              :key="account.id"
              data-test="notary-account-row"
            >
              {{ account.displayName }}（{{ account.username }}）
              <span>{{
                account.accountActive && account.bindingActive ? '启用' : '停用'
              }}</span>
              <ElButton
                text
                :loading="changingAccountId === account.id"
                :disabled="changingAccountId !== null"
                @click="toggleAccount(account)"
                >{{ account.accountActive ? '停用' : '启用' }}</ElButton
              >
            </li>
          </ul>
          <p v-else-if="!accountLoading && !accountError">暂无账号</p>
          <form
            v-if="canManageAccounts"
            data-test="notary-office-account-create"
            @submit.prevent="addAccount(selectedOfficeId!)"
          >
            <label class="field-label" for="notary-account-name"
              >姓名<RequiredFieldMark
            /></label>
            <input
              id="notary-account-name"
              v-model="accountName"
              data-test="notary-account-display-name"
              class="text-input"
              required
              maxlength="100"
            />
            <label
              class="field-label field-label--spaced"
              for="notary-account-username"
              >用户名<RequiredFieldMark
            /></label>
            <input
              id="notary-account-username"
              v-model="accountUsername"
              data-test="notary-account-username"
              class="text-input"
              required
              minlength="3"
              maxlength="64"
            />
            <label
              class="field-label field-label--spaced"
              for="notary-account-password"
              >初始密码<RequiredFieldMark
            /></label>
            <input
              id="notary-account-password"
              v-model="accountPassword"
              data-test="notary-account-password"
              class="text-input"
              type="password"
              autocomplete="new-password"
              required
              minlength="12"
              maxlength="128"
            />
            <p class="field-help">
              密码仅在创建请求中提交，不会在列表中显示。创建后请由管理员通过安全渠道告知账号使用者。
            </p>
            <ElButton
              type="primary"
              native-type="submit"
              data-test="create-notary-account"
              :loading="creatingAccount"
              :disabled="
                creatingAccount ||
                !accountName.trim() ||
                !accountUsername.trim() ||
                accountPassword.length < 12
              "
              >创建账号</ElButton
            >
          </form>
        </section>
        <section
          v-if="canCreate"
          class="demo-card demo-card--pad"
          data-test="notary-office-create-form"
        >
          <h2 class="form-section-title">新增公证处</h2>
          <p>名称将加入本部门可选列表，之后可以用于线索移交。</p>
          <label
            class="field-label field-label--spaced"
            for="new-notary-office-name"
          >
            公证处名称<RequiredFieldMark />
          </label>
          <div class="notary-office-create__row">
            <input
              id="new-notary-office-name"
              v-model="officeName"
              class="text-input"
              data-test="new-notary-office-name"
              maxlength="200"
              aria-required="true"
              placeholder="填写公证处名称"
              :disabled="creating"
            />
            <ElButton
              type="primary"
              data-test="create-notary-office"
              :loading="creating"
              :disabled="!officeName.trim() || creating"
              @click="addOffice"
              >新增</ElButton
            >
          </div>
          <p class="field-help">
            仅新增当前部门的公证处名称；不影响已创建的取证批次。
          </p>
        </section>
        <p v-else class="field-help">如需新增公证处，请联系部门管理员。</p>
      </template>
    </main>
  </div>
</template>
