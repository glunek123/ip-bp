<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  assignOrganizationRole,
  createOrganizationTeam,
  createOrganizationUser,
  getOrganizationManagementContext,
  resetOrganizationUserPassword,
  setOrganizationRoleAssignmentStatus,
  setOrganizationTeamStatus,
  setOrganizationUserStatus,
  updateOrganizationMembership,
  type OrganizationManagementContext,
  type OrganizationUser,
} from '../../api/organization';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const context = ref<OrganizationManagementContext | null>(null);
const actionError = ref('');
const pending = ref('');
const showCreateUser = ref(false);
const resetTarget = ref<OrganizationUser | null>(null);
const newPassword = ref('');
const newTeamName = ref('');
const selectedRoles = reactive<Record<string, string>>({});
const createForm = reactive({
  displayName: '',
  username: '',
  password: '',
  teamId: '',
  roleTemplateId: '',
});
let activeRequest: AbortController | undefined;

const activeTeams = computed(
  () => context.value?.teams.filter((team) => team.status === 'ACTIVE') ?? [],
);

function isSelf(user: OrganizationUser): boolean {
  return auth.session?.user.id === user.id;
}

function errorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.code === 'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS'
  ) {
    return '先停用该人员当前的团队范围角色，再调整团队。';
  }
  return error instanceof ApiError
    ? error.message
    : '操作没有完成，请检查连接后重试。';
}

async function load(showLoading = true): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  if (showLoading) state.value = 'loading';
  try {
    const result = await getOrganizationManagementContext({
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    context.value = result;
    for (const user of result.users) {
      selectedRoles[user.id] ??= result.roles[0]?.id ?? '';
    }
    createForm.roleTemplateId ||= result.roles[0]?.id ?? '';
    state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'failed';
  }
}

async function run(key: string, action: () => Promise<void>): Promise<boolean> {
  if (pending.value) return false;
  pending.value = key;
  actionError.value = '';
  try {
    await action();
    await load(false);
    return true;
  } catch (error) {
    actionError.value = errorMessage(error);
    return false;
  } finally {
    pending.value = '';
  }
}

async function submitCreateUser(): Promise<void> {
  if (
    !createForm.displayName.trim() ||
    !createForm.username.trim() ||
    createForm.password.length < 12 ||
    !createForm.roleTemplateId
  ) {
    actionError.value = '请填写姓名、用户名、至少 12 位密码和初始角色。';
    return;
  }
  const created = await run('create-user', () =>
    createOrganizationUser({
      displayName: createForm.displayName.trim(),
      username: createForm.username.trim(),
      password: createForm.password,
      teamId: createForm.teamId || null,
      roleTemplateId: createForm.roleTemplateId,
    }),
  );
  if (created) {
    showCreateUser.value = false;
    Object.assign(createForm, {
      displayName: '',
      username: '',
      password: '',
      teamId: '',
      roleTemplateId: context.value?.roles[0]?.id ?? '',
    });
  }
}

async function changeTeam(
  user: OrganizationUser,
  event: { target: unknown },
): Promise<void> {
  const target = event.target;
  const value =
    typeof target === 'object' &&
    target !== null &&
    'value' in target &&
    typeof target.value === 'string'
      ? target.value
      : '';
  await run(`team-${user.id}`, () =>
    updateOrganizationMembership(user.id, { teamId: value || null }),
  );
}

async function assignRole(user: OrganizationUser): Promise<void> {
  const roleTemplateId = selectedRoles[user.id];
  const role = context.value?.roles.find((item) => item.id === roleTemplateId);
  if (!roleTemplateId || !role) return;
  const needsTeam = role.grants.some((grant) => grant.scope === 'TEAM');
  if (needsTeam && !user.membership.teamId) {
    actionError.value = '这个角色按团队生效，请先为人员选择团队。';
    return;
  }
  await run(`role-add-${user.id}`, () =>
    assignOrganizationRole(user.id, {
      roleTemplateId,
      teamId: needsTeam ? user.membership.teamId : null,
    }),
  );
}

function openPasswordReset(user: OrganizationUser): void {
  resetTarget.value = user;
  newPassword.value = '';
  actionError.value = '';
}

async function submitPasswordReset(): Promise<void> {
  if (!resetTarget.value) return;
  if (newPassword.value.length < 12) {
    actionError.value = '新密码至少需要 12 位。';
    return;
  }
  const reset = await run('password-reset', () =>
    resetOrganizationUserPassword(resetTarget.value!.id, newPassword.value),
  );
  if (reset) resetTarget.value = null;
}

async function submitTeam(): Promise<void> {
  const name = newTeamName.value.trim();
  if (!name) return;
  const created = await run('create-team', () => createOrganizationTeam(name));
  if (created) newTeamName.value = '';
}

onMounted(() => void load());
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/customers">
        <span class="workspace-mark">品知</span>
        <span>品维·知产业务管理</span>
      </RouterLink>
      <nav class="workspace-nav" aria-label="主要导航">
        <RouterLink to="/customers">客户</RouterLink>
        <span class="workspace-context">人员与权限</span>
      </nav>
    </header>

    <main class="workspace-main">
      <div class="section-heading">
        <div>
          <p class="section-kicker">系统设置</p>
          <h1>人员与权限</h1>
          <p>在一个页面里完成开通账号、分组和角色调整。</p>
        </div>
        <ElButton
          v-if="context?.capabilities.createUser"
          type="primary"
          data-test="open-create-user"
          @click="showCreateUser = !showCreateUser"
          >{{ showCreateUser ? '收起' : '开通人员' }}</ElButton
        >
      </div>

      <p v-if="actionError" class="submit-error" role="alert">
        {{ actionError }}
      </p>

      <section v-if="showCreateUser" class="form-panel people-create-panel">
        <form class="compact-form" @submit.prevent="submitCreateUser">
          <label>
            <span>姓名</span>
            <input v-model="createForm.displayName" data-test="display-name" />
          </label>
          <label>
            <span>登录用户名</span>
            <input v-model="createForm.username" data-test="username" />
          </label>
          <label>
            <span>初始密码</span>
            <input
              v-model="createForm.password"
              data-test="password"
              type="password"
              autocomplete="new-password"
            />
          </label>
          <label>
            <span>团队</span>
            <select v-model="createForm.teamId">
              <option value="">暂不分组</option>
              <option
                v-for="team in activeTeams"
                :key="team.id"
                :value="team.id"
              >
                {{ team.name }}
              </option>
            </select>
          </label>
          <label>
            <span>初始角色</span>
            <select
              v-model="createForm.roleTemplateId"
              data-test="role-template"
            >
              <option
                v-for="role in context?.roles"
                :key="role.id"
                :value="role.id"
              >
                {{ role.name }}
              </option>
            </select>
          </label>
          <ElButton
            type="primary"
            data-test="submit-create-user"
            :loading="pending === 'create-user'"
            @click="submitCreateUser"
            >创建并授权</ElButton
          >
        </form>
      </section>

      <section v-if="state === 'loading'" class="ledger-panel state-panel">
        <span class="state-index">读取中</span>
        <h2>正在读取人员和权限</h2>
      </section>
      <section v-else-if="state === 'failed'" class="ledger-panel state-panel">
        <span class="state-index">连接失败</span>
        <h2>人员管理暂时无法加载</h2>
        <ElButton data-test="retry" @click="load()">重新加载</ElButton>
      </section>
      <template v-else-if="context">
        <section class="people-section">
          <div class="subsection-heading">
            <div>
              <h2>人员</h2>
              <p>{{ context.users.length }} 位部门成员</p>
            </div>
          </div>
          <div
            v-if="context.users.length === 0"
            class="ledger-panel state-panel"
          >
            <h3>当前范围内没有人员</h3>
          </div>
          <article
            v-for="user in context.users"
            :key="user.id"
            class="person-card"
          >
            <header class="person-card__header">
              <div>
                <h3>{{ user.displayName }}</h3>
                <p>@{{ user.username }}</p>
              </div>
              <div class="person-card__status">
                <span
                  :class="[
                    'status-chip',
                    { 'status-chip--off': !user.accountActive },
                  ]"
                >
                  账号{{ user.accountActive ? '启用' : '停用' }}
                </span>
                <span
                  :class="[
                    'status-chip',
                    { 'status-chip--off': !user.membership.active },
                  ]"
                >
                  成员{{ user.membership.active ? '在岗' : '停用' }}
                </span>
              </div>
            </header>
            <div class="person-card__body">
              <label class="inline-field">
                <span>团队</span>
                <select
                  :value="user.membership.teamId ?? ''"
                  :data-test="`team-${user.id}`"
                  :disabled="
                    isSelf(user) ||
                    !context.capabilities.manageUsers ||
                    Boolean(pending)
                  "
                  @change="changeTeam(user, $event)"
                >
                  <option value="">未分组</option>
                  <option
                    v-for="team in activeTeams"
                    :key="team.id"
                    :value="team.id"
                  >
                    {{ team.name }}
                  </option>
                </select>
              </label>
              <div class="role-stack">
                <div class="role-stack__title">角色</div>
                <div
                  v-for="assignment in user.assignments"
                  :key="assignment.id"
                  class="role-row"
                >
                  <span>
                    {{ assignment.roleName }}
                    <small v-if="assignment.teamId">· 团队范围</small>
                  </span>
                  <ElButton
                    v-if="
                      !isSelf(user) &&
                      (context.capabilities.assignDepartmentRoles ||
                        context.capabilities.assignTeamRoles)
                    "
                    text
                    size="small"
                    :disabled="Boolean(pending)"
                    @click="
                      run(`role-${assignment.id}`, () =>
                        setOrganizationRoleAssignmentStatus(
                          user.id,
                          assignment.id,
                          !assignment.active,
                        ),
                      )
                    "
                    >{{ assignment.active ? '停用' : '恢复' }}</ElButton
                  >
                </div>
                <div
                  v-if="!isSelf(user) && context.roles.length"
                  class="role-add"
                >
                  <select
                    v-model="selectedRoles[user.id]"
                    :aria-label="`${user.displayName}新增角色`"
                  >
                    <option
                      v-for="role in context.roles"
                      :key="role.id"
                      :value="role.id"
                    >
                      {{ role.name }}
                    </option>
                  </select>
                  <ElButton
                    :disabled="Boolean(pending)"
                    @click="assignRole(user)"
                    >添加角色</ElButton
                  >
                </div>
              </div>
            </div>
            <footer
              v-if="context.capabilities.manageUsers && !isSelf(user)"
              class="person-card__actions"
            >
              <ElButton
                text
                :disabled="Boolean(pending)"
                @click="openPasswordReset(user)"
                :data-test="`open-reset-${user.id}`"
              >
                重置密码
              </ElButton>
              <ElButton
                text
                :disabled="Boolean(pending)"
                @click="
                  run(`member-${user.id}`, () =>
                    updateOrganizationMembership(user.id, {
                      active: !user.membership.active,
                    }),
                  )
                "
              >
                {{ user.membership.active ? '停用成员' : '恢复成员' }}
              </ElButton>
              <ElButton
                text
                :disabled="Boolean(pending)"
                @click="
                  run(`account-${user.id}`, () =>
                    setOrganizationUserStatus(user.id, !user.accountActive),
                  )
                "
              >
                {{ user.accountActive ? '停用账号' : '启用账号' }}
              </ElButton>
            </footer>
          </article>
        </section>

        <section class="people-section">
          <div class="subsection-heading">
            <div>
              <h2>团队</h2>
              <p>用于人员分组和团队范围角色。</p>
            </div>
          </div>
          <form
            v-if="context.capabilities.createTeam"
            class="team-create"
            @submit.prevent="submitTeam"
          >
            <input
              v-model="newTeamName"
              placeholder="新团队名称"
              aria-label="新团队名称"
            />
            <ElButton :loading="pending === 'create-team'" @click="submitTeam"
              >新建团队</ElButton
            >
          </form>
          <div class="team-grid">
            <div v-for="team in context.teams" :key="team.id" class="team-card">
              <strong>{{ team.name }}</strong>
              <span>{{ team.status === 'ACTIVE' ? '使用中' : '已停用' }}</span>
              <ElButton
                v-if="context.capabilities.manageTeams"
                text
                :disabled="Boolean(pending)"
                @click="
                  run(`team-status-${team.id}`, () =>
                    setOrganizationTeamStatus(
                      team.id,
                      team.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                    ),
                  )
                "
                >{{ team.status === 'ACTIVE' ? '停用' : '启用' }}</ElButton
              >
            </div>
          </div>
        </section>
      </template>
    </main>

    <div
      v-if="resetTarget"
      class="dialog-backdrop"
      @click.self="resetTarget = null"
    >
      <section
        class="simple-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-title"
      >
        <h2 id="reset-title">重置 {{ resetTarget.displayName }} 的密码</h2>
        <p>保存后，该人员已有登录会立即失效。</p>
        <label>
          <span>新密码</span>
          <input
            v-model="newPassword"
            data-test="new-password"
            type="password"
            autocomplete="new-password"
          />
        </label>
        <div class="dialog-actions">
          <ElButton @click="resetTarget = null">取消</ElButton>
          <ElButton
            type="primary"
            data-test="submit-reset-password"
            :loading="pending === 'password-reset'"
            @click="submitPasswordReset"
            >确认重置</ElButton
          >
        </div>
      </section>
    </div>
  </div>
</template>
