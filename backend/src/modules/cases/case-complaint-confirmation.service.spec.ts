import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const complaintId = '44444444-4444-4444-8444-444444444444';
const input = {
  expectedVersion: 3,
  idempotencyKey: 'confirm-1',
  confirmedComplaintContentVersionId: complaintId,
  amountState: 'KNOWN' as const,
  amount: '123.45',
  pendingReason: null,
  confirmDisclose: true,
};

describe('CaseComplaintConfirmationService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'WAITING_COMPLAINT_CONFIRMATION',
          version: 3,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          complaintAmountState: 'KNOWN',
          complaintAmount: { toString: () => '123.45' },
          complaintPendingReason: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      caseComplaintConfirmationReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseComplaintConfirmation: { create: jest.fn().mockResolvedValue({}) },
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
        .mockResolvedValue([
          { contentVersionId: complaintId, purpose: 'COMPLAINT' },
        ]),
      listSubmittedCaseComplaintVersionIds: jest
        .fn()
        .mockResolvedValue([complaintId]),
      freezeCaseComplaintConfirmationReference: jest.fn().mockResolvedValue({}),
    };
    return {
      tx,
      database,
      access,
      materials,
      service: new CaseComplaintConfirmationService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('atomically records exact confirmation without changing submitted facts', async () => {
    const f = fixture();
    const result = await f.service.confirm(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: expect.any(String),
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.complaint.confirm',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      f.tx,
    );
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'COMPLAINT',
        contentVersionIds: [complaintId],
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_COMPLAINT_CONFIRMATION',
          version: 3,
        }),
        data: { stage: 'WAITING_COMPLAINT_STAMP', version: { increment: 1 } },
      }),
    );
    expect(f.tx.caseComplaintConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        amountState: 'KNOWN',
        amount: '123.45',
        confirmDisclose: true,
        confirmedComplaintContentVersionId: complaintId,
      }),
    });
    expect(
      f.materials.freezeCaseComplaintConfirmationReference,
    ).toHaveBeenCalledWith(
      f.tx,
      actor,
      caseId,
      { contentVersionId: complaintId, purpose: 'COMPLAINT' },
      '66666666-6666-4666-8666-666666666666',
    );
    expect(f.tx.caseComplaintConfirmationReceipt.create).toHaveBeenCalledTimes(
      1,
    );
  });

  it('requires a change note for a new version or changed amount fact', async () => {
    const f = fixture();
    f.materials.listSubmittedCaseComplaintVersionIds.mockResolvedValue([]);
    await expect(f.service.confirm(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'VALIDATION_ERROR' } },
    );
    f.materials.listSubmittedCaseComplaintVersionIds.mockResolvedValue([
      complaintId,
    ]);
    await expect(
      f.service.confirm(actor, caseId, { ...input, amount: '124.00' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    await expect(
      f.service.confirm(actor, caseId, {
        ...input,
        amount: '124.00',
        changeNote: '核实后调整金额',
      }),
    ).resolves.toMatchObject({ version: 4 });
  });

  it.each([
    { ...input, amount: -1 },
    { ...input, amount: '-1' },
    { ...input, amountState: 'PENDING', amount: null, pendingReason: null },
    { ...input, confirmDisclose: 'true' },
    { ...input, idempotencyKey: '' },
    { ...input, confirmedComplaintContentVersionId: 'invalid' },
  ])('rejects malformed input before a transaction', async (bad) => {
    const f = fixture();
    await expect(
      f.service.confirm(actor, caseId, bad as typeof input),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('replays only after current authorization and rejects a changed request', async () => {
    const f = fixture();
    const result = await f.service.confirm(actor, caseId, input);
    const created =
      f.tx.caseComplaintConfirmationReceipt.create.mock.calls[0][0].data;
    f.tx.caseComplaintConfirmationReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: created.requestFingerprint,
      resultSnapshot: created.resultSnapshot,
    });
    expect(await f.service.confirm(actor, caseId, input)).toEqual(result);
    expect(f.tx.case.updateMany).toHaveBeenCalledTimes(1);
    await expect(
      f.service.confirm(actor, caseId, { ...input, confirmDisclose: false }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValue(new Error('revoked'));
    await expect(f.service.confirm(actor, caseId, input)).rejects.toThrow(
      'revoked',
    );
  });

  it('rejects stale stage/version and external actors before writes', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValueOnce({
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_COMPLAINT_STAMP',
    });
    await expect(f.service.confirm(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_STATE' } },
    );
    f.tx.case.findFirst.mockResolvedValueOnce({
      ...(await f.tx.case.findFirst()),
      version: 4,
    });
    await expect(f.service.confirm(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'VERSION_CONFLICT' } },
    );
    await expect(
      f.service.confirm(
        { ...actor, clientCustomerId: 'client' },
        caseId,
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseComplaintConfirmation.create).not.toHaveBeenCalled();
  });

  it('does not create a receipt after audit or freeze failure', async () => {
    for (const failure of ['audit', 'freeze']) {
      const f = fixture();
      if (failure === 'audit')
        f.tx.auditEvent.create.mockRejectedValueOnce(new Error(failure));
      if (failure === 'freeze')
        f.materials.freezeCaseComplaintConfirmationReference.mockRejectedValueOnce(
          new Error(failure),
        );
      await expect(f.service.confirm(actor, caseId, input)).rejects.toThrow(
        failure,
      );
      expect(
        f.tx.caseComplaintConfirmationReceipt.create,
      ).not.toHaveBeenCalled();
    }
  });
});
