import { ValidationPipe } from '@nestjs/common';
import { configureApp } from '../../common/configure-app';
import { RegisterCaseAcceptanceDto } from './case-acceptance.dto';
import { ForbiddenException } from '@nestjs/common';
import { CaseAcceptanceService } from './case-acceptance.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const courtId = '99999999-9999-4999-8999-999999999999';
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
      $queryRaw: jest.fn().mockResolvedValue([{ valid: true }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          sourceLeadId: '66666666-6666-4666-8666-666666666666',
          sourceNotaryMatterId: '77777777-7777-4777-8777-777777777777',
          certificateId: '88888888-8888-4888-8888-888888888888',
          externalEntry: null,
          stage: 'WAITING_FORMAL_ACCEPTANCE',
          version: 6,
          currentTrialRoundId: null,
          currentAcceptanceId: null,
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
      filingCourt: { count: jest.fn().mockResolvedValue(1) },
      caseTrialRound: {
        create: jest.fn().mockResolvedValue({ id: 'round' }),
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

  it('creates the initial round when an unaccepted case is first accepted', async () => {
    const f = fixture();
    await f.service.register(actor, caseId, input);
    expect(f.tx.caseTrialRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        departmentId: actor.departmentId,
        sequence: 1,
      }),
      select: { id: true },
    });
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trialRoundId: 'round' }),
      select: { id: true },
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: expect.anything(),
      data: expect.objectContaining({ currentTrialRoundId: 'round' }),
    });
  });

  it('requires an actual court only for an external acceptance without filing', async () => {
    const f = fixture();
    const before = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...before,
      sourceLeadId: null,
      sourceNotaryMatterId: null,
      certificateId: null,
      filingSubmission: null,
      externalEntry: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        caseId,
        departmentId: actor.departmentId,
        initialStage: 'WAITING_FORMAL_ACCEPTANCE',
        stageReachedOn: new Date('2026-10-03T00:00:00.000Z'),
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      },
    });
    await expect(
      f.service.register(actor, caseId, input),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.tx.caseAcceptance.create).not.toHaveBeenCalled();
    await f.service.register(actor, caseId, { ...input, courtId });
    expect(f.tx.filingCourt.count).toHaveBeenCalledWith({
      where: { id: courtId, departmentId: actor.departmentId },
    });
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        courtId,
        externalEntryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
      select: { id: true },
    });
  });

  it('uses the active empty remand round without changing its identity', async () => {
    const f = fixture();
    const before = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...before,
      currentTrialRoundId: 'existing-round',
      currentAcceptanceId: null,
    });
    await f.service.register(actor, caseId, input);
    expect(f.tx.caseTrialRound.create).not.toHaveBeenCalled();
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trialRoundId: 'existing-round' }),
      select: { id: true },
    });
  });

  it('rejects a remand child acceptance earlier than its known parent second acceptance', async () => {
    const f = fixture();
    const before = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...before,
      currentTrialRoundId: 'existing-round',
    });
    f.tx.$queryRaw.mockResolvedValue([{ valid: false }]);
    await expect(
      f.service.register(actor, caseId, input),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.tx.caseAcceptance.create).not.toHaveBeenCalled();
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
  it('accepts only real payment dates without a today threshold, and preserves the old receipt fingerprint', async () => {
    const f = fixture();
    const saved = await f.service.register(actor, caseId, input);
    const oldReceipt = f.tx.caseAcceptanceReceipt.create.mock.calls[0]![0].data;
    // Legacy normalized request before any paymentDueAt key existed.
    expect(oldReceipt.requestFingerprint).toBe(
      '1aefddda50d95772b5132e5b09e5394cef28328eaed4578641589c920d182960',
    );
    f.tx.caseAcceptanceReceipt.findUnique.mockResolvedValue({
      ...oldReceipt,
      resultSnapshot: saved,
    });
    await expect(
      f.service.register(actor, caseId, { ...input }),
    ).resolves.toEqual(saved);
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledTimes(1);
    const next = fixture();
    await next.service.register(actor, caseId, {
      ...input,
      paymentDueAt: '2099-01-01',
    });
    expect(next.tx.caseAcceptance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentDueAt: new Date('2099-01-01T00:00:00.000Z'),
        }),
      }),
    );
    await expect(
      next.service.register(actor, caseId, {
        ...input,
        paymentDueAt: '2026-02-30',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
  it('accepts legacy DTO instances from the real project pipe and replays their existing receipt', async () => {
    const f = fixture();
    const oldResult = await f.service.register(actor, caseId, input);
    const receipt = f.tx.caseAcceptanceReceipt.create.mock.calls[0]![0].data;
    f.tx.caseAcceptanceReceipt.findUnique.mockResolvedValue(receipt);
    const dto = await projectValidationPipe().transform(
      { ...input },
      { type: 'body', metatype: RegisterCaseAcceptanceDto },
    );
    expect(dto).toBeInstanceOf(RegisterCaseAcceptanceDto);
    await expect(f.service.register(actor, caseId, dto)).resolves.toEqual(
      oldResult,
    );
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledTimes(1);
    const explicitUndefined = await projectValidationPipe().transform(
      { ...input, paymentDueAt: undefined },
      { type: 'body', metatype: RegisterCaseAcceptanceDto },
    );
    await expect(
      f.service.register(actor, caseId, explicitUndefined),
    ).resolves.toEqual(oldResult);
    expect(f.tx.caseAcceptance.create).toHaveBeenCalledTimes(1);
    const clearing = fixture();
    const explicitNull = await projectValidationPipe().transform(
      { ...input, paymentDueAt: null },
      { type: 'body', metatype: RegisterCaseAcceptanceDto },
    );
    await clearing.service.register(actor, caseId, explicitNull);
    expect(clearing.tx.caseAcceptance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentDueAt: null }),
      }),
    );
  });
});

function projectValidationPipe(): ValidationPipe {
  let pipe: ValidationPipe | undefined;
  configureApp({
    getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
    setGlobalPrefix: jest.fn(),
    use: jest.fn(),
    useGlobalFilters: jest.fn(),
    useGlobalPipes: (value: ValidationPipe) => {
      pipe = value;
    },
  } as never);
  if (!pipe) throw new Error('Missing project ValidationPipe');
  return pipe;
}
