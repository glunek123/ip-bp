import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { configureApp } from '../common/configure-app';
import { ActorContextGuard } from './actor-context.guard';
import { IDENTITY_ADAPTER, IdentityAdapter } from './identity.adapter';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};

describe('OrganizationController', () => {
  const managementContext = {
    capabilities: {
      createUser: true,
      manageUsers: true,
      createTeam: true,
      manageTeams: true,
      assignDepartmentRoles: true,
      assignTeamRoles: false,
    },
    users: [],
    teams: [],
    roles: [],
  };
  const getManagementContext = jest.fn();
  const createUser = jest.fn();
  const setUserStatus = jest.fn();
  const resetUserPassword = jest.fn();
  const updateMembership = jest.fn();
  const assignRole = jest.fn();
  const setRoleAssignmentStatus = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed-token' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: OrganizationService,
          useValue: {
            getManagementContext,
            createUser,
            setUserStatus,
            resetUserPassword,
            updateMembership,
            assignRole,
            setRoleAssignmentStatus,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without a trusted identity', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/organization/management-context')
      .expect(401);
    expect(getManagementContext).not.toHaveBeenCalled();
  });

  it('forwards the trusted actor to the management context query', async () => {
    getManagementContext.mockResolvedValueOnce(managementContext);

    await request(app.getHttpServer())
      .get('/api/v1/organization/management-context')
      .set('Authorization', 'Bearer allowed-token')
      .expect(200)
      .expect(managementContext);

    expect(getManagementContext).toHaveBeenCalledWith(actor);
  });

  it('validates and creates a person for the trusted actor', async () => {
    createUser.mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333',
      displayName: '运营乙',
      username: 'operator.b',
    });

    await request(app.getHttpServer())
      .post('/api/v1/organization/users')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        displayName: ' 运营乙 ',
        username: ' Operator.B ',
        password: 'temporary-pass-123',
        teamId: null,
        roleTemplateId: '44444444-4444-4444-8444-444444444444',
      })
      .expect(201)
      .expect({
        id: '33333333-3333-4333-8333-333333333333',
        displayName: '运营乙',
        username: 'operator.b',
      });

    expect(createUser).toHaveBeenCalledWith(actor, {
      displayName: '运营乙',
      username: 'Operator.B',
      password: 'temporary-pass-123',
      teamId: null,
      roleTemplateId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('rejects invalid and server-controlled person fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/organization/users')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        displayName: '运营乙',
        username: 'operator.b',
        password: 'short',
        roleTemplateId: 'not-a-uuid',
        departmentId: actor.departmentId,
      })
      .expect(400);

    expect(createUser).not.toHaveBeenCalled();
  });

  it('updates account status with a reason', async () => {
    setUserStatus.mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333',
      active: false,
    });

    await request(app.getHttpServer())
      .patch(
        '/api/v1/organization/users/33333333-3333-4333-8333-333333333333/status',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({ active: false, reason: ' 离职停用 ' })
      .expect(200);

    expect(setUserStatus).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      { active: false, reason: '离职停用' },
    );
  });

  it('resets a target password without returning password material', async () => {
    resetUserPassword.mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333',
      passwordReset: true,
    });

    await request(app.getHttpServer())
      .post(
        '/api/v1/organization/users/33333333-3333-4333-8333-333333333333/password-reset',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({
        currentPassword: 'administrator-pass-123',
        newPassword: 'replacement-pass-123',
        reason: ' 本人无法登录 ',
      })
      .expect(200)
      .expect({
        id: '33333333-3333-4333-8333-333333333333',
        passwordReset: true,
      });

    expect(resetUserPassword).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      {
        currentPassword: 'administrator-pass-123',
        newPassword: 'replacement-pass-123',
        reason: '本人无法登录',
      },
    );
  });

  it('updates membership and role status through validated UUID routes', async () => {
    updateMembership.mockResolvedValueOnce({
      id: 'membership-target',
      active: false,
    });
    setRoleAssignmentStatus.mockResolvedValueOnce({
      id: '44444444-4444-4444-8444-444444444444',
      active: false,
    });

    await request(app.getHttpServer())
      .patch(
        '/api/v1/organization/users/33333333-3333-4333-8333-333333333333/membership',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({ active: false, reason: ' 调离部门 ' })
      .expect(200);
    expect(updateMembership).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      { active: false, reason: '调离部门' },
    );

    await request(app.getHttpServer())
      .patch(
        '/api/v1/organization/users/33333333-3333-4333-8333-333333333333/role-assignments/44444444-4444-4444-8444-444444444444',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({ active: false, reason: ' 撤销权限 ' })
      .expect(200);
    expect(setRoleAssignmentStatus).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      { active: false, reason: '撤销权限' },
    );
  });
});
