import { ForbiddenException } from '@nestjs/common';
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

describe('early archive command', () => {
  it('archives any unfinished stage without creating closure or normal archive facts', async () => {
    const f = fixture();
    await expect(
      f.service.archive(actor, caseId, input),
    ).resolves.toMatchObject({
      id: caseId,
      fromStage: 'WAITING_HEARING',
      stage: 'ARCHIVED',
      version: 8,
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.archive',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      f.tx,
    );
    expect(f.tx.caseEarlyArchive.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        fromStage: 'WAITING_HEARING',
        fromVersion: 7,
        toVersion: 8,
        reason: input.reason,
      }),
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_HEARING',
          version: 7,
        }),
        data: { stage: 'ARCHIVED', version: { increment: 1 } },
      }),
    );
    expect(f.tx.caseEarlyArchiveReceipt.create).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale version and an already archived case', async () => {
    const f = fixture();
    f.record.version = 8;
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'VERSION_CONFLICT' } },
    );
    expect(f.tx.caseEarlyArchive.create).not.toHaveBeenCalled();
    f.record.version = 7;
    f.record.stage = 'ARCHIVED';
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_STATE' } },
    );
  });
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
    const result = await f.service.archive(actor, caseId, input);
    const receipt = f.tx.caseEarlyArchiveReceipt.create.mock.calls[0]![0].data;
    const fact = f.tx.caseEarlyArchive.create.mock.calls[0]![0].data;
    const audit = f.tx.auditEvent.create.mock.calls[0]![0].data;
    f.tx.caseEarlyArchiveReceipt.findUnique.mockResolvedValue(receipt);
    f.tx.caseEarlyArchive.findUnique.mockResolvedValue(fact);
    f.tx.auditEvent.findUnique.mockResolvedValue({
      ...audit,
      actorKind: 'HUMAN',
      customerAccountBindingId: null,
      notaryOfficeAccountBindingId: null,
      lawyerAccountBindingId: null,
    });
    f.record.stage = 'ARCHIVED';
    f.record.version = 8;
    f.record.earlyArchive = { id: fact.id } as never;
    await expect(f.service.archive(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(f.tx.caseEarlyArchive.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.archive(actor, caseId, { ...input, reason: '另一个原因' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.tx.caseEarlyArchiveReceipt.findUnique.mockResolvedValueOnce(null);
    await expect(
      f.service.archive(actor, caseId, {
        ...input,
        idempotencyKey: 'another-key',
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });
  it('rejects a replay receipt whose fact, audit or snapshot has drifted', async () => {
    const f = fixture();
    await f.service.archive(actor, caseId, input);
    const receipt = f.tx.caseEarlyArchiveReceipt.create.mock.calls[0]![0].data;
    const fact = f.tx.caseEarlyArchive.create.mock.calls[0]![0].data;
    const audit = f.tx.auditEvent.create.mock.calls[0]![0].data;
    f.tx.caseEarlyArchiveReceipt.findUnique.mockResolvedValue(receipt);
    f.tx.caseEarlyArchive.findUnique.mockResolvedValue(fact);
    f.tx.auditEvent.findUnique.mockResolvedValue({
      ...audit,
      actorKind: 'HUMAN',
      customerAccountBindingId: null,
      notaryOfficeAccountBindingId: null,
      lawyerAccountBindingId: null,
    });
    f.record.stage = 'ARCHIVED';
    f.record.version = 8;
    f.record.earlyArchive = { id: fact.id } as never;
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
  it('does not replace a normal archive or another early archive', async () => {
    const f = fixture();
    f.record.archive = { id: id('4') } as never;
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_STATE' } },
    );
    f.record.archive = null;
    f.record.earlyArchive = { id: id('5') } as never;
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_STATE' } },
    );
    expect(f.tx.caseEarlyArchive.create).not.toHaveBeenCalled();
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
