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
import * as organizationApi from './organization';

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
      action: 'CUSTOMER_DELETE_DRAFT',
      label: '删除客户草稿',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_RESTORE_DRAFT',
      label: '恢复客户草稿',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_RESPONSIBLE_TRANSFER',
      label: '转派负责运营',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_COOPERATION_PAUSE',
      label: '暂停合作',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_COOPERATION_TERMINATE',
      label: '终止合作',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_COOPERATION_RESUME',
      label: '恢复合作',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_RIGHT_ASSET_WITHDRAW',
      label: '撤下权利资产',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_AGREEMENT_READ',
      label: '查看客户协议',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_AGREEMENT_EDIT',
      label: '维护客户协议',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_INVOICE_READ',
      label: '查看开票资料',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_INVOICE_EDIT',
      label: '维护开票资料',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_SETTLEMENT_READ',
      label: '查看客户结算',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_SETTLEMENT_REGISTER',
      label: '登记客户结算',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_SETTLEMENT_CORRECT',
      label: '更正客户结算',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CUSTOMER_ADMIT',
      label: '准入客户',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'LEAD_READ',
      label: '查看线索',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'LEAD_CREATE',
      label: '创建线索',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'LEAD_EDIT',
      label: '编辑线索',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'LEAD_PUSH',
      label: '推送线索',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'LEAD_WITHDRAW_APPLY',
      label: '申请撤回归档',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'LEAD_EVIDENCE_DECIDE',
      label: '确认取证或不取证',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_EVIDENCE_RECORD',
      label: '登记取证与物流',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_UNBOX_RECORD',
      label: '登记开箱材料',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_OPENING_REVIEW',
      label: '审核开箱侵权',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_ISSUANCE_DECIDE',
      label: '决定是否出证',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_RETURN_ARCHIVE',
      label: '办理退货归档',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_LIST_EXPORT',
      label: '导出公证办理清单',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_READ',
      label: '查看案件',
      scopes: ['DEPARTMENT'],
    },
    {
      action: 'CASE_MATCH',
      label: '匹配案件',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_COMPLAINT_SUBMIT',
      label: '提交起诉材料',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_COMPLAINT_CONFIRM',
      label: '确认诉状',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_COMPLAINT_MAIL',
      label: '登记诉状邮寄',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_FILING_SUBMIT',
      label: '提交法院',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_ACCEPTANCE_REGISTER',
      label: '登记正式立案',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_HEARING_SCHEDULE',
      label: '登记开庭安排',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_HEARING_CORRECT',
      label: '更正开庭安排',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_JUDGMENT_REGISTER',
      label: '登记一审判决',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_JUDGMENT_CORRECT',
      label: '更正一审判决',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_JUDGMENT_NEXT_STEP',
      label: '登记判决后续选择',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'CASE_JUDGMENT_NEXT_STEP_REVOKE',
      label: '撤销判决后续选择',
      scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
    },
    {
      action: 'NOTARY_OFFICE_MANAGE',
      label: '管理公证处',
      scopes: ['DEPARTMENT'],
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
      action: 'LAWYER_ACCOUNT_MANAGE',
      label: '管理律师账号',
      scopes: ['DEPARTMENT'],
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
  it('accepts the two scoped case judgment grants in the permission catalog', async () => {
    const judgmentActions = [
      {
        action: 'CASE_JUDGMENT_REGISTER',
        label: '登记一审判决',
        scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
      },
      {
        action: 'CASE_JUDGMENT_CORRECT',
        label: '更正一审判决',
        scopes: ['SELF', 'TEAM', 'DEPARTMENT'],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...context,
            permissionCatalog: context.permissionCatalog,
          }),
        ),
      ),
    );

    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      permissionCatalog: expect.arrayContaining(judgmentActions),
    });
  });

  it('decodes the exact backend permission catalog including notary opening', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(context))),
    );

    const result = await getOrganizationManagementContext();
    expect(result.permissionCatalog.map(({ action }) => action)).toEqual([
      'CUSTOMER_READ',
      'CUSTOMER_CREATE_DRAFT',
      'CUSTOMER_EDIT_ROUTINE',
      'CUSTOMER_DELETE_DRAFT',
      'CUSTOMER_RESTORE_DRAFT',
      'CUSTOMER_RESPONSIBLE_TRANSFER',
      'CUSTOMER_COOPERATION_PAUSE',
      'CUSTOMER_COOPERATION_TERMINATE',
      'CUSTOMER_COOPERATION_RESUME',
      'CUSTOMER_RIGHT_ASSET_WITHDRAW',
      'CUSTOMER_AGREEMENT_READ',
      'CUSTOMER_AGREEMENT_EDIT',
      'CUSTOMER_INVOICE_READ',
      'CUSTOMER_INVOICE_EDIT',
      'CUSTOMER_SETTLEMENT_READ',
      'CUSTOMER_SETTLEMENT_REGISTER',
      'CUSTOMER_SETTLEMENT_CORRECT',
      'CUSTOMER_ADMIT',
      'LEAD_READ',
      'LEAD_CREATE',
      'LEAD_EDIT',
      'LEAD_PUSH',
      'LEAD_WITHDRAW_APPLY',
      'LEAD_EVIDENCE_DECIDE',
      'NOTARY_EVIDENCE_RECORD',
      'NOTARY_UNBOX_RECORD',
      'NOTARY_OPENING_REVIEW',
      'NOTARY_ISSUANCE_DECIDE',
      'NOTARY_RETURN_ARCHIVE',
      'NOTARY_LIST_EXPORT',
      'CASE_READ',
      'CASE_MATCH',
      'CASE_COMPLAINT_SUBMIT',
      'CASE_COMPLAINT_CONFIRM',
      'CASE_COMPLAINT_MAIL',
      'CASE_FILING_SUBMIT',
      'CASE_ACCEPTANCE_REGISTER',
      'CASE_HEARING_SCHEDULE',
      'CASE_HEARING_CORRECT',
      'CASE_JUDGMENT_REGISTER',
      'CASE_JUDGMENT_CORRECT',
      'CASE_JUDGMENT_NEXT_STEP',
      'CASE_JUDGMENT_NEXT_STEP_REVOKE',
      'NOTARY_OFFICE_MANAGE',
      'USER_READ',
      'USER_MANAGE',
      'LAWYER_ACCOUNT_MANAGE',
      'TEAM_READ',
      'TEAM_MANAGE',
      'ROLE_READ',
      'ROLE_ASSIGN',
      'ROLE_MANAGE',
    ]);
  });

  it('decodes the management context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(context))),
    );

    await expect(getOrganizationManagementContext()).resolves.toEqual(context);
  });

  it('accepts a department-scoped CASE_READ role grant', async () => {
    const body = {
      ...context,
      roles: [
        {
          ...context.roles[0],
          grants: [
            ...context.roles[0].grants,
            { action: 'CASE_READ', scope: 'DEPARTMENT' },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );

    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      roles: [
        {
          grants: expect.arrayContaining([
            { action: 'CASE_READ', scope: 'DEPARTMENT' },
          ]),
        },
      ],
    });
  });

  it('decodes a formally assigned notary list export grant', async () => {
    const body = {
      ...context,
      roles: [
        {
          ...context.roles[0],
          grants: [
            ...context.roles[0].grants,
            { action: 'NOTARY_LIST_EXPORT', scope: 'DEPARTMENT' },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      roles: [
        {
          grants: expect.arrayContaining([
            { action: 'NOTARY_LIST_EXPORT', scope: 'DEPARTMENT' },
          ]),
        },
      ],
    });
  });

  it('accepts a self-scoped CASE_MATCH role grant', async () => {
    const body = {
      ...context,
      roles: [
        {
          ...context.roles[0]!,
          grants: [{ action: 'CASE_MATCH', scope: 'SELF' }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      roles: [{ grants: [{ action: 'CASE_MATCH', scope: 'SELF' }] }],
    });
  });

  it.each([
    ['CUSTOMER_DELETE_DRAFT', 'TEAM'],
    ['CUSTOMER_RESTORE_DRAFT', 'DEPARTMENT'],
  ] as const)(
    'accepts a %s role grant with %s scope',
    async (action, scope) => {
      const body = {
        ...context,
        roles: [
          {
            ...context.roles[0]!,
            grants: [{ action, scope }],
          },
        ],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );

      await expect(getOrganizationManagementContext()).resolves.toMatchObject({
        roles: [{ grants: [{ action, scope }] }],
      });
    },
  );

  it('accepts a self-scoped CASE_COMPLAINT_SUBMIT role grant', async () => {
    const body = {
      ...context,
      roles: [
        {
          ...context.roles[0]!,
          grants: [{ action: 'CASE_COMPLAINT_SUBMIT', scope: 'SELF' }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      roles: [{ grants: [{ action: 'CASE_COMPLAINT_SUBMIT', scope: 'SELF' }] }],
    });
  });

  it('accepts a self-scoped CASE_COMPLAINT_CONFIRM role grant', async () => {
    const body = {
      ...context,
      roles: [
        {
          ...context.roles[0]!,
          grants: [{ action: 'CASE_COMPLAINT_CONFIRM', scope: 'SELF' }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      roles: [
        { grants: [{ action: 'CASE_COMPLAINT_CONFIRM', scope: 'SELF' }] },
      ],
    });
  });

  it('accepts a self-scoped CASE_COMPLAINT_MAIL role grant', async () => {
    const body = {
      ...context,
      roles: [
        {
          ...context.roles[0]!,
          grants: [{ action: 'CASE_COMPLAINT_MAIL', scope: 'SELF' }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(getOrganizationManagementContext()).resolves.toMatchObject({
      roles: [{ grants: [{ action: 'CASE_COMPLAINT_MAIL', scope: 'SELF' }] }],
    });
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
      permissionCatalog: context.permissionCatalog.filter(
        (item) => item.action !== 'LEAD_EVIDENCE_DECIDE',
      ),
    },
    {
      ...context,
      permissionCatalog: context.permissionCatalog.map((item, index) =>
        index === 0 ? { ...item, extra: true } : item,
      ),
    },
    {
      ...context,
      permissionCatalog: context.permissionCatalog.map((item, index) =>
        index === 0 ? { ...item, action: 'CLIENT_LEAD_READ' } : item,
      ),
    },
    {
      ...context,
      permissionCatalog: context.permissionCatalog.map((item) =>
        item.action === 'CASE_READ'
          ? { ...item, scopes: ['SELF', 'TEAM', 'DEPARTMENT'] }
          : item.action === 'CASE_MATCH'
            ? { ...item, scopes: ['SELF'] }
            : item.action === 'CASE_COMPLAINT_SUBMIT'
              ? { ...item, scopes: ['TEAM', 'DEPARTMENT'] }
              : item.action === 'CASE_COMPLAINT_CONFIRM'
                ? { ...item, scopes: ['TEAM', 'DEPARTMENT'] }
                : item.action === 'CASE_COMPLAINT_MAIL'
                  ? { ...item, scopes: ['TEAM', 'DEPARTMENT'] }
                  : item.action === 'CASE_FILING_SUBMIT'
                    ? { ...item, scopes: ['TEAM', 'DEPARTMENT'] }
                    : item,
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

  it('does not expose automatic hearing advancement as a grantable permission', async () => {
    const body = {
      ...context,
      permissionCatalog: [
        ...context.permissionCatalog,
        {
          action: 'CASE_HEARING_AUTO_ADVANCED',
          label: '自动推进开庭后案件',
          scopes: ['DEPARTMENT'],
        },
      ],
    };
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

  it('creates and binds lawyer accounts using stable revisions', async () => {
    const lawyerAccount = {
      id: 'lawyer-account-1',
      displayName: '律师甲',
      username: 'lawyer.a',
      active: true,
      authorizationRevision: 3,
      profiles: [],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(lawyerAccount)))
      .mockResolvedValueOnce(new Response(JSON.stringify(lawyerAccount)));
    vi.stubGlobal('fetch', fetch);
    const create = Reflect.get(organizationApi, 'createLawyerAccount') as
      ((input: Record<string, unknown>) => Promise<unknown>) | undefined;
    const bind = Reflect.get(organizationApi, 'bindLawyerProfile') as
      | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    expect(create).toBeTypeOf('function');
    expect(bind).toBeTypeOf('function');
    if (!create || !bind) return;
    await create({
      fullName: '律师甲',
      username: 'lawyer.a',
      password: 'LongPassword123',
      lawFirm: '甲律所',
      phone: '13800000000',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/lawyer-accounts');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      fullName: '律师甲',
      username: 'lawyer.a',
      password: 'LongPassword123',
      lawFirm: '甲律所',
      phone: '13800000000',
    });
    await bind('lawyer-account-1', {
      profileId: 'profile-1',
      expectedAuthorizationRevision: 3,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      '/api/v1/lawyer-accounts/lawyer-account-1/bindings',
    );
  });

  it('loads the explicit unbound historical profile list', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              profileId: 'profile-1',
              fullName: '律师乙',
              lawFirm: '乙律所',
              phone: null,
              caseBusinessNos: ['CA-44'],
              historicalAssignmentCount: 2,
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const list = Reflect.get(organizationApi, 'listUnboundLawyerProfiles') as
      ((q: string) => Promise<unknown[]>) | undefined;
    expect(list).toBeTypeOf('function');
    if (!list) return;
    await expect(list('律师乙')).resolves.toHaveLength(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer-accounts/unbound-profiles?q=%E5%BE%8B%E5%B8%88%E4%B9%99',
    );
  });

  it('uses revision tokens for enable, disable and password reset without reading a password back', async () => {
    const result = {
      id: 'account-1',
      displayName: '律师甲',
      username: 'lawyer.a',
      active: false,
      authorizationRevision: 4,
      profiles: [],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(result)))
      .mockResolvedValueOnce(new Response(JSON.stringify(result)))
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    const setStatus = Reflect.get(organizationApi, 'setLawyerAccountStatus') as
      | ((id: string, active: boolean, revision: number) => Promise<unknown>)
      | undefined;
    const setBinding = Reflect.get(
      organizationApi,
      'setLawyerBindingStatus',
    ) as
      | ((
          id: string,
          bindingId: string,
          active: boolean,
          version: number,
        ) => Promise<unknown>)
      | undefined;
    const reset = Reflect.get(organizationApi, 'resetLawyerPassword') as
      | ((id: string, password: string, revision: number) => Promise<unknown>)
      | undefined;
    expect(setStatus).toBeTypeOf('function');
    expect(setBinding).toBeTypeOf('function');
    expect(reset).toBeTypeOf('function');
    if (!setStatus || !setBinding || !reset) return;
    await setStatus('account-1', false, 3);
    await setBinding('account-1', 'binding-1', false, 2);
    await reset('account-1', 'correct horse battery staple', 3);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      active: false,
      expectedAuthorizationRevision: 3,
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      active: false,
      expectedVersion: 2,
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      newPassword: 'correct horse battery staple',
      expectedAuthorizationRevision: 3,
    });

    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...result, password: 'must-not-be-returned' }),
      ),
    );
    await expect(setStatus('account-1', true, 4)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
