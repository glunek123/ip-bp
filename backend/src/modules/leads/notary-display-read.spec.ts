import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  notaryDisplayCapabilities,
  notaryDisplayFee,
  notaryTransferredDate,
  readNotaryDisplay,
} from './notary-display-read';

const actor: ActorContext = {
  userId: 'operator',
  departmentId: 'department',
  authorizationRevision: 1,
};
function fixture() {
  const matter = {
    id: 'matter',
    departmentId: actor.departmentId,
    customerId: 'customer',
    rightsHolderId: 'rights-holder',
    stage: 'WAITING_RETURN' as const,
    evidenceMode: 'ONLINE_PURCHASE',
    createdAt: new Date('2026-10-12T16:00:00Z'),
    sourceLead: {
      platform: 'TAOBAO' as const,
      shopName: '同名但精确关联的店铺',
      shopExternalId: null,
      responsibleUserId: actor.userId,
      teamId: 'team',
    },
    evidence: {
      evidenceAt: new Date('2026-10-11'),
      sampleFeeState: 'KNOWN' as const,
      sampleFeeAmount: new Prisma.Decimal('0'),
    },
    opening: { senderName: null, senderPhone: '123', senderAddress: null },
    openingReviewDecision: {
      result: 'INFRINGEMENT',
      reason: null,
      archivedAt: null,
    },
    issuanceDecision: { decision: 'NO_ISSUE' },
    certificate: {
      id: 'certificate',
      certificateNo: '沪证字真实编号',
      certificateDate: new Date('2026-10-13'),
      issuedAt: new Date('2026-10-13T01:00:00Z'),
      needDisclose: true,
      fees: [
        {
          category: 'NOTARY',
          state: 'KNOWN' as const,
          amount: new Prisma.Decimal('1234567890123456.78'),
        },
        { category: 'INVESTIGATION', state: 'PENDING' as const, amount: null },
      ],
    },
  };
  const database = {
    customer: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: matter.customerId, name: '客户原名' }),
    },
    rightsHolder: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: matter.rightsHolderId, name: '主体原名' }),
    },
    case: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'case',
        businessNo: 'CA-真实',
        stage: 'PENDING_MATCH',
      }),
    },
    materialReference: {
      findMany: jest.fn().mockResolvedValue([
        {
          contentVersionId: 'frozen',
          actionEvent: { details: { contentVersionIds: ['frozen'] } },
        },
        {
          contentVersionId: 'frozen',
          actionEvent: { details: { contentVersionIds: ['frozen'] } },
        },
        {
          contentVersionId: 'draft',
          actionEvent: { details: { contentVersionIds: ['frozen'] } },
        },
        { contentVersionId: 'unsubmitted', actionEvent: null },
      ]),
    },
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    authorizeLead: jest.fn().mockResolvedValue(undefined),
  };
  const read = () =>
    readNotaryDisplay(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
      actor,
      matter,
    );
  return { database, access, matter, read };
}

describe('notary display read', () => {
  it('keeps unrecorded evidence, opening, certificate and fees null without querying photographs', async () => {
    const { database, access, matter } = fixture();
    const result = await readNotaryDisplay(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
      actor,
      { ...matter, evidence: null, opening: null, certificate: null },
    );
    expect(result).toMatchObject({
      evidenceAt: null,
      openingSummary: null,
      certificateSummary: null,
      fees: {
        notary: { state: 'UNRECORDED', amount: null },
        investigation: { state: 'UNRECORDED', amount: null },
        sample: { state: 'UNRECORDED', amount: null },
      },
    });
    expect(database.materialReference.findMany).not.toHaveBeenCalled();
  });
  it('keeps precise sources, Shanghai handoff day, business dates, decimal fees and frozen photo count', async () => {
    const { database, access, read } = fixture();
    const result = await read();
    expect(result).toEqual({
      sourceSummary: {
        customer: { id: 'customer', name: '客户原名' },
        rightsHolder: { id: 'rights-holder', name: '主体原名' },
        platform: 'TAOBAO',
        shopName: '同名但精确关联的店铺',
        shopExternalId: null,
      },
      transferredAt: '2026-10-13',
      evidenceAt: '2026-10-11',
      openingSummary: {
        photoCount: 1,
        senderName: null,
        senderPhone: '123',
        senderAddress: null,
      },
      certificateSummary: {
        id: 'certificate',
        certificateNo: '沪证字真实编号',
        certificateDate: '2026-10-13',
        issuedAt: '2026-10-13T01:00:00.000Z',
        needDisclose: true,
      },
      fees: {
        notary: { state: 'KNOWN', amount: '1234567890123456.78' },
        investigation: { state: 'PENDING', amount: null },
        sample: { state: 'KNOWN', amount: '0.00' },
      },
      linkedCase: { id: 'case', businessNo: 'CA-真实', stage: 'PENDING_MATCH' },
    });
    expect(database.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'customer', departmentId: actor.departmentId },
      select: { id: true, name: true },
    });
    expect(database.rightsHolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'rights-holder', departmentId: actor.departmentId },
      select: { id: true, name: true },
    });
    expect(access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
    );
    expect(database.case.findFirst).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        sourceNotaryMatterId: 'matter',
      },
      select: { id: true, businessNo: true, stage: true },
    });
    expect(database.materialReference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          resourceId: 'matter',
          contentVersion: { status: 'AVAILABLE' },
          actionEvent: expect.objectContaining({
            resourceId: 'matter',
            action: 'notary.opening_recorded',
          }),
          material: expect.objectContaining({
            ownerId: 'matter',
            status: 'ACTIVE',
          }),
        }),
      }),
    );
  });

  it('does not query or mark a linked case when independent case.read is absent or revoked', async () => {
    const { access, database, read } = fixture();
    await read();
    database.case.findFirst.mockClear();
    access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    const denied = await read();
    expect(denied.linkedCase).toBeNull();
    expect(database.case.findFirst).not.toHaveBeenCalled();
    expect(denied).not.toHaveProperty('hasLinkedCase');
  });

  it('returns the same null for an absent authorized case and propagates unexpected authorization failures', async () => {
    const { access, database, read } = fixture();
    database.case.findFirst.mockResolvedValue(null);
    expect((await read()).linkedCase).toBeNull();
    access.authorizeDepartmentAction.mockRejectedValue(
      new Error('unavailable'),
    );
    await expect(read()).rejects.toThrow('unavailable');
  });

  it.each(['customer', 'rightsHolder'] as const)(
    'fails closed for a missing exact %s relation',
    async (key) => {
      const { database, read } = fixture();
      database[key].findFirst.mockResolvedValue(null);
      await expect(read()).rejects.toMatchObject({
        response: { code: 'INTERNAL_ERROR' },
      });
      expect(database.case.findFirst).not.toHaveBeenCalled();
    },
  );

  it('enforces department integrity before reading any related data', async () => {
    const { matter, database, read } = fixture();
    matter.departmentId = 'other-department';
    await expect(read()).rejects.toMatchObject({
      response: { code: 'INTERNAL_ERROR' },
    });
    expect(database.customer.findFirst).not.toHaveBeenCalled();
  });

  it('distinguishes missing, pending and true zero fee facts', () => {
    expect(notaryDisplayFee(null)).toEqual({
      state: 'UNRECORDED',
      amount: null,
    });
    expect(notaryDisplayFee({ state: 'PENDING', amount: null })).toEqual({
      state: 'PENDING',
      amount: null,
    });
    expect(
      notaryDisplayFee({ state: 'KNOWN', amount: new Prisma.Decimal(0) }),
    ).toEqual({ state: 'KNOWN', amount: '0.00' });
  });

  it.each([
    { state: 'KNOWN' as const, amount: null },
    { state: 'PENDING' as const, amount: new Prisma.Decimal(0) },
    { state: 'KNOWN' as const, amount: new Prisma.Decimal('-0.01') },
    { state: 'KNOWN' as const, amount: new Prisma.Decimal('1.001') },
  ])('rejects corrupt fee facts %j', (fact) => {
    expect(() => notaryDisplayFee(fact)).toThrow();
  });

  it('uses the Shanghai date at both sides of UTC midnight conversion', () => {
    expect(notaryTransferredDate(new Date('2026-12-31T15:59:59Z'))).toBe(
      '2026-12-31',
    );
    expect(notaryTransferredDate(new Date('2026-12-31T16:00:00Z'))).toBe(
      '2027-01-01',
    );
  });

  it('uses the same live action scope and factual prerequisites for list and detail capabilities', async () => {
    const { access, matter } = fixture();
    const capabilities = await notaryDisplayCapabilities(
      access as unknown as AccessControlService,
      actor,
      matter,
    );
    expect(capabilities).toEqual({
      recordEvidence: false,
      recordOpening: false,
      reviewOpening: false,
      decideIssuance: false,
      archiveReturn: true,
    });
    expect(access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'notary.return.archive',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: 'team',
      },
    );
    access.authorizeLead.mockRejectedValue(new ForbiddenException());
    expect(
      (
        await notaryDisplayCapabilities(
          access as unknown as AccessControlService,
          actor,
          matter,
        )
      ).archiveReturn,
    ).toBe(false);
    access.authorizeLead.mockClear();
    expect(
      (
        await notaryDisplayCapabilities(
          access as unknown as AccessControlService,
          actor,
          { ...matter, issuanceDecision: { decision: 'ISSUE' } },
        )
      ).archiveReturn,
    ).toBe(false);
    expect(access.authorizeLead).not.toHaveBeenCalled();
  });

  it.each([
    ['PENDING_EVIDENCE', 'recordEvidence', 'notary.evidence.record'],
    ['WAITING_UNBOX', 'recordOpening', 'notary.unbox.record'],
    ['UNBOX_REVIEW', 'reviewOpening', 'notary.opening.review'],
    ['ISSUANCE_DECISION', 'decideIssuance', 'notary.issuance.decide'],
    ['WAITING_RETURN', 'archiveReturn', 'notary.return.archive'],
  ] as const)(
    'advertises only the current %s stage action',
    async (stage, key, action) => {
      const { access, matter } = fixture();
      const result = await notaryDisplayCapabilities(
        access as unknown as AccessControlService,
        actor,
        { ...matter, stage },
        1,
      );
      expect(Object.values(result).filter(Boolean)).toHaveLength(1);
      expect(result[key]).toBe(true);
      expect(access.authorizeLead).toHaveBeenCalledTimes(1);
      expect(access.authorizeLead).toHaveBeenCalledWith(
        actor,
        action,
        expect.objectContaining({ departmentId: actor.departmentId }),
      );
    },
  );

  it('does not offer opening or review without their committed predecessor facts', async () => {
    const { access, matter } = fixture();
    expect(
      (
        await notaryDisplayCapabilities(
          access as unknown as AccessControlService,
          actor,
          { ...matter, stage: 'WAITING_UNBOX', evidence: null },
        )
      ).recordOpening,
    ).toBe(false);
    expect(
      (
        await notaryDisplayCapabilities(
          access as unknown as AccessControlService,
          actor,
          { ...matter, stage: 'UNBOX_REVIEW', opening: null },
        )
      ).reviewOpening,
    ).toBe(false);
    expect(access.authorizeLead).not.toHaveBeenCalled();
  });

  it('does not advertise review after all committed photos have become unavailable', async () => {
    const { access, matter } = fixture();
    const unavailable = await notaryDisplayCapabilities(
      access as unknown as AccessControlService,
      actor,
      { ...matter, stage: 'UNBOX_REVIEW' },
      0,
    );
    expect(unavailable.reviewOpening).toBe(false);
    expect(access.authorizeLead).not.toHaveBeenCalled();
    const available = await notaryDisplayCapabilities(
      access as unknown as AccessControlService,
      actor,
      { ...matter, stage: 'UNBOX_REVIEW' },
      1,
    );
    expect(available.reviewOpening).toBe(true);
  });

  it('does not advertise return archive without its committed evidence fact', async () => {
    const { access, matter } = fixture();
    const result = await notaryDisplayCapabilities(
      access as unknown as AccessControlService,
      actor,
      { ...matter, stage: 'WAITING_RETURN', evidence: null },
    );
    expect(result.archiveReturn).toBe(false);
    expect(access.authorizeLead).not.toHaveBeenCalled();
  });
});
