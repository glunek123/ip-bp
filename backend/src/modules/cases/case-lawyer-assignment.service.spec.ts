import { createHash } from 'node:crypto';
import { CaseLawyerAssignmentService } from './case-lawyer-assignment.service';
import { ForbiddenException } from '@nestjs/common';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const lawyerAccountId = '44444444-4444-4444-8444-444444444444';
const lawyerProfileId = '55555555-5555-4555-8555-555555555555';
const otherProfileId = '99999999-9999-4999-8999-999999999999';
const otherAccountId = '77777777-7777-4777-8777-777777777777';
const input = {
  expectedVersion: 1,
  idempotencyKey: 'assign-1',
  lawyerProfileId,
};

function fixture() {
  const tx = {
    $queryRawUnsafe: jest.fn(
      async (
        sql: string,
      ): Promise<
        Array<{
          id?: string;
          profile_id?: string;
          account_user_id?: string | null;
        }>
      > =>
        sql.includes('FROM "cases"')
          ? [{ id: caseId }]
          : [
              {
                profile_id: lawyerProfileId,
                account_user_id: lawyerAccountId,
              },
            ],
    ),
    case: {
      findFirst: jest.fn().mockResolvedValue({
        id: caseId,
        departmentId: actor.departmentId,
        stage: 'PENDING_MATCH',
        version: 1,
        matchedAt: null,
        matchedOn: null,
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
        consolidationMembership: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    lawyerProfile: {
      findFirst: jest.fn().mockResolvedValue({
        id: lawyerProfileId,
        accountBinding: {
          userId: lawyerAccountId,
          active: true,
          user: { active: true, accountType: 'LAWYER' },
        },
      }),
    },
    lawyerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({ profileId: lawyerProfileId }),
    },
    caseLawyerAssignmentReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    caseLawyerAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    case: tx.case,
    userAccount: tx.userAccount,
    caseLawyerAssignment: tx.caseLawyerAssignment,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    authorizeCase: jest.fn().mockResolvedValue(undefined),
    authorizeDepartmentProxyAction: jest.fn().mockResolvedValue(undefined),
  };
  return {
    tx,
    access,
    service: new CaseLawyerAssignmentService(db as never, access as never),
  };
}

const assignment = {
  id: '66666666-6666-4666-8666-666666666666',
  lawyerId: lawyerProfileId,
  role: 'PRIMARY',
  startedAt: new Date('2026-11-04T00:00:00Z'),
  endedAt: null,
  lawyer: {
    departmentId: actor.departmentId,
    status: 'ACTIVE',
    accountBinding: { userId: lawyerAccountId },
  },
};

describe('CaseLawyerAssignmentService', () => {
  it('denies another owner without explicit proxy before capability or assignment writes', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      responsibleUserId: 'another-owner',
    });
    f.access.authorizeDepartmentProxyAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(f.service.capability(actor, caseId)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.access.authorizeDepartmentProxyAction).toHaveBeenCalledWith(
      actor,
      'case.lawyer.assign',
      expect.objectContaining({ responsibleUserId: 'another-owner' }),
      f.tx,
    );
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseLawyerAssignmentReceipt.create).not.toHaveBeenCalled();
  });
  it('exposes capability only after both read and independent assign authorization', async () => {
    const f = fixture();
    const result = await f.service.capability(actor, caseId);
    expect(result).toEqual({
      canAssign: true,
      caseVersion: 1,
      currentAssignment: null,
    });
    expect(f.access.authorizeCase.mock.calls.map((call) => call[1])).toEqual([
      'case.read',
      'case.lawyer.assign',
    ]);
    f.access.authorizeCase.mockRejectedValueOnce(new ForbiddenException());
    await expect(f.service.capability(actor, caseId)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
  });

  it('assigns an existing real lawyer in one transaction and leaves stage and match facts untouched', async () => {
    const f = fixture();
    const result = await f.service.assign(actor, caseId, input);
    expect(result).toMatchObject({
      stage: 'PENDING_MATCH',
      version: 2,
      outcome: 'ASSIGNED',
      requestedLawyerAccountId: lawyerAccountId,
      previousAssignment: null,
      currentAssignment: { lawyerAccountId, lawyerProfileId },
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.lawyer.assign',
      expect.anything(),
      f.tx,
    );
    expect(f.access.authorizeCase.mock.calls.map((call) => call[1])).toEqual([
      'case.read',
      'case.lawyer.assign',
    ]);
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { version: { increment: 1 } } }),
    );
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.caseLawyerAssignmentReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('backfills a missing lawyer after matching without moving the stage', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_COMPLAINT',
      matchedAt: new Date('2026-11-04T00:00:00Z'),
      matchedOn: new Date('2026-11-03T00:00:00.000Z'),
    });
    const result = await f.service.assign(actor, caseId, input);
    expect(result).toMatchObject({
      stage: 'WAITING_COMPLAINT',
      version: 2,
      outcome: 'ASSIGNED',
      previousAssignment: null,
      currentAssignment: { lawyerAccountId, lawyerProfileId },
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: {
        id: caseId,
        departmentId: actor.departmentId,
        stage: 'WAITING_COMPLAINT',
        version: 1,
      },
      data: { version: { increment: 1 } },
    });
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('backfills a missing lawyer on a case waiting for archive', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_ARCHIVE',
      version: 7,
    });
    const result = await f.service.assign(actor, caseId, {
      ...input,
      expectedVersion: 7,
    });
    expect(result).toMatchObject({
      stage: 'WAITING_ARCHIVE',
      version: 8,
      outcome: 'ASSIGNED',
      previousAssignment: null,
      currentAssignment: { lawyerAccountId, lawyerProfileId },
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: {
        id: caseId,
        departmentId: actor.departmentId,
        stage: 'WAITING_ARCHIVE',
        version: 7,
      },
      data: { version: { increment: 1 } },
    });
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledTimes(1);
  });

  it('offers a backfill capability at any stage while the case has no lawyer', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_ARCHIVE',
      version: 4,
    });
    await expect(f.service.capability(actor, caseId)).resolves.toEqual({
      canAssign: true,
      caseVersion: 4,
      currentAssignment: null,
    });
  });

  it('refuses to change an assigned lawyer once the case left the assignable stages', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_FILING',
    });
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([assignment]);
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseLawyerAssignment.update).not.toHaveBeenCalled();
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();

    await expect(f.service.capability(actor, caseId)).resolves.toMatchObject({
      canAssign: false,
      reason: 'INVALID_STATE',
    });
  });

  it('returns NO_CHANGE without another association, case update or business audit', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([assignment]);
    const result = await f.service.assign(actor, caseId, input);
    expect(result).toMatchObject({
      outcome: 'NO_CHANGE',
      version: 1,
      currentAssignment: { lawyerAccountId },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.caseLawyerAssignmentReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('reassigns to a different lawyer and ends the previous assignment', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([
      {
        ...assignment,
        lawyerId: otherProfileId,
        lawyer: {
          departmentId: actor.departmentId,
          status: 'ACTIVE',
          accountBinding: { userId: otherAccountId },
        },
      },
    ]);
    const result = await f.service.assign(actor, caseId, input);
    expect(result).toMatchObject({
      outcome: 'REASSIGNED',
      version: 2,
      requestedLawyerProfileId: lawyerProfileId,
      requestedLawyerAccountId: lawyerAccountId,
      currentAssignment: { lawyerAccountId, lawyerProfileId },
      previousAssignment: {
        lawyerProfileId: otherProfileId,
        lawyerAccountId: otherAccountId,
      },
    });
    expect(f.tx.caseLawyerAssignment.update).toHaveBeenCalledWith({
      where: { id: assignment.id },
      data: { endedAt: expect.any(Date) as unknown as Date },
    });
  });

  it('rechecks permission before replay, and rejects changed request for the same key', async () => {
    const f = fixture();
    const first = await f.service.assign(actor, caseId, input);
    const receipt =
      f.tx.caseLawyerAssignmentReceipt.create.mock.calls[0][0].data;
    f.tx.caseLawyerAssignmentReceipt.findUnique.mockResolvedValue({
      ...receipt,
      resultSnapshot: first,
    });
    expect(await f.service.assign(actor, caseId, input)).toEqual(first);
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.assign(actor, caseId, { ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValueOnce(new ForbiddenException());
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseLawyerAssignmentReceipt.findUnique).toHaveBeenCalledTimes(
      3,
    );
  });
  it('does not reveal a prior assignment receipt after case.read is revoked', async () => {
    const f = fixture();
    const first = await f.service.assign(actor, caseId, input);
    const receipt =
      f.tx.caseLawyerAssignmentReceipt.create.mock.calls[0][0].data;
    f.tx.caseLawyerAssignmentReceipt.findUnique.mockResolvedValue({
      ...receipt,
      resultSnapshot: first,
    });
    f.access.authorizeCase.mockImplementation(async (_actor, action) => {
      if (action === 'case.read') throw new ForbiddenException();
    });
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseLawyerAssignmentReceipt.findUnique).toHaveBeenCalledTimes(
      1,
    );
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledTimes(1);
  });
  it('rejects a malformed nested success receipt after authorization', async () => {
    const f = fixture();
    const first = await f.service.assign(actor, caseId, input);
    const receipt =
      f.tx.caseLawyerAssignmentReceipt.create.mock.calls[0][0].data;
    f.tx.caseLawyerAssignmentReceipt.findUnique.mockResolvedValue({
      ...receipt,
      resultSnapshot: { ...first, currentAssignment: null },
    });
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'RECEIPT_CORRUPT' },
    });
  });
  it('rejects a valid-looking ASSIGNED receipt for another lawyer profile', async () => {
    const f = fixture();
    const request = { ...input, lawyerProfileId };
    const first = await f.service.assign(actor, caseId, request);
    const receipt =
      f.tx.caseLawyerAssignmentReceipt.create.mock.calls[0][0].data;
    f.tx.caseLawyerAssignmentReceipt.findUnique.mockResolvedValue({
      ...receipt,
      resultSnapshot: {
        ...first,
        currentAssignment: {
          ...first.currentAssignment,
          lawyerProfileId: '99999999-9999-4999-8999-999999999999',
        },
      },
    });
    await expect(
      f.service.assign(actor, caseId, request),
    ).rejects.toMatchObject({
      response: { code: 'RECEIPT_CORRUPT' },
    });
  });
  it('keeps the same profile on NO_CHANGE regardless of the account id spelling', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([assignment]);
    const request = { ...input, lawyerProfileId };
    const first = await f.service.assign(actor, caseId, request);
    expect(first).toMatchObject({
      outcome: 'NO_CHANGE',
      version: 1,
      requestedLawyerProfileId: lawyerProfileId,
    });
    expect(first.currentAssignment?.lawyerProfileId).toBe(lawyerProfileId);
    const receipt =
      f.tx.caseLawyerAssignmentReceipt.create.mock.calls[0][0].data;
    f.tx.caseLawyerAssignmentReceipt.findUnique.mockResolvedValue({
      ...receipt,
      resultSnapshot: first,
    });
    expect(await f.service.assign(actor, caseId, request)).toEqual(first);
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('does not write when the version changes or the case is a consolidation child', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValueOnce({
      ...(await f.tx.case.findFirst()),
      version: 2,
    });
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();
  });

  it('returns 404 for another department before permission or receipt lookup', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.tx.caseLawyerAssignmentReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an anomalous prior relationship without replacing it', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([
      { ...assignment, endedAt: new Date('2026-11-04T01:00:00Z') },
    ]);
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'LAWYER_ASSIGNMENT_CONFLICT' },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('assigns a lawyer profile that has no login account', async () => {
    const f = fixture();
    f.tx.lawyerProfile.findFirst.mockResolvedValue({
      id: lawyerProfileId,
      accountBinding: null,
    });
    const result = await f.service.assign(actor, caseId, input);
    expect(result).toMatchObject({
      outcome: 'ASSIGNED',
      requestedLawyerProfileId: lawyerProfileId,
      requestedLawyerAccountId: null,
      currentAssignment: { lawyerProfileId, lawyerAccountId: null },
    });
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lawyerId: lawyerProfileId }),
      }),
    );
  });

  it('does not treat a missing or disabled account as a relationship conflict', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([
      {
        ...assignment,
        lawyer: {
          departmentId: actor.departmentId,
          status: 'ACTIVE',
          accountBinding: null,
        },
      },
    ]);
    await expect(f.service.capability(actor, caseId)).resolves.toMatchObject({
      canAssign: true,
      currentAssignment: { lawyerProfileId, lawyerAccountId: null },
    });
  });

  it('refuses a profile that is inactive or from another department', async () => {
    const f = fixture();
    f.tx.lawyerProfile.findFirst.mockResolvedValue(null);
    await expect(f.service.assign(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();
  });

  it('replays a v1 receipt that was fingerprinted by lawyer account', async () => {
    const f = fixture();
    const legacyRequest = {
      expectedVersion: 1,
      idempotencyKey: 'assign-1',
      lawyerAccountId,
    };
    const legacyResult = {
      id: caseId,
      stage: 'PENDING_MATCH' as const,
      version: 2,
      outcome: 'ASSIGNED' as const,
      requestedLawyerProfileId: lawyerProfileId,
      requestedLawyerAccountId: lawyerAccountId,
      previousAssignment: null,
      currentAssignment: {
        id: '66666666-6666-4666-8666-666666666666',
        lawyerProfileId,
        lawyerAccountId,
        assignedAt: '2026-11-04T00:00:00.000Z',
      },
    };
    const legacyFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: 1,
          lawyerAccountId,
          lawyerProfileId: null,
        }),
      )
      .digest('hex');
    f.tx.caseLawyerAssignmentReceipt.findUnique.mockResolvedValue({
      id: '88888888-8888-4888-8888-888888888888',
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      caseId,
      idempotencyKey: 'assign-1',
      requestFingerprint: legacyFingerprint,
      resultSnapshot: legacyResult,
      createdAt: new Date('2026-11-04T00:00:00Z'),
    });
    expect(await f.service.assign(actor, caseId, legacyRequest)).toEqual(
      legacyResult,
    );
    expect(f.tx.caseLawyerAssignment.create).not.toHaveBeenCalled();
  });

  it('still resolves the profile when an older caller sends only the account id', async () => {
    const f = fixture();
    const result = await f.service.assign(actor, caseId, {
      expectedVersion: 1,
      idempotencyKey: 'assign-2',
      lawyerAccountId,
    });
    expect(result).toMatchObject({
      outcome: 'ASSIGNED',
      requestedLawyerProfileId: lawyerProfileId,
      requestedLawyerAccountId: lawyerAccountId,
    });
  });
});
