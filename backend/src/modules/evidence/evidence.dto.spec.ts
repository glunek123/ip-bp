import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  EvidenceListQueryDto,
  SaveEvidenceGroupDto,
  BulkEvidenceStatusDto,
} from './evidence.dto';

const itemId = '11111111-1111-4111-8111-111111111111';
const paperId = '22222222-2222-4222-8222-222222222222';

describe('Evidence DTO boundary', () => {
  it('normalizes a single stage query and rejects unknown stages and impossible calendar dates', () => {
    const query = plainToInstance(EvidenceListQueryDto, {
      stages: 'WAITING_HEARING',
      hearFrom: '2026-10-17',
    });
    expect(query.stages).toEqual(['WAITING_HEARING']);
    expect(validateSync(query)).toHaveLength(0);
    for (const value of [
      { stages: ['UNKNOWN'] },
      { hearFrom: '2026-02-30' },
      { pageSize: 101 },
    ])
      expect(
        validateSync(plainToInstance(EvidenceListQueryDto, value)),
      ).not.toHaveLength(0);
  });

  it('accepts explicitly empty drafts and validates every row instead of coercing manual status', () => {
    expect(
      validateSync(
        plainToInstance(SaveEvidenceGroupDto, {
          expectedGroupVersion: 1,
          rows: [],
        }),
      ),
    ).toHaveLength(0);
    const row = {
      id: itemId,
      displayCode: '',
      shelfLocation: '',
      status: 'UNDELIVERED',
      manualStatus: false,
    };
    expect(
      validateSync(
        plainToInstance(SaveEvidenceGroupDto, {
          expectedGroupVersion: 1,
          rows: [row],
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(SaveEvidenceGroupDto, {
          expectedGroupVersion: 1,
          rows: [{ ...row, manualStatus: 'false' }],
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('rejects foreign fields and duplicate selected IDs in bulk commands', () => {
    const input = {
      evidenceIds: [itemId],
      paperCertificateIds: [paperId],
      evidenceStatus: 'DESTROYED',
    };
    expect(
      validateSync(plainToInstance(BulkEvidenceStatusDto, input)),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(BulkEvidenceStatusDto, {
          ...input,
          evidenceIds: [itemId, itemId],
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(BulkEvidenceStatusDto, {
          ...input,
          departmentId: 'foreign',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
  });
});
