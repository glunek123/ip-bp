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
import { DecideNotaryIssuanceDto } from './lead-notary.dto';
import { LeadNotaryService } from './lead-notary.service';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';

describe('notary issuance decision HTTP contract', () => {
  const decide = { decide: jest.fn().mockResolvedValue({ id: 'matter' }) };
  const input = { decision: 'ISSUE' as const, expectedVersion: 4 };
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  it('accepts only a choice and positive integer version', async () => {
    await expect(
      pipe.transform(input, {
        type: 'body',
        metatype: DecideNotaryIssuanceDto,
      }),
    ).resolves.toEqual(input);
    for (const invalid of [
      { decision: 'ISSUE' },
      { decision: 'BAD', expectedVersion: 4 },
      { decision: 'NO_ISSUE', expectedVersion: 0 },
      { ...input, extra: true },
    ])
      await expect(
        pipe.transform(invalid, {
          type: 'body',
          metatype: DecideNotaryIssuanceDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes the guarded route, key and strict response schema', async () => {
    const module = await Test.createTestingModule({
      controllers: [LeadNotaryController],
      providers: [
        { provide: LeadNotaryService, useValue: {} },
        { provide: NotaryOpeningService, useValue: {} },
        { provide: NotaryOpeningReviewService, useValue: {} },
        { provide: NotaryIssuanceDecisionService, useValue: decide },
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
        document.paths['/api/v1/notary-matters/{id}/issuance-decision']?.post;
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
      expect(operation?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/NotaryIssuanceDecisionResponseDto',
            },
          },
        },
      });
      expect(
        document.components?.schemas?.DecideNotaryIssuanceDto,
      ).toMatchObject({
        required: expect.arrayContaining(['decision', 'expectedVersion']),
      });
    } finally {
      await app.close();
    }
  });
});
