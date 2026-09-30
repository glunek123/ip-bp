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

describe('case read OpenAPI contract', () => {
  it('declares minimal list and detail response with source fee identities', async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseReadController],
      providers: [
        { provide: CaseReadService, useValue: {} },
        { provide: CaseMatchService, useValue: {} },
        { provide: CaseComplaintService, useValue: {} },
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
