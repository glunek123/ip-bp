import { ForbiddenException } from '@nestjs/common';
import {
  AccessControlService,
  AccessControlSnapshot,
} from '../../access-control/access-control.service';
import {
  CaseHandlingGroupRead,
  handlingCaseScope,
  HandlingGroupCase,
} from './case-handling-group.read';
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const groupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const customerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function source(
  id: string,
  owner = actor.userId,
  teamId: string | null = 'team-a',
): HandlingGroupCase {
  return {
    id,
    departmentId: actor.departmentId,
    customerId,
    businessNo: `CA-${id.slice(0, 3)}`,
    stage: 'WAITING_HEARING',
    responsibleUserId: owner,
    responsibleMembership: { teamId },
    customer: {
      id: customerId,
      departmentId: actor.departmentId,
      name: '真实客户名称',
    },
  };
}
function fixture(
  grants: AccessControlSnapshot['grants'] = [
    { action: 'case.read', scope: 'department' },
    { action: 'case.group.create', scope: 'team', teamId: 'team-a' },
    { action: 'case.group.dissolve', scope: 'team', teamId: 'team-a' },
  ],
) {
  const cases = [
    source('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    source('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other-owner', 'team-b'),
  ];
  const group = {
    id: groupId,
    departmentId: actor.departmentId,
    revision: 1,
    status: 'ACTIVE',
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
    members: cases.map((record) => ({ case: record })),
  };
  const tx = {
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        active: true,
        displayName: '运营',
      }),
    },
    case: {
      findMany: jest.fn().mockResolvedValue([cases[0]]),
      count: jest.fn().mockResolvedValue(1),
    },
    caseHandlingGroup: {
      findFirst: jest.fn().mockResolvedValue(group),
      findMany: jest.fn().mockResolvedValue([group]),
      count: jest.fn().mockResolvedValue(1),
    },
    caseHandlingGroupMember: {
      findMany: jest.fn().mockImplementation(async () =>
        cases.map((record) => ({
          case: {
            departmentId: record.departmentId,
            responsibleMembership: {
              teamId: record.responsibleMembership.teamId,
            },
          },
        })),
      ),
    },
  };
  const database = {
    $transaction: jest.fn(async (run: (value: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const store = {
    loadSnapshot: jest
      .fn()
      .mockResolvedValue({ active: true, authorizationRevision: 1, grants }),
  };
  const access = new AccessControlService(store);
  return {
    reader: new CaseHandlingGroupRead(database as never, access),
    tx,
    cases,
    group,
    store,
  };
}
describe('handling group read and current capabilities', () => {
  it('pushes current read scope into both member relation queries and uses only separate minimal facts for all-member dissolve authorization', async () => {
    const f = fixture([
      { action: 'case.read', scope: 'self' },
      { action: 'case.group.dissolve', scope: 'team', teamId: 'team-a' },
    ]);
    const scope = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    };
    await f.reader.detail(actor, groupId);
    await f.reader.list(actor, {});
    for (const query of [
      f.tx.caseHandlingGroup.findFirst.mock.calls[0]![0],
      f.tx.caseHandlingGroup.findMany.mock.calls[0]![0],
    ]) {
      expect(query.select.members.where).toEqual({ case: { is: scope } });
    }
    expect(f.tx.caseHandlingGroupMember.findMany).toHaveBeenCalledWith({
      where: { groupId, departmentId: actor.departmentId },
      select: {
        case: {
          select: {
            departmentId: true,
            responsibleMembership: { select: { teamId: true } },
          },
        },
      },
    });
    const authorizationProjection =
      f.tx.caseHandlingGroupMember.findMany.mock.calls[0]![0].select;
    expect(JSON.stringify(authorizationProjection)).not.toMatch(
      /businessNo|customer|stage|responsibleUserId/u,
    );
    expect((await f.reader.detail(actor, groupId)).canDissolve).toBe(false);
  });
  it('derives creation from the current grant and rejects SELF even when read is departmental', async () => {
    const allowed = fixture();
    await expect(allowed.reader.capability(actor)).resolves.toEqual({
      canCreate: true,
    });
    const self = fixture([
      { action: 'case.read', scope: 'department' },
      { action: 'case.group.create', scope: 'self' },
    ]);
    await expect(self.reader.capability(actor)).resolves.toEqual({
      canCreate: false,
    });
    await expect(self.reader.candidates(actor, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(self.tx.case.findMany).not.toHaveBeenCalled();
  });
  it('intersects selection with read and exact action scope, retaining business labels and deterministic paging', async () => {
    const f = fixture();
    const result = await f.reader.candidates(actor, {
      page: 2,
      pageSize: 10,
      customerId,
      q: '  %_  ',
    });
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 10,
      items: [{ businessNo: 'CA-aaa', customerName: '真实客户名称' }],
    });
    expect(f.tx.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { departmentId: actor.departmentId },
            {
              departmentId: actor.departmentId,
              responsibleMembership: { is: { teamId: { in: ['team-a'] } } },
            },
            expect.objectContaining({ customerId }),
          ],
        },
        skip: 10,
        take: 10,
        orderBy: [{ businessNo: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(f.tx.case.count.mock.calls[0][0].where).toEqual(
      f.tx.case.findMany.mock.calls[0][0].where,
    );
    expect(f.store.loadSnapshot).toHaveBeenCalledWith(
      actor.userId,
      actor.departmentId,
      f.tx,
    );
  });
  it('returns only currently readable members and no hidden-member count or labels', async () => {
    const f = fixture([
      { action: 'case.read', scope: 'self' },
      { action: 'case.group.dissolve', scope: 'team', teamId: 'team-a' },
    ]);
    const result = await f.reader.detail(actor, groupId);
    expect(result.members.map(({ caseId }) => caseId)).toEqual([
      f.cases[0]!.id,
    ]);
    expect(result.canDissolve).toBe(false);
    expect(Object.keys(result)).toEqual([
      'id',
      'revision',
      'status',
      'createdAt',
      'members',
      'canDissolve',
    ]);
    expect(JSON.stringify(result)).not.toContain(f.cases[1]!.id);
    const list = await f.reader.list(actor, {});
    expect(list.total).toBe(1);
    expect(f.tx.caseHandlingGroup.count).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        members: {
          some: {
            case: {
              is: {
                departmentId: actor.departmentId,
                responsibleUserId: actor.userId,
              },
            },
          },
        },
      },
    });
  });
  it('keeps dissolved source history readable and never offers another dissolve', async () => {
    const f = fixture();
    f.group.status = 'DISSOLVED';
    f.group.revision = 2;
    const result = await f.reader.detail(actor, groupId);
    expect(result.status).toBe('DISSOLVED');
    expect(result.members).toHaveLength(2);
    expect(result.canDissolve).toBe(false);
  });
  it('rejects external, revoked and fully hidden requests and propagates unexpected authorization errors', async () => {
    const f = fixture();
    await expect(
      f.reader.detail({ ...actor, clientCustomerId: customerId }, groupId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.caseHandlingGroup.findFirst).not.toHaveBeenCalled();
    const revoked = fixture();
    await expect(
      revoked.reader.capability({ ...actor, authorizationRevision: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const hidden = fixture([{ action: 'case.read', scope: 'self' }]);
    hidden.cases.forEach((record) => {
      record.responsibleUserId = 'hidden-owner';
    });
    await expect(hidden.reader.detail(actor, groupId)).rejects.toMatchObject({
      response: { code: 'CASE_HANDLING_GROUP_NOT_FOUND' },
    });
    const failed = fixture();
    failed.store.loadSnapshot
      .mockResolvedValueOnce({
        active: true,
        authorizationRevision: 1,
        grants: [{ action: 'case.read', scope: 'department' }],
      })
      .mockRejectedValueOnce(new Error('reader failed'));
    await expect(failed.reader.capability(actor)).rejects.toThrow(
      'reader failed',
    );
  });
  it('projects TEAM alternatives without borrowing SELF or another action department grant', () => {
    expect(
      handlingCaseScope(
        {
          departmentId: actor.departmentId,
          OR: [
            { responsibleUserId: actor.userId },
            { teamId: { in: ['team-a'] } },
          ],
        },
        true,
      ),
    ).toEqual({
      departmentId: actor.departmentId,
      OR: [{ responsibleMembership: { is: { teamId: { in: ['team-a'] } } } }],
    });
  });
});
