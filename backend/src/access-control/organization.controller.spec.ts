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
        { provide: OrganizationService, useValue: { getManagementContext } },
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
});
