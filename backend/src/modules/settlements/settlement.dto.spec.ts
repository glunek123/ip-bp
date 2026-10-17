import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UpdateCaseSettlementTermsDto,
  SettlementPageDto,
} from './settlement.dto';
describe('settlement request runtime contract', () => {
  const body = {
    side: 'LAWYER',
    expectedTermsVersion: 0,
    idempotencyKey: 'original',
    lawyerMode: 'HALF_RISK',
    lawyerBaseFee: '9999999999999999.99',
    lawyerSplitPercent: '70.1234567890123456',
    manualAmount: null,
  };
  it('accepts exact decimal limits and an explicit nullable manual override', async () => {
    expect(
      await validate(plainToInstance(UpdateCaseSettlementTermsDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual([]);
  });
  it.each([
    'customerFormula',
    'lawyerMode',
    'lawyerBaseFee',
    'lawyerSplitPercent',
  ])('does not treat explicit null %s as an omitted term', async (field) => {
    const errors = await validate(
      plainToInstance(UpdateCaseSettlementTermsDto, { ...body, [field]: null }),
    );
    expect(errors.map((error) => error.property)).toContain(field);
  });
  it('rejects precision overflow and unknown write fields instead of silently changing their meaning', async () => {
    const errors = await validate(
      plainToInstance(UpdateCaseSettlementTermsDto, {
        ...body,
        lawyerBaseFee: '10000000000000000.00',
        lawyerSplitPercent: '70.12345678901234567',
        departmentId: 'forged',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'departmentId',
        'lawyerBaseFee',
        'lawyerSplitPercent',
      ]),
    );
  });
  it('admits the declared center filters through strict query whitelisting', async () => {
    expect(
      await validate(
        plainToInstance(SettlementPageDto, {
          side: 'CUSTOMER',
          keyword: '客户甲',
          stage: 'WAITING_ARCHIVE',
          billed: 'UNBILLED',
          from: '2026-10-01',
          to: '2026-10-17',
          page: '2',
          pageSize: '100',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toEqual([]);
  });
});
