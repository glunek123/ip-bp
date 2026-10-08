import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
        { provide: FilingCourtService, useValue: {} },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({ canActivate: () => true })
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
