import { Prisma } from '../../generated/prisma/client';
import {
  linkNotaryFeesToCase,
  syncNotaryMatterCost,
  syncNotaryReturnFees,
} from './notary-cost-source';

const day = new Date('2026-11-08T00:00:00.000Z');
const departmentId = 'department';
const matterId = 'matter';

function setup() {
  let caseId: string | null = null;
  const costs = new Map<
    string,
    {
      matterId: string;
      departmentId: string;
      category: string;
      state: 'KNOWN' | 'PENDING';
      amount: Prisma.Decimal | null;
      feeDate: Date;
      revision: number;
    }
  >();
  const fees = new Map<
    string,
    {
      id: string;
      caseId: string | null;
      notaryMatterId: string;
      type: string;
      direction: string;
      status: string;
      amount: Prisma.Decimal;
      feeDate: Date;
      source: string;
      deletedAt: Date | null;
    }
  >();
  const tx = {
    notaryMatter: {
      findFirst: jest.fn(async () => ({
        case: caseId ? { id: caseId } : null,
      })),
    },
    notaryMatterCost: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { matterId_category: { category: string } };
        }) => costs.get(where.matterId_category.category) ?? null,
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: typeof costs extends Map<string, infer V> ? V : never;
        }) => {
          const row = { ...data, revision: 1 };
          costs.set(data.category, row);
          return row;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { matterId_category: { category: string } };
          data: {
            state: 'KNOWN' | 'PENDING';
            amount: Prisma.Decimal | null;
            feeDate: Date;
          };
        }) => {
          const previous = costs.get(where.matterId_category.category)!;
          const row = { ...previous, ...data, revision: previous.revision + 1 };
          costs.set(previous.category, row);
          return row;
        },
      ),
    },
    feeRecord: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { departmentId_sourceKind_sourceId: { sourceId: string } };
        }) => fees.get(where.departmentId_sourceKind_sourceId.sourceId) ?? null,
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(async () => [...fees.values()]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `fee-${fees.size + 1}`,
          caseId: data.caseId as string | null,
          notaryMatterId: data.notaryMatterId as string,
          type: data.type as string,
          direction: data.direction as string,
          status: data.status as string,
          amount: data.amount as Prisma.Decimal,
          feeDate: data.feeDate as Date,
          source: data.source as string,
          deletedAt: null,
        };
        fees.set(data.sourceId as string, row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { amount?: Prisma.Decimal; feeDate?: Date; caseId?: string };
        }) => {
          const row = [...fees.values()].find((item) => item.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    case: { findFirst: jest.fn(async () => (caseId ? { id: caseId } : null)) },
    notaryReturnArchive: { findFirst: jest.fn() },
    auditEvent: {
      findFirst: jest.fn().mockResolvedValue({
        actorKind: 'HUMAN',
        actorUserId: 'operator',
        internalActorUserId: 'operator',
        notaryOfficeAccountBindingId: null,
        customerAccountBindingId: null,
        lawyerAccountBindingId: null,
      }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    mocks: tx,
    fees,
    costs,
    setCase(id: string) {
      caseId = id;
    },
  };
}

describe('notary fee source and case linkage', () => {
  it('records a known sample cost before a case exists and preserves its identity on replay', async () => {
    const fixture = setup();
    const facts = {
      departmentId,
      matterId,
      category: 'SAMPLE' as const,
      state: 'KNOWN' as const,
      amount: '35.00',
      feeDate: day,
      sourceActionEventId: 'source-event',
    };
    await expect(syncNotaryMatterCost(fixture.tx, facts)).resolves.toEqual({
      created: true,
    });
    await expect(syncNotaryMatterCost(fixture.tx, facts)).resolves.toEqual({
      created: false,
    });
    expect(fixture.fees.get('matter:sample')).toMatchObject({
      caseId: null,
      notaryMatterId: matterId,
      type: '样品费',
      status: '未发起',
    });
    expect(fixture.mocks.feeRecord.create).toHaveBeenCalledTimes(1);
    expect(fixture.mocks.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'fee.source-synced',
          actorKind: 'HUMAN',
          actorUserId: 'operator',
          internalActorUserId: 'operator',
        }),
      }),
    );
  });

  it('requires the originating notary audit before recording a fee receipt', async () => {
    const fixture = setup();
    fixture.mocks.auditEvent.findFirst.mockResolvedValueOnce(null);
    await expect(
      syncNotaryMatterCost(fixture.tx, {
        departmentId,
        matterId,
        category: 'SAMPLE',
        state: 'KNOWN',
        amount: '35.00',
        feeDate: day,
        sourceActionEventId: 'missing-event',
      }),
    ).rejects.toMatchObject({
      response: { code: 'FEE_SOURCE_INVALID' },
    });
  });

  it('updates the same unlaunched source row and blocks a launched amount change', async () => {
    const fixture = setup();
    const facts = {
      departmentId,
      matterId,
      category: 'NOTARY' as const,
      state: 'KNOWN' as const,
      amount: '100.00',
      feeDate: day,
      sourceActionEventId: 'source-event',
    };
    await syncNotaryMatterCost(fixture.tx, facts);
    await syncNotaryMatterCost(fixture.tx, { ...facts, amount: '120.00' });
    expect(fixture.fees.get('matter:notary')!.amount.toFixed(2)).toBe('120.00');
    fixture.fees.get('matter:notary')!.status = '发起';
    await expect(
      syncNotaryMatterCost(fixture.tx, { ...facts, amount: '130.00' }),
    ).rejects.toMatchObject({
      response: { code: 'FEE_SOURCE_INVALID' },
    });
    expect(fixture.mocks.feeRecord.create).toHaveBeenCalledTimes(1);
  });

  it('links the existing fee to the issued case without creating a second fee', async () => {
    const fixture = setup();
    await syncNotaryMatterCost(fixture.tx, {
      departmentId,
      matterId,
      category: 'SAMPLE',
      state: 'KNOWN',
      amount: '25.00',
      feeDate: day,
      sourceActionEventId: 'source-event',
    });
    fixture.setCase('issued-case');
    await linkNotaryFeesToCase(fixture.tx, {
      departmentId,
      matterId,
      caseId: 'issued-case',
    });
    expect(fixture.fees.get('matter:sample')!.caseId).toBe('issued-case');
    expect(fixture.mocks.feeRecord.create).toHaveBeenCalledTimes(1);
  });

  it('records expected refund and freight separately without marking either paid', async () => {
    const fixture = setup();
    fixture.mocks.notaryReturnArchive.findFirst.mockResolvedValue({
      archiveDate: day,
      archivedAt: day,
      matter: { case: null },
      amounts: [
        { kind: 'REFUND', state: 'KNOWN', amount: new Prisma.Decimal('10.00') },
        { kind: 'FREIGHT', state: 'KNOWN', amount: new Prisma.Decimal('4.00') },
      ],
    });
    await syncNotaryReturnFees(fixture.tx, {
      departmentId,
      matterId,
      archiveId: 'archive',
      sourceActionEventId: 'source-event',
    });
    expect(fixture.fees.get('matter:refund')).toMatchObject({
      direction: '收入',
      status: '未发起',
      type: '样品费退款',
    });
    expect(fixture.fees.get('matter:freight')).toMatchObject({
      direction: '支出',
      status: '未发起',
      type: '退货运费',
    });
  });
});
