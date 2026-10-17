import type { Prisma } from '../../generated/prisma/client';
import { initializeNotaryEvidence } from './initialize-notary-evidence';
import type { InitializeNotaryEvidenceFacts } from './evidence-source-contract';

const facts: InitializeNotaryEvidenceFacts = {
  departmentId: 'dept-1',
  sourceNotaryMatterId: 'matter-1',
  caseId: 'case-1',
  certificateId: 'certificate-1',
  sourceActionEventId: 'audit-original',
  actorUserId: 'notary-user',
  notaryOfficeAccountBindingId: 'binding-1',
  certificateNo: '真实证书号',
  certificateDate: new Date('2026-10-01T00:00:00Z'),
  evidenceAt: new Date('2026-09-28T00:00:00Z'),
  officeName: '实际公证处',
  shopName: '实际店铺',
  platform: 'TAOBAO',
  files: [
    {
      materialId: 'material-1',
      contentVersionId: 'cv-1',
      originalFilename: '一.pdf',
      mimeType: 'application/pdf',
    },
    {
      materialId: 'material-2',
      contentVersionId: 'cv-2',
      originalFilename: '二.pdf',
      mimeType: 'application/pdf',
    },
  ],
};
function fixture() {
  const store = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ id: facts.sourceNotaryMatterId }]),
    notaryCertificate: {
      findFirst: jest.fn().mockResolvedValue({
        certificateNo: facts.certificateNo,
        certificateDate: facts.certificateDate,
        toVersion: 6,
        case: { id: facts.caseId },
        matter: {
          version: 6,
          evidence: { evidenceAt: facts.evidenceAt },
          notaryOffice: { name: facts.officeName },
        },
      }),
    },
    case: { findFirst: jest.fn().mockResolvedValue({ id: facts.caseId }) },
    auditEvent: {
      findFirst: jest.fn().mockResolvedValue({
        id: facts.sourceActionEventId,
        details: {
          certificateId: facts.certificateId,
          contentVersionIds: facts.files.map((file) => file.contentVersionId),
        },
      }),
    },
    materialReference: {
      findMany: jest.fn().mockResolvedValue(
        facts.files.map((file) => ({
          materialId: file.materialId,
          contentVersionId: file.contentVersionId,
          contentVersion: {
            originalFilename: file.originalFilename,
            mimeType: file.mimeType,
          },
        })),
      ),
    },
    evidenceGroupVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'group-1' }),
      update: jest.fn(),
    },
    evidenceItem: {
      create: jest.fn().mockResolvedValue({ id: 'item-1' }),
      updateMany: jest.fn(),
    },
    evidencePaperCertificate: {
      create: jest.fn().mockResolvedValue({ id: 'paper-1' }),
      updateMany: jest.fn(),
    },
    evidenceAuditEvent: {
      create: jest.fn().mockResolvedValue({ id: 'audit-source' }),
    },
  };
  return { store, tx: store as unknown as Prisma.TransactionClient };
}

describe('real notary evidence initialization', () => {
  it('creates only source-backed ledger initial states, keeps unknown physical fields null and retains all exact versions', async () => {
    const f = fixture();
    await expect(initializeNotaryEvidence(f.tx, facts)).resolves.toEqual({
      groupId: 'group-1',
      created: true,
    });
    const item = f.store.evidenceItem.create.mock.calls[0][0].data;
    expect(item).toMatchObject({
      status: 'UNDELIVERED',
      name: '实际店铺',
      collectedOn: facts.evidenceAt,
      createdByUserId: facts.actorUserId,
    });
    expect(item.displayCode).toBeUndefined();
    expect(item.shelfLocation).toBeUndefined();
    expect(item.keeperUserId).toBeUndefined();
    expect(f.store.evidencePaperCertificate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        number: facts.certificateNo,
        status: 'NOT_ISSUED',
        sourceCertificateId: facts.certificateId,
      }),
    });
    const audit = f.store.evidenceAuditEvent.create.mock.calls[0][0].data;
    expect(audit.actorUserId).toBe('notary-user');
    expect(audit.notaryOfficeAccountBindingId).toBe('binding-1');
    expect(audit.internalActorUserId).toBeUndefined();
    expect(audit.afterSnapshot.electronicFiles).toEqual(
      facts.files.map((file) => ({
        materialId: file.materialId,
        contentVersionId: file.contentVersionId,
        filename: file.originalFilename,
      })),
    );
  });

  it('does not recreate removed rows when a source was already initialized', async () => {
    const f = fixture();
    f.store.evidenceGroupVersion.findUnique.mockResolvedValue({
      id: 'group-1',
      caseId: facts.caseId,
      sourceInitializedAt: new Date('2026-10-01T00:00:00Z'),
    });
    await expect(initializeNotaryEvidence(f.tx, facts)).resolves.toEqual({
      groupId: 'group-1',
      created: false,
    });
    expect(f.store.evidenceItem.create).not.toHaveBeenCalled();
    expect(f.store.evidencePaperCertificate.create).not.toHaveBeenCalled();
    expect(f.store.evidenceGroupVersion.update).not.toHaveBeenCalled();
  });

  it('rejects an incomplete frozen set before creating any ledger object', async () => {
    const f = fixture();
    f.store.materialReference.findMany.mockResolvedValue([]);
    await expect(initializeNotaryEvidence(f.tx, facts)).rejects.toMatchObject({
      response: { code: 'INVALID_EVIDENCE_SOURCE' },
    });
    expect(f.store.evidenceGroupVersion.create).not.toHaveBeenCalled();
  });
});
