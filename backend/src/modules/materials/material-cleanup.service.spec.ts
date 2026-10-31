import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { MaterialCleanupService } from './material-cleanup.service';
import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';
import { PrivateBlobStorage } from './private-blob-storage';

const now = new Date('2026-09-21T04:00:00.000Z');

describe('MaterialCleanupService', () => {
  it.each([false, true])(
    'retains expired proof keys and rotates even when deletion fails=%s',
    async (fails) => {
      const f = createFixture();
      const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      f.queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'expired-proof',
            storageKey: 'proof/key',
            retainPendingKey: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'expired-proof',
            storageKey: 'proof/key',
            retainPendingKey: true,
          },
        ]);
      if (fails)
        f.storage.delete.mockRejectedValueOnce(new Error('disk offline'));
      await f.service.runOnce();
      for (const call of [f.queryRaw.mock.calls[1], f.queryRaw.mock.calls[2]]) {
        expect(call?.[0]).toContain('d."status" = \'EXPIRED\'');
        expect(call?.[0]).toContain('d."expires_at" <=');
        expect(call?.[0]).toContain('NOT EXISTS');
        expect(call?.[0]).toContain('FROM "content_versions"');
        expect(call?.[0]).toContain('FOR UPDATE OF d');
      }
      expect(f.uploadDraft.updateMany).toHaveBeenCalledTimes(1);
      expect(f.uploadDraft.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'expired-proof',
          pendingStorageKey: 'proof/key',
          status: 'EXPIRED',
        },
        data: { updatedAt: now },
      });
      expect(warning).toHaveBeenCalledTimes(fails ? 1 : 0);
      warning.mockRestore();
    },
  );

  it('rechecks candidates and leaves open or newly committed proof keys untouched', async () => {
    const f = createFixture();
    f.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'stale-candidate',
          storageKey: 'proof/key',
          retainPendingKey: true,
        },
      ])
      .mockResolvedValueOnce([]);
    await f.service.runOnce();
    expect(f.storage.delete).not.toHaveBeenCalled();
    expect(f.uploadDraft.updateMany).not.toHaveBeenCalled();
    expect(f.queryRaw.mock.calls[2]?.[0]).toContain(
      'd."pending_storage_key" = $2',
    );
    expect(f.queryRaw.mock.calls[2]?.[0]).toContain('d."status" = \'EXPIRED\'');
    expect(f.queryRaw.mock.calls[2]?.[0]).toContain(
      'WHERE cv."storage_key" = d."pending_storage_key"',
    );
  });

  it('rotates persistent proof records beyond one batch and removes a late publication on a later pass', async () => {
    const f = createFixture();
    let clock = now;
    const records = Array.from({ length: 205 }, (_, i) => ({
      id: String(i).padStart(3, '0'),
      storageKey: `proof/${i}`,
      retainPendingKey: true,
      updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
    }));
    const blobs = new Set<string>();
    f.queryRaw.mockImplementation(async (sql, ...args) => {
      if (sql.includes('ORDER BY d."updated_at"')) {
        return records
          .filter(
            (r) => r.updatedAt.getTime() <= clock.getTime() - 15 * 60 * 1000,
          )
          .sort(
            (a, b) =>
              a.updatedAt.getTime() - b.updatedAt.getTime() ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 100);
      }
      if (sql.includes('d."pending_storage_key" = $2'))
        return records.filter((r) => r.id === args[0]);
      return [];
    });
    f.uploadDraft.updateMany.mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as {
        where: { id: string };
        data: { updatedAt: Date };
      };
      records.find((r) => r.id === input.where.id)!.updatedAt =
        input.data.updatedAt;
      return { count: 1 };
    });
    f.storage.delete.mockImplementation(async (key) => {
      blobs.delete(key);
    });
    const service = new MaterialCleanupService(
      f.db as unknown as DatabaseService,
      f.storage,
      f.coordinator,
      () => clock,
    );
    await service.runOnce();
    // A remote uploader publishes after its first cleanup has finished.
    blobs.add('proof/0');
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    await service.runOnce();
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    await service.runOnce();
    expect(new Set(f.storage.delete.mock.calls.map(([key]) => key)).size).toBe(
      205,
    );
    expect(blobs.has('proof/0')).toBe(false);
    expect(f.uploadDraft.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { pendingStorageKey: null } }),
    );
  });
  it('expires only OPEN drafts older than 24 hours in batches of at most 100', async () => {
    const fixture = createFixture();
    fixture.queryRaw.mockResolvedValueOnce([{ id: 'draft-old' }]);

    await fixture.service.runOnce();

    expect(fixture.queryRaw).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      now,
      100,
    );
    expect(fixture.uploadDraft.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['draft-old'] }, status: 'OPEN' },
      data: { status: 'EXPIRED' },
    });
  });

  it('purges expired unconsumed LEAD_DRAFT bytes but keeps referenced versions', async () => {
    const fixture = createFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'version-unreferenced', storageKey: 'unreferenced/key' },
      ])
      .mockResolvedValueOnce([]);

    await fixture.service.runOnce();

    expect(fixture.queryRaw.mock.calls[2]?.[0]).toContain('NOT EXISTS');
    expect(fixture.contentVersion.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'version-unreferenced',
        status: { in: ['AVAILABLE', 'DELETED'] },
      },
      data: { status: 'DELETED' },
    });
    expect(fixture.storage.delete).toHaveBeenCalledWith('unreferenced/key');
    expect(fixture.contentVersion.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'version-unreferenced', status: 'DELETED' },
      data: { status: 'PURGED' },
    });
  });

  it('purges unreferenced soft-deleted material only after 90 days', async () => {
    const fixture = createFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'version-90d', storageKey: 'old/key' }]);

    await fixture.service.runOnce();

    const purgeSql = fixture.queryRaw.mock.calls[3]?.[0] ?? '';
    expect(purgeSql).toContain("INTERVAL '90 days'");
    expect(purgeSql).toContain(
      `m."category"::text <> 'CASE_CLOSURE_PAYMENT_PROOF'`,
    );
    expect(purgeSql).toContain(`m."purpose" <> 'CASE_CLOSURE_PAYMENT_PROOF'`);
    expect(purgeSql).toContain('NOT EXISTS');
    expect(purgeSql).toContain('FOR NO KEY UPDATE OF m, cv SKIP LOCKED');
    expect(fixture.storage.delete).toHaveBeenCalledWith('old/key');
  });

  it('leaves DELETED state retryable when blob deletion fails', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fixture = createFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'version-retry', storageKey: 'retry/key' }])
      .mockResolvedValueOnce([]);
    fixture.storage.delete.mockRejectedValueOnce(
      new Error('temporary failure'),
    );

    await fixture.service.runOnce();

    expect(fixture.contentVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.contentVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'DELETED' } }),
    );
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  it('retains and retries a pending orphan key when blob deletion fails', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fixture = createFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'draft-orphan', storageKey: 'orphan/key' }])
      .mockResolvedValueOnce([{ id: 'draft-orphan', storageKey: 'orphan/key' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'draft-orphan', storageKey: 'orphan/key' }])
      .mockResolvedValueOnce([{ id: 'draft-orphan', storageKey: 'orphan/key' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    fixture.storage.delete
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);

    await fixture.service.runOnce();
    expect(fixture.uploadDraft.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { pendingStorageKey: null } }),
    );
    await fixture.service.runOnce();
    expect(fixture.storage.delete).toHaveBeenCalledTimes(2);
    expect(fixture.uploadDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft-orphan', pendingStorageKey: 'orphan/key' },
      data: { pendingStorageKey: null },
    });
    warning.mockRestore();
  });

  it('waits for the key lock and rechecks pending ownership before deleting', async () => {
    const fixture = createFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'draft-pending', storageKey: 'pending/key' },
      ])
      .mockResolvedValueOnce([
        { id: 'draft-pending', storageKey: 'pending/key' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const holderEntered = deferred<void>();
    const releaseHolder = deferred<void>();
    const holder = fixture.coordinator.withKey('pending/key', async () => {
      holderEntered.resolve();
      await releaseHolder.promise;
    });
    await holderEntered.promise;

    const cleanup = fixture.service.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fixture.storage.delete).not.toHaveBeenCalled();
    expect(fixture.queryRaw).toHaveBeenCalledTimes(2);

    releaseHolder.resolve();
    await holder;
    await cleanup;

    expect(fixture.queryRaw.mock.calls[2]?.[0]).toContain(
      'd."pending_storage_key" = $2',
    );
    expect(fixture.queryRaw.mock.calls[2]?.[0]).toContain('NOT EXISTS');
    expect(fixture.storage.delete).toHaveBeenCalledWith('pending/key');
  });

  it('keeps a writer asleep across both cleanup delete phases and clears pending last', async () => {
    const fixture = createFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'draft-pending', storageKey: 'pending/key' },
      ])
      .mockResolvedValueOnce([
        { id: 'draft-pending', storageKey: 'pending/key' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    let pendingStorageKey: string | null = 'pending/key';
    let temporaryExists = true;
    let finalExists = true;
    const temporaryDeleted = deferred<void>();
    const releaseFinalDelete = deferred<void>();
    fixture.storage.delete.mockImplementation(async () => {
      temporaryExists = false;
      temporaryDeleted.resolve();
      await releaseFinalDelete.promise;
      finalExists = false;
    });
    fixture.uploadDraft.updateMany.mockImplementation(async () => {
      pendingStorageKey = null;
      return { count: 1 };
    });

    const cleanup = fixture.service.runOnce();
    await temporaryDeleted.promise;
    let writerEntered = false;
    const writer = fixture.coordinator.withKey('pending/key', async () => {
      writerEntered = true;
    });
    await Promise.resolve();

    expect(temporaryExists).toBe(false);
    expect(finalExists).toBe(true);
    expect(pendingStorageKey).toBe('pending/key');
    expect(writerEntered).toBe(false);

    releaseFinalDelete.resolve();
    await cleanup;
    await writer;
    expect(finalExists).toBe(false);
    expect(pendingStorageKey).toBeNull();
    expect(writerEntered).toBe(true);
  });

  it('commits proof deletion intent after ordered locks and before deleting the current storage key', async () => {
    const f = createProofFixture();
    const intentReady = deferred<void>();
    const acknowledgeCommit = deferred<void>();
    f.db.$transaction.mockImplementation(async (operation) => {
      const result = await operation(f.transaction);
      if (f.events.includes('proof-a:DELETED')) {
        intentReady.resolve();
        await acknowledgeCommit.promise;
        f.events.push('intent-committed');
      }
      return result;
    });
    f.storage.delete.mockImplementation(async (key) => {
      expect(f.events).toContain('intent-committed');
      f.events.push(`blob:${key}`);
    });

    const cleanup = f.service.runOnce();
    await intentReady.promise;
    expect(f.storage.delete).not.toHaveBeenCalled();
    acknowledgeCommit.resolve();
    await cleanup;

    expect(f.events).toEqual([
      'material:material-a',
      'content:proof-a',
      'proof-a:DELETED',
      'intent-committed',
      'blob:current/proof-a',
      'proof-a:PURGED',
    ]);
  });

  it.each(['material', 'content', 'update-count'] as const)(
    'does not delete proof bytes when the %s recheck cannot claim the candidate',
    async (blockedAt) => {
      const f = createProofFixture({ blockedAt });
      await f.service.runOnce();
      expect(f.storage.delete).not.toHaveBeenCalled();
      if (blockedAt === 'material')
        expect(f.events).not.toContain('content:proof-a');
      expect(f.state.get('proof-a')).toBe('AVAILABLE');
    },
  );

  it('keeps proof intent retryable after blob failure and does not rewrite DELETED on retry', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const f = createProofFixture();
    f.storage.delete.mockRejectedValueOnce(new Error('storage offline'));
    await f.service.runOnce();
    expect(f.state.get('proof-a')).toBe('DELETED');
    await f.service.runOnce();
    expect(f.state.get('proof-a')).toBe('PURGED');
    expect(
      f.events.filter((event) => event === 'proof-a:DELETED'),
    ).toHaveLength(1);
    expect(f.storage.delete).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it('retries an idempotent blob delete when PURGED persistence fails', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const f = createProofFixture({ failPurgeOnce: true });
    await f.service.runOnce();
    expect(f.state.get('proof-a')).toBe('DELETED');
    await f.service.runOnce();
    expect(f.state.get('proof-a')).toBe('PURGED');
    expect(f.storage.delete.mock.calls).toEqual([
      ['current/proof-a'],
      ['current/proof-a'],
    ]);
    warning.mockRestore();
  });

  it('does not delete proof bytes on an unknown intent commit and safely retries persisted DELETED', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const f = createProofFixture();
    let lostAcknowledgement = false;
    f.db.$transaction.mockImplementation(async (operation) => {
      const result = await operation(f.transaction);
      if (!lostAcknowledgement && f.state.get('proof-a') === 'DELETED') {
        lostAcknowledgement = true;
        throw new Error('commit acknowledgement lost');
      }
      return result;
    });
    await f.service.runOnce();
    expect(f.storage.delete).not.toHaveBeenCalled();
    expect(f.state.get('proof-a')).toBe('DELETED');
    await f.service.runOnce();
    expect(f.state.get('proof-a')).toBe('PURGED');
    warning.mockRestore();
  });

  it('isolates a rejected proof so another proof and an ordinary candidate can finish', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const f = createProofFixture({ rejectFirstProof: true, ordinary: true });
    await f.service.runOnce();
    expect(f.state.get('proof-a')).toBe('AVAILABLE');
    expect(f.state.get('proof-b')).toBe('PURGED');
    expect(f.storage.delete.mock.calls).toEqual([
      ['ordinary/key'],
      ['current/proof-b'],
    ]);
    warning.mockRestore();
  });

  it('rechecks proof expiry, frozen state, all references and both document paths', async () => {
    const f = createProofFixture();
    await f.service.runOnce();
    const discovery =
      f.queryRaw.mock.calls.find(([sql]) =>
        sql.includes('ORDER BY cv."id" LIMIT $2'),
      )?.[0] ?? '';
    const materialLock =
      f.queryRaw.mock.calls.find(([sql]) =>
        sql.includes('FOR NO KEY UPDATE OF m SKIP LOCKED'),
      )?.[0] ?? '';
    const contentLock =
      f.queryRaw.mock.calls.find(([sql]) =>
        sql.includes('FOR NO KEY UPDATE OF cv SKIP LOCKED'),
      )?.[0] ?? '';
    for (const sql of [discovery, materialLock]) {
      expect(sql).toContain("INTERVAL '90 days'");
      expect(sql).toContain('NOT m."payment_proof_frozen"');
      expect(sql).toContain('m."status" = \'DELETED\'');
    }
    for (const sql of [discovery, contentLock]) {
      expect(sql).toContain('NOT cv."payment_proof_frozen"');
      for (const table of [
        'material_references',
        'case_closure_payment_documents',
        'case_payment_proof_supplement_documents',
      ])
        expect(sql).toContain(`FROM "${table}"`);
    }
  });

  it('catches startup and interval failures at the scheduling boundary', async () => {
    jest.useFakeTimers();
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fixture = createFixture();
    const run = jest
      .spyOn(fixture.service, 'runOnce')
      .mockRejectedValue(new Error('database unavailable'));

    fixture.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(run).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      'Private material cleanup run failed and will be retried',
    );
    fixture.service.onModuleDestroy();
    warning.mockRestore();
    jest.useRealTimers();
  });

  it('starts immediately, repeats every 15 minutes and unreferences its timer', async () => {
    jest.useFakeTimers();
    const fixture = createFixture();
    fixture.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(fixture.queryRaw).toHaveBeenCalledTimes(5);
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fixture.queryRaw.mock.calls.length).toBeGreaterThan(5);
    fixture.service.onModuleDestroy();
    jest.useRealTimers();
  });
});

function createFixture() {
  const coordinator = new MaterialStorageKeyCoordinator();
  const queryRaw = jest.fn<Promise<unknown[]>, [string, ...unknown[]]>(
    async () => [],
  );
  const contentVersion = {
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const uploadDraft = {
    updateMany: jest.fn(async () => ({ count: 0 })),
  };
  const transaction = {
    $queryRawUnsafe: queryRaw,
    uploadDraft,
    contentVersion,
  };
  const db = {
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
    contentVersion,
  };
  const storage: jest.Mocked<PrivateBlobStorage> = {
    put: jest.fn(),
    open: jest.fn(),
    delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    health: jest.fn(async () => 'ready'),
  };
  return {
    db,
    transaction,
    queryRaw,
    contentVersion,
    uploadDraft,
    storage,
    coordinator,
    service: new MaterialCleanupService(
      db as unknown as DatabaseService,
      storage,
      coordinator,
      () => now,
    ),
  };
}

function createProofFixture(
  options: {
    blockedAt?: 'material' | 'content' | 'update-count';
    failPurgeOnce?: boolean;
    rejectFirstProof?: boolean;
    ordinary?: boolean;
  } = {},
) {
  const f = createFixture();
  const events: string[] = [];
  const state = new Map<string, 'AVAILABLE' | 'DELETED' | 'PURGED'>([
    ['proof-a', 'AVAILABLE'],
    ...(options.rejectFirstProof ? [['proof-b', 'AVAILABLE'] as const] : []),
  ]);
  let purgeFailed = false;
  f.queryRaw.mockImplementation(async (sql, id) => {
    if (sql.includes('ORDER BY cv."id" LIMIT $2')) {
      return [...state.entries()]
        .filter(([, status]) => status !== 'PURGED')
        .map(([versionId]) => ({
          id: versionId,
          materialId: versionId.replace('proof-', 'material-'),
          storageKey: `stale/${versionId}`,
        }));
    }
    if (sql.includes('FOR NO KEY UPDATE OF m SKIP LOCKED')) {
      events.push(`material:${String(id)}`);
      return options.blockedAt === 'material' ? [] : [{ id }];
    }
    if (sql.includes('FOR NO KEY UPDATE OF cv SKIP LOCKED')) {
      events.push(`content:${String(id)}`);
      return options.blockedAt === 'content'
        ? []
        : [
            {
              id,
              storageKey: `current/${String(id)}`,
              status: state.get(String(id)),
            },
          ];
    }
    if (options.ordinary && sql.includes('m."category"::text <>'))
      return [{ id: 'ordinary', storageKey: 'ordinary/key' }];
    return [];
  });
  f.contentVersion.updateMany.mockImplementation(async (...args: unknown[]) => {
    const input = args[0] as {
      where: { id: string };
      data: { status: 'DELETED' | 'PURGED' };
    };
    const id = input.where.id;
    if (id === 'ordinary') return { count: 1 };
    if (options.blockedAt === 'update-count') return { count: 0 };
    if (options.rejectFirstProof && id === 'proof-a')
      throw new Error('proof guard rejected');
    if (
      input.data.status === 'PURGED' &&
      options.failPurgeOnce &&
      !purgeFailed
    ) {
      purgeFailed = true;
      throw new Error('database unavailable after blob deletion');
    }
    state.set(id, input.data.status);
    events.push(`${id}:${input.data.status}`);
    return { count: 1 };
  });
  return { ...f, events, state };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
