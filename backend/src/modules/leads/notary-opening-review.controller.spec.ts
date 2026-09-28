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
import { ClientNotaryOpeningReviewController } from './client-lead.controller';
import { LeadNotaryController } from './lead-notary.controller';
import { ReviewNotaryOpeningDto } from './lead-notary.dto';
import { LeadNotaryService } from './lead-notary.service';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';

describe('notary opening review HTTP contract', () => {
  const review = { review: jest.fn().mockResolvedValue({ id: 'matter' }) };
  const actor = { userId: 'actor' };
  const input = { result: 'INFRINGEMENT' as const, expectedVersion: 3 };
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  it('validates the shared required body', async () => {
    await expect(
      pipe.transform(input, { type: 'body', metatype: ReviewNotaryOpeningDto }),
    ).resolves.toEqual(input);
    for (const invalid of [
      { result: 'INFRINGEMENT' },
      { result: 'INFRINGEMENT', expectedVersion: 0 },
      { result: 'BAD', expectedVersion: 3 },
      { ...input, extra: true },
    ])
      await expect(
        pipe.transform(invalid, {
          type: 'body',
          metatype: ReviewNotaryOpeningDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('both routes validate the key and delegate to one Command', async () => {
    const internal = new LeadNotaryController(
      {} as LeadNotaryService,
      {} as NotaryOpeningService,
      review as unknown as NotaryOpeningReviewService,
      {} as NotaryIssuanceDecisionService,
    );
    const client = new ClientNotaryOpeningReviewController(
      review as unknown as NotaryOpeningReviewService,
    );
    expect(() =>
      internal.reviewOpening(actor as never, 'matter', undefined, input),
    ).toThrow(BadRequestException);
    expect(() =>
      client.reviewNotaryOpening(actor as never, 'matter', ' ', input),
    ).toThrow(BadRequestException);
    await expect(
      internal.reviewOpening(actor as never, 'matter', ' key ', input),
    ).resolves.toEqual({ id: 'matter' });
    await expect(
      client.reviewNotaryOpening(actor as never, 'matter', ' key ', input),
    ).resolves.toEqual({ id: 'matter' });
    expect(review.review).toHaveBeenNthCalledWith(
      1,
      actor,
      'matter',
      'key',
      input,
    );
    expect(review.review).toHaveBeenNthCalledWith(
      2,
      actor,
      'matter',
      'key',
      input,
    );
  });

  it('publishes both write routes, required key and response schema in OpenAPI', async () => {
    const module = await Test.createTestingModule({
      controllers: [LeadNotaryController, ClientNotaryOpeningReviewController],
      providers: [
        { provide: LeadNotaryService, useValue: {} },
        { provide: NotaryOpeningService, useValue: {} },
        { provide: NotaryOpeningReviewService, useValue: review },
        { provide: NotaryIssuanceDecisionService, useValue: {} },
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
      for (const path of [
        '/api/v1/notary-matters/{id}/opening-review',
        '/api/v1/client/notary-matters/{id}/opening-review',
      ]) {
        const operation = document.paths[path]?.post;
        expect(operation).toBeDefined();
        expect(operation?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          ]),
        );
        expect(operation?.responses['201']).toMatchObject({
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/NotaryOpeningReviewResponseDto',
              },
            },
          },
        });
      }
      expect(
        document.components?.schemas?.ReviewNotaryOpeningDto,
      ).toMatchObject({
        required: expect.arrayContaining(['result', 'expectedVersion']),
      });
    } finally {
      await app.close();
    }
  });
});
