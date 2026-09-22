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
  const copy = jest.fn();
  const update = jest.fn();
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
        { provide: RoleTemplateService, useValue: { getImpact, copy, update } },
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
      'MANAGEMENT_ACTION_FORBIDDEN',
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

  it('documents only internally assignable role Grant actions', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const actionSchema = document.components?.schemas?.RoleGrantInputDto as
      { properties?: { action?: { enum?: string[] } } } | undefined;

    expect(actionSchema?.properties?.action?.enum).toContain('LEAD_PUSH');
    expect(actionSchema?.properties?.action?.enum).toEqual(
      expect.not.arrayContaining(['CLIENT_LEAD_READ', 'CLIENT_LEAD_REVIEW']),
    );
  });

  it('validates and forwards a complete template copy command', async () => {
    copy.mockResolvedValueOnce({
      id: '44444444-4444-4444-8444-444444444444',
      name: '复制角色',
      version: 1,
      activeAssignmentCount: 0,
      grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
    });

    await request(app.getHttpServer())
      .post('/api/v1/organization/role-templates')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        sourceRoleTemplateId: roleId,
        name: ' 复制角色 ',
        grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
      })
      .expect(201);

    expect(copy).toHaveBeenCalledWith(actor, {
      sourceRoleTemplateId: roleId,
      name: '复制角色',
      grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
    });
  });

  it('rejects unknown actions and server-controlled copy fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/organization/role-templates')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        sourceRoleTemplateId: roleId,
        departmentId: actor.departmentId,
        name: '复制角色',
        grants: [{ action: 'MADE_UP_ACTION', scope: 'TEAM' }],
      })
      .expect(400);

    expect(copy).not.toHaveBeenCalled();
  });

  it.each(['CLIENT_LEAD_READ', 'CLIENT_LEAD_REVIEW'])(
    'rejects the client-only %s action before copying a role template',
    async (action) => {
      await request(app.getHttpServer())
        .post('/api/v1/organization/role-templates')
        .set('Authorization', 'Bearer allowed-token')
        .send({
          sourceRoleTemplateId: roleId,
          name: '复制角色',
          grants: [{ action, scope: 'DEPARTMENT' }],
        })
        .expect(400);

      expect(copy).not.toHaveBeenCalled();
    },
  );

  it('records a denied copy attempt', async () => {
    copy.mockRejectedValueOnce(
      new ForbiddenException({ code: 'ROLE_TEMPLATE_GRANT_NOT_COVERED' }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/organization/role-templates')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        sourceRoleTemplateId: roleId,
        name: '复制角色',
        grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
      })
      .expect(403);

    expect(recordDeniedAttempt).toHaveBeenCalledWith(
      actor,
      'role-template.copy',
      'ROLE_TEMPLATE_GRANT_NOT_COVERED',
    );
  });

  it('validates and forwards a versioned template update', async () => {
    update.mockResolvedValueOnce({
      id: roleId,
      name: '更新角色',
      version: 3,
      activeAssignmentCount: 1,
      grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/organization/role-templates/${roleId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({
        name: ' 更新角色 ',
        expectedVersion: 2,
        grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
      })
      .expect(200);

    expect(update).toHaveBeenCalledWith(actor, roleId, {
      name: '更新角色',
      expectedVersion: 2,
      grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
    });
  });

  it('rejects an invalid template version before update', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/organization/role-templates/${roleId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({
        name: '更新角色',
        expectedVersion: 0,
        grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
      })
      .expect(400);

    expect(update).not.toHaveBeenCalled();
  });

  it('records a denied update attempt', async () => {
    update.mockRejectedValueOnce(
      new ForbiddenException({ code: 'ROLE_TEMPLATE_GRANT_NOT_COVERED' }),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/organization/role-templates/${roleId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({
        name: '更新角色',
        expectedVersion: 2,
        grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
      })
      .expect(403);

    expect(recordDeniedAttempt).toHaveBeenCalledWith(
      actor,
      'role-template.update',
      'ROLE_TEMPLATE_GRANT_NOT_COVERED',
    );
  });
});
