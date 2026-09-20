import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyRoleTemplate,
  createOrganizationUser,
  getOrganizationManagementContext,
  getRoleTemplateImpact,
  resetOrganizationUserPassword,
  updateRoleTemplate,
  updateOrganizationMembership,
} from './organization';

afterEach(() => vi.unstubAllGlobals());

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
  teams: [{ id: 'team-1', name: '商标组', status: 'ACTIVE' }],
  roles: [
    {
      id: 'role-1',
      name: '客户经办',
      version: 2,
      activeAssignmentCount: 1,
      assignable: true,
      grants: [
        { action: 'CUSTOMER_READ', scope: 'DEPARTMENT' },
        { action: 'ROLE_MANAGE', scope: 'DEPARTMENT' },
      ],
    },
  ],
  permissionCatalog: [
    {
      action: 'CUSTOMER_READ',
      label: '查看客户',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_CREATE_DRAFT',
      label: '创建客户草稿',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_EDIT_ROUTINE',
      label: '编辑客户常规信息',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'USER_READ',
      label: '查看人员',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'USER_MANAGE',
      label: '管理人员',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'TEAM_READ',
      label: '查看团队',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'TEAM_MANAGE',
      label: '管理团队',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'ROLE_READ',
      label: '查看角色模板',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'ROLE_ASSIGN',
      label: '分配角色',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'ROLE_MANAGE',
      label: '管理角色模板',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
  ],
};

describe('organization API', () => {
  it('decodes the management context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(context))),
    );

    await expect(getOrganizationManagementContext()).resolves.toEqual(context);
  });

  it('rejects malformed management data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...context, teams: [{}] })),
        ),
    );

    await expect(getOrganizationManagementContext()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it.each([
    {
      ...context,
      users: [{ ...context.users[0], passwordHash: 'must-not-pass' }],
    },
    {
      ...context,
      roles: [
        {
          ...context.roles[0],
          grants: [{ action: 'MADE_UP_ACTION', scope: 'DEPARTMENT' }],
        },
      ],
    },
    {
      ...context,
      roles: [
        {
          ...context.roles[0],
          grants: [{ action: 'CUSTOMER_READ', scope: 'GLOBAL' }],
        },
      ],
    },
    {
      ...context,
      permissionCatalog: [
        ...context.permissionCatalog,
        context.permissionCatalog[0],
      ],
    },
    {
      ...context,
      permissionCatalog: context.permissionCatalog.map((item, index) =>
        index === 0 ? { ...item, extra: true } : item,
      ),
    },
  ])('rejects sensitive or invalid management shapes %#', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );

    await expect(getOrganizationManagementContext()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes the minimal role template impact projection', async () => {
    const impact = {
      roleTemplateId: 'role-1',
      version: 2,
      activeAssignmentCount: 1,
      affectedUsers: [{ id: 'user-1', displayName: '运营甲' }],
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(impact)));
    vi.stubGlobal('fetch', fetch);

    await expect(getRoleTemplateImpact('role/1')).resolves.toEqual(impact);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/organization/role-templates/role%2F1/impact',
      expect.any(Object),
    );
  });

  it('sends exact copy and update commands and strictly decodes results', async () => {
    const source = context.roles[0];
    const role = {
      id: source.id,
      name: source.name,
      version: source.version,
      activeAssignmentCount: source.activeAssignmentCount,
      grants: source.grants,
    };
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(role)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      copyRoleTemplate({
        sourceRoleTemplateId: 'role-1',
        name: '复制角色',
        grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
      }),
    ).resolves.toEqual(role);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/organization/role-templates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sourceRoleTemplateId: 'role-1',
          name: '复制角色',
          grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
        }),
      }),
    );

    await expect(
      updateRoleTemplate('role/1', {
        name: '更新角色',
        expectedVersion: 2,
        grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
      }),
    ).resolves.toEqual(role);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/organization/role-templates/role%2F1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          name: '更新角色',
          expectedVersion: 2,
          grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
        }),
      }),
    );
  });

  it('rejects malformed impact and mutation responses', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          roleTemplateId: 'role-1',
          version: 0,
          activeAssignmentCount: 1,
          affectedUsers: [],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(getRoleTemplateImpact('role-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...context.roles[0], version: '2' })),
    );
    await expect(
      copyRoleTemplate({
        sourceRoleTemplateId: 'role-1',
        name: '复制角色',
        grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('creates a person through the organization endpoint', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'user-2' })));
    vi.stubGlobal('fetch', fetch);

    await createOrganizationUser({
      displayName: '运营乙',
      username: 'operator-b',
      password: 'LongPassword12',
      teamId: null,
      roleTemplateId: 'role-1',
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/organization/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          displayName: '运营乙',
          username: 'operator-b',
          password: 'LongPassword12',
          teamId: null,
          roleTemplateId: 'role-1',
        }),
      }),
    );
  });

  it('uses the streamlined password and team payloads', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'user-1', passwordReset: true })),
      );
    vi.stubGlobal('fetch', fetch);

    await resetOrganizationUserPassword('user-1', 'NewPassword123');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/organization/users/user-1/password-reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ newPassword: 'NewPassword123' }),
      }),
    );

    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'membership-1' })),
    );
    await updateOrganizationMembership('user-1', { teamId: 'team-1' });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/organization/users/user-1/membership',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ teamId: 'team-1' }),
      }),
    );
  });
});
