import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseBatchArchiveController } from './case-batch-archive.controller';
import { CaseBatchArchiveService } from './case-batch-archive.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
describe('case batch archive HTTP contract', () => {
  let app: INestApplication;
  const archive = jest.fn().mockResolvedValue({ items: [] });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseBatchArchiveController],
      providers: [{ provide: CaseBatchArchiveService, useValue: { archive } }],
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
  beforeEach(() => archive.mockClear());
  it('accepts complete items and rejects duplicates before the service', async () => {
    const id = actor.userId;
    const body = {
      idempotencyKey: 'batch',
      archiveAt: '2026-01-01',
      reason: '结束',
      items: [{ id, expectedVersion: 1 }],
    };
    await request(app.getHttpServer())
      .post('/api/v1/cases/early-archive-batches')
      .send(body)
      .expect(200);
    expect(archive).toHaveBeenCalledTimes(1);
    for (const changed of [
      { ...body, items: [body.items[0], body.items[0]] },
      { ...body, extra: true },
      { ...body, items: [] },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/cases/early-archive-batches')
        .send(changed)
        .expect(400);
    expect(archive).toHaveBeenCalledTimes(1);
  });
});
