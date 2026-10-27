import { CaseConsolidationService } from './case-consolidation.service';
import { ForbiddenException } from '@nestjs/common';
import type { CreateCaseConsolidationDto } from './case-consolidation.dto';

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const firstId = id('3');
const secondId = id('4');
const source = (caseId: string, createdAt: string) => ({
  id: caseId,
  businessNo: `CASE-${caseId.slice(0, 4)}`,
  createdAt: new Date(createdAt),
  customerId: id('5'),
  rightsHolderId: id('6'),
  departmentId: actor.departmentId,
  responsibleUserId: actor.userId,
  stage: 'PENDING_MATCH',
  version: 2,
  responsibleMembership: { teamId: null },
  consolidationMembership: null,
  consolidationAsMain: null,
  defendants: [],
  sourceLead: {
    id: id('7'),
    platform: 'TAOBAO',
    shopName: '同店',
    shopExternalId: 'shop-1',
  },
  externalEntry: null,
});
const sources = [
  source(firstId, '2026-01-02T00:00:00.000Z'),
  source(secondId, '2026-01-01T00:00:00.000Z'),
];
const defendant = {
  kind: 'ORGANIZATION' as const,
  name: '被告公司',
  idNo: '913000000000000001',
};
const members = [firstId, secondId].map((caseId) => ({
  caseId,
  expectedVersion: 2,
  confirmed: true as const,
  defendant,
}));
const input: CreateCaseConsolidationDto = {
  members,
  mainCaseId: secondId,
  idempotencyKey: 'one-request',
};

function fixture() {
  const tx = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    case: {
      findMany: jest.fn().mockResolvedValue(sources),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseConsolidationReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    caseConsolidation: { create: jest.fn().mockResolvedValue({}) },
    caseConsolidationMember: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRawUnsafe: jest
      .fn()
      .mockResolvedValue([{ id: firstId }, { id: secondId }]),
  };
  const database = {
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    authorizeCase: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CaseConsolidationService(
    database as never,
    access as never,
    {} as never,
  );
  return { tx, database, access, service };
}

describe('real case consolidation', () => {
  it('returns validation errors for missing defendant text before opening a transaction', async () => {
    const { service, database } = fixture();
    await expect(
      service.preview(actor, {
        members: [
          {
            ...members[0],
            defendant: { ...defendant, name: undefined as unknown as string },
          },
          members[1],
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it('previews a fixed oldest-created main case and permits explicit main selection', async () => {
    const { service } = fixture();
    const defaultPreview = await service.preview(actor, { members });
    expect(defaultPreview.mainCaseId).toBe(secondId);
    expect(defaultPreview.cases.map((item) => item.id)).toEqual([
      secondId,
      firstId,
    ]);
    expect(defaultPreview.caseCount).toBe(2);
    const changed = await service.preview(actor, {
      members,
      mainCaseId: firstId,
    });
    expect(changed.mainCaseId).toBe(firstId);
    const upper = await service.preview(actor, {
      members: members.map((member) => ({
        ...member,
        caseId: member.caseId.toUpperCase(),
      })),
      mainCaseId: firstId.toUpperCase(),
    });
    expect(upper.mainCaseId).toBe(firstId);
  });

  it('rejects incomplete shop identity, conflicting existing defendant and different rights holder', async () => {
    const { service, tx } = fixture();
    tx.case.findMany.mockResolvedValueOnce([
      {
        ...sources[0],
        sourceLead: { ...sources[0].sourceLead, shopExternalId: null },
      },
      sources[1],
    ]);
    await expect(service.preview(actor, { members })).rejects.toMatchObject({
      response: { code: 'SOURCE_CONFLICT' },
    });
    tx.case.findMany.mockResolvedValueOnce([
      {
        ...sources[0],
        defendants: [{ kind: 'PERSON', name: '他人', idNo: 'x' }],
      },
      sources[1],
    ]);
    await expect(service.preview(actor, { members })).rejects.toMatchObject({
      response: { code: 'SOURCE_CONFLICT' },
    });
    tx.case.findMany.mockResolvedValueOnce([
      sources[0],
      { ...sources[1], rightsHolderId: id('8') },
    ]);
    await expect(service.preview(actor, { members })).rejects.toMatchObject({
      response: { code: 'SOURCE_CONFLICT' },
    });
  });

  it('locks all members and records only immutable relationship, versions and audit; original financial rows stay untouched', async () => {
    const { service, tx } = fixture();
    const result = await service.create(actor, input);
    expect(result.mainCaseId).toBe(secondId);
    expect(result.caseIds).toEqual([firstId, secondId]);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "id" FOR UPDATE'),
      [firstId, secondId],
      actor.departmentId,
    );
    expect(tx.case.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.case.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: firstId, version: 2 }),
        data: { version: { increment: 1 } },
      }),
    );
    expect(tx.caseConsolidationMember.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          caseId: secondId,
          isMain: true,
          originalVersion: 2,
          defendantIdNo: defendant.idNo,
        }),
        expect.objectContaining({
          caseId: firstId,
          isMain: false,
          originalVersion: 2,
        }),
      ]),
    });
    expect(tx.caseConsolidationReceipt.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(tx)).not.toContain('feeRecord');
  });

  it('replays an identical request and rejects a changed body with the same key', async () => {
    const { service, tx } = fixture();
    const snapshot = {
      id: id('9'),
      mainCaseId: secondId,
      mainBusinessNo: 'CASE-4444',
      caseCount: 2,
      caseIds: [firstId, secondId],
      createdAt: '2026-10-27T00:00:00.000Z',
    };
    await service.create(actor, input);
    const fingerprint =
      tx.caseConsolidationReceipt.create.mock.calls[0][0].data
        .requestFingerprint;
    tx.caseConsolidationReceipt.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultSnapshot: snapshot,
    });
    await expect(service.create(actor, input)).resolves.toEqual(snapshot);
    expect(tx.caseConsolidation.create).toHaveBeenCalledTimes(1);
    await expect(
      service.create(actor, { ...input, mainCaseId: firstId }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('rejects stale versions and withdrawn dedicated action before mutating', async () => {
    const { service, tx, access } = fixture();
    tx.case.findMany.mockResolvedValueOnce([
      sources[0],
      { ...sources[1], version: 3 },
    ]);
    await expect(service.create(actor, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(tx.case.updateMany).not.toHaveBeenCalled();
    access.authorizeCase.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.create(actor, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
  });

  it('retries wrapped PostgreSQL serialization failures and limits persistent conflicts', async () => {
    const serialization = {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    };
    const retried = fixture();
    retried.database.$transaction.mockRejectedValueOnce(serialization);
    await expect(retried.service.create(actor, input)).resolves.toMatchObject({
      mainCaseId: secondId,
    });
    expect(retried.database.$transaction).toHaveBeenCalledTimes(2);
    expect(retried.tx.caseConsolidation.create).toHaveBeenCalledTimes(1);

    const exhausted = fixture();
    exhausted.database.$transaction.mockRejectedValue(serialization);
    await expect(exhausted.service.create(actor, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(exhausted.database.$transaction).toHaveBeenCalledTimes(3);

    const unrelated = fixture();
    const otherError = { code: 'P2010', meta: { code: '23505' } };
    unrelated.database.$transaction.mockRejectedValue(otherError);
    await expect(unrelated.service.create(actor, input)).rejects.toBe(
      otherError,
    );
    expect(unrelated.database.$transaction).toHaveBeenCalledTimes(1);
  });
});
