import 'reflect-metadata';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseListPreferenceController } from './case-list-preference.controller';
import { caseListColumns } from './case-list-preference.dto';
import { CaseListPreferenceService } from './case-list-preference.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('case list preference routes', () => {
  let app: INestApplication;
  const preferences = {
    get: jest
      .fn()
      .mockResolvedValue({ order: [...caseListColumns], hidden: [] }),
    put: jest
      .fn()
      .mockImplementation(
        async (_actor: unknown, _bucket: unknown, body: unknown) => body,
      ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseListPreferenceController],
      providers: [
        { provide: CaseListPreferenceService, useValue: preferences },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().actor = actor;
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('has exact GET and PUT paths with the expected response schema', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const path = document.paths['/api/v1/cases/list-preferences/{bucket}'];
    expect(path?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/CaseListPreferenceResponseDto',
          },
        },
      },
    });
    expect(path?.put?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/CaseListPreferenceResponseDto',
          },
        },
      },
    });
    await request(app.getHttpServer())
      .get('/api/v1/cases/list-preferences/all')
      .expect(200);
    expect(preferences.get).toHaveBeenCalledWith(actor, 'all');
    const body = { order: [...caseListColumns], hidden: ['court'] };
    await request(app.getHttpServer())
      .put('/api/v1/cases/list-preferences/WAITING_HEARING')
      .send(body)
      .expect(200, body);
    expect(preferences.put).toHaveBeenCalledWith(
      actor,
      'WAITING_HEARING',
      body,
    );
  });

  it('rejects unknown buckets and incomplete, duplicate, fixed or extra body fields', async () => {
    preferences.put.mockClear();
    const path = '/api/v1/cases/list-preferences/all';
    await request(app.getHttpServer())
      .get('/api/v1/cases/list-preferences/unknown')
      .expect(400);
    const valid = { order: [...caseListColumns], hidden: [] };
    const invalid = [
      { hidden: [] },
      { ...valid, order: ['stage', 'businessNo', ...caseListColumns.slice(2)] },
      {
        ...valid,
        order: [
          caseListColumns[0],
          caseListColumns[1],
          caseListColumns[2],
          caseListColumns[2],
          ...caseListColumns.slice(4),
        ],
      },
      { ...valid, hidden: ['businessNo'] },
      { ...valid, hidden: ['court', 'court'] },
      { ...valid, extra: true },
    ];
    for (const body of invalid)
      await request(app.getHttpServer()).put(path).send(body).expect(400);
    expect(preferences.put).not.toHaveBeenCalled();
  });
});
