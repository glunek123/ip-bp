import { Prisma } from '../../generated/prisma/client';
import { ClosureActualAggregateReadDraft } from './closure-actual-aggregate-read-draft';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 1,
};
function fixture(group = false) {
  const tx = {
    caseConsolidationMember: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(
          group
            ? [
                {
                  consolidationId: 'group',
                  departmentId: 'department',
                  isMain: true,
                },
              ]
            : [],
        )
        .mockResolvedValue([
          { caseId: 'main', departmentId: 'department', isMain: true },
          { caseId: 'source', departmentId: 'department', isMain: false },
        ]),
    },
    caseConsolidation: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          group ? [{ id: 'group', departmentId: 'department' }] : [],
        ),
    },
    case: {
      findMany: jest.fn().mockResolvedValue(
        (group ? ['main', 'source'] : ['main']).map((id) => ({
          id,
          departmentId: 'department',
        })),
      ),
    },
    caseSettlementActualAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const read = () =>
    new ClosureActualAggregateReadDraft().readInTransaction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      'main',
    );
  return { tx, read };
}
const allocation = (
  id: string,
  amount: string,
  side = 'CUSTOMER',
  caseId = 'main',
) => ({
  id,
  amount: new Prisma.Decimal(amount),
  side,
  caseId,
  departmentId: 'department',
});

it('preserves missing records as unknown and uses only the supplied transaction', async () => {
  const { read, tx } = fixture();
  await expect(read()).resolves.toEqual({
    scope: 'CASE',
    customerReceivedAmount: null,
    lawyerInvoicedAmount: null,
  });
  expect(
    tx.caseSettlementActualAllocation.findMany.mock.calls[0][0].where,
  ).toEqual({ caseId: { in: ['main'] } });
});
it('sums main and source allocations exactly once without exposing source IDs or due amounts', async () => {
  const { read, tx } = fixture(true);
  const first = allocation('one', '9999999999999999999999999999.99');
  tx.caseSettlementActualAllocation.findMany.mockResolvedValue([
    first,
    first,
    allocation('two', '0.01', 'CUSTOMER', 'source'),
    allocation('three', '1.23', 'LAWYER', 'source'),
  ]);
  await expect(read()).resolves.toEqual({
    scope: 'CONSOLIDATION',
    customerReceivedAmount: '10000000000000000000000000000.00',
    lawyerInvoicedAmount: '1.23',
  });
  expect(tx.caseConsolidationMember.findMany.mock.calls[1][0].where).toEqual({
    consolidationId: 'group',
  });
});
it('keeps an original member case restricted to its own allocations', async () => {
  const { read, tx } = fixture();
  tx.caseConsolidationMember.findMany
    .mockReset()
    .mockResolvedValue([
      { consolidationId: 'group', departmentId: 'department', isMain: false },
    ]);
  await expect(read()).resolves.toMatchObject({ scope: 'CASE' });
  expect(tx.caseConsolidationMember.findMany).toHaveBeenCalledTimes(1);
});
it.each(['crossDepartment', 'missingMain', 'duplicate', 'missingCase'])(
  'rejects incomplete or corrupt groups: %s',
  async (kind) => {
    const { read, tx } = fixture(true);
    if (kind === 'missingCase')
      tx.case.findMany.mockResolvedValue([
        { id: 'main', departmentId: 'department' },
      ]);
    else
      tx.caseConsolidationMember.findMany.mockResolvedValueOnce([
        {
          caseId: 'main',
          departmentId: 'department',
          isMain: kind !== 'missingMain',
        },
        {
          caseId: kind === 'duplicate' ? 'main' : 'source',
          departmentId: kind === 'crossDepartment' ? 'other' : 'department',
          isMain: false,
        },
      ]);
    await expect(read()).rejects.toMatchObject({
      response: { code: 'CASE_ACTUAL_AGGREGATE_SOURCE_INVALID' },
    });
    expect(tx.caseSettlementActualAllocation.findMany).not.toHaveBeenCalled();
  },
);
it('rejects a head without a main membership', async () => {
  const { read, tx } = fixture();
  tx.caseConsolidation.findMany.mockResolvedValue([
    { id: 'group', departmentId: 'department' },
  ]);
  await expect(read()).rejects.toThrow();
});
it.each(['0', '-1', '0.001', '10000000000000000000000000000.00'])(
  'rejects invalid allocation amount %s rather than rounding',
  async (amount) => {
    const { read, tx } = fixture();
    tx.caseSettlementActualAllocation.findMany.mockResolvedValue([
      allocation('one', amount),
    ]);
    await expect(read()).rejects.toThrow();
  },
);
it.each(['side', 'department'])(
  'rejects an allocation with an invalid %s',
  async (kind) => {
    const { read, tx } = fixture();
    tx.caseSettlementActualAllocation.findMany.mockResolvedValue([
      {
        ...allocation('one', '1.00'),
        ...(kind === 'side' ? { side: 'UNKNOWN' } : { departmentId: 'other' }),
      },
    ]);
    await expect(read()).rejects.toMatchObject({
      response: { code: 'CASE_ACTUAL_AGGREGATE_SOURCE_INVALID' },
    });
  },
);
it.each(['case', 'side'])(
  'rejects the same allocation ID with conflicting %s identity',
  async (kind) => {
    const { read, tx } = fixture(true);
    tx.caseSettlementActualAllocation.findMany.mockResolvedValue([
      allocation('one', '1.00'),
      allocation(
        'one',
        '1.00',
        kind === 'side' ? 'LAWYER' : 'CUSTOMER',
        kind === 'case' ? 'source' : 'main',
      ),
    ]);
    await expect(read()).rejects.toMatchObject({
      response: { code: 'CASE_ACTUAL_AGGREGATE_SOURCE_INVALID' },
    });
  },
);
it('rejects a consolidation head whose ID differs from the main membership', async () => {
  const { read, tx } = fixture(true);
  tx.caseConsolidation.findMany.mockResolvedValue([
    { id: 'different-group', departmentId: 'department' },
  ]);
  await expect(read()).rejects.toMatchObject({
    response: { code: 'CASE_ACTUAL_AGGREGATE_SOURCE_INVALID' },
  });
  expect(tx.caseConsolidationMember.findMany).toHaveBeenCalledTimes(1);
  expect(tx.caseSettlementActualAllocation.findMany).not.toHaveBeenCalled();
});
it('rejects conflicting duplicates and propagates query failures without fabricating zero', async () => {
  const { read, tx } = fixture();
  tx.caseSettlementActualAllocation.findMany.mockResolvedValue([
    allocation('one', '1'),
    allocation('one', '2'),
  ]);
  await expect(read()).rejects.toThrow();
  const failed = fixture();
  failed.tx.caseSettlementActualAllocation.findMany.mockRejectedValue(
    new Error('query failed'),
  );
  await expect(failed.read()).rejects.toThrow('query failed');
});
