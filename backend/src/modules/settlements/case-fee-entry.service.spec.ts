import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { CaseFeeEntryService } from './case-fee-entry.service';
const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};
const input = {
  caseId: 'case',
  idempotencyKey: 'batch-key',
  rows: [
    {
      caseId: 'case',
      type: '诉讼费' as const,
      direction: '支出' as const,
      status: '未发起',
      amount: '0.10',
      feeDate: '2026-10-17',
      idempotencyKey: 'row-a',
    },
    {
      caseId: 'case',
      type: '其他' as const,
      direction: '收入' as const,
      status: '未发起',
      amount: '0.20',
      feeDate: '2026-10-17',
      idempotencyKey: 'row-b',
    },
  ],
};
function setup(allowed = true) {
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join('').includes('FROM cases') ? [{ id: 'case' }] : [],
    ),
    feeRecord: {
      create: jest.fn(
        async ({ data }: { data: { idempotencyKey: string } }) => ({
          id: data.idempotencyKey,
          version: 1,
        }),
      ),
    },
    auditEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const transaction = jest.fn(
    async (work: (reader: Prisma.TransactionClient) => Promise<unknown>) =>
      work(tx as unknown as Prisma.TransactionClient),
  );
  const access = new AccessControlService({
    loadSnapshot: async (_user, _dep, reader) => {
      expect(reader).toBe(tx);
      return {
        active: true,
        authorizationRevision: 1,
        grants: allowed ? [{ action: 'fee.create', scope: 'department' }] : [],
      };
    },
  });
  const service = new CaseFeeEntryService(
    { $transaction: transaction } as unknown as DatabaseService,
    access,
    { lockDepartment: jest.fn() } as unknown as OrganizationService,
  );
  return { tx, transaction, service };
}
describe('case fee entry batch', () => {
  it('creates every positive row and the batch receipt in the same authorized transaction', async () => {
    const f = setup();
    await expect(f.service.create(actor, input)).resolves.toEqual({
      createdIds: ['row-a', 'row-b'],
      createdCount: 2,
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(f.tx.feeRecord.create).toHaveBeenCalledTimes(2);
    expect(f.tx.auditEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceType: 'FEE_BATCH',
          resourceId: 'case',
          action: 'fee.created',
          details: expect.objectContaining({
            createdIds: ['row-a', 'row-b'],
            command: 'CREATE_CASE_FEE_ENTRIES',
          }),
        }),
      }),
    );
  });
  it('rechecks authorization before finding a successful old receipt', async () => {
    const f = setup(false);
    await expect(f.service.create(actor, input)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.tx.auditEvent.findMany).not.toHaveBeenCalled();
    expect(f.tx.feeRecord.create).not.toHaveBeenCalled();
  });
  it('rejects an invalid or foreign-case row before any writes', async () => {
    const f = setup();
    await expect(
      f.service.create(actor, {
        ...input,
        rows: [input.rows[0]!, { ...input.rows[1]!, caseId: 'another-case' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CASE_FEE_ENTRIES' } });
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('replays the original complete batch without creating rows again', async () => {
    const f = setup();
    await f.service.create(actor, input);
    const receipt = f.tx.auditEvent.create.mock.calls.at(-1)?.[0];
    f.tx.auditEvent.findMany.mockResolvedValue([
      { details: receipt?.data.details },
    ]);
    f.tx.feeRecord.create.mockClear();
    await expect(f.service.create(actor, input)).resolves.toEqual({
      createdIds: ['row-a', 'row-b'],
      createdCount: 2,
    });
    expect(f.tx.feeRecord.create).not.toHaveBeenCalled();
    await expect(
      f.service.create(actor, {
        ...input,
        rows: [{ ...input.rows[0]!, amount: '0.11' }, input.rows[1]!],
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it('propagates a failed second write and never publishes a batch success receipt', async () => {
    const f = setup();
    f.tx.feeRecord.create
      .mockResolvedValueOnce({ id: 'row-a', version: 1 })
      .mockRejectedValueOnce(new Error('write rejected'));
    await expect(f.service.create(actor, input)).rejects.toThrow(
      'write rejected',
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resourceType: 'FEE_BATCH' }),
      }),
    );
    // Actual PostgreSQL rollback is a separate required runner check.
  });
});
