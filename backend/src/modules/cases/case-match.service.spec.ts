import { CaseMatchService } from './case-match.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MatchCaseDto } from './case-match.dto';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const input = {
  expectedVersion: 1,
  idempotencyKey: 'match-1',
  matchedOn: '2026-09-28',
  defendants: [{ kind: 'ORGANIZATION' as const, name: '被告公司' }],
  lawyer: { fullName: '张律师', lawFirm: '真实律所' },
};

describe('CaseMatchService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'PENDING_MATCH',
          version: 1,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      caseMatchReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseDefendant: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      lawyerProfile: {
        create: jest.fn().mockResolvedValue({ id: 'lawyer-1' }),
      },
      caseLawyerAssignment: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    return {
      tx,
      db,
      access,
      service: new CaseMatchService(db as never, access as never),
    };
  }

  it('atomically advances version and persists a defendant, real lawyer profile, assignment, audit and receipt', async () => {
    const f = fixture();
    const result = await f.service.match(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_COMPLAINT',
      version: 2,
      matchedAt: expect.any(String),
      matchedOn: '2026-09-28',
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.match',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      f.tx,
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stage: 'PENDING_MATCH', version: 1 }),
        data: expect.objectContaining({
          stage: 'WAITING_COMPLAINT',
          matchedOn: new Date('2026-09-28T00:00:00.000Z'),
        }),
      }),
    );
    expect(f.tx.caseDefendant.createMany).toHaveBeenCalledWith({
      data: [
        {
          caseId,
          departmentId: actor.departmentId,
          kind: 'ORGANIZATION',
          name: '被告公司',
        },
      ],
    });
    expect(f.tx.lawyerProfile.create).toHaveBeenCalledWith({
      data: {
        fullName: '张律师',
        lawFirm: '真实律所',
        departmentId: actor.departmentId,
        phone: undefined,
      },
      select: { id: true },
    });
    expect(f.tx.caseLawyerAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lawyerId: 'lawyer-1',
          role: 'PRIMARY',
        }),
      }),
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({ matchedOn: '2026-09-28' }),
      }),
    });
    expect(f.tx.caseMatchReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.tx.caseMatchReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSnapshot: expect.objectContaining({ matchedOn: '2026-09-28' }),
      }),
    });
  });

  it('matches with no known law firm and never stores a fictitious placeholder', async () => {
    const f = fixture();
    const result = await f.service.match(actor, caseId, {
      ...input,
      lawyer: { fullName: '张律师' },
    } as unknown as MatchCaseDto);
    expect(result).toHaveProperty('matchedOn', '2026-09-28');
    expect(f.tx.lawyerProfile.create).toHaveBeenCalledWith({
      data: {
        fullName: '张律师',
        lawFirm: null,
        phone: undefined,
        departmentId: actor.departmentId,
      },
      select: { id: true },
    });
  });

  it.each(['', '2026-02-30', '2026-09-28T00:00:00Z', '2999-01-01'])(
    'rejects invalid or future actual match date %s before writes',
    async (matchedOn) => {
      const f = fixture();
      await expect(
        f.service.match(actor, caseId, { ...input, matchedOn } as MatchCaseDto),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale version before writing any matching facts', async () => {
    const f = fixture();
    await expect(
      f.service.match(actor, caseId, { ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.lawyerProfile.create).not.toHaveBeenCalled();
  });

  it('returns 404 for another department before authorization or write', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(f.service.match(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('does not replay a receipt after authorization is revoked', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(
      new (await import('@nestjs/common')).ForbiddenException(),
    );
    await expect(f.service.match(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseMatchReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('uses the documented conflict code when a key is reused for different matching facts', async () => {
    const f = fixture();
    f.tx.caseMatchReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'different-request',
    });
    await expect(f.service.match(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });
});

describe('MatchCaseDto', () => {
  it.each([
    ['idempotencyKey', { ...input, idempotencyKey: '' }],
    [
      'defendant name',
      { ...input, defendants: [{ kind: 'ORGANIZATION', name: '' }] },
    ],
    ['lawyer name', { ...input, lawyer: { ...input.lawyer, fullName: '' } }],
    ['matchedOn', { ...input, matchedOn: '' }],
  ])('declares %s as a nonempty required field', (_field, body) => {
    const errors = validateSync(plainToInstance(MatchCaseDto, body));
    expect(JSON.stringify(errors)).toContain('minLength');
  });

  it('allows an omitted law firm while still requiring the lawyer name', () => {
    expect(
      validateSync(
        plainToInstance(MatchCaseDto, {
          ...input,
          lawyer: { fullName: '张律师' },
        }),
      ),
    ).toEqual([]);
  });
});
