import 'reflect-metadata';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseReadController } from './case-read.controller';
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
import { FilingCourtService } from './filing-court.service';

const routeCaseId = '33333333-3333-4333-8333-333333333333';
const routeMailInput = {
  expectedVersion: 4,
  idempotencyKey: 'route-identity',
  mailedAt: '2026-10-02',
  mailReceiptContentVersionIds: ['55555555-5555-4555-8555-555555555555'],
};

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
    const module = await Test.createTestingModule({
      controllers: [CaseReadController],
      providers: [
        { provide: CaseReadService, useValue: {} },
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
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
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
        properties: { canSubmitExecution: { type: 'boolean' } },
      });
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
