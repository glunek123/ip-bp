<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createLawyerProfile,
  listLawyerProfiles,
  openLawyerAccountForProfile,
  setLawyerProfileStatus,
  updateLawyerProfile,
  type LawyerProfile,
  type LawyerProfileInput,
} from '../../api/lawyer-profiles';

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const forbidden = ref(false);

const items = ref<LawyerProfile[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const query = ref('');
const accountFilter = ref<'ALL' | 'WITH_ACCOUNT' | 'WITHOUT_ACCOUNT'>('ALL');
const statusFilter = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

type FormState = {
  id: string | null;
  version: number;
  fullName: string;
  lawFirm: string;
  phone: string;
  email: string;
  barNumber: string;
  lawFirmCreditCode: string;
  region: string;
  address: string;
};
const blankForm = (): FormState => ({
  id: null,
  version: 1,
  fullName: '',
  lawFirm: '',
  phone: '',
  email: '',
  barNumber: '',
  lawFirmCreditCode: '',
  region: '',
  address: '',
});
const form = ref<FormState | null>(null);
const accountTarget = ref<LawyerProfile | null>(null);
const accountForm = ref({ username: '', password: '' });

const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);
const isEditing = computed(() => form.value !== null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await listLawyerProfiles({
      page: page.value,
      pageSize,
      q: query.value,
      account: accountFilter.value,
      status: statusFilter.value,
    });
    items.value = result.items;
    total.value = result.total;
    forbidden.value = false;
  } catch (reason) {
    items.value = [];
    total.value = 0;
    if (reason instanceof ApiError && reason.status === 403) {
      forbidden.value = true;
      error.value = '当前账号没有查看律师库的权限。';
    } else {
      error.value =
        reason instanceof ApiError ? reason.message : '律师库暂时无法读取。';
    }
  } finally {
    loading.value = false;
  }
}

function startCreate(): void {
  error.value = '';
  notice.value = '';
  form.value = blankForm();
}

function startEdit(profile: LawyerProfile): void {
  error.value = '';
  notice.value = '';
  form.value = {
    id: profile.id,
    version: profile.version,
    fullName: profile.fullName,
    lawFirm: profile.lawFirm ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    barNumber: profile.barNumber ?? '',
    lawFirmCreditCode: profile.lawFirmCreditCode ?? '',
    region: profile.region ?? '',
    address: profile.address ?? '',
  };
}

function cancelForm(): void {
  form.value = null;
}

function payload(current: FormState): LawyerProfileInput {
  const text = (value: string) => value.trim();
  return {
    fullName: text(current.fullName),
    lawFirm: text(current.lawFirm) || null,
    phone: text(current.phone) || null,
    email: text(current.email) || null,
    barNumber: text(current.barNumber) || null,
    lawFirmCreditCode: text(current.lawFirmCreditCode) || null,
    region: text(current.region) || null,
    address: text(current.address) || null,
  };
}

async function submit(): Promise<void> {
  const current = form.value;
  if (!current || saving.value) return;
  if (!current.fullName.trim()) {
    error.value = '请填写律师姓名。';
    return;
  }
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (current.id) {
      await updateLawyerProfile(current.id, {
        ...payload(current),
        expectedVersion: current.version,
      });
      notice.value = '律师档案已更新。';
    } else {
      await createLawyerProfile(payload(current));
      notice.value = '律师档案已创建。';
    }
    form.value = null;
    await load();
  } catch (reason) {
    error.value =
      reason instanceof ApiError ? reason.message : '保存失败，请重试。';
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(profile: LawyerProfile): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await setLawyerProfileStatus(
      profile.id,
      profile.status !== 'ACTIVE',
      profile.version,
    );
    notice.value =
      profile.status === 'ACTIVE'
        ? '档案已停用，指派候选不再包含该律师。'
        : '档案已启用。';
    await load();
  } catch (reason) {
    error.value =
      reason instanceof ApiError ? reason.message : '操作失败，请重试。';
  } finally {
    saving.value = false;
  }
}

function startAccount(profile: LawyerProfile): void {
  error.value = '';
  notice.value = '';
  accountTarget.value = profile;
  accountForm.value = { username: '', password: '' };
}

async function submitAccount(): Promise<void> {
  const target = accountTarget.value;
  if (!target || saving.value) return;
  if (
    !accountForm.value.username.trim() ||
    accountForm.value.password.length < 12
  ) {
    error.value = '用户名不能为空，密码至少 12 位。';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await openLawyerAccountForProfile(target.id, {
      username: accountForm.value.username.trim(),
      password: accountForm.value.password,
    });
    notice.value = '账号已开通，律师可使用该账号登录。';
    accountTarget.value = null;
    await load();
  } catch (reason) {
    error.value =
      reason instanceof ApiError ? reason.message : '开通账号失败，请重试。';
  } finally {
    saving.value = false;
  }
}

function search(): void {
  page.value = 1;
  void load();
}

function turn(delta: number): void {
  const next = page.value + delta;
  if (next < 1 || next > pageCount.value) return;
  page.value = next;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <div class="page-view">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">系统设置</p>
          <p>维护律师档案；有无登录账号都可以承办案件。</p>
        </div>
        <ElButton text :loading="loading" @click="load">刷新</ElButton>
      </div>

      <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>

      <section v-if="!forbidden" class="demo-card demo-card--pad">
        <div class="library-filters">
          <label
            >搜索
            <input
              v-model="query"
              class="text-input"
              data-test="lawyer-profile-query"
              placeholder="姓名／律所／电话／邮箱／执业证号"
              @keyup.enter="search"
            />
          </label>
          <label
            >账号状态
            <select
              v-model="accountFilter"
              class="text-input"
              data-test="lawyer-profile-account-filter"
              @change="search"
            >
              <option value="ALL">全部</option>
              <option value="WITH_ACCOUNT">已开通账号</option>
              <option value="WITHOUT_ACCOUNT">未开通账号</option>
            </select>
          </label>
          <label
            >档案状态
            <select
              v-model="statusFilter"
              class="text-input"
              data-test="lawyer-profile-status-filter"
              @change="search"
            >
              <option value="ALL">全部</option>
              <option value="ACTIVE">启用</option>
              <option value="INACTIVE">停用</option>
            </select>
          </label>
          <ElButton data-test="lawyer-profile-search" @click="search"
            >查询</ElButton
          >
          <ElButton
            type="primary"
            data-test="lawyer-profile-create"
            :disabled="saving"
            @click="startCreate"
            >新建律师</ElButton
          >
        </div>

        <form
          v-if="isEditing && form"
          class="library-form"
          data-test="lawyer-profile-form"
          @submit.prevent="submit"
        >
          <h2 class="form-section-title">
            {{ form.id ? '编辑律师档案' : '新建律师档案' }}
          </h2>
          <div class="demo-form-grid">
            <label
              >律师姓名 <span aria-hidden="true">*</span
              ><input
                v-model="form.fullName"
                class="text-input"
                data-test="lawyer-profile-name"
                required
            /></label>
            <label
              >律所名称<input
                v-model="form.lawFirm"
                class="text-input"
                data-test="lawyer-profile-firm"
            /></label>
            <label
              >律师电话<input
                v-model="form.phone"
                class="text-input"
                data-test="lawyer-profile-phone"
            /></label>
            <label
              >律师邮箱<input
                v-model="form.email"
                class="text-input"
                type="email"
                data-test="lawyer-profile-email"
            /></label>
            <label
              >执业证号<input
                v-model="form.barNumber"
                class="text-input"
                data-test="lawyer-profile-bar"
            /></label>
            <label
              >律所信用代码<input
                v-model="form.lawFirmCreditCode"
                class="text-input"
                data-test="lawyer-profile-credit"
            /></label>
            <label
              >省市区<input
                v-model="form.region"
                class="text-input"
                data-test="lawyer-profile-region"
                placeholder="如：浙江省杭州市"
            /></label>
            <label
              >地址<input
                v-model="form.address"
                class="text-input"
                data-test="lawyer-profile-address"
            /></label>
          </div>
          <div class="library-form__actions">
            <ElButton :disabled="saving" @click="cancelForm">取消</ElButton>
            <ElButton
              type="primary"
              native-type="submit"
              data-test="lawyer-profile-save"
              :loading="saving"
              >保存</ElButton
            >
          </div>
        </form>

        <form
          v-if="accountTarget"
          class="library-form"
          data-test="lawyer-account-form"
          @submit.prevent="submitAccount"
        >
          <h2 class="form-section-title">
            为 {{ accountTarget.fullName }} 开通登录账号
          </h2>
          <p class="field-help">
            开通后律师可登录办理本人承办案件；不改变其档案与承办关系。
          </p>
          <div class="demo-form-grid">
            <label
              >用户名 <span aria-hidden="true">*</span
              ><input
                v-model="accountForm.username"
                class="text-input"
                autocomplete="off"
                data-test="lawyer-account-username"
            /></label>
            <label
              >初始密码 <span aria-hidden="true">*</span
              ><input
                v-model="accountForm.password"
                class="text-input"
                type="password"
                autocomplete="new-password"
                minlength="12"
                data-test="lawyer-account-password"
            /></label>
          </div>
          <div class="library-form__actions">
            <ElButton :disabled="saving" @click="accountTarget = null"
              >取消</ElButton
            >
            <ElButton
              type="primary"
              native-type="submit"
              data-test="lawyer-account-save"
              :loading="saving"
              >开通账号</ElButton
            >
          </div>
        </form>

        <p v-if="loading">正在读取律师库</p>
        <p v-else-if="items.length === 0" class="field-help">
          当前筛选条件下没有律师档案。
        </p>
        <table v-else class="library-table" data-test="lawyer-profile-table">
          <thead>
            <tr>
              <th>律师姓名/律所</th>
              <th>电话</th>
              <th>邮箱</th>
              <th>执业证号</th>
              <th>律所信用代码</th>
              <th>省市区</th>
              <th>账号</th>
              <th>承办案件</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="profile in items" :key="profile.id">
              <td>
                <strong>{{ profile.fullName }}</strong>
                <span class="field-help">{{
                  profile.lawFirm ?? '律所未填写'
                }}</span>
              </td>
              <td>{{ profile.phone ?? '—' }}</td>
              <td>{{ profile.email ?? '—' }}</td>
              <td>{{ profile.barNumber ?? '—' }}</td>
              <td>{{ profile.lawFirmCreditCode ?? '—' }}</td>
              <td>{{ profile.region ?? '—' }}</td>
              <td>
                <span
                  class="pill"
                  :class="{ 'pill--muted': !profile.hasAccount }"
                  >{{
                    profile.hasAccount
                      ? `已开通${profile.account?.username ? `·${profile.account.username}` : ''}`
                      : profile.account
                        ? '账号已停用'
                        : '未开通账号'
                  }}</span
                >
              </td>
              <td>{{ profile.assignmentCount }}</td>
              <td class="library-table__actions">
                <ElButton
                  text
                  :disabled="saving"
                  :data-test="`lawyer-profile-edit-${profile.id}`"
                  @click="startEdit(profile)"
                  >编辑</ElButton
                >
                <ElButton
                  text
                  :disabled="saving"
                  :data-test="`lawyer-profile-toggle-${profile.id}`"
                  @click="toggleStatus(profile)"
                  >{{ profile.status === 'ACTIVE' ? '停用' : '启用' }}</ElButton
                >
                <ElButton
                  v-if="!profile.account"
                  text
                  :disabled="saving || profile.status !== 'ACTIVE'"
                  :data-test="`lawyer-profile-open-account-${profile.id}`"
                  @click="startAccount(profile)"
                  >开通账号</ElButton
                >
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="pageCount > 1" class="page-head">
          <ElButton text :disabled="loading || page <= 1" @click="turn(-1)"
            >上一页</ElButton
          >
          <span>第 {{ page }} / {{ pageCount }} 页（共 {{ total }} 人）</span>
          <ElButton
            text
            :disabled="loading || page >= pageCount"
            @click="turn(1)"
            >下一页</ElButton
          >
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.library-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}
.library-filters label {
  display: grid;
  gap: 4px;
  font-size: 12px;
}
.library-form {
  margin: 12px 0 16px;
  padding: 12px;
  border: 1px solid var(--border-subtle, #ebeef5);
  border-radius: 8px;
}
.library-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.library-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.library-table th {
  text-align: left;
  font-weight: 500;
  font-size: 12px;
  color: var(--text-muted, #909399);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-subtle, #ebeef5);
  white-space: nowrap;
}
.library-table td {
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle, #f2f3f5);
  vertical-align: top;
}
.library-table td strong {
  display: block;
  font-weight: 500;
}
.library-table__actions {
  white-space: nowrap;
  text-align: right;
}
.pill--muted {
  color: var(--text-muted, #909399);
}
</style>
