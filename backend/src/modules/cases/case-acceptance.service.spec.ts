import { ForbiddenException } from '@nestjs/common';
import { CaseAcceptanceService } from './case-acceptance.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const input = {
  expectedVersion: 6,
  idempotencyKey: 'acceptance-1',
  acceptedAt: '2026-10-04',
  courtCaseNo: '（2026）京01民初123号',
  acceptanceNoticeContentVersionIds: [versionId],
};

describe('CaseAcceptanceService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'WAITING_FORMAL_ACCEPTANCE',
          version: 6,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          filingSubmission: {
            submittedAt: new Date('2026-10-03T00:00:00.000Z'),
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      caseAcceptanceReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseAcceptance: {
        create: jest.fn().mockResolvedValue({ id: 'acceptance' }),
      },
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '55555555-5555-4555-8555-555555555555' }),
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
            _tx: unknown,
            _actor: unknown,
            query: { contentVersionIds: string[]; category: string },
          ) =>
            Promise.resolve(
              query.contentVersionIds.map((contentVersionId) => ({
                contentVersionId,
                category: query.category,
              })),
            ),
        ),
      freezeCaseAcceptanceReferences: jest.fn().mockResolvedValue(undefined),
    };
    return {
      tx,
      database,
      access,
      materials,
      service: new CaseAcceptanceService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('registers accepted date and case number with optional exact versions in one transaction', async () => {
    const f = fixture();
    const result = await f.service.register(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_HEARING',
      version: 7,
      acceptedAt: input.acceptedAt,
      courtCaseNo: input.courtCaseNo,
    });
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledTimes(1);
    expect(f.materials.freezeCaseAcceptanceReferences).toHaveBeenCalledTimes(1);
    expect(f.tx.caseAcceptanceReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('allows no optional material and preserves the same receipt on replay', async () => {
    const f = fixture();
    const noFiles = { ...input, acceptanceNoticeContentVersionIds: [] };
    const first = await f.service.register(actor, caseId, noFiles);
    const receipt = f.tx.caseAcceptanceReceipt.create.mock.calls[0][0].data;
    f.tx.caseAcceptanceReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: receipt.requestFingerprint,
      resultSnapshot: receipt.resultSnapshot,
    });
    expect(await f.service.register(actor, caseId, noFiles)).toEqual(first);
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledTimes(1);
  });

  it('trims the court case number before storing and fingerprinting it', async () => {
    const f = fixture();
    const spaced = { ...input, courtCaseNo: `  ${input.courtCaseNo}  ` };
    const result = await f.service.register(actor, caseId, spaced);
    expect(result.courtCaseNo).toBe(input.courtCaseNo);
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courtCaseNo: input.courtCaseNo }),
      }),
    );
  });

  it('checks current authorization before replay', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.register(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseAcceptanceReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an accepted date before filing without writing', async () => {
    const f = fixture();
    await expect(
      f.service.register(actor, caseId, { ...input, acceptedAt: '2026-10-02' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('records current real lawyer actor', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    await f.service.register(
      { ...actor, lawyerAccountId: actor.userId },
      caseId,
      input,
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lawyerAccountBindingId: expect.any(String),
      }),
      select: { id: true },
    });
  });

  it('propagates a receipt failure for transaction rollback', async () => {
    const f = fixture();
    f.tx.caseAcceptanceReceipt.create.mockRejectedValue(
      new Error('receipt failed'),
    );
    await expect(f.service.register(actor, caseId, input)).rejects.toThrow(
      'receipt failed',
    );
  });

  it('rejects stale versions and incorrect stages before material validation', async () => {
    const f = fixture();
    await expect(
      f.service.register(actor, caseId, { ...input, expectedVersion: 5 }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst.mock.results[0].value),
      stage: 'WAITING_HEARING',
    });
    await expect(
      f.service.register(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
  });

  it('rejects a reused key with changed request after authorization', async () => {
    const f = fixture();
    await f.service.register(actor, caseId, input);
    const receipt = f.tx.caseAcceptanceReceipt.create.mock.calls[0][0].data;
    f.tx.caseAcceptanceReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: receipt.requestFingerprint,
      resultSnapshot: receipt.resultSnapshot,
    });
    await expect(
      f.service.register(actor, caseId, {
        ...input,
        courtCaseNo: '另一个案号',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...input, acceptedAt: '2026-02-30' },
    { ...input, acceptedAt: '9999-12-31' },
    { ...input, courtCaseNo: '   ' },
    { ...input, courtCaseNo: '' },
    { ...input, expectedVersion: 0 },
    { ...input, acceptanceNoticeContentVersionIds: [versionId, versionId] },
    { ...input, paymentListContentVersionIds: [versionId] },
  ])('rejects malformed requests before a transaction', async (bad) => {
    const f = fixture();
    await expect(f.service.register(actor, caseId, bad)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects external actors before a transaction', async () => {
    const f = fixture();
    await expect(
      f.service.register(
        { ...actor, clientCustomerId: '77777777-7777-4777-8777-777777777777' },
        caseId,
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });
});
