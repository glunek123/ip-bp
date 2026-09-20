import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import RoleTemplateEditor from './RoleTemplateEditor.vue';

const api = vi.hoisted(() => ({
  getRoleTemplateImpact: vi.fn(),
  copyRoleTemplate: vi.fn(),
  updateRoleTemplate: vi.fn(),
}));
vi.mock('../../api/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/organization')>()),
  ...api,
}));

const role = {
  id: 'role-1',
  name: '客户经办',
  version: 2,
  activeAssignmentCount: 1,
  grants: [{ action: 'CUSTOMER_READ' as const, scope: 'DEPARTMENT' as const }],
};
const permissionCatalog = [
  {
    action: 'CUSTOMER_READ' as const,
    label: '查看客户',
    scopes: ['SELF', 'TEAM', 'DEPARTMENT'] as const,
  },
  {
    action: 'ROLE_MANAGE' as const,
    label: '管理角色模板',
    scopes: ['SELF', 'TEAM', 'DEPARTMENT'] as const,
  },
].map((item) => ({ ...item, scopes: [...item.scopes] }));

afterEach(() => vi.clearAllMocks());

describe('RoleTemplateEditor', () => {
  it('prefills edit values and automatically loads the impact preview', async () => {
    api.getRoleTemplateImpact.mockResolvedValue({
      roleTemplateId: role.id,
      version: role.version,
      activeAssignmentCount: 1,
      affectedUsers: [{ id: 'user-1', displayName: '运营甲' }],
    });
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();

    expect(api.getRoleTemplateImpact).toHaveBeenCalledWith(role.id);
    expect(
      wrapper.get('[data-test="role-template-name"]').element,
    ).toHaveProperty('value', '客户经办');
    expect(
      wrapper.get('[data-test="grant-CUSTOMER_READ"]').element,
    ).toHaveProperty('checked', true);
    expect(
      wrapper.get('[data-test="scope-CUSTOMER_READ"]').element,
    ).toHaveProperty('value', 'DEPARTMENT');
    expect(wrapper.text()).toContain('运营甲');
    expect(wrapper.find('[data-test="change-reason"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="approval-step"]').exists()).toBe(false);
  });

  it('copies from the same prefilled form with one save', async () => {
    api.copyRoleTemplate.mockResolvedValue({ ...role, id: 'role-copy' });
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'copy', role, permissionCatalog },
    });

    await wrapper
      .get('[data-test="role-template-name"]')
      .setValue('客户经办副本');
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();

    expect(api.copyRoleTemplate).toHaveBeenCalledWith({
      sourceRoleTemplateId: role.id,
      name: '客户经办副本',
      grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
    });
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });

  it('keeps edit input after a version conflict', async () => {
    api.getRoleTemplateImpact.mockResolvedValue({
      roleTemplateId: role.id,
      version: role.version,
      activeAssignmentCount: 0,
      affectedUsers: [],
    });
    api.updateRoleTemplate.mockRejectedValue(
      new ApiError(
        '角色模板已被他人修改，请刷新后重试',
        409,
        'ROLE_TEMPLATE_VERSION_CONFLICT',
      ),
    );
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();
    await wrapper.get('[data-test="role-template-name"]').setValue('我的修改');
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();

    expect(
      wrapper.get('[data-test="role-template-name"]').element,
    ).toHaveProperty('value', '我的修改');
    expect(wrapper.get('[role="alert"]').text()).toContain('刷新');
    expect(wrapper.emitted('saved')).toBeUndefined();
  });

  it('requires at least one selected Grant', async () => {
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'copy', role, permissionCatalog },
    });
    await wrapper.get('[data-test="grant-CUSTOMER_READ"]').setValue(false);
    await wrapper.get('[data-test="role-template-save"]').trigger('click');

    expect(wrapper.get('[role="alert"]').text()).toContain('至少选择一项权限');
    expect(api.copyRoleTemplate).not.toHaveBeenCalled();
  });
});
