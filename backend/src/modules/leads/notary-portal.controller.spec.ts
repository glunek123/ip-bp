import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryPortalController } from './notary-portal.controller';
import { NotaryPortalService } from './notary-portal.service';

describe('notary portal OpenAPI contract', () => {
  it('declares minimal list, detail and opening response schemas', async () => {
    const module = await Test.createTestingModule({
      controllers: [NotaryPortalController],
      providers: [
        { provide: NotaryPortalService, useValue: {} },
        { provide: NotaryOpeningService, useValue: {} },
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
      const collection = document.paths['/api/v1/notary-portal/matters'];
      const member = document.paths['/api/v1/notary-portal/matters/{id}'];
      const opening =
        document.paths['/api/v1/notary-portal/matters/{id}/opening'];
      expect(collection?.get?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/NotaryPortalListResponseDto',
            },
          },
        },
      });
      expect(member?.get?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/NotaryPortalDetailResponseDto',
            },
          },
        },
      });
      expect(opening?.post?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/NotaryPortalOpeningResultDto',
            },
          },
        },
      });
      expect(
        document.components?.schemas?.NotaryPortalDetailResponseDto,
      ).toMatchObject({
        properties: {
          opening: {
            allOf: [{ $ref: '#/components/schemas/NotaryPortalOpeningDto' }],
            nullable: true,
          },
          capabilities: {
            $ref: '#/components/schemas/NotaryPortalCapabilitiesDto',
          },
        },
      });
      const portalOpeningSchema =
        document.components?.schemas?.NotaryPortalOpeningDto;
      const openingResultSchema =
        document.components?.schemas?.NotaryPortalOpeningResultDto;
      expect(
        portalOpeningSchema && 'properties' in portalOpeningSchema
          ? portalOpeningSchema.properties
          : undefined,
      ).not.toHaveProperty('recordedByUserId');
      expect(portalOpeningSchema).toMatchObject({
        properties: {
          senderName: { type: 'string', nullable: true },
          senderPhone: { type: 'string', nullable: true },
          senderAddress: { type: 'string', nullable: true },
          photos: { type: 'array' },
        },
      });
      expect(
        openingResultSchema && 'properties' in openingResultSchema
          ? openingResultSchema.properties
          : undefined,
      ).toHaveProperty('opening');
    } finally {
      await app.close();
    }
  });
});
