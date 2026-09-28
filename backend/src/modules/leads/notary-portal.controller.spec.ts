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
import { NotaryCertificateService } from './notary-certificate.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IssueNotaryCertificateDto } from './notary-certificate.dto';
import { randomUUID } from 'node:crypto';

describe('notary certificate request validation', () => {
  it('accepts known amounts and explicitly pending null amounts', () => {
    const input = plainToInstance(IssueNotaryCertificateDto, {
      expectedVersion: 5,
      certificateNo: '（2026）浙证字005号',
      certificateDate: '2026-09-28',
      contentVersionIds: ['11111111-1111-4111-8111-111111111111'],
      needDisclose: false,
      disclosureContentVersionIds: [],
      fees: {
        notary: { state: 'KNOWN', amount: '120.00' },
        investigation: { state: 'PENDING', amount: null },
        disclosure: { state: 'KNOWN', amount: '0.00' },
      },
    });
    expect(
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    input.contentVersionIds = Array.from({ length: 11 }, () => randomUUID());
    expect(
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true }),
    ).not.toEqual([]);
  });
});

describe('notary portal OpenAPI contract', () => {
  it('declares minimal list, detail and opening response schemas', async () => {
    const module = await Test.createTestingModule({
      controllers: [NotaryPortalController],
      providers: [
        { provide: NotaryPortalService, useValue: {} },
        { provide: NotaryOpeningService, useValue: {} },
        { provide: NotaryCertificateService, useValue: {} },
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
      const certificate =
        document.paths['/api/v1/notary-portal/matters/{id}/certificate'];
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
      expect(certificate?.post?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/IssueNotaryCertificateResponseDto',
            },
          },
        },
      });
      expect(
        document.components?.schemas?.NotaryPortalDetailResponseDto,
      ).toMatchObject({
        properties: {
          disclosureRequired: { type: 'boolean' },
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
