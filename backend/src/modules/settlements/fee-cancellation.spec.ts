import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { FeeService } from './fee.service';

const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};

function fixture(status: string) {
  const fee = {
    id: 'fee',
    caseId: 'case',
    departmentId: actor.departmentId,
    status,
    amount: new Prisma.Decimal('100.00'),
    version: 3,
    deletedAt: null,
    proofMaterialId: 'proof',
    proofContentVersionId: 'version',
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'case' }]),
    feeRecord: {
      findFirst: jest.fn().mockResolvedValue(fee),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    feeCancellation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'cancellation',
            ...data,
          }),
        ),
    },
    feeCancellationPayment: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => ({ ...data }),
        ),
    },
    feeRefundReconciliation: {
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => ({ ...data }),
        ),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const feeFindMany = jest.fn().mockResolvedValue([]);
  const feeFindFirst = jest.fn().mockResolvedValue(null);
  const paymentFindUnique = jest.fn().mockResolvedValue(null);
  const refundFindMany = jest.fn().mockResolvedValue([]);
  const database = {
    feeRecord: { findMany: feeFindMany, findFirst: feeFindFirst },
    feeCancellationPayment: { findUnique: paymentFindUnique },
    feeRefundReconciliation: { findMany: refundFindMany },
    $transaction: jest.fn(
      async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx as unknown as Prisma.TransactionClient),
    ),
  } as unknown as DatabaseService;
  const access = new AccessControlService({
    loadSnapshot: async () => ({
      active: true,
      authorizationRevision: 1,
      grants: [
        { action: 'fee.delete', scope: 'department' },
        { action: 'fee.update', scope: 'department' },
        { action: 'fee.read', scope: 'department' },
      ],
    }),
  });
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationService;
  const materials = {
    assertAvailableVersions: jest
      .fn()
      .mockResolvedValue([
        { materialId: 'proof', contentVersionId: 'version' },
      ]),
    freezeReferences: jest.fn().mockResolvedValue({ count: 1 }),
  };
  return {
    fee,
    tx,
    feeFindMany,
    feeFindFirst,
    paymentFindUnique,
    refundFindMany,
    materials,
    service: new FeeService(
      database,
      access,
      organization,
      materials as unknown as MaterialService,
    ),
  };
}

describe('fee cancellation', () => {
  it('lists cancelled originals with the existing fee.read scope after refresh', async () => {
    const f = fixture('已支付');
    const cancellation = {
      id: 'cancellation',
      outcome: 'VOIDED',
      reason: '重复登记',
      actorUserId: actor.userId,
      createdAt: new Date('2026-10-26T00:00:00.000Z'),
      refundReconciliationStatus: 'PENDING',
      payment: null,
      refunds: [],
    };
    f.feeFindMany.mockResolvedValue([
      {
        ...f.fee,
        type: '诉讼费',
        direction: '支出',
        feeDate: new Date('2026-10-26T00:00:00.000Z'),
        source: 'manual',
        note: null,
        case: {
          businessNo: 'CA-1',
          courtCaseNo: null,
          stage: '一审',
          sourceLead: null,
          defendants: [],
        },
        proofContentVersion: null,
        cancellation,
      },
    ]);
    const page = await f.service.listCancellations(actor, {
      page: 1,
      pageSize: 20,
      businessNo: 'CA-1',
    });
    expect(page).toMatchObject({
      total: 1,
      items: [
        {
          id: 'fee',
          status: '已支付',
          amount: '100.00',
          cancellation: { id: 'cancellation', outcome: 'VOIDED' },
        },
      ],
    });
    expect(f.feeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          cancellation: { isNot: null },
        }),
      }),
    );
  });

  it('reads original payment proof and partial refund as separate historical facts', async () => {
    const f = fixture('已支付');
    f.feeFindFirst.mockResolvedValue({
      ...f.fee,
      type: '诉讼费',
      direction: '支出',
      feeDate: new Date('2026-10-26T00:00:00.000Z'),
      source: 'manual',
      note: null,
      case: {
        businessNo: 'CA-1',
        courtCaseNo: null,
        stage: '一审',
        sourceLead: null,
        defendants: [],
      },
      proofContentVersion: { originalFilename: 'original.pdf' },
      cancellation: {
        id: 'cancellation',
        outcome: 'VOIDED',
        originalStatus: '已支付',
        originalAmount: new Prisma.Decimal('100.00'),
        originalVersion: 3,
        reason: '重复登记',
        actorUserId: actor.userId,
        createdAt: new Date('2026-10-26T00:00:00.000Z'),
        refundReconciliationStatus: 'PENDING',
      },
    });
    f.paymentFindUnique.mockResolvedValue({
      id: 'payment',
      amount: new Prisma.Decimal('100.00'),
      paymentDate: new Date('2026-10-20T00:00:00.000Z'),
      proofMaterialId: null,
      proofContentVersionId: null,
      actorUserId: actor.userId,
      createdAt: new Date('2026-10-26T00:00:00.000Z'),
    });
    f.refundFindMany.mockResolvedValue([
      {
        id: 'refund',
        amount: new Prisma.Decimal('30.00'),
        refundDate: new Date('2026-10-26T00:00:00.000Z'),
        proofMaterialId: null,
        proofContentVersionId: null,
        actorUserId: actor.userId,
        createdAt: new Date('2026-10-26T00:00:00.000Z'),
      },
    ]);
    await expect(f.service.history(actor, 'fee')).resolves.toMatchObject({
      status: '已支付',
      amount: '100.00',
      proofOriginalFilename: 'original.pdf',
      cancellation: { reconciliationStatus: 'PARTIAL_REFUND' },
      paymentVerification: { amount: '100.00', paymentDate: '2026-10-20' },
      refunds: [{ amount: '30.00', refundDate: '2026-10-26' }],
      remainingVerifiedPayment: '70.00',
    });
  });
  it('voids a paid fee while preserving original money, payment status and proof', async () => {
    const f = fixture('已支付');
    await expect(
      f.service.cancel(actor, 'fee', {
        expectedVersion: 3,
        idempotencyKey: 'key',
        reason: '重复登记',
      }),
    ).resolves.toMatchObject({
      outcome: 'VOIDED',
      refundReconciliationStatus: 'PENDING',
    });
    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { version: { increment: 1 } },
      }),
    );
    expect(f.tx.feeCancellation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalStatus: '已支付',
        originalAmount: f.fee.amount,
        originalVersion: 3,
        outcome: 'VOIDED',
        refundReconciliationStatus: 'PENDING',
      }),
    });
  });

  it('logically deletes an unlaunched fee and records the cancellation', async () => {
    const f = fixture('未发起');
    await expect(
      f.service.cancel(actor, 'fee', {
        expectedVersion: 3,
        idempotencyKey: 'key',
        reason: '录入错误',
      }),
    ).resolves.toMatchObject({
      outcome: 'DELETED',
      refundReconciliationStatus: 'NOT_REQUIRED',
    });
    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { version: { increment: 1 }, deletedAt: expect.any(Date) },
      }),
    );
  });

  it('voids a launched fee without inferring payment or refund', async () => {
    const f = fixture('发起');
    await expect(
      f.service.cancel(actor, 'fee', {
        expectedVersion: 3,
        idempotencyKey: 'key',
        reason: '待核实',
      }),
    ).resolves.toMatchObject({
      outcome: 'VOIDED',
      refundReconciliationStatus: 'PAYMENT_UNVERIFIED',
    });
    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { version: { increment: 1 } } }),
    );
  });

  it('requires a verified payment before recording a refund', async () => {
    const f = fixture('已支付');
    f.tx.feeCancellation.findUnique.mockResolvedValue({
      id: 'cancellation',
      outcome: 'VOIDED',
    });
    await expect(
      f.service.reconcileCancelledRefund(actor, 'fee', {
        amount: '20.00',
        refundDate: '2026-10-26',
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: 'refund-key',
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_NOT_VERIFIED' } });
    expect(f.tx.feeRefundReconciliation.create).not.toHaveBeenCalled();
  });

  it('records verified zero payment as a distinct fact without claiming a refund', async () => {
    const f = fixture('发起');
    f.tx.feeCancellation.findUnique.mockResolvedValue({
      id: 'cancellation',
      outcome: 'VOIDED',
    });
    await expect(
      f.service.verifyCancelledPayment(actor, 'fee', {
        amount: '0.00',
        paymentDate: null,
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: 'verify-zero',
      }),
    ).resolves.toMatchObject({ amount: '0.00', paymentDate: null });
    expect(f.tx.feeCancellationPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: new Prisma.Decimal(0),
        paymentDate: null,
        cancellationId: 'cancellation',
      }),
    });
  });

  it('freezes the exact proof version before inserting a payment fact', async () => {
    const f = fixture('已支付');
    f.tx.feeCancellation.findUnique.mockResolvedValue({
      id: 'cancellation',
      outcome: 'VOIDED',
    });
    await f.service.verifyCancelledPayment(actor, 'fee', {
      amount: '100.00',
      paymentDate: '2026-10-20',
      proofMaterialId: 'proof',
      proofContentVersionId: 'version',
      idempotencyKey: 'verify-proof',
    });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        contentVersionIds: ['version'],
      }),
    );
    expect(f.materials.freezeReferences).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceType: 'fee-payment-verification',
        resourceId: expect.any(String),
        actionEventId: 'audit',
      }),
    );
    expect(
      f.materials.freezeReferences.mock.invocationCallOrder[0],
    ).toBeLessThan(
      f.tx.feeCancellationPayment.create.mock.invocationCallOrder[0]!,
    );
  });

  it('supports partial refunds up to the verified real payment', async () => {
    const f = fixture('已支付');
    f.tx.feeCancellation.findUnique.mockResolvedValue({
      id: 'cancellation',
      outcome: 'VOIDED',
    });
    f.tx.feeCancellationPayment.findUnique.mockResolvedValue({
      id: 'payment',
      amount: new Prisma.Decimal('100.00'),
    });
    f.tx.feeRefundReconciliation.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('30.00') },
    });
    await expect(
      f.service.reconcileCancelledRefund(actor, 'fee', {
        amount: '70.00',
        refundDate: '2026-10-26',
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: 'refund-70',
      }),
    ).resolves.toMatchObject({ amount: '70.00' });
    expect(f.tx.feeRefundReconciliation.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.reconcileCancelledRefund(actor, 'fee', {
        amount: '70.01',
        refundDate: '2026-10-26',
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: 'refund-over',
      }),
    ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_PAYMENT' } });
    expect(f.tx.feeRefundReconciliation.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same refund on an identical retry without creating another fact', async () => {
    const f = fixture('已支付');
    f.tx.feeCancellation.findUnique.mockResolvedValue({
      id: 'cancellation',
      outcome: 'VOIDED',
    });
    f.tx.feeCancellationPayment.findUnique.mockResolvedValue({
      id: 'payment',
      amount: new Prisma.Decimal('100.00'),
    });
    const input = {
      amount: '20.00',
      refundDate: '2026-10-26',
      proofMaterialId: null,
      proofContentVersionId: null,
      idempotencyKey: 'same-refund',
    };
    const first = await f.service.reconcileCancelledRefund(actor, 'fee', input);
    const data = f.tx.feeRefundReconciliation.create.mock.calls[0]![0].data as {
      requestFingerprint: string;
    };
    f.tx.feeRefundReconciliation.findUnique.mockResolvedValue({
      id: first.id,
      cancellationId: 'cancellation',
      amount: new Prisma.Decimal('20.00'),
      refundDate: new Date('2026-10-26T00:00:00.000Z'),
      requestFingerprint: data.requestFingerprint,
    });
    await expect(
      f.service.reconcileCancelledRefund(actor, 'fee', input),
    ).resolves.toEqual(first);
    expect(f.tx.feeRefundReconciliation.create).toHaveBeenCalledTimes(1);
  });
});
