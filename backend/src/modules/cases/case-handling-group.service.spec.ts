import { ForbiddenException } from '@nestjs/common';
import {
  AccessControlService,
  AccessControlSnapshot,
} from '../../access-control/access-control.service';
import { CaseHandlingGroupService } from './case-handling-group.service';
import { HandlingGroupCase } from './case-handling-group.read';
import { CreateCaseHandlingGroupDto } from './case-handling-group.dto';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 2,
};
const ids = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];
const groupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const customerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const createInput = (): CreateCaseHandlingGroupDto => ({
  groupId,
  caseIds: [...ids].reverse(),
  idempotencyKey: 'create-key',
});
type Source = HandlingGroupCase & {
  version: number;
  rightsHolderId: string;
  defendants: string[];
  materials: string[];
  fees: string[];
};
type Group = {
  id: string;
  departmentId: string;
  customerId: string;
  status: string;
  revision: number;
  createdAt: Date;
  dissolvedAt: Date | null;
};
type Member = {
  groupId: string;
  caseId: string;
  departmentId: string;
  customerId: string;
};
type Event = {
  id: string;
  groupId: string;
  departmentId: string;
  revision: number;
  status: string;
  beforeCaseIds: string[];
  afterCaseIds: string[];
  actorUserId: string;
  actorDisplayNameSnapshot: string;
  recordedAt: Date;
  auditEventId: string;
};
type Receipt = {
  groupId: string;
  departmentId: string;
  actorUserId: string;
  command: string;
  idempotencyKey: string;
  requestFingerprint: string;
  originalRequest: unknown;
  resultSnapshot: unknown;
  eventId: string;
};
type State = {
  cases: Source[];
  groups: Group[];
  members: Member[];
  events: Event[];
  receipts: Receipt[];
  audits: unknown[];
};
function fixture() {
  let state: State = {
    cases: ids.map((id, index) => ({
      id,
      departmentId: actor.departmentId,
      customerId,
      businessNo: `CA-${index + 1}`,
      stage: index ? 'ARCHIVED' : 'WAITING_HEARING',
      responsibleUserId: index ? 'other-owner' : actor.userId,
      responsibleMembership: { teamId: 'team-a' },
      customer: {
        id: customerId,
        departmentId: actor.departmentId,
        name: '真实客户',
      },
      version: index ? 19 : 3,
      rightsHolderId: `holder-${index}`,
      defendants: [`defendant-${index}`],
      materials: [`original-file-${index}`],
      fees: [`original-fee-${index}`],
    })),
    groups: [],
    members: [],
    events: [],
    receipts: [],
    audits: [],
  };
  let pending: State | null = null;
  const current = () => pending ?? state;
  const tx = {
    $queryRawUnsafe: jest.fn(
      async (sql: string, first: string, second: string | string[]) =>
        sql.includes('FROM "cases"')
          ? current()
              .cases.filter(
                (row) =>
                  row.departmentId === first &&
                  Array.isArray(second) &&
                  second.includes(row.id),
              )
              .map(({ id }) => ({ id }))
          : current()
              .groups.filter(
                (row) => row.id === first && row.departmentId === second,
              )
              .map(({ id }) => ({ id })),
    ),
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        active: true,
        displayName: '原操作者姓名',
      }),
    },
    case: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { departmentId: string; id: { in: string[] } };
        }) =>
          structuredClone(
            current()
              .cases.filter(
                (row) =>
                  row.departmentId === where.departmentId &&
                  where.id.in.includes(row.id),
              )
              .sort((a, b) => a.id.localeCompare(b.id)),
          ),
      ),
      updateMany: jest.fn(),
    },
    caseHandlingGroup: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; departmentId: string } }) => {
          const group = current().groups.find(
            (row) =>
              row.id === where.id && row.departmentId === where.departmentId,
          );
          return group
            ? {
                ...group,
                members: current()
                  .members.filter((row) => row.groupId === group.id)
                  .map(({ caseId }) => ({ caseId }))
                  .sort((a, b) => a.caseId.localeCompare(b.caseId)),
              }
            : null;
        },
      ),
      create: jest.fn(
        async ({ data }: { data: Omit<Group, 'dissolvedAt'> }) => {
          if (current().groups.some(({ id }) => id === data.id))
            throw { code: 'P2002' };
          const saved = { ...data, dissolvedAt: null };
          current().groups.push(saved);
          return saved;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            departmentId: string;
            status: string;
            revision: number;
          };
          data: { status: string; revision: number; dissolvedAt: Date };
        }) => {
          const group = current().groups.find(
            (row) =>
              row.id === where.id &&
              row.departmentId === where.departmentId &&
              row.status === where.status &&
              row.revision === where.revision,
          );
          if (!group) return { count: 0 };
          Object.assign(group, data);
          return { count: 1 };
        },
      ),
    },
    caseHandlingGroupMember: {
      createMany: jest.fn(async ({ data }: { data: Member[] }) => {
        current().members.push(...data);
        return { count: data.length };
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        const saved = { id: `audit-${current().audits.length}`, data };
        current().audits.push(saved);
        return saved;
      }),
    },
    caseHandlingGroupEvent: {
      create: jest.fn(async ({ data }: { data: Event }) => {
        current().events.push(data);
        return data;
      }),
    },
    caseHandlingGroupReceipt: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            departmentId_actorUserId_command_idempotencyKey: {
              departmentId: string;
              actorUserId: string;
              command: string;
              idempotencyKey: string;
            };
          };
        }) => {
          const key = where.departmentId_actorUserId_command_idempotencyKey;
          const receipt = current().receipts.find(
            (row) =>
              row.departmentId === key.departmentId &&
              row.actorUserId === key.actorUserId &&
              row.command === key.command &&
              row.idempotencyKey === key.idempotencyKey,
          );
          return receipt
            ? {
                ...receipt,
                event: current().events.find(
                  ({ id }) => id === receipt.eventId,
                ),
              }
            : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Receipt }) => {
        current().receipts.push(data);
        return data;
      }),
    },
  };
  const database = {
    $transaction: jest.fn(
      async (run: (reader: typeof tx) => Promise<unknown>) => {
        pending = structuredClone(state);
        try {
          const result = await run(tx);
          state = pending;
          return result;
        } finally {
          pending = null;
        }
      },
    ),
  };
  const snapshot: AccessControlSnapshot = {
    active: true,
    authorizationRevision: 2,
    grants: [
      { action: 'case.read', scope: 'department' },
      { action: 'case.group.create', scope: 'team', teamId: 'team-a' },
      { action: 'case.group.dissolve', scope: 'team', teamId: 'team-a' },
    ],
  };
  const store = {
    loadSnapshot: jest.fn(async (userId: string, departmentId: string) =>
      userId === actor.userId && departmentId === actor.departmentId
        ? snapshot
        : null,
    ),
  };
  return {
    service: new CaseHandlingGroupService(
      database as never,
      new AccessControlService(store),
    ),
    tx,
    database,
    snapshot,
    store,
    state: () => state,
  };
}
describe('case handling group atomic commands', () => {
  it('groups same-customer sources with different stage, holders and defendants without changing any source, file or fee', async () => {
    const f = fixture();
    const sources = structuredClone(f.state().cases);
    const input = createInput();
    input.caseIds[0] = input.caseIds[0]!.toUpperCase();
    const result = await f.service.create(actor, input);
    expect(result).toMatchObject({
      id: groupId,
      revision: 1,
      status: 'ACTIVE',
    });
    expect(f.state().cases).toEqual(sources);
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 15000,
    });
    expect(f.tx.$queryRawUnsafe.mock.calls[1]).toEqual([
      expect.stringContaining('ORDER BY "id"::text FOR UPDATE'),
      actor.departmentId,
      ids,
    ]);
    expect(f.state().members.map(({ caseId }) => caseId)).toEqual(ids);
    expect(f.tx.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          departmentId: true,
          customerId: true,
          responsibleMembership: { select: { teamId: true } },
        },
      }),
    );
    expect(f.state().events[0]).toMatchObject({
      revision: 1,
      status: 'ACTIVE',
      beforeCaseIds: [],
      afterCaseIds: ids,
      actorDisplayNameSnapshot: '原操作者姓名',
    });
    expect(f.state().receipts[0]!.originalRequest).toEqual({
      groupId,
      caseIds: ids,
      idempotencyKey: 'create-key',
    });
    expect(input.caseIds[0]).toBe(ids[1]!.toUpperCase());
    expect(f.store.loadSnapshot).toHaveBeenCalledWith(
      actor.userId,
      actor.departmentId,
      f.tx,
    );
  });
  it('does not impose exclusive group membership and preserves both independent histories', async () => {
    const f = fixture();
    await f.service.create(actor, createInput());
    await f.service.create(actor, {
      ...createInput(),
      groupId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      idempotencyKey: 'second-group',
    });
    expect(f.state().groups).toHaveLength(2);
    expect(f.state().members).toHaveLength(4);
    expect(f.state().events).toHaveLength(2);
  });
  it('dissolves once with retained source identities, before/after history, audit and typed result', async () => {
    const f = fixture();
    const original = structuredClone(f.state().cases);
    await f.service.create(actor, createInput());
    const result = await f.service.dissolve(actor, groupId, {
      expectedRevision: 1,
      idempotencyKey: 'dissolve-key',
    });
    expect(result).toMatchObject({
      id: groupId,
      revision: 2,
      status: 'DISSOLVED',
    });
    expect(f.state().groups[0]).toMatchObject({
      revision: 2,
      status: 'DISSOLVED',
    });
    expect(f.state().members).toHaveLength(2);
    expect(f.state().cases).toEqual(original);
    expect(f.state().events[1]).toMatchObject({
      revision: 2,
      beforeCaseIds: ids,
      afterCaseIds: [],
    });
    expect(f.state().audits).toHaveLength(2);
    expect(f.state().receipts[1]!.resultSnapshot).toEqual(result);
  });
  it('replays creation after dissolve and legal source progression, with canonical UUID order and original times', async () => {
    const f = fixture();
    const created = await f.service.create(actor, createInput());
    const dissolved = await f.service.dissolve(actor, groupId, {
      expectedRevision: 1,
      idempotencyKey: 'dissolve-key',
    });
    f.state().cases.forEach((row) => {
      row.version += 1;
      row.stage = 'EXECUTING';
    });
    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
      displayName: '后来改名',
    });
    f.state().receipts[0]!.originalRequest = {
      idempotencyKey: 'create-key',
      caseIds: [...ids],
      groupId,
    };
    await expect(
      f.service.create(actor, {
        ...createInput(),
        caseIds: ids.map((id) => id.toUpperCase()),
      }),
    ).resolves.toEqual(created);
    await expect(
      f.service.dissolve(actor, groupId, {
        expectedRevision: 1,
        idempotencyKey: 'dissolve-key',
      }),
    ).resolves.toEqual(dissolved);
    expect(f.state().events).toHaveLength(2);
    expect(f.state().audits).toHaveLength(2);
    expect(f.state().receipts).toHaveLength(2);
  });
  it('authorizes the saved current source scope before revealing success or comparing a differing request', async () => {
    const f = fixture();
    await f.service.create(actor, createInput());
    f.state().cases[1]!.responsibleMembership.teamId = 'team-b';
    await expect(f.service.create(actor, createInput())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      f.service.create(actor, {
        ...createInput(),
        groupId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.state().events).toHaveLength(1);
    expect(f.state().groups).toHaveLength(1);
  });
  it('rejects changed original intent, stale group revision and a second fresh dissolve without duplicate history', async () => {
    const f = fixture();
    await f.service.create(actor, createInput());
    await expect(
      f.service.create(actor, {
        ...createInput(),
        groupId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    await expect(
      f.service.dissolve(actor, groupId, {
        expectedRevision: 2,
        idempotencyKey: 'bad-version',
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    await f.service.dissolve(actor, groupId, {
      expectedRevision: 1,
      idempotencyKey: 'dissolve-key',
    });
    await expect(
      f.service.dissolve(actor, groupId, {
        expectedRevision: 2,
        idempotencyKey: 'fresh',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CASE_HANDLING_GROUP_CONFLICT' },
    });
    expect(f.state().events).toHaveLength(2);
  });
  it('rejects cross-customer, cross-department, external, SELF-only and stale authorization before all writes', async () => {
    const customer = fixture();
    customer.state().cases[1]!.customerId = 'other-customer';
    await expect(
      customer.service.create(actor, createInput()),
    ).rejects.toMatchObject({
      response: { code: 'CASE_GROUP_CUSTOMER_MISMATCH' },
    });
    expect(customer.state().groups).toHaveLength(0);
    const department = fixture();
    department.state().cases[1]!.departmentId = 'other-department';
    await expect(
      department.service.create(actor, createInput()),
    ).rejects.toMatchObject({
      response: { code: 'CASE_HANDLING_GROUP_NOT_FOUND' },
    });
    const external = fixture();
    external.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'CLIENT',
      active: true,
      displayName: '客户',
    });
    await expect(
      external.service.create(actor, createInput()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      external.tx.caseHandlingGroupReceipt.findUnique,
    ).not.toHaveBeenCalled();
    const self = fixture();
    self.snapshot.grants = [
      { action: 'case.read', scope: 'department' },
      { action: 'case.group.create', scope: 'self' },
    ];
    await expect(
      self.service.create(actor, createInput()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const stale = fixture();
    await expect(
      stale.service.create(
        { ...actor, authorizationRevision: 1 },
        createInput(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not combine read department scope with a group TEAM grant to cover another team', async () => {
    const f = fixture();
    f.state().cases[1]!.responsibleMembership.teamId = 'team-b';
    await expect(f.service.create(actor, createInput())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    f.snapshot.grants.push({
      action: 'case.group.create',
      scope: 'department',
    });
    await expect(f.service.create(actor, createInput())).resolves.toMatchObject(
      { status: 'ACTIVE' },
    );
  });
  it.each(['group', 'members', 'audit', 'event', 'receipt'] as const)(
    'rolls back the whole creation when %s fails',
    async (table) => {
      const f = fixture();
      const before = structuredClone(f.state());
      const error = new Error('write failed');
      if (table === 'group')
        f.tx.caseHandlingGroup.create.mockRejectedValueOnce(error);
      if (table === 'members')
        f.tx.caseHandlingGroupMember.createMany.mockRejectedValueOnce(error);
      if (table === 'audit')
        f.tx.auditEvent.create.mockRejectedValueOnce(error);
      if (table === 'event')
        f.tx.caseHandlingGroupEvent.create.mockRejectedValueOnce(error);
      if (table === 'receipt')
        f.tx.caseHandlingGroupReceipt.create.mockRejectedValueOnce(error);
      await expect(f.service.create(actor, createInput())).rejects.toThrow(
        'write failed',
      );
      expect(f.state()).toEqual(before);
    },
  );
  it.each(['update', 'audit', 'event', 'receipt'] as const)(
    'preserves active group and its complete first history when dissolve %s fails',
    async (table) => {
      const f = fixture();
      await f.service.create(actor, createInput());
      const before = structuredClone(f.state());
      const error = new Error('write failed');
      if (table === 'update')
        f.tx.caseHandlingGroup.updateMany.mockRejectedValueOnce(error);
      if (table === 'audit')
        f.tx.auditEvent.create.mockRejectedValueOnce(error);
      if (table === 'event')
        f.tx.caseHandlingGroupEvent.create.mockRejectedValueOnce(error);
      if (table === 'receipt')
        f.tx.caseHandlingGroupReceipt.create.mockRejectedValueOnce(error);
      await expect(
        f.service.dissolve(actor, groupId, {
          expectedRevision: 1,
          idempotencyKey: 'dissolve-key',
        }),
      ).rejects.toThrow('write failed');
      expect(f.state()).toEqual(before);
    },
  );
  it('retries serializable conflicts atomically and rejects exhausted receipt collisions without adopting another success', async () => {
    const f = fixture();
    f.tx.caseHandlingGroupReceipt.create.mockRejectedValueOnce({
      code: 'P2034',
    });
    await f.service.create(actor, createInput());
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(f.state().groups).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
    const collision = fixture();
    collision.tx.caseHandlingGroupReceipt.create.mockRejectedValue({
      code: 'P2002',
    });
    await expect(
      collision.service.create(actor, createInput()),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(collision.state().groups).toHaveLength(0);
    expect(collision.database.$transaction).toHaveBeenCalledTimes(3);
  });
  it('does not return another actor receipt or a corrupted typed result', async () => {
    const f = fixture();
    await f.service.create(actor, createInput());
    await expect(
      f.service.create({ ...actor, userId: 'other-user' }, createInput()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    f.state().receipts[0]!.resultSnapshot = {
      id: groupId,
      revision: 2,
      status: 'DISSOLVED',
      recordedAt: 'fake',
    };
    await expect(f.service.create(actor, createInput())).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT' },
    });
  });
  it('validates direct calls, rejects duplicates and undeclared anchors and accepts twenty sources without mutating input', async () => {
    for (const input of [
      { ...createInput(), caseIds: [ids[0]] },
      { ...createInput(), caseIds: [ids[0], ids[0]!.toUpperCase()] },
      { ...createInput(), caseIds: Array(21).fill(ids[0]) },
      { ...createInput(), departmentId: actor.departmentId },
      { ...createInput(), idempotencyKey: ' key' },
      { ...createInput(), groupId: 'bad' },
    ]) {
      const f = fixture();
      expect(() =>
        f.service.create(actor, input as CreateCaseHandlingGroupDto),
      ).toThrow();
      expect(f.database.$transaction).not.toHaveBeenCalled();
    }
    const f = fixture();
    const template = f.state().cases[0]!;
    f.state().cases = Array.from({ length: 20 }, (_, i) => ({
      ...template,
      id: `${(i + 1).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    }));
    await f.service.create(actor, {
      ...createInput(),
      caseIds: f.state().cases.map(({ id }) => id),
    });
    expect(f.state().members).toHaveLength(20);
  });
});
