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
const input = {
  expectedVersion: 1,
  idempotencyKey: 'assign-1',
  lawyerAccountId,
};

function fixture() {
  const tx = {
    $queryRawUnsafe: jest.fn(async (sql: string) =>
      sql.includes('FROM "cases"')
        ? [{ id: caseId }]
        : [{ profile_id: lawyerProfileId }],
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
    caseLawyerAssignmentReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    caseLawyerAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
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
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
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
    accountBinding: {
      userId: lawyerAccountId,
      departmentId: actor.departmentId,
      active: true,
      user: {
        active: true,
        accountType: 'LAWYER',
        localCredential: { id: '88888888-8888-4888-8888-888888888888' },
      },
    },
  },
};

describe('CaseLawyerAssignmentService', () => {
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

  it('returns SKIPPED for a different current lawyer without replacing it', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([
      {
        ...assignment,
        lawyer: {
          accountBinding: {
            userId: '77777777-7777-4777-8777-777777777777',
            departmentId: actor.departmentId,
            active: true,
            user: {
              active: true,
              accountType: 'LAWYER',
              localCredential: { id: '88888888-8888-4888-8888-888888888888' },
            },
          },
        },
      },
    ]);
    const result = await f.service.assign(actor, caseId, input);
    expect(result).toMatchObject({
      outcome: 'SKIPPED',
      version: 1,
      requestedLawyerAccountId: lawyerAccountId,
      currentAssignment: {
        lawyerAccountId: '77777777-7777-4777-8777-777777777777',
      },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
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
  it('keeps a historical profile on NO_CHANGE for the same lawyer account', async () => {
    const f = fixture();
    f.tx.caseLawyerAssignment.findMany.mockResolvedValue([
      {
        ...assignment,
        lawyerId: '99999999-9999-4999-8999-999999999999',
      },
    ]);
    const request = { ...input, lawyerProfileId };
    const first = await f.service.assign(actor, caseId, request);
    expect(first).toMatchObject({ outcome: 'NO_CHANGE', version: 1 });
    expect(first.currentAssignment?.lawyerProfileId).toBe(
      '99999999-9999-4999-8999-999999999999',
    );
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
});
