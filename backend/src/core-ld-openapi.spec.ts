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
import { CustomerLifecycleService } from './modules/customers/customer-lifecycle.service';
import { CustomerController } from './modules/customers/customer.controller';
import { CustomerCooperationController } from './modules/customers/customer-cooperation.controller';
import { CustomerCooperationService } from './modules/customers/customer-cooperation.service';
import { CustomerService } from './modules/customers/customer.service';
import { CustomerContactController } from './modules/customers/customer-contact.controller';
import { CustomerContactService } from './modules/customers/customer-contact.service';
import { CustomerAgreementInvoiceController } from './modules/customers/customer-agreement-invoice.controller';
import { CustomerAgreementInvoiceService } from './modules/customers/customer-agreement-invoice.service';
import { ClientLeadController } from './modules/leads/client-lead.controller';
import { ClientLeadService } from './modules/leads/client-lead.service';
import { ClientNotaryController } from './modules/leads/client-notary.controller';
import { ClientNotaryService } from './modules/leads/client-notary.service';
import { LeadController } from './modules/leads/lead.controller';
import { LeadService } from './modules/leads/lead.service';
import { NotaryListController } from './modules/leads/notary-list.controller';
import { NotaryListService } from './modules/leads/notary-list.service';
import { NotaryListPreferenceService } from './modules/leads/notary-list-preference.service';
import { NotaryListExportController } from './modules/leads/notary-list-export.controller';
import { NotaryListExportService } from './modules/leads/notary-list-export.service';
import { NotaryReturnArchiveBatchController } from './modules/leads/notary-return-archive-batch.controller';
import { NotaryReturnArchiveBatchService } from './modules/leads/notary-return-archive-batch.service';
import { CaseReadController } from './modules/cases/case-read.controller';
import { CaseReadService } from './modules/cases/case-read.service';
import { CaseMatchService } from './modules/cases/case-match.service';
import { CaseComplaintService } from './modules/cases/case-complaint.service';
import { CaseComplaintConfirmationService } from './modules/cases/case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './modules/cases/case-complaint-mailing.service';
import { CaseFilingService } from './modules/cases/case-filing.service';
import { CaseAcceptanceService } from './modules/cases/case-acceptance.service';
import { CaseHearingService } from './modules/cases/case-hearing.service';
import { CaseJudgmentService } from './modules/cases/case-judgment.service';
import { FilingCourtService } from './modules/cases/filing-court.service';

describe('CORE-LD-002 OpenAPI contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        CustomerController,
        CustomerCooperationController,
        CustomerContactController,
        CustomerAgreementInvoiceController,
        LeadController,
        ClientLeadController,
        ClientNotaryController,
        NotaryListController,
        NotaryListExportController,
        NotaryReturnArchiveBatchController,
        CaseReadController,
      ],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: CustomerCooperationService, useValue: {} },
        { provide: CustomerContactService, useValue: {} },
        { provide: CustomerAgreementInvoiceService, useValue: {} },
        { provide: CustomerLifecycleService, useValue: {} },
        { provide: CustomerAdmissionService, useValue: {} },
        { provide: CustomerAccountService, useValue: {} },
        { provide: LeadService, useValue: {} },
        { provide: ClientLeadService, useValue: {} },
        { provide: ClientNotaryService, useValue: {} },
        { provide: NotaryListService, useValue: {} },
        { provide: NotaryListPreferenceService, useValue: {} },
        { provide: NotaryListExportService, useValue: {} },
        { provide: NotaryReturnArchiveBatchService, useValue: {} },
        { provide: CaseReadService, useValue: {} },
        { provide: CaseMatchService, useValue: {} },
        { provide: CaseComplaintService, useValue: {} },
        { provide: CaseComplaintConfirmationService, useValue: {} },
        { provide: CaseComplaintMailingService, useValue: {} },
        { provide: CaseFilingService, useValue: {} },
        { provide: CaseAcceptanceService, useValue: {} },
        { provide: CaseHearingService, useValue: {} },
        { provide: CaseJudgmentService, useValue: {} },
        { provide: FilingCourtService, useValue: {} },
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
      '/api/v1/customers/{customerId}/agreements',
      '200',
      'AgreementResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/agreements',
      '201',
      'AgreementResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{customerId}/agreements/{agreementId}',
      '200',
      'AgreementResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{customerId}/agreements/{agreementId}/versions',
      '200',
      'AgreementVersionListResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/agreements/{agreementId}/revisions',
      '200',
      'AgreementResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{customerId}/invoice-profile',
      '200',
      'InvoiceResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/invoice-profile',
      '201',
      'InvoiceResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{customerId}/invoice-profile/versions',
      '200',
      'InvoiceVersionListResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/invoice-profile/revisions',
      '200',
      'InvoiceResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{customerId}/contacts',
      '200',
      'ContactListResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{customerId}/contacts/{contactId}/versions',
      '200',
      'ContactVersionListResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/contacts',
      '201',
      'ContactCommandResultResponseDto',
    ],
    [
      'patch',
      '/api/v1/customers/{customerId}/contacts/{contactId}',
      '200',
      'ContactCommandResultResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/contacts/{contactId}/primary',
      '200',
      'ContactCommandResultResponseDto',
    ],
    [
      'post',
      '/api/v1/customers/{customerId}/contacts/{contactId}/end',
      '200',
      'ContactCommandResultResponseDto',
    ],
    [
      'get',
      '/api/v1/customers/{id}/eligible-operators',
      '200',
      'EligibleOperatorPageDto',
    ],
    [
      'post',
      '/api/v1/customers/{id}/responsible-transfer',
      '201',
      'CustomerMaintenanceResultDto',
    ],
    [
      'post',
      '/api/v1/customers/{id}/cooperation',
      '201',
      'CustomerMaintenanceResultDto',
    ],
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
    [
      'post',
      '/api/v1/notary-matters/return-archive-batches',
      '201',
      'NotaryReturnArchiveBatchResponseDto',
    ],
    [
      'get',
      '/api/v1/notary-matters/list-preference',
      '200',
      'NotaryListPreferenceDto',
    ],
    [
      'put',
      '/api/v1/notary-matters/list-preference',
      '200',
      'NotaryListPreferenceDto',
    ],
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
    ['post', '/api/v1/cases/{id}/filing-courts', '201', 'FilingCourtDto'],
    [
      'post',
      '/api/v1/cases/{id}/filing-submit',
      '201',
      'SubmitCaseFilingResponseDto',
    ],
    [
      'post',
      '/api/v1/cases/{id}/acceptance-register',
      '201',
      'RegisterCaseAcceptanceResponseDto',
    ],
    [
      'post',
      '/api/v1/cases/{id}/hearing-schedule',
      '201',
      'CaseHearingCommandResultDto',
    ],
    [
      'post',
      '/api/v1/cases/{id}/hearing-correct',
      '201',
      'CaseHearingCommandResultDto',
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

  it.each([
    '/api/v1/customers/{id}/responsible-transfer',
    '/api/v1/customers/{id}/cooperation',
  ] as const)('documents POST %s as 201, not 200', (path) => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const responses = document.paths[path]?.post?.responses;
    expect(responses?.['201']).toBeDefined();
    expect(responses?.['200']).toBeUndefined();
  });

  it.each([
    '/api/v1/customers/{customerId}/contacts/{contactId}/primary',
    '/api/v1/customers/{customerId}/contacts/{contactId}/end',
  ] as const)('documents POST %s as 200', (path) => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const responses = document.paths[path]?.post?.responses;
    expect(responses?.['200']).toBeDefined();
    expect(responses?.['201']).toBeUndefined();
  });

  it.each([
    ['/api/v1/customers/{customerId}/agreements', '201', '200'],
    [
      '/api/v1/customers/{customerId}/agreements/{agreementId}/revisions',
      '200',
      '201',
    ],
    ['/api/v1/customers/{customerId}/invoice-profile', '201', '200'],
    ['/api/v1/customers/{customerId}/invoice-profile/revisions', '200', '201'],
  ] as const)(
    'documents CU007 POST %s as %s only',
    (path, expected, absent) => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      const responses = document.paths[path]?.post?.responses;
      expect(responses?.[expected]).toBeDefined();
      expect(responses?.[absent]).toBeUndefined();
    },
  );

  it.each([
    [
      'ContactSummaryResponseDto',
      ['phone', 'email', 'duty', 'endedAt', 'endReason'],
    ],
    ['ContactCommandResultResponseDto', ['primaryContactId']],
    ['ContactListResponseDto', ['primaryContactId']],
    [
      'ContactVersionSnapshotResponseDto',
      ['phone', 'email', 'duty', 'endedAt', 'endReason'],
    ],
    ['ContactVersionActorResponseDto', ['userId']],
    [
      'AgreementVersionResponseDto',
      ['model', 'settlementMethod', 'effectiveFrom', 'effectiveTo'],
    ],
    [
      'InvoiceVersionResponseDto',
      ['invoiceType', 'invoiceSubject', 'taxNo', 'bank'],
    ],
  ] as const)(
    'documents %s nullable scalar responses as required strings',
    (name, fields) => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      const schema = document.components?.schemas?.[name] as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const field of fields) {
        expect(schema.required).toContain(field);
        expect(schema.properties?.[field]).toMatchObject({
          type: 'string',
          nullable: true,
        });
      }
    },
  );

  it.each([
    [
      'CreateAgreementDto',
      ['model', 'settlementMethod', 'effectiveFrom', 'effectiveTo'],
    ],
    [
      'ReviseAgreementDto',
      ['model', 'settlementMethod', 'effectiveFrom', 'effectiveTo'],
    ],
    [
      'CreateInvoiceProfileDto',
      ['invoiceType', 'invoiceSubject', 'taxNo', 'bank'],
    ],
    [
      'ReviseInvoiceProfileDto',
      ['invoiceType', 'invoiceSubject', 'taxNo', 'bank'],
    ],
  ] as const)('documents CU007 %s nullable request strings', (name, fields) => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const schema = document.components?.schemas?.[name] as {
      properties?: Record<string, unknown>;
    };
    for (const field of fields)
      expect(schema.properties?.[field]).toMatchObject({
        type: 'string',
        nullable: true,
      });
  });

  it.each(['CreateContactDto', 'UpdateContactDto'] as const)(
    'documents %s nullable request scalars as strings',
    (name) => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      const schema = document.components?.schemas?.[name] as {
        properties?: Record<string, unknown>;
      };
      for (const field of ['phone', 'email', 'duty'])
        expect(schema.properties?.[field]).toMatchObject({
          type: 'string',
          nullable: true,
        });
    },
  );

  it.each([
    [
      '/api/v1/cases/{id}/hearing-schedule',
      'SaveCaseHearingDto',
      ['expectedVersion', 'idempotencyKey', 'hearingAt'],
    ],
    [
      '/api/v1/cases/{id}/hearing-correct',
      'CorrectCaseHearingDto',
      ['expectedVersion', 'idempotencyKey', 'hearingAt', 'reason'],
    ],
  ] as const)(
    'documents required request metadata for %s',
    (path, schemaName, requiredFields) => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      const operation = document.paths[path]?.post;
      expect(operation?.requestBody).toMatchObject({
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaName}` },
          },
        },
      });
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'id', in: 'path', required: true }),
        ]),
      );
      expect(document.components?.schemas?.[schemaName]).toMatchObject({
        required: expect.arrayContaining(requiredFields),
      });
    },
  );

  it('documents nullable internal judgment registration reason', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    expect(document.components?.schemas?.CaseJudgmentFactDto).toMatchObject({
      properties: { reason: { type: 'string', nullable: true } },
    });
  });

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

  it('documents the full replacement list preference request', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation =
      document.paths['/api/v1/notary-matters/list-preference']?.put;
    expect(operation?.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/NotaryListPreferenceDto' },
        },
      },
    });
    expect(document.components?.schemas?.NotaryListPreferenceDto).toMatchObject(
      {
        required: ['order', 'hidden'],
        description: expect.stringContaining('不接受额外字段'),
        properties: {
          order: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            uniqueItems: true,
            description: expect.stringContaining('前两项必须依次'),
          },
          hidden: {
            type: 'array',
            minItems: 0,
            maxItems: 3,
            uniqueItems: true,
            description: expect.stringContaining('固定列不可隐藏'),
          },
        },
      },
    );
  });

  it('documents preview and bounded CSV export requests', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const preview =
      document.paths['/api/v1/notary-matters/exports/preview']?.post;
    const generate = document.paths['/api/v1/notary-matters/exports']?.post;
    expect(preview?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PreviewNotaryListExportDto' },
        },
      },
    });
    expect(preview?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/NotaryListExportPreviewResponseDto',
          },
        },
      },
    });
    expect(generate?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/GenerateNotaryListExportDto' },
        },
      },
    });
    expect(
      document.components?.schemas?.GenerateNotaryListExportDto,
    ).toMatchObject({
      required: expect.arrayContaining(['mode', 'expectedCount']),
      properties: { expectedCount: { minimum: 1, maximum: 1000 } },
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
