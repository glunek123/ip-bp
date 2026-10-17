import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { IDENTITY_ADAPTER } from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import { configureApp } from '../../common/configure-app';
import { CaseSectionRecordUploadController } from './case-section-record-upload.controller';
import { MaterialService } from './material.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';
const anchorId = '55555555-5555-4555-8555-555555555555';
const routes = [
  {
    path: 'execution-mailing-correction',
    kind: 'EXECUTION_MAILING',
    body: { mailingId: targetId, expectedMailingRevision: 0 },
    target: {},
  },
  {
    path: 'execution-filing-correction',
    kind: 'EXECUTION_FILING',
    body: { filingId: targetId, expectedFilingRevision: 0 },
    target: {},
  },
  {
    path: 'execution-finish-correction',
    kind: 'EXECUTION_FINISH',
    body: { finishId: targetId, expectedFinishRevision: 0 },
    target: {},
  },
  {
    path: 'judgment-record-correction',
    kind: 'JUDGMENT',
    body: {
      judgmentId: targetId,
      expectedJudgmentRevision: 0,
      trialRoundId: anchorId,
    },
    target: { trialRoundId: anchorId },
  },
  {
    path: 'closure-record-correction',
    kind: 'CLOSURE',
    body: {
      closureId: targetId,
      expectedClosureRevision: 0,
      expectedClosureVersionId: anchorId,
    },
    target: { expectedClosureVersionId: anchorId },
  },
] as const;

describe('CaseSectionRecordUploadController', () => {
  const create = jest.fn();
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseSectionRecordUploadController],
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
          useValue: { createCaseSectionRecordUploadDraft: create },
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
    create.mockResolvedValue({ id: targetId });
  });
  it.each(routes)(
    'binds $kind to its fixed route and typed target',
    async (route) => {
      const file = {
        originalFilename: '更正.pdf',
        declaredMimeType: 'application/pdf',
      };
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${caseId}/${route.path}/upload-drafts`)
        .set('Authorization', 'Bearer allowed')
        .send({ ...route.body, ...file })
        .expect(201);
      expect(create).toHaveBeenCalledWith(
        actor,
        caseId,
        { kind: route.kind, targetId, expectedRevision: 0, ...route.target },
        { ...route.body, ...file },
      );
    },
  );
  it.each(routes)(
    'rejects forged context/owner/category/permission fields for $kind',
    async (route) => {
      for (const field of [
        'recordCorrection',
        'kind',
        'ownerType',
        'ownerId',
        'category',
        'purpose',
        'departmentId',
        'canEdit',
      ]) {
        await request(app.getHttpServer())
          .post(`/api/v1/cases/${caseId}/${route.path}/upload-drafts`)
          .set('Authorization', 'Bearer allowed')
          .send({
            ...route.body,
            originalFilename: '更正.pdf',
            declaredMimeType: 'application/pdf',
            [field]: 'forged',
          })
          .expect(400);
      }
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('rejects string revisions, missing closure anchor and unauthenticated calls', async () => {
    const url = `/api/v1/cases/${caseId}/closure-record-correction/upload-drafts`;
    const body = {
      ...routes[4].body,
      originalFilename: '更正.pdf',
      declaredMimeType: 'application/pdf',
    };
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer allowed')
      .send({ ...body, expectedClosureRevision: '0' })
      .expect(400);
    const { expectedClosureVersionId: _anchor, ...missing } = body;
    void _anchor;
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer allowed')
      .send(missing)
      .expect(400);
    await request(app.getHttpServer()).post(url).send(body).expect(401);
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    '33333333-3333-1333-8333-333333333333',
    '33333333-3333-7333-8333-333333333333',
  ])('rejects non-v4 case identity %s', async (id) => {
    await request(app.getHttpServer())
      .post(`/api/v1/cases/${id}/execution-mailing-correction/upload-drafts`)
      .set('Authorization', 'Bearer allowed')
      .send({
        ...routes[0].body,
        originalFilename: '更正.pdf',
        declaredMimeType: 'application/pdf',
      })
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('publishes five distinct upload schemas without a hearing route', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const paths = Object.keys(document.paths).filter((path) =>
      path.endsWith('/upload-drafts'),
    );
    expect(paths).toHaveLength(5);
    expect(paths.some((path) => path.includes('hearing'))).toBe(false);
    for (const path of paths)
      expect(document.paths[path]?.post?.responses['201']).toBeDefined();
    const closure = document.components?.schemas?.CreateClosureRecordUploadDto;
    expect(closure).toMatchObject({
      required: expect.arrayContaining([
        'closureId',
        'expectedClosureRevision',
        'expectedClosureVersionId',
        'originalFilename',
        'declaredMimeType',
      ]),
    });
  });
});
