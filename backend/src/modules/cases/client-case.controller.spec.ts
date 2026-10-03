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

describe('client complaint mailing route identity', () => {
  it.each([
    { userId: 'internal', departmentId: 'department', authorizationRevision: 1 },
    { userId: 'notary', departmentId: 'department', authorizationRevision: 1,
      notaryOfficeId: 'office' },
  ])('rejects non-client actors before the shared command', (nonClientActor) => {
    const mailing = { mail: jest.fn() };
    const controller = new ClientCaseController({} as never, mailing as never);
    expect(() => controller.mailComplaint(nonClientActor,
      '33333333-3333-4333-8333-333333333333', {
        expectedVersion: 4, idempotencyKey: 'route-identity',
        mailedAt: '2026-10-02', mailReceiptContentVersionIds: [
          '55555555-5555-4555-8555-555555555555',
        ],
      })).toThrow(expect.objectContaining({
      response: expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
    }));
    expect(mailing.mail).not.toHaveBeenCalled();
  });
});

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
