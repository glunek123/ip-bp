import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { CaseFileCatalogService } from './case-file-catalog.service';

const caseId = '11111111-1111-4111-8111-111111111111';
const materialId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const actor = { userId: 'u1', departmentId: 'd1' };
const bytes = Buffer.from('document');
function setup(category = 'COMPLAINT') {
  const database = {
    case: {
      findFirst: jest.fn().mockResolvedValue({
        businessNo: 'CA-1',
        departmentId: 'd1',
        responsibleUserId: 'u1',
        responsibleMembership: { teamId: null },
      }),
    },
    materialReference: { findMany: jest.fn().mockResolvedValue([]) },
    feeRecord: { findMany: jest.fn().mockResolvedValue([]) },
    material: { findFirst: jest.fn() },
  };
  const access = {
    authorizeCase: jest.fn().mockResolvedValue(undefined),
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
  };
  const materials = {
    listCaseResourceMetadata: jest.fn().mockResolvedValue([
      {
        materialId,
        contentVersionId: versionId,
        originalFilename: '同名.pdf',
        mimeType: 'application/pdf',
        sizeBytes: String(bytes.length),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        category,
        purpose: category,
        isCurrent: false,
      },
    ]),
    openVersion: jest.fn().mockImplementation(() =>
      Promise.resolve({
        stream: Readable.from([bytes]),
        sizeBytes: bytes.length,
        originalFilename: '同名.pdf',
      }),
    ),
  };
  const service = new CaseFileCatalogService(
    database as never,
    access as never,
    materials as never,
  );
  return { service, database, access, materials };
}

describe('CaseFileCatalogService', () => {
  it('retains an older frozen notary certificate version even when it is not current', async () => {
    const { service } = setup('NOTARY_CERTIFICATE');
    const result = await service.catalog(actor as never, caseId);
    const versions = result.groups.find(
      (group) => group.id === 'NOTARY_CERTIFICATE',
    )?.files;
    expect(versions).toEqual([
      expect.objectContaining({
        materialId,
        contentVersionId: versionId,
        isCurrent: false,
        labels: expect.arrayContaining(['历史版本', '入案冻结']),
      }),
    ]);
  });
  it('keeps the fixed sixteen groups and excludes unbound supplemental uploads', async () => {
    const { service } = setup('CASE_PRESERVATION_DOCUMENT');
    const result = await service.catalog(actor as never, caseId);
    expect(result.groups).toHaveLength(16);
    expect(
      result.groups.find((group) => group.id === 'CASE_PRESERVATION_DOCUMENT')
        ?.files,
    ).toHaveLength(0);
  });

  it('exports only a current exact case version and verifies the content hash', async () => {
    const { service, materials } = setup();
    const result = await service.export(actor as never, caseId, [
      { materialId, contentVersionId: versionId },
    ]);
    expect(materials.openVersion).toHaveBeenCalledWith(
      actor,
      materialId,
      versionId,
    );
    const entries = unzipSync(result.bytes);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['CA-1/起诉状/同名.pdf', 'manifest.json']),
    );
    const manifest = JSON.parse(
      Buffer.from(entries['manifest.json']!).toString('utf8'),
    ) as { files: Array<{ contentVersionId: string }> };
    expect(manifest.files[0]?.contentVersionId).toBe(versionId);
    materials.openVersion.mockResolvedValueOnce({
      stream: Readable.from([Buffer.from('corrupt!')]),
      sizeBytes: bytes.length,
      originalFilename: '同名.pdf',
    });
    await expect(
      service.export(actor as never, caseId, [
        { materialId, contentVersionId: versionId },
      ]),
    ).rejects.toMatchObject({ response: { code: 'CASE_EXPORT_EMPTY' } });
  });

  it('rejects a version outside the exact case catalogue', async () => {
    const { service, materials } = setup();
    await expect(
      service.export(actor as never, caseId, [
        {
          materialId,
          contentVersionId: '44444444-4444-4444-8444-444444444444',
        },
      ]),
    ).rejects.toMatchObject({ response: { code: 'CASE_EXPORT_EMPTY' } });
    expect(materials.openVersion).not.toHaveBeenCalled();
  });
});
