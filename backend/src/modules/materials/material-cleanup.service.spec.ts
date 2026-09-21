import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { MaterialCleanupService } from './material-cleanup.service';
import { PrivateBlobStorage } from './private-blob-storage';

const now = new Date('2026-09-21T04:00:00.000Z');

describe('MaterialCleanupService', () => {
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
    expect(purgeSql).toContain('NOT EXISTS');
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
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
    expect(fixture.queryRaw).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fixture.queryRaw.mock.calls.length).toBeGreaterThan(4);
    fixture.service.onModuleDestroy();
    jest.useRealTimers();
  });
});

function createFixture() {
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
    queryRaw,
    contentVersion,
    uploadDraft,
    storage,
    service: new MaterialCleanupService(
      db as unknown as DatabaseService,
      storage,
      () => now,
    ),
  };
}
