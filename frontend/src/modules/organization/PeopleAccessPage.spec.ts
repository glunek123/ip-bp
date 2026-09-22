import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import PeopleAccessPage from './PeopleAccessPage.vue';

const api = vi.hoisted(() => ({
  getOrganizationManagementContext: vi.fn(),
  createOrganizationUser: vi.fn(),
  setOrganizationUserStatus: vi.fn(),
  resetOrganizationUserPassword: vi.fn(),
  updateOrganizationMembership: vi.fn(),
  assignOrganizationRole: vi.fn(),
  setOrganizationRoleAssignmentStatus: vi.fn(),
  createOrganizationTeam: vi.fn(),
  setOrganizationTeamStatus: vi.fn(),
  getRoleTemplateImpact: vi.fn(),
  copyRoleTemplate: vi.fn(),
  updateRoleTemplate: vi.fn(),
}));
vi.mock('../../api/organization', () => api);

const context = {
  capabilities: {
    createUser: true,
    manageUsers: true,
    createTeam: true,
    manageTeams: true,
    assignDepartmentRoles: true,
    assignTeamRoles: false,
    manageRoleTemplates: true,
  },
  users: [
    {
      id: 'user-1',
      displayName: '运营甲',
      username: 'operator-a',
      accountActive: true,
      membership: { id: 'membership-1', active: true, teamId: null },
      assignments: [
        {
          id: 'assignment-1',
          roleTemplateId: 'role-1',
          roleName: '客户经办',
          teamId: null,
          active: true,
          version: 1,
        },
      ],
    },
  ],
  teams: [{ id: 'team-1', name: '商标组', status: 'ACTIVE' as const }],
  roles: [
    {
      id: 'role-1',
      name: '客户经办',
      version: 2,
      activeAssignmentCount: 1,
      assignable: true,
      grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
    },
  ],
  permissionCatalog: [
    {
      action: 'CUSTOMER_READ',
      label: '查看客户',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
  ],
};

afterEach(() => vi.clearAllMocks());

beforeEach(() => setActivePinia(createPinia()));

describe('PeopleAccessPage', () => {
  it('explains account requirements and confirms destructive access changes', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="open-create-user"]').trigger('click');
    expect(wrapper.text()).toContain('用户名至少 3 个字符');
    expect(wrapper.text()).toContain('初始密码至少 12 个字符');
    expect(wrapper.text()).toContain('本人：仅本人负责的数据');
    expect(wrapper.findAll('.required-mark').length).toBeGreaterThanOrEqual(4);

    await wrapper.get('[data-test="stop-account-user-1"]').trigger('click');
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('现有登录会立即失效'),
    );
    expect(api.setOrganizationUserStatus).not.toHaveBeenCalled();

    await wrapper.get('[data-test="stop-membership-user-1"]').trigger('click');
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('不能再以本部门成员身份办理业务'),
    );
    expect(api.updateOrganizationMembership).not.toHaveBeenCalled();

    await wrapper.get('[data-test="stop-role-assignment-1"]').trigger('click');
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('将失去“客户经办”对应权限'),
    );
    expect(api.setOrganizationRoleAssignmentStatus).not.toHaveBeenCalled();

    await wrapper.get('[data-test="stop-team-team-1"]').trigger('click');
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('不能再用于新的人员分组'),
    );
    expect(api.setOrganizationTeamStatus).not.toHaveBeenCalled();
  });

  it('loads the people, teams and roles in one workspace', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('运营甲');
    expect(wrapper.text()).toContain('商标组');
    expect(wrapper.text()).toContain('客户经办');
    expect(wrapper.find('.workspace-header').exists()).toBe(false);
    expect(wrapper.find('.workspace-shell').exists()).toBe(false);
    expect(wrapper.find('.page-view').exists()).toBe(true);
  });

  it('shows readable templates without offering non-assignable role actions', async () => {
    api.getOrganizationManagementContext.mockResolvedValue({
      ...context,
      capabilities: {
        ...context.capabilities,
        createUser: false,
        assignDepartmentRoles: false,
      },
      roles: context.roles.map((role) => ({ ...role, assignable: false })),
    });
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('客户经办');
    expect(wrapper.text()).not.toContain('添加角色');
    expect(wrapper.find('[data-test="open-create-user"]').exists()).toBe(false);
  });

  it('opens role template editing with an automatic impact preview', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    api.getRoleTemplateImpact.mockResolvedValue({
      roleTemplateId: 'role-1',
      version: 2,
      activeAssignmentCount: 1,
      affectedUsers: [{ id: 'user-1', displayName: '运营甲' }],
    });
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="edit-role-role-1"]').trigger('click');
    await flushPromises();

    expect(api.getRoleTemplateImpact).toHaveBeenCalledWith('role-1');
    expect(
      wrapper.get('[data-test="role-template-name"]').element,
    ).toHaveProperty('value', '客户经办');
  });

  it('creates a person without asking for an operation reason', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    api.createOrganizationUser.mockResolvedValue(undefined);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="open-create-user"]').trigger('click');
    await wrapper.get('[data-test="display-name"]').setValue('运营乙');
    await wrapper.get('[data-test="username"]').setValue('operator-b');
    await wrapper.get('[data-test="password"]').setValue('LongPassword12');
    await wrapper.get('[data-test="role-template"]').setValue('role-1');
    await wrapper.get('[data-test="submit-create-user"]').trigger('click');
    await flushPromises();

    expect(api.createOrganizationUser).toHaveBeenCalledWith({
      displayName: '运营乙',
      username: 'operator-b',
      password: 'LongPassword12',
      teamId: null,
      roleTemplateId: 'role-1',
    });
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('clears create-person validation when the form is closed', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="open-create-user"]').trigger('click');
    await wrapper.get('[data-test="submit-create-user"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('请填写姓名');

    await wrapper.get('[data-test="open-create-user"]').trigger('click');

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('shows feedback when a team name is empty', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('form.team-create').trigger('submit');

    expect(wrapper.get('[role="alert"]').text()).toBe('请输入团队名称。');
    expect(api.createOrganizationTeam).not.toHaveBeenCalled();
  });

  it('automatically retries the retained Team after the conflicting role is stopped', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.getOrganizationManagementContext.mockResolvedValue(context);
    api.updateOrganizationMembership
      .mockRejectedValueOnce(
        new ApiError(
          '请先停用成员现有的团队范围角色分配',
          409,
          'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS',
        ),
      )
      .mockResolvedValueOnce(undefined);
    api.setOrganizationRoleAssignmentStatus.mockResolvedValue(undefined);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="team-user-1"]').setValue('team-1');
    await flushPromises();

    expect(api.updateOrganizationMembership).toHaveBeenCalledWith('user-1', {
      teamId: 'team-1',
    });
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '先停用该人员当前的团队范围角色',
    );

    await wrapper
      .findAll('.role-row button')
      .find((button) => button.text() === '停用')!
      .trigger('click');
    await flushPromises();

    expect(api.setOrganizationRoleAssignmentStatus).toHaveBeenCalledWith(
      'user-1',
      'assignment-1',
      false,
    );
    expect(api.updateOrganizationMembership).toHaveBeenCalledTimes(2);
    expect(api.updateOrganizationMembership).toHaveBeenLastCalledWith(
      'user-1',
      { teamId: 'team-1' },
    );
  });

  it('resets a password with only the new password', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    api.resetOrganizationUserPassword.mockResolvedValue(undefined);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="open-reset-user-1"]').trigger('click');
    await wrapper
      .get('[data-test="new-password"]')
      .setValue('AnotherPassword12');
    await wrapper.get('[data-test="submit-reset-password"]').trigger('click');
    await flushPromises();

    expect(api.resetOrganizationUserPassword).toHaveBeenCalledWith(
      'user-1',
      'AnotherPassword12',
    );
    expect(wrapper.text()).not.toContain('当前密码');
  });

  it('clears password fields after failed requests', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    api.createOrganizationUser.mockRejectedValue(
      new ApiError('用户名已存在', 409, 'USERNAME_ALREADY_EXISTS'),
    );
    api.resetOrganizationUserPassword.mockRejectedValue(
      new ApiError('无权操作', 403, 'MANAGEMENT_ACTION_FORBIDDEN'),
    );
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-test="open-create-user"]').trigger('click');
    await wrapper.get('[data-test="display-name"]').setValue('运营乙');
    await wrapper.get('[data-test="username"]').setValue('operator-b');
    await wrapper.get('[data-test="password"]').setValue('LongPassword12');
    await wrapper.get('[data-test="role-template"]').setValue('role-1');
    await wrapper.get('[data-test="submit-create-user"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="password"]').element).toHaveProperty(
      'value',
      '',
    );

    await wrapper.get('[data-test="open-reset-user-1"]').trigger('click');
    await wrapper.get('[data-test="new-password"]').setValue('NewPassword123');
    await wrapper.get('[data-test="submit-reset-password"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="new-password"]').element).toHaveProperty(
      'value',
      '',
    );
  });

  it('shows authorization denial separately from a connection failure', async () => {
    api.getOrganizationManagementContext.mockRejectedValue(
      new ApiError('无权执行此管理操作', 403, 'MANAGEMENT_ACTION_FORBIDDEN'),
    );
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('当前账号不能查看人员与权限');
    expect(wrapper.text()).not.toContain('连接失败');
  });
});
