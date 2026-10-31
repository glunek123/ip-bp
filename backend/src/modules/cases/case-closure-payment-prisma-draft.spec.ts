const compact = (value: string) =>
  value.replace(/,\s*(?=[)\]}])/gu, '').replace(/\s+/gu, '');
import {
  redactPaymentFinancialSources,
  assertPaymentReplayScope,
  normalizePaymentUuid,
  CaseClosurePaymentPrismaDraft,
} from './case-closure-payment-prisma-draft';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import {
  AccessControlService,
  type AccessControlSnapshot,
} from '../../access-control/access-control.service';
import type { DatabaseService } from '../../database/database.service';
import type { OrganizationService } from '../../access-control/organization.service';
import type {
  CorrectClosurePaymentCommand,
  PaymentCorrectionResult,
} from './case-closure-payment-correction-draft.service';
jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(async () => undefined),
}));
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = readFileSync(
  resolve(
    process.cwd(),
    'src/modules/cases/case-closure-payment-prisma-draft.ts',
  ),
  'utf8',
);

it('removes internal financial source evidence without rewriting a historical receipt', () => {
  const result: PaymentCorrectionResult = {
    versionId: 'version',
    stage: 'ARCHIVED',
    reviewRequired: true,
    review: {
      caseId: 'main',
      stage: 'ARCHIVED',
      closureVersionId: 'closure',
      closureAmount: '100.00',
      effectiveAmounts: [],
      effectivePaymentVersionIds: [],
      financialReadiness: 'UNKNOWN',
      financialSources: {
        refundVersionId: 'refund',
        assessmentVersionId: 'assessment',
        allocationIds: ['secret-allocation'],
        countedCaseIds: ['main', 'secret-source'],
      },
    },
  };
  const original = JSON.stringify(result);
  const redacted = redactPaymentFinancialSources(result);
  expect(redacted.review.financialSources).toBeUndefined();
  expect(JSON.stringify(redacted)).not.toContain('secret');
  expect(JSON.stringify(result)).toBe(original);
  expect(compact(source)).toContain(
    compact('internalFinancialSources = financial.sources'),
  );
  expect(compact(source)).toContain(
    compact('result: a.result, internalFinancialSources'),
  );
  expect(compact(source)).not.toContain(
    compact('financialSources: financial.sources'),
  );
});
describe('payment Prisma adapter boundaries (static checks)', () => {
  it('locks and checks current actor and case before coordinator performs replay', () => {
    expect(compact(source)).toContain(
      compact(
        'users[0].authorization_revision !== currentActor.authorizationRevision',
      ),
    );
    expect(compact(source)).toContain(
      compact("users[0].account_type !== 'INTERNAL'"),
    );
    expect(compact(source)).toContain(compact('members[0]?.active'));
    expect(compact(source)).toContain(
      compact(
        'authorizedCaseIds = await lockPaymentCaseScope(db, currentActor, caseId)',
      ),
    );
    expect(compact(source)).toContain(
      compact('Prisma.TransactionIsolationLevel.Serializable'),
    );
  });
  it('uses latest effective versions and CAS, without writing case or archive state', () => {
    expect(compact(source)).toContain(
      compact('ORDER BY revision DESC LIMIT 1 FOR UPDATE'),
    );
    expect(compact(source)).toContain(
      compact('prior.revision=${p.revision - 1}'),
    );
    expect(compact(source)).toContain(
      compact('successor.prior_version_id=prior.id'),
    );
    expect(compact(source)).toContain(
      compact('successor.prior_version_id=p.id'),
    );
    expect(source).not.toMatch(/UPDATE (?:cases|case_archives)|DELETE FROM/iu);
  });
  it('does not manufacture passed financial readiness or register an endpoint', () => {
    expect(compact(source)).toContain(
      compact('financialReadiness: financial.state'),
    );
    expect(compact(source)).toContain(
      compact(
        'financialItems: { refund: financial.refund, customer: financial.customer, lawyer: financial.lawyer }',
      ),
    );
    expect(compact(source)).not.toContain(
      compact("financialReadiness: 'PASSED'"),
    );
    expect(compact(source)).not.toContain(compact('@Controller'));
  });
  it('persists a complete fingerprint and exact version audit in the same transaction', () => {
    expect(compact(source)).toContain(
      compact('idempotency_key,request_fingerprint,result_snapshot'),
    );
    expect(compact(source)).toContain(
      compact('p.case_id,p.id,p.audit_event_id'),
    );
    expect(compact(source)).toContain(
      compact("'CASE_CLOSURE_PAYMENT_VERSION'"),
    );
    expect(compact(source)).toContain(compact('request_fingerprint: string'));
  });
});

it('locks authorization facts and rechecks default case module permission', () => {
  expect(compact(source)).toContain(
    compact(
      'await lockCustomerActorFacts(db, this.organization, currentActor)',
    ),
  );
  expect(compact(source)).toContain(
    compact("await this.access.authorizeCase(currentActor, 'case.read', {"),
  );
  expect(compact(source)).not.toContain(compact('authorizeDepartmentAction'));
  expect(compact(source)).toContain(
    compact("a.details->>'fingerprint'=r.request_fingerprint"),
  );
  expect(compact(source)).toContain(
    compact("a.details->'result'=r.result_snapshot"),
  );
});

it('validates standard UUID structure and canonicalizes before SQL', () => {
  expect(compact(source)).toContain(
    compact('normalizePaymentUuid(command.caseId)'),
  );
  expect(compact(source)).toContain(
    compact('normalizePaymentUuid(command.paymentId)'),
  );
  expect(compact(source)).toContain(
    compact('normalizePaymentUuid(command.expectedVersionId)'),
  );
  expect(compact(source)).toContain(
    compact('normalizePaymentUuid(result.review.closureVersionId)'),
  );
  expect(compact(source)).toContain(
    compact(
      'result.review.effectivePaymentVersionIds.forEach(normalizePaymentUuid)',
    ),
  );
});

it('rejects malformed UUIDs before any query and accepts canonical case variants', () => {
  expect(normalizePaymentUuid('ABCDEFAB-1234-4234-8234-ABCDEFABCDEF')).toBe(
    'abcdefab-1234-4234-8234-abcdefabcdef',
  );
  expect(() =>
    normalizePaymentUuid('abcdefab123442348234abcdefabcdef'),
  ).toThrow('INVALID_UUID');
  expect(() =>
    normalizePaymentUuid('abcdefab-1234-0234-1234-abcdefabcdef'),
  ).toThrow('INVALID_UUID');
});

it('checks current replay scope before inspecting the stored result', () => {
  const guard = source.indexOf('assertPaymentReplayScope(authorizedCaseIds)');
  expect(guard).toBeGreaterThan(0);
  expect(guard).toBeLessThan(
    source.indexOf('const result = rows[0].result_snapshot'),
  );
});

it('rejects replay when current scope is missing or excludes a recorded case', () => {
  expect(() =>
    assertPaymentReplayScope(['main', 'original'], ['main', 'original']),
  ).not.toThrow();
  expect(() => assertPaymentReplayScope(null, ['main', 'original'])).toThrow(
    'ACTION_FORBIDDEN',
  );
  expect(() =>
    assertPaymentReplayScope(['main'], ['main', 'original']),
  ).toThrow('ACTION_FORBIDDEN');
});

describe('payment adapter scoped authorization (mock SQL, real access service)', () => {
  const actor = {
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    departmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    authorizationRevision: 1,
  };
  const caseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const paymentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  function setup(
    scope: 'self' | 'team' | 'department',
    kind: 'CORRECT' | 'VOID',
  ) {
    const snapshot: AccessControlSnapshot = {
      active: true,
      authorizationRevision: 1,
      grants: [
        {
          action: 'case.read',
          scope,
          ...(scope === 'team' ? { teamId: 'team-a' } : {}),
        },
      ],
    };
    const state = {
      owner: actor.userId,
      sameDepartment: true,
      active: true,
      revision: 1,
    };
    const command: CorrectClosurePaymentCommand = {
      caseId,
      paymentId,
      expectedVersionId: paymentId,
      idempotencyKey: 'scoped-payment',
      ...(kind === 'VOID'
        ? { kind }
        : {
            kind,
            amount: '1.23',
            paidOn: '2026-01-01',
            payer: 'payer',
            payee: 'payee',
          }),
    };
    const result: PaymentCorrectionResult = {
      versionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      stage: 'WAITING_ARCHIVE',
      reviewRequired: false,
      review: {
        caseId,
        stage: 'WAITING_ARCHIVE',
        closureVersionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        closureAmount: '10.00',
        effectiveAmounts: [],
        effectivePaymentVersionIds: [],
        financialReadiness: 'UNKNOWN',
      },
    };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          caseId,
          paymentId,
          paymentId,
          kind,
          null,
          command.kind === 'CORRECT'
            ? [command.paidOn, command.amount, command.payer, command.payee]
            : null,
        ]),
      )
      .digest('hex');
    const db = {
      $executeRaw: jest.fn(async () => 0),
      $queryRaw: jest.fn(
        async (strings: TemplateStringsArray): Promise<unknown[]> => {
          const sql = strings.join('');
          if (sql.includes('FROM user_accounts'))
            return [
              {
                active: state.active,
                account_type: 'INTERNAL',
                authorization_revision: state.revision,
              },
            ];
          if (sql.includes('FROM department_memberships'))
            return [{ active: true }];
          if (
            sql.includes('FROM case_consolidation_members') ||
            sql.includes('FROM case_consolidations')
          )
            return [];
          if (sql.includes('FROM cases'))
            return state.sameDepartment
              ? [
                  {
                    id: caseId,
                    responsible_user_id: state.owner,
                    team_id: 'team-a',
                  },
                ]
              : [];
          if (sql.includes('SELECT EXISTS')) return [{ valid: true }];
          if (sql.includes('FROM case_closure_payment_receipts'))
            return [
              { request_fingerprint: fingerprint, result_snapshot: result },
            ];
          throw new Error('UNEXPECTED_SQL');
        },
      ),
    };
    const transaction = jest.fn(
      async (work: (tx: typeof db) => Promise<PaymentCorrectionResult>) =>
        work(db),
    );
    const loadSnapshot = jest.fn(async () => snapshot);
    const service = new CaseClosurePaymentPrismaDraft(
      { $transaction: transaction } as unknown as DatabaseService,
      new AccessControlService({ loadSnapshot }),
      {} as OrganizationService,
    );
    return {
      service,
      state,
      snapshot,
      db,
      command,
      result,
      transaction,
      loadSnapshot,
    };
  }
  const locked = () =>
    new Prisma.PrismaClientKnownRequestError('opaque failure', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '55P03' },
    });
  it('returns a redacted historical replay only after verifying its original audit snapshot', async () => {
    const f = setup('self', 'VOID');
    f.result.review.financialSources = {
      refundVersionId: 'hidden-refund',
      assessmentVersionId: 'hidden-assessment',
      allocationIds: ['hidden-allocation'],
      countedCaseIds: [caseId],
    };
    const original = JSON.stringify(f.result);
    const result = await f.service.execute(actor, f.command);
    expect(result.review.financialSources).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(f.result)).toBe(original);
    expect(
      f.db.$queryRaw.mock.calls.some(([sql]) =>
        sql.join('').includes('SELECT EXISTS'),
      ),
    ).toBe(true);
  });
  it('keeps source IDs inside the protected audit evidence and omits them from a first result and new receipt', async () => {
    const f = setup('self', 'VOID');
    const fallback = f.db.$queryRaw.getMockImplementation()!;
    let appended = false;
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    f.db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      const query = sql.join('');
      if (query.includes('FROM case_closure_payment_receipts')) return [];
      if (
        query.includes('FROM case_closure_payment_versions') &&
        query.includes('LIMIT 1 FOR UPDATE')
      )
        return [
          {
            id: paymentId,
            paymentId,
            revision: 1,
            state: 'ACTIVE',
            paidOn: '2026-01-01',
            amount: '10.00',
            payer: 'payer',
            payee: 'payee',
          },
        ];
      if (query.includes('FROM cases c JOIN case_closures'))
        return [
          {
            stage: 'WAITING_ARCHIVE',
            closureVersionId: f.result.review.closureVersionId,
            closureAmount: '10.00',
          },
        ];
      if (query.includes('FROM case_closure_payment_versions p'))
        return appended ? [] : [{ id: paymentId, amount: '10.00' }];
      if (query.includes('FROM case_refund_inventory_versions'))
        return [
          { id: 'hidden-refund', revision: 1, declaration: 'NOT_APPLICABLE' },
        ];
      if (
        query.includes('FROM case_refund_inventory_items') ||
        query.includes('FROM case_settlement_assessment_versions')
      )
        return [];
      if (query.includes('jsonb_build_object')) return [];
      if (query.includes('FROM case_settlement_actual_allocations'))
        return [{ id: 'hidden-allocation', side: 'CUSTOMER', amount: '10.00' }];
      return fallback(sql);
    });
    Object.assign(f.db, {
      $executeRaw: jest.fn(
        async (sql: TemplateStringsArray, ...values: unknown[]) => {
          const query = sql.join('');
          writes.push({ sql: query, values });
          if (query.includes('INSERT INTO case_closure_payment_versions'))
            appended = true;
          return 1;
        },
      ),
    });
    const result = await f.service.execute(actor, f.command);
    expect(JSON.stringify(result)).not.toContain('hidden');
    const audit = writes.find((w) =>
      w.sql.includes('INSERT INTO audit_events'),
    )!;
    const receipt = writes.find((w) =>
      w.sql.includes('INSERT INTO case_closure_payment_receipts'),
    )!;
    expect(JSON.stringify(audit.values)).toContain('hidden-allocation');
    expect(JSON.stringify(receipt.values)).not.toContain('hidden');
    expect(result.review.financialSources).toBeUndefined();
  });
  it('retries structured 55P03 with fresh authorization then succeeds', async () => {
    const f = setup('self', 'VOID');
    f.transaction.mockImplementationOnce(async (work) => {
      await work(f.db);
      throw locked();
    });
    await expect(f.service.execute(actor, f.command)).resolves.toEqual(
      f.result,
    );
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.loadSnapshot).toHaveBeenCalledTimes(2);
  });
  it('retries the actual nested adapter serialization state and reauthorizes', async () => {
    const f = setup('self', 'VOID');
    f.transaction.mockImplementationOnce(async (work) => {
      await work(f.db);
      throw new Prisma.PrismaClientKnownRequestError('opaque adapter error', {
        code: 'P2010',
        clientVersion: 'test',
        meta: {
          driverAdapterError: {
            cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
          },
        },
      });
    });
    await expect(f.service.execute(actor, f.command)).resolves.toEqual(
      f.result,
    );
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(f.db.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining(['SET CONSTRAINTS ALL IMMEDIATE']),
    );
  });
  it('stops structured lock retries after three attempts and reauthorizes each attempt', async () => {
    const f = setup('self', 'VOID');
    f.transaction.mockImplementation(async (work) => {
      await work(f.db);
      throw locked();
    });
    await expect(f.service.execute(actor, f.command)).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '55P03' },
    });
    expect(f.transaction).toHaveBeenCalledTimes(3);
    expect(f.loadSnapshot).toHaveBeenCalledTimes(3);
  });
  it('does not retry error text or nonretryable structured SQL errors', async () => {
    for (const error of [
      new Error('55P03'),
      new Prisma.PrismaClientKnownRequestError('55P03', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '23514' },
      }),
    ]) {
      const f = setup('self', 'VOID');
      f.transaction.mockRejectedValue(error);
      await expect(f.service.execute(actor, f.command)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(1);
    }
  });
  it('denies a retry when read authorization is revoked after the lock failure', async () => {
    const f = setup('self', 'VOID');
    f.transaction.mockImplementationOnce(async (work) => {
      await work(f.db);
      f.snapshot.grants = [];
      throw locked();
    });
    await expect(f.service.execute(actor, f.command)).rejects.toThrow();
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.loadSnapshot).toHaveBeenCalledTimes(2);
  });
  it.each(['self', 'team', 'department'] as const)(
    'allows %s scope for correction and void replay, then blocks revoked read permission before receipt lookup',
    async (scope) => {
      for (const kind of ['CORRECT', 'VOID'] as const) {
        const f = setup(scope, kind);
        await expect(f.service.execute(actor, f.command)).resolves.toEqual(
          f.result,
        );
        f.snapshot.grants = [];
        f.db.$queryRaw.mockClear();
        await expect(f.service.execute(actor, f.command)).rejects.toThrow();
        expect(
          f.db.$queryRaw.mock.calls.some(([sql]) =>
            sql.join('').includes('FROM case_closure_payment_receipts'),
          ),
        ).toBe(false);
      }
    },
  );
  it('retains current identity, department and responsibility restrictions even with department read scope', async () => {
    for (const denied of [
      'owner',
      'department',
      'inactive',
      'revision',
    ] as const) {
      const f = setup('department', 'VOID');
      if (denied === 'owner')
        f.state.owner = '11111111-1111-4111-8111-111111111111';
      if (denied === 'department') f.state.sameDepartment = false;
      if (denied === 'inactive') f.state.active = false;
      if (denied === 'revision') f.state.revision = 2;
      await expect(f.service.execute(actor, f.command)).rejects.toThrow(
        'ACTION_FORBIDDEN',
      );
      expect(
        f.db.$queryRaw.mock.calls.some(([sql]) =>
          sql.join('').includes('FROM case_closure_payment_receipts'),
        ),
      ).toBe(false);
    }
  });
});
