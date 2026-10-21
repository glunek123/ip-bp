import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportsCenterQueryDto } from './reports-center.query.dto';

describe('reports center view query', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  it.each([{}, { view: 'mine' }, { view: 'department' }])(
    'accepts an optional explicit supported view',
    async (query) => {
      await expect(
        validate(plainToInstance(ReportsCenterQueryDto, query), options),
      ).resolves.toHaveLength(0);
    },
  );
  it.each([
    { view: null },
    { view: 'all' },
    { view: ['mine'] },
    { departmentId: 'other' },
    { customerId: 'other' },
    { from: '2026-01-01' },
    { view: 'mine', amountScope: 'department' },
  ])(
    'rejects invalid views and caller-selected scope anchors',
    async (query) => {
      await expect(
        validate(plainToInstance(ReportsCenterQueryDto, query), options),
      ).resolves.not.toHaveLength(0);
    },
  );
});
