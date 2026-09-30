import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { NotaryListExportController } from './notary-list-export.controller';
import {
  GenerateNotaryListExportDto,
  PreviewNotaryListExportDto,
} from './notary-list-export.dto';
import { NotaryListExportService } from './notary-list-export.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = '33333333-3333-4333-8333-333333333333';

describe('notary list export HTTP contract', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const preview = jest.fn().mockResolvedValue({ count: 1, maxRows: 1000 });
  const generate = jest
    .fn()
    .mockResolvedValue({ csv: '\uFEFFheader\r\nrow\r\n' });
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotaryListExportController],
      providers: [
        {
          provide: NotaryListExportService,
          useValue: { preview, export: generate },
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
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('rejects duplicate, unknown and mixed fields in both DTOs', async () => {
    for (const [metatype, valid] of [
      [PreviewNotaryListExportDto, { mode: 'SELECTED', matterIds: [matterId] }],
      [
        GenerateNotaryListExportDto,
        { mode: 'SELECTED', matterIds: [matterId], expectedCount: 1 },
      ],
    ] as const) {
      await expect(
        pipe.transform(valid, { type: 'body', metatype }),
      ).resolves.toMatchObject(valid);
      for (const invalid of [
        { ...valid, matterIds: [matterId, matterId] },
        { ...valid, stage: 'ARCHIVED' },
        { ...valid, unexpected: 1 },
        { ...valid, matterIds: ['unknown'] },
      ])
        await expect(
          pipe.transform(invalid, { type: 'body', metatype }),
        ).rejects.toBeDefined();
    }
    await expect(
      pipe.transform(
        { mode: 'FILTERED', matterIds: [matterId] },
        { type: 'body', metatype: PreviewNotaryListExportDto },
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { mode: 'FILTERED', expectedCount: 1 },
        { type: 'body', metatype: PreviewNotaryListExportDto },
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { mode: 'SELECTED', matterIds: [matterId] },
        { type: 'body', metatype: GenerateNotaryListExportDto },
      ),
    ).rejects.toBeDefined();
  });

  it('returns preview JSON and a completed CSV attachment', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notary-matters/exports/preview')
      .send({ mode: 'SELECTED', matterIds: [matterId] })
      .expect(200)
      .expect({ count: 1, maxRows: 1000 });
    expect(preview).toHaveBeenCalledWith(actor, {
      mode: 'SELECTED',
      matterIds: [matterId],
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/notary-matters/exports')
      .send({ mode: 'SELECTED', matterIds: [matterId], expectedCount: 1 })
      .expect(200);
    expect(response.headers['content-type']).toMatch(
      /^text\/csv; charset=utf-8/u,
    );
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename=/u,
    );
    expect(response.text).toBe('\uFEFFheader\r\nrow\r\n');
    expect(generate).toHaveBeenCalledWith(actor, {
      mode: 'SELECTED',
      matterIds: [matterId],
      expectedCount: 1,
    });
  });

  it('does not send an attachment if the service transaction fails', async () => {
    generate.mockRejectedValueOnce(new Error('audit failed'));
    const response = await request(app.getHttpServer())
      .post('/api/v1/notary-matters/exports')
      .send({ mode: 'SELECTED', matterIds: [matterId], expectedCount: 1 })
      .expect(500);
    expect(response.headers['content-disposition']).toBeUndefined();
  });
});
