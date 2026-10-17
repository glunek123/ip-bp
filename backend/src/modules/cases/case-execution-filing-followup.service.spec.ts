import { ForbiddenException } from '@nestjs/common';
import { CaseExecutionFilingFollowupService } from './case-execution-filing-followup.service';

const id = (value: number) =>
  `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const actor = { userId: id(1), departmentId: id(2), authorizationRevision: 1 };
const caseId = id(3),
  filingId = id(4),
  rootId = id(0xab),
  fileId = id(0xcd),
  oldFileId = id(0xef),
  bindingId = id(8);
const definitions = [
  {
    method: 'recordFeedback',
    command: 'FEEDBACK_RECORD',
    kind: 'feedback',
    initial: true,
    root: 'feedbackId',
    model: 'caseExecutionFilingFeedback',
    action: 'case.execution.feedback.record',
    event: 'case.execution.feedback.recorded',
  },
  {
    method: 'correctFeedback',
    command: 'FEEDBACK_CORRECT',
    kind: 'feedback',
    initial: false,
    root: 'feedbackId',
    model: 'caseExecutionFilingFeedback',
    action: 'case.execution.feedback.correct',
    event: 'case.execution.feedback.corrected',
  },
  {
    method: 'submitSupplement',
    command: 'SUPPLEMENT_SUBMIT',
    kind: 'supplement',
    initial: true,
    root: 'supplementId',
    model: 'caseExecutionFilingSupplement',
    action: 'case.execution.supplement.submit',
    event: 'case.execution.supplement.submitted',
  },
  {
    method: 'correctSupplement',
    command: 'SUPPLEMENT_CORRECT',
    kind: 'supplement',
    initial: false,
    root: 'supplementId',
    model: 'caseExecutionFilingSupplement',
    action: 'case.execution.supplement.correct',
    event: 'case.execution.supplement.corrected',
  },
] as const;

function fixture() {
  const record = {
    stage: 'EXECUTING',
    version: 42,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
  };
  const filing = {
    id: filingId,
    caseId,
    departmentId: actor.departmentId,
    submittedAt: new Date('2026-10-01'),
    mailingId: id(9),
    fromVersion: 41,
    toVersion: 42,
  };
  const feedbackHead = {
    id: rootId,
    feedbackId: rootId,
    filingId,
    caseId,
    departmentId: actor.departmentId,
    fromRevision: 0,
    toRevision: 1,
    feedbackOn: null,
    courtCaseNo: null,
    content: '原法院反馈',
  };
  const supplementHead = {
    id: rootId,
    supplementId: rootId,
    filingId,
    caseId,
    departmentId: actor.departmentId,
    fromRevision: 0,
    toRevision: 1,
    submittedOn: null,
    note: '原补交说明',
    documents: [{ contentVersionId: oldFileId }],
  };
  const feedback = {
    findFirst: jest
      .fn()
      .mockImplementation(async (args: { where: { OR?: object[] } }) =>
        args.where.OR ? null : feedbackHead,
      ),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn(),
  };
  const supplement = {
    findFirst: jest
      .fn()
      .mockImplementation(async (args: { where: { OR?: object[] } }) =>
        args.where.OR ? null : supplementHead,
      ),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn(),
  };
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('FOR SHARE') ? [{ id: bindingId }] : [{ id: caseId }],
      ),
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
    caseExecutionFiling: {
      findFirst: jest.fn().mockResolvedValue(filing),
      update: jest.fn(),
    },
    caseExecutionFilingFeedback: feedback,
    caseExecutionFilingSupplement: supplement,
    uploadDraft: { findMany: jest.fn().mockResolvedValue([]) },
    caseExecutionFilingFollowupReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  const facts = [
    {
      contentVersionId: fileId,
      materialId: id(10),
      departmentId: actor.departmentId,
    },
  ];
  const materials = {
    assertExecutionSupplementVersions: jest.fn().mockResolvedValue(facts),
    freezeCaseExecutionSupplementReferences: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const service = new CaseExecutionFilingFollowupService(
    database as never,
    access as never,
    materials as never,
  );
  return {
    record,
    filing,
    feedbackHead,
    supplementHead,
    tx,
    database,
    access,
    facts,
    materials,
    service,
  };
}

describe.each(definitions)('$method', (definition) => {
  function input() {
    return {
      filingId,
      [definition.root]: rootId,
      expectedRevision: definition.initial ? 0 : 1,
      idempotencyKey: 'original-key',
      ...(definition.kind === 'feedback'
        ? { feedbackOn: null, courtCaseNo: null, content: '新法院反馈' }
        : { submittedOn: null, note: null, contentVersionIds: [fileId] }),
      ...(definition.initial ? {} : { correctionReason: '纠正已登记内容' }),
    };
  }
  function invoke(
    f: ReturnType<typeof fixture>,
    body: object = input(),
    identity: typeof actor & {
      lawyerAccountId?: string;
      clientCustomerId?: string;
      notaryOfficeId?: string;
    } = actor,
  ) {
    return f.service[definition.method](identity, caseId, body as never);
  }

  it('appends the exact immutable root/version with typed receipt and no workflow mutation', async () => {
    const f = fixture(),
      before = structuredClone({
        record: f.record,
        filing: f.filing,
        feedback: f.feedbackHead,
        supplement: f.supplementHead,
      });
    const result = await invoke(f);
    expect(result).toEqual({
      id: definition.initial ? rootId : expect.any(String),
      filingId,
      [definition.root]: rootId,
      revision: definition.initial ? 1 : 2,
      recordedAt: expect.any(String),
    });
    expect(f.tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      caseId,
      actor.departmentId,
    );
    expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `execution-filing-followup-target:${rootId}`,
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      definition.action,
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
    expect(f.tx.caseExecutionFiling.findFirst).toHaveBeenCalledWith({
      where: { id: filingId, caseId, departmentId: actor.departmentId },
      select: { id: true },
    });
    expect(f.tx[definition.model].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: result.id,
        [definition.root]: rootId,
        priorVersionId: definition.initial ? null : rootId,
        filingId,
        caseId,
        departmentId: actor.departmentId,
        fromRevision: definition.initial ? 0 : 1,
        toRevision: definition.initial ? 1 : 2,
        actorType: 'INTERNAL',
        recordedByUserId: actor.userId,
        internalActorUserId: actor.userId,
      }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: definition.event,
        resourceId: caseId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        details: expect.objectContaining({
          versionId: result.id,
          filingId,
          [definition.root]: rootId,
          fromRevision: definition.initial ? 0 : 1,
          toRevision: definition.initial ? 1 : 2,
          correctionReason: definition.initial ? null : '纠正已登记内容',
          before: definition.initial ? null : expect.any(Object),
          after:
            definition.kind === 'feedback'
              ? { feedbackOn: null, courtCaseNo: null, content: '新法院反馈' }
              : { submittedOn: null, note: null, contentVersionIds: [fileId] },
        }),
      }),
    });
    expect(f.tx.caseExecutionFilingFollowupReceipt.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          command: definition.command,
          idempotencyKey: 'original-key',
          feedbackVersionId: definition.kind === 'feedback' ? result.id : null,
          supplementVersionId:
            definition.kind === 'supplement' ? result.id : null,
          resultSnapshot: result,
        }),
      },
    );
    if (definition.kind === 'supplement') {
      expect(
        f.materials.assertExecutionSupplementVersions,
      ).toHaveBeenCalledWith(
        f.tx,
        actor,
        caseId,
        {
          filingId,
          supplementId: rootId,
          expectedRevision: definition.initial ? 0 : 1,
        },
        [fileId],
      );
      expect(
        f.materials.freezeCaseExecutionSupplementReferences,
      ).toHaveBeenCalledWith(
        f.tx,
        actor,
        caseId,
        {
          filingId,
          supplementId: rootId,
          expectedRevision: definition.initial ? 0 : 1,
          versionId: result.id,
        },
        f.facts,
        expect.any(String),
      );
    } else
      expect(
        f.materials.assertExecutionSupplementVersions,
      ).not.toHaveBeenCalled();
    expect(f.tx.case.update).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseExecutionFiling.update).not.toHaveBeenCalled();
    expect(f.tx[definition.model].update).not.toHaveBeenCalled();
    expect({
      record: f.record,
      filing: f.filing,
      feedback: f.feedbackHead,
      supplement: f.supplementHead,
    }).toEqual(before);
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('uses the current PRIMARY lawyer binding as the actual actor and never an internal grant', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    await invoke(f, input(), { ...actor, lawyerAccountId: actor.userId });
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR SHARE OF b, u, a'),
      actor.userId,
      actor.departmentId,
      caseId,
    );
    expect(f.tx[definition.model].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'LAWYER',
        lawyerAccountBindingId: bindingId,
        recordedByUserId: actor.userId,
      }),
    });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
  });

  it('rejects no current lawyer assignment before receipt lookup', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    f.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes('FOR SHARE') ? [] : [{ id: caseId }],
    );
    await expect(
      invoke(f, input(), { ...actor, lawyerAccountId: actor.userId }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(
      f.tx.caseExecutionFilingFollowupReceipt.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('replays an original success after later stages without rechecking a stale revision or filing', async () => {
    const f = fixture(),
      result = await invoke(f);
    const receipt =
      f.tx.caseExecutionFilingFollowupReceipt.create.mock.calls[0]![0].data;
    f.tx.caseExecutionFilingFollowupReceipt.findUnique.mockResolvedValue({
      ...receipt,
    });
    f.record.stage = 'ARCHIVED';
    f.tx.caseExecutionFiling.findFirst.mockRejectedValue(
      new Error('must not reload after success receipt'),
    );
    const reordered = Object.fromEntries(Object.entries(input()).reverse());
    expect(await invoke(f, reordered)).toEqual(result);
    expect(f.tx[definition.model].create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
  });

  it('rejects same-key changed anchor/business and revalidates revoked rights before replay', async () => {
    const f = fixture();
    await invoke(f);
    f.tx.caseExecutionFilingFollowupReceipt.findUnique.mockResolvedValue({
      ...f.tx.caseExecutionFilingFollowupReceipt.create.mock.calls[0]![0].data,
    });
    for (const patch of [
      { filingId: id(11) },
      { [definition.root]: id(11) },
      definition.kind === 'feedback' ? { content: '异参' } : { note: '异参' },
    ])
      await expect(invoke(f, { ...input(), ...patch })).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
    const reads =
      f.tx.caseExecutionFilingFollowupReceipt.findUnique.mock.calls.length;
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(
      f.tx.caseExecutionFilingFollowupReceipt.findUnique,
    ).toHaveBeenCalledTimes(reads);
  });

  it('uses a shared key namespace for all four commands', async () => {
    const f = fixture();
    await invoke(f);
    f.tx.caseExecutionFilingFollowupReceipt.findUnique.mockResolvedValue({
      ...f.tx.caseExecutionFilingFollowupReceipt.create.mock.calls[0]![0].data,
      command:
        definition.kind === 'feedback'
          ? 'SUPPLEMENT_SUBMIT'
          : 'FEEDBACK_RECORD',
    });
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('rejects extra fields or wrong typed anchors in a stored receipt', async () => {
    const f = fixture();
    await invoke(f);
    const receipt =
      f.tx.caseExecutionFilingFollowupReceipt.create.mock.calls[0]![0].data;
    f.tx.caseExecutionFilingFollowupReceipt.findUnique.mockResolvedValue({
      ...receipt,
      resultSnapshot: { ...receipt.resultSnapshot, stage: 'EXECUTING' },
    });
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT' },
    });
    f.tx.caseExecutionFilingFollowupReceipt.findUnique.mockResolvedValue({
      ...receipt,
      feedbackVersionId: null,
      supplementVersionId: null,
    });
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT' },
    });
  });

  it.each(['WAITING_EXECUTION_FILING', 'WAITING_ARCHIVE', 'ARCHIVED'])(
    'rejects fresh writes at %s',
    async (stage) => {
      const f = fixture();
      f.record.stage = stage;
      await expect(invoke(f)).rejects.toMatchObject({
        response: { code: 'INVALID_STATE' },
      });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );

  it('rejects missing local filing or an unrelated exact filing without inventing an external predecessor', async () => {
    const f = fixture();
    f.tx.caseExecutionFiling.findFirst.mockResolvedValue(null);
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx[definition.model].create).not.toHaveBeenCalled();
  });

  it('hides foreign cases and denies client/notary/incorrect account contexts', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    f.tx.$queryRawUnsafe.mockResolvedValue([{ id: caseId }]);
    for (const identity of [
      { ...actor, clientCustomerId: id(12) },
      { ...actor, notaryOfficeId: id(12) },
      { ...actor, lawyerAccountId: actor.userId },
    ])
      await expect(invoke(f, input(), identity)).rejects.toMatchObject({
        response: { code: 'ACTION_FORBIDDEN' },
      });
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: false,
      accountType: 'INTERNAL',
    });
    await expect(invoke(f)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['2026-02-30', '2026-10-01T00:00:00Z', '10/01/2026'])(
    'rejects nonbusiness date %s before a transaction',
    async (date) => {
      const f = fixture();
      await expect(
        invoke(f, {
          ...input(),
          [definition.kind === 'feedback' ? 'feedbackOn' : 'submittedOn']: date,
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['2020-01-01', '2099-01-01'])(
    'accepts legal %s without inferred today or filing/finish date comparisons',
    async (date) => {
      const f = fixture();
      await expect(
        invoke(f, {
          ...input(),
          [definition.kind === 'feedback' ? 'feedbackOn' : 'submittedOn']: date,
        }),
      ).resolves.toBeDefined();
    },
  );

  it('rejects unknown fields and nonintegral revisions', async () => {
    const f = fixture();
    for (const changes of [
      { stage: 'EXECUTING' },
      { expectedRevision: 0.5 },
      { expectedVersion: 42 },
    ])
      await expect(invoke(f, { ...input(), ...changes })).rejects.toMatchObject(
        { response: { code: 'VALIDATION_ERROR' } },
      );
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('normalizes UUID anchors and whitespace without mutating input', async () => {
    const f = fixture(),
      raw = {
        ...input(),
        filingId: filingId.toUpperCase(),
        [definition.root]: rootId.toUpperCase(),
        idempotencyKey: ' original-key ',
        ...(definition.kind === 'feedback' ? { content: ' 新法院反馈 ' } : {}),
      },
      before = structuredClone(raw);
    await invoke(f, raw);
    expect(raw).toEqual(before);
    expect(f.tx.caseExecutionFilingFollowupReceipt.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          filingId,
          idempotencyKey: 'original-key',
        }),
      },
    );
  });

  it.each(['audit', 'version', 'receipt'])(
    'propagates %s failure from the sole transaction',
    async (phase) => {
      const f = fixture(),
        cause = new Error(`${phase} failed`);
      (phase === 'audit'
        ? f.tx.auditEvent.create
        : phase === 'version'
          ? f.tx[definition.model].create
          : f.tx.caseExecutionFilingFollowupReceipt.create
      ).mockRejectedValue(cause);
      await expect(invoke(f)).rejects.toBe(cause);
      expect(f.database.$transaction).toHaveBeenCalledTimes(1);
      if (phase !== 'receipt')
        expect(
          f.tx.caseExecutionFilingFollowupReceipt.create,
        ).not.toHaveBeenCalled();
    },
  );

  it('retries explicit serialization failures with the same request fingerprint/key', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    });
    await invoke(f);
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(
      f.tx.caseExecutionFilingFollowupReceipt.create,
    ).toHaveBeenCalledTimes(1);
  });

  if (definition.initial) {
    it.each(['feedback', 'supplement'])(
      'rejects globally occupied %s root/version UUIDs even outside case scope',
      async (kind) => {
        const f = fixture();
        f.tx[
          kind === 'feedback'
            ? 'caseExecutionFilingFeedback'
            : 'caseExecutionFilingSupplement'
        ].findFirst.mockResolvedValue({ id: rootId } as never);
        await expect(invoke(f)).rejects.toMatchObject({
          response: { code: 'VERSION_CONFLICT' },
        });
        expect(f.tx.caseExecutionFilingFeedback.findFirst).toHaveBeenCalledWith(
          {
            where: { OR: [{ id: rootId }, { feedbackId: rootId }] },
            select: { id: true },
          },
        );
        expect(
          f.tx.caseExecutionFilingSupplement.findFirst,
        ).toHaveBeenCalledWith({
          where: { OR: [{ id: rootId }, { supplementId: rootId }] },
          select: { id: true },
        });
        expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      },
    );
    it('checks all matching draft reservations and rejects foreign or wrong-revision reservations', async () => {
      const f = fixture(),
        draft = {
          ownerType: 'CASE',
          ownerId: caseId,
          departmentId: actor.departmentId,
          executionSupplementFilingId: filingId,
          executionSupplementRevision: 0,
        };
      for (const patch of [
        { ownerId: id(13) },
        { departmentId: id(13) },
        { executionSupplementFilingId: id(13) },
        { executionSupplementRevision: 1 },
      ]) {
        f.tx.uploadDraft.findMany.mockResolvedValue([
          draft,
          { ...draft, ...patch },
        ]);
        await expect(invoke(f)).rejects.toMatchObject({
          response: { code: 'VERSION_CONFLICT' },
        });
      }
      f.tx.uploadDraft.findMany.mockResolvedValue([draft]);
      if (definition.kind === 'supplement')
        await expect(invoke(f)).resolves.toBeDefined();
      else
        await expect(invoke(f)).rejects.toMatchObject({
          response: { code: 'VERSION_CONFLICT' },
        });
    });
  } else {
    it('requires an actual root UUID and exact independent head revision', async () => {
      const f = fixture();
      f.tx[definition.model].findFirst.mockResolvedValueOnce(null);
      await expect(invoke(f)).rejects.toMatchObject({
        response: { code: 'INVALID_STATE' },
      });
      expect(f.tx[definition.model].findFirst).toHaveBeenCalledWith({
        where: {
          id: rootId,
          [definition.root]: rootId,
          filingId,
          caseId,
          departmentId: actor.departmentId,
          fromRevision: 0,
          toRevision: 1,
        },
        select: { id: true },
      });
      await expect(
        invoke(f, { ...input(), expectedRevision: 2 }),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    });
    it('rejects unchanged business values rather than appending a fake correction', async () => {
      const f = fixture();
      const unchanged =
        definition.kind === 'feedback'
          ? { feedbackOn: null, courtCaseNo: null, content: '原法院反馈' }
          : {
              submittedOn: null,
              note: '原补交说明',
              contentVersionIds: [oldFileId],
            };
      await expect(
        invoke(f, { ...input(), ...unchanged }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    });
  }
  if (definition.kind === 'supplement') {
    it('normalizes the exact ordered file set and rejects case-insensitive duplicates', async () => {
      const f = fixture();
      await expect(
        invoke(f, {
          ...input(),
          contentVersionIds: [fileId, fileId.toUpperCase()],
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
      await invoke(f, { ...input(), contentVersionIds: [oldFileId, fileId] });
      expect(
        f.materials.assertExecutionSupplementVersions,
      ).toHaveBeenCalledWith(f.tx, actor, caseId, expect.any(Object), [
        fileId,
        oldFileId,
      ]);
    });
    it.each(['select', 'freeze'])(
      'propagates material %s failure without a success receipt',
      async (phase) => {
        const f = fixture(),
          cause = new Error('material failed');
        (phase === 'select'
          ? f.materials.assertExecutionSupplementVersions
          : f.materials.freezeCaseExecutionSupplementReferences
        ).mockRejectedValue(cause);
        await expect(invoke(f)).rejects.toBe(cause);
        expect(
          f.tx.caseExecutionFilingFollowupReceipt.create,
        ).not.toHaveBeenCalled();
        if (phase === 'select')
          expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      },
    );
  }
});
