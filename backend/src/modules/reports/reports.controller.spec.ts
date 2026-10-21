import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 3,
};
function fixture() {
  const service = {
    capability: jest.fn().mockResolvedValue({ canRead: true }),
    overview: jest.fn().mockResolvedValue({ status: 'NO_RECORDS' }),
  };
  return {
    service,
    controller: new ReportsController(service as unknown as ReportsService),
  };
}
describe('ReportsController', () => {
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
