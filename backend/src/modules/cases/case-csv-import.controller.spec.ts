import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseCsvImportController } from './case-csv-import.controller';
import { CaseCsvImportService } from './case-csv-import.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
describe('case CSV HTTP contract', () => {
  let app: INestApplication;
  const preview = jest
    .fn()
    .mockResolvedValue({ rows: [], validCount: 0, errorCount: 0 });
  const commit = jest.fn().mockResolvedValue({ items: [] });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseCsvImportController],
      providers: [
        {
          provide: CaseCsvImportService,
          useValue: { template: () => '\uFEFF"外录类型"\r\n', preview, commit },
        },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { actor?: typeof actor } };
        }) => {
          context.switchToHttp().getRequest().actor = actor;
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    preview.mockClear();
    commit.mockClear();
  });
  it('returns a CSV template and validates preview/commit request shapes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/cases/csv-import/template')
      .expect(200)
      .expect('Content-Type', /text\/csv/u);
    await request(app.getHttpServer())
      .post('/api/v1/cases/csv-import/preview')
      .send({ csvBase64: 'YQ==' })
      .expect(200);
    expect(preview).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .post('/api/v1/cases/csv-import/commit')
      .send({
        csvBase64: 'YQ==',
        idempotencyKey: 'batch',
        rowNumbers: [2],
        duplicateConfirmations: [],
      })
      .expect(200);
    expect(commit).toHaveBeenCalledTimes(1);
    for (const body of [
      {
        csvBase64: 'YQ==',
        idempotencyKey: 'batch',
        rowNumbers: [2, 2],
        duplicateConfirmations: [],
      },
      {
        csvBase64: 'YQ==',
        idempotencyKey: 'batch',
        rowNumbers: [],
        duplicateConfirmations: [],
      },
      {
        csvBase64: 'YQ==',
        idempotencyKey: 'batch',
        rowNumbers: [2],
        duplicateConfirmations: [],
        extra: true,
      },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/cases/csv-import/commit')
        .send(body)
        .expect(400);
  });
});
