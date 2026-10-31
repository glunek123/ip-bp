import type { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import {
  readPaymentFinancialReview,
  type PaymentFinancialReview,
} from './case-closure-payment-financial-prisma-draft';
import { randomUUID } from 'node:crypto';
import { checkArchivePayment } from './case-archive-payment-check';

export type ArchiveLockedScopeDraft = Readonly<{
  purpose: 'ARCHIVE_AGGREGATE_ONLY';
  lawyerBindingId?: string;
}>;
type DiscoveredScope = { caseIds: string[]; consolidationId: string | null };
const archiveAggregateScopes = new WeakMap<
  ArchiveLockedScopeDraft,
  DiscoveredScope & {
    tx: Prisma.TransactionClient;
    actor: ActorContext;
    mainCaseId: string;
  }
>();
function fail(code: string): never {
  throw new Error(code);
}
function uuid(value: string): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
      value,
    )
  )
    fail('INVALID_UUID');
  return value.toLowerCase();
}

/** Locking prerequisite only, never reads funds or grants archive success.
 * Caller must own a SERIALIZABLE transaction and call BEFORE locking any case.
 * It preserves main-case case.archive/currentLawyerBindingId authorization;
 * A verified same-department consolidation permits server-side aggregation only;
 * no original-case IDs or details are returned and no source read/handling grant
 * is created. Main authority does NOT grant general original-case visibility.
 */
export async function lockArchiveCaseScopeDraft(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  caseId: string,
  access: AccessControlService,
  organization: OrganizationService,
): Promise<ArchiveLockedScopeDraft> {
  caseId = uuid(caseId);
  actor = {
    ...actor,
    userId: uuid(actor.userId),
    departmentId: uuid(actor.departmentId),
    ...(actor.lawyerAccountId
      ? { lawyerAccountId: uuid(actor.lawyerAccountId) }
      : {}),
  };
  if (actor.clientCustomerId || actor.notaryOfficeId) fail('ACTION_FORBIDDEN');
  const isolation = await tx.$queryRaw<
    Array<{ isolation: string }>
  >`SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    fail('ARCHIVE_REQUIRES_SERIALIZABLE');
  await lockCustomerActorFacts(tx, organization, actor);
  const account = await tx.userAccount.findUnique({
    where: { id: actor.userId },
    select: { active: true, accountType: true, authorizationRevision: true },
  });
  if (
    !account?.active ||
    account.authorizationRevision !== actor.authorizationRevision
  )
    fail('ACTION_FORBIDDEN');
  const lawyer = account.accountType === 'LAWYER';
  if (
    lawyer
      ? actor.lawyerAccountId !== actor.userId
      : account.accountType !== 'INTERNAL' ||
        actor.lawyerAccountId !== undefined
  )
    fail('ACTION_FORBIDDEN');
  const discover = async (): Promise<DiscoveredScope> => {
    const membership = await tx.$queryRaw<
      Array<{ consolidation_id: string; is_main: boolean }>
    >`
      SELECT consolidation_id,is_main FROM case_consolidation_members
      WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid`;
    const heads = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM case_consolidations
      WHERE main_case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid`;
    if (membership.length === 0 && heads.length === 0)
      return { caseIds: [caseId], consolidationId: null };
    if (membership.length !== 1 || !membership[0].is_main)
      fail('ARCHIVE_REQUIRES_MAIN_CASE');
    if (heads.length !== 1 || heads[0].id !== membership[0].consolidation_id)
      fail('ARCHIVE_SCOPE_INVALID');
    const members = await tx.$queryRaw<
      Array<{ case_id: string; department_id: string; is_main: boolean }>
    >`
      SELECT case_id,department_id,is_main FROM case_consolidation_members
      WHERE consolidation_id=${heads[0].id}::uuid ORDER BY case_id`;
    const ids = members.map((m) => uuid(m.case_id)).sort();
    if (
      members.some((m) => m.department_id !== actor.departmentId) ||
      new Set(ids).size !== ids.length ||
      members.filter((m) => m.is_main).length !== 1 ||
      !members.some((m) => m.is_main && m.case_id === caseId)
    )
      fail('ARCHIVE_SCOPE_INVALID');
    return { caseIds: ids, consolidationId: uuid(heads[0].id) };
  };
  const scope = await discover();
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      department_id: string;
      responsible_user_id: string;
      team_id: string | null;
    }>
  >`
    SELECT c.id,c.department_id,c.responsible_user_id,m.team_id FROM cases c
    JOIN department_memberships m ON m.user_id=c.responsible_user_id AND m.department_id=c.department_id
    WHERE c.id=ANY(${scope.caseIds}::uuid[]) AND c.department_id=${actor.departmentId}::uuid
    ORDER BY c.id FOR UPDATE OF c NOWAIT FOR SHARE OF m NOWAIT`;
  if (
    rows.length !== scope.caseIds.length ||
    rows.some((r) => r.department_id !== actor.departmentId) ||
    JSON.stringify(rows.map((r) => r.id).sort()) !==
      JSON.stringify(scope.caseIds)
  )
    fail('ACTION_FORBIDDEN');
  let lawyerBindingId: string | undefined;
  if (lawyer) {
    lawyerBindingId = await currentLawyerBindingId(tx, actor, caseId, true);
  } else {
    const main = rows.find((r) => r.id === caseId);
    if (!main) fail('ACTION_FORBIDDEN');
    await access.authorizeCase(
      actor,
      'case.archive',
      {
        departmentId: main.department_id,
        responsibleUserId: main.responsible_user_id,
        ...(main.team_id ? { teamId: main.team_id } : {}),
      },
      tx,
    );
  }
  const after = await discover();
  if (
    JSON.stringify(after.caseIds) !== JSON.stringify(scope.caseIds) ||
    after.consolidationId !== scope.consolidationId
  )
    fail('ARCHIVE_SCOPE_CHANGED');
  const capability: ArchiveLockedScopeDraft = Object.freeze({
    purpose: 'ARCHIVE_AGGREGATE_ONLY',
    ...(lawyerBindingId ? { lawyerBindingId } : {}),
  });
  archiveAggregateScopes.set(capability, {
    ...scope,
    tx,
    actor,
    mainCaseId: caseId,
  });
  return capability;
}

/** Same-transaction aggregate only. Never expose source IDs, allocation details
 * or amounts to a caller solely because the caller may archive the main case.
 * An unforgeable scope binds the exact transaction, actor revision and main case.
 */
export async function readArchiveFinancialAggregateDraft(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  scope: ArchiveLockedScopeDraft,
): Promise<
  Pick<PaymentFinancialReview, 'state' | 'refund' | 'customer' | 'lawyer'>
> {
  const authorized = archiveAggregateScopes.get(scope);
  if (
    !authorized ||
    authorized.tx !== tx ||
    authorized.actor.userId !== uuid(actor.userId) ||
    authorized.actor.departmentId !== uuid(actor.departmentId) ||
    authorized.actor.authorizationRevision !== actor.authorizationRevision
  )
    fail('ARCHIVE_SCOPE_CAPABILITY_INVALID');
  const financial = await readPaymentFinancialReview(
    tx,
    authorized.actor,
    authorized.mainCaseId,
    authorized.caseIds,
  );
  return {
    state: financial.state,
    refund: { ...financial.refund },
    customer: { ...financial.customer },
    lawyer: { ...financial.lawyer },
  };
}

type PreparedArchiveFinancialDraft = Pick<
  PaymentFinancialReview,
  'state' | 'refund' | 'customer' | 'lawyer'
> & {
  payment: {
    state: 'PASSED' | 'BLOCKED' | 'UNKNOWN' | 'EXEMPT';
    reason: string;
  };
  /** Persists only inside the exact locked transaction. No gate is bypassed. */
  persist(archiveVersionId: string, closureVersionId: string): Promise<void>;
};
function totalMoney(amounts: readonly string[]): string {
  const total = amounts.reduce((sum, value) => {
    if (!/^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u.test(value))
      fail('INVALID_ARCHIVE_SOURCE_AMOUNT');
    const [whole, fraction = ''] = value.split('.');
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }, 0n);
  return `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`;
}

/** Internal archive preparation, never a display snapshot. All original IDs and
 * numeric evidence remain in the returned persistence closure, not its JSON.
 * SQL independently verifies its supported formula subset; unsupported formula
 * results cannot be approved merely because the application parser accepts them.
 */
export async function prepareArchiveFinancialDraft(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  scope: ArchiveLockedScopeDraft,
): Promise<PreparedArchiveFinancialDraft> {
  const authorized = archiveAggregateScopes.get(scope);
  if (
    !authorized ||
    authorized.tx !== tx ||
    authorized.actor.userId !== uuid(actor.userId) ||
    authorized.actor.departmentId !== uuid(actor.departmentId) ||
    authorized.actor.authorizationRevision !== actor.authorizationRevision
  )
    fail('ARCHIVE_SCOPE_CAPABILITY_INVALID');
  const currentActor = authorized.actor;
  const caseId = authorized.mainCaseId;
  const closureLocks = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT h.id FROM case_closures h
    JOIN case_closure_versions v ON v.id=h.current_version_id AND v.case_id=h.case_id AND v.department_id=h.department_id
    WHERE h.case_id=${caseId}::uuid AND h.department_id=${currentActor.departmentId}::uuid FOR UPDATE OF h,v`;
  if (closureLocks.length !== 1) fail('ARCHIVE_CLOSURE_SOURCE_UNKNOWN');
  await tx.$queryRaw`SELECT case_id FROM case_settlement_terms WHERE case_id=${caseId}::uuid AND department_id=${currentActor.departmentId}::uuid FOR UPDATE`;
  const financial = await readPaymentFinancialReview(
    tx,
    currentActor,
    caseId,
    authorized.caseIds,
  );
  if (!financial.sources) fail('ARCHIVE_FINANCIAL_SOURCE_UNKNOWN');
  const metadata = await tx.$queryRaw<
    Array<{
      closure_version_id: string;
      closure_amount: string | null;
      payment_type: string | null;
      customer_required: string | null;
      lawyer_required: string | null;
    }>
  >`WITH basis AS (
    SELECT v.id,v.close_amt,v.close_amount_state,v.payment_type,t.version AS terms_version,
      jsonb_build_object('closureAmount',v.close_amt::text,'closureAmountState',v.close_amount_state::text,
      'fallbackClaimAmount',NULL,'customerFormula',t.customer_formula,'lawyerMode',t.lawyer_mode::text,
      'lawyerBaseFee',t.lawyer_base_fee::text,'lawyerSplitPercent',t.lawyer_split_percent::text,
      'customerManualAmount',t.customer_manual_amount::text,'lawyerManualAmount',t.lawyer_manual_amount::text) AS inputs
    FROM case_closures h JOIN case_closure_versions v ON v.id=h.current_version_id AND v.case_id=h.case_id AND v.department_id=h.department_id
    LEFT JOIN case_settlement_terms t ON t.case_id=h.case_id AND t.department_id=h.department_id
    WHERE h.case_id=${caseId}::uuid AND h.department_id=${currentActor.departmentId}::uuid
  ), verified AS (SELECT b.*,CASE a.calculation_rule_version
    WHEN 'settlement-calculation-v1-whole-yuan-half-up' THEN archive_verified_settlement_outputs(b.inputs)
    WHEN 'settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up' THEN archive_verified_settlement_outputs_v2(b.inputs)
    ELSE NULL END AS outputs,payment_settlement_outputs_3059(b.inputs,a.calculation_rule_version) AS zero_outputs,
    a.customer_source,a.lawyer_source,a.customer_amount,a.lawyer_amount,
    (a.id IS NOT NULL AND a.closure_version_id=b.id AND a.terms_version IS NOT DISTINCT FROM b.terms_version
      AND a.calculation_inputs=b.inputs AND a.calculation_rule_version IN ('settlement-calculation-v1-whole-yuan-half-up','settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up')
      AND a.declaration='APPLICABLE') AS applicable_exact
    FROM basis b LEFT JOIN case_settlement_assessment_versions a ON a.id=${financial.sources.assessmentVersionId}::uuid
      AND a.case_id=${caseId}::uuid AND a.department_id=${currentActor.departmentId}::uuid
  ) SELECT id AS closure_version_id,CASE WHEN close_amount_state='KNOWN' THEN close_amt::text ELSE NULL END AS closure_amount,payment_type,
    CASE WHEN applicable_exact AND customer_amount=0 AND customer_source=zero_outputs->>'customerSource' AND (zero_outputs->>'customerAmount')::numeric=0 THEN '0.00' WHEN applicable_exact AND customer_source=outputs->>'customerSource' AND customer_amount=(outputs->>'customerAmount')::numeric THEN outputs->>'customerAmount' ELSE NULL END AS customer_required,
    CASE WHEN applicable_exact AND lawyer_amount=0 AND lawyer_source=zero_outputs->>'lawyerSource' AND (zero_outputs->>'lawyerAmount')::numeric=0 THEN '0.00' WHEN applicable_exact AND lawyer_source=outputs->>'lawyerSource' AND lawyer_amount=(outputs->>'lawyerAmount')::numeric THEN outputs->>'lawyerAmount' ELSE NULL END AS lawyer_required FROM verified`;
  if (metadata.length !== 1) fail('ARCHIVE_CLOSURE_SOURCE_UNKNOWN');
  const m = metadata[0];
  uuid(m.closure_version_id);
  const payments = await tx.$queryRaw<
    Array<{ id: string; amount: string }>
  >`SELECT p.id,p.amount::text AS amount
    FROM case_closure_payment_versions p WHERE p.case_id=${caseId}::uuid AND p.department_id=${currentActor.departmentId}::uuid
    AND p.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=p.id) ORDER BY p.id`;
  const allocations = await tx.$queryRaw<
    Array<{ id: string; side: 'CUSTOMER' | 'LAWYER'; amount: string }>
  >`
    SELECT id,side::text,amount::text FROM case_settlement_actual_allocations
    WHERE case_id=ANY(${authorized.caseIds}::uuid[]) AND department_id=${currentActor.departmentId}::uuid ORDER BY id`;
  for (const row of [...payments, ...allocations]) uuid(row.id);
  const paymentResult = checkArchivePayment(
    m.closure_amount,
    payments.map((p) => p.amount),
  );
  const zero = paymentResult.state === 'ZERO_AMOUNT';
  const payment: PreparedArchiveFinancialDraft['payment'] = zero
    ? { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' }
    : paymentResult.state === 'AMOUNT_UNKNOWN'
      ? { state: 'UNKNOWN', reason: 'CLOSURE_AMOUNT_UNKNOWN' }
      : !['ONE_TIME', 'INSTALLMENTS'].includes(m.payment_type ?? '')
        ? { state: 'UNKNOWN', reason: 'PAYMENT_TYPE_UNKNOWN' }
        : m.payment_type === 'ONE_TIME' && payments.length > 1
          ? { state: 'BLOCKED', reason: 'ONE_TIME_MULTIPLE_EFFECTIVE_PAYMENTS' }
          : paymentResult.state === 'PAYMENT_COMPLETE'
            ? { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' }
            : { state: 'BLOCKED', reason: 'CLOSURE_PAYMENT_INCOMPLETE' };
  const refund = { ...financial.refund };
  const customer = { ...financial.customer };
  const lawyer = { ...financial.lawyer };
  // Explicit non-applicability intentionally has no required amount. A passed
  // non-exempt calculated side must have SQL-verifiable output provenance.
  if (
    !zero &&
    customer.state === 'PASSED' &&
    customer.reason !== 'SETTLEMENT_EXPLICITLY_NOT_APPLICABLE' &&
    m.customer_required === null
  )
    Object.assign(customer, {
      state: 'UNKNOWN',
      reason: 'SQL_SETTLEMENT_RULE_UNVERIFIED',
    });
  if (
    !zero &&
    lawyer.state === 'PASSED' &&
    lawyer.reason !== 'SETTLEMENT_EXPLICITLY_NOT_APPLICABLE' &&
    m.lawyer_required === null
  )
    Object.assign(lawyer, {
      state: 'UNKNOWN',
      reason: 'SQL_SETTLEMENT_RULE_UNVERIFIED',
    });
  const items = [payment, refund, customer, lawyer];
  const state = items.some((i) => i.state === 'BLOCKED')
    ? 'BLOCKED'
    : items.some((i) => i.state === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'PASSED';
  const paid = totalMoney(payments.map((p) => p.amount));
  const received = totalMoney(
    allocations.filter((a) => a.side === 'CUSTOMER').map((a) => a.amount),
  );
  const invoiced = totalMoney(
    allocations.filter((a) => a.side === 'LAWYER').map((a) => a.amount),
  );
  return {
    state,
    payment,
    refund,
    customer,
    lawyer,
    persist: async (archiveVersionId, closureVersionId) => {
      if (state !== 'PASSED' || uuid(closureVersionId) !== m.closure_version_id)
        fail('ARCHIVE_FINANCIAL_SOURCE_UNKNOWN');
      const snapshotId = randomUUID();
      // Source writes must be complete before this point. Constraint assembly is
      // DEFERRED, then all snapshot constraints are explicitly checked together.
      await tx.$executeRaw`SET CONSTRAINTS case_archive_evidence_snapshot_complete,case_archive_snapshot_payment_complete,case_archive_snapshot_allocation_complete,archive_snapshot_readiness_protocol,archive_snapshot_payment_readiness_protocol,archive_snapshot_allocation_readiness_protocol DEFERRED`;
      await tx.$executeRaw`INSERT INTO case_archive_evidence_snapshots
      (id,archive_version_id,case_id,department_id,closure_version_id,refund_inventory_version_id,settlement_assessment_version_id,
       consolidation_id,source_case_ids,readiness,payment_readiness,refund_readiness,customer_readiness,lawyer_readiness,
       closure_amount,paid_amount,customer_required_amount,lawyer_required_amount,customer_allocated_amount,lawyer_allocated_amount)
      VALUES (${snapshotId}::uuid,${uuid(archiveVersionId)}::uuid,${caseId}::uuid,${currentActor.departmentId}::uuid,${m.closure_version_id}::uuid,
       ${financial.sources?.refundVersionId}::uuid,${financial.sources?.assessmentVersionId}::uuid,
       ${authorized.consolidationId}::uuid,${authorized.caseIds}::uuid[],${state},${payment.state},${refund.state},${customer.state},${lawyer.state},
       ${m.closure_amount}::numeric,${paid}::numeric,${m.customer_required}::numeric,${m.lawyer_required}::numeric,${received}::numeric,${invoiced}::numeric)`;
      for (const p of payments)
        await tx.$executeRaw`INSERT INTO case_archive_snapshot_payments(snapshot_id,payment_version_id) VALUES (${snapshotId}::uuid,${p.id}::uuid)`;
      for (const a of allocations)
        await tx.$executeRaw`INSERT INTO case_archive_snapshot_allocations(snapshot_id,allocation_id) VALUES (${snapshotId}::uuid,${a.id}::uuid)`;
      await tx.$executeRaw`SET CONSTRAINTS case_archive_evidence_snapshot_complete,case_archive_snapshot_payment_complete,case_archive_snapshot_allocation_complete,archive_snapshot_readiness_protocol,archive_snapshot_payment_readiness_protocol,archive_snapshot_allocation_readiness_protocol IMMEDIATE`;
    },
  };
}
