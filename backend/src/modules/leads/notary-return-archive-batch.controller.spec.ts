import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { NotaryReturnArchiveBatchController } from './notary-return-archive-batch.controller';
import { NotaryReturnArchiveBatchService } from './notary-return-archive-batch.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const id = '33333333-3333-4333-8333-333333333333';
const input = {
  items: [
    {
      matterId: id,
      returnChoice: 'KEEP',
      archiveReason: '保留',
      expectedVersion: 5,
    },
  ],
};

describe('notary return archive batch HTTP contract', () => {
  const archive = jest.fn().mockResolvedValue({ batchId: id, items: [] });
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotaryReturnArchiveBatchController],
      providers: [
        { provide: NotaryReturnArchiveBatchService, useValue: { archive } },
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
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('routes the explicit batch and key to the service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notary-matters/return-archive-batches')
      .set('Idempotency-Key', 'key')
      .send(input)
      .expect(201)
      .expect({ batchId: id, items: [] });
    expect(archive).toHaveBeenCalledWith(actor, 'key', input);
  });

  it('rejects missing items, unknown fields and invalid nested input', async () => {
    for (const body of [
      {},
      { items: [] },
      { ...input, unknown: 1 },
      { items: [{ ...input.items[0], unknown: 1 }] },
      { items: [{ ...input.items[0], expectedVersion: 0 }] },
      { items: [{ ...input.items[0], matterId: 'bad' }] },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/notary-matters/return-archive-batches')
        .set('Idempotency-Key', 'key')
        .send(body)
        .expect(400);
    expect(archive).not.toHaveBeenCalled();
  });

  it('requires a valid Idempotency-Key header', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notary-matters/return-archive-batches')
      .send(input)
      .expect(400);
    expect(archive).not.toHaveBeenCalled();
  });
});
