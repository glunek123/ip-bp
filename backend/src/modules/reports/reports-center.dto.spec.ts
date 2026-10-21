import 'reflect-metadata';
import { LeadCaseType, LeadPlatform } from '../../generated/prisma/enums';
import {
  ReportDistributionsDto,
  ReportPlatformCountDto,
  ReportTypeCountDto,
  ReportsCenterMetadataDto,
  ReportKnownAmountEmptyDto,
  ReportMoneyDto,
  ReportsCenterNoRecordsDto,
  ReportsCenterUnavailableDto,
  ReportsCenterValueDto,
} from './reports-center.dto';

describe('reports center additive contract', () => {
  it('adds exactly four distribution fields and preserves all three overview result branches', () => {
    expect(
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        ReportDistributionsDto.prototype,
      ),
    ).toEqual([':types', ':platforms', ':courts', ':unrecordedCourtCases']);
    for (const dto of [
      ReportsCenterValueDto,
      ReportsCenterNoRecordsDto,
      ReportsCenterUnavailableDto,
    ]) {
      expect(
        Reflect.getMetadata(
          'swagger/apiModelProperties',
          dto.prototype,
          'distributions',
        ).type,
      ).toBe(ReportDistributionsDto);
      expect(Object.assign(new dto(), { scope: 'SELF' })).toMatchObject({
        currency: 'CNY',
        period: 'ALL_TIME',
        scope: 'SELF',
        definitionVersion: 'RP001-2',
      });
    }
    expect(new ReportsCenterNoRecordsDto().status).toBe('NO_RECORDS');
    expect(new ReportsCenterUnavailableDto().reason).toBe('NO_KNOWN_AMOUNT');
  });
  it('defines actual center views separately from legacy department-only metadata and export availability', () => {
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportsCenterMetadataDto.prototype,
        'scope',
      ).enum,
    ).toEqual(['SELF', 'DEPARTMENT']);
    expect(
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        ReportMoneyDto.prototype,
      ),
    ).toEqual([':total', ':knownCases', ':unknownCases', ':buckets']);
    const empty = Object.assign(new ReportKnownAmountEmptyDto(), {
      status: 'NO_KNOWN_AMOUNT',
    });
    expect(empty).toMatchObject({
      amount: null,
    });
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportMoneyDto.prototype,
        'total',
      ).oneOf,
    ).toHaveLength(2);
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportsCenterMetadataDto.prototype,
        'availableViews',
      ),
    ).toMatchObject({
      items: { type: 'string', enum: ['mine', 'department'] },
      isArray: true,
      minItems: 1,
      maxItems: 2,
    });
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportsCenterMetadataDto.prototype,
        'money',
      ).type,
    ).toBe(ReportMoneyDto);
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportsCenterMetadataDto.prototype,
        'closureRate',
      ).oneOf,
    ).toHaveLength(2);
  });
  it('documents only formal enums, nullable unknown categories and a five-court limit', () => {
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportTypeCountDto.prototype,
        'value',
      ),
    ).toMatchObject({ enum: Object.values(LeadCaseType), nullable: true });
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportPlatformCountDto.prototype,
        'value',
      ),
    ).toMatchObject({ enum: Object.values(LeadPlatform), nullable: true });
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        ReportDistributionsDto.prototype,
        'courts',
      ).maxItems,
    ).toBe(5);
  });
});
