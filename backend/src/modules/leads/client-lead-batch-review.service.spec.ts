import { randomUUID } from 'node:crypto';
import { ClientLeadService } from './client-lead.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const ids = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];

function fixture(secondVersion = 3) {
  let leads = ids.map((id, index) => ({
    id,
    businessNo: `LD-20261108-00${index + 1}`,
    departmentId: actor.departmentId,
    customerId: '33333333-3333-4333-8333-333333333333',
    responsibleUserId: actor.userId,
    teamId: null,
    status: 'WAITING_REVIEW',
    version: index === 0 ? 3 : secondVersion,
    activeReviewDecisionId: null as string | null,
    pushedAt: new Date('2026-11-08T01:00:00Z'),
    pushedByUserId: actor.userId,
  }));
  let receipt: { requestFingerprint: string; resultSnapshot: unknown } | null =
    null;
  let pending = leads;
  const tx = {
    $queryRawUnsafe: jest.fn(async () => ids.map((id) => ({ id }))),
    userAccount: {
      findUnique: jest.fn(async () => ({
        accountType: 'INTERNAL',
        active: true,
        displayName: '运营甲',
      })),
    },
    lead: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          pending.find((lead) => lead.id === where.id) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            status: string;
            version: { increment: number };
            activeReviewDecisionId: string;
          };
        }) => {
          const lead = pending.find((entry) => entry.id === where.id)!;
          lead.status = data.status;
          lead.version += data.version.increment;
          lead.activeReviewDecisionId = data.activeReviewDecisionId;
          return lead;
        },
      ),
    },
    leadReviewDecision: {
      create: jest.fn(async ({ data }: { data: { decidedAt: Date } }) => ({
        ...data,
        id: randomUUID(),
      })),
    },
    clientLeadReviewReceipt: { create: jest.fn(async () => ({})) },
    leadCommandReceipt: {
      findUnique: jest.fn(async () => receipt),
      create: jest.fn(
        async ({
          data,
        }: {
          data: { requestFingerprint: string; resultSnapshot: unknown };
        }) => {
          receipt = data;
          return data;
        },
      ),
    },
  };
  const database = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      pending = structuredClone(leads);
      const result = await run(tx);
      leads = pending;
      return result;
    },
  };
  const access = { authorizeLead: jest.fn(async () => undefined) };
  const service = new ClientLeadService(
    database as never,
    {} as never,
    access as never,
  );
  return { service, current: () => leads, tx };
}

describe('ClientLeadService batch proxy review', () => {
  const input = {
    items: ids.map((leadId) => ({ leadId, expectedVersion: 3 })),
    result: 'NO_INFRINGEMENT' as const,
    reason: '审核归档',
    archiveDate: '2026-11-07',
  };

  it('writes both reviews atomically and replays the same receipt', async () => {
    const f = fixture();
    const first = await f.service.batchProxyReview(actor, 'batch-key', input);
    expect(first.items).toHaveLength(2);
    expect(first.items[0].reviewDecision).toMatchObject({
      result: 'NO_INFRINGEMENT',
      archiveDate: '2026-11-07',
    });
    expect(f.current().map((lead) => lead.status)).toEqual([
      'ARCHIVED',
      'ARCHIVED',
    ]);
    await expect(
      f.service.batchProxyReview(actor, 'batch-key', input),
    ).resolves.toEqual(first);
    expect(f.tx.leadReviewDecision.create).toHaveBeenCalledTimes(2);
  });

  it('leaves every item unchanged when a later lead has a stale version', async () => {
    const f = fixture(4);
    await expect(
      f.service.batchProxyReview(actor, 'stale-batch', input),
    ).rejects.toMatchObject({
      response: { code: 'BATCH_REVIEW_REJECTED' },
    });
    expect(f.current().map((lead) => lead.status)).toEqual([
      'WAITING_REVIEW',
      'WAITING_REVIEW',
    ]);
    expect(f.current().map((lead) => lead.version)).toEqual([3, 4]);
  });
});
