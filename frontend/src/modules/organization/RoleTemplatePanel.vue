<script setup lang="ts">
import { ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type {
  OrganizationPermissionCatalogItem,
  OrganizationRole,
  PermissionScope,
} from '../../api/organization';
import RoleTemplateEditor from './RoleTemplateEditor.vue';

defineProps<{
  roles: OrganizationRole[];
  permissionCatalog: OrganizationPermissionCatalogItem[];
  canManage: boolean;
}>();
const emit = defineEmits<{ saved: [] }>();
const editor = ref<{ mode: 'copy' | 'edit'; role: OrganizationRole } | null>(
  null,
);

const scopeLabel: Record<PermissionScope, string> = {
  SELF: '本人',
  TEAM: '团队',
  DEPARTMENT: '部门',
};

function grantLabel(
  grant: OrganizationRole['grants'][number],
  catalog: OrganizationPermissionCatalogItem[],
): string {
  return `${catalog.find((item) => item.action === grant.action)?.label ?? grant.action} · ${scopeLabel[grant.scope]}`;
}

function saved(): void {
  editor.value = null;
  emit('saved');
}
</script>

<template>
  <section class="people-section role-template-section">
    <div class="subsection-heading">
      <div>
        <h2>角色模板</h2>
        <p>复制或调整现有权限组合，保存后自动应用到受影响人员。</p>
      </div>
    </div>

    <div v-if="roles.length === 0" class="ledger-panel state-panel">
      <h3>当前范围内没有可见角色模板</h3>
    </div>
    <div v-else class="role-template-grid">
      <article v-for="role in roles" :key="role.id" class="role-template-card">
        <header>
          <div>
            <span class="state-index">V{{ role.version }}</span>
            <h3>{{ role.name }}</h3>
          </div>
          <span>{{ role.activeAssignmentCount }} 位人员</span>
        </header>
        <ul>
          <li
            v-for="grant in role.grants"
            :key="`${grant.action}:${grant.scope}`"
          >
            {{ grantLabel(grant, permissionCatalog) }}
          </li>
        </ul>
        <footer v-if="canManage">
          <ElButton
            text
            :data-test="`copy-role-${role.id}`"
            @click="editor = { mode: 'copy', role }"
            >复制</ElButton
          >
          <ElButton
            text
            :data-test="`edit-role-${role.id}`"
            @click="editor = { mode: 'edit', role }"
            >编辑</ElButton
          >
        </footer>
      </article>
    </div>

    <div v-if="editor" class="dialog-backdrop" @click.self="editor = null">
      <RoleTemplateEditor
        :mode="editor.mode"
        :role="editor.role"
        :permission-catalog="permissionCatalog"
        @cancel="editor = null"
        @saved="saved"
      />
    </div>
  </section>
</template>
