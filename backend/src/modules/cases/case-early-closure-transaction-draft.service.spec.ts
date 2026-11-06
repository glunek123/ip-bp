import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { DatabaseService } from '../../database/database.service';
import { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import type { MaterialService } from '../materials';
import { CaseEarlyClosureTransactionDraftService } from './case-early-closure-transaction-draft.service';
import type { RecordEarlyClosureInput } from './case-early-closure.dto';
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = 'a3333333-3333-4333-8333-333333333333';
const input: RecordEarlyClosureInput = {
  expectedVersion: 4,
  expectedStage: 'WAITING_HEARING',
  idempotencyKey: 'command-1',
  closeAt: '2026-01-01',
  closeAmountState: 'KNOWN',
  closeAmt: '10.00',
  closeContentVersionIds: [],
  paymentType: 'INSTALLMENTS',
  paymentRecords: [
    {
      paidOn: '2026-01-01',
      amount: '4.00',
      payer: '甲',
      payee: '乙',
      screenshotContentVersionId: null,
    },
    {
      paidOn: '2026-01-01',
      amount: '6.00',
      payer: '丙',
      payee: '乙',
      screenshotContentVersionId: 'b4444444-4444-4444-8444-444444444444',
    },
  ],
};
const uppercase = (
  command: RecordEarlyClosureInput,
): RecordEarlyClosureInput => ({
  ...command,
  closeContentVersionIds: command.closeContentVersionIds.map((id) =>
    id.toUpperCase(),
  ),
  paymentRecords: command.paymentRecords.map((p) => ({
    ...p,
    screenshotContentVersionId:
      p.screenshotContentVersionId?.toUpperCase() ?? null,
  })),
});
function fixture() {
  const create = () =>
    jest.fn().mockImplementation(async (arg: { data: unknown }) => arg.data);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('CURRENT_TIMESTAMP')
          ? [{ recordedAt: new Date('2026-01-01T00:00:00.000Z') }]
          : [{ id: caseId }],
      ),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    case: {
      findFirst: jest.fn().mockResolvedValue({
        stage: 'WAITING_HEARING',
        version: 4,
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
        consolidationMembership: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseEarlyClosureReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: create(),
    },
    caseEarlyClosure: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: create(),
    },
    caseEarlyArchive: { findFirst: jest.fn().mockResolvedValue(null) },
    caseArchive: { findFirst: jest.fn().mockResolvedValue(null) },
    caseExecutionFinish: { findFirst: jest.fn().mockResolvedValue(null) },
    caseClosure: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: create(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseClosureVersion: {
      create: create(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseClosureReceipt: {
      create: create(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    caseClosurePaymentVersion: {
      create: create(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    caseClosurePaymentReceipt: {
      create: create(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    materialReference: { findMany: jest.fn().mockResolvedValue([]) },
    caseClosureDocument: { findMany: jest.fn().mockResolvedValue([]) },
    auditEvent: { create: create(), findMany: jest.fn().mockResolvedValue([]) },
  };
  const transaction = jest
    .fn()
    .mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
      work(tx),
    );
  const access = {
    authorizeCase: jest.fn().mockResolvedValue(undefined),
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    authorizeDepartmentProxyAction: jest.fn().mockResolvedValue(undefined),
  };
  const materials = {
    assertAvailableVersions: jest.fn().mockResolvedValue([]),
    freezeCaseClosureReferences: jest.fn().mockResolvedValue(undefined),
    freezeCaseClosurePaymentReferences: jest.fn().mockResolvedValue(undefined),
  };
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CaseEarlyClosureTransactionDraftService(
    { $transaction: transaction } as unknown as DatabaseService,
    access as unknown as AccessControlService,
    materials as unknown as MaterialService,
    organization as unknown as OrganizationService,
  );
  return { tx, transaction, access, materials, service, organization };
}
describe('unregistered atomic early closure transaction draft', () => {
  it('retries the actual adapter originalCode serialization failure before writing', async () => {
    const f = fixture();
    const error = {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
        },
      },
    };
    f.transaction.mockRejectedValueOnce(error);
    await f.service.record(actor, caseId, input);
    expect(f.transaction).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['40001', 3],
    ['23514', 1],
    ['23505', 1],
  ] as const)(
    'preserves original adapter error %s and the transaction attempt limit',
    async (originalCode, attempts) => {
      const f = fixture();
      const error = {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode } } },
      };
      f.transaction.mockRejectedValue(error);
      await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(attempts);
    },
  );

  it.each(['self', 'team'] as const)(
    'allows an assigned operator with %s case scope using real authorization rules',
    async (scope) => {
      const f = fixture();
      const realAccess = new AccessControlService({
        loadSnapshot: async () => ({
          active: true,
          authorizationRevision: 1,
          grants: [
            { action: 'case.read', scope, teamId: 'team-1' },
            { action: 'case.closure.record', scope, teamId: 'team-1' },
          ],
        }),
      });
      f.tx.case.findFirst.mockResolvedValue({
        stage: 'WAITING_HEARING',
        version: 4,
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: 'team-1' },
        consolidationMembership: null,
      });
      f.access.authorizeCase.mockImplementation(
        (...args: Parameters<AccessControlService['authorizeCase']>) =>
          realAccess.authorizeCase(...args),
      );
      await expect(
        f.service.record(actor, caseId, input),
      ).resolves.toMatchObject({ stage: 'WAITING_ARCHIVE' });
      expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
      expect(
        f.organization.lockDepartment.mock.invocationCallOrder[0],
      ).toBeLessThan(f.tx.$queryRaw.mock.invocationCallOrder[0]!);
      expect(f.tx.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        f.tx.$queryRawUnsafe.mock.invocationCallOrder[0]!,
      );
    },
  );
  it.each(['55P03', 'P2034', '40001', '40P01'])(
    'retries %s at most three times before propagating',
    async (code) => {
      const f = fixture(),
        error = { code };
      f.organization.lockDepartment.mockRejectedValue(error);
      await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(3);
      expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(['P2002', '23505', '23514'])(
    'does not retry an unclassified %s failure',
    async (code) => {
      const f = fixture(),
        error = { code };
      f.organization.lockDepartment.mockRejectedValue(error);
      await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('retries only the explicit lock-unavailable code inside a Prisma raw-query error', async () => {
    for (const [sqlCode, attempts] of [
      ['55P03', 3],
      ['23514', 1],
    ] as const) {
      const f = fixture();
      const error = new Prisma.PrismaClientKnownRequestError(
        'synthetic raw error',
        {
          code: 'P2010',
          clientVersion: 'test',
          meta: { code: sqlCode },
        },
      );
      f.organization.lockDepartment.mockRejectedValue(error);
      await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(attempts);
    }
  });
  it('persists every payment and both version transitions within one serializable callback', async () => {
    const f = fixture();
    const result = await f.service.record(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      version: 6,
      stage: 'WAITING_ARCHIVE',
    });
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(f.tx.case.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { stage: 'WAITING_ARCHIVE', version: 5 },
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { version: 6 } }),
    );
    expect(f.tx.caseClosurePaymentVersion.create).toHaveBeenCalledTimes(2);
    for (const call of f.tx.caseClosurePaymentVersion.create.mock.calls)
      expect(call[0].data).toMatchObject({
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    expect(result.recordedAt).toBe('2026-01-01T00:00:00.000Z');

    for (const [i, p] of input.paymentRecords.entries())
      expect(
        f.tx.caseClosurePaymentVersion.create.mock.calls[i]?.[0],
      ).toMatchObject({
        data: {
          amount: p.amount,
          payer: p.payer,
          payee: p.payee,
          revision: 1,
          state: 'ACTIVE',
        },
      });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        category: 'CASE_CLOSURE_PAYMENT_PROOF',
        contentVersionIds: [
          input.paymentRecords[1]!.screenshotContentVersionId,
        ],
      }),
    );
    const early = f.tx.caseEarlyClosureReceipt.create.mock.calls[0]?.[0] as {
      data: { requestFingerprint: string; idempotencyKey: string };
    };
    const closure = f.tx.caseClosureReceipt.create.mock.calls[0]?.[0] as {
      data: { requestFingerprint: string; idempotencyKey: string };
    };
    expect(early.data.requestFingerprint).toBe(closure.data.requestFingerprint);
    expect(early.data.idempotencyKey).toBe(closure.data.idempotencyKey);
    const children = f.tx.caseClosurePaymentReceipt.create.mock.calls.map(
      (call) =>
        (call[0] as { data: { idempotencyKey: string } }).data.idempotencyKey,
    );
    expect(new Set(children).size).toBe(2);
    const paymentIds = f.tx.caseClosurePaymentVersion.create.mock.calls.map(
      (call) => call[0].data.id,
    );
    for (const [
      i,
      call,
    ] of f.tx.caseClosurePaymentReceipt.create.mock.calls.entries()) {
      const receipt = call[0].data;
      const audit = f.tx.auditEvent.create.mock.calls.find(
        (auditCall) => auditCall[0].data.id === receipt.auditEventId,
      )![0].data;
      expect(audit.resourceId).toBe(paymentIds[i]);
      expect(audit.details).toEqual({
        authorizationRevision: actor.authorizationRevision,
        caseId,
        closureVersionId: result.closureVersionId,
        paymentVersionId: paymentIds[i],
        ...input.paymentRecords[i],
        fingerprint: receipt.requestFingerprint,
        result: receipt.resultSnapshot,
      });
      expect(receipt.requestFingerprint).toBe(early.data.requestFingerprint);
      expect(receipt.resultSnapshot).toEqual({
        versionId: paymentIds[i],
        stage: 'WAITING_ARCHIVE',
        reviewRequired: true,
        review: {
          caseId,
          stage: 'WAITING_ARCHIVE',
          closureVersionId: result.closureVersionId,
          closureAmount: '10.00',
          effectivePaymentVersionIds: paymentIds,
          effectiveAmounts: ['4.00', '6.00'],
          financialReadiness: 'UNKNOWN',
        },
      });
    }
    expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SET CONSTRAINTS ALL IMMEDIATE',
    );
  });
  it('replays the exact original final response and rejects a changed payload under the same key', async () => {
    const f = fixture();
    const command = {
      ...input,
      closeContentVersionIds: ['c5555555-5555-4555-8555-555555555555'],
    };
    const first = await f.service.record(actor, caseId, command);
    const sourceReceipt =
      f.tx.caseEarlyClosureReceipt.create.mock.calls[0]![0].data;
    const source = f.tx.caseEarlyClosure.create.mock.calls[0]![0].data;
    const recordedSourceAudit = f.tx.auditEvent.create.mock.calls.find(
      (call) => call[0].data.id === source.auditEventId,
    )![0].data;
    expect(recordedSourceAudit.details.authorizationRevision).toBe(
      actor.authorizationRevision,
    );
    const version = f.tx.caseClosureVersion.create.mock.calls[0]![0].data;
    const finalReceipt = f.tx.caseClosureReceipt.create.mock.calls[0]![0].data;
    f.tx.caseEarlyClosureReceipt.findUnique.mockResolvedValue(sourceReceipt);
    f.tx.caseEarlyClosure.findUnique.mockResolvedValue(source);
    f.tx.caseClosureVersion.findFirst.mockResolvedValue({
      ...version,
      closeAmt: new Prisma.Decimal('10.00'),
      finishId: null,
      externalEntryId: null,
    });
    f.tx.caseClosureReceipt.findUnique.mockResolvedValue(finalReceipt);
    f.tx.auditEvent.findMany.mockResolvedValue(
      f.tx.auditEvent.create.mock.calls.map((call) => ({
        ...call[0].data,
        actorKind: 'HUMAN',
        customerAccountBindingId: null,
        lawyerAccountBindingId: null,
        notaryOfficeAccountBindingId: null,
      })),
    );
    const paymentRows = f.tx.caseClosurePaymentVersion.create.mock.calls.map(
      (call, i) => ({
        ...call[0].data,
        amount: new Prisma.Decimal(command.paymentRecords[i]!.amount),
        documents:
          command.paymentRecords[i]!.screenshotContentVersionId === null
            ? []
            : [
                {
                  paymentVersionId: call[0].data.id,
                  caseId,
                  departmentId: actor.departmentId,
                  materialId: 'payment-material',
                  contentVersionId:
                    command.paymentRecords[i]!.screenshotContentVersionId,
                },
              ],
      }),
    );
    f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue(paymentRows);
    const childRows = f.tx.caseClosurePaymentReceipt.create.mock.calls.map(
      (call) => call[0].data,
    );
    f.tx.caseClosurePaymentReceipt.findUnique.mockImplementation(
      async (arg: {
        where: {
          departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
        };
      }) =>
        childRows.find(
          (child) =>
            child.idempotencyKey ===
            arg.where.departmentId_actorUserId_idempotencyKey.idempotencyKey,
        ) ?? null,
    );
    const documents = [
      {
        caseId,
        departmentId: actor.departmentId,
        closureVersionId: first.closureVersionId,
        materialId: 'document-material',
        contentVersionId: command.closeContentVersionIds[0],
      },
    ];
    f.tx.caseClosureDocument.findMany.mockResolvedValue(documents);
    const references = [
      ...documents.map((d) => ({
        departmentId: actor.departmentId,
        assetVersionId: null,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'CASE_CLOSURE_DOCUMENT',
        materialId: d.materialId,
        contentVersionId: d.contentVersionId,
        actionEventId: version.auditEventId,
      })),
      ...paymentRows.flatMap((p) =>
        p.documents.map(
          (d: { materialId: string; contentVersionId: string | null }) => ({
            departmentId: actor.departmentId,
            assetVersionId: null,
            resourceType: 'case-closure-payment-version',
            resourceId: p.id,
            purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
            materialId: d.materialId,
            contentVersionId: d.contentVersionId,
            actionEventId: p.auditEventId,
          }),
        ),
      ),
    ];
    f.tx.materialReference.findMany.mockResolvedValue(references);
    const count = f.tx.case.updateMany.mock.calls.length;
    await expect(
      f.service.record(actor, caseId.toUpperCase(), uppercase(command)),
    ).resolves.toEqual(first);
    expect(f.tx.case.updateMany).toHaveBeenCalledTimes(count);
    await expect(
      f.service.record({ ...actor, authorizationRevision: 2 }, caseId, command),
    ).resolves.toEqual(first);
    expect(f.access.authorizeCase).toHaveBeenLastCalledWith(
      { ...actor, authorizationRevision: 2 },
      'case.closure.record',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      f.tx,
    );
    const legacyAudits = f.tx.auditEvent.create.mock.calls.map((call) => {
      const row = call[0].data;
      if (row.id !== source.auditEventId)
        return {
          ...row,
          actorKind: 'HUMAN',
          customerAccountBindingId: null,
          lawyerAccountBindingId: null,
          notaryOfficeAccountBindingId: null,
        };
      const details = { ...row.details };
      delete details.authorizationRevision;
      return {
        ...row,
        details,
        actorKind: 'HUMAN',
        customerAccountBindingId: null,
        lawyerAccountBindingId: null,
        notaryOfficeAccountBindingId: null,
      };
    });
    f.tx.auditEvent.findMany.mockResolvedValue(legacyAudits);
    await expect(f.service.record(actor, caseId, command)).resolves.toEqual(
      first,
    );
    const legacySource = legacyAudits.find(
      (row) => row.id === source.auditEventId,
    )!;
    legacySource.details.authorizationRevision = 0;
    await expect(f.service.record(actor, caseId, command)).rejects.toThrow();
    delete legacySource.details.authorizationRevision;
    const denied = new Error('current permission revoked');
    const receiptReads =
      f.tx.caseEarlyClosureReceipt.findUnique.mock.calls.length;
    f.access.authorizeCase.mockRejectedValueOnce(denied);
    await expect(f.service.record(actor, caseId, command)).rejects.toBe(denied);
    expect(f.tx.caseEarlyClosureReceipt.findUnique).toHaveBeenCalledTimes(
      receiptReads,
    );
    const originalChild = childRows[0]!;
    f.tx.caseClosurePaymentReceipt.findUnique.mockImplementation(
      async (arg: {
        where: {
          departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
        };
      }) => {
        const child = childRows.find(
          (item) =>
            item.idempotencyKey ===
            arg.where.departmentId_actorUserId_idempotencyKey.idempotencyKey,
        );
        return child === originalChild
          ? { ...child, auditEventId: 'wrong-audit' }
          : child;
      },
    );
    await expect(
      f.service.record(actor, caseId, command),
    ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });
    f.tx.caseClosurePaymentReceipt.findUnique.mockImplementation(
      async (arg: {
        where: {
          departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
        };
      }) =>
        childRows.find(
          (child) =>
            child.idempotencyKey ===
            arg.where.departmentId_actorUserId_idempotencyKey.idempotencyKey,
        ) ?? null,
    );
    f.tx.caseClosurePaymentReceipt.findUnique.mockImplementation(
      async (arg: {
        where: {
          departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
        };
      }) => {
        const child = childRows.find(
          (item) =>
            item.idempotencyKey ===
            arg.where.departmentId_actorUserId_idempotencyKey.idempotencyKey,
        );
        return child === originalChild
          ? { ...child, resultSnapshot: {} }
          : child;
      },
    );
    await expect(
      f.service.record(actor, caseId, command),
    ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });
    f.tx.caseClosurePaymentReceipt.findUnique.mockImplementation(
      async (arg: {
        where: {
          departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
        };
      }) =>
        childRows.find(
          (child) =>
            child.idempotencyKey ===
            arg.where.departmentId_actorUserId_idempotencyKey.idempotencyKey,
        ) ?? null,
    );
    f.tx.materialReference.findMany.mockResolvedValue(
      references.map((r, i) =>
        i === 0 ? { ...r, materialId: 'cross-case-material' } : r,
      ),
    );
    await expect(
      f.service.record(actor, caseId, command),
    ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });
    f.tx.materialReference.findMany.mockResolvedValue(references);
    const auditRows = f.tx.auditEvent.create.mock.calls.map((call) => ({
      ...call[0].data,
      actorKind: 'HUMAN',
      customerAccountBindingId: null,
      lawyerAccountBindingId: null,
      notaryOfficeAccountBindingId: null,
    }));
    for (const patch of [
      { action: 'case.closure.recorded' },
      { resourceType: 'CASE' },
      { resourceId: caseId },
    ]) {
      f.tx.auditEvent.findMany.mockResolvedValue(
        auditRows.map((a, i) => (i === 2 ? { ...a, ...patch } : a)),
      );
      await expect(
        f.service.record(actor, caseId, command),
      ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });
    }
    const paymentAudit = auditRows[2]!;
    for (const details of [
      ...[undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(
        (authorizationRevision) => ({
          ...paymentAudit.details,
          authorizationRevision,
        }),
      ),
      { ...paymentAudit.details, fingerprint: '0'.repeat(64) },
      { ...paymentAudit.details, result: {} },
      {
        ...input.paymentRecords[0],
        caseId,
        closureVersionId: first.closureVersionId,
        paymentVersionId: paymentRows[0]!.id,
      },
    ]) {
      f.tx.auditEvent.findMany.mockResolvedValue(
        auditRows.map((a, i) => (i === 2 ? { ...a, details } : a)),
      );
      await expect(
        f.service.record(actor, caseId, command),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_RECEIPT' },
      });
    }
    f.tx.auditEvent.findMany.mockResolvedValue(
      auditRows.map((a, i) => (i === 2 ? { ...a, details: {} } : a)),
    );
    await expect(
      f.service.record(actor, caseId, command),
    ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });

    await expect(
      f.service.record(actor, caseId, { ...command, closeAmt: '11' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it('normalizes uppercase case, document and screenshot UUIDs before hashing or validation queries', async () => {
    const a = fixture(),
      b = fixture();
    const command = {
      ...input,
      closeContentVersionIds: ['c5555555-5555-4555-8555-555555555555'],
    };
    await a.service.record(actor, caseId, command);
    const result = await b.service.record(
      actor,
      caseId.toUpperCase(),
      uppercase(command),
    );
    expect(result.id).toBe(caseId);
    expect(b.materials.assertAvailableVersions).toHaveBeenCalledWith(
      b.tx,
      actor,
      expect.objectContaining({
        ownerId: caseId,
        contentVersionIds: command.closeContentVersionIds,
      }),
    );
    expect(b.materials.assertAvailableVersions).toHaveBeenCalledWith(
      b.tx,
      actor,
      expect.objectContaining({
        ownerId: caseId,
        contentVersionIds: [
          input.paymentRecords[1]!.screenshotContentVersionId,
        ],
      }),
    );
    expect(
      a.tx.caseEarlyClosureReceipt.create.mock.calls[0]![0].data
        .requestFingerprint,
    ).toBe(
      b.tx.caseEarlyClosureReceipt.create.mock.calls[0]![0].data
        .requestFingerprint,
    );
  });
  it('propagates authorization denial before writing business facts', async () => {
    const f = fixture(),
      error = new Error('authorization denied');
    f.access.authorizeCase.mockRejectedValue(error);
    await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });
  it.each([1, 2])(
    'rejects a failed CAS at step %s without a final success receipt',
    async (step) => {
      const f = fixture();
      if (step === 2) f.tx.case.updateMany.mockResolvedValueOnce({ count: 1 });
      f.tx.case.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        f.service.record(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.tx.caseClosureReceipt.create).not.toHaveBeenCalled();
    },
  );
  it('propagates final deferred constraint failure without returning success', async () => {
    const f = fixture(),
      error = new Error('deferred constraint rejected');
    f.tx.$executeRawUnsafe.mockRejectedValue(error);
    await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
  it('propagates the existing source gate error and performs no later writes', async () => {
    const f = fixture();
    const error = new Error('early closure source is not enabled');
    f.tx.caseEarlyClosure.create.mockRejectedValue(error);
    await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseClosurePaymentVersion.create).not.toHaveBeenCalled();
  });
  it('propagates a screenshot freeze error and does not create final command receipt', async () => {
    const f = fixture();
    const error = new Error('invalid screenshot');
    f.materials.freezeCaseClosurePaymentReferences.mockRejectedValue(error);
    await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
    expect(f.tx.caseClosureReceipt.create).not.toHaveBeenCalled();
  });
  it('rejects external actors, zero payments and unknown request fields before transactions', async () => {
    const f = fixture();
    await expect(
      f.service.record({ ...actor, lawyerAccountId: caseId }, caseId, input),
    ).rejects.toThrow();
    await expect(
      f.service.record(actor, caseId, {
        ...input,
        paymentRecords: [{ ...input.paymentRecords[0]!, amount: '0' }],
      }),
    ).rejects.toThrow();
    await expect(
      f.service.record(actor, caseId, {
        ...input,
        extra: true,
      } as RecordEarlyClosureInput),
    ).rejects.toThrow();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('retries serialization conflicts, without swallowing business or gate errors', async () => {
    const f = fixture();
    f.transaction.mockRejectedValueOnce({ code: 'P2034' });
    await f.service.record(actor, caseId, input);
    expect(f.transaction).toHaveBeenCalledTimes(2);
  });
});

describe('early closure confirmed permission OR', () => {
  it.each([
    { actions: ['case.closure.record'] as const },
    { actions: ['case.archive'] as const },
    { actions: ['case.closure.record', 'case.archive'] as const },
  ])(
    'accepts $actions for the assigned operator but still only reaches WAITING_ARCHIVE',
    async ({ actions }) => {
      const f = fixture();
      const realAccess = new AccessControlService({
        loadSnapshot: async () => ({
          active: true,
          authorizationRevision: 1,
          grants: [
            { action: 'case.read', scope: 'department' as const },
            ...actions.map((action) => ({ action, scope: 'self' as const })),
          ],
        }),
      });
      f.access.authorizeCase.mockImplementation(
        (...args: Parameters<AccessControlService['authorizeCase']>) =>
          realAccess.authorizeCase(...args),
      );
      await expect(
        f.service.record(actor, caseId, input),
      ).resolves.toMatchObject({ stage: 'WAITING_ARCHIVE', version: 6 });
      expect(f.tx.case.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stage: 'WAITING_ARCHIVE', version: 5 },
        }),
      );
      expect(f.access.authorizeCase).toHaveBeenCalledWith(
        actor,
        actions.some((action) => action === 'case.closure.record')
          ? 'case.closure.record'
          : 'case.archive',
        expect.objectContaining({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        }),
        f.tx,
      );
    },
  );
  it.each(['neither', 'no-read', 'out-of-scope'] as const)(
    'rejects %s with real action/scope checks before any early fact write',
    async (reason) => {
      const f = fixture();
      const grants =
        reason === 'neither'
          ? [{ action: 'case.read' as const, scope: 'department' as const }]
          : reason === 'no-read'
            ? [{ action: 'case.archive' as const, scope: 'self' as const }]
            : [
                { action: 'case.read' as const, scope: 'department' as const },
                {
                  action: 'case.archive' as const,
                  scope: 'team' as const,
                  teamId: 'foreign-team',
                },
              ];
      const realAccess = new AccessControlService({
        loadSnapshot: async () => ({
          active: true,
          authorizationRevision: 1,
          grants,
        }),
      });
      f.access.authorizeCase.mockImplementation(
        (...args: Parameters<AccessControlService['authorizeCase']>) =>
          realAccess.authorizeCase(...args),
      );
      await expect(
        f.service.record(actor, caseId, input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.tx.caseEarlyClosure.create).not.toHaveBeenCalled();
      expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    },
  );
  it('requires a department-scoped action for another owner', async () => {
    const f = fixture();
    f.access.authorizeDepartmentProxyAction.mockRejectedValue(
      new ForbiddenException(),
    );
    f.tx.case.findFirst.mockResolvedValue({
      stage: 'WAITING_HEARING',
      version: 4,
      responsibleUserId: 'another-user',
      responsibleMembership: { teamId: null },
      consolidationMembership: null,
    });
    await expect(f.service.record(actor, caseId, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.access.authorizeDepartmentProxyAction).toHaveBeenCalledWith(
      actor,
      'case.closure.record',
      { departmentId: actor.departmentId },
      f.tx,
    );
    expect(f.tx.caseEarlyClosure.create).not.toHaveBeenCalled();
  });
  it('allows a colleague with department closure authorization and records proxy audit', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      stage: 'WAITING_HEARING',
      version: 4,
      responsibleUserId: 'another-user',
      responsibleMembership: { teamId: null },
      consolidationMembership: null,
    });
    await expect(f.service.record(actor, caseId, input)).resolves.toMatchObject(
      {
        stage: 'WAITING_ARCHIVE',
      },
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'case.proxy.applied',
        actorUserId: actor.userId,
        details: expect.objectContaining({
          responsibleUserId: 'another-user',
          action: 'case.closure.record',
          scope: 'DEPARTMENT',
        }),
      }),
    });
  });
  it('uses department archive when a narrower closure grant cannot proxy', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      stage: 'WAITING_HEARING',
      version: 4,
      responsibleUserId: 'another-user',
      responsibleMembership: { teamId: null },
      consolidationMembership: null,
    });
    f.access.authorizeDepartmentProxyAction.mockImplementation(
      async (_actor, action) => {
        if (action === 'case.closure.record') throw new ForbiddenException();
      },
    );
    await expect(f.service.record(actor, caseId, input)).resolves.toMatchObject(
      {
        stage: 'WAITING_ARCHIVE',
      },
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'case.proxy.applied',
        details: expect.objectContaining({ action: 'case.archive' }),
      }),
    });
  });
  it('keeps the department-scoped locked lookup; no cross-department permission fallback', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT id FROM cases') ? [] : [{ id: actor.userId }],
    );
    await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
      status: 404,
      response: { code: 'CASE_NOT_FOUND' },
    });
    expect(f.tx.case.findFirst).not.toHaveBeenCalled();
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.tx.caseEarlyClosureReceipt.findUnique).not.toHaveBeenCalled();
    expect(f.tx.caseEarlyClosure.create).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('does not treat a non-forbidden authorization error as a reason to try archive', async () => {
    const f = fixture(),
      error = new Error('snapshot unavailable');
    f.access.authorizeCase.mockImplementation(async (_actor, action) => {
      if (action === 'case.closure.record') throw error;
    });
    await expect(f.service.record(actor, caseId, input)).rejects.toBe(error);
    expect(
      f.access.authorizeCase.mock.calls.some(
        (call) => call[1] === 'case.archive',
      ),
    ).toBe(false);
    expect(f.tx.caseEarlyClosure.create).not.toHaveBeenCalled();
  });
});

it('returns404 for a missing scoped projection after lock without permissions, receipt lookup or writes', async () => {
  const f = fixture();
  f.tx.case.findFirst.mockResolvedValueOnce(null);
  await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
    status: 404,
    response: { code: 'CASE_NOT_FOUND' },
  });
  expect(f.tx.case.findFirst).toHaveBeenCalledTimes(1);
  expect(f.access.authorizeCase).not.toHaveBeenCalled();
  expect(f.tx.caseEarlyClosureReceipt.findUnique).not.toHaveBeenCalled();
  expect(f.tx.caseEarlyClosure.create).not.toHaveBeenCalled();
  expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
});
