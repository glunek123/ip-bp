import { CaseFilingService } from './case-filing.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const courtId = '44444444-4444-4444-8444-444444444444';
const evidenceId = '55555555-5555-4555-8555-555555555555';
const input = {
  expectedVersion: 5,
  idempotencyKey: 'filing-1',
  courtId,
  submittedAt: '2026-10-03',
  filingEvidenceContentVersionIds: [evidenceId],
  filingScreenshotContentVersionIds: [],
};
const futureDateInShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 48 * 60 * 60 * 1000));

describe('CaseFilingService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'WAITING_FILING',
          version: 5,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          complaintMailing: { id: 'mailing' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      filingCourt: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: courtId, name: '真实法院' }),
      },
      caseFilingReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseFilingSubmission: {
        create: jest.fn().mockResolvedValue({ id: 'submission' }),
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
        .mockResolvedValue([
          { contentVersionId: evidenceId, category: 'FILING_EVIDENCE' },
        ]),
      freezeCaseFilingReferences: jest.fn().mockResolvedValue(undefined),
    };
    return {
      tx,
      database,
      access,
      materials,
      service: new CaseFilingService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('atomically advances a mailed case using a departmental court and exact evidence', async () => {
    const f = fixture();
    const result = await f.service.submit(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 6,
      submittedAt: input.submittedAt,
      recordedAt: expect.any(String),
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.filing.submit',
      expect.objectContaining({ departmentId: actor.departmentId }),
      f.tx,
    );
    expect(f.tx.filingCourt.findFirst).toHaveBeenCalledWith({
      where: { id: courtId, departmentId: actor.departmentId },
      select: { id: true, name: true },
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ stage: 'WAITING_FILING', version: 5 }),
      data: { stage: 'WAITING_FORMAL_ACCEPTANCE', version: { increment: 1 } },
    });
    expect(f.tx.caseFilingSubmission.create).toHaveBeenCalledTimes(1);
    expect(f.materials.freezeCaseFilingReferences).toHaveBeenCalledTimes(1);
    expect(f.tx.caseFilingReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same receipt without a second fact after a valid replay', async () => {
    const f = fixture();
    const first = await f.service.submit(actor, caseId, input);
    const receipt = f.tx.caseFilingReceipt.create.mock.calls[0][0].data;
    f.tx.caseFilingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: receipt.requestFingerprint,
      resultSnapshot: receipt.resultSnapshot,
    });
    expect(await f.service.submit(actor, caseId, { ...input })).toEqual(first);
    expect(f.tx.caseFilingSubmission.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.submit(actor, caseId, {
        ...input,
        courtId: '77777777-7777-4777-8777-777777777777',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('denies a revoked grant before looking up an old receipt', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(
      new (await import('@nestjs/common')).ForbiddenException(),
    );
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseFilingReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an out-of-department court before modifying the case', async () => {
    const f = fixture();
    f.tx.filingCourt.findFirst.mockResolvedValue(null);
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('propagates an audit failure from the atomic transaction', async () => {
    const f = fixture();
    f.tx.auditEvent.create.mockRejectedValue(new Error('audit failed'));
    await expect(f.service.submit(actor, caseId, input)).rejects.toThrow(
      'audit failed',
    );
    expect(f.tx.caseFilingSubmission.create).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, submittedAt: futureDateInShanghai() },
    { ...input, submittedAt: '2026-02-30' },
    { ...input, filingEvidenceContentVersionIds: [] },
    { ...input, filingEvidenceContentVersionIds: [evidenceId, evidenceId] },
    { ...input, filingScreenshotContentVersionIds: [evidenceId] },
    { ...input, mediationNo: ' 001 ' },
    { ...input, expectedVersion: 0 },
  ])('rejects malformed requests before a transaction', async (bad) => {
    const f = fixture();
    await expect(f.service.submit(actor, caseId, bad)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an external actor before a transaction', async () => {
    const f = fixture();
    await expect(
      f.service.submit(
        { ...actor, clientCustomerId: '88888888-8888-4888-8888-888888888888' },
        caseId,
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });
});
