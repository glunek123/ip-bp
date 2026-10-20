import { ForbiddenException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadNoEvidenceBatchDto } from './lead-no-evidence-batch.dto';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const ids = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];
const request = (): LeadNoEvidenceBatchDto => ({
  items: [...ids]
    .reverse()
    .map((leadId) => ({ leadId, expectedVersion: 3, reason: '  不再取证  ' })),
});
type TypedReceipt = {
  departmentId: string;
  actorUserId: string;
  action: string;
  idempotencyKey: string;
  requestFingerprint: string;
  resultLeadId: string;
  resultLeadVersion: number;
  resultSnapshot: unknown;
};
type BatchReceipt = {
  id: string;
  departmentId: string;
  actorUserId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  originalRequest: unknown;
  resultSnapshot: unknown;
  createdAt: Date;
};
type Lead = {
  id: string;
  departmentId: string;
  customerId: string;
  responsibleUserId: string;
  teamId: string | null;
  status: string;
  version: number;
  activeReviewDecisionId: string | null;
  reviewDecision: { id: string; result: string } | null;
};
type State = {
  leads: Lead[];
  facts: unknown[];
  audits: unknown[];
  typed: TypedReceipt[];
  batches: BatchReceipt[];
};

function fixture() {
  let state: State = {
    leads: ids.map((id, index) => ({
      id,
      departmentId: actor.departmentId,
      customerId: `${index}customer`,
      responsibleUserId: actor.userId,
      teamId: index ? 'team' : null,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      activeReviewDecisionId: `${index}decision`,
      reviewDecision: { id: `${index}decision`, result: 'INFRINGEMENT' },
    })),
    facts: [],
    audits: [],
    typed: [],
    batches: [],
  };
  let pending: State | null = null;
  const current = () => pending ?? state;
  const tx = {
    $queryRawUnsafe: jest.fn(
      async (_sql: string, departmentId: string, selected: string[]) =>
        current()
          .leads.filter(
            (lead) =>
              lead.departmentId === departmentId && selected.includes(lead.id),
          )
          .map(({ id }) => ({ id })),
    ),
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        displayName: '原运营姓名',
      }),
    },
    lead: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { departmentId: string; id: { in: string[] } };
        }) =>
          structuredClone(
            current().leads.filter(
              (lead) =>
                lead.departmentId === where.departmentId &&
                where.id.in.includes(lead.id),
            ),
          ),
      ),
      updateMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            departmentId: string;
            version: number;
            status: string;
            activeReviewDecisionId: string | null;
          };
        }) => {
          const lead = current().leads.find(
            (lead) =>
              lead.id === where.id &&
              lead.departmentId === where.departmentId &&
              lead.version === where.version &&
              lead.status === where.status &&
              lead.activeReviewDecisionId === where.activeReviewDecisionId,
          );
          if (!lead) return { count: 0 };
          lead.status = 'ARCHIVED';
          lead.version += 1;
          return { count: 1 };
        },
      ),
    },
    leadEvidenceDecision: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        current().facts.push(data);
        return data;
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        current().audits.push(data);
        return data;
      }),
    },
    leadCommandReceipt: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            departmentId_actorUserId_action_idempotencyKey: {
              departmentId: string;
              actorUserId: string;
              action: string;
              idempotencyKey: string;
            };
          };
        }) => {
          const key = where.departmentId_actorUserId_action_idempotencyKey;
          return (
            current().typed.find(
              (r) =>
                r.departmentId === key.departmentId &&
                r.actorUserId === key.actorUserId &&
                r.action === key.action &&
                r.idempotencyKey === key.idempotencyKey,
            ) ?? null
          );
        },
      ),
      create: jest.fn(async ({ data }: { data: TypedReceipt }) => {
        if (
          current().typed.some(
            (r) =>
              r.departmentId === data.departmentId &&
              r.actorUserId === data.actorUserId &&
              r.action === data.action &&
              r.idempotencyKey === data.idempotencyKey,
          )
        )
          throw { code: 'P2002' };
        current().typed.push(data);
        return data;
      }),
    },
    leadNoEvidenceBatchReceipt: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            departmentId_actorUserId_idempotencyKey: {
              departmentId: string;
              actorUserId: string;
              idempotencyKey: string;
            };
          };
        }) => {
          const key = where.departmentId_actorUserId_idempotencyKey;
          return (
            current().batches.find(
              (r) =>
                r.departmentId === key.departmentId &&
                r.actorUserId === key.actorUserId &&
                r.idempotencyKey === key.idempotencyKey,
            ) ?? null
          );
        },
      ),
      create: jest.fn(
        async ({ data }: { data: Omit<BatchReceipt, 'createdAt'> }) => {
          const saved = { ...data, createdAt: new Date() };
          current().batches.push(saved);
          return saved;
        },
      ),
    },
  };
  const database = {
    $transaction: jest.fn(
      async (run: (reader: typeof tx) => Promise<unknown>) => {
        pending = structuredClone(state);
        pending.batches.forEach((receipt) => {
          receipt.createdAt = new Date(receipt.createdAt.getTime());
        });
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
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  const service = new LeadService(
    database as never,
    access as never,
    {} as never,
  );
  return { service, tx, database, access, state: () => state };
}

describe('LeadService atomic no evidence batch', () => {
  it('accepts the largest incrementable INTEGER version and returns its safe successor', async () => {
    const f = fixture();
    f.state().leads[0]!.version = 2147483646;
    const result = await f.service.decideNoEvidenceBatch(actor, 'upper-bound', {
      items: [
        { leadId: ids[0]!, expectedVersion: 2147483646, reason: '归档原因' },
      ],
    });
    expect(result.items[0]!.version).toBe(2147483647);
    expect(f.state().leads[0]!.version).toBe(2147483647);
  });

  it('rejects INTEGER max before transaction or any write because the successor would overflow', async () => {
    const f = fixture();
    f.state().leads[0]!.version = 2147483647;
    const before = structuredClone(f.state());
    await expect(
      f.service.decideNoEvidenceBatch(actor, 'overflow', {
        items: [
          { leadId: ids[0]!, expectedVersion: 2147483647, reason: '归档原因' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
    expect(f.state()).toEqual(before);
  });

  it('accepts exactly twenty distinct targets and creates twenty linked child receipts', async () => {
    const f = fixture();
    const template = f.state().leads[0]!;
    f.state().leads = Array.from({ length: 20 }, (_, index) => ({
      ...template,
      id: `${(index + 1).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      activeReviewDecisionId: `review-${index}`,
      reviewDecision: { id: `review-${index}`, result: 'INFRINGEMENT' },
    }));
    const result = await f.service.decideNoEvidenceBatch(actor, 'twenty', {
      items: f.state().leads.map(({ id }) => ({
        leadId: id,
        expectedVersion: 3,
        reason: '批量原因',
      })),
    });
    expect(result.items).toHaveLength(20);
    expect(f.state().facts).toHaveLength(20);
    expect(f.state().typed).toHaveLength(20);
    expect(f.state().typed[19]!.idempotencyKey).toBe(
      `batch-no-evidence:${f.state().batches[0]!.id}:19`,
    );
  });

  it('locks canonical UUID order, checks every real scope, and writes original single facts and two distinct child receipts in one transaction', async () => {
    const f = fixture();
    const input = request();
    input.items[0]!.leadId = input.items[0]!.leadId.toUpperCase();
    const result = await f.service.decideNoEvidenceBatch(
      actor,
      'batch-key',
      input,
    );
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 15000,
    });
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "id"::text FOR UPDATE'),
      actor.departmentId,
      ids,
    );
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.evidence.decide',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: 'team',
      },
      f.tx,
    );
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.evidence.decide',
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
    expect(
      f.access.authorizeLead.mock.invocationCallOrder.at(-1)!,
    ).toBeLessThan(f.tx.lead.updateMany.mock.invocationCallOrder[0]!);
    expect(result.items.map(({ leadId }) => leadId)).toEqual(
      [...ids].reverse(),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        status: 'ARCHIVED',
        version: 4,
        reason: '不再取证',
        result: 'NO_EVIDENCE',
        decidedByDisplayName: '原运营姓名',
        archiveType: 'NO_EVIDENCE',
      }),
    );
    expect(result.items[0]!.archivedAt).toBe(result.items[0]!.decidedAt);
    expect(
      f.state().leads.map(({ status, version }) => ({ status, version })),
    ).toEqual([
      { status: 'ARCHIVED', version: 4 },
      { status: 'ARCHIVED', version: 4 },
    ]);
    expect(f.state().facts).toHaveLength(2);
    expect(f.state().audits).toHaveLength(2);
    expect(f.state().typed).toHaveLength(2);
    expect(f.state().batches).toHaveLength(1);
    const batch = f.state().batches[0]!;
    expect(f.state().typed.map(({ idempotencyKey }) => idempotencyKey)).toEqual(
      [`batch-no-evidence:${batch.id}:0`, `batch-no-evidence:${batch.id}:1`],
    );
    expect(f.state().typed.map(({ resultSnapshot }) => resultSnapshot)).toEqual(
      result.items,
    );
    expect(f.state().facts[0]).toMatchObject({
      leadId: ids[1],
      customerId: '1customer',
      originalReviewDecisionId: '1decision',
      originalReviewResult: 'INFRINGEMENT',
      actorDisplayNameSnapshot: '原运营姓名',
      fromVersion: 3,
      toVersion: 4,
    });
    expect(input.items[0]!.reason).toBe('  不再取证  ');
  });

  it.each(['status', 'version', 'reviewId', 'reviewResult'] as const)(
    'does not write any item when a later target has an invalid %s',
    async (field) => {
      const f = fixture();
      const last = f.state().leads[0]!;
      if (field === 'status') last.status = 'WAITING_REVIEW';
      if (field === 'version') last.version = 4;
      if (field === 'reviewId') last.activeReviewDecisionId = 'other';
      if (field === 'reviewResult')
        last.reviewDecision!.result = 'NO_INFRINGEMENT';
      const before = structuredClone(f.state());
      await expect(
        f.service.decideNoEvidenceBatch(actor, 'key', request()),
      ).rejects.toMatchObject({
        response: {
          code: field === 'version' ? 'VERSION_CONFLICT' : 'INVALID_STATE',
        },
      });
      expect(f.tx.lead.updateMany).not.toHaveBeenCalled();
      expect(f.state()).toEqual(before);
    },
  );

  it('rejects a grant-bearing external account, missing target and a real per-object scope failure', async () => {
    const external = fixture();
    external.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'CLIENT',
      displayName: '客户',
    });
    await expect(
      external.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(
      external.tx.leadNoEvidenceBatchReceipt.findUnique,
    ).not.toHaveBeenCalled();
    const hidden = fixture();
    hidden.state().leads[0]!.departmentId = 'other-department';
    await expect(
      hidden.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    const denied = fixture();
    denied.access.authorizeLead
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      denied.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(denied.tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('replays the first typed result after legal progression and JSONB property reordering, preserving the original operator name', async () => {
    const f = fixture();
    const input = request();
    const first = await f.service.decideNoEvidenceBatch(actor, 'key', input);
    f.state().leads.forEach((lead) => {
      lead.status = 'ARCHIVED';
      lead.version = 9;
      lead.activeReviewDecisionId = null;
      lead.reviewDecision = null;
    });
    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      displayName: '后来改名',
    });
    const receipt = f.state().batches[0]!;
    receipt.originalRequest = {
      items: [...input.items].map((item) => ({
        reason: item.reason.trim(),
        expectedVersion: item.expectedVersion,
        leadId: item.leadId.toLowerCase(),
      })),
    };
    receipt.resultSnapshot = {
      items: first.items.map((item) =>
        Object.fromEntries(Object.entries(item).reverse()),
      ),
    };
    f.state().typed.forEach((typed) => {
      if (typed.resultSnapshot && typeof typed.resultSnapshot === 'object')
        typed.resultSnapshot = Object.fromEntries(
          Object.entries(typed.resultSnapshot).reverse(),
        );
    });
    const writes = f.tx.lead.updateMany.mock.calls.length;
    await expect(
      f.service.decideNoEvidenceBatch(actor, 'key', input),
    ).resolves.toEqual(first);
    expect(f.tx.lead.updateMany).toHaveBeenCalledTimes(writes);
    expect(f.state().batches).toHaveLength(1);
    expect(f.state().facts).toHaveLength(2);
  });

  it.each(['order', 'reason', 'version', 'count'] as const)(
    'rejects same key with a different %s after authorizing the saved targets',
    async (change) => {
      const f = fixture();
      await f.service.decideNoEvidenceBatch(actor, 'key', request());
      const changed = request();
      if (change === 'order') changed.items.reverse();
      if (change === 'reason') changed.items[0]!.reason = '别的理由';
      if (change === 'version') changed.items[0]!.expectedVersion = 4;
      if (change === 'count') changed.items.pop();
      f.access.authorizeLead.mockClear();
      await expect(
        f.service.decideNoEvidenceBatch(actor, 'key', changed),
      ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
      expect(f.access.authorizeLead).toHaveBeenCalledTimes(2);
      expect(f.state().batches).toHaveLength(1);
    },
  );

  it('reauthorizes saved current owners before replay or differing-request comparison, and never returns another actor/department receipt', async () => {
    const f = fixture();
    await f.service.decideNoEvidenceBatch(actor, 'key', request());
    f.state().leads[1]!.responsibleUserId = 'new-owner';
    f.access.authorizeLead.mockImplementation(
      async (_actor, _action, facts) => {
        if (facts.responsibleUserId === 'new-owner')
          throw new ForbiddenException();
      },
    );
    const changed = { items: [request().items[1]!] };
    await expect(
      f.service.decideNoEvidenceBatch(actor, 'key', changed),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.leadCommandReceipt.findUnique).not.toHaveBeenCalled();
    const foreign = fixture();
    await foreign.service.decideNoEvidenceBatch(actor, 'key', request());
    const receipt = foreign.state().batches[0]!;
    receipt.actorUserId = 'other-actor';
    foreign.tx.leadNoEvidenceBatchReceipt.findUnique.mockResolvedValueOnce(
      receipt,
    );
    await expect(
      foreign.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });

  it.each([
    'lead',
    'leadEvidenceDecision',
    'auditEvent',
    'leadCommandReceipt',
    'leadNoEvidenceBatchReceipt',
  ] as const)('rolls back all staged changes when %s fails', async (table) => {
    const f = fixture();
    const before = structuredClone(f.state());
    if (table === 'lead')
      f.tx.lead.updateMany.mockRejectedValueOnce(new Error('write failed'));
    else f.tx[table].create.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      f.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toThrow('write failed');
    expect(f.state()).toEqual(before);
  });

  it('rolls back an earlier item if the second fact fails and retries serialization with one final persisted batch', async () => {
    const f = fixture();
    const before = structuredClone(f.state());
    const create = f.tx.leadEvidenceDecision.create.getMockImplementation()!;
    f.tx.leadEvidenceDecision.create
      .mockImplementationOnce(create)
      .mockRejectedValueOnce(new Error('second fact failed'));
    await expect(
      f.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toThrow('second fact failed');
    expect(f.state()).toEqual(before);
    f.tx.leadNoEvidenceBatchReceipt.create.mockRejectedValueOnce({
      code: 'P2034',
    });
    await f.service.decideNoEvidenceBatch(actor, 'key', request());
    expect(f.state().facts).toHaveLength(2);
    expect(f.state().typed).toHaveLength(2);
    expect(f.state().batches).toHaveLength(1);
  });

  it('does not adopt a colliding single-command child receipt or commit any earlier fact', async () => {
    const f = fixture();
    const before = structuredClone(f.state());
    f.tx.leadCommandReceipt.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      f.service.decideNoEvidenceBatch(actor, 'key', request()),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.database.$transaction).toHaveBeenCalledTimes(3);
    expect(f.state()).toEqual(before);
  });

  it('preserves the existing single-command header-key space while recording separate batch children', async () => {
    const f = fixture();
    const originalSingle: TypedReceipt = {
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      action: 'evidence_decide',
      idempotencyKey: 'key',
      requestFingerprint: '0'.repeat(64),
      resultLeadId: 'other-lead',
      resultLeadVersion: 2,
      resultSnapshot: { original: true },
    };
    f.state().typed.push(originalSingle);
    await f.service.decideNoEvidenceBatch(actor, 'key', request());
    expect(f.state().typed).toHaveLength(3);
    expect(f.state().typed[0]).toEqual(originalSingle);
    expect(f.tx.leadCommandReceipt.findUnique).not.toHaveBeenCalled();
  });

  it.each(['missing', 'fingerprint', 'batch-result'] as const)(
    'rejects a corrupt %s instead of manufacturing success',
    async (kind) => {
      const f = fixture();
      await f.service.decideNoEvidenceBatch(actor, 'key', request());
      if (kind === 'missing') f.state().typed.pop();
      if (kind === 'fingerprint')
        f.state().typed[0]!.requestFingerprint = '0'.repeat(64);
      if (kind === 'batch-result')
        f.state().batches[0]!.resultSnapshot = { items: [] };
      await expect(
        f.service.decideNoEvidenceBatch(actor, 'key', request()),
      ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
    },
  );

  it('keeps the single-rule trimmed Unicode code-point reason boundaries', async () => {
    for (const reason of [
      '字'.repeat(5000),
      '😀'.repeat(5000),
      '✈️'.repeat(2500),
    ]) {
      const f = fixture();
      await f.service.decideNoEvidenceBatch(actor, 'key', {
        items: [{ ...request().items[0]!, reason: `  ${reason}  ` }],
      });
      expect(f.state().facts[0]).toMatchObject({ reason });
    }
    for (const reason of ['', '  ', '😀'.repeat(5001), '✈️'.repeat(2501)]) {
      const f = fixture();
      await expect(
        f.service.decideNoEvidenceBatch(actor, 'key', {
          items: [{ ...request().items[0]!, reason }],
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    }
  });

  it('validates exact shapes, UUID deduplication, positive bounded integer versions and batch cardinality before transaction', async () => {
    for (const input of [
      { items: [] },
      { items: Array.from({ length: 21 }, () => request().items[0]!) },
      {
        items: [
          request().items[0]!,
          {
            ...request().items[0]!,
            leadId: request().items[0]!.leadId.toUpperCase(),
          },
        ],
      },
      { items: [{ ...request().items[0]!, leadId: 'invalid' }] },
      { items: [null] },
      ...[0, 1.5, 2147483648].map((expectedVersion) => ({
        items: [{ ...request().items[0]!, expectedVersion }],
      })),
      ...['result', 'status', 'actorUserId', 'departmentId'].map((key) => ({
        items: [{ ...request().items[0]!, [key]: 'unexpected' }],
      })),
      { ...request(), extra: true },
    ]) {
      const f = fixture();
      await expect(
        f.service.decideNoEvidenceBatch(
          actor,
          'key',
          input as LeadNoEvidenceBatchDto,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    }
  });
});
