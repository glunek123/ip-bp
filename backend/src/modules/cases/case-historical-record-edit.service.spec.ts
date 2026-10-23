import { ValidationPipe } from '@nestjs/common';
import { configureApp } from '../../common/configure-app';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CaseHistoricalRecordEditService } from './case-historical-record-edit.service';
import { readCaseSourceAnchor } from './case-entry-source';
import {
  CorrectClosureRecordDto,
  CorrectHearingRecordDto,
  CorrectJudgmentRecordDto,
} from './case-section-record-edit.dto';

jest.mock('./case-entry-source', () => ({
  readCaseSourceAnchor: jest.fn().mockResolvedValue({ kind: 'NORMAL' }),
}));
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const caseId = id('3');
const roundId = id('4');
const targetId = id('5');
const versionId = id('6');
const fileId = id('7');
const materialId = id('8');
const at = (value: string) => new Date(`${value}T00:00:00.000Z`);
const hearing: CorrectHearingRecordDto = {
  arrangementId: targetId,
  trialRoundId: roundId,
  expectedHearingRevision: 0,
  idempotencyKey: 'hearing',
  reason: '更正真实日期',
  hearingAt: '2026-01-03',
};
const judgment: CorrectJudgmentRecordDto = {
  judgmentId: targetId,
  trialRoundId: roundId,
  expectedJudgmentRevision: 0,
  idempotencyKey: 'judgment',
  reason: '更正真实判决',
  judgmentReceivedAt: '2026-01-05',
  judgmentAmountState: 'KNOWN',
  judgmentAmount: '0',
  paidLitigationFeeState: 'PENDING',
  paidLitigationFee: null,
  judgmentContentVersionIds: [fileId],
};
const closure: CorrectClosureRecordDto = {
  closureId: targetId,
  expectedClosureVersionId: versionId,
  expectedClosureRevision: 0,
  idempotencyKey: 'closure',
  correctionReason: '更正真实结案',
  closeAt: '2026-01-10',
  closeAmountState: 'KNOWN',
  closeAmt: '0',
  note: null,
  closeContentVersionIds: [],
};

function fixture() {
  const record = {
    id: caseId,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    stage: 'ARCHIVED',
    version: 27,
    currentTrialRoundId: roundId,
    currentHearingArrangementId: targetId,
    currentHearingAdvanceId: id('a'),
    currentJudgmentId: id('b'),
    currentJudgmentNextStepId: id('c'),
    currentExecutionSubmissionId: id('d'),
    judgmentFacts: [] as Array<{
      judgmentReceivedAt: Date;
      recordCorrections: Array<{ judgmentReceivedAt: Date }>;
    }>,
    secondInstanceProgresses: [] as Array<{ hearingAt: Date | null }>,
    secondInstanceResults: [] as Array<{ resultReceivedAt: Date }>,
    secondInstanceAcceptanceChanges: [] as Array<{ acceptedAt: Date | null }>,
    acceptances: [] as Array<{
      acceptedAt: Date;
      corrections: Array<{ acceptedAt: Date }>;
    }>,
    executionSubmissions: [],
    executionMailing: null,
    executionFiling: null,
    executionFinish: {
      finishedAt: at('2026-01-08'),
      recordCorrections: [] as Array<{ finishedAt: Date }>,
    },
    closure: {
      currentVersionId: versionId,
      currentVersion: { closeAt: at('2026-01-10') },
      recordCorrections: [],
    },
    archive: { currentVersion: { archiveAt: at('2026-01-12') } },
  };
  const round = {
    revokedAt: null as Date | null,
    externalEntryId: null as string | null,
    sourceResult: null as { resultReceivedAt: Date } | null,
    acceptances: [
      {
        acceptedAt: at('2026-01-01'),
        corrections: [] as Array<{ acceptedAt: Date }>,
      },
    ],
    advances: [] as Array<{
      arrangement: {
        hearingAt: Date | null;
        recordCorrections: Array<{ hearingAt: Date | null }>;
      };
    }>,
  };
  const targetClosure = {
    id: targetId,
    caseId,
    departmentId: actor.departmentId,
    currentVersionId: versionId as string | null,
  };
  const closureVersion = {
    id: versionId,
    closureId: targetId,
    caseId,
    departmentId: actor.departmentId,
    closeAt: at('2026-01-09'),
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: null,
    documents: [],
  };
  const targetHearing = {
    id: targetId,
    trialRoundId: roundId,
    hearingAt: at('2026-01-02'),
    advances: [{ id: id('a') }],
  };
  const targetJudgment = {
    id: targetId,
    trialRoundId: roundId,
    judgmentReceivedAt: at('2026-01-04'),
    judgmentAmountState: 'PENDING',
    judgmentAmount: null,
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
    versions: [{ contentVersionId: fileId }],
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
    case: {
      findFirst: jest.fn().mockImplementation(async () => record),
      updateMany: jest.fn(),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
    },
    caseTrialRound: {
      findFirst: jest.fn().mockResolvedValue(round),
      findMany: jest.fn().mockResolvedValue([]),
    },
    caseHearingArrangement: {
      findFirst: jest.fn().mockResolvedValue(targetHearing),
      update: jest.fn(),
    },
    caseJudgmentFact: {
      findFirst: jest.fn().mockResolvedValue(targetJudgment),
      update: jest.fn(),
    },
    caseClosure: {
      findFirst: jest.fn().mockResolvedValue(targetClosure),
      updateMany: jest.fn(),
    },
    caseClosureVersion: {
      findFirst: jest.fn().mockResolvedValue(closureVersion),
      create: jest.fn(),
    },
    caseHearingRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    caseJudgmentRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    caseClosureRecordCorrection: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    caseSectionRecordEditReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const committed: unknown[] = [];
  const database = {
    $transaction: jest.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) => {
        const result = await operation(tx);
        committed.push(result);
        return result;
      },
    ),
  };
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  const materials = {
    assertAvailableVersions: jest
      .fn()
      .mockResolvedValue([{ materialId, contentVersionId: fileId }]),
    freezeCaseSectionRecordCorrectionReferences: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  return {
    record,
    round,
    targetClosure,
    closureVersion,
    targetHearing,
    targetJudgment,
    tx,
    database,
    access,
    materials,
    committed,
    service: new CaseHistoricalRecordEditService(
      database as never,
      access as never,
      materials as never,
    ),
  };
}
type Fixture = ReturnType<typeof fixture>;
const invoke = (f: Fixture, kind: 'hearing' | 'judgment' | 'closure') =>
  kind === 'hearing'
    ? f.service.correctHearing(actor, caseId, hearing)
    : kind === 'judgment'
      ? f.service.correctJudgment(actor, caseId, judgment)
      : f.service.correctClosure(actor, caseId, closure);
const errorCode = (code: string) => ({
  response: expect.objectContaining({ code }),
});
const noWrites = (f: Fixture) => {
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  expect(f.tx.caseSectionRecordEditReceipt.create).not.toHaveBeenCalled();
  expect(f.tx.caseHearingRecordCorrection.create).not.toHaveBeenCalled();
  expect(f.tx.caseJudgmentRecordCorrection.create).not.toHaveBeenCalled();
  expect(f.tx.caseClosureRecordCorrection.create).not.toHaveBeenCalled();
};

describe('CaseHistoricalRecordEditService', () => {
  beforeEach(() =>
    jest.mocked(readCaseSourceAnchor).mockResolvedValue({ kind: 'NORMAL' }),
  );
  it.each(['hearing', 'judgment', 'closure'] as const)(
    '%s appends audit/fact/receipt without mutating terminal facts or case anchors',
    async (kind) => {
      const f = fixture();
      const snapshot = structuredClone(f.record);
      const result = await invoke(f, kind);
      expect(result).toEqual(
        expect.objectContaining({
          caseId,
          correctionId: expect.any(String),
          recordedAt: expect.any(String),
        }),
      );
      expect(result).not.toHaveProperty('stage');
      expect(result).not.toHaveProperty('version');
      expect(f.record).toEqual(snapshot);
      expect(f.tx.case.updateMany).not.toHaveBeenCalled();
      expect(f.tx.caseClosure.updateMany).not.toHaveBeenCalled();
      expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
      expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE'),
        caseId,
        actor.departmentId,
      );
      expect(f.access.authorizeCase).toHaveBeenCalledWith(
        actor,
        `case.${kind}.correct`,
        expect.objectContaining({ departmentId: actor.departmentId }),
        f.tx,
      );
      expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: actor.userId,
          internalActorUserId: actor.userId,
          action: `case.${kind}.record-corrected`,
          details: expect.objectContaining({
            fromRevision: 0,
            toRevision: 1,
            before: expect.any(Object),
            after: expect.any(Object),
          }),
        }),
      });
    },
  );
  it.each(['SECOND_INSTANCE', 'EXECUTING', 'WAITING_ARCHIVE', 'ARCHIVED'])(
    'edits a real historical target while stage=%s',
    async (stage) => {
      const f = fixture();
      f.record.stage = stage;
      await f.service.correctJudgment(actor, caseId, judgment);
      expect(f.record.stage).toBe(stage);
    },
  );
  it('freezes precise judgment/closure references via the typed material helper and preserves known zero', async () => {
    const f = fixture();
    await f.service.correctJudgment(actor, caseId, judgment);
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        sectionRecordKind: 'JUDGMENT',
        sectionRecordTarget: {
          kind: 'JUDGMENT',
          targetId,
          expectedRevision: 0,
          trialRoundId: roundId,
        },
        category: 'JUDGMENT',
        contentVersionIds: [fileId],
      }),
    );
    expect(
      f.materials.freezeCaseSectionRecordCorrectionReferences,
    ).toHaveBeenCalledWith(
      f.tx,
      actor,
      caseId,
      { kind: 'JUDGMENT', correctionId: expect.any(String) },
      [{ materialId, contentVersionId: fileId }],
      expect.any(String),
    );
    expect(f.tx.caseJudgmentRecordCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        judgmentAmount: '0.00',
        paidLitigationFee: null,
        trialRoundId: roundId,
      }),
    });
    expect(
      f.tx.caseJudgmentRecordCorrection.create.mock.calls[0]?.[0].data,
    ).not.toHaveProperty('documents');
    await f.service.correctClosure(actor, caseId, {
      ...closure,
      closeContentVersionIds: [fileId],
    });
    expect(f.materials.assertAvailableVersions).toHaveBeenLastCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        sectionRecordKind: 'CLOSURE',
        sectionRecordTarget: {
          kind: 'CLOSURE',
          targetId,
          expectedRevision: 0,
          expectedClosureVersionId: versionId,
        },
      }),
    );
  });
  it('reads the exact closure pointer and its scoped actual version after lock and authorization', async () => {
    const f = fixture();
    await f.service.correctClosure(actor, caseId, {
      ...closure,
      expectedClosureVersionId: versionId.toUpperCase(),
    });
    expect(f.tx.caseClosureVersion.findFirst).toHaveBeenCalledWith({
      where: {
        id: versionId,
        closureId: targetId,
        caseId,
        departmentId: actor.departmentId,
      },
      include: { documents: true },
    });
    expect(f.tx.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.caseClosureVersion.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(f.access.authorizeCase.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.caseClosureVersion.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(f.tx.caseClosureRecordCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceClosureVersionId: versionId,
        fromRevision: 0,
        toRevision: 1,
      }),
    });
  });
  it.each([null, id('9')])(
    'rejects null/advanced current closure pointer with unchanged edit revision: %s',
    async (pointer) => {
      const f = fixture();
      f.targetClosure.currentVersionId = pointer;
      await expect(
        f.service.correctClosure(actor, caseId, closure),
      ).rejects.toMatchObject(errorCode('VERSION_CONFLICT'));
      noWrites(f);
    },
  );
  it('rejects another closure real version even if a pointer incorrectly references it', async () => {
    const f = fixture();
    f.tx.caseClosureVersion.findFirst.mockResolvedValue(null);
    await expect(
      f.service.correctClosure(actor, caseId, closure),
    ).rejects.toMatchObject(errorCode('VERSION_CONFLICT'));
    noWrites(f);
  });
  it('rejects a returned real version that does not equal the expected anchor', async () => {
    const f = fixture();
    f.closureVersion.id = id('9');
    await expect(
      f.service.correctClosure(actor, caseId, closure),
    ).rejects.toMatchObject(errorCode('VERSION_CONFLICT'));
    noWrites(f);
  });
  it('independently rejects stale closure revision and a head anchored to a different workflow version', async () => {
    const f = fixture();
    f.tx.caseClosureRecordCorrection.findFirst.mockResolvedValue({
      id: id('a'),
      toRevision: 1,
      sourceClosureVersionId: id('9'),
    });
    await expect(
      f.service.correctClosure(actor, caseId, closure),
    ).rejects.toMatchObject(errorCode('VERSION_CONFLICT'));
    await expect(
      f.service.correctClosure(actor, caseId, {
        ...closure,
        expectedClosureRevision: 1,
      }),
    ).rejects.toMatchObject(errorCode('VERSION_CONFLICT'));
    noWrites(f);
  });
  it.each(['hearing', 'judgment', 'closure'] as const)(
    '%s replays an identical success after current authorization and before fresh-target checks',
    async (kind) => {
      const f = fixture();
      const first = await invoke(f, kind);
      const materialChecks =
        f.materials.assertAvailableVersions.mock.calls.length;
      const saved =
        f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
      f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue(saved);
      f.targetClosure.currentVersionId = id('9');
      expect(await invoke(f, kind)).toEqual(first);
      expect(f.materials.assertAvailableVersions).toHaveBeenCalledTimes(
        materialChecks,
      );
      expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
      expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
      f.access.authorizeCase.mockRejectedValueOnce(
        new ForbiddenException({ code: 'ACTION_FORBIDDEN' }),
      );
      await expect(invoke(f, kind)).rejects.toMatchObject(
        errorCode('ACTION_FORBIDDEN'),
      );
      expect(
        f.tx.caseSectionRecordEditReceipt.findUnique,
      ).toHaveBeenCalledTimes(2);
    },
  );
  it('same key with changed closure anchor conflicts before reading the fresh target', async () => {
    const f = fixture();
    await f.service.correctClosure(actor, caseId, closure);
    f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue(
      f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data,
    );
    await expect(
      f.service.correctClosure(actor, caseId, {
        ...closure,
        expectedClosureVersionId: id('9'),
      }),
    ).rejects.toMatchObject(errorCode('IDEMPOTENCY_CONFLICT'));
    expect(f.tx.caseClosure.findFirst).toHaveBeenCalledTimes(1);
  });
  it.each(['hearing', 'judgment', 'closure'] as const)(
    '%s rejects cross-scope/nonexistent precise target',
    async (kind) => {
      const f = fixture();
      f.tx.caseHearingArrangement.findFirst.mockResolvedValue(null);
      f.tx.caseJudgmentFact.findFirst.mockResolvedValue(null);
      f.tx.caseClosure.findFirst.mockResolvedValue(null);
      await expect(invoke(f, kind)).rejects.toMatchObject(
        errorCode('RESOURCE_NOT_FOUND'),
      );
      noWrites(f);
    },
  );
  it.each(['hearing', 'judgment', 'closure'] as const)(
    '%s denies non-internal or inactive accounts before receipt replay',
    async (kind) => {
      const f = fixture();
      f.tx.userAccount.findUnique.mockResolvedValue({
        active: true,
        accountType: 'LAWYER',
      });
      await expect(invoke(f, kind)).rejects.toMatchObject(
        errorCode('ACTION_FORBIDDEN'),
      );
      noWrites(f);
      expect(
        f.tx.caseSectionRecordEditReceipt.findUnique,
      ).not.toHaveBeenCalled();
    },
  );
  it('denies missing same-department case lock without a receipt lookup', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      f.service.correctClosure(actor, caseId, closure),
    ).rejects.toMatchObject(errorCode('RESOURCE_NOT_FOUND'));
    noWrites(f);
  });
  it('appends to the exact target head and audits effective before values', async () => {
    const f = fixture();
    f.tx.caseJudgmentRecordCorrection.findFirst.mockResolvedValue({
      id: id('9'),
      toRevision: 2,
      judgmentReceivedAt: at('2026-01-05'),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('1'),
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      documents: [{ contentVersionId: fileId }],
    });
    await f.service.correctJudgment(actor, caseId, {
      ...judgment,
      expectedJudgmentRevision: 2,
    });
    expect(f.tx.caseJudgmentRecordCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        priorCorrectionId: id('9'),
        fromRevision: 2,
        toRevision: 3,
      }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({
          before: expect.objectContaining({ judgmentAmount: '1.00' }),
          after: expect.objectContaining({
            judgmentAmount: '0.00',
            contentVersionIds: [fileId],
          }),
        }),
      }),
    });
  });
  it('rejects no-op against effective hearing rather than original data', async () => {
    const f = fixture();
    f.tx.caseHearingRecordCorrection.findFirst.mockResolvedValue({
      id: id('9'),
      toRevision: 1,
      hearingAt: at(hearing.hearingAt!),
    });
    await expect(
      f.service.correctHearing(actor, caseId, {
        ...hearing,
        expectedHearingRevision: 1,
      }),
    ).rejects.toMatchObject(errorCode('NO_CHANGE'));
    noWrites(f);
  });
  it.each([null, '2099-01-01'])(
    'advanced hearing rejects unknown/future date %s without advancing or reverting',
    async (hearingAt) => {
      const f = fixture();
      await expect(
        f.service.correctHearing(actor, caseId, { ...hearing, hearingAt }),
      ).rejects.toMatchObject(errorCode('VALIDATION_ERROR'));
      noWrites(f);
    },
  );
  it('unadvanced arrangement accepts unknown/future scheduling only without known downstream facts', async () => {
    const f = fixture();
    f.targetHearing.advances = [];
    f.record.executionFinish = null as never;
    f.record.closure = null as never;
    f.record.archive = null as never;
    await f.service.correctHearing(actor, caseId, {
      ...hearing,
      hearingAt: '2099-01-01',
    });
    await f.service.correctHearing(actor, caseId, {
      ...hearing,
      hearingAt: null,
      idempotencyKey: 'unknown',
    });
    expect(f.tx.caseHearingRecordCorrection.create).toHaveBeenCalledTimes(2);
  });
  it('uses effective acceptance and hearing dates for real same-round lower bounds', async () => {
    const f = fixture();
    f.round.acceptances[0]!.corrections = [{ acceptedAt: at('2026-01-06') }];
    await expect(
      f.service.correctJudgment(actor, caseId, judgment),
    ).rejects.toMatchObject(errorCode('VALIDATION_ERROR'));
    f.round.acceptances[0]!.corrections = [];
    f.round.advances = [
      {
        arrangement: {
          hearingAt: at('2026-01-02'),
          recordCorrections: [{ hearingAt: at('2026-01-06') }],
        },
      },
    ];
    await expect(
      f.service.correctJudgment(actor, caseId, judgment),
    ).rejects.toMatchObject(errorCode('VALIDATION_ERROR'));
    noWrites(f);
  });
  it('bounds historical hearing by the effective judgment and preserves downstream snapshots', async () => {
    const f = fixture();
    f.record.judgmentFacts = [
      {
        judgmentReceivedAt: at('2026-01-06'),
        recordCorrections: [{ judgmentReceivedAt: at('2026-01-02') }],
      },
    ];
    await expect(
      f.service.correctHearing(actor, caseId, hearing),
    ).rejects.toMatchObject(errorCode('VALIDATION_ERROR'));
    noWrites(f);
  });
  it('follows real REMAND descendants without comparing enum stages', async () => {
    const f = fixture();
    f.tx.caseTrialRound.findMany
      .mockResolvedValueOnce([{ id: id('9') }])
      .mockResolvedValueOnce([]);
    f.record.secondInstanceResults = [{ resultReceivedAt: at('2026-01-04') }];
    await expect(
      f.service.correctJudgment(actor, caseId, judgment),
    ).rejects.toMatchObject(errorCode('VALIDATION_ERROR'));
    expect(f.tx.case.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          judgmentFacts: expect.objectContaining({
            where: { trialRoundId: { in: [roundId, id('9')] } },
          }),
        }),
      }),
    );
    noWrites(f);
  });
  it('uses real REMAND parent result lower bound and rejects revoked rounds', async () => {
    const f = fixture();
    f.round.sourceResult = { resultReceivedAt: at('2026-01-06') };
    await expect(
      f.service.correctJudgment(actor, caseId, judgment),
    ).rejects.toMatchObject(errorCode('VALIDATION_ERROR'));
    f.round.revokedAt = new Date();
    await expect(
      f.service.correctJudgment(actor, caseId, judgment),
    ).rejects.toMatchObject(errorCode('INVALID_STATE'));
    noWrites(f);
  });
  it('preserves the approved closure date contract without inventing finish or archive ordering', async () => {
    const f = fixture();
    f.record.executionFinish.recordCorrections = [
      { finishedAt: at('2026-01-11') },
    ];
    await expect(
      f.service.correctClosure(actor, caseId, {
        ...closure,
        closeAt: '2026-01-07',
      }),
    ).resolves.toMatchObject({ closeAt: '2026-01-07' });
    await expect(
      f.service.correctClosure(actor, caseId, {
        ...closure,
        closeAt: '2026-01-13',
      }),
    ).resolves.toMatchObject({ closeAt: '2026-01-13' });
  });
  it('does not invent terminal execution/closure/archive upper bounds for historical trial edits', async () => {
    const f = fixture();
    f.record.executionFinish.finishedAt = at('2025-01-01');
    f.record.closure.currentVersion.closeAt = at('2025-01-01');
    f.record.archive.currentVersion.archiveAt = at('2025-01-01');
    await expect(
      f.service.correctHearing(actor, caseId, hearing),
    ).resolves.toMatchObject({ hearingAt: hearing.hearingAt });
    await expect(
      f.service.correctJudgment(actor, caseId, judgment),
    ).resolves.toMatchObject({
      judgmentReceivedAt: judgment.judgmentReceivedAt,
    });
  });
  it.each(['audit', 'fact', 'freeze', 'receipt'] as const)(
    'does not commit any success when %s write fails',
    async (where) => {
      const f = fixture();
      const error = new Error('injected failure');
      if (where === 'audit') f.tx.auditEvent.create.mockRejectedValue(error);
      if (where === 'fact')
        f.tx.caseJudgmentRecordCorrection.create.mockRejectedValue(error);
      if (where === 'freeze')
        f.materials.freezeCaseSectionRecordCorrectionReferences.mockRejectedValue(
          error,
        );
      if (where === 'receipt')
        f.tx.caseSectionRecordEditReceipt.create.mockRejectedValue(error);
      await expect(
        f.service.correctJudgment(actor, caseId, judgment),
      ).rejects.toBe(error);
      expect(f.committed).toEqual([]);
    },
  );
  it('retries serialization failure using the same body and key and maps exhausted CAS contention', async () => {
    const f = fixture();
    f.tx.caseClosureRecordCorrection.create.mockRejectedValueOnce({
      code: 'P2034',
    });
    await f.service.correctClosure(actor, caseId, closure);
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    const g = fixture();
    g.tx.caseClosureRecordCorrection.create.mockRejectedValue({
      meta: { driverAdapterError: { cause: { sqlState: '40001' } } },
    });
    await expect(
      g.service.correctClosure(actor, caseId, closure),
    ).rejects.toMatchObject(errorCode('VERSION_CONFLICT'));
    expect(g.database.$transaction).toHaveBeenCalledTimes(3);
  });
  it('rejects malformed stored receipts instead of adding fields or accepting an arbitrary result', async () => {
    const f = fixture();
    await f.service.correctClosure(actor, caseId, closure);
    const saved =
      f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
    f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue({
      ...saved,
      resultSnapshot: { ...saved.resultSnapshot, stage: 'ARCHIVED' },
    });
    await expect(
      f.service.correctClosure(actor, caseId, closure),
    ).rejects.toMatchObject(errorCode('INVALID_RECEIPT'));
  });
  it.each([
    { expectedClosureVersionId: null },
    { expectedClosureVersionId: undefined },
    { expectedClosureVersionId: id('9').slice(1) },
    { expectedClosureRevision: -1 },
    { expectedClosureRevision: 0.5 },
    { closeAt: '2026-02-30' },
    { closeAt: '2099-01-01' },
    { closeAmountState: 'PENDING', closeAmt: '0' },
    { closeAmt: '-1' },
    { closeAmt: '0.001' },
    { correctionReason: ' ' },
    { note: '' },
    { idempotencyKey: ' key' },
    { closeContentVersionIds: [fileId, fileId.toUpperCase()] },
    { extra: true },
  ])('rejects invalid closure input %j before transaction', async (patch) => {
    const f = fixture();
    expect(() =>
      f.service.correctClosure(actor, caseId, {
        ...closure,
        ...patch,
      } as CorrectClosureRecordDto),
    ).toThrow();
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });
});

it('retains omitted hearing details and appends explicit null without rewriting the original', async () => {
  for (const clear of [false, true]) {
    const f = fixture();
    f.tx.caseHearingArrangement.findFirst.mockResolvedValue({
      id: targetId,
      trialRoundId: roundId,
      hearingAt: at('2026-01-02'),
      hearingPlace: '第一法庭',
      judgeName: '张法官',
      advances: [],
    });
    await f.service.correctHearing(actor, caseId, {
      ...hearing,
      ...(clear ? { hearingPlace: null, judgeName: null } : {}),
    });
    expect(f.tx.caseHearingRecordCorrection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hearingPlace: clear ? null : '第一法庭',
          judgeName: clear ? null : '张法官',
        }),
      }),
    );
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  }
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

it('accepts legacy DTO instances from the real project pipe and replays their existing receipt', async () => {
  const f = fixture();
  const oldResult = await f.service.correctHearing(actor, caseId, hearing);
  const receipt =
    f.tx.caseSectionRecordEditReceipt.create.mock.calls[0]![0].data;
  f.tx.caseSectionRecordEditReceipt.findUnique.mockResolvedValue(receipt);
  const dto = await projectValidationPipe().transform(
    { ...hearing },
    { type: 'body', metatype: CorrectHearingRecordDto },
  );
  expect(dto).toBeInstanceOf(CorrectHearingRecordDto);
  await expect(f.service.correctHearing(actor, caseId, dto)).resolves.toEqual(
    oldResult,
  );
  expect(f.tx.caseHearingRecordCorrection.create).toHaveBeenCalledTimes(1);
  const explicitUndefined = await projectValidationPipe().transform(
    { ...hearing, hearingPlace: undefined, judgeName: undefined },
    { type: 'body', metatype: CorrectHearingRecordDto },
  );
  await expect(
    f.service.correctHearing(actor, caseId, explicitUndefined),
  ).resolves.toEqual(oldResult);
  expect(f.tx.caseHearingRecordCorrection.create).toHaveBeenCalledTimes(1);
  const clearing = fixture();
  const explicitNull = await projectValidationPipe().transform(
    { ...hearing, hearingPlace: null, judgeName: null },
    { type: 'body', metatype: CorrectHearingRecordDto },
  );
  await clearing.service.correctHearing(actor, caseId, explicitNull);
  expect(clearing.tx.caseHearingRecordCorrection.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ hearingPlace: null, judgeName: null }),
    }),
  );
});
