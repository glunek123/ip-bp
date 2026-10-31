import {
  ApiError,
  requestJson,
  type JsonValue,
  type RequestOptions,
} from './http';
import type { CaseStage } from './cases';

export type EarlyClosurePayment = {
  paidOn: string;
  amount: string;
  payer: string;
  payee: string;
  screenshotContentVersionId: string | null;
};
export type RecordEarlyClosureInput = {
  expectedVersion: number;
  expectedStage: Exclude<CaseStage, 'WAITING_ARCHIVE' | 'ARCHIVED'>;
  idempotencyKey: string;
  closeAt: string;
  closeAmountState: 'KNOWN' | 'PENDING';
  closeAmt: string | null;
  closeContentVersionIds: string[];
  paymentType: 'ONE_TIME' | 'INSTALLMENTS';
  paymentRecords: EarlyClosurePayment[];
};
export type SettlementRefundItem = {
  itemId: string;
  party: 'COURT' | 'DEFENDANT';
  status:
    | 'UNKNOWN'
    | 'PENDING'
    | 'SUBMITTED'
    | 'RETURNED_UNSETTLED'
    | 'SETTLED'
    | 'RECEIVED'
    | 'CONVERTED_TO_COST';
  description: string;
  /** Omitted legacy pending bodies are preserved; new saves send null for unknown. */
  amount?: string | null;
};
export type SettlementRefundInput = { expectedVersionId: string | null } & (
  | { kind: 'CONFIRM_COMPLETE'; items?: never }
  | { kind: 'RECORD' | 'DECLARE_NOT_APPLICABLE'; items: SettlementRefundItem[] }
);
export type SettlementAmountOverride =
  | { mode: 'KEEP' | 'AUTOMATIC'; amount?: never }
  | { mode: 'MANUAL'; amount: string };
export type SettlementAssessmentInput = {
  expectedAssessmentVersionId: string | null;
  expectedTermsVersion: number | null;
  declaration: 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
  customerAmount?: SettlementAmountOverride;
  lawyerAmount?: SettlementAmountOverride;
};
export type UpdateClosureSettlementInput = Omit<
  RecordEarlyClosureInput,
  'expectedStage'
> & {
  expectedClosureVersionId: string;
  correctionReason?: string | null;
  refund?: SettlementRefundInput;
  settlement?: SettlementAssessmentInput;
};
export type SupplementCasePaymentProofInput = {
  idempotencyKey: string;
  expectedClosureVersionId: string;
  paymentId: string;
  expectedPaymentVersionId: string;
  contentVersionIds: string[];
};

function fail(input: boolean): never {
  throw new ApiError(
    input ? '结案命令输入无效' : '服务返回了无效的结案回执',
    input ? 400 : 200,
    input ? 'VALIDATION_ERROR' : 'INVALID_RESPONSE',
  );
}
type Check = (value: unknown) => boolean;
const uuid: Check = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    v,
  );
const positive: Check = (v) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v);
const string =
  (max: number): Check =>
  (v) =>
    typeof v === 'string' && /\S/u.test(v) && v.length <= max;
const decimal: Check = (v) =>
  typeof v === 'string' && /^\d{1,14}(?:\.\d{1,2})?$/u.test(v);
const manual: Check = (v) =>
  typeof v === 'string' && /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(v);
const money: Check = (v) =>
  typeof v === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(v);
const day: Check = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/u.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const timestamp: Check = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString() === v;
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function shape(
  v: unknown,
  required: Record<string, Check>,
  optional: Record<string, Check> = {},
): boolean {
  return (
    record(v) &&
    Object.keys(v).every(
      (k) => Object.hasOwn(required, k) || Object.hasOwn(optional, k),
    ) &&
    Object.entries(required).every(
      ([k, check]) => Object.hasOwn(v, k) && check(v[k]),
    ) &&
    Object.entries(optional).every(
      ([k, check]) => v[k] === undefined || check(v[k]),
    )
  );
}
const list =
  (check: Check, min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) =>
    Array.isArray(v) && v.length >= min && v.length <= max && v.every(check);
const ids =
  (min = 0, max = 10): Check =>
  (v) =>
    list(uuid, min, max)(v) &&
    Array.isArray(v) &&
    new Set(v.map((id: string) => id.toLowerCase())).size === v.length;
const key: Check = (v) =>
  typeof v === 'string' && v.length <= 128 && /^\S(?:[\s\S]*\S)?$/u.test(v);
const payment: Check = (v) =>
  shape(v, {
    paidOn: day,
    amount: (v) => decimal(v) && typeof v === 'string' && /[1-9]/u.test(v),
    payer: string(200),
    payee: string(200),
    screenshotContentVersionId: nullable(uuid),
  });
const base = {
  expectedVersion: positive,
  idempotencyKey: key,
  closeAt: day,
  closeAmountState: oneOf('KNOWN', 'PENDING'),
  closeAmt: nullable(decimal),
  closeContentVersionIds: ids(),
  paymentType: oneOf('ONE_TIME', 'INSTALLMENTS'),
  paymentRecords: list(payment, 0, 100),
};
function baseRelations(v: unknown): boolean {
  return (
    record(v) &&
    (v.closeAmountState === 'PENDING'
      ? v.closeAmt === null
      : decimal(v.closeAmt)) &&
    (v.paymentType !== 'ONE_TIME' ||
      (Array.isArray(v.paymentRecords) && v.paymentRecords.length <= 1))
  );
}
const stages = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
];
const refundItem: Check = (v) =>
  shape(
    v,
    {
      itemId: uuid,
      party: oneOf('COURT', 'DEFENDANT'),
      status: oneOf(
        'UNKNOWN',
        'PENDING',
        'SUBMITTED',
        'RETURNED_UNSETTLED',
        'SETTLED',
        'RECEIVED',
        'CONVERTED_TO_COST',
      ),
      description: string(1000),
    },
    {
      amount: nullable(
        (v) =>
          typeof v === 'string' &&
          /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(v),
      ),
    },
  ) &&
  record(v) &&
  !(v.party === 'COURT' && v.status === 'CONVERTED_TO_COST');
const refund: Check = (v) => {
  if (!record(v)) return false;
  if (v.kind === 'CONFIRM_COMPLETE')
    return shape(v, {
      expectedVersionId: uuid,
      kind: oneOf('CONFIRM_COMPLETE'),
    });
  return (
    shape(v, {
      expectedVersionId: nullable(uuid),
      kind: oneOf('RECORD', 'DECLARE_NOT_APPLICABLE'),
      items: list(refundItem),
    }) &&
    Array.isArray(v.items) &&
    (v.kind !== 'DECLARE_NOT_APPLICABLE' || v.items.length === 0) &&
    new Set(v.items.map((i: SettlementRefundItem) => i.itemId.toLowerCase()))
      .size === v.items.length
  );
};
const override: Check = (v) =>
  record(v) &&
  (v.mode === 'MANUAL'
    ? shape(v, { mode: oneOf('MANUAL'), amount: manual })
    : shape(v, { mode: oneOf('KEEP', 'AUTOMATIC') }));
const assessment: Check = (v) =>
  shape(
    v,
    {
      expectedAssessmentVersionId: nullable(uuid),
      expectedTermsVersion: nullable(
        (v) => positive(v) && typeof v === 'number' && v <= 2147483647,
      ),
      declaration: oneOf('UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE'),
    },
    { customerAmount: override, lawyerAmount: override },
  );

export type EarlyClosureResult = {
  id: string;
  earlyClosureId: string;
  closureId: string;
  closureVersionId: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  recordedAt: string;
};
export type SettlementTermsChange = {
  auditEventId: string;
  before: {
    version: number | null;
    customerManualAmount: string | null;
    lawyerManualAmount: string | null;
  };
  after: {
    version: number;
    customerManualAmount: string | null;
    lawyerManualAmount: string | null;
  };
};
export type ClosureAmountUpdateInput = {
  idempotencyKey: string;
  expectedClosureVersionId: string;
  expectedTermsVersion: number | null;
  expectedAssessmentVersionId: string | null;
  customerAmount: SettlementAmountOverride;
  lawyerAmount: SettlementAmountOverride;
};
export type ClosureAmountUpdateResult = {
  caseId: string;
  closureVersionId: string;
  assessmentVersionId: string;
  termsVersion: number;
  change: SettlementTermsChange;
};
export type ClosureSettlementUpdateResult = Omit<
  EarlyClosureResult,
  'earlyClosureId'
> & {
  paymentVersionIds: string[];
  refundInventoryVersionId: string | null;
  settlementAssessmentVersionId: string | null;
  settlementTermsChange: SettlementTermsChange | null;
};
export type PaymentProofSupplementResult = {
  id: string;
  caseId: string;
  paymentId: string;
  paymentVersionId: string;
  closureVersionId: string;
  stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
  contentVersionIds: string[];
  recordedAt: string;
};
const resultBase = {
  id: uuid,
  closureId: uuid,
  closureVersionId: uuid,
  stage: oneOf('WAITING_ARCHIVE'),
  version: positive,
  recordedAt: timestamp,
};
const termsChange: Check = (v) => {
  const amounts = {
    customerManualAmount: nullable(money),
    lawyerManualAmount: nullable(money),
  };
  return (
    shape(v, {
      auditEventId: uuid,
      before: (v) => shape(v, { version: nullable(positive), ...amounts }),
      after: (v) => shape(v, { version: positive, ...amounts }),
    }) &&
    record(v) &&
    record(v.before) &&
    record(v.after) &&
    v.after.version ===
      (typeof v.before.version === 'number' ? v.before.version : 0) + 1
  );
};
async function post(
  caseId: string,
  path: string,
  input: unknown,
  options: RequestOptions,
) {
  if (!uuid(caseId) || !record(input) || !key(input.idempotencyKey))
    return fail(true);
  // Validation precedes serialization. File objects and unknown fields never enter the request.
  return requestJson(`/cases/${encodeURIComponent(caseId)}/${path}`, {
    ...options,
    method: 'POST',
    body: input as JsonValue,
  });
}
function sameId(left: unknown, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}
export async function updateClosureAmounts(
  caseId: string,
  input: ClosureAmountUpdateInput,
  options: RequestOptions = {},
): Promise<ClosureAmountUpdateResult> {
  if (
    !shape(input, {
      idempotencyKey: key,
      expectedClosureVersionId: uuid,
      expectedTermsVersion: nullable(
        (v) => positive(v) && typeof v === 'number' && v <= 2147483646,
      ),
      expectedAssessmentVersionId: nullable(uuid),
      customerAmount: override,
      lawyerAmount: override,
    }) ||
    (input.customerAmount.mode === 'KEEP' && input.lawyerAmount.mode === 'KEEP')
  )
    return fail(true);
  const result = await post(
    caseId,
    'closure-settlement-amounts',
    input,
    options,
  );
  if (
    !shape(result, {
      caseId: uuid,
      closureVersionId: uuid,
      assessmentVersionId: uuid,
      termsVersion: positive,
      change: termsChange,
    }) ||
    !record(result) ||
    !record(result.change) ||
    !record(result.change.before) ||
    !record(result.change.after) ||
    !sameId(result.caseId, caseId) ||
    !sameId(result.closureVersionId, input.expectedClosureVersionId) ||
    result.change.before.version !== input.expectedTermsVersion ||
    result.change.after.version !== result.termsVersion
  )
    return fail(false);
  for (const [field, command] of [
    ['customerManualAmount', input.customerAmount],
    ['lawyerManualAmount', input.lawyerAmount],
  ] as const) {
    const expected =
      command.mode === 'KEEP'
        ? result.change.before[field]
        : command.mode === 'AUTOMATIC'
          ? null
          : (() => {
              const [whole, fraction = ''] = (command.amount ?? '').split('.');
              return `${whole}.${fraction.padEnd(2, '0')}`;
            })();
    if (result.change.after[field] !== expected) return fail(false);
  }
  return result as ClosureAmountUpdateResult;
}
export async function recordCaseEarlyClosure(
  caseId: string,
  input: RecordEarlyClosureInput,
  options: RequestOptions = {},
): Promise<EarlyClosureResult> {
  if (
    !shape(input, { ...base, expectedStage: oneOf(...stages) }) ||
    !baseRelations(input)
  )
    return fail(true);
  const result = await post(caseId, 'early-closure', input, options);
  if (
    !shape(result, { ...resultBase, earlyClosureId: uuid }) ||
    !record(result) ||
    !sameId(result.id, caseId) ||
    // Early closure advances the case, then records its closure version.
    result.version !== input.expectedVersion + 2
  )
    return fail(false);
  return result as EarlyClosureResult;
}
export async function updateCaseClosureSettlement(
  caseId: string,
  input: UpdateClosureSettlementInput,
  options: RequestOptions = {},
): Promise<ClosureSettlementUpdateResult> {
  if (
    !shape(
      input,
      { ...base, expectedClosureVersionId: uuid },
      {
        correctionReason: nullable(string(500)),
        refund,
        settlement: assessment,
      },
    ) ||
    !baseRelations(input)
  )
    return fail(true);
  const result = await post(
    caseId,
    'closure-settlement-updates',
    input,
    options,
  );
  if (
    !shape(result, {
      ...resultBase,
      paymentVersionIds: ids(0, 100),
      refundInventoryVersionId: nullable(uuid),
      settlementAssessmentVersionId: nullable(uuid),
      settlementTermsChange: nullable(termsChange),
    }) ||
    !record(result) ||
    !sameId(result.id, caseId) ||
    result.version !== input.expectedVersion + 1 ||
    !Array.isArray(result.paymentVersionIds) ||
    result.paymentVersionIds.length !== input.paymentRecords.length ||
    (result.refundInventoryVersionId !== null) !==
      (input.refund !== undefined) ||
    (result.settlementAssessmentVersionId !== null) !==
      (input.settlement !== undefined) ||
    (input.settlement === undefined && result.settlementTermsChange !== null)
  )
    return fail(false);
  return result as ClosureSettlementUpdateResult;
}
export async function supplementCasePaymentProof(
  caseId: string,
  input: SupplementCasePaymentProofInput,
  options: RequestOptions = {},
): Promise<PaymentProofSupplementResult> {
  if (
    !shape(input, {
      idempotencyKey: key,
      expectedClosureVersionId: uuid,
      paymentId: uuid,
      expectedPaymentVersionId: uuid,
      contentVersionIds: ids(1),
    })
  )
    return fail(true);
  const result = await post(
    caseId,
    'payment-proof-supplements',
    input,
    options,
  );
  if (
    !shape(result, {
      id: uuid,
      caseId: uuid,
      paymentId: uuid,
      paymentVersionId: uuid,
      closureVersionId: uuid,
      stage: oneOf('WAITING_ARCHIVE', 'ARCHIVED'),
      contentVersionIds: ids(1),
      recordedAt: timestamp,
    }) ||
    !record(result) ||
    !sameId(result.caseId, caseId) ||
    !sameId(result.paymentId, input.paymentId) ||
    !sameId(result.paymentVersionId, input.expectedPaymentVersionId) ||
    !sameId(result.closureVersionId, input.expectedClosureVersionId) ||
    !Array.isArray(result.contentVersionIds) ||
    result.contentVersionIds.length !== input.contentVersionIds.length ||
    !input.contentVersionIds.every((id) =>
      (result.contentVersionIds as unknown[]).some((value) =>
        sameId(value, id),
      ),
    )
  )
    return fail(false);
  return result as PaymentProofSupplementResult;
}
