import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOrganizationUser,
  getOrganizationManagementContext,
  resetOrganizationUserPassword,
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
      grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
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
