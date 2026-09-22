import { Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import {
  BlobStorageUnavailableError,
  PRIVATE_BLOB_STORAGE,
  PrivateBlobStorage,
} from './private-blob-storage';
import { MaterialCleanupService } from './material-cleanup.service';
import {
  MaterialService,
  MaterialTransactionClient,
  ValidatedMaterialVersionFact,
} from './material.service';
import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-21T04:00:00.000Z');

describe('MaterialService', () => {
  it('allows a client to read only its own WAITING_REVIEW lead materials without internal scope derivation', async () => {
    const fixture = createFixture();
    const clientActor = {
      ...actor,
      clientCustomerId: customerId,
    };
    fixture.db.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
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
        status: 'WAITING_REVIEW',
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

    fixture.db.lead.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.listOwnerMaterials(clientActor, 'LEAD', 'foreign'),
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
      select: { id: true },
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
    );
    expect(fixture.db.uploadDraft.create).toHaveBeenCalledWith({
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

function openDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
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
  const transaction = {
    $executeRawUnsafe: jest.fn(async () => 1),
    $queryRawUnsafe: jest.fn(async () => [{ id: 'material-1' }]),
    customer: { findFirst: customerFindFirst },
    lead: { findFirst: leadFindFirst },
    material: {
      findFirst: materialFindFirst,
      create: jest.fn(async ({ data }) => data),
      update: jest.fn(async ({ data }) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 0),
    },
    contentVersion: { create: jest.fn(async ({ data }) => data) },
    uploadDraft: {
      findFirst: uploadDraftFindFirst,
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    materialReference: {
      count: materialReferenceCount,
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    auditEvent: { create: jest.fn(async ({ data }) => data) },
  };
  const db = {
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
    lead: { findFirst: leadFindFirst },
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const access = {
    buildCustomerScope: jest.fn(),
    authorizeCustomer: jest.fn(),
    buildLeadScope: jest.fn(),
    authorizeLead: jest.fn(),
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
