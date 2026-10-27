import { Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { OrganizationService } from '../../access-control/organization.service';
import {
  BlobStorageUnavailableError,
  PRIVATE_BLOB_STORAGE,
  PrivateBlobStorage,
} from './private-blob-storage';
import { MaterialCleanupService } from './material-cleanup.service';
import {
  MaterialService,
  CaseSectionRecordKind,
  MaterialTransactionClient,
  ValidatedMaterialVersionFact,
} from './material.service';
import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';
import type { CaseSectionRecordUploadTarget } from './case-section-record-upload.dto';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-21T04:00:00.000Z');

describe('MaterialService', () => {
  describe('case resource metadata without file access', () => {
    function setupMetadata() {
      const f = createFixture();
      f.db.case.findFirst.mockResolvedValue({
        id: customerId,
        sourceNotaryMatterId: null,
        certificateId: null,
      });
      const version = (id: string) => ({
        id,
        materialId: 'case-material',
        originalFilename: id + '.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 9007199254740993n,
        sha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        createdAt: now,
      });
      const material = {
        id: 'case-material',
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        currentVersionId: 'current',
        status: 'ACTIVE',
        version: 2,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        contentVersions: [version('old'), version('current')],
      };
      f.db.material.findMany.mockResolvedValue([material]);
      return { ...f, material, version };
    }

    it('retains old and current exact versions and exact bigint size without reading blobs or writing audits', async () => {
      const f = setupMetadata();
      const result = await f.service.listCaseResourceMetadata(
        actor,
        customerId,
      );
      expect(result).toEqual([
        expect.objectContaining({
          contentVersionId: 'old',
          isCurrent: false,
          sizeBytes: '9007199254740993',
        }),
        expect.objectContaining({
          contentVersionId: 'current',
          isCurrent: true,
        }),
      ]);
      expect(f.db.material.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            departmentId: actor.departmentId,
            category: { not: 'FEE_PROOF' },
            OR: [
              expect.objectContaining({
                id: 'case-material',
                ownerType: 'CASE',
                ownerId: customerId,
              }),
            ],
          }),
        }),
      );
      expect(JSON.stringify(result)).not.toMatch(/storageKey|stream|path/u);
      expect(f.storage.open).not.toHaveBeenCalled();
      expect(f.storage.put).not.toHaveBeenCalled();
      expect(f.storage.delete).not.toHaveBeenCalled();
      expect(f.transaction.auditEvent.create).not.toHaveBeenCalled();
    });

    it('uses the original frozen certificate policy and preserves its old exact CV', async () => {
      const f = setupMetadata();
      f.db.case.findFirst.mockResolvedValue({
        id: customerId,
        sourceNotaryMatterId: 'matter',
        certificateId: 'certificate',
      });
      const frozen = jest
        .spyOn(f.service, 'listFrozenCertificateFiles')
        .mockResolvedValue([
          {
            purpose: 'NOTARY_CERTIFICATE',
            materialId: 'frozen-material',
            contentVersionId: 'frozen-old',
            originalFilename: 'frozen-old.pdf',
            mimeType: 'application/pdf',
          },
        ]);
      f.db.material.findMany
        .mockResolvedValueOnce([f.material])
        .mockResolvedValueOnce([
          f.material,
          {
            ...f.material,
            id: 'frozen-material',
            ownerType: 'NOTARY_MATTER',
            ownerId: 'matter',
            category: 'NOTARY_CERTIFICATE',
            purpose: 'NOTARY_CERTIFICATE',
            currentVersionId: 'other-current',
            contentVersions: [
              f.version('frozen-old'),
              f.version('other-current'),
            ],
          },
        ]);
      const result = await f.service.listCaseResourceMetadata(
        actor,
        customerId,
      );
      expect(frozen).toHaveBeenCalledWith(actor, 'matter', 'certificate');
      expect(result).toHaveLength(3);
      expect(result[2]).toMatchObject({
        materialId: 'frozen-material',
        contentVersionId: 'frozen-old',
        isCurrent: false,
      });
      expect(
        result.some((entry) => entry.contentVersionId === 'other-current'),
      ).toBe(false);
      expect(f.storage.open).not.toHaveBeenCalled();
    });

    it('excludes proofs even if an upstream row is returned and rejects missing exact versions', async () => {
      const f = setupMetadata();
      f.db.material.findMany
        .mockResolvedValueOnce([
          f.material,
          {
            ...f.material,
            id: 'proof',
            category: 'FEE_PROOF',
            purpose: 'FEE_PROOF',
          },
        ])
        .mockResolvedValueOnce([f.material]);
      const result = await f.service.listCaseResourceMetadata(
        actor,
        customerId,
      );
      expect(result.some((entry) => entry.materialId === 'proof')).toBe(false);
      const missing = setupMetadata();
      missing.db.material.findMany
        .mockResolvedValueOnce([missing.material])
        .mockResolvedValueOnce([
          {
            ...missing.material,
            contentVersions: [missing.version('current')],
          },
        ]);
      await expect(
        missing.service.listCaseResourceMetadata(actor, customerId),
      ).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('rejects external or revoked actors before any material metadata read', async () => {
      const f = setupMetadata();
      for (const external of [
        { ...actor, lawyerAccountId: 'lawyer' },
        { ...actor, clientCustomerId: 'client' },
        { ...actor, notaryOfficeId: 'office' },
      ]) {
        await expect(
          f.service.listCaseResourceMetadata(external, customerId),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      f.access.authorizeDepartmentAction.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        f.service.listCaseResourceMetadata(actor, customerId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.db.material.findMany).not.toHaveBeenCalled();
      expect(f.storage.open).not.toHaveBeenCalled();
    });
  });

  describe('financial and evidence exact version access', () => {
    function uploadSetup() {
      const f = createFixture();
      f.db.case.findFirst.mockResolvedValue({ id: customerId });
      f.transaction.case.findFirst.mockResolvedValue({ id: customerId });
      f.service = new MaterialService(
        f.db as unknown as DatabaseService,
        f.access as unknown as AccessControlService,
        f.storage,
        f.coordinator,
        () => now,
        { lockDepartment: jest.fn() } as unknown as OrganizationService,
      );
      return f;
    }
    it('uses current fee.update inside the draft transaction without requiring case.read', async () => {
      const f = uploadSetup();
      await f.service.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        originalFilename: '凭证.pdf',
        declaredMimeType: 'application/pdf',
      });
      expect(f.transaction.uploadDraft.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: 'FEE_PROOF',
            purpose: 'FEE_PROOF',
            ownerId: customerId,
          }),
        }),
      );
      expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
        actor,
        'fee.update',
        f.transaction,
      );
      expect(
        f.access.authorizeDepartmentAction.mock.calls.every(
          (call) => call[1] === 'fee.update',
        ),
      ).toBe(true);
    });
    it('refuses a newly revoked upload before creating its draft', async () => {
      const f = uploadSetup();
      f.access.authorizeDepartmentAction.mockImplementation(
        async (_actor: ActorContext, _action: string, reader: unknown) => {
          if (reader === f.transaction) throw new ForbiddenException();
        },
      );
      await expect(
        f.service.createUploadDraft(actor, {
          ownerType: 'CASE',
          ownerId: customerId,
          category: 'FEE_PROOF',
          purpose: 'FEE_PROOF',
          originalFilename: '凭证.pdf',
          declaredMimeType: 'application/pdf',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.transaction.uploadDraft.create).not.toHaveBeenCalled();
    });
    it('cleans the unconsumed blob when permission is revoked while bytes arrive', async () => {
      const f = uploadSetup();
      f.db.uploadDraft.findUnique.mockResolvedValue({
        id: 'draft',
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        originalFilename: '凭证.pdf',
        declaredMimeType: 'application/pdf',
        status: 'OPEN',
        expiresAt: new Date(now.getTime() + 60000),
        lawyerAccountBindingId: null,
        customerAccountBindingId: null,
        notaryOfficeAccountBindingId: null,
        caseSectionRecordCommand: null,
        executionSupplementFilingId: null,
      });
      f.storage.put.mockResolvedValue({
        sizeBytes: 4,
        sha256: 'a'.repeat(64),
        detectedMimeType: 'application/pdf',
      });
      f.access.authorizeDepartmentAction.mockImplementation(
        async (_actor: ActorContext, _action: string, reader: unknown) => {
          if (reader === f.transaction) throw new ForbiddenException();
        },
      );
      await expect(
        f.service.finalizeUpload(actor, 'draft', Readable.from('%PDF')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.storage.put).toHaveBeenCalled();
      expect(f.storage.delete).toHaveBeenCalledTimes(1);
      expect(f.transaction.material.create).not.toHaveBeenCalled();
    });
    it('permits versioned cleanup only for an unconsumed proof and preserves a frozen file', async () => {
      const f = uploadSetup();
      f.db.material.findFirst.mockResolvedValue({
        ...materialRecord(),
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        contentVersions: [
          { id: 'version-1', status: 'AVAILABLE', uploadedBy: actor.userId },
        ],
      });
      f.transaction.materialReference.count.mockResolvedValue(0);
      await expect(
        f.service.softDelete(actor, 'material-1', 1),
      ).resolves.toMatchObject({ status: 'DELETED', version: 2 });
      f.transaction.material.updateMany.mockClear();
      f.transaction.materialReference.count.mockResolvedValue(1);
      await expect(
        f.service.softDelete(actor, 'material-1', 1),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
      expect(f.storage.delete).not.toHaveBeenCalled();
    });
    it('never exposes fee proof names or IDs through a generic case.read material list', async () => {
      const f = uploadSetup();
      f.db.material.findMany.mockResolvedValue([
        {
          id: 'secret-fee-material',
          category: 'FEE_PROOF',
          contentVersions: [
            { id: 'secret-cv', originalFilename: '财务凭证.pdf' },
          ],
        },
      ]);
      await expect(
        f.service.listOwnerMaterials(actor, 'CASE', customerId),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(f.db.material.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: { not: 'FEE_PROOF' } }),
        }),
      );
    });
    function feeSetup() {
      const f = createFixture();
      f.db.material.findFirst.mockResolvedValue({
        id: 'proof',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        status: 'ACTIVE',
        deletedAt: null,
        currentVersionId: 'proof-cv',
        contentVersions: [
          {
            id: 'proof-cv',
            status: 'AVAILABLE',
            storageKey: 'private-proof',
            originalFilename: '凭证.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4n,
            sha256: 'a'.repeat(64),
          },
        ],
      });
      f.transaction.feeRecord.findFirst.mockResolvedValue({ id: 'fee' });
      f.transaction.materialReference.findFirst.mockResolvedValue({
        id: 'frozen-proof',
      });
      f.transaction.feeCancellationPayment.findFirst.mockResolvedValue(null);
      f.transaction.feeRefundReconciliation.findFirst.mockResolvedValue(null);
      f.storage.open.mockResolvedValue(Readable.from('pdf'));
      return f;
    }
    it.each([
      { ...actor, lawyerAccountId: 'lawyer' },
      { ...actor, clientCustomerId: 'customer' },
      { ...actor, notaryOfficeId: 'office' },
    ])(
      'denies external exact current fee CV before any case/current shortcut: %j',
      async (external) => {
        const f = feeSetup();
        await expect(
          f.service.openVersion(external, 'proof', 'proof-cv'),
        ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
        expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
        expect(f.storage.open).not.toHaveBeenCalled();
      },
    );
    it('allows fee.read with real same-department case, fee and exact frozen reference, without case.read', async () => {
      const f = feeSetup();
      await expect(
        f.service.openVersion(actor, 'proof', 'proof-cv'),
      ).resolves.toMatchObject({ originalFilename: '凭证.pdf' });
      expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
        actor,
        'fee.read',
        f.transaction,
      );
      expect(f.transaction.feeRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            departmentId: actor.departmentId,
            caseId: 'case',
            proofMaterialId: 'proof',
            proofContentVersionId: 'proof-cv',
          }),
        }),
      );
    });
    it('does not substitute case.read when fee.read was revoked', async () => {
      const f = feeSetup();
      f.access.authorizeDepartmentAction.mockImplementation(
        async (_actor: ActorContext, action: string) => {
          if (action === 'fee.read') throw new ForbiddenException();
        },
      );
      await expect(
        f.service.openVersion(actor, 'proof', 'proof-cv'),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.storage.open).not.toHaveBeenCalled();
    });
    it.each([
      {
        kind: 'payment',
        model: 'feeCancellationPayment' as const,
        resourceType: 'fee-payment-verification',
        action: 'fee.payment-verified',
        detailId: 'paymentId',
      },
      {
        kind: 'refund',
        model: 'feeRefundReconciliation' as const,
        resourceType: 'fee-refund-reconciliation',
        action: 'fee.refund-reconciled',
        detailId: 'refundId',
      },
    ])(
      'opens an exact $kind proof only with fee.read, same-case immutable fact, audit and frozen reference',
      async ({ model, resourceType, action, detailId }) => {
        const f = feeSetup();
        f.transaction.feeRecord.findFirst.mockResolvedValue(null);
        f.transaction[model].findFirst.mockResolvedValue({
          id: 'fact',
          feeId: 'fee',
          cancellationId: 'cancellation',
          actorUserId: actor.userId,
          actionEventId: 'audit',
        });
        await expect(
          f.service.openVersion(actor, 'proof', 'proof-cv'),
        ).resolves.toMatchObject({ originalFilename: '凭证.pdf' });
        expect(f.transaction[model].findFirst).toHaveBeenCalledWith({
          where: expect.objectContaining({
            departmentId: actor.departmentId,
            caseId: 'case',
            proofMaterialId: 'proof',
            proofContentVersionId: 'proof-cv',
            cancellation: {
              is: {
                departmentId: actor.departmentId,
                caseId: 'case',
                outcome: 'VOIDED',
              },
            },
          }),
          select: expect.any(Object),
        });
        expect(f.transaction.materialReference.findFirst).toHaveBeenCalledWith({
          where: expect.objectContaining({
            departmentId: actor.departmentId,
            resourceType,
            resourceId: 'fact',
            materialId: 'proof',
            contentVersionId: 'proof-cv',
            actionEventId: 'audit',
            actionEvent: expect.objectContaining({
              resourceId: 'fee',
              action,
              internalActorUserId: actor.userId,
              AND: expect.arrayContaining([
                { details: { path: [detailId], equals: 'fact' } },
              ]),
            }),
          }),
          select: { id: true },
        });
        expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
          actor,
          'fee.read',
          f.transaction,
        );
      },
    );
    it('rejects a new reconciliation proof without its exact fact or reference', async () => {
      const f = feeSetup();
      f.transaction.feeRecord.findFirst.mockResolvedValue(null);
      await expect(
        f.service.openVersion(actor, 'proof', 'proof-cv'),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
      f.transaction.feeCancellationPayment.findFirst.mockResolvedValue({
        id: 'fact',
        feeId: 'fee',
        cancellationId: 'cancellation',
        actorUserId: actor.userId,
        actionEventId: 'audit',
      });
      f.transaction.materialReference.findFirst.mockResolvedValue(null);
      await expect(
        f.service.openVersion(actor, 'proof', 'proof-cv'),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
      expect(f.storage.open).not.toHaveBeenCalled();
    });
    it('reuses only a previously reconciled exact historical proof with current fee.read', async () => {
      const f = feeSetup();
      const historical = {
        id: 'proof',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        status: 'ACTIVE',
        currentVersionId: 'new-cv',
        contentVersions: [
          {
            id: 'proof-cv',
            status: 'AVAILABLE',
            mimeType: 'application/pdf',
            sizeBytes: 4n,
          },
        ],
      };
      f.transaction.case.findFirst.mockResolvedValue({ id: 'case' });
      f.transaction.material.findMany.mockResolvedValue([historical]);
      f.transaction.feeCancellationPayment.findFirst.mockResolvedValue({
        id: 'fact',
        feeId: 'fee',
        cancellationId: 'cancellation',
        actorUserId: actor.userId,
        actionEventId: 'audit',
      });
      const select = () =>
        f.service.assertAvailableVersions(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          {
            ownerType: 'CASE',
            ownerId: 'case',
            category: 'FEE_PROOF',
            contentVersionIds: ['proof-cv'],
          },
        );
      await expect(select()).resolves.toHaveLength(1);
      expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
        actor,
        'fee.read',
        f.transaction,
      );
      f.transaction.feeCancellationPayment.findFirst.mockResolvedValue(null);
      await expect(select()).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      f.transaction.feeCancellationPayment.findFirst.mockResolvedValue({
        id: 'fact',
        feeId: 'fee',
        cancellationId: 'cancellation',
        actorUserId: actor.userId,
        actionEventId: 'audit',
      });
      f.access.authorizeDepartmentAction.mockImplementation(
        async (_actor: ActorContext, action: string) => {
          if (action === 'fee.read') throw new ForbiddenException();
        },
      );
      await expect(select()).rejects.toMatchObject({
        response: { code: 'ACTION_FORBIDDEN' },
      });
    });
    it.each(['fee', 'reference'])(
      'does not download an unconsumed/cross-case/forged proof when exact %s proof is absent',
      async (missing) => {
        const f = feeSetup();
        if (missing === 'fee')
          f.transaction.feeRecord.findFirst.mockResolvedValue(null);
        else f.transaction.materialReference.findFirst.mockResolvedValue(null);
        await expect(
          f.service.openVersion(actor, 'proof', 'proof-cv'),
        ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
        expect(f.storage.open).not.toHaveBeenCalled();
      },
    );
    function evidenceSetup() {
      const f = feeSetup();
      f.db.material.findFirst.mockResolvedValue({
        id: 'certificate',
        departmentId: actor.departmentId,
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter',
        category: 'NOTARY_CERTIFICATE',
        purpose: 'NOTARY_CERTIFICATE',
        status: 'ACTIVE',
        deletedAt: null,
        contentVersions: [
          {
            id: 'cv-2',
            status: 'AVAILABLE',
            storageKey: 'second-certificate',
            originalFilename: '公证书第二份.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4n,
            sha256: 'b'.repeat(64),
          },
        ],
      });
      f.access.authorizeDepartmentAction.mockImplementation(
        async (_actor: ActorContext, action: string) => {
          if (action !== 'evidence.read') throw new ForbiddenException();
        },
      );
      f.transaction.notaryCertificate.findFirst.mockResolvedValue({
        id: 'typed-cert',
        actorUserId: 'notary-actor',
        notaryOfficeAccountBindingId: 'binding',
        fromVersion: 4,
        toVersion: 5,
      });
      f.transaction.evidencePaperCertificate.findFirst.mockResolvedValue({
        id: 'paper',
      });
      f.transaction.auditEvent.findMany.mockResolvedValue([
        {
          id: 'source-audit',
          details: {
            certificateId: 'typed-cert',
            fromVersion: 4,
            toVersion: 5,
            contentVersionIds: ['cv-1', 'cv-2'],
          },
        },
      ]);
      f.transaction.materialReference.findMany.mockResolvedValue([
        { materialId: 'first', contentVersionId: 'cv-1' },
        { materialId: 'certificate', contentVersionId: 'cv-2' },
      ]);
      f.db.materialReference.findFirst.mockResolvedValue({
        id: 'source-ref',
        actionEvent: { details: { contentVersionIds: ['cv-1', 'cv-2'] } },
      });
      return f;
    }
    it('uses internal evidence.read only for the real typed certificate and complete source set, including the second CV', async () => {
      const f = evidenceSetup();
      await expect(
        f.service.openVersion(actor, 'certificate', 'cv-2'),
      ).resolves.toMatchObject({ originalFilename: '公证书第二份.pdf' });
      expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
        actor,
        'evidence.read',
        f.transaction,
      );
      expect(f.storage.open).toHaveBeenCalledWith('second-certificate');
    });
    it.each(['certificate', 'paper', 'audit', 'full-set', 'exact-pair'])(
      'rejects missing or forged evidence %s source proof',
      async (missing) => {
        const f = evidenceSetup();
        if (missing === 'certificate')
          f.transaction.notaryCertificate.findFirst.mockResolvedValue(null);
        if (missing === 'paper')
          f.transaction.evidencePaperCertificate.findFirst.mockResolvedValue(
            null,
          );
        if (missing === 'audit')
          f.transaction.auditEvent.findMany.mockResolvedValue([]);
        if (missing === 'full-set')
          f.transaction.materialReference.findMany.mockResolvedValue([
            { materialId: 'certificate', contentVersionId: 'cv-2' },
          ]);
        if (missing === 'exact-pair')
          f.transaction.materialReference.findMany.mockResolvedValue([
            { materialId: 'first', contentVersionId: 'cv-1' },
            { materialId: 'wrong', contentVersionId: 'cv-2' },
          ]);
        await expect(
          f.service.openVersion(actor, 'certificate', 'cv-2'),
        ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
        expect(f.storage.open).not.toHaveBeenCalled();
      },
    );
    it('does not grant evidence.read access to disclosure or unrelated CVs', async () => {
      const f = evidenceSetup();
      f.db.material.findFirst.mockResolvedValue({
        id: 'disclosure',
        departmentId: actor.departmentId,
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter',
        category: 'NOTARY_DISCLOSURE',
        status: 'ACTIVE',
        contentVersions: [{ id: 'cv-2', status: 'AVAILABLE' }],
      });
      await expect(
        f.service.openVersion(actor, 'disclosure', 'cv-2'),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.transaction.notaryCertificate.findFirst).not.toHaveBeenCalled();
      expect(f.storage.open).not.toHaveBeenCalled();
    });
  });
  describe('execution supplement first consumption', () => {
    const filingId = '40000000-0000-4000-8000-000000000001';
    const supplementId = '40000000-0000-4000-8000-000000000002';
    const contentVersionId = '40000000-0000-4000-8000-000000000003';
    const auditEventId = '40000000-0000-4000-8000-000000000004';
    const target = { filingId, supplementId, expectedRevision: 0 };
    function setup() {
      const f = createFixture();
      f.transaction.case.findFirst.mockResolvedValue({
        departmentId: actor.departmentId,
        stage: 'EXECUTING',
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
      });
      f.transaction.userAccount.findUnique.mockResolvedValue({
        active: true,
        accountType: 'INTERNAL',
      });
      f.transaction.uploadDraft.findFirst.mockResolvedValue(null);
      const draft = {
        id: 'draft-supplement',
        status: 'FINALIZED',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: customerId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        lawyerAccountBindingId: null,
        customerAccountBindingId: null,
        notaryOfficeAccountBindingId: null,
        category: 'EXECUTION_SUPPLEMENT',
        purpose: 'EXECUTION_SUPPLEMENT',
        executionSupplementFilingId: filingId,
        executionSupplementTargetId: supplementId,
        executionSupplementRevision: 0,
        originalFilename: '补交.pdf',
        declaredMimeType: 'application/pdf',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60000),
        pendingStorageKey: null as string | null,
      };
      const material = {
        id: 'material-supplement',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'EXECUTION_SUPPLEMENT',
        purpose: 'EXECUTION_SUPPLEMENT',
        currentVersionId: contentVersionId,
        status: 'ACTIVE',
        contentVersions: [
          {
            id: contentVersionId,
            mimeType: 'application/pdf',
            sizeBytes: 12n,
            status: 'AVAILABLE',
            uploadedBy: actor.userId,
            executionSupplementUploadDraft: draft,
          },
        ],
      };
      f.transaction.material.findMany.mockResolvedValue([material]);
      const state = { consumed: false, pendingCount: 0 };
      f.transaction.$queryRawUnsafe.mockImplementation(
        async (...args: unknown[]) =>
          String(args[0]).includes('count(*)')
            ? [{ count: state.pendingCount }]
            : String(args[0]).includes('first_freeze_proof')
              ? [{ consumed: state.consumed }]
              : [{ id: customerId }],
      );
      const version = {
        id: supplementId,
        actorType: 'INTERNAL',
        internalActorUserId: actor.userId,
        lawyerAccountBindingId: null,
        auditEvent: {
          actorUserId: actor.userId,
          departmentId: actor.departmentId,
          internalActorUserId: actor.userId,
          lawyerAccountBindingId: null,
          resourceType: 'CASE',
          resourceId: customerId,
          action: 'case.execution.supplement.submitted',
        },
      };
      const select = () =>
        f.service.assertExecutionSupplementVersions(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          customerId,
          target,
          [contentVersionId],
        );
      const freeze = (facts: readonly ValidatedMaterialVersionFact[]) => {
        f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
          version,
        );
        return f.service.freezeCaseExecutionSupplementReferences(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          customerId,
          { ...target, versionId: supplementId },
          facts,
          auditEventId,
        );
      };
      return { ...f, state, draft, material, version, select, freeze };
    }
    function prepareUpload() {
      const f = setup();
      f.draft.status = 'OPEN';
      f.db.uploadDraft.findUnique.mockResolvedValue({ ...f.draft });
      f.transaction.uploadDraft.findUnique.mockResolvedValue({ ...f.draft });
      f.storage.put.mockImplementation(async (key) => {
        f.transaction.uploadDraft.findUnique.mockResolvedValue({
          ...f.draft,
          pendingStorageKey: key,
        });
        return {
          storageKey: key,
          detectedMimeType: 'application/pdf',
          sizeBytes: 12,
          sha256: 'a'.repeat(64),
        };
      });
      return f;
    }
    function prepareExternalRead() {
      const f = setup();
      const lawyer = { ...actor, lawyerAccountId: actor.userId };
      const version = {
        id: contentVersionId,
        materialId: f.material.id,
        originalFilename: '内部准备补交.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12n,
        sha256: 'a'.repeat(64),
        storageKey: 'private/supplement-bytes',
        status: 'AVAILABLE',
        createdAt: now,
        executionSupplementUploadDraftId: f.draft.id,
      };
      const material = {
        ...f.material,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        currentVersion: { executionSupplementUploadDraftId: f.draft.id },
        contentVersions: [version],
      };
      f.db.caseLawyerAssignment.findFirst.mockResolvedValue({
        lawyer: { accountBinding: { id: 'lawyer-binding' } },
      });
      f.db.case.findFirst.mockResolvedValue({ stage: 'ARCHIVED' });
      f.db.material.findMany.mockResolvedValue([material]);
      f.db.material.findFirst.mockResolvedValue(material);
      f.db.materialReference.findMany.mockResolvedValue([]);
      f.db.materialReference.findFirst.mockResolvedValue(null);
      f.db.$queryRawUnsafe.mockImplementation(async () => [
        { id: customerId, consumed: f.state.consumed },
      ]);
      f.storage.open.mockImplementation(async () =>
        Readable.from('exact frozen bytes'),
      );
      return { ...f, lawyer, material, version };
    }
    function prepareMutation() {
      const f = setup();
      const draft = {
        ...f.draft,
        internalActorUserId: actor.userId as string | null,
        lawyerAccountBindingId: null as string | null,
      };
      const material = {
        ...f.material,
        status: 'ACTIVE',
        deletedAt: null as Date | null,
        version: 1,
        contentVersions: [
          {
            ...f.material.contentVersions[0]!,
            originalFilename: draft.originalFilename,
            executionSupplementUploadDraft: draft,
          },
        ],
      };
      f.transaction.material.findFirst.mockResolvedValue(material);
      const advanceHead = (revision: number) => {
        f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
          {
            id: 'latest-version',
            filingId,
            caseId: customerId,
            departmentId: actor.departmentId,
            toRevision: revision,
          },
        );
        f.transaction.caseExecutionFilingSupplement.findUnique.mockResolvedValue(
          {
            id: supplementId,
            supplementId,
            filingId,
            caseId: customerId,
            departmentId: actor.departmentId,
            fromRevision: 0,
            toRevision: 1,
          },
        );
      };
      const deleted = () => {
        material.status = 'DELETED';
        material.version = 2;
        material.deletedAt = new Date(now.getTime() - 89 * DAY);
      };
      return { ...f, draft, material, advanceHead, deleted };
    }
    const DAY = 24 * 60 * 60 * 1000;
    it('deletes only an own unreferenced supplement preparation after locking its case before the material', async () => {
      const f = prepareMutation();
      await expect(
        f.service.softDelete(actor, f.material.id, 1),
      ).resolves.toMatchObject({ status: 'DELETED', version: 2 });
      const calls = f.transaction.$queryRawUnsafe.mock.calls.map((args) =>
        String(args[0]),
      );
      expect(
        calls.findIndex((sql) => sql.includes('FROM "cases"')),
      ).toBeLessThan(
        calls.findIndex((sql) => sql.includes('FOR NO KEY UPDATE OF m, cv')),
      );
      expect(f.transaction.material.updateMany).toHaveBeenCalledWith({
        where: { id: f.material.id, status: 'ACTIVE', version: 1 },
        data: { status: 'DELETED', deletedAt: now, version: { increment: 1 } },
      });
      expect(f.transaction.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'material.deleted' }),
      });
      expect(f.storage.delete).not.toHaveBeenCalled();
    });
    it.each([0, 1])(
      'allows deleting an obsolete revision%s own preparation but rejects restoring it into the later head',
      async (revision) => {
        const f = prepareMutation();
        f.draft.executionSupplementRevision = revision;
        f.advanceHead(2);
        await expect(
          f.service.softDelete(actor, f.material.id, 1),
        ).resolves.toHaveProperty('status', 'DELETED');
        expect(f.access.authorizeCase).toHaveBeenCalledWith(
          actor,
          revision === 0
            ? 'case.execution.supplement.submit'
            : 'case.execution.supplement.correct',
          expect.objectContaining({ departmentId: actor.departmentId }),
          f.transaction,
        );
        f.deleted();
        f.transaction.material.updateMany.mockClear();
        await expect(
          f.service.restore(actor, f.material.id, 2),
        ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
        expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
      },
    );
    it.each([
      'actor',
      'case',
      'department',
      'filing',
      'target',
      'claim',
    ] as const)(
      'rejects an own-pool mutation when the exact %s anchor differs',
      async (key) => {
        const f = prepareMutation();
        if (key === 'actor') f.draft.actorUserId = 'foreign-actor';
        if (key === 'case') f.draft.ownerId = 'foreign-case';
        if (key === 'department') f.draft.departmentId = 'foreign-department';
        if (key === 'claim') f.draft.pendingStorageKey = 'unfinalized-claim';
        if (key === 'filing')
          f.transaction.caseExecutionFiling.findFirst.mockResolvedValue(null);
        if (key === 'target') {
          f.advanceHead(2);
          f.transaction.caseExecutionFilingSupplement.findUnique.mockResolvedValue(
            {
              id: supplementId,
              supplementId,
              filingId: 'foreign-filing',
              caseId: customerId,
              departmentId: actor.departmentId,
              fromRevision: 0,
              toRevision: 1,
            },
          );
        }
        await expect(
          f.service.softDelete(actor, f.material.id, 1),
        ).rejects.toThrow();
        expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
      },
    );
    it('rechecks current action revocation for deleting and restoring prepared files', async () => {
      const f = prepareMutation();
      f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
      await expect(
        f.service.softDelete(actor, f.material.id, 1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      f.deleted();
      await expect(
        f.service.restore(actor, f.material.id, 2),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
    });
    it('keeps preparation cleanup available only to its original current PRIMARY lawyer', async () => {
      const f = prepareMutation();
      const lawyer = { ...actor, lawyerAccountId: actor.userId };
      const binding = 'current-binding';
      f.draft.internalActorUserId = null;
      f.draft.lawyerAccountBindingId = binding;
      f.transaction.userAccount.findUnique.mockResolvedValue({
        active: true,
        accountType: 'LAWYER',
      });
      let active = true;
      f.transaction.$queryRawUnsafe.mockImplementation(
        async (...args: unknown[]) =>
          String(args[0]).includes('lawyer_account_bindings')
            ? active
              ? [{ id: binding }]
              : []
            : String(args[0]).includes('first_freeze_proof')
              ? [{ consumed: false }]
              : [{ id: customerId }],
      );
      await expect(
        f.service.softDelete(lawyer, f.material.id, 1),
      ).resolves.toHaveProperty('status', 'DELETED');
      expect(f.transaction.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ lawyerAccountBindingId: binding }),
      });
      active = false;
      f.transaction.material.updateMany.mockClear();
      await expect(
        f.service.softDelete(lawyer, f.material.id, 1),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
    });
    it.each(['reference', 'proof'] as const)(
      'never deletes or restores a frozen supplement with %s even if the other evidence is absent',
      async (kind) => {
        const f = prepareMutation();
        f.state.consumed = kind === 'proof';
        f.transaction.materialReference.count.mockResolvedValue(
          kind === 'reference' ? 1 : 0,
        );
        await expect(
          f.service.softDelete(actor, f.material.id, 1),
        ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
        f.deleted();
        await expect(
          f.service.restore(actor, f.material.id, 2),
        ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
        expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
      },
    );
    it('observes a freeze that completes while waiting for the material lock before deciding whether deletion is allowed', async () => {
      const f = prepareMutation();
      f.transaction.$queryRawUnsafe.mockImplementation(
        async (...args: unknown[]) => {
          const sql = String(args[0]);
          if (sql.includes('FOR NO KEY UPDATE OF m, cv'))
            f.state.consumed = true;
          return sql.includes('first_freeze_proof')
            ? [{ consumed: f.state.consumed }]
            : [{ id: customerId }];
        },
      );
      await expect(
        f.service.softDelete(actor, f.material.id, 1),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
    });
    it('restores a current unconsumed file within 90 days against the same pending pool advisory lock and ten-slot quota', async () => {
      const f = prepareMutation();
      f.deleted();
      f.state.pendingCount = 10;
      await expect(
        f.service.restore(actor, f.material.id, 2),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
      f.state.pendingCount = 9;
      await expect(
        f.service.restore(actor, f.material.id, 2),
      ).resolves.toHaveProperty('status', 'ACTIVE');
      expect(f.transaction.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `${actor.departmentId}:CASE:${customerId}:EXECUTION_SUPPLEMENT`,
      );
      expect(f.transaction.material.count).not.toHaveBeenCalled();
      f.material.deletedAt = new Date(now.getTime() - 90 * DAY);
      f.transaction.material.updateMany.mockClear();
      await expect(
        f.service.restore(actor, f.material.id, 2),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.transaction.material.updateMany).not.toHaveBeenCalled();
    });
    it('hides unconsumed supplement metadata and bytes from a current PRIMARY lawyer even with a forged reference', async () => {
      const f = prepareExternalRead();
      f.db.materialReference.findMany.mockResolvedValue([
        { materialId: f.material.id, contentVersionId },
      ]);
      f.db.materialReference.findFirst.mockResolvedValue({ id: 'forged-ref' });
      await expect(
        f.service.listOwnerMaterials(f.lawyer, 'CASE', customerId),
      ).resolves.toEqual({ items: [], total: 0 });
      await expect(
        f.service.openVersion(f.lawyer, f.material.id, contentVersionId),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
      expect(f.storage.open).not.toHaveBeenCalled();
      expect(f.db.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          'case_execution_supplement_upload_first_freeze_proof',
        ),
        contentVersionId,
        false,
      );
    });
    it('exposes exact frozen supplement business metadata and original bytes only after proof, while preserving current PRIMARY authorization', async () => {
      const f = prepareExternalRead();
      f.state.consumed = true;
      const listed = await f.service.listOwnerMaterials(
        f.lawyer,
        'CASE',
        customerId,
      );
      expect(listed.items[0]?.contentVersions).toEqual([
        expect.objectContaining({
          id: contentVersionId,
          originalFilename: '内部准备补交.pdf',
        }),
      ]);
      for (const field of [
        'executionSupplement',
        'executionSupplementUploadDraftId',
        'actorUserId',
        'correctionReason',
      ])
        expect(JSON.stringify(listed)).not.toContain(field);
      const opened = await f.service.openVersion(
        f.lawyer,
        f.material.id,
        contentVersionId,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe('exact frozen bytes');
      expect(f.storage.open).toHaveBeenCalledWith(f.version.storageKey);
      f.db.caseLawyerAssignment.findFirst.mockResolvedValue(null);
      await expect(
        f.service.openVersion(f.lawyer, f.material.id, contentVersionId),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.storage.open).toHaveBeenCalledTimes(1);
    });
    it('keeps a previously frozen supplement version readable when a newer current preparation is still unconsumed', async () => {
      const f = prepareExternalRead();
      const oldId = '40000000-0000-4000-8000-000000000005';
      const oldVersion = {
        ...f.version,
        id: oldId,
        originalFilename: '历史冻结.pdf',
      };
      f.material.contentVersions.push(oldVersion);
      f.db.materialReference.findMany.mockResolvedValue([
        { materialId: f.material.id, contentVersionId: oldId },
        { materialId: f.material.id, contentVersionId },
      ]);
      f.db.$queryRawUnsafe.mockImplementation(async (...args: unknown[]) => [
        { id: customerId, consumed: args[1] === oldId },
      ]);
      const listed = await f.service.listOwnerMaterials(
        f.lawyer,
        'CASE',
        customerId,
      );
      expect(listed.items[0]?.currentVersionId).toBeNull();
      expect(
        listed.items[0]?.contentVersions.map((version) => version.id),
      ).toEqual([oldId]);
      f.db.material.findFirst.mockResolvedValue({
        ...f.material,
        contentVersions: [oldVersion],
      });
      f.db.materialReference.findFirst.mockResolvedValue({
        id: 'retained-proof-ref',
      });
      await expect(
        f.service.openVersion(f.lawyer, f.material.id, oldId),
      ).resolves.toHaveProperty('mimeType', 'application/pdf');
    });
    it('does not turn supplement first-consumption proof into customer access to an otherwise forbidden category', async () => {
      const f = prepareExternalRead();
      f.state.consumed = true;
      const client = { ...actor, clientCustomerId: customerId };
      f.db.customerAccountBinding.findFirst.mockResolvedValue({
        id: 'client-binding',
      });
      f.db.case.findFirst.mockResolvedValue({
        stage: 'ARCHIVED',
        complaintConfirmation: {
          confirmedComplaintContentVersionId: 'confirmed-complaint',
        },
      });
      await expect(
        f.service.listOwnerMaterials(client, 'CASE', customerId),
      ).resolves.toEqual({ items: [], total: 0 });
      await expect(
        f.service.openVersion(client, f.material.id, contentVersionId),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
      expect(f.storage.open).not.toHaveBeenCalled();
      expect(
        JSON.stringify(f.db.materialReference.findMany.mock.calls),
      ).not.toContain('EXECUTION_SUPPLEMENT');
    });
    it('creates only a structured same-filing preparation draft and no business fact', async () => {
      const f = setup();
      const result = await f.service.createExecutionSupplementUploadDraft(
        actor,
        customerId,
        target,
        { originalFilename: '补交.pdf', declaredMimeType: 'application/pdf' },
      );
      expect(result).toMatchObject({
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'EXECUTION_SUPPLEMENT',
        purpose: 'EXECUTION_SUPPLEMENT',
        executionSupplement: target,
      });
      expect(f.transaction.uploadDraft.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          executionSupplementFilingId: filingId,
          executionSupplementTargetId: supplementId,
          executionSupplementRevision: 0,
          internalActorUserId: actor.userId,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        }),
      });
      expect(
        f.transaction.caseExecutionFilingSupplementDocument.create,
      ).not.toHaveBeenCalled();
      expect(f.transaction.materialReference.createMany).not.toHaveBeenCalled();
    });
    it('streams outside both short transactions and binds exactly one finalized content version', async () => {
      const f = prepareUpload();
      let inTransaction = false;
      f.db.$transaction.mockImplementation(async (callback) => {
        inTransaction = true;
        try {
          return await callback(f.transaction);
        } finally {
          inTransaction = false;
        }
      });
      f.storage.put.mockImplementation(async (key) => {
        expect(inTransaction).toBe(false);
        f.transaction.uploadDraft.findUnique.mockResolvedValue({
          ...f.draft,
          pendingStorageKey: key,
        });
        return {
          storageKey: key,
          detectedMimeType: 'application/pdf',
          sizeBytes: 12,
          sha256: 'a'.repeat(64),
        };
      });
      const result = await f.service.finalizeUpload(
        actor,
        f.draft.id,
        Readable.from(Buffer.from('file bytes')),
      );
      expect(result).toMatchObject({ executionSupplement: target });
      expect(f.storage.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Readable),
        50 * 1024 * 1024,
      );
      expect(f.transaction.contentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          executionSupplementUploadDraftId: f.draft.id,
        }),
      });
      expect(f.transaction.material.count).not.toHaveBeenCalled();
      expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          'NOT case_execution_supplement_upload_first_freeze_proof(m.current_version_id,false)',
        ),
        actor.departmentId,
        customerId,
      );
      expect(
        f.transaction.caseExecutionFilingSupplementDocument.create,
      ).not.toHaveBeenCalled();
    });
    it('denies a revoked actor at claim without sending bytes', async () => {
      const f = prepareUpload();
      f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
      await expect(
        f.service.finalizeUpload(
          actor,
          f.draft.id,
          Readable.from('file bytes'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.storage.put).not.toHaveBeenCalled();
      expect(f.transaction.contentVersion.create).not.toHaveBeenCalled();
    });
    it.each(['permission', 'target', 'stage'] as const)(
      'rechecks %s after transport and compensates the blob without finalizing metadata',
      async (change) => {
        const f = prepareUpload();
        f.storage.put.mockImplementation(async (key) => {
          f.transaction.uploadDraft.findUnique.mockResolvedValue({
            ...f.draft,
            pendingStorageKey: key,
          });
          if (change === 'permission')
            f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
          if (change === 'target')
            f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
              {
                id: supplementId,
                toRevision: 1,
                filingId,
                caseId: customerId,
                departmentId: actor.departmentId,
              },
            );
          if (change === 'stage')
            f.transaction.case.findFirst.mockResolvedValue({
              departmentId: actor.departmentId,
              stage: 'ARCHIVED',
              responsibleUserId: actor.userId,
              responsibleMembership: { teamId: null },
            });
          return {
            storageKey: key,
            detectedMimeType: 'application/pdf',
            sizeBytes: 12,
            sha256: 'a'.repeat(64),
          };
        });
        await expect(
          f.service.finalizeUpload(
            actor,
            f.draft.id,
            Readable.from('file bytes'),
          ),
        ).rejects.toThrow();
        expect(f.storage.delete).toHaveBeenCalledTimes(1);
        expect(f.transaction.contentVersion.create).not.toHaveBeenCalled();
        expect(f.db.uploadDraft.updateMany).toHaveBeenCalledWith({
          where: { id: f.draft.id, pendingStorageKey: expect.any(String) },
          data: { pendingStorageKey: null },
        });
      },
    );
    it('retains the durable pending key when blob compensation cannot complete', async () => {
      const f = prepareUpload();
      f.storage.put.mockImplementation(async (key) => {
        f.transaction.uploadDraft.findUnique.mockResolvedValue({
          ...f.draft,
          pendingStorageKey: key,
        });
        f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
        return {
          storageKey: key,
          detectedMimeType: 'application/pdf',
          sizeBytes: 12,
          sha256: 'a'.repeat(64),
        };
      });
      f.storage.delete.mockRejectedValue(new Error('storage unavailable'));
      await expect(
        f.service.finalizeUpload(
          actor,
          f.draft.id,
          Readable.from('file bytes'),
        ),
      ).rejects.toThrow();
      expect(f.db.uploadDraft.updateMany).not.toHaveBeenCalled();
    });
    it('rejects the eleventh unconsumed item while retaining the existing quota lock', async () => {
      const f = prepareUpload();
      f.state.pendingCount = 10;
      await expect(
        f.service.finalizeUpload(
          actor,
          f.draft.id,
          Readable.from('file bytes'),
        ),
      ).rejects.toThrow();
      expect(f.transaction.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `${actor.departmentId}:CASE:${customerId}:EXECUTION_SUPPLEMENT`,
      );
      expect(f.transaction.contentVersion.create).not.toHaveBeenCalled();
      expect(f.storage.delete).toHaveBeenCalledTimes(1);
    });
    it.each(['EXPIRED', 'FINALIZED'])(
      'does not replay PUT or send bytes for terminal draft %s',
      async (status) => {
        const f = prepareUpload();
        f.db.uploadDraft.findUnique.mockResolvedValue({ ...f.draft, status });
        await expect(
          f.service.finalizeUpload(
            actor,
            f.draft.id,
            Readable.from('file bytes'),
          ),
        ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
        expect(f.storage.put).not.toHaveBeenCalled();
      },
    );
    it('selects against the real submit action and freezes exact typed documents plus references in the same transaction', async () => {
      const f = setup();
      const facts = await f.select();
      expect(f.access.authorizeCase).toHaveBeenCalledWith(
        actor,
        'case.execution.supplement.submit',
        expect.objectContaining({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        }),
        f.transaction,
      );
      expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
      await f.freeze(facts);
      expect(
        f.transaction.caseExecutionFilingSupplementDocument.create,
      ).toHaveBeenCalledWith({
        data: {
          versionId: supplementId,
          supplementId,
          filingId,
          caseId: customerId,
          departmentId: actor.departmentId,
          materialId: 'material-supplement',
          contentVersionId,
        },
      });
      expect(f.transaction.materialReference.createMany).toHaveBeenCalledWith({
        data: [
          {
            departmentId: actor.departmentId,
            resourceType: 'case',
            resourceId: customerId,
            purpose: 'EXECUTION_SUPPLEMENT',
            materialId: 'material-supplement',
            contentVersionId,
            actionEventId: auditEventId,
          },
        ],
        skipDuplicates: true,
      });
    });
    it.each([0, 1, 2, 3])(
      'requires all two exact reference inserts, not a reported count of %s',
      async (count) => {
        const f = setup();
        const secondId = '40000000-0000-4000-8000-000000000005';
        f.transaction.material.findMany.mockResolvedValue([
          f.material,
          {
            ...f.material,
            id: 'second-material',
            currentVersionId: secondId,
            contentVersions: [
              {
                ...f.material.contentVersions[0]!,
                id: secondId,
                executionSupplementUploadDraft: {
                  ...f.draft,
                  id: 'second-draft',
                },
              },
            ],
          },
        ]);
        const facts = await f.service.assertExecutionSupplementVersions(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          customerId,
          target,
          [contentVersionId, secondId],
        );
        f.transaction.materialReference.createMany.mockResolvedValue({ count });
        const freezing = f.freeze(facts);
        if (count === facts.length)
          await expect(freezing).resolves.toBeUndefined();
        else
          await expect(freezing).rejects.toMatchObject({
            response: { code: 'MATERIAL_VERSION_INVALID' },
          });
        expect(
          f.transaction.caseExecutionFilingSupplementDocument.create,
        ).toHaveBeenCalledTimes(2);
        expect(
          f.transaction.materialReference.createMany,
        ).toHaveBeenCalledTimes(1);
      },
    );
    it('rejects unconsumed dedicated content through the ordinary current AVAILABLE shortcut', async () => {
      const f = setup();
      await expect(
        f.service.assertAvailableVersions(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          {
            ownerType: 'CASE',
            ownerId: customerId,
            category: 'EXECUTION_SUPPLEMENT',
            contentVersionIds: [contentVersionId],
          },
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      expect(f.transaction.material.findMany).not.toHaveBeenCalled();
    });
    it.each(['target', 'filing', 'revision', 'actor'] as const)(
      'rejects unconsumed dedicated content bound to another %s',
      async (field) => {
        const f = setup();
        if (field === 'target')
          f.draft.executionSupplementTargetId = 'another-target';
        if (field === 'filing')
          f.draft.executionSupplementFilingId = 'another-filing';
        if (field === 'revision') f.draft.executionSupplementRevision = 1;
        if (field === 'actor') {
          f.draft.actorUserId = 'another-actor';
          f.draft.internalActorUserId = 'another-actor';
          f.material.contentVersions[0]!.uploadedBy = 'another-actor';
        }
        await expect(f.select()).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
      },
    );
    it.each(['root', 'version', 'feedback', 'draft'] as const)(
      'does not interpret a scoped miss as a globally unused UUID (%s collision)',
      async (kind) => {
        const f = setup();
        if (kind === 'root')
          f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
            {
              id: 'foreign',
              caseId: 'foreign-case',
              filingId: 'foreign-filing',
              departmentId: 'foreign-dept',
              toRevision: 1,
            },
          );
        if (kind === 'version')
          f.transaction.caseExecutionFilingSupplement.findUnique.mockResolvedValue(
            { id: supplementId },
          );
        if (kind === 'feedback')
          f.transaction.caseExecutionFilingFeedback.findFirst.mockResolvedValue(
            { id: supplementId },
          );
        if (kind === 'draft')
          f.transaction.uploadDraft.findFirst.mockResolvedValue({
            id: 'foreign-draft',
            expiresAt: now,
          });
        await expect(f.select()).rejects.toMatchObject({
          response: { code: 'VERSION_CONFLICT' },
        });
        expect(f.transaction.material.findMany).not.toHaveBeenCalled();
      },
    );
    it('permits same-case frozen reuse only after a prior committed first-consumption proof', async () => {
      const f = setup();
      f.state.consumed = true;
      f.material.currentVersionId = 'a-later-current-version';
      f.draft.executionSupplementTargetId = 'older-target';
      f.draft.actorUserId = 'older-actor';
      f.draft.internalActorUserId = 'older-actor';
      f.material.contentVersions[0]!.uploadedBy = 'older-actor';
      const facts = await f.select();
      expect(facts).toHaveLength(1);
      await expect(f.freeze(facts)).resolves.toBeUndefined();
      expect(f.transaction.materialReference.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              contentVersionId,
              actionEventId: auditEventId,
            }),
          ],
        }),
      );
      expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('first_freeze_proof'),
        contentVersionId,
        true,
      );
    });
    it.each(['ARCHIVED', 'WAITING_ARCHIVE', 'WAITING_EXECUTION_FILING'])(
      'does not allow new preparation/consumption in %s',
      async (stage) => {
        const f = setup();
        f.transaction.case.findFirst.mockResolvedValue({
          departmentId: actor.departmentId,
          stage,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
        });
        await expect(f.select()).rejects.toMatchObject({
          response: { code: 'VERSION_CONFLICT' },
        });
      },
    );
    it('rechecks current scope and action before consuming, including after selection', async () => {
      const f = setup();
      const facts = await f.select();
      f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
      await expect(f.freeze(facts)).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        f.transaction.caseExecutionFilingSupplementDocument.create,
      ).not.toHaveBeenCalled();
    });
    it('requires the positive exact revision and correction action for an existing root', async () => {
      const f = setup();
      f.transaction.caseExecutionFilingSupplement.findUnique.mockResolvedValue({
        id: supplementId,
        supplementId,
        filingId,
        caseId: customerId,
        departmentId: actor.departmentId,
        fromRevision: 0,
        toRevision: 1,
      });
      f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue({
        id: supplementId,
        filingId,
        caseId: customerId,
        departmentId: actor.departmentId,
        toRevision: 2,
      });
      f.state.consumed = true;
      await expect(
        f.service.assertExecutionSupplementVersions(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          customerId,
          { ...target, expectedRevision: 2 },
          [contentVersionId],
        ),
      ).resolves.toHaveLength(1);
      expect(f.access.authorizeCase).toHaveBeenCalledWith(
        actor,
        'case.execution.supplement.correct',
        expect.any(Object),
        f.transaction,
      );
      await expect(
        f.service.assertExecutionSupplementVersions(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          customerId,
          { ...target, expectedRevision: 1 },
          [contentVersionId],
        ),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    });
    it.each([
      'missing',
      'version-as-root',
      'wrong-first-revision',
      'foreign-scope',
    ] as const)(
      'requires a real initial root rather than a head-only match (%s)',
      async (kind) => {
        const f = setup();
        f.state.consumed = true;
        f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
          {
            id: 'later-version',
            filingId,
            caseId: customerId,
            departmentId: actor.departmentId,
            toRevision: 2,
          },
        );
        const root = {
          id: supplementId,
          supplementId,
          filingId,
          caseId: customerId,
          departmentId: actor.departmentId,
          fromRevision: 0,
          toRevision: 1,
        };
        if (kind === 'version-as-root') root.supplementId = 'another-real-root';
        if (kind === 'wrong-first-revision') root.fromRevision = 1;
        if (kind === 'foreign-scope') root.filingId = 'another-filing';
        f.transaction.caseExecutionFilingSupplement.findUnique.mockResolvedValue(
          kind === 'missing' ? null : root,
        );
        await expect(
          f.service.assertExecutionSupplementVersions(
            f.transaction as unknown as MaterialTransactionClient,
            actor,
            customerId,
            { ...target, expectedRevision: 2 },
            [contentVersionId],
          ),
        ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
        expect(f.transaction.material.findMany).not.toHaveBeenCalled();
      },
    );
    it('uses the same lowercase UUID advisory namespace without rewriting a body/key', async () => {
      const f = setup();
      const upperTarget = {
        ...target,
        supplementId: 'A0000000-0000-4000-8000-000000000002',
      };
      f.draft.executionSupplementTargetId =
        upperTarget.supplementId.toLowerCase();
      await f.service.assertExecutionSupplementVersions(
        f.transaction as unknown as MaterialTransactionClient,
        actor,
        customerId,
        upperTarget,
        [contentVersionId],
      );
      expect(f.transaction.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        'execution-filing-followup-target:a0000000-0000-4000-8000-000000000002',
      );
      expect(upperTarget.supplementId).toBe(
        'A0000000-0000-4000-8000-000000000002',
      );
    });
    it('rejects an initial UUID reserved by a nonzero-revision draft even in otherwise matching scope', async () => {
      const f = setup();
      f.transaction.uploadDraft.findFirst.mockResolvedValue({
        id: 'nonzero-revision-draft',
        expiresAt: now,
      });
      await expect(f.select()).rejects.toMatchObject({
        response: { code: 'VERSION_CONFLICT' },
      });
      expect(f.transaction.uploadDraft.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            executionSupplementTargetId: supplementId,
            NOT: {
              ownerId: customerId,
              departmentId: actor.departmentId,
              executionSupplementFilingId: filingId,
              executionSupplementRevision: 0,
              actorUserId: actor.userId,
            },
          },
        }),
      );
    });
    it('does not allow generic freeze to bypass the exact new version and audit', async () => {
      const f = setup();
      const facts = await f.select();
      await expect(
        f.service.freezeReferences(
          f.transaction as unknown as MaterialTransactionClient,
          {
            departmentId: actor.departmentId,
            resourceType: 'case',
            resourceId: customerId,
            facts,
            actionEventId: auditEventId,
          },
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      expect(f.transaction.materialReference.createMany).not.toHaveBeenCalled();
    });
    it.each(['actor', 'audit', 'binding', 'missing'] as const)(
      'rejects %s mismatch before creating document or ref',
      async (kind) => {
        const f = setup();
        const facts = await f.select();
        if (kind === 'actor') f.version.actorType = 'LAWYER';
        if (kind === 'audit')
          f.version.auditEvent.action = 'case.execution.filing.submitted';
        if (kind === 'binding')
          f.version.auditEvent.internalActorUserId = 'another-actor';
        f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
          kind === 'missing' ? null : f.version,
        );
        await expect(
          f.service.freezeCaseExecutionSupplementReferences(
            f.transaction as unknown as MaterialTransactionClient,
            actor,
            customerId,
            { ...target, versionId: supplementId },
            facts,
            auditEventId,
          ),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
        expect(
          f.transaction.caseExecutionFilingSupplementDocument.create,
        ).not.toHaveBeenCalled();
      },
    );
    it('allows the current PRIMARY lawyer with exact binding and retains lawyer audit provenance', async () => {
      const f = setup();
      const lawyer = { ...actor, lawyerAccountId: actor.userId };
      const bindingId = 'lawyer-binding';
      f.transaction.userAccount.findUnique.mockResolvedValue({
        active: true,
        accountType: 'LAWYER',
      });
      const lawyerDraft = {
        ...f.draft,
        internalActorUserId: null,
        lawyerAccountBindingId: bindingId,
      };
      f.transaction.material.findMany.mockResolvedValue([
        {
          ...f.material,
          contentVersions: [
            {
              ...f.material.contentVersions[0],
              executionSupplementUploadDraft: lawyerDraft,
            },
          ],
        },
      ]);
      f.transaction.$queryRawUnsafe.mockImplementation(
        async (...args: unknown[]) =>
          String(args[0]).includes('first_freeze_proof')
            ? [{ consumed: false }]
            : [
                {
                  id: String(args[0]).includes('lawyer_account_bindings')
                    ? bindingId
                    : customerId,
                },
              ],
      );
      const facts = await f.service.assertExecutionSupplementVersions(
        f.transaction as unknown as MaterialTransactionClient,
        lawyer,
        customerId,
        target,
        [contentVersionId],
      );
      f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue({
        ...f.version,
        actorType: 'LAWYER',
        internalActorUserId: null,
        lawyerAccountBindingId: bindingId,
        auditEvent: {
          ...f.version.auditEvent,
          internalActorUserId: null,
          lawyerAccountBindingId: bindingId,
        },
      });
      await f.service.freezeCaseExecutionSupplementReferences(
        f.transaction as unknown as MaterialTransactionClient,
        lawyer,
        customerId,
        { ...target, versionId: supplementId },
        facts,
        auditEventId,
      );
      expect(f.access.authorizeCase).not.toHaveBeenCalled();
      expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('FOR SHARE OF b, u, a'),
        actor.userId,
        actor.departmentId,
        customerId,
      );
      expect(
        f.transaction.caseExecutionFilingSupplementDocument.create,
      ).toHaveBeenCalledTimes(1);
    });
    it('rejects a lawyer whose PRIMARY assignment or binding was withdrawn', async () => {
      const f = setup();
      f.transaction.userAccount.findUnique.mockResolvedValue({
        active: true,
        accountType: 'LAWYER',
      });
      f.transaction.$queryRawUnsafe.mockImplementation(
        async (...args: unknown[]) =>
          String(args[0]).includes('lawyer_account_bindings')
            ? []
            : [{ id: customerId }],
      );
      await expect(
        f.service.assertExecutionSupplementVersions(
          f.transaction as unknown as MaterialTransactionClient,
          { ...actor, lawyerAccountId: actor.userId },
          customerId,
          target,
          [contentVersionId],
        ),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.transaction.material.findMany).not.toHaveBeenCalled();
    });
    it.each([
      { ...actor, clientCustomerId: customerId },
      { ...actor, notaryOfficeId: 'office' },
    ])(
      'rejects nonoperator context before selection',
      async (externalActor) => {
        const f = setup();
        await expect(
          f.service.assertExecutionSupplementVersions(
            f.transaction as unknown as MaterialTransactionClient,
            externalActor,
            customerId,
            target,
            [contentVersionId],
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(f.transaction.material.findMany).not.toHaveBeenCalled();
      },
    );
    it('requires a local real filing root, including for an external EXECUTING case', async () => {
      const f = setup();
      f.transaction.caseExecutionFiling.findFirst.mockResolvedValue(null);
      await expect(f.select()).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
      expect(f.transaction.material.findMany).not.toHaveBeenCalled();
    });
    it('keeps the branded facts bound to their transaction and immutable target snapshot', async () => {
      const f = setup();
      const mutable = { ...target };
      const facts = await f.service.assertExecutionSupplementVersions(
        f.transaction as unknown as MaterialTransactionClient,
        actor,
        customerId,
        mutable,
        [contentVersionId],
      );
      mutable.supplementId = 'another-target';
      f.transaction.caseExecutionFilingSupplement.findFirst.mockResolvedValue(
        f.version,
      );
      await expect(
        f.service.freezeCaseExecutionSupplementReferences(
          f.transaction as unknown as MaterialTransactionClient,
          actor,
          customerId,
          { ...mutable, versionId: supplementId },
          facts,
          auditEventId,
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      await expect(
        f.service.freezeCaseExecutionSupplementReferences(
          { ...f.transaction } as unknown as MaterialTransactionClient,
          actor,
          customerId,
          { ...target, versionId: supplementId },
          facts,
          auditEventId,
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
    });
  });
  it('never opens execution supplement preparation through generic uploads', async () => {
    const f = createFixture();
    await expect(
      f.service.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'EXECUTION_SUPPLEMENT',
        purpose: 'EXECUTION_SUPPLEMENT',
        originalFilename: '补交.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.db.uploadDraft.create).not.toHaveBeenCalled();
  });
  describe('dedicated section uploads', () => {
    const targetId = '44444444-4444-4444-8444-444444444444';
    const versionId = '55555555-5555-4555-8555-555555555555';
    const roundId = '66666666-6666-4666-8666-666666666666';
    const targets: CaseSectionRecordUploadTarget[] = [
      { kind: 'EXECUTION_MAILING', targetId, expectedRevision: 0 },
      { kind: 'EXECUTION_FILING', targetId, expectedRevision: 0 },
      { kind: 'EXECUTION_FINISH', targetId, expectedRevision: 0 },
      {
        kind: 'JUDGMENT',
        targetId,
        expectedRevision: 0,
        trialRoundId: roundId,
      },
      {
        kind: 'CLOSURE',
        targetId,
        expectedRevision: 0,
        expectedClosureVersionId: versionId,
      },
    ];
    function setup(target = targets[0]!) {
      const f = createFixture();
      const categories = {
        EXECUTION_MAILING: 'MAIL_RECEIPT',
        EXECUTION_FILING: 'EXECUTION_FILING_PROOF',
        EXECUTION_FINISH: 'EXECUTION_FINISH_BASIS',
        JUDGMENT: 'JUDGMENT',
        CLOSURE: 'CASE_CLOSURE_DOCUMENT',
      } as const;
      const commands = {
        EXECUTION_MAILING: 'EXECUTION_MAILING_CORRECTION',
        EXECUTION_FILING: 'EXECUTION_FILING_CORRECTION',
        EXECUTION_FINISH: 'EXECUTION_FINISH_CORRECTION',
        JUDGMENT: 'JUDGMENT_RECORD_CORRECTION',
        CLOSURE: 'CLOSURE_RECORD_CORRECTION',
      } as const;
      const category = categories[target.kind];
      f.transaction.case.findFirst.mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
        stage: 'ARCHIVED',
        version: 42,
      });
      f.transaction.userAccount.findUnique.mockResolvedValue({
        active: true,
        accountType: 'INTERNAL',
      });
      const state = {
        consumed: false,
        pendingCount: 0,
        draft: {
          id: 'draft-1',
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          internalActorUserId: actor.userId,
          notaryOfficeAccountBindingId: null,
          customerAccountBindingId: null,
          lawyerAccountBindingId: null,
          ownerType: 'CASE' as const,
          ownerId: customerId,
          category,
          purpose: category,
          originalFilename: '更正.pdf',
          declaredMimeType: 'application/pdf',
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
          pendingStorageKey: null as string | null,
          status: 'OPEN' as 'OPEN' | 'FINALIZED',
          caseSectionRecordCommand: commands[target.kind],
          caseSectionRecordTargetId: target.targetId,
          caseSectionRecordRevision: target.expectedRevision,
          caseSectionRecordTrialRoundId:
            target.kind === 'JUDGMENT' ? target.trialRoundId : null,
          caseSectionRecordClosureVersionId:
            target.kind === 'CLOSURE' ? target.expectedClosureVersionId : null,
        },
      };
      f.db.uploadDraft.findUnique.mockImplementation(async () => ({
        ...state.draft,
      }));
      f.transaction.uploadDraft.findUnique.mockImplementation(async () => ({
        ...state.draft,
      }));
      f.transaction.uploadDraft.updateMany.mockImplementation(
        async ({ data }) => {
          Object.assign(state.draft, data);
          return { count: 1 };
        },
      );
      f.transaction.$queryRawUnsafe.mockImplementation(async (sql) =>
        typeof sql === 'string' && sql.includes('has_first_freeze')
          ? [{ consumed: state.consumed }]
          : typeof sql === 'string' &&
              sql.includes('case_section_upload_current_is_frozen')
            ? [{ count: state.pendingCount }]
            : [{ id: customerId }],
      );
      f.transaction.caseClosure.findFirst.mockResolvedValue({
        currentVersionId: versionId,
      });
      f.transaction.caseClosureVersion.findFirst.mockResolvedValue({
        id: versionId,
      });
      f.storage.put.mockResolvedValue({
        sizeBytes: 12,
        sha256: 'a'.repeat(64),
        detectedMimeType: 'application/pdf',
      });
      const material = availableMaterial(
        'material-1',
        versionId,
        category,
        'CASE',
        customerId,
        category,
      );
      const version = {
        ...material.contentVersions[0],
        mimeType: 'application/pdf',
        sizeBytes: 12n,
        uploadedBy: actor.userId,
        caseSectionRecordUploadDraft: { ...state.draft, status: 'FINALIZED' },
      };
      f.transaction.material.findMany.mockResolvedValue([
        {
          ...material,
          currentVersionId: versionId,
          contentVersions: [version],
        },
      ]);
      return {
        ...f,
        state,
        category,
        target,
        version,
        tx: asTransactionClient(f.transaction),
        input: {
          ownerType: 'CASE' as const,
          ownerId: customerId,
          category,
          contentVersionIds: [versionId],
          sectionRecordKind: target.kind,
          sectionRecordTarget: target,
        },
      };
    }
    it.each(targets)(
      'creates $kind from current internal action/scope and exact head at later stages',
      async (target) => {
        const f = setup(target);
        const result = await f.service.createCaseSectionRecordUploadDraft(
          actor,
          customerId,
          target,
          { originalFilename: '更正.pdf', declaredMimeType: 'application/pdf' },
        );
        expect(result.recordCorrection).toEqual(target);
        expect(result.ownerType).toBe('CASE');
        expect(f.transaction.uploadDraft.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            ownerId: customerId,
            category: f.category,
            purpose: f.category,
            internalActorUserId: actor.userId,
            caseSectionRecordRevision: 0,
          }),
        });
        expect(
          f.transaction.$queryRawUnsafe.mock.invocationCallOrder[0],
        ).toBeLessThan(f.access.authorizeCase.mock.invocationCallOrder[0]!);
        expect(f.transaction.auditEvent.create).not.toHaveBeenCalled();
      },
    );
    it.each([targets[1]!, targets[2]!, targets[4]!])(
      'counts only the exact-current unconsumed pool for dedicated $kind uploads',
      async (target) => {
        const f = setup(target);
        f.transaction.material.count.mockResolvedValue(10);
        await expect(
          f.service.finalizeUpload(actor, 'draft-1', Readable.from('bytes')),
        ).resolves.toHaveProperty('recordCorrection', target);
        expect(f.transaction.material.count).not.toHaveBeenCalled();
        expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
          expect.stringContaining(
            'NOT case_section_upload_current_is_frozen(m.id',
          ),
          actor.departmentId,
          customerId,
          f.category,
        );
        const full = setup(target);
        full.state.pendingCount = 10;
        await expect(
          full.service.finalizeUpload(actor, 'draft-1', Readable.from('bytes')),
        ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
        expect(full.transaction.contentVersion.create).not.toHaveBeenCalled();
        expect(full.storage.delete).toHaveBeenCalledTimes(1);
      },
    );
    it.each(targets)(
      'checks $kind before streaming and again before finalization with server provenance',
      async (target) => {
        const f = setup(target);
        const result = await f.service.finalizeUpload(
          actor,
          'draft-1',
          Readable.from('bytes'),
        );
        expect(result).toMatchObject({
          recordCorrection: target,
          purpose: f.category,
        });
        expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
        expect(f.access.authorizeCase.mock.invocationCallOrder[0]).toBeLessThan(
          f.storage.put.mock.invocationCallOrder[0]!,
        );
        expect(
          f.access.authorizeCase.mock.invocationCallOrder[1],
        ).toBeGreaterThan(f.storage.put.mock.invocationCallOrder[0]!);
        expect(f.db.uploadDraft.updateMany).not.toHaveBeenCalled();
        expect(f.transaction.contentVersion.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            caseSectionRecordUploadDraftId: 'draft-1',
            uploadedBy: actor.userId,
          }),
        });
        expect(f.state.draft.status).toBe('FINALIZED');
        await expect(
          f.service.finalizeUpload(actor, 'draft-1', Readable.from('again')),
        ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
        expect(f.storage.put).toHaveBeenCalledTimes(1);
      },
    );
    it.each(['create', 'claim', 'finalize', 'consume'] as const)(
      'denies revoked authorization at %s',
      async (phase) => {
        const f = setup();
        const denied = new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
        if (phase === 'finalize')
          f.storage.put.mockImplementation(async () => {
            f.access.authorizeCase.mockRejectedValue(denied);
            return {
              sizeBytes: 12,
              sha256: 'a'.repeat(64),
              detectedMimeType: 'application/pdf',
            };
          });
        else f.access.authorizeCase.mockRejectedValue(denied);
        const operation =
          phase === 'create'
            ? f.service.createCaseSectionRecordUploadDraft(
                actor,
                customerId,
                f.target,
                {
                  originalFilename: '更正.pdf',
                  declaredMimeType: 'application/pdf',
                },
              )
            : phase === 'consume'
              ? f.service.assertAvailableVersions(f.tx, actor, f.input)
              : f.service.finalizeUpload(
                  actor,
                  'draft-1',
                  Readable.from('bytes'),
                );
        await expect(operation).rejects.toBeInstanceOf(ForbiddenException);
        expect(f.transaction.contentVersion.create).not.toHaveBeenCalled();
        if (phase === 'finalize')
          expect(f.storage.delete).toHaveBeenCalledTimes(1);
        else expect(f.storage.put).not.toHaveBeenCalled();
      },
    );
    it('rejects stale claim and independent closure source changes before bytes', async () => {
      const f = setup();
      f.transaction.caseExecutionMailingRecordCorrection.findFirst.mockResolvedValue(
        { toRevision: 1 },
      );
      await expect(
        f.service.finalizeUpload(actor, 'draft-1', Readable.from('bytes')),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.storage.put).not.toHaveBeenCalled();
      const c = setup(targets[4]);
      c.transaction.caseClosure.findFirst.mockResolvedValue({
        currentVersionId: roundId,
      });
      await expect(
        c.service.finalizeUpload(actor, 'draft-1', Readable.from('bytes')),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(c.storage.put).not.toHaveBeenCalled();
    });
    it.each(targets)(
      'rejects unconsumed $kind current AVAILABLE in old workflows and wrong target',
      async (target) => {
        const f = setup(target);
        const {
          sectionRecordKind: _kind,
          sectionRecordTarget: _target,
          ...legacy
        } = f.input;
        void _kind;
        void _target;
        await expect(
          f.service.assertAvailableVersions(f.tx, actor, legacy),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
        await expect(
          f.service.assertAvailableVersions(f.tx, actor, {
            ...f.input,
            sectionRecordTarget: { ...target, targetId: roundId },
          }),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
        expect(
          f.transaction.materialReference.createMany,
        ).not.toHaveBeenCalled();
      },
    );
    it.each(targets)(
      'allows $kind precise first selection but prohibits generic freeze before matching correction',
      async (target) => {
        const f = setup(target);
        const facts = await f.service.assertAvailableVersions(
          f.tx,
          actor,
          f.input,
        );
        await expect(
          f.service.freezeReferences(f.tx, {
            departmentId: actor.departmentId,
            resourceType: 'case',
            resourceId: customerId,
            actionEventId: 'event',
            facts,
          }),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
        await expect(
          f.service.freezeCaseSectionRecordCorrectionReferences(
            f.tx,
            actor,
            customerId,
            { kind: target.kind, correctionId: 'correction' },
            facts,
            'event',
          ),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
      },
    );
    it.each(targets)(
      'keeps unconsumed $kind preparation out of a legitimate lawyer list/open until actual proof',
      async (target) => {
        const f = setup(target);
        const lawyer = { ...actor, lawyerAccountId: actor.userId };
        f.db.caseLawyerAssignment.findFirst.mockResolvedValue({
          lawyer: { accountBinding: { id: 'lawyer-binding' } },
        });
        f.db.case.findFirst.mockResolvedValue({ stage: 'ARCHIVED' });
        f.db.materialReference.findMany.mockResolvedValue([]);
        f.db.materialReference.findFirst.mockResolvedValue(null);
        f.db.$queryRawUnsafe.mockImplementation(async () => [
          { id: customerId, consumed: f.state.consumed },
        ]);
        const version = {
          id: versionId,
          materialId: 'material-1',
          originalFilename: '内部准备.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 12n,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
          createdAt: now,
          caseSectionRecordUploadDraftId: 'draft-1' as string | null,
        };
        const material = {
          id: 'material-1',
          ownerType: 'CASE',
          ownerId: customerId,
          departmentId: actor.departmentId,
          category: f.category,
          purpose: f.category,
          currentVersionId: versionId,
          status: 'ACTIVE',
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          currentVersion: {
            caseSectionRecordUploadDraftId: 'draft-1' as string | null,
          },
          contentVersions: [version],
        };
        f.db.material.findMany.mockResolvedValue([material]);
        f.db.material.findFirst.mockResolvedValue(material);
        f.storage.open.mockImplementation(async () =>
          Readable.from('original bytes'),
        );
        await expect(
          f.service.listOwnerMaterials(lawyer, 'CASE', customerId),
        ).resolves.toEqual({ items: [], total: 0 });
        await expect(
          f.service.openVersion(lawyer, material.id, versionId),
        ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
        expect(f.storage.open).not.toHaveBeenCalled();
        f.state.consumed = true;
        const visible = await f.service.listOwnerMaterials(
          lawyer,
          'CASE',
          customerId,
        );
        expect(visible.total).toBe(1);
        expect(visible.items[0]?.contentVersions[0]).not.toHaveProperty(
          'recordCorrection',
        );
        await expect(
          f.service.openVersion(lawyer, material.id, versionId),
        ).resolves.toHaveProperty('mimeType', 'application/pdf');
        f.state.consumed = false;
        version.caseSectionRecordUploadDraftId = null;
        material.currentVersion.caseSectionRecordUploadDraftId = null;
        await expect(
          f.service.listOwnerMaterials(lawyer, 'CASE', customerId),
        ).resolves.toHaveProperty('total', 1);
        await expect(
          f.service.openVersion(lawyer, material.id, versionId),
        ).resolves.toHaveProperty('mimeType', 'application/pdf');
      },
    );
    it('reuses an actually consumed same-kind version after its original upload revision is stale', async () => {
      const f = setup();
      f.state.consumed = true;
      f.transaction.caseExecutionMailingRecordCorrection.findFirst.mockResolvedValue(
        { toRevision: 2 },
      );
      await expect(
        f.service.assertAvailableVersions(f.tx, actor, {
          ...f.input,
          sectionRecordTarget: { ...f.target, expectedRevision: 2 },
        }),
      ).resolves.toHaveLength(1);
      expect(
        f.transaction.caseExecutionMailingRecordCorrection.findFirst,
      ).not.toHaveBeenCalled();
    });
    it.each(targets)(
      'freezes $kind first facts only against its actual correction before creating references',
      async (target) => {
        const f = setup(target);
        const facts = await f.service.assertAvailableVersions(
          f.tx,
          actor,
          f.input,
        );
        const delegates = {
          EXECUTION_MAILING: f.transaction.caseExecutionMailingRecordCorrection,
          EXECUTION_FILING: f.transaction.caseExecutionFilingRecordCorrection,
          EXECUTION_FINISH: f.transaction.caseExecutionFinishRecordCorrection,
          JUDGMENT: f.transaction.caseJudgmentRecordCorrection,
          CLOSURE: f.transaction.caseClosureRecordCorrection,
        };
        delegates[target.kind].findFirst.mockResolvedValue({
          id: 'correction',
        });
        await f.service.freezeCaseSectionRecordCorrectionReferences(
          f.tx,
          actor,
          customerId,
          { kind: target.kind, correctionId: 'correction' },
          facts,
          'event',
        );
        expect(delegates[target.kind].findFirst).toHaveBeenLastCalledWith({
          where: expect.objectContaining({
            id: 'correction',
            fromRevision: 0,
            recordedByUserId: actor.userId,
            auditEventId: 'event',
          }),
          select: { id: true },
        });
        expect(f.transaction.materialReference.createMany).toHaveBeenCalledWith(
          {
            data: [
              expect.objectContaining({
                resourceId: customerId,
                contentVersionId: versionId,
                actionEventId: 'event',
              }),
            ],
            skipDuplicates: true,
          },
        );
      },
    );
    it('rechecks head and compensates bytes when a concurrent correction wins during transmission', async () => {
      const f = setup();
      f.storage.put.mockImplementation(async () => {
        f.transaction.caseExecutionMailingRecordCorrection.findFirst.mockResolvedValue(
          { toRevision: 1 },
        );
        return {
          sizeBytes: 12,
          sha256: 'a'.repeat(64),
          detectedMimeType: 'application/pdf',
        };
      });
      await expect(
        f.service.finalizeUpload(actor, 'draft-1', Readable.from('bytes')),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.storage.delete).toHaveBeenCalledTimes(1);
      expect(f.transaction.contentVersion.create).not.toHaveBeenCalled();
      expect(f.db.uploadDraft.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pendingStorageKey: null } }),
      );
    });
  });
  describe('section record correction references', () => {
    const definitions = [
      [
        'EXECUTION_MAILING',
        'MAIL_RECEIPT',
        'caseExecutionMailingRecordCorrectionDocument',
      ],
      [
        'EXECUTION_FILING',
        'EXECUTION_FILING_PROOF',
        'caseExecutionFilingRecordCorrectionDocument',
      ],
      [
        'EXECUTION_FINISH',
        'EXECUTION_FINISH_BASIS',
        'caseExecutionFinishRecordCorrectionDocument',
      ],
      ['JUDGMENT', 'JUDGMENT', 'caseJudgmentRecordCorrectionDocument'],
      [
        'CLOSURE',
        'CASE_CLOSURE_DOCUMENT',
        'caseClosureRecordCorrectionDocument',
      ],
    ] as const;
    function setup(
      category: (typeof definitions)[number][1],
      mimeType = 'application/pdf',
      sizeBytes = 12n,
    ) {
      const f = createFixture();
      f.transaction.case.findFirst.mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
      });
      f.transaction.material.findMany.mockResolvedValue([
        {
          id: 'material-1',
          departmentId: actor.departmentId,
          ownerType: 'CASE',
          ownerId: customerId,
          category,
          purpose: category,
          status: 'ACTIVE',
          currentVersionId: 'newer-version',
          contentVersions: [
            { id: 'v1', status: 'AVAILABLE', mimeType, sizeBytes },
          ],
        },
      ]);
      f.transaction.materialReference.findFirst.mockResolvedValue({
        id: 'frozen-reference',
      });
      return f;
    }
    it.each(definitions)(
      'freezes %s documents and references only in the new typed facts',
      async (kind, category, delegate) => {
        const f = setup(category);
        const tx = asTransactionClient(f.transaction);
        const facts = await f.service.assertAvailableVersions(tx, actor, {
          ownerType: 'CASE',
          ownerId: customerId,
          category,
          contentVersionIds: ['v1'],
          sectionRecordKind: kind,
        });
        await f.service.freezeCaseSectionRecordCorrectionReferences(
          tx,
          actor,
          customerId,
          { kind, correctionId: 'correction-1' },
          facts,
          'audit-1',
        );
        expect(f.transaction[delegate].create).toHaveBeenCalledWith({
          data: {
            correctionId: 'correction-1',
            caseId: customerId,
            departmentId: actor.departmentId,
            materialId: 'material-1',
            contentVersionId: 'v1',
          },
        });
        expect(f.transaction.materialReference.createMany).toHaveBeenCalledWith(
          {
            data: [
              {
                departmentId: actor.departmentId,
                resourceType: 'case',
                resourceId: customerId,
                purpose: category,
                materialId: 'material-1',
                contentVersionId: 'v1',
                actionEventId: 'audit-1',
              },
            ],
            skipDuplicates: true,
          },
        );
        expect(f.transaction.caseClosureDocument.create).not.toHaveBeenCalled();
        expect(
          f.transaction.caseExecutionFinishVersion.create,
        ).not.toHaveBeenCalled();
        expect(f.transaction.materialReference.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              materialId: 'material-1',
              contentVersionId: 'v1',
              resourceId: customerId,
              purpose: category,
              actionEvent: expect.objectContaining({
                action: {
                  in: expect.arrayContaining([
                    expect.stringContaining('record-corrected'),
                  ]),
                },
              }),
            }),
          }),
        );
      },
    );
    it.each(definitions)(
      'rejects a skipped %s reference instead of committing a document without its exact event reference',
      async (kind, category) => {
        const f = setup(category);
        f.transaction.materialReference.createMany.mockResolvedValueOnce({
          count: 0,
        });
        const tx = asTransactionClient(f.transaction);
        const facts = await f.service.assertAvailableVersions(tx, actor, {
          ownerType: 'CASE',
          ownerId: customerId,
          category,
          contentVersionIds: ['v1'],
          sectionRecordKind: kind,
        });
        await expect(
          f.service.freezeCaseSectionRecordCorrectionReferences(
            tx,
            actor,
            customerId,
            { kind, correctionId: 'correction-1' },
            facts,
            'audit-1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
      },
    );
    it.each(definitions)(
      'allows empty %s only for optional document sections',
      async (kind, category) => {
        const f = setup(category);
        const result = f.service.freezeCaseSectionRecordCorrectionReferences(
          asTransactionClient(f.transaction),
          actor,
          customerId,
          { kind, correctionId: 'correction-1' },
          [],
          'audit-1',
        );
        if (kind === 'EXECUTION_FINISH' || kind === 'CLOSURE')
          await expect(result).resolves.toBeUndefined();
        else
          await expect(result).rejects.toMatchObject({
            response: { code: 'MATERIAL_VERSION_INVALID' },
          });
        expect(
          f.transaction.materialReference.createMany,
        ).not.toHaveBeenCalled();
      },
    );
    it.each([
      { clientCustomerId: customerId },
      { notaryOfficeId: 'office-1' },
      { lawyerAccountId: 'lawyer-1' },
    ])('rejects external opt-in before lookup: %p', async (external) => {
      const f = setup('MAIL_RECEIPT');
      await expect(
        f.service.assertAvailableVersions(
          asTransactionClient(f.transaction),
          { ...actor, ...external },
          {
            ownerType: 'CASE',
            ownerId: customerId,
            category: 'MAIL_RECEIPT',
            contentVersionIds: ['v1'],
            sectionRecordKind: 'EXECUTION_MAILING',
          },
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      expect(f.transaction.material.findMany).not.toHaveBeenCalled();
    });
    it('keeps obsolete mailing versions unavailable without explicit correction opt-in', async () => {
      const f = setup('MAIL_RECEIPT');
      await expect(
        f.service.assertAvailableVersions(
          asTransactionClient(f.transaction),
          actor,
          {
            ownerType: 'CASE',
            ownerId: customerId,
            category: 'MAIL_RECEIPT',
            contentVersionIds: ['v1'],
          },
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      expect(f.transaction.materialReference.findFirst).not.toHaveBeenCalled();
    });
    it.each([
      'case',
      'department',
      'kind',
      'transaction',
      'unbranded',
      'duplicate',
      'mime',
      'size',
    ] as const)(
      'rejects %s mismatch before writing any reference or document',
      async (failure) => {
        const f = setup(
          'MAIL_RECEIPT',
          failure === 'mime' ? 'text/html' : 'application/pdf',
          failure === 'size' ? 0n : 12n,
        );
        const tx = asTransactionClient(f.transaction);
        const facts = await f.service.assertAvailableVersions(tx, actor, {
          ownerType: 'CASE',
          ownerId: customerId,
          category: 'MAIL_RECEIPT',
          contentVersionIds: ['v1'],
          sectionRecordKind: 'EXECUTION_MAILING',
        });
        await expect(
          f.service.freezeCaseSectionRecordCorrectionReferences(
            failure === 'transaction'
              ? asTransactionClient(createFixture().transaction)
              : tx,
            failure === 'department'
              ? { ...actor, departmentId: 'other-department' }
              : actor,
            failure === 'case' ? 'other-case' : customerId,
            {
              kind: (failure === 'kind'
                ? 'JUDGMENT'
                : 'EXECUTION_MAILING') satisfies CaseSectionRecordKind,
              correctionId: 'correction-1',
            },
            failure === 'unbranded'
              ? [{ ...facts[0]! }]
              : failure === 'duplicate'
                ? [...facts, ...facts]
                : facts,
            'audit-1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
        for (const [, , delegate] of definitions)
          expect(f.transaction[delegate].create).not.toHaveBeenCalled();
        expect(
          f.transaction.materialReference.createMany,
        ).not.toHaveBeenCalled();
      },
    );
  });
  it('freezes only the complete currently available execution application bundle', async () => {
    const f = createFixture();
    f.transaction.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    const materials = ['v1', 'v2'].map((id) => ({
      id: `material-${id}`,
      departmentId: actor.departmentId,
      ownerType: 'CASE',
      ownerId: customerId,
      category: 'EXECUTION_APPLICATION',
      purpose: 'EXECUTION_APPLICATION',
      status: 'ACTIVE',
      currentVersionId: id,
      contentVersions: [
        {
          id,
          status: 'AVAILABLE',
          mimeType: 'application/pdf',
          sizeBytes: 12n,
        },
      ],
    }));
    f.transaction.material.findMany.mockResolvedValue(materials);
    f.transaction.$queryRawUnsafe.mockResolvedValue([
      { content_version_id: 'v1' },
      { content_version_id: 'v2' },
    ]);
    const tx = asTransactionClient(f.transaction);
    await expect(
      f.service.assertCompleteCurrentCaseExecutionApplicationBundle(
        tx,
        actor,
        customerId,
        ['v1'],
      ),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
    await expect(
      f.service.assertCompleteCurrentCaseExecutionApplicationBundle(
        tx,
        actor,
        customerId,
        ['v1', 'v2'],
      ),
    ).resolves.toHaveLength(2);
    expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR SHARE OF material, version'),
      actor.departmentId,
      customerId,
    );

    f.transaction.$queryRawUnsafe.mockResolvedValue([
      { content_version_id: 'v2' },
      { content_version_id: 'v3' },
    ]);
    await expect(
      f.service.assertCompleteCurrentCaseExecutionApplicationBundle(
        tx,
        actor,
        customerId,
        ['v1', 'v2'],
      ),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
  });
  it('uploads closure documents under the correct independent action and refuses a missing exact source', async () => {
    const f = createFixture();
    const record = {
      departmentId: actor.departmentId,
      stage: 'WAITING_ARCHIVE',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      closure: null,
    };
    f.db.case.findFirst.mockResolvedValue(record);
    const input = {
      ownerType: 'CASE' as const,
      ownerId: customerId,
      category: 'CASE_CLOSURE_DOCUMENT' as const,
      purpose: 'CASE_CLOSURE_DOCUMENT' as const,
      originalFilename: '结案.pdf',
      declaredMimeType: 'application/pdf',
    };
    await expect(
      f.service.createUploadDraft(actor, input),
    ).resolves.toMatchObject({ category: 'CASE_CLOSURE_DOCUMENT' });
    expect(f.access.authorizeCase).toHaveBeenLastCalledWith(
      actor,
      'case.closure.record',
      expect.any(Object),
      undefined,
    );
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      closure: { id: 'closure' },
    });
    await f.service.createUploadDraft(actor, input);
    expect(f.access.authorizeCase).toHaveBeenLastCalledWith(
      actor,
      'case.closure.correct',
      expect.any(Object),
      undefined,
    );
    f.db.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      f.service.createUploadDraft(actor, input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    await expect(
      f.service.createUploadDraft(
        { ...actor, clientCustomerId: customerId },
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it('freezes authentic closure versions and reads a particular historical version without following current bytes', async () => {
    const f = createFixture();
    f.transaction.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_ARCHIVE',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      closure: null,
    });
    f.transaction.material.findMany.mockResolvedValue([
      {
        id: 'material',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'CASE_CLOSURE_DOCUMENT',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        status: 'ACTIVE',
        currentVersionId: 'v1',
        contentVersions: [
          {
            id: 'v1',
            status: 'AVAILABLE',
            mimeType: 'application/pdf',
            sizeBytes: 12n,
          },
        ],
      },
    ]);
    const facts = await f.service.assertAvailableVersions(
      asTransactionClient(f.transaction),
      actor,
      {
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'CASE_CLOSURE_DOCUMENT',
        contentVersionIds: ['v1'],
      },
    );
    await f.service.freezeCaseClosureReferences(
      asTransactionClient(f.transaction),
      actor,
      customerId,
      'closure-v1',
      facts,
      'audit',
    );
    expect(f.transaction.caseClosureDocument.create).toHaveBeenCalledWith({
      data: {
        closureVersionId: 'closure-v1',
        caseId: customerId,
        departmentId: actor.departmentId,
        materialId: 'material',
        contentVersionId: 'v1',
      },
    });
    await expect(
      f.service.freezeCaseClosureReferences(
        asTransactionClient(f.transaction),
        actor,
        customerId,
        'closure-v1',
        [{ ...facts[0] }],
        'audit',
      ),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
    f.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_ARCHIVE',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    f.db.caseClosureDocument.findMany.mockResolvedValue([
      {
        materialId: 'material',
        contentVersionId: 'v1',
        contentVersion: {
          originalFilename: '原文.pdf',
          mimeType: 'application/pdf',
        },
      },
    ]);
    expect(
      await f.service.listFrozenCaseClosureFiles(
        actor,
        customerId,
        'closure-v1',
      ),
    ).toEqual([
      {
        materialId: 'material',
        contentVersionId: 'v1',
        originalFilename: '原文.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    await expect(
      f.service.listFrozenCaseClosureFiles(
        { ...actor, clientCustomerId: customerId },
        customerId,
        'closure-v1',
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it('uploads finish basis only under the finish action and an exact current executing source', async () => {
    const f = createFixture();
    f.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'EXECUTING',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    const input = {
      ownerType: 'CASE' as const,
      ownerId: customerId,
      category: 'EXECUTION_FINISH_BASIS' as const,
      purpose: 'EXECUTION_FINISH_BASIS' as const,
      originalFilename: '真实依据.pdf',
      declaredMimeType: 'application/pdf',
    };
    await expect(
      f.service.createUploadDraft(actor, input),
    ).resolves.toMatchObject({ category: 'EXECUTION_FINISH_BASIS' });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.finish',
      expect.any(Object),
      undefined,
    );
    expect(f.db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('f."to_version"=c."version"'),
      customerId,
      actor.departmentId,
    );
    f.db.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      f.service.createUploadDraft(actor, input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    await expect(
      f.service.createUploadDraft(
        { ...actor, clientCustomerId: customerId },
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it('freezes the exact validated finish version, rejects forged facts and exposes only authorized frozen files', async () => {
    const f = createFixture();
    f.transaction.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'EXECUTING',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    f.transaction.material.findMany.mockResolvedValue([
      {
        id: 'basis',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'EXECUTION_FINISH_BASIS',
        purpose: 'EXECUTION_FINISH_BASIS',
        status: 'ACTIVE',
        currentVersionId: 'basis-v1',
        contentVersions: [
          {
            id: 'basis-v1',
            status: 'AVAILABLE',
            mimeType: 'application/pdf',
            sizeBytes: 12n,
          },
        ],
      },
    ]);
    const facts = await f.service.assertAvailableVersions(
      f.transaction as unknown as MaterialTransactionClient,
      actor,
      {
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'EXECUTION_FINISH_BASIS',
        contentVersionIds: ['basis-v1'],
      },
    );
    await f.service.freezeCaseExecutionFinishReferences(
      f.transaction as unknown as MaterialTransactionClient,
      actor,
      customerId,
      'finish',
      facts,
      'audit',
    );
    expect(
      f.transaction.caseExecutionFinishVersion.create,
    ).toHaveBeenCalledWith({
      data: {
        finishId: 'finish',
        caseId: customerId,
        departmentId: actor.departmentId,
        materialId: 'basis',
        contentVersionId: 'basis-v1',
      },
    });
    expect(f.transaction.materialReference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'EXECUTION_FINISH_BASIS',
        contentVersionId: 'basis-v1',
        actionEventId: 'audit',
      }),
    });
    await expect(
      f.service.freezeCaseExecutionFinishReferences(
        f.transaction as unknown as MaterialTransactionClient,
        actor,
        customerId,
        'finish',
        [{ ...facts[0] }],
        'audit',
      ),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
    f.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_ARCHIVE',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    f.db.materialReference.findMany.mockResolvedValue([
      {
        materialId: 'basis',
        contentVersionId: 'basis-v1',
        contentVersion: {
          originalFilename: 'original.pdf',
          mimeType: 'application/pdf',
        },
      },
    ]);
    await expect(
      f.service.listFrozenCaseExecutionFinishFiles(actor, customerId),
    ).resolves.toEqual([
      {
        materialId: 'basis',
        contentVersionId: 'basis-v1',
        originalFilename: 'original.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    await expect(
      f.service.listFrozenCaseExecutionFinishFiles(
        { ...actor, clientCustomerId: customerId },
        customerId,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it.each([0, 1])(
    'client mail candidates exclude versions frozen by a prior action (%s)',
    async (priorReferences) => {
      const f = createFixture();
      const client = { ...actor, clientCustomerId: customerId };
      f.transaction.customerAccountBinding.findFirst.mockResolvedValue({
        id: 'binding-1',
      });
      f.transaction.case.findFirst.mockResolvedValue({
        stage: 'WAITING_EXECUTION_STAMP',
      });
      f.transaction.materialReference.count.mockResolvedValue(priorReferences);
      f.transaction.material.findMany.mockResolvedValue([
        {
          id: 'receipt-1',
          departmentId: actor.departmentId,
          ownerType: 'CASE',
          ownerId: customerId,
          category: 'MAIL_RECEIPT',
          purpose: 'MAIL_RECEIPT',
          status: 'ACTIVE',
          currentVersionId: 'version-1',
          contentVersions: [
            {
              id: 'version-1',
              status: 'AVAILABLE',
              mimeType: 'image/png',
              sizeBytes: 10n,
              uploadedBy: actor.userId,
            },
          ],
        },
      ]);
      const result = f.service.assertAvailableVersions(
        f.transaction as unknown as MaterialTransactionClient,
        client,
        {
          ownerType: 'CASE',
          ownerId: customerId,
          category: 'MAIL_RECEIPT',
          contentVersionIds: ['version-1'],
          minCount: 1,
          maxCount: 10,
        },
      );
      if (priorReferences === 0) await expect(result).resolves.toHaveLength(1);
      else
        await expect(result).rejects.toMatchObject({
          response: { code: 'MATERIAL_VERSION_INVALID' },
        });
    },
  );
  it.each(['WAITING_COMPLAINT_STAMP', 'WAITING_EXECUTION_STAMP'])(
    'permits only a bound client to draft a mail receipt in %s',
    async (stage) => {
      const fixture = createFixture();
      const client = { ...actor, clientCustomerId: customerId };
      fixture.db.customerAccountBinding.findFirst.mockResolvedValue({
        id: 'binding-1',
      });
      fixture.db.case.findFirst.mockResolvedValue({
        departmentId: actor.departmentId,
        customerId,
        stage,
        complaintConfirmation: { id: 'confirmation-1' },
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
      });
      const receipt = {
        ownerType: 'CASE' as const,
        ownerId: customerId,
        category: 'MAIL_RECEIPT' as const,
        purpose: 'MAIL_RECEIPT' as const,
        originalFilename: 'receipt.pdf',
        declaredMimeType: 'application/pdf',
      };
      await expect(
        fixture.service.createUploadDraft(client, receipt),
      ).resolves.toMatchObject({
        category: 'MAIL_RECEIPT',
      });
      expect(fixture.db.uploadDraft.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerAccountBindingId: 'binding-1',
          }),
        }),
      );
      await expect(
        fixture.service.createUploadDraft(client, {
          ...receipt,
          category: 'COMPLAINT',
          purpose: 'COMPLAINT',
        }),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      fixture.db.customerAccountBinding.findFirst.mockResolvedValue(null);
      await expect(
        fixture.service.createUploadDraft(client, receipt),
      ).rejects.toMatchObject({
        response: { code: 'ACTION_FORBIDDEN' },
      });
    },
  );
  it('enumerates only exact confirmed CASE versions and never reveals a current pointer', async () => {
    const fixture = createFixture();
    const client = { ...actor, clientCustomerId: customerId };
    fixture.db.customerAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.case.findFirst.mockResolvedValue({
      stage: 'WAITING_COMPLAINT_STAMP',
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'confirmed-version',
      },
    });
    fixture.db.materialReference.findMany.mockResolvedValue([
      {
        materialId: 'confirmed-material',
        contentVersionId: 'confirmed-version',
        purpose: 'COMPLAINT_CONFIRMATION',
      },
      {
        materialId: 'authorization-material',
        contentVersionId: 'authorization-version',
        purpose: 'AUTHORIZATION',
      },
    ]);
    fixture.db.material.findMany.mockResolvedValue([
      {
        id: 'confirmed-material',
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        currentVersionId: 'unconfirmed-version',
        status: 'ACTIVE',
        version: 2,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        contentVersions: [
          {
            id: 'confirmed-version',
            materialId: 'confirmed-material',
            originalFilename: '确认诉状.pdf',
            mimeType: 'application/pdf',
            sizeBytes: BigInt(4),
            sha256: 'a'.repeat(64),
            status: 'AVAILABLE',
            createdAt: now,
          },
        ],
      },
    ]);
    const result = await fixture.service.listOwnerMaterials(
      client,
      'CASE',
      customerId,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].currentVersionId).toBeNull();
    expect(
      result.items[0].contentVersions.map((version) => version.id),
    ).toEqual(['confirmed-version']);
    expect(fixture.db.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerType: 'CASE',
          ownerId: customerId,
          id: { in: expect.arrayContaining(['confirmed-material']) },
        }),
      }),
    );
  });
  it.each([
    'SECOND_INSTANCE_DOCUMENT',
    'SECOND_INSTANCE_SERVICE',
    'SECOND_INSTANCE_JUDGMENT',
  ] as const)(
    'lists %s current and exact frozen versions only for the current primary lawyer',
    async (category) => {
      const fixture = createFixture();
      let pointer = 'current-version';
      const lawyer = { ...actor, lawyerAccountId: actor.userId };
      fixture.db.caseLawyerAssignment.findFirst.mockResolvedValue({
        lawyer: { accountBinding: { id: 'binding-1' } },
      });
      fixture.db.case.findFirst.mockResolvedValue({ stage: 'SECOND_INSTANCE' });
      fixture.db.materialReference.findMany.mockResolvedValue([]);
      if (category === 'SECOND_INSTANCE_JUDGMENT')
        fixture.db.caseSecondInstanceResultVersion.findMany.mockResolvedValue([
          { materialId: 'second-material', contentVersionId: 'frozen-version' },
        ]);
      else
        fixture.db.caseSecondInstanceProgressVersion.findMany.mockResolvedValue(
          [
            {
              materialId: 'second-material',
              contentVersionId: 'frozen-version',
              category,
            },
          ],
        );
      fixture.db.material.findMany.mockImplementation(async ({ where }) => {
        if (!where.id) {
          return where.category.in.includes(category)
            ? [
                {
                  id: 'second-material',
                  category,
                  currentVersionId: pointer,
                },
              ]
            : [];
        }
        return [
          {
            id: 'second-material',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category,
            purpose: category,
            currentVersionId: pointer,
            status: 'ACTIVE',
            version: 2,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
            contentVersions: [
              {
                id: 'current-version',
                materialId: 'second-material',
                originalFilename: '二审进展.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 4n,
                sha256: 'a'.repeat(64),
                status: 'AVAILABLE',
                createdAt: now,
              },
              ...['frozen-version', 'unfrozen-version'].map((id) => ({
                id,
                materialId: 'second-material',
                originalFilename: `${id}.pdf`,
                mimeType: 'application/pdf',
                sizeBytes: 4n,
                sha256: 'a'.repeat(64),
                status: 'AVAILABLE',
                createdAt: now,
              })),
            ],
          },
        ];
      });
      const listed = await fixture.service.listOwnerMaterials(
        lawyer,
        'CASE',
        'case-1',
      );
      expect(listed.items[0]).toMatchObject({
        category,
        currentVersionId: 'current-version',
        contentVersions: [{ id: 'current-version' }, { id: 'frozen-version' }],
      });
      pointer = 'missing-version';
      const missingPointer = await fixture.service.listOwnerMaterials(
        lawyer,
        'CASE',
        'case-1',
      );
      expect(missingPointer.items[0]).toMatchObject({
        currentVersionId: null,
        contentVersions: [{ id: 'frozen-version' }],
      });
      fixture.db.caseLawyerAssignment.findFirst.mockResolvedValue(null);
      await expect(
        fixture.service.listOwnerMaterials(lawyer, 'CASE', 'case-1'),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      const client = { ...actor, clientCustomerId: customerId };
      fixture.db.customerAccountBinding.findFirst.mockResolvedValue({
        id: 'client-binding',
      });
      fixture.db.case.findFirst.mockResolvedValue({
        stage: 'SECOND_INSTANCE',
        complaintConfirmation: {
          confirmedComplaintContentVersionId: 'complaint-1',
        },
      });
      expect(
        (await fixture.service.listOwnerMaterials(client, 'CASE', 'case-1'))
          .items,
      ).toEqual([]);
    },
  );
  it('denies a client who guesses a CASE material version outside the whitelist', async () => {
    const fixture = createFixture();
    const client = { ...actor, clientCustomerId: customerId };
    fixture.db.customerAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.case.findFirst.mockResolvedValue({
      stage: 'WAITING_COMPLAINT_STAMP',
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'confirmed-version',
      },
    });
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'other-material',
      departmentId: actor.departmentId,
      ownerType: 'CASE',
      ownerId: customerId,
      category: 'COMPLAINT',
      status: 'ACTIVE',
      contentVersions: [{ id: 'guessed-version', storageKey: 'secret-key' }],
    });
    fixture.db.materialReference.findMany.mockResolvedValue([]);
    fixture.db.material.findMany.mockResolvedValue([]);
    await expect(
      fixture.service.openVersion(client, 'other-material', 'guessed-version'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.storage.open).not.toHaveBeenCalled();
  });
  it('allows only COMPLAINT drafts at the confirmation stage with live confirm scope', async () => {
    const fixture = createFixture();
    fixture.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    const base = {
      ownerType: 'CASE' as const,
      ownerId: customerId,
      category: 'COMPLAINT' as const,
      purpose: 'COMPLAINT' as const,
      originalFilename: '修订诉状.pdf',
      declaredMimeType: 'application/pdf',
    };
    await fixture.service.createUploadDraft(actor, base);
    expect(fixture.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.complaint.confirm',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      undefined,
    );
    await expect(
      fixture.service.createUploadDraft(actor, {
        ...base,
        category: 'AUTHORIZATION',
        purpose: 'AUTHORIZATION',
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    fixture.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_COMPLAINT_STAMP',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    await expect(
      fixture.service.createUploadDraft(actor, base),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });
  it('allows CASE complaint drafts only for internal case readers with live write scope', async () => {
    const fixture = createFixture();
    fixture.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_COMPLAINT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    const input = {
      ownerType: 'CASE' as const,
      ownerId: customerId,
      category: 'COMPLAINT' as const,
      purpose: 'COMPLAINT' as const,
      originalFilename: '诉状.docx',
      declaredMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    await fixture.service.createUploadDraft(actor, input);
    expect(fixture.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
      undefined,
    );
    expect(fixture.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.complaint.submit',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      undefined,
    );
    expect(fixture.db.uploadDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
      }),
    });
    await expect(
      fixture.service.createUploadDraft(
        { ...actor, clientCustomerId: 'client' },
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    fixture.db.case.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.createUploadDraft(actor, input),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });
  it('rejects an obsolete CASE content version during transactional submission validation', async () => {
    const fixture = createFixture();
    fixture.transaction.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_COMPLAINT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    fixture.transaction.material.findMany.mockResolvedValue([
      {
        id: 'material-1',
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        currentVersionId: 'new-version',
        status: 'ACTIVE',
        contentVersions: [
          {
            id: 'old-version',
            mimeType: 'application/pdf',
            status: 'AVAILABLE',
            uploadedBy: actor.userId,
          },
        ],
      },
    ]);
    await expect(
      fixture.service.assertAvailableVersions(
        asTransactionClient(fixture.transaction),
        actor,
        {
          ownerType: 'CASE',
          ownerId: customerId,
          category: 'COMPLAINT',
          contentVersionIds: ['old-version'],
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
  });
  it('returns current available CASE materials after a refresh under case.read', async () => {
    const fixture = createFixture();
    fixture.db.case.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      stage: 'WAITING_COMPLAINT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    fixture.db.material.findMany.mockResolvedValue([
      {
        id: 'material-1',
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        currentVersionId: 'version-1',
        status: 'ACTIVE',
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        contentVersions: [
          {
            id: 'version-1',
            materialId: 'material-1',
            originalFilename: '诉状.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 12n,
            sha256: 'a'.repeat(64),
            status: 'AVAILABLE',
            createdAt: now,
          },
        ],
      },
    ]);
    const listed = await fixture.service.listOwnerMaterials(
      actor,
      'CASE',
      customerId,
    );
    expect(listed.items[0]).toMatchObject({
      category: 'COMPLAINT',
      contentVersions: [{ id: 'version-1', status: 'AVAILABLE' }],
    });
    expect(fixture.db.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          ownerType: 'CASE',
          ownerId: customerId,
          status: 'ACTIVE',
        }),
      }),
    );
    expect(fixture.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
      undefined,
    );
  });
  it('accepts PDF certificate drafts only for the assigned waiting office', async () => {
    const fixture = createFixture();
    const notaryActor = { ...actor, notaryOfficeId: 'office-1' };
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst.mockResolvedValue({
      id: 'matter-1',
      stage: 'WAITING_CERTIFICATE',
    });
    const input = {
      ownerType: 'NOTARY_MATTER' as const,
      ownerId: 'matter-1',
      category: 'NOTARY_CERTIFICATE' as const,
      purpose: 'NOTARY_CERTIFICATE' as const,
      originalFilename: 'certificate.pdf',
      declaredMimeType: 'application/pdf',
    };
    await fixture.service.createUploadDraft(notaryActor, input);
    expect(fixture.db.uploadDraft.create).toHaveBeenCalled();
    expect(fixture.db.notaryMatter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stage: 'WAITING_CERTIFICATE' }),
      }),
    );
    await expect(
      fixture.service.createUploadDraft(notaryActor, {
        ...input,
        declaredMimeType: 'application/msword',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    fixture.db.notaryMatter.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.createUploadDraft(notaryActor, input),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('downloads only an exact frozen certificate version after archive', async () => {
    const fixture = createFixture();
    const notaryActor = { ...actor, notaryOfficeId: 'office-1' };
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst.mockResolvedValue({
      id: 'matter-1',
      stage: 'ARCHIVED',
    });
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'certificate-1',
      departmentId: actor.departmentId,
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_CERTIFICATE',
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'version-1',
          uploadedBy: 'other-notary',
          storageKey: 'private-certificate',
          originalFilename: 'certificate.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100n,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
        },
      ],
    });
    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'ref-1',
      actionEvent: { details: { contentVersionIds: ['another-version'] } },
    });
    await expect(
      fixture.service.openVersion(notaryActor, 'certificate-1', 'version-1'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.storage.open).not.toHaveBeenCalled();
    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'ref-1',
      actionEvent: { details: { contentVersionIds: ['version-1'] } },
    });
    fixture.storage.open.mockResolvedValue(Readable.from(Buffer.from('pdf')));
    await expect(
      fixture.service.openVersion(notaryActor, 'certificate-1', 'version-1'),
    ).resolves.toMatchObject({ originalFilename: 'certificate.pdf' });
    expect(fixture.storage.open).toHaveBeenCalledTimes(1);
  });

  it.each(['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] as const)(
    'does not expose %s draft metadata through internal lead.read material listing',
    async (category) => {
      const fixture = createFixture();
      fixture.access.buildLeadScope.mockResolvedValue({
        departmentId: actor.departmentId,
      });
      fixture.access.buildLeadScope.mockImplementation(async (_actor: unknown, action: string) => {
        if (action === 'notary.certificate.issue.proxy') throw new ForbiddenException();
        return { departmentId: actor.departmentId };
      });
      fixture.db.notaryMatter.findFirst.mockResolvedValue({
        id: 'matter-1',
        departmentId: actor.departmentId,
        stage: 'WAITING_CERTIFICATE',
        sourceLead: { responsibleUserId: actor.userId, teamId: null },
      });
      fixture.db.material.findMany.mockImplementation(
        ({ where }: { where: { category?: { notIn?: string[] } } }) =>
          Promise.resolve(
            where.category?.notIn?.includes(category)
              ? []
              : [
                  {
                    id: 'draft-1',
                    ownerType: 'NOTARY_MATTER',
                    ownerId: 'matter-1',
                    category,
                    purpose: category,
                    currentVersionId: 'version-1',
                    version: 1,
                    deletedAt: null,
                    createdAt: now,
                    updatedAt: now,
                    contentVersions: [
                      {
                        id: 'version-1',
                        materialId: 'draft-1',
                        originalFilename: 'private-draft.pdf',
                        mimeType: 'application/pdf',
                        sizeBytes: 4n,
                        sha256: 'a'.repeat(64),
                        createdAt: now,
                      },
                    ],
                  },
                ],
          ),
      );

      const result = await fixture.service.listOwnerMaterials(
        actor,
        'NOTARY_MATTER',
        'matter-1',
      );
      expect(result).toEqual({ items: [], total: 0 });
      expect(fixture.access.buildLeadScope).toHaveBeenCalledWith(
        actor,
        'lead.read',
        undefined,
      );
    },
  );

  it('requires case.read before internal certificate download', async () => {
    const fixture = createFixture();
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'certificate-1',
      departmentId: actor.departmentId,
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_CERTIFICATE',
      status: 'ACTIVE',
      contentVersions: [{ id: 'version-1', status: 'AVAILABLE' }],
    });
    fixture.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException('case.read revoked'),
    );

    await expect(
      fixture.service.openVersion(actor, 'certificate-1', 'version-1'),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
      undefined,
    );
    expect(fixture.storage.open).not.toHaveBeenCalled();
  });

  it('downloads a frozen certificate for an internal case.read actor', async () => {
    const fixture = createFixture();
    fixture.db.case.findFirst.mockResolvedValue({ id: 'case-1' });
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'certificate-1',
      departmentId: actor.departmentId,
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_CERTIFICATE',
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'version-1',
          status: 'AVAILABLE',
          storageKey: 'private-certificate',
          originalFilename: 'certificate.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4n,
          sha256: 'a'.repeat(64),
        },
      ],
    });
    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'reference-1',
      actionEvent: { details: { contentVersionIds: ['version-1'] } },
    });
    fixture.storage.open.mockResolvedValue(Readable.from(Buffer.from('pdf')));

    await expect(
      fixture.service.openVersion(actor, 'certificate-1', 'version-1'),
    ).resolves.toMatchObject({ originalFilename: 'certificate.pdf' });
    expect(fixture.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
      undefined,
    );
    expect(fixture.db.case.findFirst).toHaveBeenCalledWith({
      where: {
        sourceNotaryMatterId: 'matter-1',
        departmentId: actor.departmentId,
      },
      select: { id: true },
    });
    expect(fixture.storage.open).toHaveBeenCalledWith('private-certificate');
    fixture.db.case.findFirst.mockResolvedValue(null);
    fixture.storage.open.mockClear();
    await expect(
      fixture.service.openVersion(actor, 'certificate-1', 'version-1'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.storage.open).not.toHaveBeenCalled();
  });
  it('allows only live assigned notary accounts to draft opening photos', async () => {
    const fixture = createFixture();
    const notaryActor = { ...actor, notaryOfficeId: 'office-1' };
    fixture.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'NOTARY',
      active: true,
    });
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst.mockResolvedValue({
      id: 'matter-1',
      stage: 'WAITING_UNBOX',
    });
    const input = {
      ownerType: 'NOTARY_MATTER' as const,
      ownerId: 'matter-1',
      category: 'NOTARY_OPENING_PHOTO' as const,
      purpose: 'NOTARY_OPENING_PHOTO' as const,
      originalFilename: 'photo.png',
      declaredMimeType: 'image/png',
    };
    await fixture.service.createUploadDraft(notaryActor, input);
    expect(fixture.db.uploadDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notaryOfficeAccountBindingId: 'binding-1',
      }),
    });
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.createUploadDraft(notaryActor, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });

  it('blocks notary material delete even for an assigned matter', async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.softDelete(
        { ...actor, notaryOfficeId: 'office-1' },
        'photo-1',
        1,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a notary download if assignment disappears between checks', async () => {
    const fixture = createFixture();
    const notaryActor = { ...actor, notaryOfficeId: 'office-1' };
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst
      .mockResolvedValueOnce({ id: 'matter-1' })
      .mockResolvedValueOnce(null);
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'photo-1',
      departmentId: actor.departmentId,
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_OPENING_PHOTO',
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'version-1',
          uploadedBy: actor.userId,
          storageKey: 'private-photo',
          originalFilename: 'opening.png',
          mimeType: 'image/png',
          sizeBytes: 4n,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
        },
      ],
    });
    await expect(
      fixture.service.openVersion(notaryActor, 'photo-1', 'version-1'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.storage.open).not.toHaveBeenCalled();
  });

  it('locks an assigned matter before finalizing a notary photo', async () => {
    const fixture = createFixture();
    const notaryActor = {
      ...actor,
      notaryOfficeId: '33333333-3333-4333-8333-333333333333',
    };
    const matterId = '44444444-4444-4444-8444-444444444444';
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId,
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        notaryOfficeAccountBindingId: 'binding-1',
        originalFilename: 'opening.png',
        declaredMimeType: 'image/png',
      }),
    );
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.transaction.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst.mockResolvedValue({
      id: matterId,
      stage: 'WAITING_UNBOX',
    });
    fixture.transaction.notaryMatter.findFirst.mockResolvedValue({
      id: matterId,
      stage: 'WAITING_UNBOX',
    });
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
      detectedMimeType: 'image/png',
    });
    fixture.transaction.$queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(
      fixture.service.finalizeUpload(
        notaryActor,
        matterId,
        Readable.from(Buffer.from('photo')),
      ),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      matterId,
      actor.departmentId,
      notaryActor.notaryOfficeId,
    );
    expect(fixture.transaction.material.create).not.toHaveBeenCalled();
  });

  it('rejects a notary photo when opening commits before its matter lock', async () => {
    const fixture = createFixture();
    const notaryActor = {
      ...actor,
      notaryOfficeId: '33333333-3333-4333-8333-333333333333',
    };
    const matterId = '44444444-4444-4444-8444-444444444444';
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId,
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        notaryOfficeAccountBindingId: 'binding-1',
        originalFilename: 'opening.png',
        declaredMimeType: 'image/png',
      }),
    );
    fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.transaction.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst
      .mockResolvedValueOnce({ id: matterId, stage: 'WAITING_UNBOX' })
      .mockResolvedValue(null);
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
      detectedMimeType: 'image/png',
    });
    await expect(
      fixture.service.finalizeUpload(
        notaryActor,
        matterId,
        Readable.from(Buffer.from('photo')),
      ),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      matterId,
      actor.departmentId,
      notaryActor.notaryOfficeId,
    );
    expect(
      fixture.transaction.$queryRawUnsafe.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.transaction.notaryMatter.findFirst.mock.invocationCallOrder.at(
        -1,
      )!,
    );
    expect(fixture.transaction.material.create).not.toHaveBeenCalled();
  });
  it('opens only the exact frozen opening photo for a currently bound client', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    fixture.db.customerAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    fixture.db.notaryMatter.findFirst.mockResolvedValue({ id: 'matter-1' });
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'photo-1',
      departmentId: actor.departmentId,
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_OPENING_PHOTO',
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'frozen-1',
          storageKey: 'private-photo',
          originalFilename: 'opening.png',
          mimeType: 'image/png',
          sizeBytes: 4n,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
        },
      ],
    });
    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'frozen-reference',
      actionEvent: { details: { contentVersionIds: ['frozen-1'] } },
    });
    fixture.storage.open.mockResolvedValue(Readable.from(Buffer.from('data')));

    const opened = await fixture.service.openVersion(
      clientActor,
      'photo-1',
      'frozen-1',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('data'));
    expect(fixture.db.materialReference.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        resourceType: 'notary_matter',
        resourceId: 'matter-1',
        purpose: 'NOTARY_OPENING_PHOTO',
        materialId: 'photo-1',
        contentVersionId: 'frozen-1',
        actionEventId: { not: null },
      }),
      select: { id: true, actionEvent: { select: { details: true } } },
    });
    fixture.db.materialReference.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.openVersion(clientActor, 'photo-1', 'frozen-1'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.storage.open).toHaveBeenCalledTimes(1);
    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'forged-same-matter-reference',
      actionEvent: { details: { contentVersionIds: ['another-version'] } },
    });
    await expect(
      fixture.service.openVersion(clientActor, 'photo-1', 'frozen-1'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.storage.open).toHaveBeenCalledTimes(1);
  });
  it('reads current screenshots for this enterprise archived with a no-evidence fact', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    const lead = clientLeadRecord({
      status: 'ARCHIVED',
      activeReviewDecisionId: 'review-1',
      evidenceDecision: { result: 'NO_EVIDENCE' },
    });
    fixture.db.lead.findFirst.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        clientLeadMatchesWhere(lead, where) ? { id: lead.id } : null,
    );
    fixture.db.materialReference.findMany.mockResolvedValue([
      { contentVersionId: 'version-a' },
    ]);
    await expect(
      fixture.service.listCurrentReferenceVersionIds(
        fixture.db as never,
        clientActor,
        {
          resourceType: 'lead',
          resourceId: lead.id,
          purpose: 'LEAD_SCREENSHOT',
        },
      ),
    ).resolves.toEqual(['version-a']);
    expect(fixture.access.buildLeadScope).not.toHaveBeenCalled();
  });

  it('reads reopened lead screenshots only with a null current pointer and exact enterprise scope', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    let lead = clientLeadRecord({
      status: 'WAITING_REVIEW',
      reviewDecision: null,
      activeReviewDecisionId: null,
    });
    fixture.db.lead.findFirst.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        clientLeadMatchesWhere(lead, where) ? { id: lead.id } : null,
    );
    fixture.db.materialReference.findMany.mockResolvedValue([
      { materialId: 'material-a', contentVersionId: 'version-a' },
    ]);
    fixture.db.material.findMany.mockResolvedValue([]);
    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', lead.id),
    ).resolves.toEqual({ items: [], total: 0 });
    lead = clientLeadRecord({
      status: 'WAITING_REVIEW',
      reviewDecision: { result: 'NO_INFRINGEMENT' },
      activeReviewDecisionId: 'old-decision',
    });
    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', lead.id),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    lead = clientLeadRecord({
      status: 'WAITING_REVIEW',
      customerId: 'foreign',
      reviewDecision: null,
      activeReviewDecisionId: null,
    });
    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', lead.id),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });
  it('allows a client to read only its own WAITING_REVIEW lead materials without internal scope derivation', async () => {
    const fixture = createFixture();
    const clientActor = {
      ...actor,
      clientCustomerId: customerId,
    };
    const lead = clientLeadRecord({ status: 'WAITING_REVIEW' });
    fixture.db.lead.findFirst.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        clientLeadMatchesWhere(lead, where) ? { id: lead.id } : null,
    );
    fixture.db.materialReference.findMany.mockResolvedValue([
      { materialId: 'material-a', contentVersionId: 'version-a' },
    ]);
    fixture.db.material.findMany.mockResolvedValue([]);

    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', 'lead-1'),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(fixture.db.lead.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'lead-1',
        departmentId: actor.departmentId,
        customerId,
        pushedAt: { not: null },
        pushedByUserId: { not: null },
        OR: [
          { status: 'WAITING_REVIEW', activeReviewDecisionId: null },
          {
            status: 'WAITING_EVIDENCE_DECISION',
            reviewDecision: { is: { result: 'INFRINGEMENT' } },
          },
          {
            status: 'TRANSFERRED_TO_NOTARY',
            reviewDecision: { is: { result: 'INFRINGEMENT' } },
          },
          {
            status: 'ARCHIVED',
            evidenceDecision: { is: { result: 'NO_EVIDENCE' } },
          },
          {
            status: 'ARCHIVED',
            reviewDecision: {
              is: {
                result: 'NO_INFRINGEMENT',
                archiveType: 'NO_INFRINGEMENT',
                archivedAt: { not: null },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(fixture.access.buildLeadScope).not.toHaveBeenCalled();
    expect(fixture.db.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['material-a'] } }),
        select: expect.objectContaining({
          contentVersions: expect.objectContaining({
            where: {
              id: { in: ['version-a'] },
              status: 'AVAILABLE',
            },
          }),
        }),
      }),
    );

    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', 'foreign'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it.each([
    ['waiting push', { status: 'WAITING_PUSH' }],
    ['other enterprise', { customerId: 'other-customer' }],
    ['other department', { departmentId: 'other-department' }],
    ['missing push time', { pushedAt: null }],
    ['missing pushing user', { pushedByUserId: null }],
    [
      'processed without decision',
      { status: 'WAITING_EVIDENCE_DECISION', reviewDecision: null },
    ],
    ['archived', { status: 'ARCHIVED' }],
  ])('denies client material reads for %s', async (_reason, overrides) => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    const lead = clientLeadRecord({
      status: 'WAITING_REVIEW',
      reviewDecision: null,
      ...overrides,
    });
    fixture.db.lead.findFirst.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        clientLeadMatchesWhere(lead, where) ? { id: lead.id } : null,
    );

    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', lead.id),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.db.material.findMany).not.toHaveBeenCalled();
  });

  it('denies client reads for another owner type and client writes', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      ownerType: 'LEAD',
      ownerId: 'lead-1',
    });

    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'CUSTOMER', customerId),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      fixture.service.softDelete(clientActor, 'material-1', 1),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.db.lead.findFirst).not.toHaveBeenCalled();
  });

  it('permits exact archived screenshots and rejects an unrelated archived decision', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    let lead = clientLeadRecord({
      status: 'ARCHIVED',
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: now,
      },
    });
    fixture.db.lead.findFirst.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        clientLeadMatchesWhere(lead, where) ? { id: lead.id } : null,
    );
    fixture.db.materialReference.findMany.mockResolvedValue([
      { materialId: 'material-a', contentVersionId: 'version-a' },
    ]);
    fixture.db.material.findMany.mockResolvedValue([]);
    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', lead.id),
    ).resolves.toEqual({ items: [], total: 0 });
    lead = clientLeadRecord({
      status: 'ARCHIVED',
      reviewDecision: {
        result: 'OTHER',
        archiveType: 'OTHER',
        archivedAt: now,
      },
    });
    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', lead.id),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('opens an archived screenshot only when its current exact reference exists', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    const lead = clientLeadRecord({
      status: 'ARCHIVED',
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: now,
      },
    });
    fixture.db.lead.findFirst.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        clientLeadMatchesWhere(lead, where) ? { id: lead.id } : null,
    );
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'material-a',
      departmentId: actor.departmentId,
      ownerType: 'LEAD',
      ownerId: lead.id,
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'version-a',
          storageKey: 'key',
          originalFilename: 'capture.png',
          mimeType: 'image/png',
          sizeBytes: 4n,
          sha256: 'd'.repeat(64),
          uploadedBy: actor.userId,
          status: 'AVAILABLE',
        },
      ],
    });
    fixture.storage.open.mockResolvedValue(Readable.from(Buffer.from('data')));
    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'reference-a',
    });
    await expect(
      fixture.service.openVersion(clientActor, 'material-a', 'version-a'),
    ).resolves.toMatchObject({ sha256: 'd'.repeat(64) });
    fixture.db.materialReference.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.openVersion(clientActor, 'material-a', 'version-a'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('opens only an exact current screenshot reference for a client', async () => {
    const fixture = createFixture();
    const clientActor = { ...actor, clientCustomerId: customerId };
    fixture.db.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'material-a',
      departmentId: actor.departmentId,
      ownerType: 'LEAD',
      ownerId: 'lead-1',
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'version-a',
          storageKey: 'key',
          originalFilename: 'capture.png',
          mimeType: 'image/png',
          sizeBytes: 4n,
          sha256: 'd'.repeat(64),
          uploadedBy: actor.userId,
          status: 'AVAILABLE',
        },
      ],
    });
    fixture.storage.open.mockResolvedValue(Readable.from(Buffer.from('data')));

    fixture.db.materialReference.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.openVersion(clientActor, 'material-a', 'version-a'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });

    fixture.db.materialReference.findFirst.mockResolvedValue({
      id: 'reference-a',
    });
    await expect(
      fixture.service.openVersion(clientActor, 'material-a', 'version-a'),
    ).resolves.toMatchObject({ sha256: 'd'.repeat(64) });
    expect(fixture.db.materialReference.findFirst).toHaveBeenLastCalledWith({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'lead',
        resourceId: 'lead-1',
        purpose: 'LEAD_SCREENSHOT',
        materialId: 'material-a',
        contentVersionId: 'version-a',
        actionEventId: null,
      },
      select: { id: true, actionEvent: { select: { details: true } } },
    });
  });
  it.each([
    'success',
    'target',
    'forged',
    'transaction',
    'customer',
    'cas',
    'empty',
  ])('adopts only validated exact draft materials: %s', async (scenario) => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    transaction.uploadDraft.findFirst.mockResolvedValue({ id: 'draft' });
    transaction.customer.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    const isCustomer = scenario === 'customer';
    transaction.material.findMany.mockResolvedValue(
      scenario === 'empty'
        ? []
        : [
            availableMaterial(
              'material-a',
              'version-a',
              isCustomer ? 'IDENTITY_FULL' : 'LEAD_SCREENSHOT',
              isCustomer ? 'CUSTOMER' : 'LEAD_DRAFT',
              customerId,
              isCustomer ? 'CUSTOMER_IDENTITY' : 'LEAD_SCREENSHOT',
            ),
          ],
    );
    const tx = asTransactionClient(transaction);
    const facts = await fixture.service.assertAvailableVersions(tx, actor, {
      ownerType: isCustomer ? 'CUSTOMER' : 'LEAD_DRAFT',
      ownerId: customerId,
      category: isCustomer ? 'CUSTOMER_IDENTITY' : 'LEAD_SCREENSHOT',
      contentVersionIds: scenario === 'empty' ? [] : ['version-a'],
      minCount: 0,
      maxCount: 20,
    });
    if (scenario === 'cas')
      transaction.material.updateMany.mockResolvedValue({ count: 0 });
    const result = fixture.service.adoptLeadDraftVersions(
      scenario === 'transaction'
        ? asTransactionClient(createMaterialTransaction())
        : tx,
      {
        reservedLeadId: customerId,
        targetLeadId: scenario === 'target' ? actor.userId : customerId,
        versions:
          scenario === 'forged'
            ? [{ ...facts[0] } as ValidatedMaterialVersionFact]
            : facts,
      },
    );
    if (scenario === 'success' || scenario === 'empty') {
      await expect(result).resolves.toBeUndefined();
      if (scenario === 'empty')
        expect(transaction.material.updateMany).not.toHaveBeenCalled();
      else
        expect(transaction.material.updateMany).toHaveBeenCalledWith({
          where: {
            id: { in: ['material-a'] },
            departmentId: actor.departmentId,
            ownerType: 'LEAD_DRAFT',
            ownerId: customerId,
            category: 'LEAD_SCREENSHOT',
            status: 'ACTIVE',
          },
          data: { ownerType: 'LEAD', ownerId: customerId },
        });
    } else
      await expect(result).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
  });
  it('lets Nest use default clocks without requiring a Function provider', async () => {
    const module = await Test.createTestingModule({
      providers: [
        MaterialService,
        MaterialCleanupService,
        MaterialStorageKeyCoordinator,
        { provide: DatabaseService, useValue: {} },
        { provide: AccessControlService, useValue: {} },
        {
          provide: PRIVATE_BLOB_STORAGE,
          useValue: {
            put: jest.fn(),
            open: jest.fn(),
            delete: jest.fn(),
            health: jest.fn(),
          },
        },
      ],
    }).compile();

    expect(module.get(MaterialService)).toBeInstanceOf(MaterialService);
    expect(module.get(MaterialCleanupService)).toBeInstanceOf(
      MaterialCleanupService,
    );
    await module.close();
  });

  it('creates a customer draft only for a visible customer with customer.admit', async () => {
    const fixture = createFixture();
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.customer.findFirst.mockResolvedValue({
      id: customerId,
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });

    const result = await fixture.service.createUploadDraft(actor, {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      originalFilename: 'identity.pdf',
      declaredMimeType: 'application/pdf',
    });

    expect(fixture.access.authorizeCustomer).toHaveBeenCalledWith(
      actor,
      'customer.admit',
      expect.objectContaining({ departmentId: actor.departmentId }),
      undefined,
    );
    expect(fixture.transaction.uploadDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        originalFilename: 'identity.pdf',
        declaredMimeType: 'application/pdf',
        expiresAt: new Date('2026-09-22T04:00:00.000Z'),
      }),
    });
    expect(result.ownerId).toBe(customerId);
  });

  it('authorizes customer right evidence drafts with routine edit and readable scope', async () => {
    const fixture = createFixture();
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.customer.findFirst.mockResolvedValue({
      id: customerId,
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });

    await fixture.service.createUploadDraft(actor, {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      originalFilename: 'proof.pdf',
      declaredMimeType: 'application/pdf',
    } as unknown as Parameters<MaterialService['createUploadDraft']>[1]);

    expect(fixture.access.buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.read',
      undefined,
    );
    expect(fixture.access.authorizeCustomer).toHaveBeenCalledWith(
      actor,
      'customer.edit-routine',
      expect.objectContaining({ departmentId: actor.departmentId }),
      undefined,
    );
    expect(fixture.access.authorizeCustomer).not.toHaveBeenCalledWith(
      actor,
      'customer.admit',
      expect.anything(),
    );
    expect(fixture.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      customerId,
      actor.departmentId,
    );
    expect(fixture.transaction.uploadDraft.create).toHaveBeenCalledTimes(1);
    expect(fixture.db.uploadDraft.create).not.toHaveBeenCalled();
  });

  it.each(['clientCustomerId', 'notaryOfficeId', 'lawyerAccountId'] as const)(
    'denies %s accounts the internal customer proof library',
    async (identityField) => {
      const fixture = createFixture();
      await expect(
        fixture.service.createUploadDraft(
          { ...actor, [identityField]: customerId },
          {
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            category: 'CUSTOMER_RIGHT_EVIDENCE',
            purpose: 'CUSTOMER_RIGHT_EVIDENCE',
            originalFilename: 'proof.pdf',
            declaredMimeType: 'application/pdf',
          },
        ),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(fixture.db.uploadDraft.create).not.toHaveBeenCalled();
    },
  );

  it('returns the same not-found error for missing and invisible customers', async () => {
    const fixture = createFixture();
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.customer.findFirst.mockResolvedValue(null);

    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        originalFilename: 'identity.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.access.authorizeCustomer).not.toHaveBeenCalled();
  });

  it('maps underlying customer authorization failures to the material contract code', async () => {
    const fixture = createFixture();
    fixture.access.buildCustomerScope.mockRejectedValue(
      new ForbiddenException({ code: 'CUSTOMER_ACTION_FORBIDDEN' }),
    );

    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        originalFilename: 'identity.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });

  it('generates and restricts a LEAD_DRAFT reserved owner to its actor and department', async () => {
    const fixture = createFixture();
    const first = await fixture.service.createUploadDraft(actor, {
      ownerType: 'LEAD_DRAFT',
      category: 'LEAD_SCREENSHOT',
      purpose: 'LEAD_SCREENSHOT',
      originalFilename: 'capture.webp',
      declaredMimeType: 'image/webp',
    });
    expect(first.reservedOwnerId).toMatch(/^[0-9a-f-]{36}$/);

    fixture.db.uploadDraft.findFirst.mockResolvedValueOnce(null);
    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'LEAD_DRAFT',
        ownerId: first.reservedOwnerId,
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.webp',
        declaredMimeType: 'image/webp',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.db.uploadDraft.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        ownerId: first.reservedOwnerId,
      }),
      select: { id: true, expiresAt: true },
    });
  });

  it('requires lead.create authorization before reserving a LEAD_DRAFT owner', async () => {
    const fixture = createFixture();
    fixture.access.canAuthorizeNewLead.mockResolvedValue(false);

    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'LEAD_DRAFT',
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.png',
        declaredMimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.db.uploadDraft.create).not.toHaveBeenCalled();
  });

  it('keeps one fixed 24-hour deadline for subsequent drafts of a reserved owner', async () => {
    const fixture = createFixture();
    const reservedOwnerId = '66666666-6666-4666-8666-666666666666';
    const firstDeadline = new Date('2026-09-22T03:00:00.000Z');
    fixture.db.uploadDraft.findFirst.mockResolvedValue({
      id: 'first-draft',
      expiresAt: firstDeadline,
    });

    await fixture.service.createUploadDraft(actor, {
      ownerType: 'LEAD_DRAFT',
      ownerId: reservedOwnerId,
      category: 'LEAD_SCREENSHOT',
      purpose: 'LEAD_SCREENSHOT',
      originalFilename: 'second.png',
      declaredMimeType: 'image/png',
    });

    expect(fixture.db.uploadDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: reservedOwnerId,
        expiresAt: firstDeadline,
      }),
    });
  });

  it('rejects owner/category/purpose combinations outside the exact matrix', async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.png',
        declaredMimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });

    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FRONT',
        originalFilename: 'front.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('allows LEAD screenshot drafts only for an editable active lead', async () => {
    const fixture = createFixture();
    const leadId = '55555555-5555-4555-8555-555555555555';
    fixture.access.buildLeadScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      status: 'WAITING_REVIEW',
    });
    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'LEAD',
        ownerId: leadId,
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.png',
        declaredMimeType: 'image/png',
      }),
    ).resolves.toMatchObject({ ownerType: 'LEAD', ownerId: leadId });
    expect(fixture.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.edit',
      expect.objectContaining({ departmentId: actor.departmentId }),
      undefined,
    );

    fixture.db.lead.findFirst.mockResolvedValueOnce({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      status: 'ARCHIVED',
    });
    await expect(
      fixture.service.createUploadDraft(actor, {
        ownerType: 'LEAD',
        ownerId: leadId,
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.png',
        declaredMimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('rechecks archival before finalizing a LEAD screenshot draft', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({ ownerType: 'LEAD' }),
    );
    fixture.access.buildLeadScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      status: 'ARCHIVED',
    });
    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(fixture.storage.put).not.toHaveBeenCalled();
  });

  it.each(['archive', 'revoke', 'disable'] as const)(
    'rejects a LEAD screenshot when %s happens during storage.put',
    async (change) => {
      const fixture = createFixture();
      fixture.db.uploadDraft.findUnique.mockResolvedValue(
        openDraft({ ownerType: 'LEAD' }),
      );
      fixture.db.lead.findFirst
        .mockResolvedValueOnce({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          teamId: null,
          status: 'WAITING_REVIEW',
        })
        .mockResolvedValue({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          teamId: null,
          status: change === 'archive' ? 'ARCHIVED' : 'WAITING_REVIEW',
        });
      fixture.transaction.userAccount.findUnique.mockResolvedValue({
        active: change !== 'disable',
        accountType: 'INTERNAL',
      });
      fixture.access.buildLeadScope.mockImplementation(
        (_actor, _action, reader) =>
          reader === fixture.transaction && change === 'revoke'
            ? Promise.reject(new ForbiddenException())
            : Promise.resolve({ departmentId: actor.departmentId }),
      );
      let releasePut:
        | ((value: {
            sizeBytes: number;
            sha256: string;
            detectedMimeType: string;
          }) => void)
        | undefined;
      let putStarted: (() => void) | undefined;
      const putStartedPromise = new Promise<void>((resolve) => {
        putStarted = resolve;
      });
      fixture.storage.put.mockImplementation(
        () =>
          new Promise((resolve) => {
            releasePut = resolve;
            putStarted?.();
          }),
      );
      const pending = fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      );
      await putStartedPromise;
      releasePut?.({
        sizeBytes: 5,
        sha256: 'a'.repeat(64),
        detectedMimeType: 'image/png',
      });
      await expect(pending).rejects.toMatchObject({
        response: {
          code: change === 'archive' ? 'VERSION_CONFLICT' : 'ACTION_FORBIDDEN',
        },
      });
      expect(fixture.transaction.material.create).not.toHaveBeenCalled();
      expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
      expect(fixture.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('FROM "leads"'),
        '55555555-5555-4555-8555-555555555555',
        actor.departmentId,
      );
    },
  );

  it('rechecks current lead authorization before consuming an upload draft', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    fixture.access.canAuthorizeNewLead.mockResolvedValue(false);

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.storage.put).not.toHaveBeenCalled();
  });

  it('streams a valid upload, verifies declared MIME and creates immutable records', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        purpose: 'IDENTITY_FULL',
        originalFilename: 'identity.pdf',
        declaredMimeType: 'application/pdf',
        category: 'CUSTOMER_IDENTITY',
        ownerType: 'CUSTOMER',
        ownerId: customerId,
      }),
    );
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.customer.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 12,
      sha256: 'a'.repeat(64),
      detectedMimeType: 'application/pdf',
    });
    fixture.db.$transaction.mockImplementation(async (callback) =>
      callback(fixture.transaction),
    );

    const result = await fixture.service.finalizeUpload(
      actor,
      '44444444-4444-4444-8444-444444444444',
      Readable.from(Buffer.from('%PDF-1.7')),
    );

    expect(fixture.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${actor.departmentId}/[0-9a-f-]{36}/[0-9a-f-]{36}$`),
      ),
      expect.any(Readable),
      20 * 1024 * 1024,
    );
    expect(fixture.db.uploadDraft.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: '44444444-4444-4444-8444-444444444444',
        pendingStorageKey: null,
      }),
      data: { pendingStorageKey: expect.any(String) },
    });
    expect(fixture.transaction.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining(
        `${actor.departmentId}:CUSTOMER:${customerId}:CUSTOMER_IDENTITY`,
      ),
    );
    expect(fixture.transaction.material.count).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        status: 'ACTIVE',
      },
    });
    expect(fixture.transaction.contentVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalFilename: 'identity.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12n,
        sha256: 'a'.repeat(64),
        uploadedBy: actor.userId,
      }),
    });
    expect(fixture.transaction.material.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ purpose: 'IDENTITY_FULL' }),
    });
    expect(fixture.transaction.uploadDraft.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'OPEN' }),
      data: { status: 'FINALIZED', pendingStorageKey: null },
    });
    expect(result).toMatchObject({
      mimeType: 'application/pdf',
      sizeBytes: 12,
      sha256: 'a'.repeat(64),
    });
  });

  it('rejects spoofed MIME and compensates the written blob', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        originalFilename: 'capture.pdf',
        declaredMimeType: 'application/pdf',
      }),
    );
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 9,
      sha256: 'b'.repeat(64),
      detectedMimeType: 'image/png',
    });

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
    expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...openDraft(), actorUserId: 'other-user' }, 'ACTION_FORBIDDEN'],
    [{ ...openDraft(), departmentId: 'other-department' }, 'ACTION_FORBIDDEN'],
    [
      { ...openDraft(), expiresAt: new Date(now.getTime() - 1) },
      'VERSION_CONFLICT',
    ],
  ])(
    'rejects an invalid draft before writing bytes %#',
    async (draft, code) => {
      const fixture = createFixture();
      fixture.db.uploadDraft.findUnique.mockResolvedValue(draft);
      await expect(
        fixture.service.finalizeUpload(
          actor,
          '44444444-4444-4444-8444-444444444444',
          Readable.from(Buffer.from('bytes')),
        ),
      ).rejects.toMatchObject({ response: { code } });
      expect(fixture.storage.put).not.toHaveBeenCalled();
    },
  );

  it('deletes the blob when the database transaction fails and returns no version', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      detectedMimeType: 'image/png',
    });
    fixture.db.$transaction.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toThrow('database unavailable');
    expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.db.uploadDraft.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ pendingStorageKey: expect.any(String) }),
      data: { pendingStorageKey: null },
    });
  });

  it('keeps a persistent orphan key when transaction and compensation delete both fail', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      detectedMimeType: 'image/png',
    });
    fixture.db.$transaction.mockRejectedValue(
      new Error('database unavailable'),
    );
    fixture.storage.delete.mockRejectedValue(new Error('storage unavailable'));

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toThrow('database unavailable');

    expect(fixture.db.uploadDraft.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.db.uploadDraft.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ pendingStorageKey: null }),
      data: { pendingStorageKey: expect.any(String) },
    });
  });

  it('maps a filesystem put failure and keeps pending cleanup when delete also fails', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    fixture.storage.put.mockRejectedValue(
      new BlobStorageUnavailableError('Private blob storage is unavailable'),
    );
    fixture.storage.delete.mockRejectedValue(
      new BlobStorageUnavailableError('Private blob storage is unavailable'),
    );

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toMatchObject({ response: { code: 'STORAGE_UNAVAILABLE' } });
    expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.db.uploadDraft.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.db.uploadDraft.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ pendingStorageKey: null }),
      data: { pendingStorageKey: expect.any(String) },
    });
  });

  it('keeps cleanup behind a claimed pending key until put and database finalize finish', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    const putStarted = deferred<void>();
    const releasePut = deferred<void>();
    let storageKey = '';
    let finalized = false;
    fixture.storage.put.mockImplementation(async (key) => {
      storageKey = key;
      putStarted.resolve();
      await releasePut.promise;
      return {
        sizeBytes: 10,
        sha256: 'f'.repeat(64),
        detectedMimeType: 'image/png',
      };
    });
    fixture.transaction.uploadDraft.updateMany.mockImplementation(async () => {
      finalized = true;
      return { count: 1 };
    });
    const finalize = fixture.service.finalizeUpload(
      actor,
      '44444444-4444-4444-8444-444444444444',
      Readable.from('bytes'),
    );
    await putStarted.promise;

    const queryRaw = jest.fn(async (sql: string) => {
      if (sql.includes('ORDER BY d."updated_at"')) {
        return [{ id: openDraft().id, storageKey }];
      }
      if (sql.includes('d."pending_storage_key" = $2')) {
        return finalized ? [] : [{ id: openDraft().id, storageKey }];
      }
      return [];
    });
    const cleanupTransaction = {
      $queryRawUnsafe: queryRaw,
      uploadDraft: { updateMany: jest.fn(async () => ({ count: 1 })) },
      contentVersion: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const cleanupDatabase = {
      $transaction: jest.fn(
        async (
          callback: (value: typeof cleanupTransaction) => Promise<unknown>,
        ) => callback(cleanupTransaction),
      ),
      contentVersion: cleanupTransaction.contentVersion,
    };
    const cleanupService = new MaterialCleanupService(
      cleanupDatabase as unknown as DatabaseService,
      fixture.storage,
      fixture.coordinator,
      () => now,
    );
    const cleanup = cleanupService.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(fixture.storage.delete).not.toHaveBeenCalled();

    releasePut.resolve();
    await finalize;
    await cleanup;

    expect(finalized).toBe(true);
    expect(queryRaw.mock.calls[2]?.[0]).toContain(
      'd."pending_storage_key" = $2',
    );
    expect(fixture.storage.delete).not.toHaveBeenCalled();
  });

  it('enforces the owner/category limit inside the serialized finalize transaction', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'e'.repeat(64),
      detectedMimeType: 'image/png',
    });
    fixture.transaction.material.count.mockResolvedValue(20);
    fixture.db.$transaction.mockImplementation(async (callback) =>
      callback(fixture.transaction),
    );

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(fixture.transaction.material.create).not.toHaveBeenCalled();
    expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
  });

  it('caps CUSTOMER_IDENTITY at ten active materials for one owner', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
      }),
    );
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.customer.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'e'.repeat(64),
      detectedMimeType: 'image/png',
    });
    fixture.transaction.material.count.mockResolvedValue(10);
    fixture.db.$transaction.mockImplementation(async (callback) =>
      callback(fixture.transaction),
    );

    await expect(
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from(Buffer.from('bytes')),
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(fixture.transaction.material.create).not.toHaveBeenCalled();
    expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
  });

  it('lets a judgment upload use a free pending slot after ten prior files were frozen', async () => {
    const fixture = createFixture();
    const caseRecord = {
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    };
    fixture.db.case.findFirst.mockResolvedValue(caseRecord);
    fixture.transaction.case.findFirst.mockResolvedValue(caseRecord);
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        originalFilename: 'replacement.pdf',
        declaredMimeType: 'application/pdf',
      }),
    );
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'e'.repeat(64),
      detectedMimeType: 'application/pdf',
    });
    fixture.transaction.material.count.mockImplementation(async ({ where }) =>
      'contentVersions' in where ? 0 : 10,
    );

    await expect(
      fixture.service.finalizeUpload(
        actor,
        openDraft().id,
        Readable.from(Buffer.from('%PDF-1.7')),
      ),
    ).resolves.toMatchObject({ purpose: 'JUDGMENT' });
    expect(fixture.transaction.material.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        departmentId: actor.departmentId,
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'JUDGMENT',
        status: 'ACTIVE',
        contentVersions: {
          none: {
            OR: [
              { caseJudgmentVersions: { some: {} } },
              { judgmentRecordDocuments: { some: {} } },
            ],
          },
        },
      }),
    });
  });

  it('keeps a customer proof pending when only its old V1 was frozen and current V2 is not', async () => {
    const fixture = createFixture();
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    fixture.db.customer.findFirst.mockResolvedValue({
      id: customerId,
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
        originalFilename: 'new-proof.pdf',
        declaredMimeType: 'application/pdf',
      }),
    );
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'e'.repeat(64),
      detectedMimeType: 'application/pdf',
    });
    fixture.transaction.material.count.mockResolvedValue(10);

    await expect(
      fixture.service.finalizeUpload(
        actor,
        openDraft().id,
        Readable.from(Buffer.from('%PDF-1.7')),
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(fixture.transaction.material.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        currentVersion: {
          is: {
            materialReferences: { none: { assetVersionId: { not: null } } },
          },
        },
      }),
    });
    expect(fixture.transaction.material.create).not.toHaveBeenCalled();
  });

  it('still rejects an eleventh unfrozen judgment upload', async () => {
    const fixture = createFixture();
    const caseRecord = {
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    };
    fixture.db.case.findFirst.mockResolvedValue(caseRecord);
    fixture.transaction.case.findFirst.mockResolvedValue(caseRecord);
    fixture.db.uploadDraft.findUnique.mockResolvedValue(
      openDraft({
        ownerType: 'CASE',
        ownerId: customerId,
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        declaredMimeType: 'application/pdf',
      }),
    );
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'e'.repeat(64),
      detectedMimeType: 'application/pdf',
    });
    fixture.transaction.material.count.mockResolvedValue(10);

    await expect(
      fixture.service.finalizeUpload(
        actor,
        openDraft().id,
        Readable.from(Buffer.from('%PDF-1.7')),
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(fixture.transaction.material.create).not.toHaveBeenCalled();
    expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
  });

  it('counts only unfrozen judgment materials when restoring a deleted pending file', async () => {
    const fixture = createFixture();
    const caseRecord = {
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    };
    fixture.transaction.case.findFirst.mockResolvedValue(caseRecord);
    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      ownerType: 'CASE',
      ownerId: customerId,
      category: 'JUDGMENT',
      status: 'DELETED',
      deletedAt: new Date(now.getTime() - 60_000),
    });
    fixture.transaction.material.count.mockImplementation(async ({ where }) =>
      'contentVersions' in where ? 0 : 10,
    );

    await expect(
      fixture.service.restore(actor, 'material-1', 1),
    ).resolves.toEqual({
      id: 'material-1',
      status: 'ACTIVE',
      version: 2,
    });
    expect(fixture.transaction.material.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        category: 'JUDGMENT',
        status: 'ACTIVE',
        contentVersions: {
          none: {
            OR: [
              { caseJudgmentVersions: { some: {} } },
              { judgmentRecordDocuments: { some: {} } },
            ],
          },
        },
      }),
    });
  });

  it('does not restore a deleted judgment file into a full pending pool', async () => {
    const fixture = createFixture();
    const caseRecord = {
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    };
    fixture.transaction.case.findFirst.mockResolvedValue(caseRecord);
    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      ownerType: 'CASE',
      ownerId: customerId,
      category: 'JUDGMENT',
      status: 'DELETED',
      deletedAt: new Date(now.getTime() - 60_000),
    });
    fixture.transaction.material.count.mockResolvedValue(10);

    await expect(
      fixture.service.restore(actor, 'material-1', 1),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(fixture.transaction.material.updateMany).not.toHaveBeenCalled();
  });

  it.each(['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] as const)(
    'rejects the eleventh active %s material and cleans up its blob',
    async (category) => {
      const fixture = createFixture();
      const notaryActor = { ...actor, notaryOfficeId: 'office-1' };
      fixture.db.uploadDraft.findUnique.mockResolvedValue(
        openDraft({
          ownerType: 'NOTARY_MATTER',
          ownerId: 'matter-1',
          category,
          purpose: category,
          notaryOfficeAccountBindingId: 'binding-1',
        }),
      );
      fixture.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
        id: 'binding-1',
      });
      fixture.transaction.notaryOfficeAccountBinding.findFirst.mockResolvedValue(
        {
          id: 'binding-1',
        },
      );
      fixture.db.notaryMatter.findFirst.mockResolvedValue({
        id: 'matter-1',
        departmentId: actor.departmentId,
        stage: 'WAITING_CERTIFICATE',
        sourceLead: { responsibleUserId: actor.userId, teamId: null },
      });
      fixture.storage.put.mockResolvedValue({
        sizeBytes: 10,
        sha256: 'e'.repeat(64),
        detectedMimeType: 'image/png',
      });
      fixture.transaction.material.count.mockResolvedValue(10);

      await expect(
        fixture.service.finalizeUpload(
          notaryActor,
          openDraft().id,
          Readable.from(Buffer.from('bytes')),
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(fixture.storage.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Readable),
        50 * 1024 * 1024,
      );
      expect(fixture.transaction.material.create).not.toHaveBeenCalled();
      expect(fixture.storage.delete).toHaveBeenCalledTimes(1);
    },
  );

  it('serializes concurrent finalizes so only one crosses the remaining owner quota', async () => {
    const fixture = createFixture();
    const drafts = new Map([
      ['draft-a', openDraft({ id: 'draft-a' })],
      ['draft-b', openDraft({ id: 'draft-b' })],
    ]);
    fixture.db.uploadDraft.findUnique.mockImplementation(async ({ where }) =>
      drafts.get(where.id),
    );
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'f'.repeat(64),
      detectedMimeType: 'image/png',
    });
    let activeCount = 19;
    let queue = Promise.resolve();
    fixture.transaction.material.count.mockImplementation(
      async () => activeCount,
    );
    fixture.transaction.material.create.mockImplementation(async ({ data }) => {
      activeCount += 1;
      return data;
    });
    fixture.db.$transaction.mockImplementation((callback) => {
      const result = queue.then(() => callback(fixture.transaction));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });

    const results = await Promise.allSettled([
      fixture.service.finalizeUpload(actor, 'draft-a', Readable.from('a')),
      fixture.service.finalizeUpload(actor, 'draft-b', Readable.from('b')),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected')[0],
    ).toMatchObject({ reason: { response: { code: 'VALIDATION_ERROR' } } });
    expect(fixture.transaction.material.create).toHaveBeenCalledTimes(1);
  });

  it('rejects restore when a deleted slot has already been refilled', async () => {
    const fixture = createFixture();
    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      status: 'DELETED',
      deletedAt: new Date(now.getTime() - 60_000),
    });
    fixture.transaction.material.count.mockResolvedValue(20);
    fixture.db.$transaction.mockImplementation(async (callback) =>
      callback(fixture.transaction),
    );

    await expect(
      fixture.service.restore(actor, 'material-1', 1),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(fixture.transaction.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining(
        `${actor.departmentId}:LEAD_DRAFT:reserved-owner:LEAD_SCREENSHOT`,
      ),
    );
    expect(fixture.transaction.material.updateMany).not.toHaveBeenCalled();
  });

  it('serializes restore with finalize so only one takes the remaining owner quota', async () => {
    const fixture = createFixture();
    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      status: 'DELETED',
      deletedAt: new Date(now.getTime() - 60_000),
    });
    fixture.db.uploadDraft.findUnique.mockResolvedValue(openDraft());
    fixture.storage.put.mockResolvedValue({
      sizeBytes: 10,
      sha256: 'f'.repeat(64),
      detectedMimeType: 'image/png',
    });
    let activeCount = 19;
    let queue = Promise.resolve();
    fixture.transaction.material.count.mockImplementation(
      async () => activeCount,
    );
    fixture.transaction.material.create.mockImplementation(async ({ data }) => {
      activeCount += 1;
      return data;
    });
    fixture.transaction.material.updateMany.mockImplementation(async () => {
      activeCount += 1;
      return { count: 1 };
    });
    fixture.db.$transaction.mockImplementation((callback) => {
      const result = queue.then(() => callback(fixture.transaction));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });

    const results = await Promise.allSettled([
      fixture.service.restore(actor, 'material-1', 1),
      fixture.service.finalizeUpload(
        actor,
        '44444444-4444-4444-8444-444444444444',
        Readable.from('bytes'),
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected')[0],
    ).toMatchObject({ reason: { response: { code: 'VALIDATION_ERROR' } } });
    expect(activeCount).toBe(20);
  });

  it('opens an authorized exact version and preserves its exact content hash', async () => {
    const fixture = createFixture();
    fixture.db.material.findFirst.mockResolvedValue({
      id: 'material-1',
      departmentId: actor.departmentId,
      ownerType: 'LEAD_DRAFT',
      ownerId: 'reserved-owner',
      status: 'ACTIVE',
      contentVersions: [
        {
          id: 'version-1',
          storageKey: 'key',
          originalFilename: 'capture.png',
          mimeType: 'image/png',
          sizeBytes: 4n,
          sha256: 'd'.repeat(64),
          uploadedBy: actor.userId,
          status: 'AVAILABLE',
        },
      ],
    });
    fixture.storage.open.mockResolvedValue(Readable.from(Buffer.from('data')));
    fixture.db.uploadDraft.findFirst.mockResolvedValue({
      id: 'draft',
      expiresAt: now,
    });

    const opened = await fixture.service.openVersion(
      actor,
      'material-1',
      'version-1',
    );
    expect(opened.sha256).toBe('d'.repeat(64));
    expect(opened.stream).toBeInstanceOf(Readable);
  });

  it.each(['list', 'open', 'delete', 'restore'] as const)(
    'rechecks current lead.create for LEAD_DRAFT %s',
    async (operation) => {
      const fixture = createFixture();
      fixture.access.canAuthorizeNewLead.mockResolvedValue(false);
      fixture.db.material.findFirst.mockResolvedValue(
        operation === 'open'
          ? {
              ...materialRecord(),
              contentVersions: [
                {
                  id: 'version-1',
                  storageKey: 'key',
                  originalFilename: 'capture.png',
                  mimeType: 'image/png',
                  sizeBytes: 4n,
                  sha256: 'd'.repeat(64),
                  uploadedBy: actor.userId,
                  status: 'AVAILABLE',
                },
              ],
            }
          : materialRecord(),
      );

      const request =
        operation === 'list'
          ? fixture.service.listOwnerMaterials(
              actor,
              'LEAD_DRAFT',
              'reserved-owner',
            )
          : operation === 'open'
            ? fixture.service.openVersion(actor, 'material-1', 'version-1')
            : operation === 'delete'
              ? fixture.service.softDelete(actor, 'material-1', 1)
              : fixture.service.restore(actor, 'material-1', 1);

      await expect(request).rejects.toMatchObject({
        response: { code: 'ACTION_FORBIDDEN' },
      });
    },
  );

  it('treats an expired LEAD_DRAFT reserved owner as out of scope', async () => {
    const fixture = createFixture();
    fixture.db.uploadDraft.findFirst.mockResolvedValue(null);

    await expect(
      fixture.service.listOwnerMaterials(actor, 'LEAD_DRAFT', 'reserved-owner'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.db.uploadDraft.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ expiresAt: { gt: now } }),
      select: { id: true },
    });
  });

  it('rejects deleting referenced material, and supports versioned delete/restore for unreferenced material', async () => {
    const fixture = createFixture();
    fixture.db.material.findFirst.mockResolvedValue(materialRecord());
    fixture.db.materialReference.count.mockResolvedValueOnce(1);
    await expect(
      fixture.service.softDelete(actor, 'material-1', 1),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });

    fixture.db.materialReference.count.mockResolvedValueOnce(0);
    fixture.db.material.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      fixture.service.softDelete(actor, 'material-1', 1),
    ).resolves.toMatchObject({ status: 'DELETED', version: 2 });

    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      status: 'DELETED',
      deletedAt: new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000),
      version: 2,
    });
    fixture.db.material.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      fixture.service.restore(actor, 'material-1', 2),
    ).resolves.toMatchObject({ status: 'ACTIVE', version: 3 });
    expect(
      fixture.transaction.auditEvent.create.mock.calls.map(
        ([input]) => input.data.action,
      ),
    ).toEqual(['material.deleted', 'material.restored']);

    fixture.db.material.findFirst.mockResolvedValue({
      ...materialRecord(),
      status: 'DELETED',
      deletedAt: new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000),
      version: 2,
    });
    await expect(
      fixture.service.restore(actor, 'material-1', 2),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('retries the whole serializable delete transaction for adapter 40001', async () => {
    const fixture = createFixture();
    fixture.db.material.findFirst.mockResolvedValue(materialRecord());
    fixture.db.materialReference.count.mockResolvedValue(0);
    fixture.db.$transaction.mockRejectedValueOnce({
      code: 'P2010',
      meta: {
        driverAdapterError: { cause: { originalCode: '40001' } },
      },
    });

    await expect(
      fixture.service.softDelete(actor, 'material-1', 1),
    ).resolves.toEqual({ id: 'material-1', status: 'DELETED', version: 2 });
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.db.$transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('maps exhausted P2034 delete retries to the stable version conflict', async () => {
    const fixture = createFixture();
    fixture.db.$transaction.mockRejectedValue({ code: 'P2034' });

    await expect(
      fixture.service.softDelete(actor, 'material-1', 1),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('returns validated available-version facts in caller order with stable purposes', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    transaction.customer.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    transaction.material.findMany.mockResolvedValue([
      availableMaterial('material-a', 'version-a', 'IDENTITY_FRONT'),
      availableMaterial('material-b', 'version-b', 'IDENTITY_BACK'),
    ]);

    const facts = await fixture.service.assertAvailableVersions(
      asTransactionClient(transaction),
      actor,
      {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        contentVersionIds: ['version-b', 'version-a'],
        minCount: 2,
        maxCount: 2,
      },
    );

    expect(facts).toEqual([
      expect.objectContaining({
        materialId: 'material-b',
        contentVersionId: 'version-b',
        purpose: 'IDENTITY_BACK',
        mimeType: 'image/png',
        ownerType: 'CUSTOMER',
        ownerId: customerId,
      }),
      expect.objectContaining({
        materialId: 'material-a',
        contentVersionId: 'version-a',
        purpose: 'IDENTITY_FRONT',
      }),
    ]);
    expect(Object.isFrozen(facts)).toBe(true);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(fixture.access.buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.read',
      asTransactionClient(transaction),
    );
    expect(transaction.material.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        status: 'ACTIVE',
      },
      select: expect.objectContaining({ contentVersions: expect.any(Object) }),
    });
  });

  it.each([
    ['duplicate ids', ['version-a', 'version-a'], []],
    [
      'missing id',
      ['version-a', 'version-missing'],
      [availableMaterial('material-a', 'version-a', 'IDENTITY_FULL')],
    ],
    [
      'cross owner',
      ['version-a'],
      [
        availableMaterial(
          'material-a',
          'version-a',
          'IDENTITY_FULL',
          'CUSTOMER',
          '44444444-4444-4444-8444-444444444444',
        ),
      ],
    ],
    [
      'cross department',
      ['version-a'],
      [
        availableMaterial(
          'material-a',
          'version-a',
          'IDENTITY_FULL',
          'CUSTOMER',
          customerId,
          'CUSTOMER_IDENTITY',
          { departmentId: '44444444-4444-4444-8444-444444444444' },
        ),
      ],
    ],
    [
      'deleted material',
      ['version-a'],
      [
        availableMaterial(
          'material-a',
          'version-a',
          'IDENTITY_FULL',
          'CUSTOMER',
          customerId,
          'CUSTOMER_IDENTITY',
          { materialStatus: 'DELETED' },
        ),
      ],
    ],
    [
      'purged version',
      ['version-a'],
      [
        availableMaterial(
          'material-a',
          'version-a',
          'IDENTITY_FULL',
          'CUSTOMER',
          customerId,
          'CUSTOMER_IDENTITY',
          { versionStatus: 'PURGED' },
        ),
      ],
    ],
  ])(
    'rejects %s while asserting available versions',
    async (_case, ids, rows) => {
      const fixture = createFixture();
      const transaction = createMaterialTransaction();
      fixture.access.buildCustomerScope.mockResolvedValue({
        departmentId: actor.departmentId,
      });
      transaction.customer.findFirst.mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      });
      transaction.material.findMany.mockResolvedValue(rows);

      await expect(
        fixture.service.assertAvailableVersions(
          asTransactionClient(transaction),
          actor,
          {
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            category: 'CUSTOMER_IDENTITY',
            contentVersionIds: ids,
          },
        ),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
    },
  );

  it('uses the caller transaction and current lead-draft authorization', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    transaction.uploadDraft.findFirst.mockResolvedValue({ id: 'draft-1' });
    transaction.material.findMany.mockResolvedValue([
      availableMaterial(
        'material-lead',
        'version-lead',
        'LEAD_SCREENSHOT',
        'LEAD_DRAFT',
        '55555555-5555-4555-8555-555555555555',
        'LEAD_SCREENSHOT',
      ),
    ]);

    await expect(
      fixture.service.assertAvailableVersions(
        asTransactionClient(transaction),
        actor,
        {
          ownerType: 'LEAD_DRAFT',
          ownerId: '55555555-5555-4555-8555-555555555555',
          category: 'LEAD_SCREENSHOT',
          contentVersionIds: ['version-lead'],
        },
      ),
    ).resolves.toHaveLength(1);

    expect(fixture.access.canAuthorizeNewLead).toHaveBeenCalledWith(
      actor,
      asTransactionClient(transaction),
    );
    expect(transaction.uploadDraft.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        expiresAt: { gt: now },
      }),
      select: { id: true },
    });
    expect(fixture.db.uploadDraft.findFirst).not.toHaveBeenCalled();
  });

  it('freezes exact references on the same transaction without caller-controlled purpose', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    fixture.access.buildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    transaction.customer.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    transaction.material.findMany.mockResolvedValue([
      availableMaterial('material-a', 'version-a', 'IDENTITY_FULL'),
    ]);
    const facts = await fixture.service.assertAvailableVersions(
      asTransactionClient(transaction),
      actor,
      {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        contentVersionIds: ['version-a'],
      },
    );

    await fixture.service.freezeReferences(asTransactionClient(transaction), {
      departmentId: actor.departmentId,
      resourceType: 'CUSTOMER_ADMISSION',
      resourceId: customerId,
      facts,
      actionEventId: '77777777-7777-4777-8777-777777777777',
    });

    expect(transaction.materialReference.createMany).toHaveBeenCalledWith({
      data: [
        {
          departmentId: actor.departmentId,
          resourceType: 'CUSTOMER_ADMISSION',
          resourceId: customerId,
          purpose: 'IDENTITY_FULL',
          materialId: 'material-a',
          contentVersionId: 'version-a',
          actionEventId: '77777777-7777-4777-8777-777777777777',
        },
      ],
      skipDuplicates: true,
    });

    const forged = {
      ...facts[0],
      purpose: 'CALLER_FORGED_PURPOSE',
    };
    await expect(
      fixture.service.freezeReferences(asTransactionClient(transaction), {
        departmentId: actor.departmentId,
        resourceType: 'CUSTOMER_ADMISSION',
        resourceId: customerId,
        facts: [forged],
      }),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });

    const inherited = Object.create(facts[0]) as object;
    Object.defineProperty(inherited, 'purpose', {
      value: 'PROTOTYPE_FORGED_PURPOSE',
    });
    await expect(
      fixture.service.freezeReferences(asTransactionClient(transaction), {
        departmentId: actor.departmentId,
        resourceType: 'CUSTOMER_ADMISSION',
        resourceId: customerId,
        facts: [inherited as ValidatedMaterialVersionFact],
      }),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });

    const roundTripped = JSON.parse(
      JSON.stringify(facts[0]),
    ) as ValidatedMaterialVersionFact;
    await expect(
      fixture.service.freezeReferences(asTransactionClient(transaction), {
        departmentId: actor.departmentId,
        resourceType: 'CUSTOMER_ADMISSION',
        resourceId: customerId,
        facts: [roundTripped],
      }),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });

    await expect(
      fixture.service.freezeReferences(
        asTransactionClient(createMaterialTransaction()),
        {
          departmentId: actor.departmentId,
          resourceType: 'CUSTOMER_ADMISSION',
          resourceId: customerId,
          facts,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
  });

  it('validates Lead-owned versions with lead.edit in the caller transaction', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    const leadId = '55555555-5555-4555-8555-555555555555';
    fixture.access.buildLeadScope.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    });
    transaction.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    transaction.material.findMany.mockResolvedValue([
      availableMaterial(
        'material-a',
        'version-a',
        'LEAD_SCREENSHOT',
        'LEAD',
        leadId,
        'LEAD_SCREENSHOT',
      ),
    ]);

    await expect(
      fixture.service.assertAvailableVersions(
        asTransactionClient(transaction),
        actor,
        {
          ownerType: 'LEAD',
          ownerId: leadId,
          category: 'LEAD_SCREENSHOT',
          contentVersionIds: ['version-a'],
          leadAction: 'lead.edit',
        },
      ),
    ).resolves.toHaveLength(1);
    expect(fixture.access.buildLeadScope).toHaveBeenCalledWith(
      actor,
      'lead.edit',
      asTransactionClient(transaction),
    );
    expect(transaction.lead.findFirst).toHaveBeenCalledWith({
      where: {
        id: leadId,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      },
      select: {
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
        status: true,
      },
    });
    expect(transaction.uploadDraft.findFirst).not.toHaveBeenCalled();
    expect(fixture.access.canAuthorizeNewLead).not.toHaveBeenCalled();
  });

  it('lists only stable current Lead screenshot reference ids with lead.read', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    const leadId = '55555555-5555-4555-8555-555555555555';
    fixture.access.buildLeadScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    transaction.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    transaction.materialReference.findMany.mockResolvedValue([
      { contentVersionId: 'version-b' },
      { contentVersionId: 'version-a' },
      { contentVersionId: 'version-a' },
    ]);

    await expect(
      fixture.service.listCurrentReferenceVersionIds(
        asTransactionClient(transaction),
        actor,
        {
          resourceType: 'lead',
          resourceId: leadId,
          purpose: 'LEAD_SCREENSHOT',
        },
      ),
    ).resolves.toEqual(['version-a', 'version-b']);
    expect(fixture.access.buildLeadScope).toHaveBeenCalledWith(
      actor,
      'lead.read',
      asTransactionClient(transaction),
    );
    expect(transaction.materialReference.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'lead',
        resourceId: leadId,
        purpose: 'LEAD_SCREENSHOT',
        actionEventId: null,
      },
      orderBy: { contentVersionId: 'asc' },
      select: { contentVersionId: true },
    });
  });

  it('uses the already granted evidence decision action for a handoff material selection', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    const leadId = '55555555-5555-4555-8555-555555555555';
    fixture.access.buildLeadScope.mockImplementation((_actor, action) => {
      if (action !== 'lead.evidence.decide')
        throw new Error('unexpected read grant');
      return Promise.resolve({ departmentId: actor.departmentId });
    });
    transaction.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    transaction.materialReference.findMany.mockResolvedValue([
      { contentVersionId: 'version-a' },
    ]);
    transaction.material.findMany.mockResolvedValue([
      availableMaterial(
        'material-a',
        'version-a',
        'LEAD_SCREENSHOT',
        'LEAD',
        leadId,
        'LEAD_SCREENSHOT',
      ),
    ]);
    const reader = asTransactionClient(transaction);
    await expect(
      fixture.service.listCurrentReferenceVersionIds(
        reader,
        actor,
        {
          resourceType: 'lead',
          resourceId: leadId,
          purpose: 'LEAD_SCREENSHOT',
        },
        'lead.evidence.decide',
      ),
    ).resolves.toEqual(['version-a']);
    await expect(
      fixture.service.assertAvailableVersions(reader, actor, {
        ownerType: 'LEAD',
        ownerId: leadId,
        category: 'LEAD_SCREENSHOT',
        contentVersionIds: ['version-a'],
        leadAction: 'lead.evidence.decide',
      }),
    ).resolves.toHaveLength(1);
    expect(fixture.access.buildLeadScope).toHaveBeenCalledTimes(2);
    expect(fixture.access.buildLeadScope).toHaveBeenCalledWith(
      actor,
      'lead.evidence.decide',
      reader,
    );
  });

  it.each([
    [['version-a'], [], true],
    [['version-a'], ['version-a'], false],
    [['version-a'], ['version-b'], true],
  ] as const)(
    'replaces current Lead refs %j -> %j with changed=%s',
    async (before, after, changed) => {
      const fixture = createFixture();
      const transaction = createMaterialTransaction();
      const leadId = '55555555-5555-4555-8555-555555555555';
      fixture.access.canAuthorizeNewLead.mockResolvedValue(false);
      fixture.access.buildLeadScope.mockResolvedValue({
        departmentId: actor.departmentId,
      });
      transaction.lead.findFirst.mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      });
      transaction.materialReference.findMany.mockResolvedValue(
        before.map((contentVersionId) => ({ contentVersionId })),
      );
      transaction.material.findMany.mockResolvedValue(
        after.map((contentVersionId, index) =>
          availableMaterial(
            `material-${index}`,
            contentVersionId,
            'LEAD_SCREENSHOT',
            'LEAD',
            leadId,
            'LEAD_SCREENSHOT',
          ),
        ),
      );
      const facts =
        after.length === 0
          ? []
          : await fixture.service.assertAvailableVersions(
              asTransactionClient(transaction),
              actor,
              {
                ownerType: 'LEAD',
                ownerId: leadId,
                category: 'LEAD_SCREENSHOT',
                contentVersionIds: [...after],
                leadAction: 'lead.edit',
              },
            );

      await expect(
        fixture.service.replaceCurrentReferences(
          asTransactionClient(transaction),
          actor,
          {
            resourceType: 'lead',
            resourceId: leadId,
            purpose: 'LEAD_SCREENSHOT',
            versions: facts,
          },
        ),
      ).resolves.toEqual({
        beforeVersionIds: [...before],
        afterVersionIds: [...after],
        changed,
      });
      expect(transaction.materialReference.deleteMany).toHaveBeenCalledWith({
        where: {
          departmentId: actor.departmentId,
          resourceType: 'lead',
          resourceId: leadId,
          purpose: 'LEAD_SCREENSHOT',
          actionEventId: null,
        },
      });
      expect(fixture.access.buildLeadScope).toHaveBeenLastCalledWith(
        actor,
        'lead.edit',
        asTransactionClient(transaction),
      );
      expect(fixture.access.canAuthorizeNewLead).not.toHaveBeenCalled();
      if (after.length === 0) {
        expect(transaction.materialReference.createMany).not.toHaveBeenCalled();
      } else {
        expect(transaction.materialReference.createMany).toHaveBeenCalledWith({
          data: after.map((contentVersionId, index) => ({
            departmentId: actor.departmentId,
            resourceType: 'lead',
            resourceId: leadId,
            purpose: 'LEAD_SCREENSHOT',
            materialId: `material-${index}`,
            contentVersionId,
          })),
          skipDuplicates: true,
        });
      }
    },
  );

  it('rejects forged and cross-transaction facts when replacing current refs', async () => {
    const fixture = createFixture();
    const transaction = createMaterialTransaction();
    const leadId = '55555555-5555-4555-8555-555555555555';
    fixture.access.buildLeadScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
    transaction.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    transaction.material.findMany.mockResolvedValue([
      availableMaterial(
        'material-a',
        'version-a',
        'LEAD_SCREENSHOT',
        'LEAD',
        leadId,
        'LEAD_SCREENSHOT',
      ),
    ]);
    const facts = await fixture.service.assertAvailableVersions(
      asTransactionClient(transaction),
      actor,
      {
        ownerType: 'LEAD',
        ownerId: leadId,
        category: 'LEAD_SCREENSHOT',
        contentVersionIds: ['version-a'],
        leadAction: 'lead.edit',
      },
    );
    const input = {
      resourceType: 'lead' as const,
      resourceId: leadId,
      purpose: 'LEAD_SCREENSHOT' as const,
    };
    await expect(
      fixture.service.replaceCurrentReferences(
        asTransactionClient(transaction),
        actor,
        {
          ...input,
          versions: [{ ...facts[0] } as ValidatedMaterialVersionFact],
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
    const otherTransaction = createMaterialTransaction();
    otherTransaction.lead.findFirst.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
    });
    await expect(
      fixture.service.replaceCurrentReferences(
        asTransactionClient(otherTransaction),
        actor,
        { ...input, versions: facts },
      ),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
  });
});

type ClientLeadWhere = {
  id?: string;
  departmentId?: string;
  customerId?: string;
  status?: string;
  activeReviewDecisionId?: null;
  pushedAt?: { not: null };
  pushedByUserId?: { not: null };
  reviewDecision?: {
    isNot?: null;
    is?: { result?: string; archiveType?: string; archivedAt?: { not: null } };
  };
  evidenceDecision?: { is?: { result?: string } };
  OR?: ClientLeadWhere[];
};

function clientLeadRecord(
  overrides: {
    status?: string;
    departmentId?: string;
    customerId?: string;
    pushedAt?: Date | null;
    pushedByUserId?: string | null;
    reviewDecision?: object | null;
    evidenceDecision?: object | null;
    activeReviewDecisionId?: string | null;
  } = {},
) {
  return {
    id: 'lead-1',
    departmentId: actor.departmentId,
    customerId,
    status: 'WAITING_EVIDENCE_DECISION',
    pushedAt: now,
    pushedByUserId: actor.userId,
    reviewDecision: { result: 'INFRINGEMENT' },
    evidenceDecision: null,
    activeReviewDecisionId: null,
    ...overrides,
  };
}

function clientLeadMatchesWhere(
  lead: ReturnType<typeof clientLeadRecord>,
  where: ClientLeadWhere,
): boolean {
  return (
    (where.id === undefined || where.id === lead.id) &&
    (where.departmentId === undefined ||
      where.departmentId === lead.departmentId) &&
    (where.customerId === undefined || where.customerId === lead.customerId) &&
    (where.status === undefined || where.status === lead.status) &&
    (where.activeReviewDecisionId === undefined ||
      lead.activeReviewDecisionId === null) &&
    (where.pushedAt === undefined || lead.pushedAt !== null) &&
    (where.pushedByUserId === undefined || lead.pushedByUserId !== null) &&
    (where.reviewDecision === undefined ||
      (lead.reviewDecision !== null &&
        (where.reviewDecision.is === undefined ||
          Object.entries(where.reviewDecision.is).every(([key, value]) =>
            key === 'archivedAt'
              ? (lead.reviewDecision as { archivedAt?: Date }).archivedAt !=
                null
              : (lead.reviewDecision as Record<string, unknown>)[key] === value,
          )))) &&
    (where.evidenceDecision === undefined ||
      (lead.evidenceDecision !== null &&
        where.evidenceDecision.is?.result ===
          (lead.evidenceDecision as { result?: string }).result)) &&
    (where.OR === undefined ||
      where.OR.some((branch) => clientLeadMatchesWhere(lead, branch)))
  );
}

describe('notary opening material authorization', () => {
  const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const input = {
    ownerType: 'NOTARY_MATTER' as const,
    ownerId: matterId,
    category: 'NOTARY_OPENING_PHOTO' as const,
    purpose: 'NOTARY_OPENING_PHOTO' as const,
    originalFilename: 'opening.png',
    declaredMimeType: 'image/png',
  };

  it('allows only an authorized internal actor to upload to a waiting matter', async () => {
    const f = createFixture();
    f.db.notaryMatter.findFirst.mockResolvedValue({
      id: matterId,
      departmentId: actor.departmentId,
      stage: 'WAITING_UNBOX',
      sourceLead: { responsibleUserId: actor.userId, teamId: null },
    });
    await expect(
      f.service.createUploadDraft(actor, input),
    ).resolves.toMatchObject({
      ownerType: 'NOTARY_MATTER',
      ownerId: matterId,
      category: 'NOTARY_OPENING_PHOTO',
    });
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'notary.unbox.record',
      expect.objectContaining({ departmentId: actor.departmentId }),
      undefined,
    );
    await expect(
      f.service.createUploadDraft(
        { ...actor, clientCustomerId: customerId },
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    f.db.notaryMatter.findFirst.mockResolvedValue({
      id: matterId,
      departmentId: actor.departmentId,
      stage: 'UNBOX_REVIEW',
      sourceLead: { responsibleUserId: actor.userId, teamId: null },
    });
    await expect(
      f.service.createUploadDraft(actor, input),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
  });

  it('rejects cross-matter and disallowed file combinations', async () => {
    const f = createFixture();
    f.db.notaryMatter.findFirst.mockResolvedValue(null);
    await expect(
      f.service.createUploadDraft(actor, input),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    await expect(
      f.service.createUploadDraft(actor, {
        ...input,
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
});

function openDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    lawyerAccountBindingId: null,
    departmentId: actor.departmentId,
    actorUserId: actor.userId,
    ownerType: 'LEAD_DRAFT',
    ownerId: '55555555-5555-4555-8555-555555555555',
    category: 'LEAD_SCREENSHOT',
    pendingStorageKey: null,
    purpose: 'LEAD_SCREENSHOT',
    originalFilename: 'capture.png',
    declaredMimeType: 'image/png',
    status: 'OPEN',
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

function materialRecord() {
  return {
    id: 'material-1',
    departmentId: actor.departmentId,
    ownerType: 'LEAD_DRAFT',
    ownerId: 'reserved-owner',
    category: 'LEAD_SCREENSHOT',
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    currentVersionId: 'version-1',
    contentVersions: [
      { id: 'version-1', uploadedBy: actor.userId, status: 'AVAILABLE' },
    ],
  };
}

function availableMaterial(
  materialId: string,
  contentVersionId: string,
  purpose: string,
  ownerType = 'CUSTOMER',
  ownerId = customerId,
  category = 'CUSTOMER_IDENTITY',
  overrides: {
    departmentId?: string;
    materialStatus?: 'ACTIVE' | 'DELETED';
    versionStatus?: 'AVAILABLE' | 'DELETED' | 'PURGED';
  } = {},
) {
  return {
    id: materialId,
    departmentId: overrides.departmentId ?? actor.departmentId,
    ownerType,
    ownerId,
    category,
    purpose,
    status: overrides.materialStatus ?? 'ACTIVE',
    contentVersions: [
      {
        id: contentVersionId,
        mimeType: 'image/png',
        status: overrides.versionStatus ?? 'AVAILABLE',
      },
    ],
  };
}

function createMaterialTransaction() {
  return {
    customer: { findFirst: jest.fn() },
    uploadDraft: { findFirst: jest.fn() },
    lead: { findFirst: jest.fn() },
    notaryMatter: { findFirst: jest.fn() },
    material: {
      findMany: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    materialReference: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

function asTransactionClient(
  transaction: ReturnType<typeof createMaterialTransaction>,
): MaterialTransactionClient {
  return transaction as unknown as MaterialTransactionClient;
}

function createFixture() {
  const coordinator = new MaterialStorageKeyCoordinator();
  const materialFindFirst = jest.fn();
  const materialReferenceCount = jest.fn();
  const customerFindFirst = jest.fn();
  const uploadDraftFindFirst = jest.fn<
    Promise<{ id: string; expiresAt: Date } | null>,
    []
  >(async () => ({
    id: 'draft-1',
    expiresAt: new Date(now.getTime() + 60_000),
  }));
  const leadFindFirst = jest.fn();
  const notaryMatterFindFirst = jest.fn();
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    feeRecord: { findFirst: jest.fn() },
    feeCancellationPayment: { findFirst: jest.fn().mockResolvedValue(null) },
    feeRefundReconciliation: { findFirst: jest.fn().mockResolvedValue(null) },
    notaryCertificate: { findFirst: jest.fn() },
    evidencePaperCertificate: { findFirst: jest.fn() },
    caseExecutionFilingSupplement: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    caseExecutionFilingFeedback: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseExecutionFilingSupplementDocument: {
      create: jest.fn().mockResolvedValue({}),
    },
    caseExecutionMailing: {
      findFirst: jest.fn().mockResolvedValue({ id: customerId }),
    },
    caseExecutionFiling: {
      findFirst: jest.fn().mockResolvedValue({ id: customerId }),
    },
    caseExecutionFinish: {
      findFirst: jest.fn().mockResolvedValue({ id: customerId }),
    },
    caseJudgmentFact: {
      findFirst: jest.fn().mockResolvedValue({ id: customerId }),
    },
    caseClosure: { findFirst: jest.fn() },
    caseClosureVersion: { findFirst: jest.fn() },
    caseExecutionMailingRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseExecutionFilingRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseExecutionFinishRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseJudgmentRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseClosureRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseExecutionMailingRecordCorrectionDocument: {
      create: jest.fn().mockResolvedValue({}),
    },
    caseExecutionFilingRecordCorrectionDocument: {
      create: jest.fn().mockResolvedValue({}),
    },
    caseExecutionFinishRecordCorrectionDocument: {
      create: jest.fn().mockResolvedValue({}),
    },
    caseJudgmentRecordCorrectionDocument: {
      create: jest.fn().mockResolvedValue({}),
    },
    caseClosureRecordCorrectionDocument: {
      create: jest.fn().mockResolvedValue({}),
    },
    caseClosureDocument: { create: jest.fn().mockResolvedValue({}) },
    caseExecutionFinishVersion: { create: jest.fn().mockResolvedValue({}) },
    $executeRawUnsafe: jest.fn(async () => 1),
    $queryRawUnsafe: jest
      .fn<
        Promise<
          Array<{
            id?: string;
            content_version_id?: string;
            count?: number;
            consumed?: boolean;
          }>
        >,
        unknown[]
      >()
      .mockResolvedValue([{ id: 'material-1' }]),
    customer: { findFirst: customerFindFirst },
    lead: { findFirst: leadFindFirst },
    case: { findFirst: jest.fn() },
    customerAccountBinding: { findFirst: jest.fn() },
    notaryMatter: { findFirst: notaryMatterFindFirst },
    userAccount: { findUnique: jest.fn() },
    notaryOfficeAccountBinding: { findFirst: jest.fn() },
    material: {
      findFirst: materialFindFirst,
      findMany: jest.fn(),
      create: jest.fn(async ({ data }) => data),
      update: jest.fn(async ({ data }) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn<Promise<number>, [{ where: Record<string, unknown> }]>(
        async () => 0,
      ),
    },
    contentVersion: { create: jest.fn(async ({ data }) => data) },
    uploadDraft: {
      findUnique: jest.fn(),
      findFirst: uploadDraftFindFirst,
      create: jest.fn(async ({ data }) => ({ id: 'draft-1', ...data })),
      updateMany: jest.fn<
        Promise<{ count: number }>,
        [{ data: { pendingStorageKey?: string | null; status?: string } }]
      >(async () => ({ count: 1 })),
    },
    materialReference: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      count: materialReferenceCount,
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    auditEvent: {
      create: jest.fn(async ({ data }) => data),
      findMany: jest.fn(),
    },
  };
  const db = {
    caseClosureDocument: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRawUnsafe: jest
      .fn<Promise<Array<{ id: string }>>, unknown[]>()
      .mockResolvedValue([{ id: customerId }]),
    userAccount: { findUnique: jest.fn() },
    notaryOfficeAccountBinding: { findFirst: jest.fn() },
    customerAccountBinding: { findFirst: jest.fn() },
    customer: { findFirst: customerFindFirst },
    uploadDraft: {
      create: jest.fn(async ({ data }) => ({ id: 'draft-1', ...data })),
      findFirst: uploadDraftFindFirst,
      findUnique: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    material: {
      findFirst: materialFindFirst,
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    materialReference: {
      count: materialReferenceCount,
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    caseLawyerAssignment: { findFirst: jest.fn() },
    caseSecondInstanceProgressVersion: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    caseSecondInstanceResultVersion: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    lead: { findFirst: leadFindFirst },
    case: { findFirst: jest.fn() },
    notaryMatter: { findFirst: notaryMatterFindFirst },
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const access = {
    buildCustomerScope: jest.fn(),
    authorizeCustomer: jest.fn(),
    buildLeadScope: jest.fn(),
    authorizeDepartmentAction: jest.fn(),
    authorizeLead: jest.fn(),
    authorizeCase: jest.fn(),
    canAuthorizeCase: jest.fn(async () => true),
    canAuthorizeNewLead: jest.fn(async () => true),
  };
  const storage: jest.Mocked<PrivateBlobStorage> = {
    put: jest.fn(),
    open: jest.fn(),
    delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    health: jest.fn(async () => 'ready'),
  };
  return {
    db,
    access,
    storage,
    transaction,
    coordinator,
    service: new MaterialService(
      db as unknown as DatabaseService,
      access as unknown as AccessControlService,
      storage,
      coordinator,
      () => now,
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
