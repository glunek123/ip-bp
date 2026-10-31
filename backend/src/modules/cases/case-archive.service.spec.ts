import { ArgumentsHost, ForbiddenException } from '@nestjs/common';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { createHash } from 'node:crypto';
import { CaseArchiveService } from './case-archive.service';
import {
  lockArchiveCaseScopeDraft,
  prepareArchiveFinancialDraft,
} from './case-archive-scope-lock-draft';
jest.mock('./case-archive-scope-lock-draft', () => ({
  lockArchiveCaseScopeDraft: jest.fn(),
  prepareArchiveFinancialDraft: jest.fn(),
}));
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const caseId = id('3');
const input = {
  expectedVersion: 26,
  idempotencyKey: 'archive-original',
  expectedClosureVersionId: id('e'),
  archiveAt: '2020-01-01',
  archiveType: 'EXECUTION_COLLECTED' as const,
  archiveReason: '分类，不推定实收',
};
function fixture() {
  const financial: Awaited<ReturnType<typeof prepareArchiveFinancialDraft>> = {
    state: 'PASSED',
    payment: { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' },
    refund: { state: 'PASSED', reason: 'REFUND_EXPLICITLY_NOT_APPLICABLE' },
    customer: { state: 'PASSED', reason: 'CUSTOMER_RECEIPTS_REACHED' },
    lawyer: { state: 'PASSED', reason: 'LAWYER_INVOICES_REACHED' },
    persist: jest.fn(async () => undefined),
  };
  jest
    .mocked(lockArchiveCaseScopeDraft)
    .mockReset()
    .mockResolvedValue({ purpose: 'ARCHIVE_AGGREGATE_ONLY' });
  jest
    .mocked(prepareArchiveFinancialDraft)
    .mockReset()
    .mockResolvedValue(financial);
  const record = {
    departmentId: actor.departmentId,
    sourceLeadId: caseId,
    sourceNotaryMatterId: caseId,
    certificateId: caseId,
    externalEntry: null,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    stage: 'WAITING_ARCHIVE',
    version: 26,
    currentTrialRoundId: id('4'),
    currentJudgmentNextStepId: id('5'),
    currentSecondInstanceResultId: null,
    currentExecutionSubmissionId: id('6'),
    currentJudgmentNextStep: {
      id: id('5'),
      trialRoundId: id('4'),
      next: 'EXECUTION',
      revocation: null,
    },
    currentSecondInstanceResult: null,
    currentExecutionSubmission: {
      id: id('6'),
      trialRoundId: id('4'),
      judgmentNextStepId: id('5'),
      secondInstanceResultId: null,
      toVersion: 21,
    },
    executionConfirmation: {
      id: id('7'),
      submissionId: id('6'),
      fromVersion: 21,
      toVersion: 22,
    },
    executionMailing: {
      id: id('8'),
      confirmationId: id('7'),
      fromVersion: 22,
      toVersion: 23,
    },
    executionFiling: {
      id: id('9'),
      mailingId: id('8'),
      fromVersion: 23,
      toVersion: 24,
    },
    executionFinish: {
      id: id('a'),
      filingId: id('9'),
      fromVersion: 24,
      toVersion: 25,
    },
    closure: {
      id: id('d'),
      finishId: id('a') as string | null,
      earlyClosureId: null as string | null,
      externalEntryId: null as string | null,
      currentVersionId: id('e'),
      currentVersion: { id: id('e'), toVersion: 26 },
      versions: [
        {
          id: id('e'),
          finishId: id('a') as string | null,
          earlyClosureId: null as string | null,
          externalEntryId: null as string | null,
          kind: 'REGISTER',
          priorVersionId: null as string | null,
          fromVersion: 25,
          toVersion: 26,
        },
      ],
    },
    archive: null as null | {
      id: string;
      closureId: string;
      closureVersionId: string;
      currentVersionId: string;
      versions: Array<{
        id: string;
        closureVersionId: string;
        kind: string;
        priorVersionId: string | null;
        fromVersion: number;
        toVersion: number;
      }>;
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
    case: {
      findFirst: jest.fn().mockImplementation(async () => record),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    caseArchive: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseArchiveVersion: { create: jest.fn().mockResolvedValue({}) },
    caseArchiveReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    lawyerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({ id: id('b') }),
    },
    caseLawyerAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ lawyer: { accountBinding: { id: id('b') } } }),
    },
  };
  const database = {
    $transaction: jest
      .fn()
      .mockImplementation(async (operation) => operation(tx)),
  };
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
  };
  const materials = {
    assertAvailableVersions: jest
      .fn()
      .mockResolvedValue([{ materialId: id('d'), contentVersionId: id('e') }]),
    freezeCaseClosureReferences: jest.fn().mockResolvedValue(undefined),
  };
  return {
    record,
    tx,
    database,
    access,
    materials,
    financial,
    organization,
    service: new CaseArchiveService(
      database as never,
      access as never,
      organization as never,
    ),
  };
}
function earlyFixture() {
  const f = fixture();
  Object.assign(f.record, { executionFinish: null });
  Object.assign(f.record.closure, {
    finishId: null,
    earlyClosureId: id('b'),
    externalEntryId: null,
  });
  Object.assign(f.record.closure.versions[0], {
    finishId: null,
    earlyClosureId: id('b'),
    externalEntryId: null,
  });
  const root = {
    id: id('b'),
    case_id: caseId,
    department_id: actor.departmentId,
    from_stage: 'EXECUTING',
    from_version: 24,
    to_version: 25,
    source_valid: true,
    original_source_valid: true,
    audit_valid: true,
    terminal: 26,
    case_version: 26,
  };
  f.tx.$queryRaw.mockResolvedValue([root]);
  return { ...f, root };
}
describe('archive commands', () => {
  it.each(['valid', 'terminal', 'earlyId', 'externalId'] as const)(
    'checks archived early source before correction: %s',
    async (variant) => {
      const f = earlyFixture();
      const original = await f.service.archive(actor, caseId, input);
      f.record.stage = 'ARCHIVED';
      f.record.version = 27;
      f.record.archive = {
        id: original.archiveId,
        closureId: original.closureId,
        closureVersionId: id('e'),
        currentVersionId: original.archiveVersionId,
        versions: [
          {
            id: original.archiveVersionId,
            closureVersionId: id('e'),
            kind: 'ARCHIVE',
            priorVersionId: null,
            fromVersion: 26,
            toVersion: 27,
          },
        ],
      };
      if (variant === 'terminal') f.root.terminal = 27;
      if (variant === 'earlyId')
        f.record.closure.versions[0].earlyClosureId = id('9');
      if (variant === 'externalId')
        Object.assign(f.record.closure, { externalEntryId: id('9') });
      const result = f.service.correct(actor, caseId, {
        ...input,
        expectedVersion: 27,
        idempotencyKey: 'early-correct',
        expectedArchiveVersionId: original.archiveVersionId,
        correctionReason: '修正分类',
      });
      if (variant === 'valid')
        await expect(result).resolves.toMatchObject({
          version: 28,
          closureVersionId: id('e'),
        });
      else
        await expect(result).rejects.toMatchObject({
          response: { code: 'INVALID_STATE' },
        });
    },
  );
  it('locks department before lawyer authorization on receipt replay and rejects concurrent revocation', async () => {
    const f = fixture();
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    await f.service.archive(lawyer, caseId, input);
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue(
      f.tx.caseArchiveReceipt.create.mock.calls[0][0].data,
    );
    f.tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: caseId }])
      .mockResolvedValueOnce([]);
    await expect(
      f.service.archive(lawyer, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.organization.lockDepartment).toHaveBeenCalledWith(
      f.tx,
      actor.departmentId,
    );
    const lockOrder = f.organization.lockDepartment.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(
      f.tx.$queryRawUnsafe.mock.invocationCallOrder.at(-1)!,
    );
    expect(f.tx.caseArchiveReceipt.create).toHaveBeenCalledTimes(1);
  });
  it('continues from the real early transition and first REGISTER version', async () => {
    const f = earlyFixture();
    await expect(
      f.service.archive(actor, caseId, input),
    ).resolves.toMatchObject({ closureVersionId: id('e'), version: 27 });
    expect(f.financial.persist).toHaveBeenCalledWith(
      expect.any(String),
      id('e'),
    );
  });
  it('accepts only a real early root and preserves its REGISTER then CORRECT chain', async () => {
    const f = earlyFixture();
    Object.assign(f.record, { version: 27 });
    Object.assign(f.record.closure, {
      currentVersionId: id('f'),
      currentVersion: { id: id('f'), toVersion: 27 },
    });
    f.record.closure.versions.push({
      id: id('f'),
      finishId: null,
      earlyClosureId: id('b'),
      externalEntryId: null,
      kind: 'CORRECT',
      priorVersionId: id('e'),
      fromVersion: 26,
      toVersion: 27,
    });
    Object.assign(f.root, { terminal: 27, case_version: 27 });
    await expect(
      f.service.archive(actor, caseId, {
        ...input,
        expectedVersion: 27,
        expectedClosureVersionId: id('f'),
      }),
    ).resolves.toMatchObject({
      stage: 'ARCHIVED',
      closureVersionId: id('f'),
      version: 28,
    });
    expect(f.tx.$queryRaw).toHaveBeenCalled();
    expect(f.financial.persist).toHaveBeenCalledWith(
      expect.any(String),
      id('f'),
    );
  });
  it.each([
    'missing',
    'case',
    'department',
    'stage',
    'gap',
    'terminal',
    'source',
    'audit',
    'seed',
    'versionRoot',
    'predecessor',
    'finish',
  ] as const)('rejects invalid early closure provenance: %s', async (kind) => {
    const f = earlyFixture();
    if (kind === 'missing') f.tx.$queryRaw.mockResolvedValue([]);
    if (kind === 'case') f.root.case_id = id('8');
    if (kind === 'department') f.root.department_id = id('8');
    if (kind === 'stage') f.root.from_stage = 'WAITING_ARCHIVE';
    if (kind === 'gap') f.root.to_version = 26;
    if (kind === 'terminal') f.root.terminal = 27;
    if (kind === 'source') f.root.original_source_valid = false;
    if (kind === 'audit') f.root.audit_valid = false;
    if (kind === 'seed')
      Object.assign(f.root, { from_version: 23, to_version: 24 });
    if (kind === 'versionRoot')
      f.record.closure.versions[0].earlyClosureId = id('9');
    if (kind === 'predecessor')
      f.record.executionMailing.confirmationId = id('9');
    if (kind === 'finish')
      Object.assign(f.record, {
        executionFinish: {
          id: id('a'),
          filingId: id('9'),
          fromVersion: 24,
          toVersion: 25,
        },
      });
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_STATE' } },
    );
    expect(f.tx.caseArchiveVersion.create).not.toHaveBeenCalled();
    expect(f.financial.persist).not.toHaveBeenCalled();
  });
  it.each(['payment', 'refund', 'customer', 'lawyer'] as const)(
    'rejects a failed %s item before archive writes and returns only safe reasons',
    async (item) => {
      const f = fixture();
      f.financial.state = 'BLOCKED';
      f.financial[item] = {
        state: 'BLOCKED',
        reason: 'FOCUSED_ITEM_NOT_READY',
      };
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({
        response: {
          code: 'ARCHIVE_FINANCIAL_NOT_READY',
          details: {
            checks: {
              [item]: { state: 'BLOCKED', reason: 'FOCUSED_ITEM_NOT_READY' },
            },
          },
        },
      });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      expect(f.tx.caseArchiveVersion.create).not.toHaveBeenCalled();
      expect(f.tx.caseArchiveReceipt.create).not.toHaveBeenCalled();
    },
  );
  it('rejects unknown closure amount and propagates a closed snapshot gate without a success receipt', async () => {
    const unknown = fixture();
    unknown.financial.state = 'UNKNOWN';
    unknown.financial.payment = {
      state: 'UNKNOWN',
      reason: 'CLOSURE_AMOUNT_UNKNOWN',
    };
    await expect(
      unknown.service.archive(actor, caseId, input),
    ).rejects.toMatchObject({
      response: {
        code: 'ARCHIVE_FINANCIAL_NOT_READY',
        details: { checks: { payment: { reason: 'CLOSURE_AMOUNT_UNKNOWN' } } },
      },
    });
    const closed = fixture();
    const gate = new Error(
      'archive evidence snapshot persistence is draft and not enabled',
    );
    jest.mocked(closed.financial.persist).mockRejectedValueOnce(gate);
    await expect(closed.service.archive(actor, caseId, input)).rejects.toBe(
      gate,
    );
    expect(closed.tx.case.updateMany).not.toHaveBeenCalled();
    expect(closed.tx.caseArchiveReceipt.create).not.toHaveBeenCalled();
  });
  it('preserves safe financial checks through actual HTTP serialization', async () => {
    const f = fixture();
    f.financial.state = 'BLOCKED';
    f.financial.customer = {
      state: 'BLOCKED',
      reason: 'CUSTOMER_RECEIPTS_INSUFFICIENT',
    };
    const exception = await f.service
      .archive(actor, caseId, input)
      .catch((error: unknown) => error);
    const json = jest.fn();
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: 'archive-request' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(exception, host);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(JSON.parse(JSON.stringify(json.mock.calls[0][0]))).toEqual({
      code: 'ARCHIVE_FINANCIAL_NOT_READY',
      message: '归档条件未满足，请逐项核查资金状态',
      requestId: 'archive-request',
      details: {
        checks: {
          payment: f.financial.payment,
          refund: f.financial.refund,
          customer: f.financial.customer,
          lawyer: f.financial.lawyer,
        },
      },
    });
    expect(f.tx.caseArchiveReceipt.create).not.toHaveBeenCalled();
  });
  it.each(['refund', 'customer', 'lawyer'] as const)(
    'rejects an UNKNOWN %s item for a positive closure',
    async (item) => {
      const f = fixture();
      f.financial.state = 'UNKNOWN';
      f.financial[item] = { state: 'UNKNOWN', reason: 'SOURCE_UNCONFIRMED' };
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({
        response: {
          code: 'ARCHIVE_FINANCIAL_NOT_READY',
          details: { checks: { [item]: { state: 'UNKNOWN' } } },
        },
      });
      expect(f.tx.caseArchiveVersion.create).not.toHaveBeenCalled();
    },
  );
  it('persists explicit zero exemptions with the same transaction and exact new archive version', async () => {
    const f = fixture();
    for (const key of ['payment', 'refund', 'customer', 'lawyer'] as const)
      f.financial[key] = {
        state: 'EXEMPT',
        reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT',
      };
    const result = await f.service.archive(actor, caseId, input);
    expect(f.financial.persist).toHaveBeenCalledWith(
      result.archiveVersionId,
      input.expectedClosureVersionId,
    );
    expect(prepareArchiveFinancialDraft).toHaveBeenCalledWith(f.tx, actor, {
      purpose: 'ARCHIVE_AGGREGATE_ONLY',
    });
    expect(f.tx.$queryRawUnsafe.mock.calls[0][0]).not.toContain('FOR UPDATE');
  });
  it('replays a historical authorized receipt before any new financial scope or snapshot checks', async () => {
    const f = fixture();
    const result = await f.service.archive(actor, caseId, input);
    const saved = f.tx.caseArchiveReceipt.create.mock.calls[0][0].data;
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue(saved);
    jest.mocked(lockArchiveCaseScopeDraft).mockClear();
    jest.mocked(prepareArchiveFinancialDraft).mockClear();
    jest.mocked(f.financial.persist).mockClear();
    await expect(f.service.archive(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(lockArchiveCaseScopeDraft).not.toHaveBeenCalled();
    expect(prepareArchiveFinancialDraft).not.toHaveBeenCalled();
    expect(f.financial.persist).not.toHaveBeenCalled();
  });
  it('fails a missing same-department case before authorization or receipt lookup', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'CASE_NOT_FOUND' } },
    );
    expect(f.tx.caseArchiveReceipt.findUnique).not.toHaveBeenCalled();
  });
  it('propagates audit, fact, head and receipt failures without returning a success', async () => {
    for (const target of ['audit', 'fact', 'head', 'receipt']) {
      const f = fixture();
      const cause = new Error(target + ' failed');
      if (target === 'audit') f.tx.auditEvent.create.mockRejectedValue(cause);
      if (target === 'fact')
        f.tx.caseArchiveVersion.create.mockRejectedValue(cause);
      if (target === 'head')
        f.tx.caseArchive.updateMany.mockRejectedValue(cause);
      if (target === 'receipt')
        f.tx.caseArchiveReceipt.create.mockRejectedValue(cause);
      await expect(f.service.archive(actor, caseId, input)).rejects.toBe(cause);
    }
  });
  it('rejects malformed stored receipts and bounds full transaction retries', async () => {
    const f = fixture();
    await f.service.archive(actor, caseId, input);
    const saved = f.tx.caseArchiveReceipt.create.mock.calls[0][0].data;
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue({
      ...saved,
      resultSnapshot: { ...saved.resultSnapshot, stage: 'WAITING_ARCHIVE' },
    });
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_RECEIPT' } },
    );
    const exhausted = fixture();
    exhausted.database.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(
      exhausted.service.archive(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(exhausted.database.$transaction).toHaveBeenCalledTimes(3);
  });
  it.each(['55P03', '40P01'])(
    'handles raw archive lock conflict %s without an internal error',
    async (code) => {
      const error = {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: code } } },
      };
      const retry = fixture();
      retry.database.$transaction.mockRejectedValueOnce(error);
      await expect(
        retry.service.archive(actor, caseId, input),
      ).resolves.toMatchObject({ stage: 'ARCHIVED' });
      expect(retry.database.$transaction).toHaveBeenCalledTimes(2);
      const exhausted = fixture();
      exhausted.database.$transaction.mockRejectedValue(error);
      await expect(
        exhausted.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'VERSION_CONFLICT' },
      });
      expect(exhausted.database.$transaction).toHaveBeenCalledTimes(3);
    },
  );
  it('archives against the exact closure and stores fixed result without touching closure/files/money', async () => {
    const f = fixture();
    const result = await f.service.archive(actor, caseId, input);
    expect(result).toEqual({
      id: caseId,
      archiveId: expect.any(String),
      archiveVersionId: expect.any(String),
      closureId: id('d'),
      closureVersionId: id('e'),
      stage: 'ARCHIVED',
      version: 27,
      recordedAt: expect.any(String),
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        stage: 'WAITING_ARCHIVE',
        version: 26,
        closure: { is: { id: id('d'), currentVersionId: id('e') } },
      }),
      data: { stage: 'ARCHIVED', version: { increment: 1 } },
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'case.archived',
        internalActorUserId: actor.userId,
        details: expect.objectContaining({
          closureVersionId: id('e'),
          archiveReason: input.archiveReason,
        }),
      }),
    });
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(f.materials.freezeCaseClosureReferences).not.toHaveBeenCalled();
    const legacyFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          command: 'ARCHIVE',
          expectedVersion: input.expectedVersion,
          expectedClosureVersionId: input.expectedClosureVersionId,
          expectedArchiveVersionId: null,
          archiveAt: input.archiveAt,
          archiveType: input.archiveType,
          archiveReason: input.archiveReason,
          correctionReason: null,
        }),
      )
      .digest('hex');
    expect(
      f.tx.caseArchiveReceipt.create.mock.calls[0]![0].data.requestFingerprint,
    ).toBe(legacyFingerprint);
  });
  it('persists and audits a supplied note and includes it in the request fingerprint', async () => {
    const f = fixture();
    await f.service.archive(actor, caseId, {
      ...input,
      archiveNote: '补充备注',
    });
    expect(f.tx.caseArchiveVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ archiveNote: '补充备注' }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({ archiveNote: '补充备注' }),
      }),
    });
    const saved = f.tx.caseArchiveReceipt.create.mock.calls[0]![0].data;
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue(saved);
    await expect(
      f.service.archive(actor, caseId, { ...input, archiveNote: '另一条备注' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it.each([
    ['omitted', input],
    ['undefined', { ...input, archiveNote: undefined }],
    ['null', { ...input, archiveNote: null }],
    ['empty string', { ...input, archiveNote: '' }],
  ])(
    'normalizes an %s note to null without changing the legacy fingerprint',
    async (_label, request) => {
      const f = fixture();
      await f.service.archive(actor, caseId, request);
      expect(f.tx.caseArchiveVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ archiveNote: null }),
      });
      expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: expect.objectContaining({ archiveNote: null }),
        }),
      });
      const expectedFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            caseId,
            command: 'ARCHIVE',
            expectedVersion: input.expectedVersion,
            expectedClosureVersionId: input.expectedClosureVersionId,
            expectedArchiveVersionId: null,
            archiveAt: input.archiveAt,
            archiveType: input.archiveType,
            archiveReason: input.archiveReason,
            correctionReason: null,
          }),
        )
        .digest('hex');
      expect(
        f.tx.caseArchiveReceipt.create.mock.calls[0]![0].data
          .requestFingerprint,
      ).toBe(expectedFingerprint);
    },
  );
  it('archives a real closure created after an imported WAITING_ARCHIVE root', async () => {
    const f = fixture();
    Object.assign(f.record, {
      sourceLeadId: null,
      sourceNotaryMatterId: null,
      certificateId: null,
      externalEntry: {
        id: id('f'),
        caseId,
        departmentId: actor.departmentId,
        initialStage: 'WAITING_ARCHIVE',
        stageReachedOn: new Date('2019-12-31T00:00:00.000Z'),
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
      version: 2,
      currentJudgmentNextStepId: null,
      currentJudgmentNextStep: null,
      currentExecutionSubmissionId: null,
      currentExecutionSubmission: null,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
    });
    Object.assign(f.record.closure, {
      finishId: null,
      externalEntryId: id('f'),
    });
    f.record.closure.currentVersion.toVersion = 2;
    Object.assign(f.record.closure.versions[0], {
      finishId: null,
      externalEntryId: id('f'),
      fromVersion: 1,
      toVersion: 2,
    });
    await expect(
      f.service.archive(actor, caseId, { ...input, expectedVersion: 2 }),
    ).resolves.toMatchObject({ stage: 'ARCHIVED', version: 3 });
  });
  it('appends an internal correction while retaining the frozen closure anchor and original receipt', async () => {
    const f = fixture();
    const original = await f.service.archive(actor, caseId, input);
    f.record.stage = 'ARCHIVED';
    f.record.version = 27;
    f.record.archive = {
      id: original.archiveId,
      closureId: id('d'),
      closureVersionId: id('e'),
      currentVersionId: original.archiveVersionId,
      versions: [
        {
          id: original.archiveVersionId,
          closureVersionId: id('e'),
          kind: 'ARCHIVE',
          priorVersionId: null,
          fromVersion: 26,
          toVersion: 27,
        },
      ],
    };
    const correction = await f.service.correct(actor, caseId, {
      ...input,
      expectedVersion: 27,
      idempotencyKey: 'correct',
      expectedArchiveVersionId: original.archiveVersionId,
      archiveReason: '完整新资料',
      correctionReason: '原分类错误',
    });
    expect(lockArchiveCaseScopeDraft).toHaveBeenCalledTimes(1);
    expect(prepareArchiveFinancialDraft).toHaveBeenCalledTimes(1);
    expect(f.financial.persist).toHaveBeenCalledTimes(1);
    expect(correction).toMatchObject({
      archiveId: original.archiveId,
      closureId: original.closureId,
      closureVersionId: original.closureVersionId,
      stage: 'ARCHIVED',
      version: 28,
    });
    expect(f.tx.caseArchiveVersion.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        kind: 'CORRECT',
        priorVersionId: original.archiveVersionId,
        closureVersionId: id('e'),
        correctionReason: '原分类错误',
      }),
    });
    const saved = f.tx.caseArchiveReceipt.create.mock.calls[0][0].data;
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue({
      ...saved,
      resultSnapshot: original,
    });
    f.record.version = 99;
    expect(await f.service.archive(actor, caseId, input)).toEqual(original);
    expect(f.tx.caseArchiveReceipt.create).toHaveBeenCalledTimes(2);
    await expect(
      f.service.archive(actor, caseId, { ...input, archiveReason: '异参' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    await expect(
      f.service.archive(actor, id('f'), input),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'ACTION_FORBIDDEN' } },
    );
  });
  it('allows only the current PRIMARY lawyer to archive, forbids correction and rechecks lost binding before replay', async () => {
    const f = fixture();
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    const original = await f.service.archive(lawyer, caseId, input);
    expect(f.tx.caseLawyerAssignment.findFirst).toHaveBeenCalled();
    expect(
      f.tx.$queryRawUnsafe.mock.calls.some((call) =>
        String(call[0]).includes('FOR SHARE OF b, u, a'),
      ),
    ).toBe(false);
    expect(prepareArchiveFinancialDraft).toHaveBeenCalledWith(f.tx, lawyer, {
      purpose: 'ARCHIVE_AGGREGATE_ONLY',
    });
    expect(f.financial.persist).toHaveBeenCalledWith(
      original.archiveVersionId,
      input.expectedClosureVersionId,
    );
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue(
      f.tx.caseArchiveReceipt.create.mock.calls[0][0].data,
    );
    f.tx.caseLawyerAssignment.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.archive(lawyer, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.correct(lawyer, caseId, {
        ...input,
        expectedArchiveVersionId: original.archiveVersionId,
        correctionReason: '不能更正',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it.each(['CLIENT', 'NOTARY', 'DISABLED'])(
    'rejects external or disabled accounts: %s',
    async (accountType) => {
      const f = fixture();
      f.tx.userAccount.findUnique.mockResolvedValue({
        active: accountType !== 'DISABLED',
        accountType,
      });
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.tx.caseArchiveVersion.create).not.toHaveBeenCalled();
    },
  );
  it('requires the archive action and responsible scope, not a read grant', async () => {
    const f = fixture();
    await f.service.archive(actor, caseId, input);
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.archive',
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
  });
  it.each(['stage', 'anchor', 'gap', 'prior', 'finish', 'choice'])(
    'rejects broken exact predecessor: %s',
    async (part) => {
      const f = fixture();
      if (part === 'stage') f.record.stage = 'EXECUTING';
      if (part === 'anchor') f.record.closure.currentVersionId = id('f');
      if (part === 'gap') f.record.closure.versions[0].fromVersion = 24;
      if (part === 'prior')
        f.record.closure.versions[0].priorVersionId = id('f');
      if (part === 'finish') f.record.executionFiling.toVersion = 23;
      if (part === 'choice') f.record.currentJudgmentNextStep.next = 'CLOSE';
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );
  it('retries complete serializable transactions and detects lost CAS', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(
      f.service.archive(actor, caseId, input),
    ).resolves.toMatchObject({ stage: 'ARCHIVED' });
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    f.tx.case.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'VERSION_CONFLICT' } },
    );
  });
  it.each([
    { archiveAt: '2020-02-30' },
    { archiveAt: '2999-01-01' },
    { archiveAt: null },
    { archiveAt: '0000-01-01' },
    { archiveType: 'UNKNOWN' },
    { archiveReason: '   ' },
    { archiveReason: 'x'.repeat(2001) },
    { idempotencyKey: ' key' },
    { expectedClosureVersionId: 'bad' },
    { expectedVersion: 1.1 },
    { extra: true },
  ])('rejects invalid explicit input %j', async (change) => {
    const f = fixture();
    await expect(
      f.service.archive(actor, caseId, { ...input, ...change } as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });
  it('rejects every omitted key and an incomplete correction', async () => {
    const f = fixture();
    for (const key of Object.keys(input))
      await expect(
        f.service.archive(
          actor,
          caseId,
          Object.fromEntries(
            Object.entries(input).filter(([k]) => k !== key),
          ) as never,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    await expect(
      f.service.correct(actor, caseId, {
        ...input,
        expectedArchiveVersionId: id('f'),
        correctionReason: '  ',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
});
