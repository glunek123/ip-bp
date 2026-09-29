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
import { ArchiveNotaryReturnDto } from './notary-return-archive.dto';

describe('notary return archive HTTP contract', () => {
  const archive = { archive: jest.fn().mockResolvedValue({ id: 'matter' }) };
  const input = {
    returnChoice: 'RETURN',
    refund: {
      state: 'KNOWN',
      amount: '1.00',
      partyKind: 'OTHER',
      partyName: '平台',
    },
    freight: { state: 'PENDING' },
    archiveReason: '退货',
    expectedVersion: 5,
  };
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  it('rejects unknown nested fields, invalid enum and imprecise amount', async () => {
    await expect(
      pipe.transform(input, { type: 'body', metatype: ArchiveNotaryReturnDto }),
    ).resolves.toMatchObject(input);
    for (const invalid of [
      { ...input, unknown: 1 },
      { ...input, returnChoice: 'OTHER' },
      { ...input, refund: { ...input.refund, extra: 1 } },
      { ...input, refund: { ...input.refund, amount: '1.001' } },
      { ...input, expectedVersion: '5' },
    ])
      await expect(
        pipe.transform(invalid, {
          type: 'body',
          metatype: ArchiveNotaryReturnDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes guarded endpoint, required key, and response schema', async () => {
    const module = await Test.createTestingModule({
      controllers: [LeadNotaryController],
      providers: [
        { provide: LeadNotaryService, useValue: {} },
        { provide: NotaryOpeningService, useValue: {} },
        { provide: NotaryOpeningReviewService, useValue: {} },
        { provide: NotaryIssuanceDecisionService, useValue: {} },
        { provide: NotaryReturnArchiveService, useValue: archive },
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
      const operation =
        document.paths['/api/v1/notary-matters/{id}/return-archive']?.post;
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
      expect(operation?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/NotaryReturnArchiveResponseDto',
            },
          },
        },
      });
      expect(
        document.components?.schemas?.ArchiveNotaryReturnDto,
      ).toMatchObject({
        required: expect.arrayContaining([
          'returnChoice',
          'archiveReason',
          'expectedVersion',
        ]),
      });
      expect(
        document.components?.schemas?.NotaryReturnArchiveSummaryDto,
      ).toMatchObject({
        required: expect.arrayContaining([
          'returnChoice',
          'archiveReason',
          'archivedAt',
          'actorDisplayName',
          'refund',
          'freight',
        ]),
      });
    } finally {
      await app.close();
    }
  });

  it('validates the idempotency key and forwards the normalized key', async () => {
    const controller = new LeadNotaryController(
      {} as LeadNotaryService,
      {} as NotaryOpeningService,
      {} as NotaryOpeningReviewService,
      {} as NotaryIssuanceDecisionService,
      archive as unknown as NotaryReturnArchiveService,
    );
    expect(() =>
      controller.archiveReturn(
        {} as never,
        'matter',
        undefined,
        input as ArchiveNotaryReturnDto,
      ),
    ).toThrow(BadRequestException);
    await expect(
      controller.archiveReturn(
        {} as never,
        'matter',
        ' key ',
        input as ArchiveNotaryReturnDto,
      ),
    ).resolves.toEqual({ id: 'matter' });
    expect(archive.archive).toHaveBeenCalledWith({}, 'matter', 'key', input);
  });
});
