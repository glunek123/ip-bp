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
  {
    action: 'CASE_READ' as const,
    label: '查看案件',
    scopes: ['DEPARTMENT'] as const,
  },
  {
    action: 'CASE_MATCH' as const,
    label: '匹配案件',
    scopes: ['SELF', 'TEAM', 'DEPARTMENT'] as const,
  },
  {
    action: 'CASE_COMPLAINT_SUBMIT' as const,
    label: '提交起诉材料',
    scopes: ['SELF', 'TEAM', 'DEPARTMENT'] as const,
  },
  {
    action: 'CASE_COMPLAINT_CONFIRM' as const,
    label: '确认诉状',
    scopes: ['SELF', 'TEAM', 'DEPARTMENT'] as const,
  },
  {
    action: 'CASE_COMPLAINT_MAIL' as const,
    label: '登记诉状邮寄',
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
    expect(
      wrapper
        .get('[data-test="scope-CUSTOMER_READ"]')
        .attributes('aria-describedby'),
    ).toBe('grant-scope-guidance');
    expect(wrapper.text()).toContain('运营甲');
    expect(wrapper.text()).toContain('本人：仅本人负责的数据');
    expect(wrapper.text()).toContain('团队：当前团队数据');
    expect(wrapper.text()).toContain('部门：本部门数据');
    expect(wrapper.text()).not.toContain('CUSTOMER_READ');
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

  it('offers case reading only at department scope and saves the grant', async () => {
    api.updateRoleTemplate.mockResolvedValue(role);
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('查看案件');
    expect(
      wrapper.get('[data-test="scope-CASE_READ"]').findAll('option'),
    ).toHaveLength(1);
    await wrapper.get('[data-test="grant-CASE_READ"]').setValue(true);
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();

    expect(api.updateRoleTemplate).toHaveBeenCalledWith(role.id, {
      name: role.name,
      expectedVersion: role.version,
      grants: [
        { action: 'CUSTOMER_READ', scope: 'DEPARTMENT' },
        { action: 'CASE_READ', scope: 'DEPARTMENT' },
      ],
    });
  });

  it('offers the backend case matching scope choices', async () => {
    api.updateRoleTemplate.mockResolvedValue(role);
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('匹配案件');
    expect(
      wrapper.get('[data-test="scope-CASE_MATCH"]').findAll('option'),
    ).toHaveLength(3);
    await wrapper.get('[data-test="grant-CASE_MATCH"]').setValue(true);
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();
    expect(api.updateRoleTemplate).toHaveBeenCalledWith(
      role.id,
      expect.objectContaining({
        grants: expect.arrayContaining([
          { action: 'CASE_MATCH', scope: 'SELF' },
        ]),
      }),
    );
  });

  it('offers case complaint submission with the backend scope choices', async () => {
    api.updateRoleTemplate.mockResolvedValue(role);
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('提交起诉材料');
    expect(
      wrapper
        .get('[data-test="scope-CASE_COMPLAINT_SUBMIT"]')
        .findAll('option'),
    ).toHaveLength(3);
    await wrapper
      .get('[data-test="grant-CASE_COMPLAINT_SUBMIT"]')
      .setValue(true);
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();
    expect(api.updateRoleTemplate).toHaveBeenCalledWith(
      role.id,
      expect.objectContaining({
        grants: expect.arrayContaining([
          { action: 'CASE_COMPLAINT_SUBMIT', scope: 'SELF' },
        ]),
      }),
    );
  });

  it('offers case complaint confirmation with the backend scope choices', async () => {
    api.updateRoleTemplate.mockResolvedValue(role);
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('确认诉状');
    expect(
      wrapper
        .get('[data-test="scope-CASE_COMPLAINT_CONFIRM"]')
        .findAll('option'),
    ).toHaveLength(3);
    await wrapper
      .get('[data-test="grant-CASE_COMPLAINT_CONFIRM"]')
      .setValue(true);
    await wrapper
      .get('[data-test="scope-CASE_COMPLAINT_CONFIRM"]')
      .setValue('SELF');
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();
    expect(api.updateRoleTemplate).toHaveBeenCalledWith(
      role.id,
      expect.objectContaining({
        grants: expect.arrayContaining([
          { action: 'CASE_COMPLAINT_CONFIRM', scope: 'SELF' },
        ]),
      }),
    );
  });

  it('offers internal complaint mailing with the backend scope choices', async () => {
    api.updateRoleTemplate.mockResolvedValue(role);
    const wrapper = mount(RoleTemplateEditor, {
      props: { mode: 'edit', role, permissionCatalog },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('登记诉状邮寄');
    expect(
      wrapper.get('[data-test="scope-CASE_COMPLAINT_MAIL"]').findAll('option'),
    ).toHaveLength(3);
    await wrapper.get('[data-test="grant-CASE_COMPLAINT_MAIL"]').setValue(true);
    await wrapper
      .get('[data-test="scope-CASE_COMPLAINT_MAIL"]')
      .setValue('SELF');
    await wrapper.get('[data-test="role-template-save"]').trigger('click');
    await flushPromises();
    expect(api.updateRoleTemplate).toHaveBeenCalledWith(
      role.id,
      expect.objectContaining({
        grants: expect.arrayContaining([
          { action: 'CASE_COMPLAINT_MAIL', scope: 'SELF' },
        ]),
      }),
    );
  });
});
