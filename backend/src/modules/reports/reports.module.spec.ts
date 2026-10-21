import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IDENTITY_ADAPTER } from '../../access-control/identity.adapter';
import { DatabaseService } from '../../database/database.service';
import { CaseReportsSourceService } from '../cases';
import { CustomerReportsSourceService } from '../customers';
import { NotaryReportsSourceService } from '../leads';
import { ReportsController } from './reports.controller';
import { ReportsModule } from './reports.module';
import { ReportsService } from './reports.service';
import type { Response } from 'express';

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        // The existing production storage provider is unavailable and performs
        // no filesystem IO. PRIVATE_FILE_ROOT is deliberately not configured.
        NODE_ENV: 'production',
        AUTH_THROTTLE_SECRET: 'reports-module-test-only',
      }),
    },
  ],
  exports: [ConfigService],
})
class ReportsTestConfigurationModule {}

describe('ReportsModule actual injection graph', () => {
  it('compiles real imported modules and connects Controller to Reports and all owner helpers without IO or startup', async () => {
    const tx = {};
    const database = {
      $transaction: jest.fn((run: (reader: typeof tx) => Promise<unknown>) =>
        run(tx),
      ),
      $connect: jest.fn(() => {
        throw new Error('Database connection forbidden in module compile test');
      }),
    };
    const identity = { resolve: jest.fn().mockReturnValue(null) };
    const backgroundStart = jest
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => {
        throw new Error('Background startup forbidden in module compile test');
      });
    let moduleRef: TestingModule | undefined;
    try {
      moduleRef = await Test.createTestingModule({
        imports: [ReportsTestConfigurationModule, ReportsModule],
      })
        .overrideProvider(DatabaseService)
        .useValue(database)
        .overrideProvider(IDENTITY_ADAPTER)
        .useValue(identity)
        .compile();
      expect(moduleRef.get(ConfigService).get('NODE_ENV')).toBe('production');
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(backgroundStart).not.toHaveBeenCalled();
      const controller = moduleRef.get(ReportsController),
        service = moduleRef.get(ReportsService);
      const cases = moduleRef.get(CaseReportsSourceService),
        customers = moduleRef.get(CustomerReportsSourceService),
        notaries = moduleRef.get(NotaryReportsSourceService);
      expect(controller).toBeInstanceOf(ReportsController);
      expect(service).toBeInstanceOf(ReportsService);
      expect(cases).toBeInstanceOf(CaseReportsSourceService);
      expect(customers).toBeInstanceOf(CustomerReportsSourceService);
      expect(notaries).toBeInstanceOf(NotaryReportsSourceService);
      const snapshot = {
        generatedAt: '2026-10-21T08:00:00.000Z',
        view: 'mine' as const,
        availableViews: ['mine' as const],
        exportViews: [],
        totalCases: 0,
        inProgressCases: 0,
        archivedClaims: [],
        allClaims: [],
        distributionCases: [],
      };
      const caseRead = jest
        .spyOn(cases, 'centerSnapshotInTransaction')
        .mockResolvedValue(snapshot);
      const caseExport = jest
        .spyOn(cases, 'exportSnapshot')
        .mockResolvedValue({ ...snapshot, stageCounts: [] });
      const customerCheck = jest
        .spyOn(customers, 'assertExportable')
        .mockResolvedValue(undefined);
      const notaryCheck = jest
        .spyOn(notaries, 'assertExportable')
        .mockResolvedValue(undefined);
      const customerCount = jest.spyOn(customers, 'count').mockResolvedValue(0);
      const notaryCount = jest.spyOn(notaries, 'count').mockResolvedValue(0);
      const actor = {
        userId: 'unit-operator',
        departmentId: 'unit-department',
        authorizationRevision: 1,
      };
      const center = jest.spyOn(service, 'center'),
        exportCsv = jest.spyOn(service, 'export');
      await expect(controller.center(actor, {})).resolves.toMatchObject({
        view: 'mine',
        status: 'NO_RECORDS',
        exportViews: ['mine'],
      });
      expect(center).toHaveBeenCalledWith(actor, undefined);
      expect(caseRead).toHaveBeenCalledWith(actor, undefined, tx);
      expect(customerCheck).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(notaryCheck).toHaveBeenCalledWith(actor, 'mine', tx);
      const response = { setHeader: jest.fn(), send: jest.fn() };
      await controller.export(
        actor,
        { view: 'mine' },
        {},
        response as unknown as Response,
      );
      expect(exportCsv).toHaveBeenCalledWith(actor, 'mine');
      expect(caseExport).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(customerCount).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(notaryCount).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(response.send).toHaveBeenCalledTimes(1);
      expect(database.$transaction).toHaveBeenCalledTimes(2);
      expect(database.$connect).not.toHaveBeenCalled();
      expect(identity.resolve).not.toHaveBeenCalled();
      expect(backgroundStart).not.toHaveBeenCalled();
    } finally {
      await moduleRef?.close();
      jest.restoreAllMocks();
    }
  });
});
