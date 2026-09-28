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
import { ClientNotaryController } from './modules/leads/client-notary.controller';
import { ClientNotaryService } from './modules/leads/client-notary.service';
import { LeadController } from './modules/leads/lead.controller';
import { LeadService } from './modules/leads/lead.service';
import { NotaryListController } from './modules/leads/notary-list.controller';
import { NotaryListService } from './modules/leads/notary-list.service';

describe('CORE-LD-002 OpenAPI contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        CustomerController,
        LeadController,
        ClientLeadController,
        ClientNotaryController,
        NotaryListController,
      ],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: CustomerAdmissionService, useValue: {} },
        { provide: CustomerAccountService, useValue: {} },
        { provide: LeadService, useValue: {} },
        { provide: ClientLeadService, useValue: {} },
        { provide: ClientNotaryService, useValue: {} },
        { provide: NotaryListService, useValue: {} },
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
    [
      'post',
      '/api/v1/leads/{id}/withdrawal-applications',
      '201',
      'LeadWithdrawalApplicationResponseDto',
    ],
    ['get', '/api/v1/client/leads', '200', 'ClientLeadListResponseDto'],
    ['get', '/api/v1/notary-matters', '200', 'NotaryListResponseDto'],
    ['get', '/api/v1/client/leads/{id}', '200', 'ClientLeadResponseDto'],
    [
      'get',
      '/api/v1/client/notary-matters',
      '200',
      'ClientNotaryListResponseDto',
    ],
    [
      'get',
      '/api/v1/client/notary-matters/{id}',
      '200',
      'ClientNotaryDetailResponseDto',
    ],
    [
      'post',
      '/api/v1/client/leads/{id}/reviews',
      '201',
      'ClientLeadReviewResultDto',
    ],
    [
      'post',
      '/api/v1/client/leads/{id}/withdrawal-confirmations',
      '201',
      'ClientLeadWithdrawalConfirmationResultDto',
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

  it('documents notary list stage counts and page fields', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    expect(document.components?.schemas?.NotaryListResponseDto).toMatchObject({
      required: expect.arrayContaining([
        'items',
        'total',
        'page',
        'pageSize',
        'counts',
      ]),
      properties: {
        items: expect.any(Object),
        total: expect.any(Object),
        page: expect.any(Object),
        pageSize: expect.any(Object),
        counts: expect.any(Object),
      },
    });
    expect(document.components?.schemas?.NotaryListCountsDto).toMatchObject({
      required: [
        'PENDING_EVIDENCE',
        'WAITING_UNBOX',
        'UNBOX_REVIEW',
        'ISSUANCE_DECISION',
        'WAITING_CERTIFICATE',
        'WAITING_RETURN',
        'ARCHIVED',
      ],
    });
  });

  it('documents the withdrawal application request and durable result', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation =
      document.paths['/api/v1/leads/{id}/withdrawal-applications']?.post;
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(document.components?.schemas?.ApplyLeadWithdrawalDto).toMatchObject({
      required: expect.arrayContaining(['reason', 'expectedVersion']),
      properties: {
        reason: { maxLength: 5000 },
        expectedVersion: { minimum: 1 },
      },
    });
    expect(
      document.components?.schemas?.LeadWithdrawalApplicationResponseDto,
    ).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'leadId',
        'status',
        'version',
        'reason',
        'applicantDisplayName',
        'appliedAt',
      ]),
    });
  });

  it('documents both client review conclusions and archive facts', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const schemas = document.components?.schemas;
    expect(schemas?.ReviewClientLeadDto).toMatchObject({
      properties: {
        result: { enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] },
        reason: { maxLength: 5000 },
      },
    });
    expect(schemas?.ClientLeadReviewResultDto).toMatchObject({
      properties: {
        status: { enum: ['WAITING_EVIDENCE_DECISION', 'ARCHIVED'] },
      },
    });
    expect(schemas?.ClientLeadResponseDto).toMatchObject({
      properties: {
        status: {
          enum: [
            'WAITING_REVIEW',
            'WAITING_EVIDENCE_DECISION',
            'TRANSFERRED_TO_NOTARY',
            'ARCHIVED',
          ],
        },
      },
    });
    expect(schemas?.ClientLeadReviewDecisionResponseDto).toMatchObject({
      properties: {
        result: { enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] },
        reason: { maxLength: 5000 },
        archiveType: { enum: ['NO_INFRINGEMENT'] },
        archivedAt: { format: 'date-time' },
      },
    });
  });

  it('documents confirmation input, key and safe client detail history', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation =
      document.paths['/api/v1/client/leads/{id}/withdrawal-confirmations']
        ?.post;
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(
      document.components?.schemas?.ConfirmClientLeadWithdrawalDto,
    ).toMatchObject({
      required: expect.arrayContaining(['applicationId', 'expectedVersion']),
      properties: {
        applicationId: { format: 'uuid' },
        expectedVersion: { minimum: 1 },
      },
    });
    expect(document.components?.schemas?.ClientLeadResponseDto).toMatchObject({
      required: expect.arrayContaining([
        'pendingWithdrawalApplication',
        'history',
        'capabilities',
      ]),
      properties: {
        pendingWithdrawalApplication: expect.any(Object),
        history: expect.any(Object),
      },
    });
    expect(
      document.components?.schemas?.ClientLeadHistoryResponseDto,
    ).toMatchObject({
      properties: {
        archiveType: { enum: ['NO_INFRINGEMENT', 'NO_EVIDENCE'] },
      },
    });
    expect(
      document.components?.schemas?.ClientLeadCapabilitiesResponseDto,
    ).toMatchObject({
      required: expect.arrayContaining(['review', 'confirmWithdrawal']),
    });
  });
});
