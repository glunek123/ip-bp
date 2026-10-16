import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { IDENTITY_ADAPTER } from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import { configureApp } from '../../common/configure-app';
import { ExecutionSupplementUploadController } from './execution-supplement-upload.controller';
import { MaterialService } from './material.service';

const caseId = '10000000-0000-4000-8000-000000000001';
const filingId = '10000000-0000-4000-8000-000000000002';
const supplementId = '10000000-0000-4000-8000-000000000003';
const actor = {
  userId: caseId,
  departmentId: filingId,
  authorizationRevision: 1,
};
const body = {
  expectedRevision: 0,
  originalFilename: '补交.pdf',
  declaredMimeType: 'application/pdf',
};
describe('execution supplement controlled upload route', () => {
  let app: INestApplication;
  const create = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExecutionSupplementUploadController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        {
          provide: IDENTITY_ADAPTER,
          useValue: {
            resolve: jest.fn(async (token: string) =>
              token === 'allowed' ? actor : null,
            ),
          },
        },
        {
          provide: MaterialService,
          useValue: { createExecutionSupplementUploadDraft: create },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: supplementId });
  });
  it.each(['cases', 'lawyer/cases'])(
    'binds %s upload to the precise nested target with metadata only',
    async (prefix) => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/${prefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
        )
        .set('Authorization', 'Bearer allowed')
        .send(body)
        .expect(201);
      expect(create).toHaveBeenCalledWith(
        actor,
        caseId,
        { filingId, supplementId, expectedRevision: 0 },
        body,
      );
    },
  );
  it.each([
    'filingId',
    'supplementId',
    'ownerType',
    'ownerId',
    'category',
    'purpose',
    'departmentId',
    'actorUserId',
  ])('rejects body override %s', async (field) => {
    await request(app.getHttpServer())
      .post(
        `/api/v1/cases/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
      )
      .set('Authorization', 'Bearer allowed')
      .send({ ...body, [field]: supplementId })
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects invalid target identity, noninteger revision and unauthenticated upload', async () => {
    const url = `/api/v1/cases/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`;
    await request(app.getHttpServer())
      .post(url.replace(supplementId, 'bad'))
      .set('Authorization', 'Bearer allowed')
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer allowed')
      .send({ ...body, expectedRevision: '0' })
      .expect(400);
    await request(app.getHttpServer()).post(url).send(body).expect(401);
    expect(create).not.toHaveBeenCalled();
  });
  it('publishes the same strict body for both paths and exact structured result', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(doc.paths)).toHaveLength(2);
    const schema = doc.components?.schemas?.CreateExecutionSupplementUploadDto;
    expect(schema).toMatchObject({
      required: ['expectedRevision', 'originalFilename', 'declaredMimeType'],
    });
    expect(
      doc.components?.schemas?.ExecutionSupplementUploadDraftResultDto,
    ).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'ownerType',
        'ownerId',
        'category',
        'purpose',
        'expiresAt',
        'executionSupplement',
      ]),
    });
  });
});
