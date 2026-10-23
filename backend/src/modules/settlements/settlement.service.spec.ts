import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import {
  AccessControlService,
  type AccessControlSnapshot,
} from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { SettlementService } from './settlement.service';
import { FeeService } from './fee.service';
import { financialFingerprint } from './settlement-input';
import { SettlementSideDtoValue } from './settlement.dto';
import { MaterialService } from '../materials';
import { SettlementPageDto } from './settlement.dto';

const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};
const launchInput = {
  side: SettlementSideDtoValue.CUSTOMER,
  amount: '20',
  launchDate: '2026-10-17',
  expectedTermsVersion: 1,
  idempotencyKey: 'key',
};

function setup(snapshot: AccessControlSnapshot) {
  const events: string[] = [];
  const raw = jest.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('').includes('FROM cases')) {
        events.push(`case-lock:${String(values[0])}`);
        return [{ id: values[0] }];
      }
      return [];
    },
  );
  const tx = { $queryRaw: raw } as unknown as Prisma.TransactionClient;
  const loadSnapshot = jest.fn(
    async (_user: string, _department: string, reader: unknown) => {
      expect(reader).toBe(tx);
      events.push('authorize-current');
      return snapshot;
    },
  );
  const access = new AccessControlService({ loadSnapshot });
  const organization = {
    lockDepartment: jest.fn(async () => {
      events.push('actor-facts-lock');
    }),
  } as unknown as OrganizationService;
  const database = {
    $transaction: jest.fn(
      async (work: (reader: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx),
    ),
  } as unknown as DatabaseService;
  return {
    tx,
    access,
    organization,
    database,
    events,
    raw,
    service: new SettlementService(database, access, organization),
    fees: new FeeService(database, access, organization, {} as MaterialService),
  };
}

function offlineBillCompiler() {
  const stop = new Error('OFFLINE_SQL_REACHED');
  const sql = jest.fn(async () => {
    throw stop;
  });
  type Adapter = Awaited<
    ReturnType<NonNullable<Prisma.PrismaClientOptions['adapter']>['connect']>
  >;
  const adapter: Adapter = {
    provider: 'postgres',
    adapterName: 'offline-no-sql',
    queryRaw: sql,
    executeRaw: sql,
    executeScript: sql,
    dispose: async () => {},
    getConnectionInfo: () => ({
      schemaName: 'public',
      supportsRelationJoins: true,
    }),
    startTransaction: async () => ({
      provider: 'postgres',
      adapterName: 'offline-no-sql',
      queryRaw: sql,
      executeRaw: sql,
      options: { usePhantomQuery: true },
      commit: async () => {},
      rollback: async () => {},
    }),
  };
  const client = new PrismaClient({
    adapter: {
      provider: 'postgres',
      adapterName: 'offline-no-sql',
      connect: async () => adapter,
    },
  });
  return { client, sql, stop };
}

describe('bill detail readable source projection', () => {
  it.each([null, new Date('2026-10-20T08:00:00Z')])(
    'reads original launch facts even when cancelledAt=%s',
    async (cancelledAt) => {
      const authorizeDepartmentAction = jest.fn().mockResolvedValue(undefined);
      const findFirst = jest.fn().mockResolvedValue({
        id: 'bill',
        billNo: '2026101900001',
        side: 'CUSTOMER',
        billDate: new Date('2026-10-19T00:00:00Z'),
        amount: new Prisma.Decimal('20'),
        note: null,
        cancelledAt,
        cancellationReason: null,
        items: [
          {
            id: 'item',
            launchId: 'launch',
            caseId: 'case-uuid',
            payeeId: 'customer',
            payeeName: '客户甲',
            nth: 2,
            amount: new Prisma.Decimal('20'),
            launch: {
              launchDate: new Date('2026-10-17T00:00:00Z'),
              case: { businessNo: 'CASE-2026-完整单号' },
            },
          },
        ],
      });
      const service = new SettlementService(
        { settlementBill: { findFirst } } as unknown as DatabaseService,
        { authorizeDepartmentAction } as unknown as AccessControlService,
        {} as OrganizationService,
      );
      await expect(service.billDetail(actor, 'bill')).resolves.toMatchObject({
        items: [
          {
            id: 'item',
            caseId: 'case-uuid',
            caseBusinessNo: 'CASE-2026-完整单号',
            launchDate: '2026-10-17',
            payeeId: 'customer',
            amount: '20.00',
          },
        ],
      });
      expect(authorizeDepartmentAction).toHaveBeenCalledWith(
        actor,
        'settlement.read',
      );
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'bill', departmentId: actor.departmentId },
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: {
              launch: {
                select: {
                  launchDate: true,
                  case: { select: { businessNo: true } },
                },
              },
            },
          },
        },
      });
    },
  );
});

describe('financial current authorization before command receipts', () => {
  const revoked: AccessControlSnapshot = {
    active: true,
    authorizationRevision: 1,
    grants: [],
  };
  it.each([
    'terms',
    'launch',
    'bill',
    'cancel',
    'fee-create',
    'fee-update',
    'fee-batch',
  ])(
    '%s fails inside the transaction before returning a receipt or touching source rows after revocation',
    async (command) => {
      const test = setup(revoked);
      let pending: Promise<unknown>;
      switch (command) {
        case 'terms':
          pending = test.service.updateTerms(actor, 'case', {
            side: SettlementSideDtoValue.CUSTOMER,
            customerFormula: '70%',
            expectedTermsVersion: 0,
            idempotencyKey: 'terms-key',
          });
          break;
        case 'launch':
          pending = test.service.launch(actor, 'case', launchInput);
          break;
        case 'bill':
          pending = test.service.createBill(actor, {
            side: SettlementSideDtoValue.CUSTOMER,
            billDate: '2026-10-17',
            launchIds: ['launch'],
            idempotencyKey: 'key',
          });
          break;
        case 'cancel':
          pending = test.service.cancelBill(actor, 'bill', {
            idempotencyKey: 'key',
          });
          break;
        case 'fee-create':
          pending = test.fees.create(actor, {
            caseId: 'case',
            type: '诉讼费',
            direction: '支出',
            status: '未发起',
            amount: '20',
            feeDate: '2026-10-17',
            idempotencyKey: 'key',
          });
          break;
        case 'fee-update':
          pending = test.fees.update(actor, 'fee', {
            expectedVersion: 1,
            status: '发起',
          });
          break;
        default:
          pending = test.fees.batch(actor, 'LAUNCH', {
            ids: ['fee'],
            idempotencyKey: 'key',
          });
      }
      await expect(pending).rejects.toBeInstanceOf(ForbiddenException);
      expect(test.events).toEqual(['actor-facts-lock', 'authorize-current']);
    },
  );

  it('locks the case before a current authorized successful replay, and rejects changed body versions', async () => {
    const test = setup({
      active: true,
      authorizationRevision: 1,
      grants: [{ action: 'settlement.launch', scope: 'department' }],
    });
    const fingerprint = financialFingerprint({
      command: 'LAUNCH',
      caseId: 'case',
      side: 'CUSTOMER',
      amount: '20.00',
      launchDate: '2026-10-17',
      note: null,
      lawyerId: null,
      expectedTermsVersion: 1,
    });
    const prior = {
      id: 'launch',
      caseId: 'case',
      side: 'CUSTOMER',
      nth: 1,
      amount: new Prisma.Decimal('20'),
      launchDate: new Date('2026-10-17T00:00:00.000Z'),
      note: null,
      lawyerId: null,
    };
    Object.assign(test.tx, {
      caseSettlementLaunch: {
        findUnique: jest.fn(async () => {
          test.events.push('receipt-read');
          return prior;
        }),
      },
      auditEvent: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { details: { requestFingerprint: fingerprint } },
          ]),
      },
    });
    await expect(
      test.service.launch(actor, 'case', launchInput),
    ).resolves.toEqual({ id: 'launch', nth: 1, amount: '20.00' });
    expect(test.events).toEqual([
      'actor-facts-lock',
      'authorize-current',
      'case-lock:case',
      'receipt-read',
    ]);
    await expect(
      test.service.launch(actor, 'case', {
        ...launchInput,
        expectedTermsVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
});

describe('effective closure amount through the settlement read service', () => {
  it.each([
    ['80', '56.00', '24.00', '36.00'],
    ['0', '0.00', '0.00', '0.00'],
    [null, null, null, null],
  ])(
    'uses corrected %s for both automatic amounts and the current remaining balance',
    async (value, customer, lawyer, remaining) => {
      const test = setup({
        active: true,
        authorizationRevision: 1,
        grants: [{ action: 'settlement.read', scope: 'department' }],
      });
      const original = {
        id: 'version',
        closureId: 'closure',
        caseId: 'case',
        departmentId: 'department',
        closeAmountState: 'KNOWN',
        closeAmt: new Prisma.Decimal('100'),
      };
      Object.assign(test.tx, {
        case: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'case',
            departmentId: 'department',
            businessNo: 'CASE-1',
            customerId: 'customer',
            stage: 'WAITING_ARCHIVE',
            version: 11,
            complaintAmountState: 'KNOWN',
            complaintAmount: new Prisma.Decimal('900'),
            complaintConfirmation: null,
            customer: {
              id: 'customer',
              departmentId: 'department',
              name: '客户甲',
            },
            lawyers: [],
            closure: {
              id: 'closure',
              caseId: 'case',
              departmentId: 'department',
              currentVersion: original,
              recordCorrections: [
                {
                  id: 'edit',
                  closureId: 'closure',
                  caseId: 'case',
                  departmentId: 'department',
                  sourceClosureVersionId: 'version',
                  priorCorrectionId: null,
                  fromRevision: 0,
                  toRevision: 1,
                  correctionReason: '资料更正',
                  recordedAt: new Date(),
                  recordedByUserId: 'actor',
                  closeAmountState: value === null ? 'PENDING' : 'KNOWN',
                  closeAmt: value === null ? null : new Prisma.Decimal(value),
                },
              ],
            },
          }),
        },
        caseSettlementTerms: {
          findUnique: jest.fn().mockResolvedValue({
            departmentId: 'department',
            version: 1,
            customerFormula: '70%',
            lawyerMode: 'FULL_RISK',
            lawyerBaseFee: new Prisma.Decimal(0),
            lawyerSplitPercent: new Prisma.Decimal(30),
            customerManualAmount: null,
            lawyerManualAmount: null,
          }),
        },
        caseSettlementLaunch: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'launch',
              caseId: 'case',
              side: 'CUSTOMER',
              nth: 1,
              amount: new Prisma.Decimal(20),
              launchDate: new Date('2026-10-17T00:00:00.000Z'),
              note: null,
              billId: null,
              customerId: 'customer',
              lawyerId: null,
            },
          ]),
        },
      });
      const result = await test.service.caseDetail(actor, 'case');
      expect(result.figures).toMatchObject({
        customerAmount: customer,
        lawyerAmount: lawyer,
      });
      expect(result.customerBalance).toMatchObject({
        launched: '20.00',
        remaining,
      });
      expect(result.amountSource.revision).toBe(1);
      expect(original.closeAmt.toString()).toBe('100');
    },
  );
});

describe('settlement center source selection and receipts', () => {
  it('authorizes and locks before replaying an unchanged terms request, rejecting changed content under the same key', async () => {
    const f = setup({
      active: true,
      authorizationRevision: 1,
      grants: [{ action: 'settlement.terms.update', scope: 'department' }],
    });
    const body = {
      expectedTermsVersion: 1,
      side: SettlementSideDtoValue.CUSTOMER,
      customerFormula: '70%',
      manualAmount: null,
      idempotencyKey: 'terms-key',
    };
    const fingerprint = financialFingerprint({
      command: 'UPDATE_TERMS',
      caseId: 'case',
      side: 'CUSTOMER',
      expectedTermsVersion: 1,
      customerFormula: '70%',
      lawyerMode: null,
      lawyerBaseFee: null,
      lawyerSplitPercent: null,
      manualAmount: null,
    });
    Object.assign(f.tx, {
      auditEvent: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { details: { termsVersion: 2, requestFingerprint: fingerprint } },
          ]),
      },
    });
    await expect(f.service.updateTerms(actor, 'case', body)).resolves.toEqual({
      caseId: 'case',
      termsVersion: 2,
    });
    expect(f.events).toEqual([
      'actor-facts-lock',
      'authorize-current',
      'case-lock:case',
    ]);
    await expect(
      f.service.updateTerms(actor, 'case', { ...body, customerFormula: '80%' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it('filters before pagination and uses the filtered selection while keeping KPI scoped to the whole side', async () => {
    const f = setup({
      active: true,
      authorizationRevision: 1,
      grants: [{ action: 'settlement.read', scope: 'department' }],
    });
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'launch-off-page' }])
      .mockResolvedValueOnce([
        { customerId: 'customer', lawyerId: null, lawyer: null },
      ]);
    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('120.00') },
        _count: { _all: 120 },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('30.00') },
        _count: { _all: 30 },
      });
    Object.assign(f.tx, {
      caseSettlementLaunch: {
        findMany,
        aggregate,
        count: jest.fn().mockResolvedValue(120),
      },
    });
    const query = Object.assign(new SettlementPageDto(), {
      page: 2,
      pageSize: 100,
      keyword: '客户甲',
      billed: 'UNBILLED',
      stage: 'WAITING_ARCHIVE',
      from: '2026-10-01',
      to: '2026-10-17',
    });
    const result = await f.service.launches(actor, 'CUSTOMER', query);
    expect(result.total).toBe(120);
    expect(result.matchingIds).toEqual(['launch-off-page']);
    expect(result.summary).toEqual({
      launchedAmount: '120.00',
      billedAmount: '90.00',
      unbilledAmount: '30.00',
      unbilledCount: 30,
      launchCount: 120,
      billedCount: 90,
      invoiceAmount: null,
      receivedAmount: null,
      paidAmount: null,
      cooperatingPayeeCount: 1,
      knownLawFirmCount: 0,
    });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        departmentId: actor.departmentId,
        side: 'CUSTOMER',
        billId: null,
        case: { stage: 'WAITING_ARCHIVE' },
        launchDate: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-17T00:00:00.000Z'),
        },
      },
      skip: 100,
      take: 100,
    });
    expect(findMany.mock.calls[1]?.[0]).not.toHaveProperty('take');
    expect(aggregate.mock.calls[0]![0].where).toEqual({
      departmentId: actor.departmentId,
      side: 'CUSTOMER',
    });
  });
  it('creates one bill with each actual payee and locks both cases in stable order', async () => {
    const f = setup({
      active: true,
      authorizationRevision: 1,
      grants: [{ action: 'settlement.bill.create', scope: 'department' }],
    });
    const rows = [
      {
        id: 'launch-b',
        caseId: 'case-b',
        side: 'CUSTOMER',
        amount: new Prisma.Decimal('0.20'),
        billId: null,
        customerId: 'customer-b',
        lawyerId: null,
        customer: { name: '客户乙' },
        lawyer: null,
        nth: 2,
      },
      {
        id: 'launch-a',
        caseId: 'case-a',
        side: 'CUSTOMER',
        amount: new Prisma.Decimal('0.10'),
        billId: null,
        customerId: 'customer-a',
        lawyerId: null,
        customer: { name: '客户甲' },
        lawyer: null,
        nth: 1,
      },
    ];
    const create = jest.fn(
      async ({ data }: Prisma.SettlementBillCreateArgs) => ({
        id: 'bill',
        billNo: data.billNo,
        amount: new Prisma.Decimal(String(data.amount)),
      }),
    );
    Object.assign(f.tx, {
      caseSettlementLaunch: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      settlementBill: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
      auditEvent: { create: jest.fn() },
    });
    await expect(
      f.service.createBill(actor, {
        side: SettlementSideDtoValue.CUSTOMER,
        billDate: '2026-10-17',
        launchIds: ['launch-b', 'launch-a'],
        idempotencyKey: 'bill-key',
      }),
    ).resolves.toMatchObject({ billNo: '2026101700001', amount: '0.30' });
    expect(f.events.slice(2)).toEqual(['case-lock:case-a', 'case-lock:case-b']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({
                launchId: 'launch-b',
                caseId: 'case-b',
                payeeId: 'customer-b',
                payeeName: '客户乙',
                nth: 2,
              }),
              expect.objectContaining({
                launchId: 'launch-a',
                caseId: 'case-a',
                payeeId: 'customer-a',
                payeeName: '客户甲',
                nth: 1,
              }),
            ]),
          },
        }),
      }),
    );
    // Exercise the real generated Prisma7.10 validation/query compiler using the
    // service's actual payload. The adapter can only throw, never contact pg.
    const offline = offlineBillCompiler();
    try {
      await expect(
        offline.client.settlementBill.create(create.mock.calls[0]![0]),
      ).rejects.toThrow('OFFLINE_SQL_REACHED');
      expect(offline.sql).toHaveBeenCalledTimes(1);
    } finally {
      await offline.client.$disconnect();
    }
  });
  function billCreationFixture(side = SettlementSideDtoValue.CUSTOMER) {
    const f = setup({
      active: true,
      authorizationRevision: 1,
      grants: [{ action: 'settlement.bill.create', scope: 'department' }],
    });
    const row = {
      id: 'launch',
      caseId: 'case',
      side,
      amount: new Prisma.Decimal('100.00'),
      billId: null as string | null,
      customerId: side === SettlementSideDtoValue.CUSTOMER ? 'customer' : null,
      lawyerId: side === SettlementSideDtoValue.LAWYER ? 'lawyer' : null,
      customer:
        side === SettlementSideDtoValue.CUSTOMER ? { name: '客户' } : null,
      lawyer:
        side === SettlementSideDtoValue.LAWYER ? { fullName: '律师' } : null,
      nth: 1,
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const findUnique = jest.fn().mockResolvedValue(null);
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn();
    const updateMany = jest.fn();
    const audit = jest.fn();
    Object.assign(f.tx, {
      caseSettlementLaunch: { findMany, updateMany },
      settlementBill: { findUnique, findFirst, create },
      auditEvent: { create: audit },
    });
    const input = {
      side,
      billDate: '2026-10-17',
      launchIds: [row.id],
      idempotencyKey: 'new-bill-key',
    };
    return {
      ...f,
      row,
      input,
      findMany,
      findUnique,
      findFirst,
      create,
      updateMany,
      audit,
    };
  }

  it.each([SettlementSideDtoValue.CUSTOMER, SettlementSideDtoValue.LAWYER])(
    'rejects an already occupied %s launch with 409 before any bill, occupation or audit write',
    async (side) => {
      const f = billCreationFixture(side);
      f.row.billId = 'current-bill';
      await expect(f.service.createBill(actor, f.input)).rejects.toMatchObject({
        status: 409,
        response: { code: 'SETTLEMENT_CHANGED' },
      });
      expect(f.events).toEqual([
        'actor-facts-lock',
        'authorize-current',
        'case-lock:case',
      ]);
      expect(f.findFirst).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
      expect(f.updateMany).not.toHaveBeenCalled();
      expect(f.audit).not.toHaveBeenCalled();
    },
  );

  it('preserves an unknown internal error instead of translating it into a bill conflict', async () => {
    const f = billCreationFixture();
    const error = new Error('UNEXPECTED_INTERNAL_FAILURE');
    f.create.mockRejectedValue(error);
    await expect(f.service.createBill(actor, f.input)).rejects.toBe(error);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
  });

  it('replays the original successful key after cancellation and occupation by a later bill without new writes', async () => {
    const f = billCreationFixture();
    f.row.billId = 'later-bill';
    f.findUnique.mockResolvedValue({
      id: 'original-bill',
      billNo: '2026101700001',
      side: f.input.side,
      billDate: new Date('2026-10-17T00:00:00.000Z'),
      note: null,
      amount: new Prisma.Decimal('100.00'),
      cancelledAt: new Date('2026-10-17T01:00:00.000Z'),
      items: [{ launchId: f.row.id }],
    });
    await expect(
      f.service.createBill(actor, {
        ...f.input,
        idempotencyKey: 'original-bill-key',
      }),
    ).resolves.toEqual({
      id: 'original-bill',
      billNo: '2026101700001',
      amount: '100.00',
    });
    expect(f.events).toEqual([
      'actor-facts-lock',
      'authorize-current',
      'case-lock:case',
    ]);
    expect(f.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId_actorUserId_idempotencyKey: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            idempotencyKey: 'original-bill-key',
          },
        },
      }),
    );
    expect(f.findMany).toHaveBeenCalledTimes(1);
    expect(f.findFirst).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
  });

  it('cancels exact stable source IDs without changing launched amounts or deleting bill history', async () => {
    const f = setup({
      active: true,
      authorizationRevision: 1,
      grants: [{ action: 'settlement.bill.cancel', scope: 'department' }],
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const bill = {
      id: 'bill',
      billNo: '2026101700001',
      cancelledAt: null,
      items: [
        { launchId: 'launch-b', caseId: 'case-b' },
        { launchId: 'launch-a', caseId: 'case-a' },
      ],
    };
    Object.assign(f.tx, {
      caseSettlementLaunch: { updateMany },
      settlementBill: {
        findFirst: jest.fn().mockResolvedValue(bill),
        update: jest.fn().mockResolvedValue({
          ...bill,
          cancelledAt: new Date('2026-10-17T00:00:00.000Z'),
        }),
      },
      auditEvent: { create: jest.fn() },
    });
    await expect(
      f.service.cancelBill(actor, 'bill', { idempotencyKey: 'cancel-key' }),
    ).resolves.toMatchObject({ id: 'bill' });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        id: { in: ['launch-b', 'launch-a'] },
        billId: 'bill',
      },
      data: { billId: null },
    });
  });
});
