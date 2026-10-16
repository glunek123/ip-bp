import { INestApplication, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { IDENTITY_ADAPTER } from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import { configureApp } from '../../common/configure-app';
import { CaseExecutionFilingFollowupController } from './case-execution-filing-followup.controller';
import { CaseExecutionFilingFollowupService } from './case-execution-filing-followup.service';

const caseId = '10000000-0000-4000-8000-000000000001';
const filingId = '10000000-0000-4000-8000-000000000002';
const targetId = '10000000-0000-4000-8000-000000000003';
const actor = {
  userId: caseId,
  departmentId: filingId,
  authorizationRevision: 1,
};
const lawyer = { ...actor, lawyerAccountId: actor.userId };
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
      controllers: [CaseExecutionFilingFollowupController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        {
          provide: IDENTITY_ADAPTER,
          useValue: {
            resolve: jest.fn(async (token: string) =>
              token === 'internal' ? actor : token === 'lawyer' ? lawyer : null,
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
    for (const command of Object.values(commands))
      command.mockResolvedValue({
        id: targetId,
        filingId,
        revision: 1,
        recordedAt: '2026-10-16T00:00:00.000Z',
      });
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
          .expect(201);
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
  it('publishes eight precise POST schemas without workflow fields or route anchors in body', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(doc.paths)).toHaveLength(8);
    for (const item of Object.values(doc.paths))
      expect(item.post?.responses['201']).toBeDefined();
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
