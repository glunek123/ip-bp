import 'reflect-metadata';
import {
  ARCHIVED_CASE_AVERAGE_VERSION,
  ArchivedCaseAverageNoRecordsDto,
  ArchivedCaseAverageUnavailableDto,
  ArchivedCaseAverageValueDto,
} from './reports.dto';

describe('RP001 fixed response contract', () => {
  it('distinguishes no cases, no known amounts and a real zero without client scope', () => {
    const value = Object.assign(new ArchivedCaseAverageValueDto(), {
      amount: '0.00',
    });
    expect(value).toMatchObject({
      status: 'VALUE',
      amount: '0.00',
      reason: null,
      metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
      currency: 'CNY',
      scope: 'DEPARTMENT',
      period: 'ALL_TIME',
      definitionVersion: ARCHIVED_CASE_AVERAGE_VERSION,
    });
    expect(new ArchivedCaseAverageNoRecordsDto()).toMatchObject({
      status: 'NO_RECORDS',
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
    });
    expect(new ArchivedCaseAverageUnavailableDto()).toMatchObject({
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
    });
  });

  it('documents decimal strings and explicit null states in OpenAPI', () => {
    const amount = Reflect.getMetadata(
      'swagger/apiModelProperties',
      ArchivedCaseAverageValueDto.prototype,
      'amount',
    );
    expect(amount.type).toBe(String);
    expect(new RegExp(amount.pattern).test('0.00')).toBe(true);
    expect(new RegExp(amount.pattern).test('0')).toBe(false);
    for (const dto of [
      ArchivedCaseAverageNoRecordsDto,
      ArchivedCaseAverageUnavailableDto,
    ]) {
      expect(
        Reflect.getMetadata(
          'swagger/apiModelProperties',
          dto.prototype,
          'amount',
        ),
      ).toMatchObject({ type: String, nullable: true, enum: [null] });
    }
  });

  it('documents the three same-department case counts independently of average availability', () => {
    for (const dto of [
      ArchivedCaseAverageValueDto,
      ArchivedCaseAverageNoRecordsDto,
      ArchivedCaseAverageUnavailableDto,
    ]) {
      for (const key of ['totalCases', 'inProgressCases', 'archivedCases']) {
        expect(
          Reflect.getMetadata('swagger/apiModelProperties', dto.prototype, key),
        ).toMatchObject({ type: 'integer', minimum: 0 });
      }
    }
  });
});
