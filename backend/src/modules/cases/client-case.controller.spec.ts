import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { ClientCaseController } from './client-case.controller';
import { ClientCaseService } from './client-case.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';

describe('client case OpenAPI contract', () => {
  it('publishes separate client read and same mailing request contract', async () => {
    const module = await Test.createTestingModule({
      controllers: [ClientCaseController],
      providers: [
        { provide: ClientCaseService, useValue: {} },
        { provide: CaseComplaintMailingService, useValue: {} },
      ],
    }).overrideGuard(ActorContextGuard).useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard).useValue({ canActivate: () => true }).compile();
    const app: INestApplication = module.createNestApplication();
    try {
      configureApp(app);
      await app.init();
      const document = SwaggerModule.createDocument(app,
        new DocumentBuilder().setTitle('test').setVersion('1').build());
      expect(document.paths['/api/v1/client/cases']?.get).toBeDefined();
      expect(document.paths['/api/v1/client/cases/{id}']?.get).toBeDefined();
      expect(document.paths['/api/v1/client/cases/{id}/complaint-mail']?.post?.requestBody)
        .toMatchObject({ content: { 'application/json': {
          schema: { $ref: '#/components/schemas/MailCaseComplaintDto' },
        } } });
      expect(document.components?.schemas?.ClientCaseDetailResponseDto)
        .not.toHaveProperty('properties.fees');
    } finally { await app.close(); }
  });
});
