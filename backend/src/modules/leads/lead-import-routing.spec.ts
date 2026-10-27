import 'reflect-metadata';
import { ExecutionContext, INestApplication, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { AccessControlService } from '../../access-control/access-control.service';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { LeadCsvImportController } from './lead-csv-import.controller';
import { ClientLeadService } from './client-lead.service';
import { LeadController } from './lead.controller';
import { LeadModule } from './lead.module';
import { LeadService } from './lead.service';
import { createLeadWorkbookTemplate } from './lead-workbook';

describe('lead import HTTP routing', () => {
  let app: INestApplication;
  const leads = { get: jest.fn(), importBatch: jest.fn() };
  const access = { canAuthorizeNewLead: jest.fn().mockResolvedValue(true) };
  const actor = { userId: 'operator' };

  beforeAll(async () => {
    // Preserve the production module order: a competing :id route must not
    // swallow the static import routes.
    const controllers = (
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        LeadModule,
      ) as Type<unknown>[]
    ).filter(
      (controller) =>
        controller === LeadController || controller === LeadCsvImportController,
    );
    const module = await Test.createTestingModule({
      controllers,
      providers: [
        { provide: LeadService, useValue: leads },
        { provide: ClientLeadService, useValue: {} },
        { provide: AccessControlService, useValue: access },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().actor = actor;
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('routes workbook template and preview before the lead detail parameter', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/leads/xlsx-template')
      .expect('Content-Type', /spreadsheetml/)
      .expect(200);
    const preview = await request(app.getHttpServer())
      .post('/api/v1/leads/xlsx-preview')
      .set(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .send(Buffer.from(createLeadWorkbookTemplate()))
      .expect(201);
    expect(preview.body.sheets).toHaveLength(1);
    expect(leads.get).not.toHaveBeenCalled();
  });

  it('still routes a valid UUID to the normal lead detail endpoint', async () => {
    const id = '046e1324-a2d4-4d4c-87e1-f88979d46e55';
    leads.get.mockResolvedValueOnce({ id });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/leads/${id}`)
      .expect(200);
    expect(response.body).toEqual({ id });
    expect(leads.get).toHaveBeenCalledWith(actor, id);
  });

  it('passes a valid imported lead and operator through the global validation pipe', async () => {
    const body = {
      items: [
        {
          rowNumber: 2,
          operatorText: '导入owner-0b68ec8c6773',
          remoteScreenshots: [],
          input: {
            customerId: '3e2a052a-dd46-40a5-ada8-e79a3379fd56',
            rightsHolderId: '7f6e678a-05ff-4c8a-ab00-363f272363ec',
            caseType: 'CIVIL',
            infringementTypes: ['TRADEMARK'],
            source: 'ONLINE',
            platform: 'TAOBAO',
            foundAt: '2026-10-27T00:00:00.000Z',
            shopName: '异人运营-02d7bf38-d529-46e9-8ba4-d08477e0d042',
            needDisclose: false,
            products: [
              {
                title: '合成商品1',
                url: 'https://example.com/product-1',
                quantity: 0,
                unitPrice: '0',
                commentCount: 0,
              },
            ],
            leadScreenshotContentVersionIds: [],
          },
        },
      ],
    };
    leads.importBatch.mockResolvedValueOnce({ items: [] });
    await request(app.getHttpServer())
      .post('/api/v1/leads/csv-import')
      .set('Idempotency-Key', 'synthetic-import')
      .send(body)
      .expect(201);
    expect(leads.importBatch).toHaveBeenCalledWith(
      actor,
      'synthetic-import',
      expect.objectContaining({ items: expect.any(Array) }),
    );
  });
});
