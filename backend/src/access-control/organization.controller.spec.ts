import 'reflect-metadata';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  const createTeam = jest.fn();
  const setTeamStatus = jest.fn();
  const recordDeniedAttempt = jest.fn();
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
            createTeam,
            setTeamStatus,
            recordDeniedAttempt,
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

  it('documents successful JSON responses for every organization endpoint', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const responses = [
      ['GET', '/api/v1/organization/management-context', '200'],
      ['POST', '/api/v1/organization/users', '201'],
      ['PATCH', '/api/v1/organization/users/{userId}/status', '200'],
      ['POST', '/api/v1/organization/users/{userId}/password-reset', '200'],
      ['PATCH', '/api/v1/organization/users/{userId}/membership', '200'],
      ['POST', '/api/v1/organization/users/{userId}/role-assignments', '201'],
      [
        'PATCH',
        '/api/v1/organization/users/{userId}/role-assignments/{assignmentId}',
        '200',
      ],
      ['POST', '/api/v1/organization/teams', '201'],
      ['PATCH', '/api/v1/organization/teams/{teamId}/status', '200'],
    ] as const;

    for (const [method, path, status] of responses) {
      const operation = document.paths[path]?.[method.toLowerCase() as 'get'];
      const response = operation?.responses[status];
      expect(response).toBeDefined();
      expect(response !== undefined && 'content' in response).toBe(true);
      if (response !== undefined && 'content' in response) {
        expect(response.content?.['application/json']?.schema).toEqual({
          $ref: expect.stringMatching(/^#\/components\/schemas\//),
        });
      }
    }
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
      .send({ active: false })
      .expect(200);

    expect(setUserStatus).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      { active: false },
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
        newPassword: 'replacement-pass-123',
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
        newPassword: 'replacement-pass-123',
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
      .send({ active: false })
      .expect(200);
    expect(updateMembership).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      { active: false },
    );

    await request(app.getHttpServer())
      .patch(
        '/api/v1/organization/users/33333333-3333-4333-8333-333333333333/role-assignments/44444444-4444-4444-8444-444444444444',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({ active: false })
      .expect(200);
    expect(setRoleAssignmentStatus).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      { active: false },
    );
  });

  it('creates and inactivates a Team through validated routes', async () => {
    createTeam.mockResolvedValueOnce({
      id: '55555555-5555-4555-8555-555555555555',
      name: '团队甲',
      status: 'ACTIVE',
    });
    setTeamStatus.mockResolvedValueOnce({
      id: '55555555-5555-4555-8555-555555555555',
      name: '团队甲',
      status: 'INACTIVE',
    });

    await request(app.getHttpServer())
      .post('/api/v1/organization/teams')
      .set('Authorization', 'Bearer allowed-token')
      .send({ name: ' 团队甲 ' })
      .expect(201);
    expect(createTeam).toHaveBeenCalledWith(actor, { name: '团队甲' });

    await request(app.getHttpServer())
      .patch(
        '/api/v1/organization/teams/55555555-5555-4555-8555-555555555555/status',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect(setTeamStatus).toHaveBeenCalledWith(
      actor,
      '55555555-5555-4555-8555-555555555555',
      'INACTIVE',
    );
  });

  it('persists a sanitized denial audit before returning forbidden', async () => {
    setUserStatus.mockRejectedValueOnce(
      new ForbiddenException({ code: 'FORBIDDEN', message: '无权执行该操作' }),
    );
    recordDeniedAttempt.mockResolvedValueOnce(undefined);

    await request(app.getHttpServer())
      .patch(
        '/api/v1/organization/users/33333333-3333-4333-8333-333333333333/status',
      )
      .set('Authorization', 'Bearer allowed-token')
      .send({ active: false })
      .expect(403);

    expect(recordDeniedAttempt).toHaveBeenCalledWith(actor, 'user.status');
  });
});
