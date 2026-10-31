import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '../../generated/prisma/client';
import type { DatabaseService } from '../../database/database.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { MaterialService } from '../materials/index';
import { CaseEarlyClosureTransactionDraftService } from './case-early-closure-transaction-draft.service';
import type { RecordEarlyClosureInput } from './case-early-closure.dto';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-10-30T02:00:00.000Z');
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row = Record<string, unknown>;
function fixture() {
  const rows: Record<string, Row[]> = {
    audit: [],
    early: [],
    earlyReceipt: [],
    closure: [],
    closureVersion: [],
    payment: [],
    paymentReceipt: [],
    closureReceipt: [],
  };
  const events: string[] = [];
  const create = (name: string) =>
    jest.fn(async ({ data }: { data: Row }) => {
      rows[name]!.push({
        ...(name === 'audit'
          ? {
              actorKind: 'HUMAN',
              customerAccountBindingId: null,
              lawyerAccountBindingId: null,
              notaryOfficeAccountBindingId: null,
            }
          : {}),
        ...(name === 'closureVersion' || name === 'payment'
          ? { priorVersionId: null }
          : {}),
        ...data,
      });
      events.push(name === 'audit' ? `audit:${String(data.action)}` : name);
      return data;
    });
  let caseState = {
    stage: 'PENDING_MATCH',
    version: 1,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    consolidationMembership: null,
  };
  const decimal = (value: unknown) =>
    typeof value === 'string' ? new Prisma.Decimal(value) : value;
  const tx = {
    $queryRaw: jest.fn(async () => []),
    $queryRawUnsafe: jest.fn(async (sql: string) =>
      sql.includes('CURRENT_TIMESTAMP')
        ? [{ recordedAt: now }]
        : [{ id: caseId }],
    ),
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      events.push(sql);
      return 0;
    }),
    case: {
      findFirst: jest.fn(async () => caseState),
      updateMany: jest.fn(
        async ({ data }: { data: { stage?: string; version: number } }) => {
          caseState = { ...caseState, ...data };
          events.push(`case:${data.stage ?? 'unchanged'}:${data.version}`);
          return { count: 1 };
        },
      ),
    },
    caseEarlyClosure: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => rows.early![0] ?? null),
      create: create('early'),
    },
    caseEarlyClosureReceipt: {
      findUnique: jest.fn(async () => rows.earlyReceipt![0] ?? null),
      create: create('earlyReceipt'),
    },
    caseEarlyArchive: { findFirst: jest.fn(async () => null) },
    caseArchive: { findFirst: jest.fn(async () => null) },
    caseExecutionFinish: { findFirst: jest.fn(async () => null) },
    caseClosure: {
      findFirst: jest.fn(async () => null),
      create: create('closure'),
      updateMany: jest.fn(async () => {
        events.push('head-current');
        return { count: 1 };
      }),
    },
    caseClosureVersion: {
      create: create('closureVersion'),
      findFirst: jest.fn(async () => {
        const version = rows.closureVersion![0];
        return version === undefined
          ? null
          : { ...version, closeAmt: decimal(version.closeAmt) };
      }),
    },
    caseClosureReceipt: {
      create: create('closureReceipt'),
      findUnique: jest.fn(async () => rows.closureReceipt![0] ?? null),
    },
    caseClosurePaymentVersion: {
      create: create('payment'),
      findMany: jest.fn(async () =>
        rows.payment!.map((row) => ({
          ...row,
          amount: decimal(row.amount),
          documents: [],
        })),
      ),
    },
    caseClosurePaymentReceipt: {
      create: create('paymentReceipt'),
      findUnique: jest.fn(
        async (query: {
          where: {
            departmentId_actorUserId_idempotencyKey: { idempotencyKey: string };
          };
        }) =>
          rows.paymentReceipt!.find(
            (row) =>
              row.idempotencyKey ===
              query.where.departmentId_actorUserId_idempotencyKey
                .idempotencyKey,
          ) ?? null,
      ),
    },
    materialReference: { findMany: jest.fn(async () => []) },
    caseClosureDocument: { findMany: jest.fn(async () => []) },
    auditEvent: {
      create: create('audit'),
      findMany: jest.fn(async () => rows.audit!),
    },
  };
  const transaction = jest.fn(
    async (work: (value: typeof tx) => Promise<unknown>) => work(tx),
  );
  const access = { authorizeCase: jest.fn(async () => undefined) };
  const organization = { lockDepartment: jest.fn(async () => undefined) };
  const materials = {
    assertAvailableVersions: jest.fn(async () => []),
    // Use the actual empty-list paths. The fixture deliberately exposes no
    // document/reference create methods: an attempted write fails this test.
    freezeCaseClosureReferences:
      MaterialService.prototype.freezeCaseClosureReferences,
    freezeCaseClosurePaymentReferences:
      MaterialService.prototype.freezeCaseClosurePaymentReferences,
  };
  const service = new CaseEarlyClosureTransactionDraftService(
    { $transaction: transaction } as unknown as DatabaseService,
    access as unknown as AccessControlService,
    materials,
    organization as unknown as OrganizationService,
  );
  return { service, rows, events, transaction, materials };
}
const payment = (amount: string) => ({
  paidOn: '2026-10-01',
  amount,
  payer: '合成付款人',
  payee: '合成收款人',
  screenshotContentVersionId: null,
});
const command = (
  state: 'KNOWN' | 'PENDING',
  amount: string | null,
  type: 'ONE_TIME' | 'INSTALLMENTS',
  count: number,
): RecordEarlyClosureInput => ({
  expectedStage: 'PENDING_MATCH',
  expectedVersion: 1,
  idempotencyKey: '初始付款"key\\with-escape',
  closeAt: '2026-10-01',
  closeAmountState: state,
  closeAmt: amount,
  closeContentVersionIds: [],
  paymentType: type,
  paymentRecords: Array.from({ length: count }, (_, index) =>
    payment(index === 0 ? '0030.0' : '40.00'),
  ),
});
function object(value: unknown): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object');
  return value as Row;
}

describe('3053 actual early service contract (offline; no SQL execution)', () => {
  it.each([
    command('KNOWN', '00100.00', 'ONE_TIME', 1),
    command('KNOWN', '100.00', 'INSTALLMENTS', 2),
    command('KNOWN', '100.00', 'INSTALLMENTS', 0),
    command('PENDING', null, 'INSTALLMENTS', 0),
    command('PENDING', null, 'INSTALLMENTS', 2),
    command('KNOWN', '0', 'ONE_TIME', 0),
  ])(
    'keeps the atomic order and canonical parent/child records: %j',
    async (input) => {
      const f = fixture();
      const result = await f.service.record(actor, caseId, input);
      expect(result).toMatchObject({
        id: caseId,
        stage: 'WAITING_ARCHIVE',
        version: 3,
      });
      expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      const versionId = f.rows.closureVersion![0]!.id;
      const paymentIds = f.rows.payment!.map((row) => row.id);
      expect(f.rows.early![0]).toMatchObject({
        fromVersion: 1,
        toVersion: 2,
        recordedAt: now,
      });
      expect(f.rows.closureVersion![0]).toMatchObject({
        fromVersion: 2,
        toVersion: 3,
        kind: 'REGISTER',
        paymentType: input.paymentType,
        closeAmountState: input.closeAmountState,
        closeAmt: input.closeAmt,
        recordedAt: now,
      });
      const sourceReceipt = f.rows.earlyReceipt![0]!;
      for (const [index, row] of f.rows.payment!.entries()) {
        expect(row).toMatchObject({
          paymentId: row.id,
          revision: 1,
          state: 'ACTIVE',
          closureVersionId: versionId,
          recordedAt: now,
          amount: input.paymentRecords[index]!.amount,
          recordedByUserId: actor.userId,
        });
        expect(f.rows.paymentReceipt![index]).toMatchObject({
          paymentVersionId: row.id,
          auditEventId: row.auditEventId,
          requestFingerprint: sourceReceipt.requestFingerprint,
          idempotencyKey: hash({
            command: 'early-closure-payment',
            key: input.idempotencyKey,
            index,
          }),
          resultSnapshot: {
            versionId: row.id,
            stage: 'WAITING_ARCHIVE',
            reviewRequired: true,
            review: {
              caseId,
              stage: 'WAITING_ARCHIVE',
              closureVersionId: versionId,
              closureAmount: input.closeAmt,
              effectivePaymentVersionIds: paymentIds,
              effectiveAmounts: input.paymentRecords.map((p) => p.amount),
              financialReadiness: 'UNKNOWN',
            },
          },
        });
        expect(
          f.rows.audit!.find((audit) => audit.id === row.auditEventId),
        ).toMatchObject({
          action: 'CASE_CLOSURE_PAYMENT_RECORD',
          resourceId: row.id,
          details: {
            screenshotContentVersionId: null,
            paymentVersionId: row.id,
            caseId,
            closureVersionId: versionId,
            fingerprint: sourceReceipt.requestFingerprint,
            amount: input.paymentRecords[index]!.amount,
          },
        });
      }
      expect(f.events).toEqual([
        'audit:case.early_closed',
        'early',
        'earlyReceipt',
        'case:WAITING_ARCHIVE:2',
        'audit:case.closure.recorded',
        'closure',
        'closureVersion',
        'head-current',
        'case:unchanged:3',
        ...input.paymentRecords.flatMap(() => [
          'audit:CASE_CLOSURE_PAYMENT_RECORD',
          'payment',
          'paymentReceipt',
        ]),
        'closureReceipt',
        'SET CONSTRAINTS ALL IMMEDIATE',
      ]);
      expect(f.materials.assertAvailableVersions).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    command('KNOWN', '100.00', 'ONE_TIME', 2),
    command('PENDING', '100.00', 'ONE_TIME', 0),
  ])('rejects invalid DTO before writing any parent: %j', async (input) => {
    const f = fixture();
    await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
      status: 400,
    });
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('replays the exact original noncanonical amount string without another write', async () => {
    const f = fixture();
    const input = command('KNOWN', '00100.00', 'ONE_TIME', 1);
    const result = await f.service.record(actor, caseId, input);
    const writes = f.events.length;
    await expect(f.service.record(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(f.events).toHaveLength(writes);
  });
  it('demonstrates why numeric-equivalent audit/result amount strings do not form a replayable input', async () => {
    const f = fixture();
    const input = command('KNOWN', '100.00', 'ONE_TIME', 1);
    await f.service.record(actor, caseId, input);
    const receiptResult = object(f.rows.paymentReceipt![0]!.resultSnapshot);
    object(receiptResult.review).effectiveAmounts = ['30.00'];
    const paymentAudit = f.rows.audit!.find(
      (row) => row.action === 'CASE_CLOSURE_PAYMENT_RECORD',
    )!;
    const details = object(paymentAudit.details);
    details.result = receiptResult;
    expect(details.amount).toBe('0030.0');
    // Both amounts still describe the same numeric fact; the original request
    // cannot reproduce the result, and the canonical request has a different fp.
    await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT' },
    });
    await expect(
      f.service.record(actor, caseId, {
        ...input,
        paymentRecords: [payment('30.00')],
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it.each(['payer', 'payee'] as const)(
    'rejects numeric JSON %s when the original party is the string 30',
    async (field) => {
      const f = fixture();
      const input = command('KNOWN', '100.00', 'ONE_TIME', 1);
      input.paymentRecords[0]![field] = '30';
      await f.service.record(actor, caseId, input);
      const paymentAudit = f.rows.audit!.find(
        (row) => row.action === 'CASE_CLOSURE_PAYMENT_RECORD',
      )!;
      object(paymentAudit.details)[field] = 30;
      await expect(
        f.service.record(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });
    },
  );
  it('keeps string JSON audit types, exact audit/result amount text and numeric fact checks in the SQL candidate', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261030530000_early_initial_payment_gate_candidate/migration.sql',
      ),
      'utf8',
    );
    const gate = sql
      .split('CREATE FUNCTION guard_early_initial_payment_record_gate()')[1]!
      .split('CREATE FUNCTION validate_early_initial_payment_source')[0]!;
    const validator = sql
      .split('CREATE FUNCTION validate_early_initial_payment_source')[1]!
      .split('CREATE FUNCTION check_early_initial_payment_source_final')[0]!;
    for (const field of [
      'caseId',
      'closureVersionId',
      'paymentVersionId',
      'paidOn',
      'amount',
      'payer',
      'payee',
      'fingerprint',
    ])
      expect(gate).toContain(`jsonb_typeof(a.details->'${field}')`);
    expect(validator).toContain(
      "audit.details->'amount' IS DISTINCT FROM to_jsonb(amounts.value)",
    );
    expect(validator).toContain(
      'THEN amounts.value::numeric ELSE NULL END IS DISTINCT FROM fact.amount',
    );
  });
  it('queues the same complete-set validator for parent and both child tables with separate table-specific branches', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261030530000_early_initial_payment_gate_candidate/migration.sql',
      ),
      'utf8',
    );
    const validator = sql
      .split('CREATE FUNCTION validate_early_initial_payment_source')[1]!
      .split('CREATE FUNCTION check_early_initial_payment_source_final')[0]!;
    const dispatch = sql
      .split('CREATE FUNCTION check_early_initial_payment_source_final()')[1]!
      .split('-- Replace only')[0]!;
    expect(validator).not.toContain('NEW.');
    expect(validator).toContain('IF payment_count=0 THEN RETURN; END IF;');
    expect(validator).toContain('IF payment_count>100');
    expect(dispatch).toContain(
      'PERFORM validate_early_initial_payment_source(source_id,source_case,source_department)',
    );
    const sourceBranch = dispatch
      .split("IF TG_RELID='case_early_closures'::regclass THEN")[1]!
      .split('ELSIF')[0]!;
    const versionBranch = dispatch
      .split(
        "ELSIF TG_RELID='case_closure_payment_versions'::regclass THEN",
      )[1]!
      .split('ELSIF')[0]!;
    const receiptBranch = dispatch
      .split(
        "ELSIF TG_RELID='case_closure_payment_receipts'::regclass THEN",
      )[1]!
      .split('ELSE')[0]!;
    expect(sourceBranch).not.toContain('NEW.closure_version_id');
    expect(sourceBranch).not.toContain('NEW.payment_version_id');
    expect(versionBranch).toContain('NEW.closure_version_id');
    expect(versionBranch).not.toContain('NEW.payment_version_id');
    expect(receiptBranch).toContain('NEW.payment_version_id');
    for (const [trigger, table] of [
      ['early_initial_payment_source_final', 'case_early_closures'],
      [
        'early_initial_payment_version_set_final',
        'case_closure_payment_versions',
      ],
      [
        'early_initial_payment_receipt_set_final',
        'case_closure_payment_receipts',
      ],
    ])
      expect(sql).toContain(
        `CREATE CONSTRAINT TRIGGER ${trigger} AFTER INSERT ON ${table}\n DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_initial_payment_source_final()`,
      );
  });
});
