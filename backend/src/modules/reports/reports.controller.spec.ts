import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  GUARDS_METADATA,
  PATH_METADATA,
  HTTP_CODE_METADATA,
  MODULE_METADATA,
} from '@nestjs/common/constants';
import type { Response } from 'express';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsCenterQueryDto } from './reports-center.query.dto';
import { ReportsExportDto } from './reports-export.dto';
import { ReportsModule } from './reports.module';
import { CustomerModule, CustomerReportsSourceService } from '../customers';
import { LeadModule, NotaryReportsSourceService } from '../leads';
import { DatabaseModule } from '../../database/database.module';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 3,
};
function fixture() {
  const service = {
    capability: jest.fn().mockResolvedValue({ canRead: true }),
    overview: jest.fn().mockResolvedValue({ status: 'NO_RECORDS' }),
    center: jest.fn().mockResolvedValue({ status: 'NO_RECORDS', view: 'mine' }),
    export: jest.fn().mockResolvedValue({
      csv: '\uFEFF"维度","项目","数值"\r\n',
      filename: '案件报表_2026-10-21.csv',
    }),
  };
  return {
    service,
    controller: new ReportsController(service as unknown as ReportsService),
  };
}
describe('ReportsController', () => {
  it('wires source owners through public module exports without creating another query owner', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ReportsModule)).toEqual(
      expect.arrayContaining([DatabaseModule, CustomerModule, LeadModule]),
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CustomerModule),
    ).toContain(CustomerReportsSourceService);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, CustomerModule),
    ).toContain(CustomerReportsSourceService);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LeadModule),
    ).toContain(NotaryReportsSourceService);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, LeadModule)).toContain(
      NotaryReportsSourceService,
    );
  });
  function responseFixture() {
    const response = { setHeader: jest.fn(), send: jest.fn() };
    return { response, res: response as unknown as Response };
  }
  it('documents guarded POST export with a required view body and sends one UTF-8 CSV attachment', async () => {
    const { controller, service } = fixture();
    const { response, res } = responseFixture();
    expect(
      Reflect.getMetadata(PATH_METADATA, ReportsController.prototype.export),
    ).toBe('export');
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ReportsController.prototype.export,
      ),
    ).toBe(200);
    expect(
      Reflect.getMetadata(
        'swagger/apiResponse',
        ReportsController.prototype.export,
      )[200].content,
    ).toHaveProperty('text/csv');
    await controller.export(actor, { view: 'mine' }, {}, res);
    expect(service.export).toHaveBeenCalledWith(actor, 'mine');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="case-reports_2026-10-21.csv"; filename*=UTF-8\'\'' +
        encodeURIComponent('案件报表_2026-10-21.csv'),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.send).toHaveBeenCalledTimes(1);
    expect(response.send).toHaveBeenCalledWith(
      '\uFEFF"维度","项目","数值"\r\n',
    );
  });
  it.each([
    {},
    { view: null },
    { view: 'all' },
    { view: ['mine'] },
    { view: 'mine', departmentId: 'other' },
    { view: 'mine', columns: ['amount'] },
  ])(
    'rejects extra or invalid export bodies before service or response writes',
    async (input) => {
      const { controller, service } = fixture();
      const { response, res } = responseFixture();
      await expect(
        controller.export(
          actor,
          Object.assign(new ReportsExportDto(), input),
          {},
          res,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(service.export).not.toHaveBeenCalled();
      expect(response.setHeader).not.toHaveBeenCalled();
      expect(response.send).not.toHaveBeenCalled();
    },
  );
  it('rejects query scope anchors and sends no headers on authorization failure', async () => {
    const { controller, service } = fixture();
    const { response, res } = responseFixture();
    await expect(
      controller.export(
        actor,
        { view: 'mine' },
        { departmentId: 'other' },
        res,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.export).not.toHaveBeenCalled();
    const failure = new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    service.export.mockRejectedValue(failure);
    await expect(
      controller.export(actor, { view: 'mine' }, {}, res),
    ).rejects.toBe(failure);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
  });
  it('exposes only the center route with three result branches and resolves nested union models', async () => {
    const { controller, service } = fixture();
    expect(
      Reflect.getMetadata(PATH_METADATA, ReportsController.prototype.center),
    ).toBe('center');
    expect(
      Reflect.getMetadata(
        'swagger/apiResponse',
        ReportsController.prototype.center,
      )[200].schema.oneOf,
    ).toHaveLength(3);
    const models: Array<{ name: string }> = Reflect.getMetadata(
      'swagger/apiExtraModels',
      ReportsController,
    );
    expect(models.map((model) => model.name)).toEqual(
      expect.arrayContaining([
        'ReportKnownAmountValueDto',
        'ReportKnownAmountEmptyDto',
        'ReportClosureRateValueDto',
        'ReportClosureRateEmptyDto',
      ]),
    );
    await controller.center(actor, {});
    await controller.center(actor, { view: 'mine' });
    await controller.center(actor, { view: 'department' });
    expect(service.center.mock.calls).toEqual([
      [actor, undefined],
      [actor, 'mine'],
      [actor, 'department'],
    ]);
  });
  it.each([
    { view: 'all' },
    { view: null },
    { view: ['mine', 'department'] },
    { view: 'mine', departmentId: 'other' },
    { customerId: 'other' },
    { from: '2026-01-01' },
  ])(
    'rejects unsupported center inputs before calling the service',
    (query) => {
      const { controller, service } = fixture();
      expect(() =>
        controller.center(
          actor,
          Object.assign(new ReportsCenterQueryDto(), query),
        ),
      ).toThrow(BadRequestException);
      expect(service.center).not.toHaveBeenCalled();
    },
  );
  it('uses guarded internal report routes and an explicit three-way OpenAPI response', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ReportsController)).toBe(
      'reports',
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, ReportsController.prototype.overview),
    ).toBe('overview');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ReportsController.prototype.capability,
      ),
    ).toBe('capability');
    expect(Reflect.getMetadata(GUARDS_METADATA, ReportsController)).toEqual([
      ActorContextGuard,
      CsrfGuard,
    ]);
    const responses = Reflect.getMetadata(
      'swagger/apiResponse',
      ReportsController.prototype.overview,
    );
    expect(responses[200].schema.oneOf).toHaveLength(3);
  });
  it('passes only the trusted actor to the source-facing service', async () => {
    const { service, controller } = fixture();
    await controller.capability(actor, {});
    await controller.overview(actor, {});
    expect(service.capability).toHaveBeenCalledWith(actor);
    expect(service.overview).toHaveBeenCalledWith(actor);
  });
  it.each([
    { departmentId: 'other' },
    { customerId: 'other' },
    { from: '2026-01-01' },
    { period: 'MONTH' },
    { view: 'mine' },
  ])(
    'rejects unsupported scope and period inputs before invoking the service',
    (query) => {
      const { service, controller } = fixture();
      expect(() => controller.capability(actor, query)).toThrow(
        BadRequestException,
      );
      expect(() => controller.overview(actor, query)).toThrow(
        BadRequestException,
      );
      expect(service.capability).not.toHaveBeenCalled();
      expect(service.overview).not.toHaveBeenCalled();
    },
  );
});
