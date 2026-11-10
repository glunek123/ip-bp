import type { DatabaseService } from '../../database/database.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { Prisma } from '../../generated/prisma/client';
import { CaseClosureSettlementUpdateTransactionDraftService } from './case-closure-settlement-update-transaction-draft.service';
import type { UpdateClosureSettlementInput } from './case-closure-settlement-update.dto';
jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(),
}));
jest.mock('./case-entry-source', () => ({
  readCaseSourceAnchor: jest.fn().mockResolvedValue({ kind: 'NORMAL' }),
}));
jest.mock('./case-execution-source', () => ({
  assertExecutionSourceChain: jest
    .fn()
    .mockResolvedValue({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
}));
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = 'a3333333-3333-4333-8333-333333333333';
const priorId = 'b4444444-4444-4444-8444-444444444444';
const docId = 'c5555555-5555-4555-8555-555555555555';
const refundId = 'd6666666-6666-4666-8666-666666666666';
const assessmentId = 'f7777777-7777-4777-8777-777777777777';
const value = (): UpdateClosureSettlementInput => ({
  expectedVersion: 6,
  expectedClosureVersionId: priorId,
  idempotencyKey: 'update-1',
  closeAt: '2026-01-01',
  closeAmountState: 'KNOWN',
  closeAmt: '10.00',
  closeContentVersionIds: [docId],
  paymentType: 'INSTALLMENTS',
  correctionReason: null,
  paymentRecords: [
    {
      paidOn: '2026-01-01',
      amount: '4.00',
      payer: '甲',
      payee: '乙',
      screenshotContentVersionId: docId,
    },
    {
      paidOn: '2026-01-01',
      amount: '6.00',
      payer: '丙',
      payee: '乙',
      screenshotContentVersionId: null,
    },
  ],
  refund: {
    expectedVersionId: null,
    kind: 'DECLARE_NOT_APPLICABLE',
    items: [],
  },
  settlement: {
    expectedAssessmentVersionId: null,
    expectedTermsVersion: 2,
    declaration: 'APPLICABLE',
  },
});
function fixture() {
  const create = () =>
    jest.fn().mockImplementation(async ({ data }: { data: unknown }) => data);
  const head = {
    id: '99999999-9999-4999-8999-999999999999',
    earlyClosureId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    finishId: null,
    externalEntryId: null,
    currentVersionId: priorId,
    currentVersion: {
      id: priorId,
      toVersion: 6,
      closeAt: new Date('2026-01-01T00:00:00.000Z'),
      earlyClosureId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      finishId: null,
      externalEntryId: null,
      note: '保留历史备注',
    },
  };
  const current = {
    stage: 'WAITING_ARCHIVE',
    version: 6,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    consolidationMembership: null,
    closure: head,
    executionFinish: null,
  };
  const tx = {
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('CURRENT_TIMESTAMP')
          ? [{ recordedAt: new Date('2026-01-02T00:00:00.000Z') }]
          : sql.includes('SELECT p.id')
            ? []
            : sql.includes(' AS valid')
              ? [{ valid: true }]
              : [{ id: caseId }],
      ),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    case: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseSettlementTerms: {
      findUnique: jest.fn().mockResolvedValue({
        caseId,
        departmentId: actor.departmentId,
        version: 2,
        customerManualAmount: new Prisma.Decimal('1.23'),
        lawyerManualAmount: new Prisma.Decimal('4.56'),
      }),
      update: jest.fn().mockResolvedValue({ version: 3 }),
      create: jest.fn().mockResolvedValue({ version: 1 }),
    },
    caseClosure: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    caseClosureVersion: { create: create(), findUnique: jest.fn() },
    caseClosureRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    caseClosureReceipt: { create: create(), findUnique: jest.fn() },
    caseClosurePaymentVersion: { create: create(), findUnique: jest.fn() },
    caseClosurePaymentReceipt: { create: create(), findUnique: jest.fn() },
    caseClosureSettlementUpdateReceipt: {
      create: create(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    caseClosureSettlementUpdatePayment: { create: create() },
    caseClosureDocument: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ contentVersionId: docId, materialId: docId }]),
    },
    materialReference: { findMany: jest.fn() },
    auditEvent: { create: create(), findUnique: jest.fn() },
  };
  const transaction = jest
    .fn()
    .mockImplementation(async (work: (client: unknown) => Promise<unknown>) =>
      work(tx),
    );
  const access = {
    authorizeDepartmentAction: jest.fn(),
    authorizeDepartmentProxyAction: jest.fn(),
    authorizeCase: jest.fn(),
  };
  const materials = {
    assertSettlementUpdateDocumentVersions: jest
      .fn()
      .mockImplementation(
        async (
          _tx: unknown,
          _actor: unknown,
          _case: unknown,
          _closure: unknown,
          ids: string[],
        ) =>
          ids.map((id) => ({
            materialId: 'material-' + id,
            contentVersionId: id,
          })),
      ),
    assertAvailableVersions: jest
      .fn()
      .mockResolvedValue([{ materialId: docId, contentVersionId: docId }]),
    freezeCaseClosureReferences: jest.fn(),
    freezeCaseClosurePaymentReferences: jest.fn(),
  };
  const refunds = {
    executeInTransaction: jest
      .fn()
      .mockResolvedValue({ snapshot: { id: refundId } }),
  };
  const assessments = {
    executeInTransaction: jest.fn().mockResolvedValue({ id: assessmentId }),
  };
  const service = new CaseClosureSettlementUpdateTransactionDraftService(
    { $transaction: transaction } as unknown as DatabaseService,
    access as unknown as AccessControlService,
    {} as OrganizationService,
    materials,
    refunds,
    assessments,
  );
  const replay = () => {
    const receipt =
      tx.caseClosureSettlementUpdateReceipt.create.mock.calls[0]![0].data;
    const version = tx.caseClosureVersion.create.mock.calls[0]![0].data;
    const closureReceipt = tx.caseClosureReceipt.create.mock.calls[0]![0].data;
    tx.caseClosureSettlementUpdateReceipt.findUnique.mockResolvedValue({
      ...receipt,
      payments: tx.caseClosureSettlementUpdatePayment.create.mock.calls.map(
        ([arg]) => arg.data,
      ),
    });
    tx.caseClosureVersion.findUnique.mockResolvedValue({
      ...version,
      closeAmt: new Prisma.Decimal('10.00'),
    });
    tx.caseClosureReceipt.findUnique.mockResolvedValue(closureReceipt);
    tx.caseClosurePaymentVersion.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        const data = tx.caseClosurePaymentVersion.create.mock.calls
          .map(([a]) => a.data)
          .find((p) => p.id === where.id);
        return {
          ...data,
          priorVersionId: null,
          amount: new Prisma.Decimal(data.amount),
          documents:
            data.id ===
            tx.caseClosurePaymentVersion.create.mock.calls[0]![0].data.id
              ? [{ contentVersionId: docId, materialId: docId }]
              : [],
        };
      },
    );
    tx.caseClosurePaymentReceipt.findUnique.mockImplementation(
      async ({ where }: { where: { paymentVersionId: string } }) =>
        tx.caseClosurePaymentReceipt.create.mock.calls
          .map(([a]) => a.data)
          .find((p) => p.paymentVersionId === where.paymentVersionId),
    );
    tx.auditEvent.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        actorKind: 'HUMAN',
        ...tx.auditEvent.create.mock.calls
          .map(([a]) => a.data)
          .find((p) => p.id === where.id),
      }),
    );
    tx.materialReference.findMany.mockResolvedValue([
      {
        assetVersionId: null,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'CASE_CLOSURE_DOCUMENT',
        materialId: docId,
        contentVersionId: docId,
        actionEventId: version.auditEventId,
      },
      {
        assetVersionId: null,
        resourceType: 'case-closure-payment-version',
        resourceId:
          tx.caseClosurePaymentVersion.create.mock.calls[0]![0].data.id,
        purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
        materialId: docId,
        contentVersionId: docId,
        actionEventId:
          tx.caseClosurePaymentVersion.create.mock.calls[0]![0].data
            .auditEventId,
      },
    ]);
  };
  return {
    service,
    tx,
    transaction,
    access,
    materials,
    refunds,
    assessments,
    current,
    head,
    replay,
  };
}
describe('atomic settlement update transaction draft (mock database only)', () => {
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
    await f.service.update(actor, caseId, value());
    expect(f.transaction).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['40001', 3],
    ['23514', 1],
    ['23505', 3],
  ] as const)(
    'preserves original adapter error %s and the transaction attempt limit',
    async (originalCode, attempts) => {
      const f = fixture();
      const error = {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode } } },
      };
      f.transaction.mockRejectedValue(error);
      await expect(f.service.update(actor, caseId, value())).rejects.toBe(
        error,
      );
      expect(f.transaction).toHaveBeenCalledTimes(attempts);
    },
  );

  it('requires closure correction permission before writing the composite command', async () => {
    const f = fixture();
    f.access.authorizeCase.mockImplementation(async (_actor, action) => {
      if (action !== 'case.read') throw new Error('no correction grant');
    });
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow(
      'no correction grant',
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.read',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      },
      f.tx,
    );
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it('denies another responsible operator without the financial proxy grant', async () => {
    const f = fixture();
    f.current.responsibleUserId = docId;
    f.access.authorizeDepartmentProxyAction.mockRejectedValue(
      new Error('missing department grant'),
    );
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow();
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
  });
  it('allows the financial composite for a colleague with the independent department grant', async () => {
    const f = fixture();
    f.current.responsibleUserId = docId;
    await expect(
      f.service.update(actor, caseId, value()),
    ).resolves.toMatchObject({
      stage: 'WAITING_ARCHIVE',
    });
    expect(f.access.authorizeDepartmentProxyAction).toHaveBeenCalledWith(
      actor,
      'case.closure.settlement.update',
      { departmentId: actor.departmentId },
      f.tx,
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'case.proxy.applied',
        details: expect.objectContaining({
          responsibleUserId: docId,
          scope: 'DEPARTMENT',
        }),
      }),
    });
  });
  it.each([
    ['date', { closeAt: '2026-01-02' }],
    ['closure documents', { closeContentVersionIds: [] }],
  ])(
    'requires the original correction grant when a financial proxy changes %s',
    async (_label, changed) => {
      const f = fixture();
      f.current.responsibleUserId = docId;
      f.access.authorizeCase.mockImplementation(async (_actor, action) => {
        if (action === 'case.closure.correct')
          throw new Error('no correction grant');
      });
      await expect(
        f.service.update(actor, caseId, { ...value(), ...changed }),
      ).rejects.toThrow('no correction grant');
      expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );
  it('allows a non-owner with case-scoped correction permission to correct closure alone', async () => {
    const f = fixture(),
      input = value();
    f.current.responsibleUserId = docId;
    input.paymentRecords = [];
    delete input.refund;
    delete input.settlement;
    await f.service.update(actor, caseId, input);
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.closure.correct',
      { departmentId: actor.departmentId, responsibleUserId: docId },
      f.tx,
    );
    expect(f.tx.caseClosureVersion.create).toHaveBeenCalledTimes(1);
  });
  it('does not turn the financial proxy grant into a closure-only correction grant', async () => {
    const f = fixture();
    const input = value();
    f.current.responsibleUserId = docId;
    input.paymentRecords = [];
    delete input.refund;
    delete input.settlement;
    f.access.authorizeCase.mockImplementation(async (_actor, action) => {
      if (action === 'case.closure.correct')
        throw new Error('no correction grant');
    });
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow(
      'no correction grant',
    );
    expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalledWith(
      actor,
      'case.closure.settlement.update',
      f.tx,
    );
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
  });
  it('saves both manual amounts to cents once and assesses the new locked terms version without a financial grant', async () => {
    const f = fixture(),
      input = value();
    input.settlement!.customerAmount = { mode: 'MANUAL', amount: '12.34' };
    input.settlement!.lawyerAmount = { mode: 'MANUAL', amount: '0.01' };
    const result = await f.service.update(actor, caseId, input);
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledTimes(1);
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledWith({
      where: { caseId },
      data: {
        customerManualAmount: '12.34',
        lawyerManualAmount: '0.01',
        version: { increment: 1 },
      },
    });
    expect(result.settlementTermsChange).toMatchObject({
      before: {
        version: 2,
        customerManualAmount: '1.23',
        lawyerManualAmount: '4.56',
      },
      after: {
        version: 3,
        customerManualAmount: '12.34',
        lawyerManualAmount: '0.01',
      },
    });
    expect(f.assessments.executeInTransaction.mock.calls[0]![3]).toMatchObject({
      expectedTermsVersion: 3,
    });
    expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalledWith(
      actor,
      'settlement.terms.update',
      expect.anything(),
    );
    f.replay();
    expect(await f.service.update(actor, caseId, input)).toEqual(result);
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledTimes(1);
    input.settlement!.customerAmount.amount = '12.35';
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow();
  });
  it('clears only the automatic side and preserves an omitted side including its previous manual cents', async () => {
    const f = fixture(),
      input = value();
    input.settlement!.customerAmount = { mode: 'AUTOMATIC' };
    const result = await f.service.update(actor, caseId, input);
    expect(result.settlementTermsChange?.after).toEqual({
      version: 3,
      customerManualAmount: null,
      lawyerManualAmount: '4.56',
    });
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledWith({
      where: { caseId },
      data: {
        customerManualAmount: null,
        lawyerManualAmount: '4.56',
        version: { increment: 1 },
      },
    });
  });
  it('treats omitted and explicit KEEP as identical and does not advance terms', async () => {
    const f = fixture(),
      input = value();
    const result = await f.service.update(actor, caseId, input);
    expect(result.settlementTermsChange).toBeNull();
    expect(f.tx.caseSettlementTerms.update).not.toHaveBeenCalled();
    f.replay();
    input.settlement!.customerAmount = { mode: 'KEEP' };
    input.settlement!.lawyerAmount = { mode: 'KEEP' };
    expect(await f.service.update(actor, caseId, input)).toEqual(result);
  });
  it('creates initial terms under the case lock and assesses version one', async () => {
    const f = fixture(),
      input = value();
    f.tx.caseSettlementTerms.findUnique.mockResolvedValue(null);
    input.settlement!.expectedTermsVersion = null;
    input.settlement!.lawyerAmount = { mode: 'MANUAL', amount: '0' };
    const result = await f.service.update(actor, caseId, input);
    expect(result.settlementTermsChange?.after).toEqual({
      version: 1,
      customerManualAmount: null,
      lawyerManualAmount: '0.00',
    });
    expect(f.assessments.executeInTransaction.mock.calls[0]![3]).toMatchObject({
      expectedTermsVersion: 1,
    });
  });
  it('replays a bootstrap save whose request carried no terms token', async () => {
    // 历史条款存在（v2）但从未生成评估：客户端拿不到令牌，只能送 null。
    // 首存成功后响应丢失，用同一请求键重放必须返回原回执，而不是 INVALID_RECEIPT。
    const f = fixture(),
      input = value();
    const base = f.tx.$queryRawUnsafe.getMockImplementation()!;
    f.tx.$queryRawUnsafe.mockImplementation(
      async (sql: string, ...args: unknown[]) =>
        // 只拦截"是否已存在评估"的探测；回执守卫的 child_link 校验同样包含
        // case_settlement_assessment_versions 文本，必须走原实现返回 valid。
        sql
          .trimStart()
          .startsWith('SELECT id FROM case_settlement_assessment_versions')
          ? []
          : base(sql, ...args),
    );
    input.settlement!.expectedTermsVersion = null;
    input.settlement!.customerAmount = { mode: 'MANUAL', amount: '7.77' };
    const result = await f.service.update(actor, caseId, input);
    expect(result.settlementTermsChange?.before).toMatchObject({ version: 2 });
    f.replay();
    await expect(f.service.update(actor, caseId, input)).resolves.toEqual(
      result,
    );
  });
  it('turns a refund inventory business rejection into a readable conflict', async () => {
    // 退费草稿服务用裸 Error('REFUND_INVENTORY_CHANGED') 表达业务拒绝，
    // 直接冒泡会变成 500；这里要求降级为 409 并保留业务码。
    const f = fixture(),
      input = value();
    f.refunds.executeInTransaction.mockRejectedValueOnce(
      new Error('REFUND_INVENTORY_CHANGED'),
    );
    await expect(f.service.update(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'REFUND_INVENTORY_CHANGED' },
      status: 409,
    });
  });

  it('rejects a stale terms version before assessment or successful receipt', async () => {
    const f = fixture(),
      input = value();
    input.settlement!.expectedTermsVersion = 1;
    input.settlement!.customerAmount = { mode: 'MANUAL', amount: '5.55' };
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow();
    expect(f.tx.caseSettlementTerms.update).not.toHaveBeenCalled();
    expect(f.assessments.executeInTransaction).not.toHaveBeenCalled();
    expect(
      f.tx.caseClosureSettlementUpdateReceipt.create,
    ).not.toHaveBeenCalled();
  });
  it('propagates a post-terms assessment failure without a successful total receipt', async () => {
    const f = fixture(),
      input = value();
    input.settlement!.customerAmount = { mode: 'MANUAL', amount: '5.55' };
    f.assessments.executeInTransaction.mockRejectedValue(
      new Error('ASSESSMENT_FAILED'),
    );
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow(
      'ASSESSMENT_FAILED',
    );
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledTimes(1);
    expect(
      f.tx.caseClosureSettlementUpdateReceipt.create,
    ).not.toHaveBeenCalled();
  });
  it('saves all fields, exact proof links, child composition and final receipt in one serializable transaction', async () => {
    const f = fixture(),
      input = value(),
      result = await f.service.update(actor, caseId, input);
    expect(f.transaction).toHaveBeenCalledTimes(1);
    const paymentAudits = f.tx.auditEvent.create.mock.calls
      .map(([call]) => call.data)
      .filter((a) => a.action === 'CASE_CLOSURE_PAYMENT_RECORD');
    expect(paymentAudits).toHaveLength(2);
    for (const audit of paymentAudits)
      expect(audit.details.authorizationRevision).toBe(
        actor.authorizationRevision,
      );
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(result).toMatchObject({
      stage: 'WAITING_ARCHIVE',
      version: 7,
      refundInventoryVersionId: refundId,
      settlementAssessmentVersionId: assessmentId,
    });
    expect(f.tx.caseClosureVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'CORRECT',
        priorVersionId: priorId,
        paymentType: 'INSTALLMENTS',
        closeAmt: '10.00',
        note: '保留历史备注',
        correctionReason: null,
        recordedAt: new Date(result.recordedAt),
      }),
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ stage: 'WAITING_ARCHIVE', version: 6 }),
      data: { version: 7 },
    });
    for (const [i, p] of input.paymentRecords.entries()) {
      expect(
        f.tx.caseClosurePaymentVersion.create.mock.calls[i]![0].data,
      ).toMatchObject({
        amount: p.amount,
        payer: p.payer,
        payee: p.payee,
        revision: 1,
        state: 'ACTIVE',
        closureVersionId: result.closureVersionId,
      });
      expect(
        f.tx.caseClosurePaymentReceipt.create.mock.calls[i]![0].data
          .requestFingerprint,
      ).toBe(
        f.tx.caseClosureSettlementUpdateReceipt.create.mock.calls[0]![0].data
          .requestFingerprint,
      );
    }
    expect(
      f.materials.freezeCaseClosurePaymentReferences,
    ).toHaveBeenNthCalledWith(
      1,
      f.tx,
      actor,
      caseId,
      result.paymentVersionIds[0],
      [{ materialId: docId, contentVersionId: docId }],
      expect.any(String),
    );
    expect(f.refunds.executeInTransaction).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        kind: 'DECLARE_NOT_APPLICABLE',
        items: [],
        expectedVersionId: null,
      }),
      expect.stringMatching(/^refund:/u),
      expect.any(Object),
    );
    expect(f.assessments.executeInTransaction).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({ declaration: 'APPLICABLE' }),
      expect.objectContaining({
        expectedTermsVersion: 2,
        expectedAssessmentVersionId: null,
      }),
    );
    expect(f.tx.$executeRawUnsafe).toHaveBeenLastCalledWith(
      'SET CONSTRAINTS ALL IMMEDIATE',
    );
  });
  it('preserves omitted children and does not infer not-applicable', async () => {
    const f = fixture(),
      input = value();
    delete input.refund;
    delete input.settlement;
    expect(await f.service.update(actor, caseId, input)).toMatchObject({
      refundInventoryVersionId: null,
      settlementAssessmentVersionId: null,
    });
    expect(f.refunds.executeInTransaction).not.toHaveBeenCalled();
    expect(f.assessments.executeInTransaction).not.toHaveBeenCalled();
  });
  it.each(['ARCHIVED', 'WAITING_HEARING'])(
    'rejects stage %s before writing',
    async (stage) => {
      const f = fixture();
      f.current.stage = stage;
      await expect(f.service.update(actor, caseId, value())).rejects.toThrow();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );
  it('rejects stale case and closure expected versions before writing', async () => {
    const f = fixture(),
      input = value();
    input.expectedClosureVersionId = refundId;
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow();
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
  });
  it('counts pre-existing effective payments when switching to ONE_TIME', async () => {
    const f = fixture(),
      input = value();
    input.paymentType = 'ONE_TIME';
    input.paymentRecords = input.paymentRecords.slice(0, 1);
    f.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes('SELECT p.id')
        ? [{ id: refundId, amount: '1.00' }]
        : [{ id: caseId }],
    );
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow();
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
  });
  it('propagates child conflicts without creating a successful total receipt', async () => {
    const f = fixture();
    f.assessments.executeInTransaction.mockRejectedValue(
      new Error('SETTLEMENT_TERMS_VERSION_CONFLICT'),
    );
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow(
      'SETTLEMENT_TERMS_VERSION_CONFLICT',
    );
    expect(
      f.tx.caseClosureSettlementUpdateReceipt.create,
    ).not.toHaveBeenCalled();
  });
  it('propagates deferred constraint failure, never returning a success', async () => {
    const f = fixture();
    f.tx.$executeRawUnsafe.mockRejectedValue(new Error('gate closed'));
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow(
      'gate closed',
    );
  });
  it('replays the original snapshot after current stage/version change without repeating children', async () => {
    const f = fixture(),
      input = value(),
      first = await f.service.update(actor, caseId, input);
    f.replay();
    f.current.stage = 'ARCHIVED';
    f.current.version = 20;
    expect(await f.service.update(actor, caseId, input)).toEqual(first);
    expect(f.refunds.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(f.tx.caseClosureVersion.create).toHaveBeenCalledTimes(1);
  });
  it('rejects changed complete request under the original key', async () => {
    const f = fixture(),
      input = value();
    await f.service.update(actor, caseId, input);
    f.replay();
    input.settlement!.expectedTermsVersion = 3;
    await expect(f.service.update(actor, caseId, input)).rejects.toThrow();
  });
  it('reauthorizes before returning an original receipt', async () => {
    const f = fixture();
    await f.service.update(actor, caseId, value());
    f.replay();
    f.access.authorizeCase.mockRejectedValue(new Error('revoked'));
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow(
      'revoked',
    );
  });
  it('reauthorizes with the current revision and replays the immutable original write revision', async () => {
    const f = fixture(),
      input = value(),
      first = await f.service.update(actor, caseId, input);
    f.replay();
    const renewedActor = { ...actor, authorizationRevision: 2 };
    expect(await f.service.update(renewedActor, caseId, input)).toEqual(first);
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      renewedActor,
      'case.read',
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
    expect(f.access.authorizeCase).toHaveBeenLastCalledWith(
      renewedActor,
      'case.closure.correct',
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('u.authorization_revision=$3'),
      actor.userId,
      actor.departmentId,
      2,
    );
    const paymentAudits = f.tx.auditEvent.create.mock.calls
      .map(([call]) => call.data)
      .filter((a) => a.action === 'CASE_CLOSURE_PAYMENT_RECORD');
    expect(
      paymentAudits.every((a) => a.details.authorizationRevision === 1),
    ).toBe(true);
    expect(f.tx.caseClosurePaymentVersion.create).toHaveBeenCalledTimes(2);
  });
  it('rejects replay when current authenticated revision is stale before reading the receipt', async () => {
    const f = fixture();
    await f.service.update(actor, caseId, value());
    f.replay();
    f.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes('u.authorization_revision=$3') ? [] : [{ id: caseId }],
    );
    f.tx.caseClosureSettlementUpdateReceipt.findUnique.mockClear();
    await expect(
      f.service.update({ ...actor, authorizationRevision: 2 }, caseId, value()),
    ).rejects.toThrow();
    expect(
      f.tx.caseClosureSettlementUpdateReceipt.findUnique,
    ).not.toHaveBeenCalled();
  });
  it.each([undefined, '1', 0, 1.5])(
    'rejects malformed original audit revision %s on replay',
    async (revision) => {
      const f = fixture();
      await f.service.update(actor, caseId, value());
      f.replay();
      const audit = f.tx.auditEvent.create.mock.calls
        .map(([call]) => call.data)
        .find((a) => a.action === 'CASE_CLOSURE_PAYMENT_RECORD');
      audit.details.authorizationRevision = revision;
      await expect(f.service.update(actor, caseId, value())).rejects.toThrow();
    },
  );
  it('rejects a tampered parent receipt', async () => {
    const f = fixture();
    await f.service.update(actor, caseId, value());
    f.replay();
    const original = await f.tx.caseClosureSettlementUpdateReceipt.findUnique();
    original.resultSnapshot.version = 999;
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow();
  });
  it('normalizes UUID case before fingerprinting', async () => {
    const f = fixture(),
      input = value(),
      first = await f.service.update(actor, caseId, input);
    f.replay();
    input.expectedClosureVersionId =
      input.expectedClosureVersionId.toUpperCase();
    input.closeContentVersionIds = input.closeContentVersionIds.map((id) =>
      id.toUpperCase(),
    );
    input.paymentRecords[0]!.screenshotContentVersionId = docId.toUpperCase();
    expect(await f.service.update(actor, caseId.toUpperCase(), input)).toEqual(
      first,
    );
  });
});

it('binds refund cents into new command identity while preserving canonical cents on replay', async () => {
  const f = fixture(),
    input = value();
  input.refund = {
    expectedVersionId: null,
    kind: 'RECORD',
    items: [
      {
        itemId: refundId,
        party: 'COURT',
        status: 'PENDING',
        description: '退费',
        amount: '12.3',
      },
    ],
  };
  const first = await f.service.update(actor, caseId, input);
  expect(f.refunds.executeInTransaction).toHaveBeenCalledWith(
    expect.anything(),
    actor,
    expect.objectContaining({
      items: [expect.objectContaining({ amount: '12.30' })],
    }),
    expect.any(String),
    expect.anything(),
  );
  f.replay();
  input.refund.items![0]!.amount = '12.30';
  expect(await f.service.update(actor, caseId, input)).toEqual(first);
  input.refund.items![0]!.amount = '12.31';
  await expect(f.service.update(actor, caseId, input)).rejects.toMatchObject({
    response: { code: 'IDEMPOTENCY_CONFLICT' },
  });
});

it.each(['lock', 'projection'] as const)(
  'returns404 when the scoped case %s is missing before receipt lookup or writes',
  async (missing) => {
    const f = fixture();
    if (missing === 'lock')
      f.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT id FROM cases') ? [] : [{ id: actor.userId }],
      );
    else f.tx.case.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.update(actor, caseId, value()),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'CASE_NOT_FOUND' },
    });
    if (missing === 'lock') expect(f.tx.case.findFirst).not.toHaveBeenCalled();
    else expect(f.tx.case.findFirst).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
    expect(
      f.tx.caseClosureSettlementUpdateReceipt.findUnique,
    ).not.toHaveBeenCalled();
    expect(
      f.tx.caseClosureSettlementUpdateReceipt.create,
    ).not.toHaveBeenCalled();
    expect(f.tx.caseSettlementTerms.findUnique).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
    expect(f.refunds.executeInTransaction).not.toHaveBeenCalled();
    expect(f.assessments.executeInTransaction).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  },
);

it('writes and replays a new null-date version without inventing a date or changing money', async () => {
  const f = fixture();
  const input = {
    ...value(),
    closeAt: null,
  } as unknown as UpdateClosureSettlementInput;
  const result = await f.service.update(actor, caseId, input);
  f.replay();
  expect(await f.service.update(actor, caseId, input)).toEqual(result);
  expect(f.tx.caseClosureVersion.create).toHaveBeenCalledTimes(1);
  expect(f.tx.caseClosureVersion.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ closeAt: null, closeAmt: '10.00' }),
    }),
  );
  expect(f.tx.auditEvent.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        details: expect.objectContaining({ closeAt: null }),
      }),
    }),
  );
});
