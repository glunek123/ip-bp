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
      grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
    },
  ],
};

afterEach(() => vi.clearAllMocks());

beforeEach(() => setActivePinia(createPinia()));

describe('PeopleAccessPage', () => {
  it('loads the people, teams and roles in one workspace', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    const wrapper = mount(PeopleAccessPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('运营甲');
    expect(wrapper.text()).toContain('商标组');
    expect(wrapper.text()).toContain('客户经办');
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

  it('changes team directly and explains an assignment conflict', async () => {
    api.getOrganizationManagementContext.mockResolvedValue(context);
    api.updateOrganizationMembership.mockRejectedValue(
      new ApiError(
        '请先停用成员现有的团队范围角色分配',
        409,
        'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS',
      ),
    );
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
});
