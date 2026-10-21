import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportsExportDto } from './reports-export.dto';

describe('report CSV explicit view body', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  it.each([{ view: 'mine' }, { view: 'department' }])(
    'accepts only an explicit supported view',
    async (body) => {
      await expect(
        validate(plainToInstance(ReportsExportDto, body), options),
      ).resolves.toHaveLength(0);
    },
  );
  it.each([
    {},
    { view: null },
    { view: 'all' },
    { view: ['mine'] },
    { view: 'mine', departmentId: 'other' },
    { view: 'mine', customerId: 'other' },
    { view: 'mine', stage: 'ARCHIVED' },
    { view: 'mine', columns: ['amount'] },
  ])(
    'rejects missing views and caller-supplied extra scope or columns',
    async (body) => {
      await expect(
        validate(plainToInstance(ReportsExportDto, body), options),
      ).resolves.not.toHaveLength(0);
    },
  );
});
