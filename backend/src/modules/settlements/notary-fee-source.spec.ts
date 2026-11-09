import { Prisma } from '../../generated/prisma/client';
import { initializeNotaryFees } from './notary-fee-source';

const facts = {
  departmentId: 'department',
  matterId: 'matter',
  caseId: 'case',
  certificateId: 'certificate',
  sourceActionEventId: 'issuance-audit',
};
const date = new Date('2026-10-17T00:00:00.000Z');

function setup() {
  const certificate = {
    id: facts.certificateId,
    actorUserId: 'real-notary-actor',
    notaryOfficeAccountBindingId: 'real-binding',
    fromVersion: 4,
    toVersion: 5,
    certificateDate: date,
    sampleFeeAmount: null,
    fees: [
      { category: 'NOTARY', state: 'KNOWN', amount: new Prisma.Decimal(0) },
      { category: 'INVESTIGATION', state: 'PENDING', amount: null },
      {
        category: 'DISCLOSURE',
        state: 'KNOWN',
        amount: new Prisma.Decimal('25.30'),
      },
    ],
    matter: {
      evidence: {
        matterId: facts.matterId,
        departmentId: facts.departmentId,
        evidenceAt: date,
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: new Prisma.Decimal('19.99'),
      },
    },
  };
  const event = {
    id: facts.sourceActionEventId,
    actorUserId: certificate.actorUserId,
    notaryOfficeAccountBindingId: certificate.notaryOfficeAccountBindingId,
    details: {
      certificateId: facts.certificateId,
      fromVersion: 4,
      toVersion: 5,
    },
  };
  const tx = {
    notaryCertificate: { findFirst: jest.fn().mockResolvedValue(certificate) },
    notaryMatter: {
      findFirst: jest.fn().mockResolvedValue({ case: { id: facts.caseId } }),
    },
    notaryMatterCost: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    case: { findFirst: jest.fn().mockResolvedValue({ id: facts.caseId }) },
    feeRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'fee',
        ...data,
      })),
    },
    auditEvent: {
      findFirst: jest.fn().mockResolvedValue(event),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    tx,
    certificate,
    event,
    run: () =>
      initializeNotaryFees(tx as unknown as Prisma.TransactionClient, facts),
  };
}

describe('trusted notary fee projection', () => {
  it('ties proxy fee source audits to the real internal issuer', async () => {
    const test = setup();
    test.certificate.actorUserId = 'operator-1';
    test.certificate.notaryOfficeAccountBindingId = null as never;
    (
      test.certificate as typeof test.certificate & {
        internalActorUserId: string;
      }
    ).internalActorUserId = 'operator-1';
    test.event.actorUserId = 'operator-1';
    test.event.notaryOfficeAccountBindingId = null as never;
    (
      test.event as typeof test.event & { internalActorUserId: string }
    ).internalActorUserId = 'operator-1';
    await test.run();
    expect(test.tx.auditEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actorUserId: 'operator-1',
          internalActorUserId: 'operator-1',
          notaryOfficeAccountBindingId: null,
        }),
      }),
    );
    expect(test.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'operator-1',
          internalActorUserId: 'operator-1',
          notaryOfficeAccountBindingId: null,
        }),
      }),
    );
  });
  it('keeps explicit zero and real dates, skips pending, and never invents an internal fee actor or payment', async () => {
    const test = setup();
    await expect(test.run()).resolves.toEqual({ createdCount: 3 });
    const rows = test.tx.feeRecord.create.mock.calls.map(
      ([input]) => input.data,
    );
    expect(rows.map((row) => row.sourceId)).toEqual([
      'matter:sample',
      'matter:notary',
      'certificate:DISCLOSURE',
    ]);
    expect((rows[1].amount as Prisma.Decimal).toFixed(2)).toBe('0.00');
    for (const row of rows)
      expect(row).toMatchObject({
        source: 'auto',
        status: '未发起',
        feeDate: date,
      });
    expect(test.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'real-notary-actor',
          notaryOfficeAccountBindingId: 'real-binding',
        }),
      }),
    );
  });

  it('preserves a pending historical sample cost when certificate has no sample override', async () => {
    const test = setup();
    test.certificate.sampleFeeAmount = undefined as never;
    test.certificate.matter.evidence.sampleFeeState = 'PENDING';
    test.certificate.matter.evidence.sampleFeeAmount = null as never;
    await expect(test.run()).resolves.toEqual({ createdCount: 2 });
    expect(test.tx.notaryMatterCost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'SAMPLE',
          state: 'PENDING',
          amount: null,
        }),
      }),
    );
    expect(
      test.tx.feeRecord.create.mock.calls.map(([input]) => input.data.sourceId),
    ).toEqual(['matter:notary', 'certificate:DISCLOSURE']);
  });

  it('requires a real issued case before touching fees', async () => {
    const test = setup();
    test.tx.notaryCertificate.findFirst.mockResolvedValue(null);
    await expect(test.run()).rejects.toMatchObject({
      response: { code: 'FEE_SOURCE_INVALID' },
    });
    expect(test.tx.feeRecord.create).not.toHaveBeenCalled();
  });

  it.each(['certificateId', 'fromVersion', 'toVersion'])(
    'rejects a mismatched original issuance %s',
    async (key) => {
      const test = setup();
      test.tx.auditEvent.findFirst.mockResolvedValue({
        ...test.event,
        details: { ...test.event.details, [key]: 'wrong' },
      });
      await expect(test.run()).rejects.toMatchObject({
        response: { code: 'FEE_SOURCE_INVALID' },
      });
      expect(test.tx.feeRecord.create).not.toHaveBeenCalled();
    },
  );

  it('replays stable origins without reviving removed rows', async () => {
    const test = setup();
    test.tx.feeRecord.findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { departmentId_sourceKind_sourceId: { sourceId: string } };
      }) => {
        const key = where.departmentId_sourceKind_sourceId.sourceId;
        return {
          id: 'existing-fee',
          caseId: facts.caseId,
          notaryMatterId: facts.matterId,
          source: 'auto',
          direction: '支出',
          status: '未发起',
          type: key.endsWith('notary')
            ? '公证费'
            : key.endsWith('DISCLOSURE')
              ? '披露费'
              : '样品费',
          amount: new Prisma.Decimal(
            key.endsWith('notary')
              ? 0
              : key.endsWith('DISCLOSURE')
                ? '25.30'
                : '19.99',
          ),
          feeDate: date,
          deletedAt: date,
        };
      },
    );
    await expect(test.run()).resolves.toEqual({ createdCount: 0 });
    expect(test.tx.feeRecord.create).not.toHaveBeenCalled();
    expect(test.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a stable source identity already attached to another case', async () => {
    const test = setup();
    test.tx.feeRecord.findUnique.mockResolvedValue({
      caseId: 'another-case',
      notaryMatterId: 'another-matter',
    });
    await expect(test.run()).rejects.toMatchObject({
      response: { code: 'FEE_SOURCE_INVALID' },
    });
    expect(test.tx.feeRecord.create).not.toHaveBeenCalled();
  });
});
