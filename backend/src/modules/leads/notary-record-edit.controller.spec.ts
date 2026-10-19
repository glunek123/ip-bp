import 'reflect-metadata';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { LeadNotaryController } from './lead-notary.controller';
import { LeadNotaryService } from './lead-notary.service';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';
import { NotaryReturnArchiveService } from './notary-return-archive.service';
import { NotaryRecordEditController } from './notary-record-edit.controller';
import { NotaryRecordEditService } from './notary-record-edit.service';
import {
  CorrectNotaryEvidenceDto,
  CorrectNotaryOpeningSenderDto,
} from './notary-record-edit.dto';

describe('notary record correction contract', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
  it('validates the two exact command bodies with explicit null sender values', async () => {
    const evidence = {
      expectedVersion: 2,
      expectedRevision: 0,
      correctionReason: '  更正  ',
      evidenceAt: '2026-10-17',
      logistics: [
        {
          companyState: 'NONE',
          companyValue: null,
          trackingState: 'PRESENT',
          trackingValue: '真实号',
        },
      ],
    };
    const sender = {
      expectedVersion: 3,
      expectedRevision: 0,
      correctionReason: '  修正  ',
      senderName: null,
      senderPhone: null,
      senderAddress: null,
    };
    await expect(
      pipe.transform(evidence, {
        type: 'body',
        metatype: CorrectNotaryEvidenceDto,
      }),
    ).resolves.toMatchObject({ correctionReason: '更正' });
    await expect(
      pipe.transform(sender, {
        type: 'body',
        metatype: CorrectNotaryOpeningSenderDto,
      }),
    ).resolves.toMatchObject({
      correctionReason: '修正',
      senderName: null,
      senderPhone: null,
      senderAddress: null,
    });
    for (const [body, dto] of [
      [{ ...evidence, sampleFeeAmount: '1.00' }, CorrectNotaryEvidenceDto],
      [
        {
          ...evidence,
          logistics: [{ ...evidence.logistics[0], id: 'forged' }],
        },
        CorrectNotaryEvidenceDto,
      ],
      [{ ...sender, photos: [] }, CorrectNotaryOpeningSenderDto],
      [{ ...sender, expectedVersion: '3' }, CorrectNotaryOpeningSenderDto],
    ] as const) {
      await expect(
        pipe.transform(body, { type: 'body', metatype: dto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('publishes both guarded POST routes and the detail recordEdits schema', async () => {
    const module = await Test.createTestingModule({
      controllers: [NotaryRecordEditController, LeadNotaryController],
      providers: [
        { provide: NotaryRecordEditService, useValue: {} },
        { provide: LeadNotaryService, useValue: {} },
        { provide: NotaryOpeningService, useValue: {} },
        { provide: NotaryOpeningReviewService, useValue: {} },
        { provide: NotaryIssuanceDecisionService, useValue: {} },
        { provide: NotaryReturnArchiveService, useValue: {} },
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
      for (const [path, dto] of [
        [
          '/api/v1/notary-matters/{id}/evidence-corrections',
          'CorrectNotaryEvidenceDto',
        ],
        [
          '/api/v1/notary-matters/{id}/opening-sender-corrections',
          'CorrectNotaryOpeningSenderDto',
        ],
      ]) {
        const operation = document.paths[path]?.post;
        expect(operation?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          ]),
        );
        expect(operation?.requestBody).toMatchObject({
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${dto}` },
            },
          },
        });
        expect(operation?.responses['201']).toMatchObject({
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/NotaryRecordCorrectionResponseDto',
              },
            },
          },
        });
      }
      expect(
        document.components?.schemas?.CorrectNotaryEvidenceDto,
      ).toMatchObject({
        required: expect.arrayContaining([
          'expectedVersion',
          'expectedRevision',
          'correctionReason',
          'evidenceAt',
          'logistics',
        ]),
      });
      expect(
        document.components?.schemas?.CorrectNotaryOpeningSenderDto,
      ).toMatchObject({
        required: expect.arrayContaining([
          'senderName',
          'senderPhone',
          'senderAddress',
        ]),
        properties: {
          senderName: { type: 'string', nullable: true, maxLength: 200 },
          senderPhone: { type: 'string', nullable: true, maxLength: 100 },
          senderAddress: { type: 'string', nullable: true, maxLength: 500 },
        },
      });
      expect(
        document.components?.schemas?.NotaryOpeningSenderEditValueResponseDto,
      ).toMatchObject({
        properties: {
          senderName: { type: 'string', nullable: true, maxLength: 200 },
        },
      });
      expect(
        document.components?.schemas?.NotaryEditLogisticsResponseDto,
      ).toMatchObject({
        required: expect.arrayContaining([
          'id',
          'companyValue',
          'trackingValue',
        ]),
        properties: {
          companyValue: { type: 'string', nullable: true },
          trackingValue: { type: 'string', nullable: true },
        },
      });
      expect(
        document.components?.schemas?.NotaryRecordEditsResponseDto,
      ).toMatchObject({
        properties: {
          evidence: expect.any(Object),
          openingSender: expect.any(Object),
        },
      });
      expect(
        document.components?.schemas?.NotaryEvidenceEditHistoryResponseDto,
      ).toMatchObject({
        properties: {
          correctionId: expect.any(Object),
          before: expect.any(Object),
          after: expect.any(Object),
        },
      });
      expect(
        document.paths['/api/v1/notary-matters/{id}']?.get?.responses['200'],
      ).toMatchObject({
        content: {
          'application/json': {
            schema: {
              properties: {
                recordEdits: {
                  $ref: '#/components/schemas/NotaryRecordEditsResponseDto',
                },
              },
            },
          },
        },
      });
    } finally {
      await app.close();
    }
  });
});
