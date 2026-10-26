<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
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
const permissionQuery = ref('');
let active = true;

const groupLabels: Record<string, string> = {
  CASE: '案件',
  CUSTOMER: '客户',
  EVIDENCE: '证物与材料',
  FEE: '费用',
  LEAD: '线索与公证',
  NOTARY: '线索与公证',
  REPORT: '报表',
  ROLE: '人员与权限',
  TEAM: '人员与权限',
  USER: '人员与权限',
  SETTLEMENT: '结算',
};
const permissionGroups = computed(() => {
  const query = permissionQuery.value.trim().toLocaleLowerCase();
  const groups = new Map<
    string,
    { label: string; items: OrganizationPermissionCatalogItem[] }
  >();
  for (const item of props.permissionCatalog) {
    if (
      query &&
      !`${item.label} ${item.action}`.toLocaleLowerCase().includes(query)
    )
      continue;
    const prefix = item.action.split('_')[0] ?? '';
    const label = groupLabels[prefix] ?? '其他权限';
    const group = groups.get(label) ?? { label, items: [] };
    group.items.push(item);
    groups.set(label, group);
  }
  return [...groups.values()];
});

const scopeRank: Record<PermissionScope, number> = {
  SELF: 0,
  TEAM: 1,
  DEPARTMENT: 2,
};

function widestScope(
  item: OrganizationPermissionCatalogItem,
): PermissionScope | undefined {
  return [...item.scopes].sort(
    (left, right) => scopeRank[right] - scopeRank[left],
  )[0];
}

function selectAllInternalPermissions(): void {
  for (const item of props.permissionCatalog) {
    const scope = widestScope(item);
    selected[item.action] = scope !== undefined;
    if (scope) scopes[item.action] = scope;
  }
}

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
  if (pending.value) return;
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
      <p id="grant-scope-guidance" class="field-guidance grant-scope-guidance">
        本人：仅本人负责的数据；团队：当前团队数据；部门：本部门数据。
      </p>
      <p class="field-guidance">
        客户准入可直接赋给运营账号，无需单独创建准入主管账号；权限范围以各动作规则为准。
      </p>
      <ElButton
        data-test="select-all-internal-permissions"
        :disabled="pending"
        @click="selectAllInternalPermissions"
        >选择全部内部权限</ElButton
      >
      <label class="grant-search">
        <span>查找权限</span>
        <input
          v-model="permissionQuery"
          type="search"
          placeholder="搜索权限名称或代码"
          aria-label="搜索权限名称或代码"
          data-test="permission-search"
        />
      </label>
      <section
        v-for="group in permissionGroups"
        :key="group.label"
        class="grant-group"
        :aria-label="group.label"
        :data-grant-group="group.label"
      >
        <h3>{{ group.label }}</h3>
        <label
          v-for="item in group.items"
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
            aria-describedby="grant-scope-guidance"
            :data-test="`scope-${item.action}`"
          >
            <option v-for="scope in item.scopes" :key="scope" :value="scope">
              {{
                scope === 'SELF' ? '本人' : scope === 'TEAM' ? '团队' : '部门'
              }}
            </option>
          </select>
        </label>
      </section>
      <p v-if="permissionGroups.length === 0" role="status">没有匹配的权限。</p>
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

<style scoped>
.role-template-editor {
  display: grid;
  gap: 16px;
  width: min(1040px, 94vw);
  max-height: min(90vh, 920px);
  overflow: auto;
  padding: 24px;
  background: var(--color-surface-1);
  color: var(--color-ink);
}
.role-template-editor__header,
.grant-editor__heading,
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.grant-editor {
  display: grid;
  gap: 12px;
}
.grant-search {
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr);
  align-items: center;
  gap: 10px;
}
.grant-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.grant-group h3 {
  grid-column: 1 / -1;
  margin: 8px 0 0;
  font-size: 1rem;
}
.grant-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(90px, 120px);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}
.grant-option__label {
  min-width: 0;
}
.dialog-actions {
  justify-content: flex-end;
  position: sticky;
  bottom: 0;
  padding: 12px 0 0;
  background: var(--color-surface-1);
}
@media (max-width: 700px) {
  .grant-group {
    grid-template-columns: 1fr;
  }
  .grant-group h3 {
    grid-column: auto;
  }
}
</style>
