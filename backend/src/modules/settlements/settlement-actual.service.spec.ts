import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import type { DatabaseService } from '../../database/database.service';
import { SettlementSideDtoValue } from './settlement.dto';
import { SettlementActualService } from './settlement-actual.service';

const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};
const allocation = {
  factId: 'fact',
  caseId: 'case',
  amount: '30.00',
  idempotencyKey: 'allocate-1',
};
const creation = {
  caseId: 'case',
  side: SettlementSideDtoValue.CUSTOMER,
  amount: '100.00',
  occurredOn: '2026-10-29',
  idempotencyKey: 'create-1',
};

function setup(
  options: {
    owner?: string;
    customer?: string;
    allocated?: string;
    rows?: unknown[];
    membership?: { consolidationId: string; isMain: boolean } | null;
    members?: { caseId: string; departmentId: string; isMain: boolean }[];
    ownerByCase?: Record<string, string>;
    lawyers?: string[];
    factSide?: 'CUSTOMER' | 'LAWYER';
    factPartyId?: string;
    sourceReference?: string | null;
    missingLockedCase?: boolean;
    aggregateHeads?: { id: string; department_id: string }[];
    changedMembers?: {
      caseId: string;
      departmentId: string;
      isMain: boolean;
    }[];
  } = {},
) {
  const fact = {
    id: 'fact',
    sourceCaseId: 'source',
    departmentId: 'department',
    side: options.factSide ?? 'CUSTOMER',
    partyId: options.factPartyId ?? 'customer-1',
    amount: new Prisma.Decimal('100.00'),
    occurredOn: new Date('2020-01-02T00:00:00Z'),
    actorUserId: 'actor',
    sourceReference: options.sourceReference ?? null,
    sourceSupplement: null,
  };
  let aggregateDiscoveries = 0;
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('SELECT consolidation_id,department_id,is_main'))
        return options.membership
          ? [
              {
                consolidation_id: options.membership.consolidationId,
                department_id: actor.departmentId,
                is_main: options.membership.isMain,
              },
            ]
          : [];
      if (sql.includes('SELECT id,department_id FROM case_consolidations'))
        return (
          options.aggregateHeads ??
          (options.membership
            ? [
                {
                  id: options.membership.consolidationId,
                  department_id: actor.departmentId,
                },
              ]
            : [])
        );
      if (sql.includes('SELECT case_id,department_id,is_main')) {
        const members =
          aggregateDiscoveries++ > 0
            ? (options.changedMembers ?? options.members)
            : options.members;
        return (members ?? []).map((row) => ({
          case_id: row.caseId,
          department_id: row.departmentId,
          is_main: row.isMain,
        }));
      }
      if (sql.includes('SELECT c.id,c.responsible_user_id,m.team_id'))
        return (options.members ?? [])
          .filter((row, index) => !options.missingLockedCase || index > 0)
          .map((row) => ({
            id: row.caseId,
            responsible_user_id:
              options.ownerByCase?.[row.caseId] ??
              options.owner ??
              actor.userId,
            team_id: null,
          }));
      return sql.includes('FROM cases') ? [{ id: 'case' }] : [];
    }),
    userAccount: {
      findUnique: jest.fn(async () => ({
        accountType: 'INTERNAL',
        active: true,
        authorizationRevision: actor.authorizationRevision,
      })),
    },
    case: {
      findFirst: jest.fn(async (query: { where: { id: string } }) => ({
        responsibleUserId:
          options.ownerByCase?.[query.where.id] ?? options.owner ?? 'actor',
        customerId: options.customer ?? 'customer-1',
        responsibleMembership: { teamId: null },
        lawyers: (options.lawyers ?? ['lawyer-1']).map((lawyerId) => ({
          lawyerId,
        })),
      })),
    },
    caseConsolidationMember: {
      findFirst: jest.fn(async () => options.membership ?? null),
    },
    caseConsolidation: {
      findFirst: jest.fn(async () => ({ members: options.members ?? [] })),
    },
    settlementActualFact: {
      findMany: jest.fn(async () => [
        { ...fact, occurredOn: new Date('2020-01-02T00:00:00Z') },
      ]),
      findFirst: jest.fn(async () => fact),
      findUnique: jest.fn(async (): Promise<unknown> => null),
      create: jest.fn(async (arg: { data: { id: string } }) => ({
        id: arg.data.id,
        amount: fact.amount,
      })),
    },
    caseSettlementActualAllocation: {
      findUnique: jest.fn(async (): Promise<unknown> => null),
      findMany: jest.fn(
        async (query: { where: { caseId: { in: string[] } } }) =>
          (options.rows ?? []).filter((row) =>
            query.where.caseId.in.includes((row as { caseId: string }).caseId),
          ),
      ),
      aggregate: jest.fn(async () => ({
        _sum: { amount: new Prisma.Decimal(options.allocated ?? '50.00') },
      })),
      create: jest.fn(async (arg: { data: { requestFingerprint: string } }) => {
        void arg;
        return {
          id: 'allocation',
          amount: new Prisma.Decimal('30.00'),
        };
      }),
    },
    settlementActualSourceSupplement: {
      findUnique: jest.fn(async (): Promise<unknown> => null),
      create: jest.fn(
        async (arg: { data: { id: string; sourceReference: string } }) => ({
          id: arg.data.id,
          sourceReference: arg.data.sourceReference,
        }),
      ),
    },
    settlementActualSourceClaim: {
      create: jest.fn(async () => ({})),
    },
    auditEvent: { create: jest.fn(async () => ({ id: 'audit' })) },
  };
  const db = {
    $transaction: jest.fn(
      async (work: (reader: typeof tx) => Promise<unknown>) => work(tx),
    ),
  } as unknown as DatabaseService;
  const access = {
    authorizeCase: jest.fn(async () => undefined),
  } as unknown as AccessControlService;
  const organization = {
    lockDepartment: jest.fn(async () => undefined),
  } as unknown as OrganizationService;
  return {
    db,
    tx,
    access,
    service: new SettlementActualService(db, access, organization),
  };
}

describe('SettlementActualService draft', () => {
  describe('registration occurred-on date', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      ['2026-10-28T15:59:59.999Z', '2026-10-27', true],
      ['2026-10-28T15:59:59.999Z', '2026-10-28', true],
      ['2026-10-28T15:59:59.999Z', '2026-10-29', false],
      ['2026-10-28T16:00:00.000Z', '2026-10-29', true],
      ['2026-10-28T16:00:00.000Z', '2026-10-30', false],
      ['2026-10-29T23:59:59.999Z', '2026-10-30', true],
    ])('at UTC %s accepts date %s = %s', async (now, occurredOn, allowed) => {
      jest.setSystemTime(new Date(now));
      const { service, tx } = setup();
      const operation = service.registerForCase(actor, {
        ...creation,
        occurredOn,
      });
      if (allowed) {
        await expect(operation).resolves.toMatchObject({
          allocatedAmount: '100.00',
        });
      } else {
        await expect(operation).rejects.toBeInstanceOf(BadRequestException);
        expect(tx.auditEvent.create).not.toHaveBeenCalled();
        expect(tx.settlementActualFact.create).not.toHaveBeenCalled();
        expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
      }
    });

    it('replays the same bound registration after the clock moves back without another write', async () => {
      jest.setSystemTime(new Date('2026-10-28T16:00:00Z'));
      const { service, tx } = setup();
      const result = await service.registerForCase(actor, creation);
      tx.settlementActualFact.findUnique.mockResolvedValue({
        ...tx.settlementActualFact.create.mock.calls[0]![0].data,
        amount: new Prisma.Decimal('100.00'),
      });
      tx.caseSettlementActualAllocation.findUnique.mockResolvedValue({
        ...tx.caseSettlementActualAllocation.create.mock.calls[0]![0].data,
        id: result.allocationId,
        factId: result.id,
        caseId: creation.caseId,
        amount: new Prisma.Decimal('100.00'),
      });
      jest.setSystemTime(new Date('2026-10-28T15:59:59Z'));
      await expect(service.registerForCase(actor, creation)).resolves.toEqual(
        result,
      );
      await expect(
        service.registerForCase(actor, {
          ...creation,
          occurredOn: '2026-10-30',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.settlementActualFact.create).toHaveBeenCalledTimes(1);
      expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a future unallocated fact without monetary or audit writes', async () => {
      jest.setSystemTime(new Date('2026-10-28T15:59:59Z'));
      const { service, tx } = setup();
      await expect(
        service.createFact(actor, { ...creation, occurredOn: '2026-10-30' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.settlementActualFact.create).not.toHaveBeenCalled();
      expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
    });
  });
  it.each(['0.1', '0.9', '0.10', '0.01', '9999999999999999.99'])(
    'accepts the positive decimal amount %s without losing cents',
    async (amount) => {
      const { service, tx } = setup();
      await service.registerForCase(actor, { ...creation, amount });
      expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: new Prisma.Decimal(amount) }),
      });
    },
  );

  it('totals 101 maximum-sized facts exactly beyond Decimal default precision', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `allocation-${index}`,
      factId: `fact-${index}`,
      caseId: 'case',
      side: 'CUSTOMER',
      amount: new Prisma.Decimal('9999999999999999.99'),
      fact: {
        sourceCaseId: 'case',
        partyId: 'customer-1',
        occurredOn: new Date('2026-10-29T00:00:00Z'),
        sourceReference: null,
        sourceSupplement: null,
      },
    }));
    const { service } = setup({ rows });
    await expect(
      service.caseActualDisplaySnapshot(actor, 'case'),
    ).resolves.toMatchObject({
      customerReceivedAmount: '1009999999999999998.99',
      lawyerInvoicedAmount: null,
    });
  });
  it.each([SettlementSideDtoValue.CUSTOMER, SettlementSideDtoValue.LAWYER])(
    'registers %s fact and full case allocation in one serializable transaction',
    async (side) => {
      const { service, tx, db } = setup();
      const result = await service.registerForCase(actor, {
        ...creation,
        side,
        amount: '0.01',
        ...(side === SettlementSideDtoValue.LAWYER
          ? { lawyerId: 'lawyer-1' }
          : {}),
      });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(result).toMatchObject({ amount: '0.01', allocatedAmount: '0.01' });
      expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          factId: result.id,
          id: result.allocationId,
          caseId: creation.caseId,
          amount: new Prisma.Decimal('0.01'),
          auditEventId: 'audit',
        }),
      });
      expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
      expect(tx.auditEvent.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          details: expect.objectContaining({
            command: 'REGISTER_CASE_ACTUAL',
            allocationId: result.allocationId,
          }),
        }),
      });
      expect(tx.auditEvent.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          details: expect.objectContaining({
            command: 'REGISTER_CASE_ACTUAL',
            allocationId: result.allocationId,
          }),
        }),
      });
      const factData = tx.settlementActualFact.create.mock.calls[0]![0].data;
      const allocationData =
        tx.caseSettlementActualAllocation.create.mock.calls[0]![0].data;
      tx.settlementActualFact.findUnique.mockResolvedValueOnce({
        ...factData,
        amount: new Prisma.Decimal('0.01'),
      });
      tx.caseSettlementActualAllocation.findUnique.mockResolvedValueOnce({
        ...allocationData,
        id: result.allocationId,
        factId: result.id,
        caseId: creation.caseId,
        amount: new Prisma.Decimal('0.01'),
      });
      await expect(
        service.registerForCase(actor, {
          ...creation,
          side,
          amount: '0.01',
          ...(side === SettlementSideDtoValue.LAWYER
            ? { lawyerId: 'lawyer-1' }
            : {}),
        }),
      ).resolves.toEqual(result);
      expect(tx.settlementActualFact.create).toHaveBeenCalledTimes(1);
      expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates allocation failure from the single transaction callback', async () => {
    const { service, tx, db } = setup();
    tx.caseSettlementActualAllocation.create.mockRejectedValueOnce(
      new Error('write failed'),
    );
    await expect(service.registerForCase(actor, creation)).rejects.toThrow(
      'write failed',
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('requires case-scoped read permission before registering either row', async () => {
    const { service, tx, access } = setup();
    jest
      .mocked(access.authorizeCase)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.registerForCase(actor, creation),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.settlementActualFact.create).not.toHaveBeenCalled();
    expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects reusing a create-only key for atomic registration', async () => {
    const { service, tx } = setup();
    await service.createFact(actor, creation);
    tx.settlementActualFact.findUnique.mockResolvedValueOnce({
      ...tx.settlementActualFact.create.mock.calls[0]![0].data,
      amount: new Prisma.Decimal(creation.amount),
    });
    await expect(
      service.registerForCase(actor, creation),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
  });

  it('creates a receipt with no source number and links the exact audit row', async () => {
    const { service, tx } = setup();
    await expect(service.createFact(actor, creation)).resolves.toMatchObject({
      amount: '100.00',
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'settlement.actual.created',
          details: expect.objectContaining({
            sourceReference: null,
            partyId: 'customer-1',
          }),
        }),
      }),
    );
    expect(tx.settlementActualFact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partyId: 'customer-1',
          sourceReference: null,
          auditEventId: 'audit',
        }),
      }),
    );
    expect(tx.settlementActualSourceClaim.create).not.toHaveBeenCalled();
  });

  it('claims a supplied source number before writing its fact', async () => {
    const { service, tx } = setup();
    await service.createFact(actor, {
      ...creation,
      sourceReference: 'bank-123',
    });
    expect(tx.settlementActualSourceClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceReference: 'bank-123',
        partyId: 'customer-1',
      }),
    });
    expect(
      tx.settlementActualSourceClaim.create.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.settlementActualFact.create.mock.invocationCallOrder[0]!);
  });

  it('maps a shared claim uniqueness collision to a conflict for either entry path', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError(
      'duplicate source claim',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
      },
    );
    const created = setup();
    created.tx.settlementActualSourceClaim.create.mockRejectedValueOnce(
      duplicate,
    );
    await expect(
      created.service.createFact(actor, {
        ...creation,
        sourceReference: 'bank-123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(created.tx.settlementActualFact.create).not.toHaveBeenCalled();
    const supplemented = setup();
    supplemented.tx.settlementActualSourceClaim.create.mockRejectedValueOnce(
      duplicate,
    );
    await expect(
      supplemented.service.supplementSource(actor, {
        factId: 'fact',
        sourceReference: 'bank-123',
        idempotencyKey: 'supplement-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      supplemented.tx.settlementActualSourceSupplement.create,
    ).not.toHaveBeenCalled();
  });

  it('replays a matching creation key without another write', async () => {
    const { service, tx } = setup();
    await service.createFact(actor, creation);
    const first = tx.settlementActualFact.create.mock.calls[0]![0];
    tx.settlementActualFact.findUnique.mockResolvedValueOnce({
      id: 'fact',
      amount: new Prisma.Decimal('100.00'),
      requestFingerprint: (
        first as unknown as { data: { requestFingerprint: string } }
      ).data.requestFingerprint,
    } as never);
    await expect(service.createFact(actor, creation)).resolves.toMatchObject({
      id: 'fact',
    });
    expect(tx.settlementActualFact.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('replays a lawyer fact after reassignment, but still checks owner and fingerprint', async () => {
    const options: { lawyers: string[]; owner?: string } = {
      lawyers: ['lawyer-1'],
    };
    const { service, tx } = setup(options);
    const lawyerInput = {
      ...creation,
      side: SettlementSideDtoValue.LAWYER,
      lawyerId: 'lawyer-1',
    };
    await service.createFact(actor, lawyerInput);
    const first = tx.settlementActualFact.create.mock
      .calls[0]![0] as unknown as { data: { requestFingerprint: string } };
    const old = {
      id: 'fact',
      amount: new Prisma.Decimal('100.00'),
      requestFingerprint: first.data.requestFingerprint,
    };
    options.lawyers = [];
    tx.settlementActualFact.findUnique.mockResolvedValue(old as never);
    await expect(service.createFact(actor, lawyerInput)).resolves.toMatchObject(
      { id: 'fact' },
    );
    await expect(
      service.createFact(actor, { ...lawyerInput, amount: '101.00' }),
    ).rejects.toThrow();
    options.owner = 'other';
    await expect(service.createFact(actor, lawyerInput)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.settlementActualFact.create).toHaveBeenCalledTimes(1);
  });

  it('allows a second case owner to allocate a partial amount to the same customer', async () => {
    const { service, tx, access } = setup();
    await expect(service.allocate(actor, allocation)).resolves.toMatchObject({
      caseId: 'case',
      amount: '30.00',
    });
    expect(access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.read',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: undefined,
      },
      tx,
    );
    expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          factId: 'fact',
          auditEventId: 'audit',
        }),
      }),
    );
  });

  it('replays a matching allocation key without a second allocation', async () => {
    const { service, tx } = setup();
    await service.allocate(actor, allocation);
    const first = tx.caseSettlementActualAllocation.create.mock
      .calls[0]![0] as unknown as { data: { requestFingerprint: string } };
    tx.caseSettlementActualAllocation.findUnique.mockResolvedValueOnce({
      id: 'allocation',
      caseId: 'case',
      amount: new Prisma.Decimal('30.00'),
      requestFingerprint: first.data.requestFingerprint,
    } as never);
    await expect(service.allocate(actor, allocation)).resolves.toMatchObject({
      id: 'allocation',
    });
    expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('replays a lawyer allocation after reassignment, but rejects changed key body and owner', async () => {
    const options: {
      lawyers: string[];
      owner?: string;
      factSide: 'LAWYER';
      factPartyId: string;
    } = {
      lawyers: ['lawyer-1'],
      factSide: 'LAWYER',
      factPartyId: 'lawyer-1',
    };
    const { service, tx } = setup(options);
    await service.allocate(actor, allocation);
    const first = tx.caseSettlementActualAllocation.create.mock
      .calls[0]![0] as unknown as { data: { requestFingerprint: string } };
    const old = {
      id: 'allocation',
      caseId: 'case',
      amount: new Prisma.Decimal('30.00'),
      requestFingerprint: first.data.requestFingerprint,
    };
    options.lawyers = [];
    tx.caseSettlementActualAllocation.findUnique.mockResolvedValue(
      old as never,
    );
    await expect(service.allocate(actor, allocation)).resolves.toMatchObject({
      id: 'allocation',
    });
    await expect(
      service.allocate(actor, { ...allocation, amount: '31.00' }),
    ).rejects.toThrow();
    options.owner = 'other';
    await expect(service.allocate(actor, allocation)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledTimes(1);
  });

  it('adds a missing source number as an audited event and replays the same key', async () => {
    const { service, tx } = setup();
    const command = {
      factId: 'fact',
      sourceReference: 'bank-123',
      idempotencyKey: 'supplement-1',
    };
    await expect(
      service.supplementSource(actor, command),
    ).resolves.toMatchObject({ factId: 'fact', sourceReference: 'bank-123' });
    const first = tx.settlementActualSourceSupplement.create.mock
      .calls[0]![0] as unknown as { data: { requestFingerprint: string } };
    expect(tx.settlementActualFact.create).not.toHaveBeenCalled();
    expect(tx.settlementActualSourceSupplement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          auditEventId: 'audit',
          sourceReference: 'bank-123',
        }),
      }),
    );
    expect(tx.settlementActualSourceClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        factId: 'fact',
        sourceReference: 'bank-123',
      }),
    });
    tx.settlementActualSourceSupplement.findUnique.mockResolvedValue({
      id: 'supplement',
      factId: 'fact',
      sourceReference: 'bank-123',
      requestFingerprint: first.data.requestFingerprint,
    } as never);
    await expect(
      service.supplementSource(actor, command),
    ).resolves.toMatchObject({ id: 'supplement' });
    await expect(
      service.supplementSource(actor, {
        ...command,
        sourceReference: 'bank-456',
      }),
    ).rejects.toThrow();
    expect(tx.settlementActualSourceSupplement.create).toHaveBeenCalledTimes(1);
  });

  it('shows the appended number without changing the original fact or counted amount', async () => {
    const group = setup({
      rows: [
        {
          id: 'allocation',
          factId: 'fact',
          caseId: 'case',
          side: 'CUSTOMER',
          amount: new Prisma.Decimal('30.00'),
          fact: {
            sourceCaseId: 'source',
            partyId: 'customer-1',
            occurredOn: new Date('2026-10-29T00:00:00Z'),
            sourceReference: null,
            sourceSupplement: { sourceReference: 'bank-later' },
          },
        },
      ],
    });
    await expect(
      group.service.caseActualDisplaySnapshot(actor, 'case'),
    ).resolves.toMatchObject({
      customerReceivedAmount: '30.00',
      allocations: [
        { sourceReference: 'bank-later', registeredCaseId: 'source' },
      ],
    });
  });

  it('rejects source supplementation without ownership or when original fact already has a number', async () => {
    const command = {
      factId: 'fact',
      sourceReference: 'bank-123',
      idempotencyKey: 'supplement-1',
    };
    const other = setup({ owner: 'other' });
    await expect(
      other.service.supplementSource(actor, command),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const numbered = setup({ sourceReference: 'bank-original' });
    await expect(
      numbered.service.supplementSource(actor, command),
    ).rejects.toThrow();
    expect(
      numbered.tx.settlementActualSourceSupplement.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects over-allocation, another customer, another case owner and external users', async () => {
    const excess = setup({ allocated: '80.00' });
    await expect(
      excess.service.allocate(actor, allocation),
    ).rejects.toBeInstanceOf(BadRequestException);
    const cross = setup({ customer: 'other' });
    await expect(
      cross.service.allocate(actor, allocation),
    ).rejects.toBeInstanceOf(BadRequestException);
    const other = setup({ owner: 'other' });
    await expect(
      other.service.allocate(actor, allocation),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const external = setup();
    await expect(
      external.service.allocate(
        { ...actor, clientCustomerId: 'customer' },
        allocation,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    for (const item of [excess, cross, other, external])
      expect(
        item.tx.caseSettlementActualAllocation.create,
      ).not.toHaveBeenCalled();
  });

  it('marks absent case records unknown and preserves registered allocation details', async () => {
    const empty = setup();
    await expect(
      empty.service.caseActualDisplaySnapshot(actor, 'case'),
    ).resolves.toMatchObject({
      readPurpose: 'DISPLAY_ONLY',
      customerReceiptState: 'UNKNOWN',
      lawyerInvoiceState: 'UNKNOWN',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    });
    const filled = setup({
      rows: [
        {
          id: 'allocation',
          factId: 'fact',
          caseId: 'case',
          side: 'CUSTOMER',
          amount: new Prisma.Decimal('30.00'),
          fact: {
            sourceCaseId: 'source',
            partyId: 'customer-1',
            occurredOn: new Date('2026-10-29T00:00:00Z'),
            sourceReference: null,
          },
        },
      ],
    });
    await expect(
      filled.service.caseActualDisplaySnapshot(actor, 'case'),
    ).resolves.toMatchObject({
      customerReceiptState: 'RECORDED',
      customerReceivedAmount: '30.00',
      lawyerInvoiceState: 'UNKNOWN',
      lawyerInvoicedAmount: null,
      allocations: [{ factId: 'fact', sourceReference: null }],
    });
  });

  it('aggregates a main case by allocation ID and keeps both source case IDs', async () => {
    const sharedFact = {
      sourceCaseId: 'origin',
      partyId: 'customer-1',
      occurredOn: new Date('2026-10-29T00:00:00Z'),
      sourceReference: null,
    };
    const main = setup({
      membership: { consolidationId: 'group', isMain: true },
      members: [
        { caseId: 'case', departmentId: 'department', isMain: true },
        { caseId: 'original', departmentId: 'department', isMain: false },
      ],
      rows: [
        {
          id: 'allocation-1',
          caseId: 'case',
          factId: 'shared-fact',
          side: 'CUSTOMER',
          amount: new Prisma.Decimal('20.00'),
          fact: sharedFact,
        },
        {
          id: 'allocation-2',
          caseId: 'original',
          factId: 'shared-fact',
          side: 'CUSTOMER',
          amount: new Prisma.Decimal('30.00'),
          fact: sharedFact,
        },
        {
          id: 'allocation-2',
          caseId: 'original',
          factId: 'shared-fact',
          side: 'CUSTOMER',
          amount: new Prisma.Decimal('30.00'),
          fact: sharedFact,
        },
      ],
    });
    await expect(
      main.service.caseActualDisplaySnapshot(actor, 'case'),
    ).resolves.toMatchObject({
      countedCaseIds: ['case', 'original'],
      customerReceivedAmount: '50.00',
      allocations: [
        {
          id: 'allocation-1',
          factId: 'shared-fact',
          registeredCaseId: 'origin',
          allocatedCaseId: 'case',
        },
        {
          id: 'allocation-2',
          factId: 'shared-fact',
          registeredCaseId: 'origin',
          allocatedCaseId: 'original',
        },
      ],
    });
    expect(main.tx.caseConsolidation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mainCaseId: 'case',
          departmentId: 'department',
        }),
      }),
    );
  });

  it('keeps an original case and an independent case scoped to themselves', async () => {
    const original = setup({
      membership: { consolidationId: 'group', isMain: false },
    });
    await expect(
      original.service.caseActualDisplaySnapshot(actor, 'original'),
    ).resolves.toMatchObject({
      countedCaseIds: ['original'],
      customerReceiptState: 'UNKNOWN',
    });
    expect(original.tx.caseConsolidation.findFirst).not.toHaveBeenCalled();
    const independent = setup();
    await expect(
      independent.service.caseActualDisplaySnapshot(actor, 'case'),
    ).resolves.toMatchObject({
      countedCaseIds: ['case'],
      customerReceiptState: 'UNKNOWN',
    });
    expect(independent.tx.caseConsolidation.findFirst).not.toHaveBeenCalled();
  });

  it('rejects main aggregation when any member is outside the actor ownership range', async () => {
    const group = setup({
      membership: { consolidationId: 'group', isMain: true },
      members: [
        { caseId: 'case', departmentId: 'department', isMain: true },
        { caseId: 'original', departmentId: 'department', isMain: false },
      ],
      ownerByCase: { original: 'another-operator' },
    });
    await expect(
      group.service.caseActualDisplaySnapshot(actor, 'case'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      group.tx.caseSettlementActualAllocation.findMany,
    ).not.toHaveBeenCalled();
  });

  it('rejects a malformed cross-department member before reading amounts', async () => {
    const group = setup({
      membership: { consolidationId: 'group', isMain: true },
      members: [
        { caseId: 'case', departmentId: 'department', isMain: true },
        {
          caseId: 'foreign',
          departmentId: 'another-department',
          isMain: false,
        },
      ],
    });
    await expect(
      group.service.caseActualDisplaySnapshot(actor, 'case'),
    ).rejects.toThrow();
    expect(
      group.tx.caseSettlementActualAllocation.findMany,
    ).not.toHaveBeenCalled();
  });

  describe('main-case aggregate display without original-case detail access', () => {
    const members = [
      { caseId: 'case', departmentId: actor.departmentId, isMain: true },
      { caseId: 'original', departmentId: actor.departmentId, isMain: false },
    ];
    const aggregateSetup = (options: Parameters<typeof setup>[0] = {}) =>
      setup({
        membership: { consolidationId: 'group', isMain: true },
        members,
        ...options,
      });
    const moneyRow = (
      id: string,
      caseId: string,
      side: SideForTest,
      amount: string,
    ) => ({
      id,
      caseId,
      side,
      amount: new Prisma.Decimal(amount),
      factId: 'private-fact',
      fact: {
        sourceCaseId: 'private-source',
        sourceReference: 'private-reference',
        partyId: 'private-party',
        occurredOn: new Date(),
      },
    });
    type SideForTest = 'CUSTOMER' | 'LAWYER';

    it.each([actor.userId, 'another-operator'])(
      'counts unique allocations with source owner %s and returns only totals',
      async (owner) => {
        const duplicate = moneyRow(
          'private-allocation-2',
          'original',
          'CUSTOMER',
          '30.01',
        );
        const group = aggregateSetup({
          ownerByCase: { original: owner },
          rows: [
            moneyRow('private-allocation-1', 'case', 'CUSTOMER', '20.02'),
            duplicate,
            duplicate,
            moneyRow('private-allocation-3', 'original', 'LAWYER', '10.99'),
          ],
        });
        const result = await group.service.caseActualAggregateDisplaySnapshot(
          actor,
          'case',
        );
        expect(result).toEqual({
          readPurpose: 'DISPLAY_ONLY',
          aggregateScope: 'CONSOLIDATION',
          caseId: 'case',
          customerReceiptState: 'RECORDED',
          lawyerInvoiceState: 'RECORDED',
          customerReceivedAmount: '50.03',
          lawyerInvoicedAmount: '10.99',
        });
        expect(JSON.stringify(result)).not.toMatch(
          /original|private|allocations|countedCaseIds/u,
        );
        expect(
          group.tx.caseSettlementActualAllocation.findMany,
        ).toHaveBeenCalledWith({
          where: {
            caseId: { in: ['case', 'original'] },
            departmentId: actor.departmentId,
          },
          select: { id: true, side: true, amount: true },
          orderBy: { id: 'asc' },
        });
        expect(group.access.authorizeCase).toHaveBeenCalledTimes(1);
        expect(group.access.authorizeCase).toHaveBeenCalledWith(
          actor,
          'case.read',
          {
            departmentId: actor.departmentId,
            responsibleUserId: actor.userId,
          },
          group.tx,
        );
        expect(group.tx.case.findFirst).not.toHaveBeenCalled();
        const sql = group.tx.$queryRaw.mock.calls.map(([strings]) =>
          strings.join(''),
        );
        expect(
          sql.findIndex((query) =>
            query.includes('SELECT case_id,department_id,is_main'),
          ),
        ).toBeLessThan(
          sql.findIndex((query) => query.includes('FOR UPDATE OF c')),
        );
        expect(
          sql.find((query) => query.includes('FOR UPDATE OF c')),
        ).toContain('ORDER BY c.id');
        expect(
          sql.find((query) =>
            query.includes('SELECT case_id,department_id,is_main'),
          ),
        ).not.toContain('AND department_id');
        expect(group.db.$transaction).toHaveBeenCalledWith(
          expect.any(Function),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      },
    );

    it('preserves cents when aggregate totals exceed a fact numeric precision', async () => {
      const group = aggregateSetup({
        rows: [
          moneyRow(
            'large-1',
            'case',
            'CUSTOMER',
            '9999999999999999999999999999.99',
          ),
          moneyRow(
            'large-2',
            'original',
            'CUSTOMER',
            '9999999999999999999999999999.99',
          ),
        ],
      });
      await expect(
        group.service.caseActualAggregateDisplaySnapshot(actor, 'case'),
      ).resolves.toMatchObject({
        customerReceivedAmount: '19999999999999999999999999999.98',
        lawyerInvoicedAmount: null,
        lawyerInvoiceState: 'UNKNOWN',
      });
    });

    it('marks missing actual allocations unknown', async () => {
      const group = aggregateSetup();
      await expect(
        group.service.caseActualAggregateDisplaySnapshot(actor, 'case'),
      ).resolves.toMatchObject({
        customerReceivedAmount: null,
        lawyerInvoicedAmount: null,
        customerReceiptState: 'UNKNOWN',
        lawyerInvoiceState: 'UNKNOWN',
      });
    });

    it.each([
      { members: [members[0], { ...members[1], departmentId: 'foreign' }] },
      { members: [members[0], members[1], members[1]] },
      { members: [members[0], { ...members[1], isMain: true }] },
      { members: [members[1]] },
      { missingLockedCase: true },
      {
        aggregateHeads: [
          { id: 'other-group', department_id: actor.departmentId },
        ],
      },
      { aggregateHeads: [{ id: 'group', department_id: 'foreign' }] },
      { changedMembers: [members[0], { ...members[1], caseId: 'changed' }] },
      { membership: { consolidationId: 'group', isMain: false } },
      { membership: null },
    ])(
      'refuses malformed or changed consolidation before reading amounts: %j',
      async (options) => {
        const group = aggregateSetup(options);
        await expect(
          group.service.caseActualAggregateDisplaySnapshot(actor, 'case'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(
          group.tx.caseSettlementActualAllocation.findMany,
        ).not.toHaveBeenCalled();
      },
    );

    it('rejects conflicting duplicate allocation evidence', async () => {
      const group = aggregateSetup({
        rows: [
          moneyRow('same', 'case', 'CUSTOMER', '1.01'),
          moneyRow('same', 'original', 'CUSTOMER', '1.02'),
        ],
      });
      await expect(
        group.service.caseActualAggregateDisplaySnapshot(actor, 'case'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires the main owner and its current case.read permission', async () => {
      const other = aggregateSetup({
        ownerByCase: { case: 'another-operator' },
      });
      await expect(
        other.service.caseActualAggregateDisplaySnapshot(actor, 'case'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        other.tx.caseSettlementActualAllocation.findMany,
      ).not.toHaveBeenCalled();
      const denied = aggregateSetup();
      jest
        .mocked(denied.access.authorizeCase)
        .mockRejectedValueOnce(new ForbiddenException());
      await expect(
        denied.service.caseActualAggregateDisplaySnapshot(actor, 'case'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        denied.tx.caseSettlementActualAllocation.findMany,
      ).not.toHaveBeenCalled();
      const stale = aggregateSetup();
      await expect(
        stale.service.caseActualAggregateDisplaySnapshot(
          { ...actor, authorizationRevision: 2 },
          'case',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        stale.tx.caseSettlementActualAllocation.findMany,
      ).not.toHaveBeenCalled();
      const external = aggregateSetup();
      await expect(
        external.service.caseActualAggregateDisplaySnapshot(
          { ...actor, lawyerAccountId: actor.userId },
          'case',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        external.tx.caseSettlementActualAllocation.findMany,
      ).not.toHaveBeenCalled();
    });

    it('does not grant source-case details after a successful main aggregate', async () => {
      const group = aggregateSetup({
        ownerByCase: { original: 'another-operator' },
      });
      await group.service.caseActualAggregateDisplaySnapshot(actor, 'case');
      await expect(
        group.service.caseActualDisplaySnapshot(actor, 'original'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('does not insert a fact or allocation when audit creation fails', async () => {
    const created = setup();
    created.tx.auditEvent.create.mockRejectedValueOnce(
      new Error('audit failure'),
    );
    await expect(created.service.createFact(actor, creation)).rejects.toThrow(
      'audit failure',
    );
    expect(created.tx.settlementActualFact.create).not.toHaveBeenCalled();
    const allocated = setup();
    allocated.tx.auditEvent.create.mockRejectedValueOnce(
      new Error('audit failure'),
    );
    await expect(allocated.service.allocate(actor, allocation)).rejects.toThrow(
      'audit failure',
    );
    expect(
      allocated.tx.caseSettlementActualAllocation.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects the transaction when a fact or allocation insert fails after audit', async () => {
    const created = setup();
    created.tx.settlementActualFact.create.mockRejectedValueOnce(
      new Error('fact insert failed'),
    );
    await expect(created.service.createFact(actor, creation)).rejects.toThrow(
      'fact insert failed',
    );
    expect(created.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    const allocated = setup();
    allocated.tx.caseSettlementActualAllocation.create.mockRejectedValueOnce(
      new Error('allocation insert failed'),
    );
    await expect(allocated.service.allocate(actor, allocation)).rejects.toThrow(
      'allocation insert failed',
    );
    expect(allocated.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('does not mark separate fact or allocation commands as case registration', async () => {
    const created = setup();
    await created.service.createFact(actor, creation);
    expect(created.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'settlement.actual.created',
        details: expect.not.objectContaining({ command: expect.anything() }),
      }),
    });
    const allocated = setup();
    await allocated.service.allocate(actor, allocation);
    expect(allocated.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'settlement.actual.allocated',
        details: expect.not.objectContaining({ command: expect.anything() }),
      }),
    });
  });
});

describe('actual allocation source authorization', () => {
  it('rejects facts recorded by another actor before receipt or writes', async () => {
    const { service, tx } = setup();
    const fact = await tx.settlementActualFact.findFirst();
    tx.settlementActualFact.findFirst.mockResolvedValue({
      ...fact,
      actorUserId: 'other',
    });
    await expect(service.allocate(actor, allocation)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
  });
  it('rejects a source case outside the current owner scope', async () => {
    const { service, tx } = setup({ ownerByCase: { source: 'other' } });
    await expect(service.allocate(actor, allocation)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
  });
});

describe('actual allocation candidates', () => {
  it('lists only current actor, same party and owner-scoped facts with the actual remaining amount', async () => {
    const { service, tx } = setup({ allocated: '30.00' });
    await expect(service.allocationCandidates(actor, 'case')).resolves.toEqual([
      {
        id: 'fact',
        side: 'CUSTOMER',
        amount: '100.00',
        remainingAmount: '70.00',
        occurredOn: '2020-01-02',
        sourceReference: null,
      },
    ]);
    expect(tx.settlementActualFact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          sourceCase: {
            responsibleUserId: actor.userId,
            departmentId: actor.departmentId,
          },
          OR: [
            { side: 'CUSTOMER', partyId: 'customer-1' },
            { side: 'LAWYER', partyId: { in: ['lawyer-1'] } },
          ],
        }),
      }),
    );
  });
  it('withholds a fact when source case authorization is refused', async () => {
    const { service } = setup({ ownerByCase: { source: 'other' } });
    await expect(service.allocationCandidates(actor, 'case')).resolves.toEqual(
      [],
    );
  });
  it('withholds exhausted facts', async () => {
    const { service } = setup({ allocated: '100.00' });
    await expect(service.allocationCandidates(actor, 'case')).resolves.toEqual(
      [],
    );
  });
});

describe('actual facts date and transaction conflict boundaries', () => {
  afterEach(() => jest.useRealTimers());
  it('replays an unallocated fact across a backwards Shanghai-day clock boundary without another write', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-28T16:00:00Z'));
    const { service, tx } = setup();
    const result = await service.createFact(actor, creation);
    tx.settlementActualFact.findUnique.mockResolvedValue({
      ...tx.settlementActualFact.create.mock.calls[0]![0].data,
      amount: new Prisma.Decimal('100.00'),
    });
    jest.setSystemTime(new Date('2026-10-28T15:59:59Z'));
    await expect(service.createFact(actor, creation)).resolves.toEqual(result);
    expect(tx.settlementActualFact.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
  });
  it('withholds future historical facts from candidates and rejects a new allocation without writes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-28T15:59:59Z'));
    const { service, tx } = setup();
    const future = {
      ...(await tx.settlementActualFact.findFirst()),
      occurredOn: new Date('2026-10-29T00:00:00Z'),
    };
    tx.settlementActualFact.findFirst.mockResolvedValue(future);
    tx.settlementActualFact.findMany.mockResolvedValue([future]);
    await expect(service.allocationCandidates(actor, 'case')).resolves.toEqual(
      [],
    );
    await expect(service.allocate(actor, allocation)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(tx.caseSettlementActualAllocation.create).not.toHaveBeenCalled();
    expect(tx.settlementActualFact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          occurredOn: { lte: new Date('2026-10-28T00:00:00Z') },
        }),
      }),
    );
  });
  it('replays a bound allocation after a backwards clock change without allocating again', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-28T16:00:00Z'));
    const { service, tx } = setup();
    const fact = {
      ...(await tx.settlementActualFact.findFirst()),
      occurredOn: new Date('2026-10-29T00:00:00Z'),
    };
    tx.settlementActualFact.findFirst.mockResolvedValue(fact);
    const first = await service.allocate(actor, allocation);
    tx.caseSettlementActualAllocation.findUnique.mockResolvedValue({
      ...tx.caseSettlementActualAllocation.create.mock.calls[0]![0].data,
      id: first.id,
      caseId: allocation.caseId,
      amount: new Prisma.Decimal('30.00'),
    });
    jest.setSystemTime(new Date('2026-10-28T15:59:59Z'));
    await expect(service.allocate(actor, allocation)).resolves.toEqual(first);
    expect(tx.caseSettlementActualAllocation.create).toHaveBeenCalledTimes(1);
  });
  it.each(['40001', '40P01', '55P03'])(
    'maps nested real-driver %s to a single-attempt 409 for all actual commands',
    async (code) => {
      for (const command of [
        'create',
        'register',
        'allocate',
        'candidates',
        'supplement',
      ] as const) {
        const { service, db } = setup();
        const failure = new Prisma.PrismaClientKnownRequestError(
          'raw conflict',
          {
            code: 'P2010',
            clientVersion: '7.10.0',
            meta: { driverAdapterError: { cause: { originalCode: code } } },
          },
        );
        const transaction = jest
          .spyOn(db, '$transaction')
          .mockRejectedValueOnce(failure);
        const result =
          command === 'create'
            ? service.createFact(actor, creation)
            : command === 'register'
              ? service.registerForCase(actor, creation)
              : command === 'allocate'
                ? service.allocate(actor, allocation)
                : command === 'candidates'
                  ? service.allocationCandidates(actor, 'case')
                  : service.supplementSource(actor, {
                      factId: 'fact',
                      sourceReference: 'ref',
                      idempotencyKey: 'supplement',
                    });
        await expect(result).rejects.toMatchObject({
          status: 409,
          response: { code: 'ACTUAL_SETTLEMENT_CHANGED' },
        });
        expect(transaction).toHaveBeenCalledTimes(1);
      }
    },
  );
  it('does not relabel an integrity failure as a retryable conflict', async () => {
    const { service, db } = setup();
    const failure = new Prisma.PrismaClientKnownRequestError('integrity', {
      code: 'P2010',
      clientVersion: '7.10.0',
      meta: { code: '23514' },
    });
    jest.spyOn(db, '$transaction').mockRejectedValueOnce(failure);
    await expect(service.allocate(actor, allocation)).rejects.toBe(failure);
  });
});
