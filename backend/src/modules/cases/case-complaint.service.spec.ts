import { CaseComplaintService } from './case-complaint.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const complaintId = '44444444-4444-4444-8444-444444444444';
const authorizationId = '55555555-5555-4555-8555-555555555555';
const input = {
  expectedVersion: 2,
  idempotencyKey: 'complaint-1',
  amountState: 'KNOWN' as const,
  amount: '123.45',
  pendingReason: null,
  complaintContentVersionIds: [complaintId],
  authorizationContentVersionIds: [authorizationId],
};

describe('CaseComplaintService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockImplementation((sql: string) =>
        Promise.resolve([
          {
            id: sql.includes('lawyer_account_bindings')
              ? 'lawyer-binding'
              : caseId,
          },
        ]),
      ),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'WAITING_COMPLAINT',
          version: 2,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      caseLawyerAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          lawyer: { accountBinding: { id: 'lawyer-binding' } },
        }),
      },
      caseComplaintReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' }),
      },
    };
    const database = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    const materials = {
      assertAvailableVersions: jest
        .fn()
        .mockImplementation(
          (
            _tx,
            _actor,
            request: { contentVersionIds: string[]; category: string },
          ) =>
            Promise.resolve(
              request.contentVersionIds.map((contentVersionId) => ({
                contentVersionId,
                purpose: request.category,
              })),
            ),
        ),
      freezeReferences: jest.fn().mockResolvedValue({ count: 2 }),
    };
    return {
      tx,
      database,
      access,
      materials,
      service: new CaseComplaintService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('lets the current lawyer submit using a lawyer audit path', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    await f.service.submit(
      { ...actor, lawyerAccountId: actor.userId },
      caseId,
      input,
    );
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lawyerAccountBindingId: 'lawyer-binding',
      }),
      select: { id: true },
    });
    expect(f.tx.auditEvent.create.mock.calls[0][0].data).not.toHaveProperty(
      'internalActorUserId',
    );
  });

  it('commits the two validated version sets, audit, receipt and stage together', async () => {
    const f = fixture();
    const result = await f.service.submit(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 3,
      submittedAt: expect.any(String),
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.complaint.submit',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      f.tx,
    );
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledTimes(2);
    expect(f.materials.freezeReferences).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        resourceType: 'case',
        resourceId: caseId,
        facts: expect.arrayContaining([
          expect.objectContaining({ contentVersionId: complaintId }),
          expect.objectContaining({ contentVersionId: authorizationId }),
        ]),
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_COMPLAINT',
          version: 2,
        }),
        data: expect.objectContaining({
          stage: 'WAITING_COMPLAINT_CONFIRMATION',
        }),
      }),
    );
    expect(f.tx.caseComplaintReceipt.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...input, amount: '-1' }, 'VALIDATION_ERROR'],
    [
      { ...input, amountState: 'PENDING', amount: null, pendingReason: null },
      'VALIDATION_ERROR',
    ],
    [{ ...input, complaintContentVersionIds: [] }, 'VALIDATION_ERROR'],
    [
      {
        ...input,
        authorizationContentVersionIds: [authorizationId, authorizationId],
      },
      'VALIDATION_ERROR',
    ],
  ])('rejects invalid request before writes', async (bad, code) => {
    const f = fixture();
    await expect(
      f.service.submit(actor, caseId, bad as typeof input),
    ).rejects.toMatchObject({ response: { code } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects another department and external identity', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    await expect(
      f.service.submit({ ...actor, clientCustomerId: 'client' }, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });

  it('replays the original receipt only after live authorization and rejects changed payload', async () => {
    const f = fixture();
    const result = await f.service.submit(actor, caseId, input);
    const created = f.tx.caseComplaintReceipt.create.mock.calls[0][0].data;
    f.tx.caseComplaintReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: created.requestFingerprint,
      resultSnapshot: created.resultSnapshot,
    });
    expect(await f.service.submit(actor, caseId, input)).toEqual(result);
    expect(f.tx.case.updateMany).toHaveBeenCalledTimes(1);
    await expect(
      f.service.submit(actor, caseId, { ...input, amount: '124.00' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValue(new Error('revoked'));
    await expect(f.service.submit(actor, caseId, input)).rejects.toThrow(
      'revoked',
    );
  });

  it('rejects stale versions and an invalid stage without freezing or a receipt', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValueOnce({
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'PENDING_MATCH',
      version: 2,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    f.tx.case.findFirst.mockResolvedValueOnce({
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'WAITING_COMPLAINT',
      version: 3,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
    });
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(f.materials.freezeReferences).not.toHaveBeenCalled();
    expect(f.tx.caseComplaintReceipt.create).not.toHaveBeenCalled();
  });

  it('does not create a receipt when material validation, audit, or freezing fails', async () => {
    for (const failure of ['material', 'audit', 'freeze']) {
      const f = fixture();
      if (failure === 'material')
        f.materials.assertAvailableVersions.mockRejectedValueOnce(
          new Error(failure),
        );
      if (failure === 'audit')
        f.tx.auditEvent.create.mockRejectedValueOnce(new Error(failure));
      if (failure === 'freeze')
        f.materials.freezeReferences.mockRejectedValueOnce(new Error(failure));
      await expect(f.service.submit(actor, caseId, input)).rejects.toThrow(
        failure,
      );
      expect(f.tx.caseComplaintReceipt.create).not.toHaveBeenCalled();
    }
  });

  it('converts exhausted serialization conflicts to a version conflict', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(f.database.$transaction).toHaveBeenCalledTimes(3);
  });
});
