import { CaseArchiveService } from './case-archive.service';
import { CaseClosureService } from './case-closure.service';
import { CaseExecutionFinishService } from './case-execution-finish.service';
import { CaseExecutionMailingService } from './case-execution-mailing.service';
import { CaseExecutionFilingService } from './case-execution-filing.service';
import 'reflect-metadata';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseReadController } from './case-read.controller';
import { LawyerCaseController } from './lawyer-case.controller';
import { CasePageQueryDto } from './case-read.dto';
import { CaseReadService } from './case-read.service';
import { CaseMatchService } from './case-match.service';
import { CaseComplaintService } from './case-complaint.service';
import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { CaseFilingService } from './case-filing.service';
import { CaseAcceptanceService } from './case-acceptance.service';
import { CaseHearingService } from './case-hearing.service';
import { CaseJudgmentService } from './case-judgment.service';
import { CaseJudgmentNextStepService } from './case-judgment-next-step.service';
import { CaseSecondInstanceService } from './case-second-instance.service';
import { CaseExecutionSubmissionService } from './case-execution-submission.service';
import { CaseExecutionConfirmationService } from './case-execution-confirmation.service';
import { FilingCourtService } from './filing-court.service';

const routeCaseId = '33333333-3333-4333-8333-333333333333';
const routeMailInput = {
  expectedVersion: 4,
  idempotencyKey: 'route-identity',
  mailedAt: '2026-10-02',
  mailReceiptContentVersionIds: ['55555555-5555-4555-8555-555555555555'],
};

describe('lawyer execution route identity', () => {
  it.each([
    {},
    { clientCustomerId: 'customer' },
    { notaryOfficeId: 'office' },
    { lawyerAccountId: 'another-user' },
    { lawyerAccountId: 'user', clientCustomerId: 'customer' },
  ])('rejects a non-lawyer principal before either command: %j', (identity) => {
    const mailing = { mail: jest.fn() };
    const filing = { submit: jest.fn() };
    const finish = { finish: jest.fn() };
    const controller = new LawyerCaseController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mailing as never,
      filing as never,
      finish as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const actor = {
      userId: 'user',
      departmentId: 'department',
      authorizationRevision: 1,
      ...identity,
    };
    expect(() =>
      controller.mailExecution(actor, routeCaseId, {
        ...routeMailInput,
        expectedConfirmationId: routeCaseId,
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
      }),
    );
    expect(() =>
      controller.submitExecutionFiling(actor, routeCaseId, {
        expectedVersion: 5,
        idempotencyKey: 'route-filing-identity',
        expectedMailingId: routeCaseId,
        submittedAt: '2026-10-02',
        executionFilingProofContentVersionIds: [routeCaseId],
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
      }),
    );
    expect(mailing.mail).not.toHaveBeenCalled();
    expect(filing.submit).not.toHaveBeenCalled();
    expect(() =>
      controller.finishExecution(actor, routeCaseId, {
        expectedVersion: 24,
        idempotencyKey: 'finish',
        expectedFilingId: routeCaseId,
        finishedAt: '2026-10-01',
        reason: '真实原因',
        basisNote: '真实依据',
        basisContentVersionIds: [],
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
      }),
    );
    expect(finish.finish).not.toHaveBeenCalled();
  });
});

describe('internal complaint mailing route identity', () => {
  it.each([
    {
      userId: 'client',
      departmentId: 'department',
      authorizationRevision: 1,
      clientCustomerId: 'customer',
    },
    {
      userId: 'notary',
      departmentId: 'department',
      authorizationRevision: 1,
      notaryOfficeId: 'office',
    },
  ])('rejects external actors before the shared command', (externalActor) => {
    const mailing = { mail: jest.fn() };
    const controller = new CaseReadController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mailing as never,
      {} as CaseFilingService,
      {} as CaseAcceptanceService,
      {} as CaseHearingService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as FilingCourtService,
    );
    expect(() =>
      controller.mailComplaint(externalActor, routeCaseId, routeMailInput),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
      }),
    );
    expect(mailing.mail).not.toHaveBeenCalled();
  });
});

describe('case read OpenAPI contract', () => {
  it('declares minimal list and detail response with source fee identities', async () => {
    const unexpectedUnique = {
      code: 'P2002',
      meta: { target: 'case_second_instance_results_case_from_key' },
    };
    const secondInstance = {
      save: jest.fn().mockRejectedValue(unexpectedUnique),
    };
    const executionSubmission = {
      submit: jest.fn().mockResolvedValue({
        id: routeCaseId,
        submissionId: routeCaseId,
        stage: 'WAITING_EXECUTION_CONFIRMATION',
        version: 12,
        submittedAt: '2026-10-11T00:00:00.000Z',
      }),
    };
    const executionConfirmation = {
      confirm: jest.fn().mockResolvedValue({
        id: routeCaseId,
        confirmationId: routeCaseId,
        submissionId: routeCaseId,
        stage: 'WAITING_EXECUTION_STAMP',
        version: 13,
        confirmedAt: '2026-10-12T00:00:00.000Z',
      }),
    };
    let lawyerRead = false;
    const closure = {
      record: jest.fn().mockResolvedValue({ id: routeCaseId }),
      correct: jest.fn().mockResolvedValue({ id: routeCaseId }),
    };
    const reads = new CaseReadService(
      {
        userAccount: {
          findUnique: jest.fn().mockImplementation(async () => ({
            accountType: lawyerRead ? 'LAWYER' : 'INTERNAL',
            active: true,
          })),
        },
        lawyerAccountBinding: {
          findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
        },
        case: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          groupBy: jest.fn().mockResolvedValue([]),
        },
      } as never,
      {
        authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
    );
    const listRead = jest.spyOn(reads, 'list');
    const module = await Test.createTestingModule({
      controllers: [CaseReadController, LawyerCaseController],
      providers: [
        {
          provide: CaseArchiveService,
          useValue: {
            archive: jest.fn().mockResolvedValue({ stage: 'ARCHIVED' }),
            correct: jest.fn().mockResolvedValue({ stage: 'ARCHIVED' }),
          },
        },
        {
          provide: CaseClosureService,
          useValue: closure,
        },
        {
          provide: CaseExecutionFinishService,
          useValue: { finish: jest.fn() },
        },
        { provide: CaseExecutionMailingService, useValue: { mail: jest.fn() } },
        {
          provide: CaseExecutionFilingService,
          useValue: { submit: jest.fn() },
        },
        { provide: CaseReadService, useValue: reads },
        { provide: CaseMatchService, useValue: {} },
        { provide: CaseComplaintService, useValue: {} },
        { provide: CaseComplaintConfirmationService, useValue: {} },
        { provide: CaseComplaintMailingService, useValue: {} },
        { provide: CaseFilingService, useValue: {} },
        { provide: CaseAcceptanceService, useValue: {} },
        { provide: CaseHearingService, useValue: {} },
        { provide: CaseJudgmentService, useValue: {} },
        { provide: CaseJudgmentNextStepService, useValue: {} },
        { provide: CaseSecondInstanceService, useValue: secondInstance },
        {
          provide: CaseExecutionSubmissionService,
          useValue: executionSubmission,
        },
        {
          provide: CaseExecutionConfirmationService,
          useValue: executionConfirmation,
        },
        { provide: FilingCourtService, useValue: {} },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().actor = {
            userId: routeCaseId,
            departmentId: routeCaseId,
            authorizationRevision: 1,
            ...(lawyerRead ? { lawyerAccountId: routeCaseId } : {}),
          };
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app: INestApplication = module.createNestApplication();
    try {
      configureApp(app);
      await app.init();
      const archiveInput = {
        expectedVersion: 26,
        idempotencyKey: 'archive-route',
        expectedClosureVersionId: routeCaseId,
        archiveAt: '2020-01-01',
        archiveType: 'SETTLEMENT',
        archiveReason: '真实原因',
      };
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/archive`)
        .send(archiveInput)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/archive-correction`)
        .send({
          ...archiveInput,
          expectedArchiveVersionId: routeCaseId,
          correctionReason: '真实更正',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/archive`)
        .send({ ...archiveInput, extra: true })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/cases/invalid/archive')
        .send(archiveInput)
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/archive`)
        .send({ ...archiveInput, archiveAt: '2020-02-30' })
        .expect(400);
      lawyerRead = true;
      await request(app.getHttpServer())
        .post(`/api/v1/lawyer/cases/${routeCaseId}/archive`)
        .send(archiveInput)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/lawyer/cases/${routeCaseId}/archive-correction`)
        .send({
          ...archiveInput,
          expectedArchiveVersionId: routeCaseId,
          correctionReason: '真实更正',
        })
        .expect(404);
      lawyerRead = false;
      const closureInput = {
        expectedVersion: 25,
        idempotencyKey: 'closure-route',
        expectedFinishId: routeCaseId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [],
      };
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/closure`)
        .send(closureInput)
        .expect(201);
      expect(closure.record).toHaveBeenCalledWith(
        expect.any(Object),
        routeCaseId,
        closureInput,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/closure-correction`)
        .send({
          ...closureInput,
          expectedClosureVersionId: routeCaseId,
          correctionReason: '真实原因',
        })
        .expect(201);
      expect(closure.correct).toHaveBeenCalledTimes(1);
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/closure`)
        .send({ ...closureInput, extra: true })
        .expect(400);
      const omittedClosureInput = Object.fromEntries(
        Object.entries(closureInput).filter(([key]) => key !== 'note'),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/closure`)
        .send(omittedClosureInput)
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/cases/invalid/closure')
        .send(closureInput)
        .expect(400);
      lawyerRead = true;
      await request(app.getHttpServer())
        .post(`/api/v1/lawyer/cases/${routeCaseId}/closure`)
        .send(closureInput)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/lawyer/cases/${routeCaseId}/closure-correction`)
        .send({
          ...closureInput,
          expectedClosureVersionId: routeCaseId,
          correctionReason: '真实原因',
        })
        .expect(404);
      lawyerRead = false;
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      expect(document.paths['/api/v1/cases']?.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'stageGroup',
            schema: expect.objectContaining({
              enum: ['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'],
            }),
          }),
        ]),
      );
      for (const stageGroup of [
        'COMPLAINT_PREPARATION',
        'EXECUTION_PREPARATION',
      ] as const) {
        await request(app.getHttpServer())
          .get('/api/v1/cases')
          .query({ stageGroup, view: 'mine', page: 2 })
          .expect(200);
        expect(listRead).toHaveBeenLastCalledWith(
          expect.any(Object),
          2,
          20,
          'mine',
          undefined,
          stageGroup,
        );
        await request(app.getHttpServer())
          .get('/api/v1/cases')
          .query({ stage: 'WAITING_COMPLAINT', stageGroup })
          .expect(400);
      }
      lawyerRead = true;
      for (const stageGroup of [
        'COMPLAINT_PREPARATION',
        'EXECUTION_PREPARATION',
      ] as const) {
        await request(app.getHttpServer())
          .get('/api/v1/lawyer/cases')
          .query({ stageGroup, page: 2 })
          .expect(200);
        expect(listRead).toHaveBeenLastCalledWith(
          expect.objectContaining({ lawyerAccountId: routeCaseId }),
          2,
          20,
          'department',
          undefined,
          stageGroup,
        );
        await request(app.getHttpServer())
          .get('/api/v1/lawyer/cases')
          .query({ stage: 'WAITING_COMPLAINT', stageGroup })
          .expect(400);
      }
      lawyerRead = false;
      await request(app.getHttpServer())
        .get('/api/v1/cases')
        .query({ stageGroup: 'UNKNOWN' })
        .expect(400);
      expect(
        document.paths['/api/v1/cases']?.get?.responses['200'],
      ).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CaseListResponseDto' },
          },
        },
      });
      expect(
        document.paths['/api/v1/cases/{id}']?.get?.responses['200'],
      ).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CaseDetailResponseDto' },
          },
        },
      });
      expect(document.components?.schemas?.CaseDetailResponseDto).toMatchObject(
        {
          properties: {
            department: expect.any(Object),
            customer: expect.any(Object),
            rightsHolder: expect.any(Object),
            owner: expect.any(Object),
            fees: { type: 'array' },
          },
        },
      );
      expect(document.components?.schemas?.CaseSecondInstanceDto).toMatchObject(
        {
          properties: {
            currentTrialRoundId: {
              type: 'string',
              format: 'uuid',
              nullable: true,
            },
            currentProgress: expect.objectContaining({ nullable: true }),
            currentResult: expect.objectContaining({ nullable: true }),
          },
        },
      );
      expect(
        document.components?.schemas?.CaseExecutionSubmissionDto,
      ).toMatchObject({
        properties: {
          current: expect.objectContaining({ nullable: true }),
          submissions: { type: 'array' },
          availableFiles: { type: 'array' },
        },
      });
      expect(document.components?.schemas?.CaseListItemDto).toMatchObject({
        properties: {
          canSubmitExecution: { type: 'boolean' },
          canConfirmExecution: { type: 'boolean' },
        },
      });
      expect(document.components?.schemas?.CaseDetailResponseDto).toMatchObject(
        {
          properties: {
            executionConfirmation: expect.objectContaining({ nullable: true }),
          },
        },
      );
      expect(
        document.paths['/api/v1/cases/{id}/execution-submit']?.post?.responses[
          '201'
        ],
      ).toBeDefined();
      const missingAnchor = await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/execution-submit`)
        .send({
          expectedVersion: 11,
          idempotencyKey: 'missing-anchor',
          trialRoundId: routeCaseId,
          judgmentNextStepId: routeCaseId,
          secondInstanceResultId: null,
          executionApplicationContentVersionIds: [routeCaseId],
        });
      expect(missingAnchor.status).toBe(400);
      const unknownField = await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/execution-submit`)
        .send({
          expectedVersion: 11,
          idempotencyKey: 'unknown-field',
          trialRoundId: routeCaseId,
          judgmentNextStepId: routeCaseId,
          secondInstanceResultId: null,
          expectedSubmissionId: null,
          executionApplicationContentVersionIds: [routeCaseId],
          arbitrary: true,
        });
      expect(unknownField.status).toBe(400);
      expect(executionSubmission.submit).not.toHaveBeenCalled();
      expect(
        document.paths['/api/v1/cases/{id}/execution-confirm']?.post?.responses[
          '201'
        ],
      ).toBeDefined();
      const extraConfirmationField = await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/execution-confirm`)
        .send({
          expectedVersion: 12,
          idempotencyKey: 'confirm',
          expectedSubmissionId: routeCaseId,
          executionApplicationContentVersionIds: [routeCaseId],
        });
      expect(extraConfirmationField.status).toBe(400);
      expect(executionConfirmation.confirm).not.toHaveBeenCalled();
      expect(
        document.paths['/api/v1/cases/{id}/second-instance-save']?.post
          ?.responses['201'],
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/second-instance-result']?.post
          ?.responses['201'],
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/second-instance-result-revoke']?.post
          ?.responses['201'],
      ).toBeDefined();
      const missingFiles = await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/second-instance-save`)
        .send({
          expectedVersion: 1,
          idempotencyKey: 'invalid',
          trialRoundId: routeCaseId,
          choiceId: routeCaseId,
          expectedProgressId: null,
          progress: {
            hearingAt: null,
            hearingPlace: null,
            judgeName: null,
            documentContentVersionIds: [],
          },
        });
      expect(missingFiles.status).toBe(400);
      expect(secondInstance.save).not.toHaveBeenCalled();
      const missingJudgment = await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/second-instance-result`)
        .send({
          expectedVersion: 1,
          idempotencyKey: 'invalid-result',
          trialRoundId: routeCaseId,
          choiceId: routeCaseId,
          expectedProgressId: null,
          progress: {
            hearingAt: null,
            hearingPlace: null,
            judgeName: null,
            documentContentVersionIds: [],
            serviceContentVersionIds: [],
          },
          result: 'AFFIRM',
          resultReceivedAt: '2026-10-08',
          paidLitigationFee: { state: 'PENDING', amount: null },
        });
      expect(missingJudgment.status).toBe(400);
      const uniqueResponse = await request(app.getHttpServer())
        .post(`/api/v1/cases/${routeCaseId}/second-instance-save`)
        .send({
          expectedVersion: 1,
          idempotencyKey: 'unique-fact',
          trialRoundId: routeCaseId,
          choiceId: routeCaseId,
          expectedProgressId: null,
          progress: {
            hearingAt: null,
            hearingPlace: null,
            judgeName: null,
            documentContentVersionIds: [],
            serviceContentVersionIds: [],
          },
        });
      expect(uniqueResponse.status).toBe(500);
      expect(secondInstance.save).toHaveBeenCalledTimes(1);
      expect(uniqueResponse.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(uniqueResponse.body)).not.toContain('P2002');
      expect(document.paths['/api/v1/cases/{id}/match']?.post).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/complaint-confirm']?.post,
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/complaint-mail']?.post,
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/filing-courts']?.get,
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/filing-courts']?.post,
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/filing-submit']?.post,
      ).toBeDefined();
      expect(
        document.paths['/api/v1/cases/{id}/acceptance-register']?.post,
      ).toBeDefined();
      expect(document.components?.schemas?.CaseFeeDto).toMatchObject({
        properties: {
          sourceType: expect.any(Object),
          sourceId: expect.any(Object),
          amount: { type: 'string', nullable: true },
        },
      });
    } finally {
      await app.close();
    }
  });
});

describe('case list execution stage query validation', () => {
  it.each([
    'WAITING_EXECUTION_FILING',
    'EXECUTING',
    'WAITING_ARCHIVE',
  ] as const)('accepts the %s stage filter', (stage) => {
    const query = plainToInstance(CasePageQueryDto, { stage });
    expect(validateSync(query)).toEqual([]);
  });

  it('continues to reject unknown stage filters', () => {
    const query = plainToInstance(CasePageQueryDto, {
      stage: 'UNRECOGNIZED_EXECUTION_STAGE',
    });
    expect(validateSync(query).map((error) => error.property)).toContain(
      'stage',
    );
  });
});

it.each(['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'])(
  'accepts %s as a read-only group query',
  (stageGroup) => {
    expect(
      validateSync(plainToInstance(CasePageQueryDto, { stageGroup })),
    ).toEqual([]);
  },
);
