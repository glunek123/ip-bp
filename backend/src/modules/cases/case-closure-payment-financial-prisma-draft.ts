import type { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import {
  calculateSettlement,
  type SettlementCalculationInput,
} from '../settlements';
import { SETTLEMENT_V1, SETTLEMENT_V2 } from '../settlements';

import {
  reviewRefundInventoryDraft,
  normalizeRefundAmount,
  type RefundInventorySnapshot,
  type RefundInventoryItem,
} from './case-refund-inventory-draft.service';

type State = 'PASSED' | 'BLOCKED' | 'UNKNOWN';
/** numeric(30,2) facts permit 28 integer digits; aggregate sums may exceed that. */
export function allocatedSettlementState(
  required: string | null,
  amounts: readonly string[],
): 'REACHED' | 'INSUFFICIENT' | 'UNKNOWN' {
  const cents = (amount: string) => {
    if (!/^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u.test(amount))
      throw new Error('INVALID_ALLOCATION_AMOUNT');
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  const total = amounts.reduce((sum, value) => sum + cents(value), 0n);
  if (required === null) return 'UNKNOWN';
  const requiredCents = cents(required);
  return total >= requiredCents ? 'REACHED' : 'INSUFFICIENT';
}
type Assessment = {
  id: string;
  declaration: 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
  closure_version_id: string;
  terms_version: number | null;
  calculation_rule_version: string;
  calculation_inputs: Required<SettlementCalculationInput>;
  customer_amount: string | null;
  lawyer_amount: string | null;
  customer_source: string;
  lawyer_source: string;
};
export type PaymentFinancialSources = {
  refundVersionId: string | null;
  assessmentVersionId: string | null;
  allocationIds: string[];
  countedCaseIds: string[];
};
export type FinancialItemReview = { state: State | 'EXEMPT'; reason: string };
export type PaymentFinancialReview = {
  state: State;
  refund: FinancialItemReview;
  customer: FinancialItemReview;
  lawyer: FinancialItemReview;
  sources?: PaymentFinancialSources;
};
function combined(items: readonly FinancialItemReview[]): State {
  return items.some((i) => i.state === 'BLOCKED')
    ? 'BLOCKED'
    : items.some((i) => i.state === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'PASSED';
}
/** Discovery precedes case locking. All locks use the same sorted case order as
 * consolidation. Verified same-department sources permit aggregate review only;
 * they do not grant source-case visibility or handling authority.
 * The caller already holds current case.read authorization facts.
 */
export async function lockPaymentCaseScope(
  db: Prisma.TransactionClient,
  actor: ActorContext,
  caseId: string,
): Promise<string[] | null> {
  let consolidationId: string | null = null;
  const discover = async () => {
    const memberships = await db.$queryRaw<
      { consolidation_id: string; is_main: boolean }[]
    >`SELECT consolidation_id,is_main FROM case_consolidation_members WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid`;
    const heads = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM case_consolidations WHERE main_case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid`;
    if (memberships.length === 0 && heads.length === 0) {
      consolidationId = null;
      return [caseId];
    }
    // Preserve original-case correction authority without granting group review.
    if (
      memberships.length === 1 &&
      !memberships[0].is_main &&
      heads.length === 0
    ) {
      consolidationId = null;
      return [caseId];
    }
    if (
      memberships.length !== 1 ||
      !memberships[0].is_main ||
      heads.length !== 1 ||
      heads[0].id !== memberships[0].consolidation_id
    )
      throw new Error('INVALID_PAYMENT_SCOPE');
    consolidationId = heads[0].id;
    const rows = await db.$queryRaw<
      { case_id: string; department_id: string; is_main: boolean }[]
    >`SELECT case_id,department_id,is_main FROM case_consolidation_members WHERE consolidation_id=${heads[0].id}::uuid ORDER BY case_id`;
    if (
      rows.some((r) => r.department_id !== actor.departmentId) ||
      new Set(rows.map((r) => r.case_id)).size !== rows.length ||
      rows.filter((r) => r.is_main).length !== 1 ||
      !rows.some((r) => r.is_main && r.case_id === caseId)
    )
      throw new Error('INVALID_PAYMENT_SCOPE');
    return rows.map((r) => r.case_id);
  };
  const ids = await discover();
  const originalConsolidationId = consolidationId;
  const locked = await db.$queryRaw<
    { id: string; responsible_user_id: string }[]
  >`SELECT id,responsible_user_id FROM cases WHERE id=ANY(${ids}::uuid[]) AND department_id=${actor.departmentId}::uuid ORDER BY id FOR UPDATE`;
  if (locked.find((r) => r.id === caseId)?.responsible_user_id !== actor.userId)
    throw new Error('ACTION_FORBIDDEN');
  if (
    JSON.stringify(await discover()) !== JSON.stringify(ids) ||
    consolidationId !== originalConsolidationId
  )
    throw new Error('PAYMENT_SCOPE_CHANGED');
  if (
    locked.length !== ids.length ||
    JSON.stringify(locked.map((r) => r.id)) !== JSON.stringify(ids)
  )
    throw new Error('INVALID_PAYMENT_SCOPE');
  return ids;
}
type AssessmentReviewInput = {
  assessment: Assessment | null;
  closureVersionId: string;
  termsVersion: number | null;
  currentInputs: Required<SettlementCalculationInput>;
  allocations: readonly {
    id: string;
    side: 'CUSTOMER' | 'LAWYER';
    amount: string;
  }[];
};
export function reviewPaymentSettlementAssessmentItems(
  input: AssessmentReviewInput,
): { customer: FinancialItemReview; lawyer: FinancialItemReview } {
  const same = (state: State, reason: string) => ({
    customer: { state, reason },
    lawyer: { state, reason },
  });
  const a = input.assessment;
  if (!a) return same('UNKNOWN', 'ASSESSMENT_MISSING');
  if (a.declaration === 'UNKNOWN')
    return same('UNKNOWN', 'SETTLEMENT_DECLARATION_UNKNOWN');
  if (
    a.closure_version_id !== input.closureVersionId ||
    a.terms_version !== input.termsVersion
  )
    return same('UNKNOWN', 'ASSESSMENT_SOURCE_STALE');
  const ruleVersion = a.calculation_rule_version;
  if (ruleVersion !== SETTLEMENT_V1 && ruleVersion !== SETTLEMENT_V2)
    return same('UNKNOWN', 'ASSESSMENT_RULE_UNSUPPORTED');
  if (
    Object.keys(input.currentInputs).some(
      (key) =>
        a.calculation_inputs[key as keyof SettlementCalculationInput] !==
        input.currentInputs[key as keyof SettlementCalculationInput],
    ) ||
    Object.keys(a.calculation_inputs).length !==
      Object.keys(input.currentInputs).length
  )
    return same('UNKNOWN', 'ASSESSMENT_INPUTS_CHANGED');
  if (a.declaration === 'NOT_APPLICABLE')
    return a.customer_amount === null && a.lawyer_amount === null
      ? same('PASSED', 'SETTLEMENT_EXPLICITLY_NOT_APPLICABLE')
      : same('UNKNOWN', 'INVALID_NOT_APPLICABLE_AMOUNTS');
  let recalculated: ReturnType<typeof calculateSettlement>;
  try {
    recalculated = calculateSettlement(input.currentInputs, ruleVersion);
  } catch {
    return same('UNKNOWN', 'INVALID_SETTLEMENT_CALCULATION');
  }
  if (
    a.customer_amount !== recalculated.customerAmount ||
    a.lawyer_amount !== recalculated.lawyerAmount ||
    a.customer_source !== recalculated.customerSource ||
    a.lawyer_source !== recalculated.lawyerSource
  )
    return same('UNKNOWN', 'ASSESSMENT_RESULT_UNVERIFIED');
  const seen = new Map<
    string,
    { side: 'CUSTOMER' | 'LAWYER'; amount: string }
  >();
  for (const row of input.allocations) {
    const prior = seen.get(row.id);
    if (prior && (prior.side !== row.side || prior.amount !== row.amount))
      return same('UNKNOWN', 'ALLOCATION_ID_CONFLICT');
    seen.set(row.id, row);
  }
  const unique = [
    ...new Map(input.allocations.map((row) => [row.id, row])).values(),
  ];
  const review = (side: 'CUSTOMER' | 'LAWYER'): FinancialItemReview => {
    let state: ReturnType<typeof allocatedSettlementState>;
    try {
      state = allocatedSettlementState(
        side === 'CUSTOMER'
          ? recalculated.customerAmount
          : recalculated.lawyerAmount,
        unique.filter((r) => r.side === side).map((r) => r.amount),
      );
    } catch {
      return { state: 'UNKNOWN', reason: 'INVALID_ALLOCATION_AMOUNT' };
    }
    return {
      state:
        state === 'REACHED'
          ? 'PASSED'
          : state === 'INSUFFICIENT'
            ? 'BLOCKED'
            : 'UNKNOWN',
      reason:
        state === 'REACHED'
          ? (side === 'CUSTOMER'
              ? recalculated.customerAmount
              : recalculated.lawyerAmount) === '0.00'
            ? side === 'CUSTOMER'
              ? 'CUSTOMER_REQUIRED_AMOUNT_ZERO'
              : 'LAWYER_REQUIRED_AMOUNT_ZERO'
            : side === 'CUSTOMER'
              ? 'CUSTOMER_RECEIPTS_REACHED'
              : 'LAWYER_INVOICES_REACHED'
          : state === 'INSUFFICIENT'
            ? side === 'CUSTOMER'
              ? 'CUSTOMER_RECEIPTS_INSUFFICIENT'
              : 'LAWYER_INVOICES_INSUFFICIENT'
            : 'SETTLEMENT_AMOUNT_UNKNOWN',
    };
  };
  return { customer: review('CUSTOMER'), lawyer: review('LAWYER') };
}
export function reviewPaymentSettlementAssessment(
  input: AssessmentReviewInput,
): State {
  const items = reviewPaymentSettlementAssessmentItems(input);
  return combined([items.customer, items.lawyer]);
}
export function reviewPaymentRefundItems(
  snapshot: RefundInventorySnapshot | null,
): FinancialItemReview {
  if (!snapshot)
    return { state: 'UNKNOWN', reason: 'REFUND_INVENTORY_MISSING' };
  let state: State;
  try {
    state = reviewRefundInventoryDraft(snapshot);
  } catch {
    return { state: 'UNKNOWN', reason: 'INVALID_REFUND_INVENTORY' };
  }
  return {
    state,
    reason:
      snapshot.declaration === 'NOT_APPLICABLE'
        ? 'REFUND_EXPLICITLY_NOT_APPLICABLE'
        : state === 'BLOCKED'
          ? 'REFUND_ITEMS_NOT_RECEIVED_OR_COSTED'
          : state === 'PASSED'
            ? snapshot.items.every(
                (item) => normalizeRefundAmount(item.amount) === '0.00',
              )
              ? 'REFUND_ALL_AMOUNTS_ZERO'
              : 'ALL_REFUND_ITEMS_RECEIVED_OR_COSTED'
            : snapshot.declaration === 'UNKNOWN' || snapshot.items.length === 0
              ? 'REFUND_COMPLETENESS_UNCONFIRMED'
              : snapshot.items.some(
                    (item) => normalizeRefundAmount(item.amount) === null,
                  )
                ? 'REFUND_AMOUNT_UNKNOWN'
                : 'REFUND_ITEM_STATUS_UNKNOWN',
  };
}
/** Single SERIALIZABLE transaction, no independent display-snapshot transaction. */
export async function readPaymentFinancialReview(
  db: Prisma.TransactionClient,
  actor: ActorContext,
  caseId: string,
  caseIds: string[] | null,
): Promise<PaymentFinancialReview> {
  if (!caseIds)
    return {
      state: 'UNKNOWN',
      refund: { state: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNAUTHORIZED' },
      customer: { state: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNAUTHORIZED' },
      lawyer: { state: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNAUTHORIZED' },
    }; // No unauthorized source IDs or amounts leave this boundary.
  const inventories = await db.$queryRaw<
    {
      id: string;
      revision: number;
      declaration: RefundInventorySnapshot['declaration'];
    }[]
  >`SELECT id,revision,declaration FROM case_refund_inventory_versions WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid ORDER BY revision DESC LIMIT 1`;
  const inventory = inventories[0];
  const items = inventory
    ? await db.$queryRaw<
        RefundInventoryItem[]
      >`SELECT i.item_id AS "itemId",i.party,i.status,i.description,a.amount::numeric(16,2)::text AS amount FROM case_refund_inventory_items i LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id WHERE i.inventory_version_id=${inventory.id}::uuid AND i.case_id=${caseId}::uuid AND i.department_id=${actor.departmentId}::uuid ORDER BY i.item_id`
    : [];
  const assessments = await db.$queryRaw<
    Assessment[]
  >`SELECT id,declaration,closure_version_id,terms_version,calculation_rule_version,calculation_inputs,customer_amount::text,lawyer_amount::text,customer_source,lawyer_source FROM case_settlement_assessment_versions WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid ORDER BY revision DESC LIMIT 1`;
  const current = await db.$queryRaw<
    {
      id: string;
      terms_version: number | null;
      inputs: Required<SettlementCalculationInput>;
    }[]
  >`SELECT v.id,t.version AS terms_version,jsonb_build_object('closureAmount',v.close_amt::text,'closureAmountState',v.close_amount_state::text,'fallbackClaimAmount',NULL,'customerFormula',t.customer_formula,'lawyerMode',t.lawyer_mode::text,'lawyerBaseFee',t.lawyer_base_fee::text,'lawyerSplitPercent',t.lawyer_split_percent::text,'customerManualAmount',t.customer_manual_amount::text,'lawyerManualAmount',t.lawyer_manual_amount::text) AS inputs FROM case_closures h JOIN case_closure_versions v ON v.id=h.current_version_id AND v.case_id=h.case_id AND v.department_id=h.department_id LEFT JOIN case_settlement_terms t ON t.case_id=h.case_id AND t.department_id=h.department_id WHERE h.case_id=${caseId}::uuid AND h.department_id=${actor.departmentId}::uuid`;
  const allocations = await db.$queryRaw<
    { id: string; side: 'CUSTOMER' | 'LAWYER'; amount: string }[]
  >`SELECT a.id,a.side::text,a.amount::text FROM case_settlement_actual_allocations a JOIN settlement_actual_facts f ON f.id=a.fact_id AND f.department_id=a.department_id AND f.side=a.side WHERE a.case_id=ANY(${caseIds}::uuid[]) AND a.department_id=${actor.departmentId}::uuid ORDER BY a.id`;
  const sources = {
    refundVersionId: inventory?.id ?? null,
    assessmentVersionId: assessments[0]?.id ?? null,
    allocationIds: [...new Set(allocations.map((a) => a.id))],
    countedCaseIds: caseIds,
  };
  const refund = reviewPaymentRefundItems(
    inventory
      ? { ...inventory, caseId, departmentId: actor.departmentId, items }
      : null,
  );
  if (
    current[0]?.inputs.closureAmountState === 'KNOWN' &&
    /^0(?:\.0{1,2})?$/u.test(current[0].inputs.closureAmount ?? '')
  ) {
    const exempt: FinancialItemReview = {
      state: 'EXEMPT',
      reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT',
    };
    return {
      state: combined([refund]),
      refund,
      customer: exempt,
      lawyer: exempt,
      sources,
    };
  }
  const settlement = current[0]
    ? reviewPaymentSettlementAssessmentItems({
        assessment: assessments[0] ?? null,
        closureVersionId: current[0].id,
        termsVersion: current[0].terms_version,
        currentInputs: current[0].inputs,
        allocations,
      })
    : {
        customer: {
          state: 'UNKNOWN' as const,
          reason: 'CLOSURE_SOURCE_MISSING',
        },
        lawyer: { state: 'UNKNOWN' as const, reason: 'CLOSURE_SOURCE_MISSING' },
      };
  return {
    state: combined([refund, settlement.customer, settlement.lawyer]),
    refund,
    ...settlement,
    sources,
  };
}
