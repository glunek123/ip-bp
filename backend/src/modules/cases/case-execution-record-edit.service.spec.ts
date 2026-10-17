import { ForbiddenException } from '@nestjs/common';
import { CaseExecutionRecordEditService } from './case-execution-record-edit.service';
import { readCaseSourceAnchor } from './case-entry-source';
import { assertExecutionSourceChain } from './case-execution-source';

jest.mock('./case-entry-source', () => ({ readCaseSourceAnchor: jest.fn() }));
jest.mock('./case-execution-source', () => ({
  assertExecutionSourceChain: jest.fn(),
}));
const id = (value: number) =>
  `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const actor = { userId: id(1), departmentId: id(2), authorizationRevision: 1 };
const caseId = id(3);
const targetId = id(4);
const fileId = id(5);
const oldFileId = id(6);
const roundId = id(7);
const correctionId = id(8);
const cases = [
  {
    kind: 'MAILING',
    method: 'correctMailing',
    target: 'mailingId',
    revision: 'mailingRevision',
    expected: 'expectedMailingRevision',
    date: 'mailedAt',
    files: 'mailReceiptContentVersionIds',
    delegate: 'caseExecutionMailing',
    corrections: 'caseExecutionMailingRecordCorrection',
    command: 'EXECUTION_MAILING_CORRECTION',
    material: 'EXECUTION_MAILING',
    category: 'MAIL_RECEIPT',
    action: 'case.execution.mailing.correct',
  },
  {
    kind: 'FILING',
    method: 'correctFiling',
    target: 'filingId',
    revision: 'filingRevision',
    expected: 'expectedFilingRevision',
    date: 'submittedAt',
    files: 'executionFilingProofContentVersionIds',
    delegate: 'caseExecutionFiling',
    corrections: 'caseExecutionFilingRecordCorrection',
    command: 'EXECUTION_FILING_CORRECTION',
    material: 'EXECUTION_FILING',
    category: 'EXECUTION_FILING_PROOF',
    action: 'case.execution.filing.correct',
  },
  {
    kind: 'FINISH',
    method: 'correctFinish',
    target: 'finishId',
    revision: 'finishRevision',
    expected: 'expectedFinishRevision',
    date: 'finishedAt',
    files: 'basisContentVersionIds',
    delegate: 'caseExecutionFinish',
    corrections: 'caseExecutionFinishRecordCorrection',
    command: 'EXECUTION_FINISH_CORRECTION',
    material: 'EXECUTION_FINISH',
    category: 'EXECUTION_FINISH_BASIS',
    action: 'case.execution.finish.correct',
  },
] as const;

function fixture() {
  jest.mocked(readCaseSourceAnchor).mockResolvedValue({ kind: 'NORMAL' });
  jest.mocked(assertExecutionSourceChain).mockResolvedValue(undefined);
  const record = {
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    currentTrialRoundId: roundId,
    currentExecutionSubmission: { trialRoundId: roundId },
    stage: 'ARCHIVED',
    version: 42,
    currentJudgmentNextStepId: id(9),
    currentExecutionSubmissionId: id(10),
    closureId: id(11),
    archiveId: id(12),
  };
  const original = {
    id: targetId,
    caseId,
    departmentId: actor.departmentId,
    externalEntryId: null,
    mailedAt: new Date('2026-09-01'),
    submittedAt: new Date('2026-09-02'),
    finishedAt: new Date('2026-09-03'),
    reason: '原结束原因',
    basisNote: '原依据',
    versions: [{ materialId: id(13), contentVersionId: oldFileId }],
  };
  const delegate = () => ({
    findFirst: jest.fn().mockResolvedValue(original),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn(),
    updateMany: jest.fn(),
  });
  const corrections = () => ({
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  });
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
    case: {
      findFirst: jest.fn().mockResolvedValue(record),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
    },
    caseSectionRecordEditReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    caseExecutionMailing: delegate(),
    caseExecutionFiling: delegate(),
    caseExecutionFinish: delegate(),
    caseExecutionMailingRecordCorrection: corrections(),
    caseExecutionFilingRecordCorrection: corrections(),
    caseExecutionFinishRecordCorrection: corrections(),
    caseAcceptance: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { acceptedAt: new Date('2026-08-01'), corrections: [] },
        ]),
    },
    caseSecondInstanceAcceptanceChange: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    caseClosure: {
      findMany: jest.fn().mockResolvedValue([
        {
          currentVersionId: id(15),
          currentVersion: { closeAt: new Date('2026-10-10') },
          recordCorrections: [],
        },
      ]),
      update: jest.fn(),
    },
    caseArchive: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { currentVersion: { archiveAt: new Date('2026-10-11') } },
        ]),
      update: jest.fn(),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  const facts = [
    {
      departmentId: actor.departmentId,
      materialId: id(14),
      contentVersionId: fileId,
    },
  ];
  const materials = {
    assertAvailableVersions: jest.fn().mockResolvedValue(facts),
    freezeCaseSectionRecordCorrectionReferences: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const service = new CaseExecutionRecordEditService(
    database as never,
    access as never,
    materials as never,
  );
  return { record, original, tx, database, access, facts, materials, service };
}

describe.each(cases)('$method', (definition) => {
  const input = () => ({
    [definition.target]: targetId,
    [definition.expected]: 0,
    [definition.date]: '2026-10-01',
    [definition.files]: [fileId],
    idempotencyKey: 'same-original-key',
    ...(definition.kind === 'FINISH'
      ? { reason: '新结束原因', basisNote: null, correctionReason: '订正登记' }
      : { reason: '订正登记' }),
  });
  function invoke(
    f: ReturnType<typeof fixture>,
    body = input(),
    identity = actor,
  ) {
    // Runtime validation intentionally receives untrusted request bodies.
    if (definition.kind === 'MAILING')
      return f.service.correctMailing(identity, caseId, body as never);
    if (definition.kind === 'FILING')
      return f.service.correctFiling(identity, caseId, body as never);
    return f.service.correctFinish(identity, caseId, body as never);
  }

  it('uses one trimmed correction reason for the row, audit, and receipt fingerprint without changing the original request', async () => {
    const reasonField =
      definition.kind === 'FINISH' ? 'correctionReason' : 'reason';
    const body = { ...input(), [reasonField]: '  correction text  ' };
    const originalBody = structuredClone(body);
    const f = fixture();
    const result = await invoke(f, body);
    expect(body).toEqual(originalBody);
    expect(f.tx[definition.corrections].create).toHaveBeenCalledWith({
      data: expect.objectContaining({ correctionReason: 'correction text' }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({
          correctionReason: 'correction text',
        }),
      }),
    });
    const receipt =
      f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
    expect(receipt.idempotencyKey).toBe(body.idempotencyKey);

    const clean = fixture();
    await invoke(clean, { ...body, [reasonField]: 'correction text' });
    const cleanReceipt =
      clean.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
    expect(receipt.requestFingerprint).toBe(cleanReceipt.requestFingerprint);

    f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue(receipt);
    expect(await invoke(f, body)).toEqual(result);
    expect(body).toEqual(originalBody);
    expect(f.tx[definition.corrections].create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
  });

  it.each(['   ', 'x'.repeat(501)])(
    'keeps invalid correction reasons out of the transaction',
    async (reason) => {
      const f = fixture();
      const reasonField =
        definition.kind === 'FINISH' ? 'correctionReason' : 'reason';
      await expect(
        invoke(f, { ...input(), [reasonField]: reason }),
      ).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('appends an exact target correction after archive without changing workflow roots or old evidence', async () => {
    const f = fixture();
    const before = structuredClone({ record: f.record, original: f.original });
    const result = await invoke(f);
    expect(result).toEqual({
      caseId,
      correctionId: expect.any(String),
      recordedAt: expect.any(String),
      [definition.target]: targetId,
      [definition.revision]: 1,
      [definition.date]: '2026-10-01',
    });
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      caseId,
      actor.departmentId,
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      definition.action,
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
    expect(f.tx[definition.delegate].findFirst).toHaveBeenCalledWith({
      where: { id: targetId, caseId, departmentId: actor.departmentId },
      include: { versions: true },
    });
    expect(f.tx[definition.corrections].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        [definition.target]: targetId,
        caseId,
        departmentId: actor.departmentId,
        fromRevision: 0,
        toRevision: 1,
        priorCorrectionId: null,
        correctionReason: '订正登记',
        [definition.date]: new Date('2026-10-01'),
      }),
    });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      {
        ownerType: 'CASE',
        ownerId: caseId,
        category: definition.category,
        sectionRecordKind: definition.material,
        sectionRecordTarget: {
          kind: definition.material,
          targetId,
          expectedRevision: 0,
        },
        contentVersionIds: [fileId],
        minCount: definition.kind === 'FINISH' ? 0 : 1,
        maxCount: 10,
      },
    );
    expect(
      f.materials.freezeCaseSectionRecordCorrectionReferences,
    ).toHaveBeenCalledWith(
      f.tx,
      actor,
      caseId,
      { kind: definition.material, correctionId: result.correctionId },
      f.facts,
      expect.any(String),
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: caseId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        details: expect.objectContaining({
          [definition.target]: targetId,
          correctionId: result.correctionId,
          fromRevision: 0,
          toRevision: 1,
          correctionReason: '订正登记',
          before: expect.objectContaining({ contentVersionIds: [oldFileId] }),
          after: expect.objectContaining({
            [definition.date]: '2026-10-01',
            contentVersionIds: [fileId],
          }),
        }),
      }),
    });
    expect(f.tx.caseSectionRecordEditReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        command: definition.command,
        idempotencyKey: 'same-original-key',
        resultSnapshot: result,
      }),
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.case.update).not.toHaveBeenCalled();
    expect(f.tx[definition.delegate].update).not.toHaveBeenCalled();
    expect(f.tx.caseClosure.update).not.toHaveBeenCalled();
    expect(f.tx.caseArchive.update).not.toHaveBeenCalled();
    expect({ record: f.record, original: f.original }).toEqual(before);
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('chains the correction to the latest exact target and uses its effective before values', async () => {
    const f = fixture();
    f.tx[definition.corrections].findFirst.mockResolvedValue({
      id: correctionId,
      toRevision: 2,
      [definition.date]: new Date('2026-09-20'),
      documents: [{ contentVersionId: fileId }],
      businessReason: '有效原因',
      basisNote: null,
    });
    await invoke(f, { ...input(), [definition.expected]: 2 });
    expect(f.tx[definition.corrections].findFirst).toHaveBeenCalledWith({
      where: {
        caseId,
        departmentId: actor.departmentId,
        [definition.target]: targetId,
      },
      orderBy: { toRevision: 'desc' },
      include: { documents: true },
    });
    expect(f.tx[definition.corrections].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        priorCorrectionId: correctionId,
        fromRevision: 2,
        toRevision: 3,
      }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({
          before: expect.objectContaining({
            [definition.date]: '2026-09-20',
            contentVersionIds: [fileId],
          }),
        }),
      }),
    });
  });

  it('returns the exact success after current authorization even when the target revision has since advanced', async () => {
    const f = fixture();
    const first = await invoke(f);
    const receipt =
      f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
    f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue({
      ...receipt,
    });
    f.tx[definition.corrections].findFirst.mockRejectedValue(
      new Error('must not reload target before replay'),
    );
    expect(await invoke(f)).toEqual(first);
    expect(f.tx[definition.corrections].create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledTimes(1);
  });

  it('rejects same-key changed bodies and revoked authorization before receipt replay', async () => {
    const f = fixture();
    await invoke(f);
    const receipt =
      f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
    f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue({
      ...receipt,
    });
    await expect(
      invoke(f, { ...input(), [definition.date]: '2026-10-02' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    const reads =
      f.tx.caseSectionRecordEditReceipt.findUnique.mock.calls.length;
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseSectionRecordEditReceipt.findUnique).toHaveBeenCalledTimes(
      reads,
    );
    expect(f.tx[definition.corrections].create).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-department cases and different target IDs before writing', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    f.tx.$queryRawUnsafe.mockResolvedValue([{ id: caseId }]);
    f.tx[definition.delegate].findFirst.mockResolvedValue(null);
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['CLIENT', 'LAWYER', 'NOTARY', 'INTERNAL_INACTIVE'])(
    'does not grant %s a correction right',
    async (accountType) => {
      const f = fixture();
      f.tx.userAccount.findUnique.mockResolvedValue({
        active: accountType !== 'INTERNAL_INACTIVE',
        accountType,
      });
      await expect(invoke(f)).rejects.toMatchObject({
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(
        f.tx.caseSectionRecordEditReceipt.findUnique,
      ).not.toHaveBeenCalled();
    },
  );

  it('requires the exact current correction revision', async () => {
    const f = fixture();
    await expect(
      invoke(f, { ...input(), [definition.expected]: 1 }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects no-op values including the same exact frozen file set', async () => {
    const f = fixture();
    const body = {
      ...input(),
      [definition.date]: f.original[definition.date].toISOString().slice(0, 10),
      [definition.files]: [oldFileId],
      ...(definition.kind === 'FINISH'
        ? { reason: f.original.reason, basisNote: f.original.basisNote }
        : {}),
    };
    await expect(invoke(f, body)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.caseSectionRecordEditReceipt.create).not.toHaveBeenCalled();
  });

  it('allows file-only correction and canonicalizes case-insensitive UUIDs', async () => {
    const f = fixture();
    await invoke(f, {
      ...input(),
      [definition.date]: f.original[definition.date].toISOString().slice(0, 10),
      [definition.target]: targetId.toUpperCase(),
    });
    expect(f.tx[definition.corrections].create).toHaveBeenCalledTimes(1);
  });

  it.each(['2026-02-30', '2999-01-01'])(
    'rejects malformed/future business date %s without starting a transaction',
    async (date) => {
      const f = fixture();
      await expect(
        invoke(f, { ...input(), [definition.date]: date }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate files, unknown fields, and fractional revisions', async () => {
    const f = fixture();
    for (const changes of [
      { [definition.files]: [fileId, fileId.toUpperCase()] },
      { stage: 'EXECUTING' },
      { [definition.expected]: 0.5 },
    ])
      await expect(invoke(f, { ...input(), ...changes })).rejects.toMatchObject(
        { response: { code: 'VALIDATION_ERROR' } },
      );
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it.each(['audit', 'correction', 'freeze', 'receipt'])(
    'propagates %s failure from the sole transaction',
    async (point) => {
      const f = fixture();
      const cause = new Error(`${point} failed`);
      const mutation =
        point === 'audit'
          ? f.tx.auditEvent.create
          : point === 'correction'
            ? f.tx[definition.corrections].create
            : point === 'freeze'
              ? f.materials.freezeCaseSectionRecordCorrectionReferences
              : f.tx.caseSectionRecordEditReceipt.create;
      mutation.mockRejectedValue(cause);
      await expect(invoke(f)).rejects.toBe(cause);
      expect(f.database.$transaction).toHaveBeenCalledTimes(1);
      if (point !== 'receipt')
        expect(f.tx.caseSectionRecordEditReceipt.create).not.toHaveBeenCalled();
    },
  );

  it('retries serialization failures with the original normalized body and key', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await invoke(f);
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(f.tx.caseSectionRecordEditReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKey: 'same-original-key' }),
    });
  });

  it('checks the imported entry anchor and real known lower date without inventing predecessor facts', async () => {
    const f = fixture();
    const source = {
      kind: 'EXTERNAL_ENTRY' as const,
      entryId: id(22),
      initialStage: 'WAITING_EXECUTION_STAMP' as const,
      stageReachedOn: '2026-10-02',
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
    };
    jest.mocked(readCaseSourceAnchor).mockResolvedValue(source);
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    f.tx[definition.delegate].findFirst.mockResolvedValue({
      ...f.original,
      externalEntryId: source.entryId,
    });
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    jest
      .mocked(readCaseSourceAnchor)
      .mockResolvedValue({ ...source, stageReachedOn: '2026-09-01' });
    await expect(invoke(f)).resolves.toMatchObject({
      [definition.revision]: 1,
    });
    expect(f.tx[definition.delegate].create).not.toHaveBeenCalled();
  });

  it('rejects internal accounts carrying an external identity hint before reading a receipt', async () => {
    const f = fixture();
    for (const hint of [
      { clientCustomerId: id(24) },
      { lawyerAccountId: id(24) },
      { notaryOfficeId: id(24) },
    ])
      await expect(
        invoke(f, input(), { ...actor, ...hint }),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseSectionRecordEditReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('allows a lawful correction after the recorded closure or archive date without adding chronological gates', async () => {
    const f = fixture();
    f.tx.caseClosure.findMany.mockResolvedValue([
      {
        currentVersionId: id(15),
        currentVersion: { closeAt: new Date('2026-08-01') },
        recordCorrections: [],
      },
    ]);
    f.tx.caseArchive.findMany.mockResolvedValue([
      { currentVersion: { archiveAt: new Date('2026-08-02') } },
    ]);
    await expect(invoke(f)).resolves.toMatchObject({
      [definition.revision]: 1,
    });
    expect(f.tx.caseClosure.findMany).not.toHaveBeenCalled();
    expect(f.tx.caseArchive.findMany).not.toHaveBeenCalled();
    expect(f.tx.caseAcceptance.findMany).not.toHaveBeenCalled();
    expect(
      f.tx.caseSecondInstanceAcceptanceChange.findMany,
    ).not.toHaveBeenCalled();
  });
});
