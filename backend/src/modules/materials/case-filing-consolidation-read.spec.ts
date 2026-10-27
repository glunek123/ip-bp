import { ForbiddenException } from '@nestjs/common';
import { MaterialService } from './material.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';

describe('merged source material in filing history', () => {
  it('deduplicates exact versions and checks each original owner before exposing source files', async () => {
    const authorizeOwner = jest.fn().mockResolvedValue(undefined);
    const database = {
      materialReference: { findMany: jest.fn().mockResolvedValue([]) },
      caseFilingConsolidationSource: {
        findMany: jest.fn().mockResolvedValue([
          {
            category: 'FILING_EVIDENCE',
            materialId: 'm1',
            contentVersionId: versionId,
            material: {
              ownerType: 'LEAD',
              ownerId: 'lead-1',
              status: 'ACTIVE',
            },
            contentVersion: {
              originalFilename: 'original.pdf',
              mimeType: 'application/pdf',
              status: 'AVAILABLE',
            },
          },
          {
            category: 'FILING_EVIDENCE',
            materialId: 'm1',
            contentVersionId: versionId,
            material: {
              ownerType: 'LEAD',
              ownerId: 'lead-1',
              status: 'ACTIVE',
            },
            contentVersion: {
              originalFilename: 'original.pdf',
              mimeType: 'application/pdf',
              status: 'AVAILABLE',
            },
          },
        ]),
      },
    };
    const service = Object.create(MaterialService.prototype) as MaterialService;
    Object.assign(service, { database, authorizeOwner });
    expect(await service.listFrozenCaseFilingFiles(actor, caseId)).toEqual([
      {
        purpose: 'FILING_EVIDENCE',
        materialId: 'm1',
        contentVersionId: versionId,
        originalFilename: 'original.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    expect(authorizeOwner).toHaveBeenCalledWith(
      actor,
      'LEAD',
      'lead-1',
      'read',
      database,
      undefined,
      undefined,
      'FILING_EVIDENCE',
    );
    authorizeOwner.mockImplementation(
      async (_actor: unknown, ownerType: string) => {
        if (ownerType === 'LEAD') throw new ForbiddenException();
      },
    );
    expect(await service.listFrozenCaseFilingFiles(actor, caseId)).toEqual([]);
  });
});
