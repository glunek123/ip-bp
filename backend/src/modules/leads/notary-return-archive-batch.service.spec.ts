import { randomUUID } from 'node:crypto';
import { NotaryReturnArchiveBatchService } from './notary-return-archive-batch.service';
import { NotaryReturnArchiveService } from './notary-return-archive.service';
import { Prisma } from '../../generated/prisma/client';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const first = '33333333-3333-4333-8333-333333333333';
const second = '44444444-4444-4444-8444-444444444444';
const keep = (matterId: string) => ({
  matterId,
  returnChoice: 'KEEP' as const,
  archiveReason: '保留商品',
  expectedVersion: 5,
});

function fixture() {
  const matter = (id: string) => ({
    id,
    departmentId: actor.departmentId,
    stage: 'WAITING_RETURN',
    version: 5,
    sourceLead: { responsibleUserId: actor.userId, teamId: null },
    openingReviewDecision: {
      result: 'INFRINGEMENT',
      reason: null,
      archivedAt: null,
    },
    issuanceDecision: {
      id: '55555555-5555-4555-8555-555555555555',
      decision: 'NO_ISSUE',
    },
    evidence: {
      matterId: id,
      sampleFeeState: 'KNOWN',
      sampleFeeAmount: new Prisma.Decimal('100.00'),
    },
  });
  const matters = new Map([
    [first, matter(first)],
    [second, matter(second)],
  ]);
  const archives = new Map<string, Record<string, unknown>>();
  const receipts = new Map<string, Record<string, unknown>>();
  const audits: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRawUnsafe: jest.fn(async (_sql: string, id: string) =>
      matters.has(id) ? [{ id }] : [],
    ),
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        active: true,
        displayName: '运营',
      }),
    },
    notaryMatter: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          matters.get(where.id) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version: number };
          data: { stage: string; version: number };
        }) => {
          const row = matters.get(where.id);
          if (row?.version !== where.version || row.stage !== 'WAITING_RETURN')
            return { count: 0 };
          row.stage = data.stage;
          row.version = data.version;
          return { count: 1 };
        },
      ),
    },
    notaryReturnAmount: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async () => ({})),
    },
    notaryReturnArchive: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: randomUUID(), archivedAt: data.archivedAt };
        archives.set(data.matterId as string, row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { matterId: string } }) => {
          const row = archives.get(where.matterId);
          return row === undefined ? null : { ...row, amounts: [] };
        },
      ),
    },
    notaryReturnArchiveBatchReceipt: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
          };
        }) =>
          receipts.get(
            where.departmentId_actorUserId_idempotencyKey.idempotencyKey,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        receipts.set(data.idempotencyKey as string, data);
        return data;
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: { resourceId: string } }) =>
          audits.find((row) => row.resourceId === where.resourceId) ?? null,
      ),
    },
  };
  const database = {
    $transaction: jest.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  const single = new NotaryReturnArchiveService(
    database as never,
    access as never,
  );
  return {
    service: new NotaryReturnArchiveBatchService(database as never, single),
    tx,
    matters,
    archives,
    receipts,
    audits,
    access,
  };
}

describe('NotaryReturnArchiveBatchService', () => {
  it('commits two sorted independent facts and replays an equivalent reversed request', async () => {
    const f = fixture();
    const input = { items: [keep(second), keep(first)] };
    const created = await f.service.archive(actor, 'key', input);
    expect(created.items.map((item) => item.id)).toEqual([first, second]);
    expect(f.archives.size).toBe(2);
    expect(f.receipts.size).toBe(1);
    expect(f.audits).toHaveLength(3);
    expect(f.audits[2]).toMatchObject({
      resourceType: 'notary_archive_batch',
      resourceId: created.batchId,
      details: { actualIds: [first, second], count: 2 },
    });
    expect(
      await f.service.archive(actor, 'key', {
        items: [...input.items].reverse(),
      }),
    ).toEqual(created);
    expect(f.audits).toHaveLength(3);
    await expect(
      f.service.archive(actor, 'key', { items: [keep(first)] }),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('reports RECEIPT_CORRUPT in the service when a saved batch snapshot is damaged', async () => {
    const f = fixture();
    const input = { items: [keep(first), keep(second)] };
    const result = await f.service.archive(actor, 'key', input);
    const receipt = f.receipts.get('key');
    if (receipt === undefined) throw new Error('fixture receipt missing');
    receipt.resultSnapshot = { batchId: result.batchId, items: [] };
    await expect(f.service.archive(actor, 'key', input)).rejects.toMatchObject({
      response: { code: 'RECEIPT_CORRUPT' },
    });
  });

  it.each(['CUSTOMER', 'NOTARY_OFFICE'])(
    'rejects a current %s database identity',
    async (accountType) => {
      const f = fixture();
      f.tx.userAccount.findUnique.mockResolvedValue({
        accountType,
        active: true,
        displayName: '外部',
      });
      await expect(
        f.service.archive(actor, 'key', { items: [keep(first), keep(second)] }),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.receipts.size).toBe(0);
      expect(f.archives.size).toBe(0);
    },
  );
  it.each([
    { items: [] },
    { items: [keep(first), keep(first)] },
    { items: Array.from({ length: 51 }, (_, index) => keep(index.toString())) },
    { items: [{ ...keep(first), unknown: true }] },
    { items: [{ ...keep(first), matterId: 'unknown' }] },
    { items: [keep(first)], unknown: true },
  ])(
    'rejects invalid batch input before opening a transaction: %#',
    async (input) => {
      const database = { $transaction: jest.fn() };
      const access = { authorizeLead: jest.fn() };
      const service = new NotaryReturnArchiveBatchService(
        database as never,
        new NotaryReturnArchiveService(database as never, access as never),
      );
      await expect(
        service.archive(actor, 'key', input as never),
      ).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects an external actor before opening a transaction', async () => {
    const database = { $transaction: jest.fn() };
    const access = { authorizeLead: jest.fn() };
    const service = new NotaryReturnArchiveBatchService(
      database as never,
      new NotaryReturnArchiveService(database as never, access as never),
    );
    await expect(
      service.archive({ ...actor, clientCustomerId: 'customer' }, 'key', {
        items: [keep(first), keep(second)],
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
