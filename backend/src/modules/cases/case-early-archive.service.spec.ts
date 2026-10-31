import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CaseEarlyArchiveService } from './case-early-archive.service';

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const caseId = id('3');
const input = {
  expectedVersion: 7,
  idempotencyKey: 'early-one',
  archiveAt: '2020-01-01',
  reason: '提前结束办理',
};

function fixture() {
  const record = {
    stage: 'WAITING_HEARING',
    version: 7,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    archive: null,
    earlyArchive: null,
    externalEntry: null,
    consolidationMembership: null as null | { isMain: boolean },
  };
  const tx = {
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
    caseEarlyArchive: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    caseEarlyArchiveReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditEvent: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const database = {
    $transaction: jest
      .fn()
      .mockImplementation(async (operation) => operation(tx)),
  };
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  return {
    record,
    tx,
    access,
    service: new CaseEarlyArchiveService(database as never, access as never),
  };
}

function historicalReceipt(f: ReturnType<typeof fixture>) {
  const recordedAt = new Date('2020-01-01T10:00:00.000Z');
  const fact = {
    id: id('4'),
    caseId,
    departmentId: actor.departmentId,
    fromStage: 'WAITING_HEARING',
    fromVersion: 7,
    toVersion: 8,
    archiveAt: new Date('2020-01-01T00:00:00.000Z'),
    reason: input.reason,
    recordedAt,
    recordedByUserId: actor.userId,
    auditEventId: id('5'),
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        caseId,
        expectedVersion: input.expectedVersion,
        archiveAt: input.archiveAt,
        reason: input.reason,
      }),
    )
    .digest('hex');
  const result = {
    id: caseId,
    earlyArchiveId: fact.id,
    fromStage: fact.fromStage,
    stage: 'ARCHIVED',
    version: 8,
    recordedAt: recordedAt.toISOString(),
  };
  const receipt = {
    caseId,
    departmentId: actor.departmentId,
    actorUserId: actor.userId,
    earlyArchiveId: fact.id,
    requestFingerprint: fingerprint,
    resultSnapshot: result,
  };
  const audit = {
    departmentId: actor.departmentId,
    actorKind: 'HUMAN',
    actorUserId: actor.userId,
    internalActorUserId: actor.userId,
    customerAccountBindingId: null,
    notaryOfficeAccountBindingId: null,
    lawyerAccountBindingId: null,
    resourceType: 'CASE',
    resourceId: caseId,
    action: 'case.early_archived',
    details: {
      earlyArchiveId: fact.id,
      fromStage: fact.fromStage,
      fromVersion: 7,
      toVersion: 8,
      archiveAt: input.archiveAt,
      reason: input.reason,
      requestFingerprint: fingerprint,
    },
  };
  f.tx.caseEarlyArchiveReceipt.findUnique.mockResolvedValue(receipt);
  f.tx.caseEarlyArchive.findUnique.mockResolvedValue(fact);
  f.tx.auditEvent.findUnique.mockResolvedValue(audit);
  f.record.stage = 'ARCHIVED';
  f.record.version = 8;
  f.record.earlyArchive = { id: fact.id } as never;
  return { receipt, fact, audit, result };
}

describe('early archive command', () => {
  it.each(['PENDING_MATCH', 'WAITING_HEARING', 'WAITING_ARCHIVE', 'ARCHIVED'])(
    'rejects a new legacy request in %s without writes',
    async (stage) => {
      const f = fixture();
      f.record.stage = stage;
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'EARLY_ARCHIVE_RETIRED' } });
      expect(f.tx.case.updateMany).not.toHaveBeenCalled();
      expect(f.tx.caseEarlyArchive.create).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      expect(f.tx.caseEarlyArchiveReceipt.create).not.toHaveBeenCalled();
    },
  );
  it('checks current authorization before returning an idempotency receipt', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'ACTION_FORBIDDEN' } },
    );
    expect(f.tx.caseEarlyArchiveReceipt.findUnique).not.toHaveBeenCalled();
  });
  it('replays the same command without a second fact and rejects key reuse with different content', async () => {
    const f = fixture();
    const { result } = historicalReceipt(f);
    await expect(f.service.archive(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(f.tx.caseEarlyArchive.create).not.toHaveBeenCalled();
    await expect(
      f.service.archive(actor, caseId, { ...input, reason: '另一个原因' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.tx.caseEarlyArchiveReceipt.findUnique.mockResolvedValueOnce(null);
    await expect(
      f.service.archive(actor, caseId, {
        ...input,
        idempotencyKey: 'another-key',
      }),
    ).rejects.toMatchObject({ response: { code: 'EARLY_ARCHIVE_RETIRED' } });
  });
  it('rejects a replay receipt whose fact, audit or snapshot has drifted', async () => {
    const f = fixture();
    const { receipt, fact, audit } = historicalReceipt(f);
    const expectInvalid = async () =>
      expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject({
        response: { code: 'INVALID_RECEIPT' },
      });
    f.tx.caseEarlyArchive.findUnique.mockResolvedValueOnce({
      ...fact,
      recordedByUserId: id('9'),
    });
    await expectInvalid();
    f.tx.auditEvent.findUnique.mockResolvedValueOnce({
      ...audit,
      actorKind: 'HUMAN',
      customerAccountBindingId: null,
      notaryOfficeAccountBindingId: null,
      lawyerAccountBindingId: null,
      details: { ...audit.details, reason: '伪造' },
    });
    await expectInvalid();
    f.tx.caseEarlyArchiveReceipt.findUnique.mockResolvedValueOnce({
      ...receipt,
      resultSnapshot: { ...receipt.resultSnapshot, version: 9 },
    });
    await expectInvalid();
  });
  it('rejects external principals and future dates before touching storage', async () => {
    const f = fixture();
    await expect(
      f.service.archive({ ...actor, lawyerAccountId: id('4') }, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.archive(actor, caseId, { ...input, archiveAt: '9999-01-01' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
