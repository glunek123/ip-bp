import 'reflect-metadata';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { configureApp } from '../common/configure-app';
import { ActorContextGuard } from './actor-context.guard';
import { IDENTITY_ADAPTER, IdentityAdapter } from './identity.adapter';
import { OrganizationService } from './organization.service';
import { RoleTemplateController } from './role-template.controller';
import { RoleTemplateService } from './role-template.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const roleId = '33333333-3333-4333-8333-333333333333';

describe('RoleTemplateController', () => {
  const getImpact = jest.fn();
  const recordDeniedAttempt = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed-token' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [RoleTemplateController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        { provide: IDENTITY_ADAPTER, useValue: identity },
        { provide: RoleTemplateService, useValue: { getImpact } },
        {
          provide: OrganizationService,
          useValue: { recordDeniedAttempt },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('returns the authorized impact preview', async () => {
    const impact = {
      roleTemplateId: roleId,
      version: 2,
      activeAssignmentCount: 1,
      affectedUsers: [{ id: actor.userId, displayName: '运营甲' }],
    };
    getImpact.mockResolvedValueOnce(impact);

    await request(app.getHttpServer())
      .get(`/api/v1/organization/role-templates/${roleId}/impact`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(200)
      .expect(impact);

    expect(getImpact).toHaveBeenCalledWith(actor, roleId);
  });

  it('validates the role template UUID before calling the service', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/organization/role-templates/not-a-uuid/impact')
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);

    expect(getImpact).not.toHaveBeenCalled();
  });

  it('records a denied preview without exposing the target', async () => {
    getImpact.mockRejectedValueOnce(
      new ForbiddenException({ code: 'MANAGEMENT_ACTION_FORBIDDEN' }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/organization/role-templates/${roleId}/impact`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(403);

    expect(recordDeniedAttempt).toHaveBeenCalledWith(
      actor,
      'role-template.impact',
    );
  });

  it('documents the impact JSON response', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const response =
      document.paths[
        '/api/v1/organization/role-templates/{roleTemplateId}/impact'
      ]?.get?.responses['200'];

    expect(response).toBeDefined();
    expect(response !== undefined && 'content' in response).toBe(true);
  });
});
