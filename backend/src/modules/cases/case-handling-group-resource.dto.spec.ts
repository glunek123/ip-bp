import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CaseHandlingGroupFeesDto,
  CaseHandlingGroupMaterialsDto,
  CaseHandlingGroupMaterialRowDto,
  CaseHandlingGroupNotarySummaryDto,
  CaseHandlingGroupResourcePageQueryDto,
} from './case-handling-group-resource.dto';
const options = { whitelist: true, forbidNonWhitelisted: true };
describe('handling group resource DTO contract', () => {
  it('defaults paging to twenty and accepts a maximum of one hundred', async () => {
    const defaults = plainToInstance(CaseHandlingGroupResourcePageQueryDto, {});
    expect(defaults).toEqual({ page: 1, pageSize: 20 });
    await expect(validate(defaults, options)).resolves.toHaveLength(0);
    const last = plainToInstance(CaseHandlingGroupResourcePageQueryDto, {
      page: '2',
      pageSize: '100',
    });
    await expect(validate(last, options)).resolves.toHaveLength(0);
    expect(last).toEqual({ page: 2, pageSize: 100 });
  });
  it.each([
    { page: 0 },
    { page: 1.5 },
    { pageSize: 101 },
    { pageSize: 0 },
    { caseIds: ['other'] },
    { departmentId: 'other' },
    { customerId: 'other' },
  ])(
    'rejects invalid paging and caller-supplied scope anchors',
    async (input) => {
      await expect(
        validate(
          plainToInstance(CaseHandlingGroupResourcePageQueryDto, input),
          options,
        ),
      ).resolves.not.toHaveLength(0);
    },
  );
  it('retains exact CV identity and excludes fee proofs from material category metadata', () => {
    const fields = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      CaseHandlingGroupMaterialRowDto.prototype,
    ) as string[];
    expect(fields).toEqual(
      expect.arrayContaining([
        ':caseId',
        ':businessNo',
        ':materialId',
        ':contentVersionId',
        ':sizeBytes',
        ':sha256',
        ':isCurrent',
      ]),
    );
    const category = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CaseHandlingGroupMaterialRowDto.prototype,
      'category',
    );
    expect(category.enum).not.toContain('FEE_PROOF');
    const size = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CaseHandlingGroupMaterialRowDto.prototype,
      'sizeBytes',
    );
    expect(size.type).toBe(String);
  });
  it('keeps group snapshot fields on both responses and explicit unreadable/null ledger metadata', () => {
    for (const dto of [
      CaseHandlingGroupMaterialsDto,
      CaseHandlingGroupFeesDto,
    ]) {
      const fields = Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        dto.prototype,
      ) as string[];
      expect(fields).toEqual(
        expect.arrayContaining([':groupId', ':revision', ':status']),
      );
    }
    const fields = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      CaseHandlingGroupFeesDto.prototype,
    ) as string[];
    expect(fields).toContain(':notarySummaries');
    expect(fields).toContain(':canReadLedger');
    expect(fields).toContain(':ledger');
    expect(fields).not.toContain(':summary');
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        CaseHandlingGroupFeesDto.prototype,
        'ledger',
      ).nullable,
    ).toBe(true);
  });
  it('documents both original notary sources including sample evidence', () => {
    const source = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CaseHandlingGroupNotarySummaryDto.prototype,
      'sourceType',
    );
    const category = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CaseHandlingGroupNotarySummaryDto.prototype,
      'category',
    );
    expect(source.enum).toEqual([
      'NOTARY_CERTIFICATE_FEE',
      'NOTARY_MATTER_EVIDENCE',
    ]);
    expect(category.enum).toEqual([
      'NOTARY',
      'INVESTIGATION',
      'DISCLOSURE',
      'SAMPLE',
    ]);
    expect(
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        CaseHandlingGroupNotarySummaryDto.prototype,
        'amount',
      ),
    ).toMatchObject({ type: String, nullable: true });
  });
});
