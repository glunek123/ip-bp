import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ArchiveCaseInput,
  CorrectCaseArchiveInput,
  caseArchiveTypes,
} from './case-archive.dto';
const input = {
  expectedVersion: 26,
  idempotencyKey: 'original',
  expectedClosureVersionId: '11111111-1111-4111-8111-111111111111',
  archiveAt: '2020-01-01',
  archiveType: 'SETTLEMENT',
  archiveReason: '真实原因',
};
describe('archive DTO', () => {
  it.each(caseArchiveTypes)(
    'accepts the fixed classification %s',
    (archiveType) => {
      expect(
        validateSync(
          plainToInstance(ArchiveCaseInput, { ...input, archiveType }),
        ),
      ).toEqual([]);
    },
  );
  it('requires every explicit field and rejects unknown fields', () => {
    for (const key of Object.keys(input))
      expect(
        validateSync(
          plainToInstance(
            ArchiveCaseInput,
            Object.fromEntries(
              Object.entries(input).filter(([k]) => k !== key),
            ),
          ),
        ).length,
      ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(ArchiveCaseInput, { ...input, extra: true }),
        { whitelist: true, forbidNonWhitelisted: true },
      ).length,
    ).toBeGreaterThan(0);
  });
  it('requires the exact prior archive and nonblank correction reason', () => {
    expect(
      validateSync(
        plainToInstance(CorrectCaseArchiveInput, {
          ...input,
          expectedArchiveVersionId: input.expectedClosureVersionId,
          correctionReason: '真实更正',
        }),
      ),
    ).toEqual([]);
    expect(
      validateSync(
        plainToInstance(CorrectCaseArchiveInput, {
          ...input,
          correctionReason: '\n\t',
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
