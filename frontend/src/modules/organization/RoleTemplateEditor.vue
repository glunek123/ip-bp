<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  copyRoleTemplate,
  getRoleTemplateImpact,
  updateRoleTemplate,
  type OrganizationGrant,
  type OrganizationPermissionCatalogItem,
  type OrganizationRole,
  type PermissionScope,
  type RoleTemplateImpact,
} from '../../api/organization';

const props = defineProps<{
  mode: 'copy' | 'edit';
  role: OrganizationRole;
  permissionCatalog: OrganizationPermissionCatalogItem[];
}>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const name = ref(
  props.mode === 'copy' ? `${props.role.name} 副本` : props.role.name,
);
const selected = reactive<Record<string, boolean>>({});
const scopes = reactive<Record<string, PermissionScope>>({});
const pending = ref(false);
const error = ref('');
const impact = ref<RoleTemplateImpact | null>(null);
const impactState = ref<'idle' | 'loading' | 'failed'>('idle');
let active = true;

const scopeRank: Record<PermissionScope, number> = {
  SELF: 0,
  TEAM: 1,
  DEPARTMENT: 2,
};

for (const item of props.permissionCatalog) {
  const existing = props.role.grants
    .filter((grant) => grant.action === item.action)
    .sort((left, right) => scopeRank[right.scope] - scopeRank[left.scope])[0];
  selected[item.action] = existing !== undefined;
  scopes[item.action] = existing?.scope ?? item.scopes[0] ?? 'SELF';
}

async function loadImpact(): Promise<void> {
  if (props.mode !== 'edit') return;
  impactState.value = 'loading';
  try {
    const result = await getRoleTemplateImpact(props.role.id);
    if (!active) return;
    impact.value = result;
    impactState.value = 'idle';
  } catch {
    if (active) impactState.value = 'failed';
  }
}

function errorMessage(value: unknown): string {
  if (
    value instanceof ApiError &&
    value.code === 'ROLE_TEMPLATE_VERSION_CONFLICT'
  ) {
    return '模板已被他人修改，请刷新页面后再保存；当前输入已保留。';
  }
  if (value instanceof ApiError && value.status === 403) {
    return '当前权限不足，无法保存这个角色模板。';
  }
  return value instanceof ApiError
    ? value.message
    : '保存没有完成，请检查连接后重试。';
}

async function submit(): Promise<void> {
  const trimmedName = name.value.trim();
  const grants = props.permissionCatalog.flatMap<OrganizationGrant>((item) =>
    selected[item.action]
      ? [{ action: item.action, scope: scopes[item.action] }]
      : [],
  );
  if (!trimmedName) {
    error.value = '请输入角色模板名称。';
    return;
  }
  if (grants.length === 0) {
    error.value = '至少选择一项权限。';
    return;
  }

  pending.value = true;
  error.value = '';
  try {
    if (props.mode === 'copy') {
      await copyRoleTemplate({
        sourceRoleTemplateId: props.role.id,
        name: trimmedName,
        grants,
      });
    } else {
      await updateRoleTemplate(props.role.id, {
        name: trimmedName,
        expectedVersion: props.role.version,
        grants,
      });
    }
    emit('saved');
  } catch (value) {
    error.value = errorMessage(value);
  } finally {
    pending.value = false;
  }
}

onMounted(() => void loadImpact());
onBeforeUnmount(() => {
  active = false;
});
</script>

<template>
  <section
    class="role-template-editor"
    role="dialog"
    aria-modal="true"
    aria-labelledby="role-editor-title"
  >
    <header class="role-template-editor__header">
      <div>
        <span class="state-index">{{
          mode === 'copy' ? '复制模板' : '编辑模板'
        }}</span>
        <h2 id="role-editor-title">
          {{ mode === 'copy' ? '创建角色模板' : role.name }}
        </h2>
      </div>
      <span class="role-version">V{{ role.version }}</span>
    </header>

    <label class="role-template-editor__name">
      <span>模板名称</span>
      <input v-model="name" data-test="role-template-name" maxlength="100" />
    </label>

    <div class="grant-editor" aria-label="权限配置">
      <div class="grant-editor__heading">
        <strong>权限配置</strong>
        <span>勾选动作，再选择适用范围</span>
      </div>
      <p class="field-guidance grant-scope-guidance">
        本人：仅本人负责的数据；团队：当前团队数据；部门：本部门数据。
      </p>
      <label
        v-for="item in permissionCatalog"
        :key="item.action"
        class="grant-option"
        :class="{ 'grant-option--selected': selected[item.action] }"
      >
        <input
          v-model="selected[item.action]"
          type="checkbox"
          :data-test="`grant-${item.action}`"
        />
        <span class="grant-option__label" :title="item.action">
          <strong>{{ item.label }}</strong>
        </span>
        <select
          v-model="scopes[item.action]"
          :disabled="!selected[item.action]"
          :aria-label="`${item.label}范围`"
          :data-test="`scope-${item.action}`"
        >
          <option v-for="scope in item.scopes" :key="scope" :value="scope">
            {{ scope === 'SELF' ? '本人' : scope === 'TEAM' ? '团队' : '部门' }}
          </option>
        </select>
      </label>
    </div>

    <aside v-if="mode === 'edit'" class="impact-preview">
      <strong>保存后影响</strong>
      <span v-if="impactState === 'loading'">正在读取受影响人员…</span>
      <span v-else-if="impactState === 'failed'"
        >影响预览暂时无法加载，保存时仍会重新校验。</span
      >
      <template v-else-if="impact">
        <span
          >{{
            impact.activeAssignmentCount
          }}
          位人员将在下一次请求时使用新权限，无需重新登录</span
        >
        <p v-if="impact.affectedUsers.length">
          {{ impact.affectedUsers.map((user) => user.displayName).join('、') }}
        </p>
      </template>
    </aside>
    <aside v-else class="impact-preview impact-preview--quiet">
      复制会创建新模板，不改变来源模板和现有人员。
    </aside>

    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <footer class="dialog-actions">
      <ElButton :disabled="pending" @click="emit('cancel')">取消</ElButton>
      <ElButton
        type="primary"
        data-test="role-template-save"
        :loading="pending"
        @click="submit"
        >保存模板</ElButton
      >
    </footer>
  </section>
</template>
