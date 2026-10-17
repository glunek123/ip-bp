import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import type { ActorContext } from '../../access-control/actor-context';
import { IDENTITY_ADAPTER } from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import type { SessionAuthentication } from '../../auth/authenticated-session';
import { configureApp } from '../../common/configure-app';
import {
  ExecutionSupplementUploadController,
  LawyerExecutionSupplementUploadController,
} from './execution-supplement-upload.controller';
import { MaterialService } from './material.service';
import { MaterialModule } from './material.module';

const caseId = '10000000-0000-4000-8000-000000000001';
const filingId = '10000000-0000-4000-8000-000000000002';
const supplementId = '10000000-0000-4000-8000-000000000003';
const actor = {
  userId: caseId,
  departmentId: filingId,
  authorizationRevision: 1,
};
const lawyer = { ...actor, lawyerAccountId: actor.userId };
const identities = new Map<string, ActorContext>([
  ['allowed', actor],
  ['lawyer', lawyer],
  ['client', { ...actor, clientCustomerId: supplementId }],
  ['notary', { ...actor, notaryOfficeId: supplementId }],
  ['mismatched-lawyer', { ...actor, lawyerAccountId: supplementId }],
  ['lawyer-client', { ...lawyer, clientCustomerId: supplementId }],
  ['lawyer-notary', { ...lawyer, notaryOfficeId: supplementId }],
  ['empty-client', { ...actor, clientCustomerId: '' }],
  ['empty-notary', { ...actor, notaryOfficeId: '' }],
]);
const sessionAuthentication: SessionAuthentication = {
  kind: 'session',
  sessionId: supplementId,
  csrfDigest: 'test-only-digest',
};
const auth = {
  resolveSession: jest.fn(async (token: string) => {
    const identity = identities.get(token);
    return identity
      ? { actor: identity, authentication: sessionAuthentication }
      : null;
  }),
  verifyCsrf: jest.fn(
    (_authentication: SessionAuthentication, value: string) =>
      value === 'valid-csrf',
  ),
};
const body = {
  expectedRevision: 0,
  originalFilename: '补交.pdf',
  declaredMimeType: 'application/pdf',
};
const draftResult = {
  id: supplementId,
  ownerType: 'CASE',
  ownerId: caseId,
  category: 'EXECUTION_SUPPLEMENT',
  purpose: 'EXECUTION_SUPPLEMENT',
  originalFilename: body.originalFilename,
  declaredMimeType: body.declaredMimeType,
  expiresAt: '2026-10-18T00:00:00.000Z',
  executionSupplement: { filingId, supplementId, expectedRevision: 0 },
};
describe('execution supplement controlled upload route', () => {
  let app: INestApplication;
  const create = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ExecutionSupplementUploadController,
        LawyerExecutionSupplementUploadController,
      ],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: auth },
        {
          provide: IDENTITY_ADAPTER,
          useValue: {
            resolve: jest.fn(
              async (token: string) => identities.get(token) ?? null,
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
    create.mockResolvedValue(draftResult);
  });
  it.each([
    ['cases', 'allowed', actor],
    ['lawyer/cases', 'lawyer', lawyer],
  ] as const)(
    'binds %s upload to the precise nested target with metadata only',
    async (prefix, token, identity) => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/${prefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201)
        .expect(draftResult);
      expect(create).toHaveBeenCalledWith(
        identity,
        caseId,
        { filingId, supplementId, expectedRevision: 0 },
        body,
      );
    },
  );
  describe.each([
    [
      'cases',
      [
        'lawyer',
        'client',
        'notary',
        'mismatched-lawyer',
        'lawyer-client',
        'lawyer-notary',
        'empty-client',
        'empty-notary',
      ],
    ],
    [
      'lawyer/cases',
      [
        'allowed',
        'client',
        'notary',
        'mismatched-lawyer',
        'lawyer-client',
        'lawyer-notary',
        'empty-client',
        'empty-notary',
      ],
    ],
  ] as const)('%s principal boundary', (prefix, tokens) => {
    it.each(tokens)(
      'rejects %s before target/version selection or draft creation',
      async (token) => {
        const response = await request(app.getHttpServer())
          .post(
            `/api/v1/${prefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(403);
        expect(response.body).toMatchObject({ code: 'ACTION_FORBIDDEN' });
        expect(create).not.toHaveBeenCalled();
      },
    );
  });
  it.each([
    ['cases', 'lawyer/cases', 'allowed'],
    ['lawyer/cases', 'cases', 'lawyer'],
  ] as const)(
    'rejects reusing an existing %s upload target through the wrong %s portal',
    async (legalPrefix, wrongPrefix, token) => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/${legalPrefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      create.mockClear();
      await request(app.getHttpServer())
        .post(
          `/api/v1/${wrongPrefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(403);
      expect(create).not.toHaveBeenCalled();
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
  it.each([
    ['cases', 'lawyer/cases', 'allowed'],
    ['lawyer/cases', 'cases', 'lawyer'],
  ] as const)(
    'checks a resolved %s session through the wrong %s upload portal after valid CSRF',
    async (legalPrefix, wrongPrefix, token) => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/${legalPrefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
        )
        .set('Cookie', `dev_cor_session=${token}`)
        .set('X-CSRF-Token', 'valid-csrf')
        .send(body)
        .expect(201)
        .expect(draftResult);
      create.mockClear();
      const forbidden = await request(app.getHttpServer())
        .post(
          `/api/v1/${wrongPrefix}/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
        )
        .set('Cookie', `dev_cor_session=${token}`)
        .set('X-CSRF-Token', 'valid-csrf')
        .send(body)
        .expect(403);
      expect(forbidden.body).toMatchObject({ code: 'ACTION_FORBIDDEN' });
      expect(auth.resolveSession).toHaveBeenCalledTimes(2);
      expect(auth.verifyCsrf).toHaveBeenCalledTimes(2);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('retains session CSRF rejection before legitimate upload target selection', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/cases/${caseId}/execution-filings/${filingId}/supplements/${supplementId}/upload-drafts`,
      )
      .set('Cookie', 'dev_cor_session=allowed')
      .set('X-CSRF-Token', 'invalid-csrf')
      .send(body)
      .expect(403);
    expect(response.body).toMatchObject({ code: 'CSRF_INVALID' });
    expect(create).not.toHaveBeenCalled();
  });
  it('publishes the same strict body for both paths and exact structured result', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(doc.paths)).toHaveLength(2);
    expect(
      new Set(Object.values(doc.paths).map((item) => item.post?.operationId))
        .size,
    ).toBe(2);
    for (const prefix of ['cases', 'lawyer/cases']) {
      const operation =
        doc.paths[
          `/api/v1/${prefix}/{id}/execution-filings/{filingId}/supplements/{supplementId}/upload-drafts`
        ]?.post;
      expect(operation?.operationId).toBe(
        `${prefix === 'cases' ? 'ExecutionSupplementUploadController' : 'LawyerExecutionSupplementUploadController'}_create`,
      );
      expect(operation?.responses['201']).toBeDefined();
    }
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
  it('registers both explicit portal controllers in MaterialModule', () => {
    const controllers: unknown = Reflect.getMetadata(
      'controllers',
      MaterialModule,
    );
    expect(controllers).toEqual(
      expect.arrayContaining([
        ExecutionSupplementUploadController,
        LawyerExecutionSupplementUploadController,
      ]),
    );
  });
});
