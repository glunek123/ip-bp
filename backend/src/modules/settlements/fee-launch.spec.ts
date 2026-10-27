import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { FeeService } from './fee.service';

const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};

type Row = {
  id: string;
  caseId: string;
  status: string;
  amount: Prisma.Decimal;
  deletedAt: Date | null;
};

function setup(rows: Row[], updateRecord?: Row) {
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'case' }]),
    feeRecord: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          rows.map((row) => ({ ...row, version: 1, cancellation: null })),
        ),
      findFirst: jest.fn().mockResolvedValue(updateRecord ?? rows[0] ?? null),
      updateMany: jest
        .fn()
        .mockImplementation(
          (input: { where?: { id?: { in?: string[] } } }) => ({
            count: input.where?.id?.in?.length ?? 1,
          }),
        ),
    },
    feeBatchReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'receipt' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const database = {
    $transaction: jest.fn(
      async (work: (reader: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx as unknown as Prisma.TransactionClient),
    ),
  } as unknown as DatabaseService;
  const access = new AccessControlService({
    loadSnapshot: async () => ({
      active: true,
      authorizationRevision: 1,
      grants: [
        { action: 'fee.launch', scope: 'department' },
        { action: 'fee.update', scope: 'department' },
        { action: 'fee.delete', scope: 'department' },
      ],
    }),
  });
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationService;
  const service = new FeeService(
    database,
    access,
    organization,
    {} as MaterialService,
  );
  return { tx, service };
}

function fee(id: string, amount: string): Row {
  return {
    id,
    caseId: 'case',
    status: '未发起',
    amount: new Prisma.Decimal(amount),
    deletedAt: null,
  };
}

describe('zero amount fee launch guard', () => {
  it('processes only positive unstarted fees while preserving the original selected IDs', async () => {
    const positive = fee('fee-positive', '12.30');
    const zero = fee('fee-zero', '0.00');
    const f = setup([zero, positive]);

    await expect(
      f.service.batch(actor, 'LAUNCH', {
        ids: ['fee-zero', 'fee-positive'],
        idempotencyKey: 'original-request-key',
      }),
    ).resolves.toEqual({
      processedIds: ['fee-positive'],
      amount: '12.30',
      processedCount: 1,
    });

    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['fee-positive'] },
        departmentId: actor.departmentId,
        deletedAt: null,
        cancellation: { is: null },
        status: '未发起',
        amount: { gt: new Prisma.Decimal(0) },
      },
      data: {
        status: '发起',
        launchedAt: expect.any(Date),
        version: { increment: 1 },
      },
    });
    expect(f.tx.feeBatchReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'original-request-key',
        selectedIds: ['fee-positive', 'fee-zero'],
        resultSnapshot: {
          processedIds: ['fee-positive'],
          amount: '12.30',
          processedCount: 1,
        },
      }),
    });
  });

  it('rejects an all-zero batch without updating rows or creating receipts', async () => {
    const f = setup([fee('fee-zero', '0.00')]);

    await expect(
      f.service.batch(actor, 'LAUNCH', {
        ids: ['fee-zero'],
        idempotencyKey: 'zero-only-key',
      }),
    ).rejects.toMatchObject({
      response: { code: 'NO_LAUNCHABLE_FEES' },
    });

    expect(f.tx.feeRecord.updateMany).not.toHaveBeenCalled();
    expect(f.tx.feeBatchReceipt.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects inline launch status changes for a zero amount', async () => {
    const zero = fee('fee-zero', '0.00');
    const f = setup([], zero);

    await expect(
      f.service.update(actor, zero.id, {
        expectedVersion: 1,
        status: '发起',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ZERO_FEE_CANNOT_LAUNCH' },
    });

    expect(f.tx.feeRecord.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('allows ordinary updates to a zero fee when its status is unchanged', async () => {
    const zero = fee('fee-zero', '0.00');
    const f = setup([], zero);

    await expect(
      f.service.update(actor, zero.id, {
        expectedVersion: 1,
        note: '零元来源记录',
      }),
    ).resolves.toEqual({ id: 'fee-zero', version: 2 });

    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'fee-zero',
        departmentId: actor.departmentId,
        version: 1,
        deletedAt: null,
        cancellation: { is: null },
      },
      data: {
        version: { increment: 1 },
        note: '零元来源记录',
      },
    });
  });

  it('keeps zero fee deletion available', async () => {
    const f = setup([fee('fee-zero', '0.00')]);

    await expect(
      f.service.batch(actor, 'DELETE', {
        ids: ['fee-zero'],
        idempotencyKey: 'zero-delete-key',
      }),
    ).resolves.toMatchObject({ processedIds: ['fee-zero'], amount: '0.00' });

    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ amount: expect.anything() }),
        data: { deletedAt: expect.any(Date), version: { increment: 1 } },
      }),
    );
  });

  it.each(['发起', '已支付'])(
    'rejects batch deletion of %s before changing any row',
    async (status) => {
      const protectedFee = { ...fee('protected-fee', '100.00'), status };
      const f = setup([protectedFee]);
      await expect(
        f.service.batch(actor, 'DELETE', {
          ids: [protectedFee.id],
          idempotencyKey: 'protected-delete',
        }),
      ).rejects.toMatchObject({
        response: { code: 'FEE_REQUIRES_CANCELLATION' },
      });
      expect(f.tx.feeRecord.updateMany).not.toHaveBeenCalled();
    },
  );
});
