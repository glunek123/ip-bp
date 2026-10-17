import { INestApplication, ForbiddenException } from '@nestjs/common';
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
  CaseExecutionFilingFollowupController,
  LawyerCaseExecutionFilingFollowupController,
} from './case-execution-filing-followup.controller';
import { CaseExecutionFilingFollowupService } from './case-execution-filing-followup.service';
import { CaseModule } from './case.module';

const caseId = '10000000-0000-4000-8000-000000000001';
const filingId = '10000000-0000-4000-8000-000000000002';
const targetId = '10000000-0000-4000-8000-000000000003';
const actor = {
  userId: caseId,
  departmentId: filingId,
  authorizationRevision: 1,
};
const lawyer = { ...actor, lawyerAccountId: actor.userId };
const identities = new Map<string, ActorContext>([
  ['internal', actor],
  ['lawyer', lawyer],
  ['client', { ...actor, clientCustomerId: targetId }],
  ['notary', { ...actor, notaryOfficeId: targetId }],
  ['mismatched-lawyer', { ...actor, lawyerAccountId: targetId }],
  ['lawyer-client', { ...lawyer, clientCustomerId: targetId }],
  ['lawyer-notary', { ...lawyer, notaryOfficeId: targetId }],
  ['empty-client', { ...actor, clientCustomerId: '' }],
  ['empty-notary', { ...actor, notaryOfficeId: '' }],
]);
const sessionAuthentication: SessionAuthentication = {
  kind: 'session',
  sessionId: targetId,
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
const feedback = {
  idempotencyKey: 'original-key',
  feedbackOn: null,
  courtCaseNo: null,
  content: '法院真实反馈',
};
const supplement = {
  idempotencyKey: 'original-key',
  submittedOn: null,
  note: null,
  contentVersionIds: [targetId],
};
const routes = [
  {
    method: 'recordFeedback',
    path: 'feedbacks',
    body: { ...feedback, feedbackId: targetId, expectedRevision: 0 },
    anchors: { filingId },
  },
  {
    method: 'correctFeedback',
    path: `feedbacks/${targetId}/corrections`,
    body: { ...feedback, expectedRevision: 1, correctionReason: '更正登记' },
    anchors: { filingId, feedbackId: targetId },
  },
  {
    method: 'submitSupplement',
    path: 'supplements',
    body: { ...supplement, supplementId: targetId, expectedRevision: 0 },
    anchors: { filingId },
  },
  {
    method: 'correctSupplement',
    path: `supplements/${targetId}/corrections`,
    body: { ...supplement, expectedRevision: 1, correctionReason: '更正材料' },
    anchors: { filingId, supplementId: targetId },
  },
] as const;

function resultFor(route: (typeof routes)[number]) {
  const common = {
    id:
      route.body.expectedRevision === 0
        ? targetId
        : '10000000-0000-4000-8000-000000000004',
    filingId,
    revision: route.body.expectedRevision + 1,
    recordedAt: '2026-10-16T00:00:00.000Z',
  };
  return route.method.includes('Feedback')
    ? { ...common, feedbackId: targetId }
    : { ...common, supplementId: targetId };
}

describe('execution filing followup HTTP contract', () => {
  let app: INestApplication;
  const commands = {
    recordFeedback: jest.fn(),
    correctFeedback: jest.fn(),
    submitSupplement: jest.fn(),
    correctSupplement: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        CaseExecutionFilingFollowupController,
        LawyerCaseExecutionFilingFollowupController,
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
        { provide: CaseExecutionFilingFollowupService, useValue: commands },
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
    for (const route of routes)
      commands[route.method].mockResolvedValue(resultFor(route));
  });
  describe.each([
    ['cases', 'internal', actor],
    ['lawyer/cases', 'lawyer', lawyer],
  ] as const)('%s', (prefix, token, identity) => {
    it.each(routes)(
      'binds $method to exact route anchors and returns 201',
      async (route) => {
        await request(app.getHttpServer())
          .post(
            `/api/v1/${prefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send(route.body)
          .expect(201)
          .expect(resultFor(route));
        expect(commands[route.method]).toHaveBeenCalledWith(identity, caseId, {
          ...route.body,
          ...route.anchors,
        });
      },
    );
    it.each(routes)(
      'rejects a forged filing anchor before $method',
      async (route) => {
        await request(app.getHttpServer())
          .post(
            `/api/v1/${prefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send({ ...route.body, filingId: targetId })
          .expect(400);
        expect(commands[route.method]).not.toHaveBeenCalled();
      },
    );
  });
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
        'internal',
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
    it.each(routes)(
      'rejects every wrong principal before $method can read a version or receipt',
      async (route) => {
        for (const token of tokens) {
          const response = await request(app.getHttpServer())
            .post(
              `/api/v1/${prefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
            )
            .set('Authorization', `Bearer ${token}`)
            .send(route.body)
            .expect(403);
          expect(response.body).toMatchObject({ code: 'ACTION_FORBIDDEN' });
          expect(commands[route.method]).not.toHaveBeenCalled();
        }
      },
    );
  });
  describe.each([
    ['cases', 'lawyer/cases', 'internal'],
    ['lawyer/cases', 'cases', 'lawyer'],
  ] as const)(
    'successful %s key through wrong %s portal',
    (legalPrefix, wrongPrefix, token) => {
      it.each(routes)(
        'rejects the original successful $method key before delegation',
        async (route) => {
          const success = await request(app.getHttpServer())
            .post(
              `/api/v1/${legalPrefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
            )
            .set('Authorization', `Bearer ${token}`)
            .send(route.body)
            .expect(201);
          commands[route.method].mockClear();
          commands[route.method].mockResolvedValue(success.body);
          await request(app.getHttpServer())
            .post(
              `/api/v1/${wrongPrefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
            )
            .set('Authorization', `Bearer ${token}`)
            .send(route.body)
            .expect(403);
          expect(commands[route.method]).not.toHaveBeenCalled();
        },
      );
    },
  );
  it('rejects duplicate target anchors in correction bodies, invalid UUIDs and missing authentication', async () => {
    const url = `/api/v1/cases/${caseId}/execution-filings/${filingId}/feedbacks/${targetId}/corrections`;
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer internal')
      .send({ ...routes[1].body, feedbackId: targetId })
      .expect(400);
    await request(app.getHttpServer())
      .post(url.replace(filingId, 'not-uuid'))
      .set('Authorization', 'Bearer internal')
      .send(routes[1].body)
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .send(routes[1].body)
      .expect(401);
    expect(commands.correctFeedback).not.toHaveBeenCalled();
  });
  describe.each([
    ['cases', 'lawyer/cases', 'internal'],
    ['lawyer/cases', 'cases', 'lawyer'],
  ] as const)(
    '%s resolved cookie session',
    (legalPrefix, wrongPrefix, token) => {
      it.each(routes)(
        'checks the portal principal for the successful $method key after valid CSRF',
        async (route) => {
          await request(app.getHttpServer())
            .post(
              `/api/v1/${legalPrefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
            )
            .set('Cookie', `dev_cor_session=${token}`)
            .set('X-CSRF-Token', 'valid-csrf')
            .send(route.body)
            .expect(201)
            .expect(resultFor(route));
          commands[route.method].mockClear();
          const forbidden = await request(app.getHttpServer())
            .post(
              `/api/v1/${wrongPrefix}/${caseId}/execution-filings/${filingId}/${route.path}`,
            )
            .set('Cookie', `dev_cor_session=${token}`)
            .set('X-CSRF-Token', 'valid-csrf')
            .send(route.body)
            .expect(403);
          expect(forbidden.body).toMatchObject({ code: 'ACTION_FORBIDDEN' });
          expect(auth.resolveSession).toHaveBeenCalledTimes(2);
          expect(auth.verifyCsrf).toHaveBeenCalledTimes(2);
          expect(commands[route.method]).not.toHaveBeenCalled();
        },
      );
    },
  );
  it('retains session CSRF rejection before legitimate internal delegation', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/cases/${caseId}/execution-filings/${filingId}/feedbacks`)
      .set('Cookie', 'dev_cor_session=internal')
      .set('X-CSRF-Token', 'invalid-csrf')
      .send(routes[0].body)
      .expect(403);
    expect(response.body).toMatchObject({ code: 'CSRF_INVALID' });
    expect(commands.recordFeedback).not.toHaveBeenCalled();
  });
  it('retains the domain authorization failure as 403', async () => {
    commands.recordFeedback.mockRejectedValueOnce(
      new ForbiddenException({ code: 'ACTION_FORBIDDEN' }),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/cases/${caseId}/execution-filings/${filingId}/feedbacks`)
      .set('Authorization', 'Bearer internal')
      .send(routes[0].body)
      .expect(403);
  });
  it('registers both explicit portal controllers in CaseModule', () => {
    const controllers: unknown = Reflect.getMetadata('controllers', CaseModule);
    expect(controllers).toEqual(
      expect.arrayContaining([
        CaseExecutionFilingFollowupController,
        LawyerCaseExecutionFilingFollowupController,
      ]),
    );
  });
  it('publishes eight precise POST schemas without workflow fields or route anchors in body', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(doc.paths)).toHaveLength(8);
    expect(
      new Set(Object.values(doc.paths).map((item) => item.post?.operationId))
        .size,
    ).toBe(8);
    for (const item of Object.values(doc.paths))
      expect(item.post?.responses['201']).toBeDefined();
    for (const prefix of ['cases', 'lawyer/cases'])
      for (const route of routes) {
        const path = `/api/v1/${prefix}/{id}/execution-filings/{filingId}/${route.path.replace(targetId, route.method === 'correctFeedback' ? '{feedbackId}' : '{supplementId}')}`;
        expect(doc.paths[path]?.post?.operationId).toBe(
          `${prefix === 'cases' ? 'CaseExecutionFilingFollowupController' : 'LawyerCaseExecutionFilingFollowupController'}_${route.method}`,
        );
      }
    for (const name of [
      'RecordExecutionFilingFeedbackDto',
      'CorrectExecutionFilingFeedbackDto',
      'SubmitExecutionFilingSupplementDto',
      'CorrectExecutionFilingSupplementDto',
    ]) {
      const schema = doc.components?.schemas?.[name];
      expect(schema).toMatchObject({
        required: expect.arrayContaining([
          'idempotencyKey',
          'expectedRevision',
        ]),
      });
      expect(schema).toHaveProperty('properties');
      if (schema && 'properties' in schema) {
        expect(schema.properties).not.toHaveProperty('filingId');
        expect(schema.properties).not.toHaveProperty('expectedVersion');
        expect(schema.properties).not.toHaveProperty('stage');
      }
    }
  });
});
import 'reflect-metadata';
