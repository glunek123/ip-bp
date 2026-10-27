import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseListExportController } from './case-list-export.controller';
import { CaseListExportService } from './case-list-export.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CaseListExportInput } from './case-list-export.dto';

describe('case special filters pure contract', () => {
  it('retains all inherited filters through the actual CSV method', async () => {
    const input = plainToInstance(CaseListExportInput, {
      shopName: ' 店铺 ',
      defendantName: ' 被告 ',
      courtName: ' 法院 ',
      lawyerName: ' 律师 ',
      caseType: 'CIVIL',
    });
    expect(
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    const exportCsv = jest.fn().mockResolvedValue({ csv: 'csv' });
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new CaseListExportController({
      export: exportCsv,
    } as never);
    await controller.export(actor, input, response as never);
    expect(exportCsv).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        shopName: '店铺',
        defendantName: '被告',
        courtName: '法院',
        lawyerName: '律师',
        caseType: 'CIVIL',
      }),
    );
    expect(response.send).toHaveBeenCalledWith('csv');
  });
});

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 2,
};

describe('case list export HTTP contract', () => {
  const exportCsv = jest.fn().mockResolvedValue({ csv: '\uFEFF"编号"\r\n' });
  const exportSelection = jest
    .fn()
    .mockResolvedValue({ csv: '\uFEFF"编号"\r\n' });
  const capability = jest.fn().mockResolvedValue({ canExport: true });
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseListExportController],
      providers: [
        {
          provide: CaseListExportService,
          useValue: { export: exportCsv, exportSelection, capability },
        },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { actor?: ActorContext } };
        }) => {
          context.switchToHttp().getRequest().actor = actor;
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('serves the current capability and documents a boolean response', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation = document.paths['/api/v1/cases/exports/capability']?.get;
    expect(operation).toBeDefined();
    const schema = document.components?.schemas?.CaseListExportCapabilityDto;
    if (!schema || !('properties' in schema))
      throw new Error('capability schema missing');
    expect(schema.properties?.canExport).toMatchObject({ type: 'boolean' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/cases/exports/capability')
      .expect(200);
    expect(response.body).toEqual({ canExport: true });
    expect(capability).toHaveBeenCalledWith(actor);
    expect(exportCsv).not.toHaveBeenCalled();
  });

  it('returns the fixed CSV attachment and documents a body without paging or anchors', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation = document.paths['/api/v1/cases/exports/csv']?.post;
    expect(operation).toBeDefined();
    const csvResponse = operation?.responses['200'];
    if (!csvResponse || !('content' in csvResponse))
      throw new Error('CSV response schema missing');
    expect(csvResponse.content).toHaveProperty('text/csv');
    const schema = document.components?.schemas?.CaseListExportInput;
    if (!schema || !('properties' in schema))
      throw new Error('CSV input schema missing');
    expect(schema.properties).toHaveProperty('view');
    expect(schema.properties).toHaveProperty('courtCaseNo');
    expect(schema.properties).not.toHaveProperty('page');
    expect(schema.properties).not.toHaveProperty('pageSize');
    expect(schema.properties).not.toHaveProperty('departmentId');

    const response = await request(app.getHttpServer())
      .post('/api/v1/cases/exports/csv')
      .send({ view: 'mine', q: '编号', sortBy: 'businessNo' })
      .expect(200);
    expect(response.headers['content-type']).toMatch(
      /^text\/csv; charset=utf-8/u,
    );
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="case-list.csv"',
    );
    expect(response.text).toBe('\uFEFF"编号"\r\n');
    expect(exportCsv).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        view: 'mine',
        q: '编号',
        sortBy: 'businessNo',
      }),
    );
  });

  it('rejects undeclared paging, identity anchors and invalid query values before service', async () => {
    for (const input of [
      { page: 1 },
      { pageSize: 20 },
      { ids: ['case-id'] },
      { departmentId: actor.departmentId },
      { actorUserId: actor.userId },
      { q: 'x'.repeat(201) },
      { sortBy: 'unknown' },
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/cases/exports/csv')
        .send(input)
        .expect(400);
      expect(exportCsv).not.toHaveBeenCalled();
    }
  });

  it('accepts an explicit selection and rejects duplicate or undeclared IDs', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer())
      .post('/api/v1/cases/exports/selection')
      .send({ view: 'mine', ids: [id] })
      .expect(200);
    expect(exportSelection).toHaveBeenCalledWith(actor, {
      view: 'mine',
      ids: [id],
    });
    expect(exportCsv).not.toHaveBeenCalled();
    for (const body of [
      { view: 'mine', ids: [id, id] },
      { view: 'department', ids: [] },
      { view: 'department', ids: [id], q: 'unrequested' },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/cases/exports/selection')
        .send(body)
        .expect(400);
  });
});
