import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ActorContextGuard } from './access-control/actor-context.guard';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CsrfGuard } from './auth/csrf.guard';
import { configureApp } from './common/configure-app';
import { CustomerAccountService } from './modules/customers/customer-account.service';
import { CustomerAdmissionService } from './modules/customers/customer-admission.service';
import { CustomerController } from './modules/customers/customer.controller';
import { CustomerService } from './modules/customers/customer.service';
import { ClientLeadController } from './modules/leads/client-lead.controller';
import { ClientLeadService } from './modules/leads/client-lead.service';
import { LeadController } from './modules/leads/lead.controller';
import { LeadService } from './modules/leads/lead.service';

describe('CORE-LD-002 OpenAPI contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        CustomerController,
        LeadController,
        ClientLeadController,
      ],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: CustomerAdmissionService, useValue: {} },
        { provide: CustomerAccountService, useValue: {} },
        { provide: LeadService, useValue: {} },
        { provide: ClientLeadService, useValue: {} },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it.each([
    ['post', '/api/v1/auth/login', '200', 'AuthSessionResponseDto'],
    ['get', '/api/v1/auth/session', '200', 'AuthSessionResponseDto'],
    [
      'get',
      '/api/v1/customers/{id}/client-accounts',
      '200',
      'CustomerAccountListResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{id}/client-accounts',
      '201',
      'CustomerAccountResponseDto',
    ],
    [
      'patch',
      '/api/v1/customers/{id}/client-accounts/{userId}/status',
      '200',
      'CustomerAccountResponseDto',
    ],
    ['post', '/api/v1/leads/{id}/push', '201', 'LeadPushResponseDto'],
    ['get', '/api/v1/client/leads', '200', 'ClientLeadListResponseDto'],
    ['get', '/api/v1/client/leads/{id}', '200', 'ClientLeadResponseDto'],
    [
      'post',
      '/api/v1/client/leads/{id}/reviews',
      '201',
      'ClientLeadReviewResultDto',
    ],
  ] as const)(
    'documents %s %s response %s',
    (method, path, status, schemaName) => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      const operation = document.paths[path]?.[method];
      const response = operation?.responses[status];
      expect(response).toBeDefined();
      expect(response !== undefined && 'content' in response).toBe(true);
      if (response !== undefined && 'content' in response) {
        expect(response.content?.['application/json']?.schema).toEqual({
          $ref: `#/components/schemas/${schemaName}`,
        });
      }
    },
  );

  it('documents the human push operator name', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const schema = document.components?.schemas?.LeadPushResponseDto;

    expect(schema).toMatchObject({
      required: expect.arrayContaining(['pushedByDisplayName']),
      properties: {
        pushedByDisplayName: { type: 'string' },
      },
    });
  });
});
