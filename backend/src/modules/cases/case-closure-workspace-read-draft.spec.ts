import { ForbiddenException } from '@nestjs/common';
import type { DatabaseService } from '../../database/database.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { Prisma } from '../../generated/prisma/client';
import { ClosureActualAggregateReadDraft } from '../settlements';
import {
  CaseClosureWorkspaceReadDraft,
  type ClosureActualAggregateReadPort,
} from './case-closure-workspace-read-draft';

jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(),
}));
const userId = '10000000-0000-4000-8000-000000000001';
const departmentId = '10000000-0000-4000-8000-000000000002';
const caseId = '10000000-0000-4000-8000-000000000003';
const actor = { userId, departmentId, authorizationRevision: 7 };

function fixture(actualAggregate?: ClosureActualAggregateReadPort) {
  const sql: string[] = [];
  const refunds: object[] = [];
  const assessments: object[] = [];
  const items: object[] = [];
  const supplements: object[] = [];
  const tx = {
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        active: true,
        accountType: 'INTERNAL',
        authorizationRevision: 7,
      }),
    },
    departmentMembership: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, teamId: null, team: null }),
    },
    case: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({
        version: 4,
        stage: 'WAITING_ARCHIVE',
        responsibleUserId: userId,
      }),
    },
    caseClosure: { findFirst: jest.fn().mockResolvedValue(null) },
    caseLawyerAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    caseClosurePaymentVersion: { findMany: jest.fn().mockResolvedValue([]) },
    caseClosureDocument: { findMany: jest.fn().mockResolvedValue([]) },
    caseSettlementTerms: { findFirst: jest.fn().mockResolvedValue(null) },
    caseConsolidationMember: { findMany: jest.fn().mockResolvedValue([]) },
    caseConsolidation: { findMany: jest.fn().mockResolvedValue([]) },
    caseSettlementActualAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn(async (query: TemplateStringsArray) => {
      const text = query.join('?');
      sql.push(text);
      if (text.includes('FROM cases')) return [{ id: caseId }];
      if (text.includes('FROM case_payment_proof_supplement_documents'))
        return supplements;
      if (text.includes('FROM case_refund_inventory_versions')) return refunds;
      if (text.includes('FROM case_refund_inventory_items')) return items;
      if (text.includes('FROM case_settlement_assessment_versions'))
        return assessments;
      throw new Error('Unexpected SQL');
    }),
  };
  const transaction = jest.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const database = { $transaction: transaction } as unknown as DatabaseService;
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  const service = new CaseClosureWorkspaceReadDraft(
    database,
    access,
    {} as OrganizationService,
    actualAggregate,
  );
  return {
    service,
    tx,
    sql,
    refunds,
    assessments,
    items,
    supplements,
    access,
    transaction,
  };
}
const payment = (
  id: string,
  revision: number,
  state = 'ACTIVE',
  priorVersionId: string | null = null,
) => ({
  id,
  revision,
  state,
  priorVersionId,
  paymentId: 'payment-1',
  paidOn: new Date('2026-10-20Z'),
  amount: new Prisma.Decimal('10.01'),
  payer: '付款方',
  payee: '收款方',
  documents: [{ materialId: 'material', contentVersionId: 'exact-content' }],
  reason: null,
  recordedAt: new Date('2026-10-20T01:02:03Z'),
});

it('reads separate current-case history including voided/superseded originals without changing the effective set', async () => {
  const f = fixture();
  const original = payment('v1', 1),
    voided = {
      ...payment('v2', 2, 'VOID', 'v1'),
      reason: '重复登记',
      documents: [],
    };
  f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([voided, original]);
  const history = await f.service.read(actor, caseId, true);
  expect(history.effectivePayments).toEqual([]);
  expect(history.paymentHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        versionId: 'v1',
        originalDocuments: original.documents,
        state: 'ACTIVE',
      }),
      expect.objectContaining({
        versionId: 'v2',
        priorVersionId: 'v1',
        state: 'VOID',
        reason: '重复登记',
        originalDocuments: [],
      }),
    ]),
  );
  expect(f.access.authorizeCase).toHaveBeenCalled();
  const regular = await f.service.read(actor, caseId);
  expect(Object.hasOwn(regular, 'paymentHistory')).toBe(false);
});

describe('owner-only closure workspace read', () => {
  beforeEach(() => jest.clearAllMocks());
  it('adds exact supplement references to the effective version only without changing original receipt documents', async () => {
    const f = fixture();
    const old = payment('v1', 1);
    const current = payment('v2', 2, 'ACTIVE', 'v1');
    const original = structuredClone(current.documents);
    f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([old, current]);
    f.supplements.push(
      ...original.map((d) => ({ ...d, referenceValid: true })),
      {
        materialId: 'later-material',
        contentVersionId: 'later-exact',
        actorUserId: 'secret',
        referenceValid: true,
      },
      {
        materialId: 'later-material',
        contentVersionId: 'later-exact',
        referenceValid: true,
      },
    );
    const result = await f.service.read(actor, caseId);
    expect(result.effectivePayments).toHaveLength(1);
    expect(result.effectivePayments[0]).toMatchObject({
      versionId: 'v2',
      documents: [
        ...original,
        { materialId: 'later-material', contentVersionId: 'later-exact' },
      ],
    });
    expect(current.documents).toEqual(original);
    expect(old.documents).toEqual(original);
    expect(JSON.stringify(result)).not.toContain('secret');
    const call = f.tx.$queryRaw.mock.calls.find(([query]) =>
      query.join('').includes('FROM case_payment_proof_supplement_documents'),
    );
    expect(call).toBeDefined();
    expect(call?.slice(1)).toEqual([
      caseId,
      departmentId,
      current.paymentId,
      current.id,
    ]);
    const sql = call?.[0].join(' ');
    expect(sql).toContain("r.resource_type='case-payment-proof-supplement'");
    expect(sql).toContain('r.action_event_id=s.audit_event_id');
    expect(sql).toContain('LEFT JOIN case_payment_proof_supplements');
    expect(sql).toContain('EXISTS(SELECT 1 FROM material_references');
    expect(sql).toContain('s.case_id=d.case_id');
    expect(sql).toContain('s.department_id=d.department_id');
    expect(sql).toContain('s.payment_id=p.payment_id');
    expect(sql).toContain('r.department_id=d.department_id');
    expect(sql).toContain(
      'r.material_id=d.material_id AND r.content_version_id=d.content_version_id',
    );
    expect(sql).toContain("p.state='ACTIVE'");
    expect(sql).toContain('n.revision>p.revision');
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects conflicting material identity for the same exact supplement content version', async () => {
    const f = fixture();
    f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([
      payment('v1', 1),
    ]);
    f.supplements.push({
      materialId: 'other-material',
      contentVersionId: 'exact-content',
      referenceValid: true,
    });
    await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
      response: { code: 'CASE_WORKSPACE_SOURCE_INVALID' },
    });
  });
  it.each([
    'missing',
    'cross-case',
    'wrong-payment',
    'wrong-material',
    'wrong-version',
    'wrong-audit',
  ])(
    'fails closed when supplement reference validation reports %s provenance',
    async (reason) => {
      const f = fixture();
      const current = payment('v1', 1);
      const original = structuredClone(current.documents);
      f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([current]);
      f.supplements.push({
        materialId: 'later-material',
        contentVersionId: 'later-exact',
        referenceValid: false,
        reason,
      });
      await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
        response: { code: 'CASE_WORKSPACE_SOURCE_INVALID' },
      });
      expect(current.documents).toEqual(original);
      expect(f.transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('reads only current-case unended lawyer profiles in the authorized transaction', async () => {
    const f = fixture();
    const lawyer = {
      id: '20000000-0000-4000-8000-000000000001',
      fullName: '当前律师',
    };
    f.tx.caseLawyerAssignment.findMany.mockImplementation(async () => {
      expect(f.access.authorizeCase).toHaveBeenCalledWith(
        expect.anything(),
        'case.read',
        expect.anything(),
        f.tx,
      );
      return [{ lawyer }, { lawyer }];
    });
    const result = await f.service.read(actor, caseId);
    expect(f.tx.caseLawyerAssignment.findMany).toHaveBeenCalledWith({
      where: { caseId, departmentId, endedAt: null },
      select: { lawyer: { select: { id: true, fullName: true } } },
      orderBy: [{ lawyerId: 'asc' }, { id: 'asc' }],
    });
    expect(result.actualRegistrationLawyers).toEqual([lawyer]);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
  it('does not read lawyer options when case.read is denied', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.read(actor, caseId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.tx.caseLawyerAssignment.findMany).not.toHaveBeenCalled();
  });
  it.each(['INSTALLMENT', 'UNKNOWN', '', 'UNSUPPORTED'])(
    'rejects unsupported stored payment type %s instead of displaying it',
    async (paymentType) => {
      const readInTransaction = jest.fn();
      const f = fixture({ readInTransaction });
      f.tx.caseClosure.findFirst.mockResolvedValue({
        currentVersion: {
          id: 'closure-current',
          closeAt: null,
          closeAmountState: 'PENDING',
          closeAmt: null,
          paymentType,
        },
      });
      await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
        response: { code: 'CASE_WORKSPACE_SOURCE_INVALID' },
      });
      expect(readInTransaction).not.toHaveBeenCalled();
    },
  );
  it('preserves historical null payment type as unknown', async () => {
    const f = fixture();
    f.tx.caseClosure.findFirst.mockResolvedValue({
      currentVersion: {
        id: 'historical-closure',
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        paymentType: null,
      },
    });
    expect((await f.service.read(actor, caseId)).closure.paymentType).toBe(
      'UNKNOWN',
    );
  });
  it('propagates an aggregate failure instead of inventing an unknown successful display', async () => {
    const failure = new Error('synthetic aggregate source failure');
    const f = fixture({
      readInTransaction: jest.fn().mockRejectedValue(failure),
    });
    await expect(f.service.read(actor, caseId)).rejects.toBe(failure);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
  it.each([
    {
      scope: 'SOURCE_CASES',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    },
    { scope: 'CASE', lawyerInvoicedAmount: null },
    { scope: 'CASE', customerReceivedAmount: null },
  ])('rejects invalid scope or missing money field %#', async (output) => {
    const f = fixture({
      readInTransaction: jest.fn().mockResolvedValue(output),
    });
    await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
      response: { code: 'CASE_WORKSPACE_SOURCE_INVALID' },
    });
  });
  it('composes the real aggregate with the reader for a main case containing another owners original case', async () => {
    const sourceCaseId = '10000000-0000-4000-8000-000000000004';
    const otherOwnerId = '10000000-0000-4000-8000-000000000005';
    const groupId = '10000000-0000-4000-8000-000000000006';
    const adapter = new ClosureActualAggregateReadDraft();
    const aggregateRead = jest.spyOn(adapter, 'readInTransaction');
    const f = fixture(adapter);
    f.tx.caseConsolidationMember.findMany
      .mockResolvedValueOnce([
        { consolidationId: groupId, departmentId, isMain: true },
      ])
      .mockResolvedValueOnce([
        { caseId, departmentId, isMain: true },
        { caseId: sourceCaseId, departmentId, isMain: false },
      ]);
    f.tx.caseConsolidation.findMany.mockResolvedValue([
      { id: groupId, departmentId },
    ]);
    f.tx.case.findMany.mockResolvedValue([
      { id: caseId, departmentId, responsibleUserId: userId },
      { id: sourceCaseId, departmentId, responsibleUserId: otherOwnerId },
    ]);
    const mainAllocation = {
      id: 'main-allocation',
      caseId,
      departmentId,
      side: 'CUSTOMER',
      amount: new Prisma.Decimal('10.01'),
    };
    f.tx.caseSettlementActualAllocation.findMany.mockResolvedValue([
      mainAllocation,
      mainAllocation,
      {
        id: 'source-allocation',
        caseId: sourceCaseId,
        departmentId,
        side: 'CUSTOMER',
        amount: new Prisma.Decimal('20.02'),
      },
      {
        id: 'source-invoice',
        caseId: sourceCaseId,
        departmentId,
        side: 'LAWYER',
        amount: new Prisma.Decimal('5.03'),
      },
    ]);
    const result = await f.service.read(actor, caseId);
    expect(result.actual).toEqual({
      connection: 'CONNECTED',
      scope: 'CONSOLIDATION',
      customerReceiptState: 'RECORDED',
      lawyerInvoiceState: 'RECORDED',
      customerReceivedAmount: '30.03',
      lawyerInvoicedAmount: '5.03',
    });
    expect(aggregateRead).toHaveBeenCalledWith(f.tx, actor, caseId);
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.read',
      { departmentId, responsibleUserId: userId },
      f.tx,
    );
    expect(f.tx.caseSettlementActualAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { caseId: { in: [caseId, sourceCaseId] } },
      }),
    );
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      sourceCaseId,
      otherOwnerId,
      groupId,
      'main-allocation',
      'source-allocation',
      'source-invoice',
    ])
      expect(serialized).not.toContain(privateValue);
    expect(result.readPurpose).toBe('DISPLAY_ONLY');
  });
  it('calls the injected aggregate only after authorization in the same transaction and strips extra source details', async () => {
    const readInTransaction = jest.fn().mockResolvedValue({
      scope: 'CONSOLIDATION',
      customerReceivedAmount: '123.45',
      lawyerInvoicedAmount: null,
      allocationIds: ['secret-allocation'],
      sourceCaseIds: ['secret-case'],
      sourceReference: 'secret-reference',
    });
    const f = fixture({ readInTransaction });
    const result = await f.service.read(actor, caseId);
    expect(readInTransaction).toHaveBeenCalledTimes(1);
    expect(readInTransaction).toHaveBeenCalledWith(f.tx, actor, caseId);
    expect(f.access.authorizeCase.mock.invocationCallOrder[0]).toBeLessThan(
      readInTransaction.mock.invocationCallOrder[0],
    );
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(result.readPurpose).toBe('DISPLAY_ONLY');
    expect(result.actual).toEqual({
      connection: 'CONNECTED',
      scope: 'CONSOLIDATION',
      customerReceiptState: 'RECORDED',
      lawyerInvoiceState: 'UNKNOWN',
      customerReceivedAmount: '123.45',
      lawyerInvoicedAmount: null,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('keeps connected but absent allocations unknown without inventing zero', async () => {
    const readInTransaction = jest.fn().mockResolvedValue({
      scope: 'CASE',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    });
    const f = fixture({ readInTransaction });
    expect((await f.service.read(actor, caseId)).actual).toEqual({
      connection: 'CONNECTED',
      scope: 'CASE',
      customerReceiptState: 'UNKNOWN',
      lawyerInvoiceState: 'UNKNOWN',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    });
  });
  it.each(['external', 'owner', 'permission', 'revision'])(
    'never invokes aggregate for unauthorized %s',
    async (reason) => {
      const readInTransaction = jest.fn();
      const f = fixture({ readInTransaction });
      if (reason === 'owner')
        f.tx.case.findFirst.mockResolvedValue({
          version: 1,
          stage: 'WAITING_ARCHIVE',
          responsibleUserId: 'other',
        });
      if (reason === 'permission')
        f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
      if (reason === 'revision')
        f.tx.userAccount.findUnique.mockResolvedValue({
          active: true,
          accountType: 'INTERNAL',
          authorizationRevision: 6,
        });
      await expect(
        f.service.read(
          reason === 'external'
            ? { ...actor, clientCustomerId: 'external' }
            : actor,
          caseId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(readInTransaction).not.toHaveBeenCalled();
    },
  );
  it.each(['secret-reference', '-1.00', '0.001'])(
    'fails closed for non-money aggregate output %s',
    async (amount) => {
      const f = fixture({
        readInTransaction: jest.fn().mockResolvedValue({
          scope: 'CASE',
          customerReceivedAmount: amount,
          lawyerInvoicedAmount: null,
        }),
      });
      await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
        response: { code: 'CASE_WORKSPACE_SOURCE_INVALID' },
      });
    },
  );
  it('keeps absent facts unknown and actual amounts explicitly disconnected', async () => {
    const f = fixture();
    const result = await f.service.read(actor, caseId);
    expect(result.closure).toMatchObject({
      versionId: null,
      amountState: 'UNKNOWN',
      amount: null,
      paymentType: 'UNKNOWN',
    });
    expect(result.refund).toEqual({
      versionId: null,
      revision: null,
      declaration: 'UNKNOWN',
      items: [],
    });
    expect(result.assessment).toMatchObject({
      versionId: null,
      declaration: 'UNKNOWN',
      matchesCurrent: null,
      customerAmount: null,
    });
    expect(result.actual).toMatchObject({
      connection: 'NOT_CONNECTED',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    });
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(lockCustomerActorFacts).toHaveBeenCalledWith(
      f.tx,
      expect.anything(),
      actor,
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.read',
      { departmentId, responsibleUserId: userId },
      f.tx,
    );
    expect(f.sql[0]).toContain('FOR SHARE NOWAIT');
    expect(f.sql.every((s) => !/INSERT|UPDATE|DELETE/iu.test(s))).toBe(true);
  });
  it.each(['clientCustomerId', 'lawyerAccountId', 'notaryOfficeId'])(
    'rejects external context %s before transaction',
    async (key) => {
      const f = fixture();
      await expect(
        f.service.read({ ...actor, [key]: 'external' }, caseId),
      ).rejects.toThrow(ForbiddenException);
      expect(f.transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    { active: false, accountType: 'INTERNAL', authorizationRevision: 7 },
    { active: true, accountType: 'LAWYER', authorizationRevision: 7 },
    { active: true, accountType: 'INTERNAL', authorizationRevision: 6 },
  ])('rejects invalid account or stale authorization %#', async (account) => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue(account);
    await expect(f.service.read(actor, caseId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.tx.caseClosure.findFirst).not.toHaveBeenCalled();
  });
  it.each([
    { active: false, teamId: null, team: null },
    { active: true, teamId: 'team', team: { status: 'INACTIVE' } },
  ])('rejects inactive membership/team %#', async (membership) => {
    const f = fixture();
    f.tx.departmentMembership.findUnique.mockResolvedValue(membership);
    await expect(f.service.read(actor, caseId)).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('rejects another owner even with department read grants', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      version: 1,
      stage: 'WAITING_ARCHIVE',
      responsibleUserId: 'other',
    });
    await expect(f.service.read(actor, caseId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
  });
  it('propagates case.read denial and never queries business facts', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.read(actor, caseId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.tx.caseClosure.findFirst).not.toHaveBeenCalled();
  });
  it('keeps exact history references and never resurrects a void payment', async () => {
    const f = fixture();
    f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([
      payment('v1', 1),
      payment('v2', 2, 'VOID', 'v1'),
    ]);
    f.tx.caseClosureDocument.findMany.mockResolvedValue([
      {
        closureVersionId: 'old',
        materialId: 'doc',
        contentVersionId: 'old-content',
      },
    ]);
    const result = await f.service.read(actor, caseId);
    expect(result.effectivePayments).toEqual([]);
    expect(
      f.sql.some((sql) =>
        sql.includes('case_payment_proof_supplement_documents'),
      ),
    ).toBe(false);
    expect(result.documents).toEqual([
      {
        closureVersionId: 'old',
        materialId: 'doc',
        contentVersionId: 'old-content',
      },
    ]);
  });
  it('returns current closure date, amount state, type and assessment version without recalculation', async () => {
    const f = fixture();
    f.tx.caseClosure.findFirst.mockResolvedValue({
      currentVersion: {
        id: 'closure-current',
        closeAt: new Date('2026-10-29Z'),
        closeAmountState: 'KNOWN',
        closeAmt: new Prisma.Decimal('120.01'),
        paymentType: 'INSTALLMENTS',
      },
    });
    f.tx.caseSettlementTerms.findFirst.mockResolvedValue({ version: 3 });
    f.assessments.push({
      versionId: 'a1',
      priorVersionId: null,
      revision: 1,
      closureVersionId: 'closure-current',
      termsVersion: 3,
      declaration: 'APPLICABLE',
      customerAmount: '30.01',
      lawyerAmount: '10.01',
    });
    const result = await f.service.read(actor, caseId);
    expect(result.closure).toEqual({
      versionId: 'closure-current',
      closeOn: '2026-10-29',
      amountState: 'KNOWN',
      amount: '120.01',
      paymentType: 'INSTALLMENTS',
    });
    expect(result.assessment).toMatchObject({
      versionId: 'a1',
      matchesCurrent: true,
      customerAmount: '30.01',
      lawyerAmount: '10.01',
    });
  });
  it('returns not found when no case exists in the actor department', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([]);
    await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    expect(f.tx.caseClosure.findFirst).not.toHaveBeenCalled();
  });
  it('returns precise cents, explicit refund confirmation and historical assessment freshness', async () => {
    const f = fixture();
    f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([
      payment('p1', 1),
    ]);
    f.refunds.push({
      versionId: 'r1',
      priorVersionId: null,
      revision: 1,
      declaration: 'COMPLETE',
    });
    f.items.push({
      itemId: 'i1',
      party: 'COURT',
      status: 'PENDING',
      description: '退费',
      amount: '800.12',
      sourceAccountId: 'secret',
    });
    f.assessments.push({
      versionId: 'a1',
      priorVersionId: null,
      revision: 1,
      closureVersionId: 'old',
      termsVersion: null,
      declaration: 'APPLICABLE',
      customerAmount: '100.01',
      lawyerAmount: '20.02',
      auditEventId: 'secret',
    });
    const result = await f.service.read(actor, caseId);
    expect(result.effectivePayments[0]).toMatchObject({
      amount: '10.01',
      documents: [
        { materialId: 'material', contentVersionId: 'exact-content' },
      ],
    });
    expect(result.refund.declaration).toBe('COMPLETE');
    expect(result.refund.items[0]).toMatchObject({ amount: '800.12' });
    expect(result.assessment).toMatchObject({
      matchesCurrent: false,
      customerAmount: '100.01',
      lawyerAmount: '20.02',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(f.tx.caseClosureDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { caseId, departmentId } }),
    );
  });
  it.each(['payment', 'refund', 'assessment'])(
    'fails closed for broken %s chain',
    async (source) => {
      const f = fixture();
      if (source === 'payment')
        f.tx.caseClosurePaymentVersion.findMany.mockResolvedValue([
          payment('p2', 2),
        ]);
      if (source === 'refund')
        f.refunds.push({ versionId: 'r2', revision: 2, priorVersionId: null });
      if (source === 'assessment')
        f.assessments.push({
          versionId: 'a2',
          revision: 2,
          priorVersionId: null,
        });
      await expect(f.service.read(actor, caseId)).rejects.toMatchObject({
        response: { code: 'CASE_WORKSPACE_SOURCE_INVALID' },
      });
    },
  );
  it('rejects malformed IDs before transaction', async () => {
    const f = fixture();
    await expect(f.service.read(actor, 'bad')).rejects.toThrow();
    expect(f.transaction).not.toHaveBeenCalled();
  });
});
