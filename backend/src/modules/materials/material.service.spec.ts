import { Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { PrivateBlobStorage } from './private-blob-storage';
import { PRIVATE_BLOB_STORAGE } from './private-blob-storage';
import { MaterialCleanupService } from './material-cleanup.service';
import { MaterialService } from './material.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-21T04:00:00.000Z');

describe('MaterialService', () => {
  it('lets Nest use default clocks without requiring a Function provider', async () => {
    const module = await Test.createTestingModule({
      providers: [
        MaterialService,
        MaterialCleanupService,
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
      data: { status: 'FINALIZED' },
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

    const opened = await fixture.service.openVersion(
      actor,
      'material-1',
      'version-1',
    );
    expect(opened.sha256).toBe('d'.repeat(64));
    expect(opened.stream).toBeInstanceOf(Readable);
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
});

function openDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    departmentId: actor.departmentId,
    actorUserId: actor.userId,
    ownerType: 'LEAD_DRAFT',
    ownerId: '55555555-5555-4555-8555-555555555555',
    category: 'LEAD_SCREENSHOT',
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
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    contentVersions: [{ uploadedBy: actor.userId }],
  };
}

function createFixture() {
  const transaction = {
    material: {
      create: jest.fn(async ({ data }) => data),
      update: jest.fn(async ({ data }) => data),
    },
    contentVersion: { create: jest.fn(async ({ data }) => data) },
    uploadDraft: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const db = {
    customer: { findFirst: jest.fn() },
    uploadDraft: {
      create: jest.fn(async ({ data }) => ({ id: 'draft-1', ...data })),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    material: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    materialReference: { count: jest.fn() },
    $transaction: jest.fn(),
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
    service: new MaterialService(
      db as unknown as DatabaseService,
      access as unknown as AccessControlService,
      storage,
      () => now,
    ),
  };
}
