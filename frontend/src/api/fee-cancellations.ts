import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import { parseFeeSourceRow, type FeeSourceRow, type Page } from './settlements';

export type FeeReconciliationStatus =
  | 'NOT_REQUIRED'
  | 'PAYMENT_UNVERIFIED'
  | 'NO_PAYMENT'
  | 'REFUND_PENDING'
  | 'PARTIAL_REFUND'
  | 'REFUND_RECORDED';
export type FeeCancellationOutcome = 'DELETED' | 'VOIDED';
export type CancelledFee = FeeSourceRow & {
  deletedAt: string | null;
  cancellation: null | {
    id: string;
    outcome: FeeCancellationOutcome;
    reason: string;
    actorUserId: string;
    createdAt: string;
    refundReconciliationStatus:
      'NOT_REQUIRED' | 'PENDING' | 'PAYMENT_UNVERIFIED';
    reconciliationStatus: FeeReconciliationStatus;
    remainingVerifiedPayment: string | null;
  };
};
export type FeeHistory = FeeSourceRow & {
  deletedAt: string | null;
  cancellation: null | {
    id: string;
    outcome: FeeCancellationOutcome;
    originalStatus: string;
    originalAmount: string;
    originalVersion: number;
    reason: string;
    actorUserId: string;
    createdAt: string;
    refundReconciliationStatus:
      'NOT_REQUIRED' | 'PENDING' | 'PAYMENT_UNVERIFIED';
    reconciliationStatus: FeeReconciliationStatus;
  };
  paymentVerification: null | {
    id: string;
    amount: string;
    paymentDate: string | null;
    proofMaterialId: string | null;
    proofContentVersionId: string | null;
    actorUserId: string;
    createdAt: string;
  };
  refunds: Array<{
    id: string;
    amount: string;
    refundDate: string;
    proofMaterialId: string | null;
    proofContentVersionId: string | null;
    actorUserId: string;
    createdAt: string;
  }>;
  remainingVerifiedPayment: string | null;
};
const invalid = () =>
  new ApiError(
    '费用取消记录接口返回的数据无效',
    502,
    'INVALID_FEE_CANCELLATION_RESPONSE',
  );
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
}
function str(v: unknown): string {
  if (typeof v !== 'string') throw invalid();
  return v;
}
function nullable(v: unknown): string | null {
  return v === null ? null : str(v);
}
function int(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw invalid();
  return v;
}
function status(v: unknown): FeeReconciliationStatus {
  if (
    ![
      'NOT_REQUIRED',
      'PAYMENT_UNVERIFIED',
      'NO_PAYMENT',
      'REFUND_PENDING',
      'PARTIAL_REFUND',
      'REFUND_RECORDED',
    ].includes(String(v))
  )
    throw invalid();
  return v as FeeReconciliationStatus;
}
function outcome(v: unknown): FeeCancellationOutcome {
  if (v !== 'DELETED' && v !== 'VOIDED') throw invalid();
  return v;
}
function page<T>(v: unknown, decode: (row: unknown) => T): Page<T> {
  const r = obj(v);
  if (!Array.isArray(r.items)) throw invalid();
  return {
    items: r.items.map(decode),
    total: int(r.total),
    page: int(r.page),
    pageSize: int(r.pageSize),
  };
}
function cancelled(v: unknown): CancelledFee {
  const r = obj(v);
  const c = r.cancellation === null ? null : obj(r.cancellation);
  return {
    ...parseFeeSourceRow(r),
    deletedAt: nullable(r.deletedAt),
    cancellation:
      c === null
        ? null
        : {
            id: str(c.id),
            outcome: outcome(c.outcome),
            reason: str(c.reason),
            actorUserId: str(c.actorUserId),
            createdAt: str(c.createdAt),
            refundReconciliationStatus: str(c.refundReconciliationStatus) as
              'NOT_REQUIRED' | 'PENDING' | 'PAYMENT_UNVERIFIED',
            reconciliationStatus: status(c.reconciliationStatus),
            remainingVerifiedPayment: nullable(c.remainingVerifiedPayment),
          },
  };
}
export function decodeFeeHistory(v: unknown): FeeHistory {
  const r = obj(v);
  const c = r.cancellation === null ? null : obj(r.cancellation);
  const p = r.paymentVerification === null ? null : obj(r.paymentVerification);
  if (!Array.isArray(r.refunds)) throw invalid();
  return {
    ...parseFeeSourceRow(r),
    deletedAt: nullable(r.deletedAt),
    cancellation:
      c === null
        ? null
        : {
            id: str(c.id),
            outcome: outcome(c.outcome),
            originalStatus: str(c.originalStatus),
            originalAmount: str(c.originalAmount),
            originalVersion: int(c.originalVersion),
            reason: str(c.reason),
            actorUserId: str(c.actorUserId),
            createdAt: str(c.createdAt),
            refundReconciliationStatus: str(c.refundReconciliationStatus) as
              'NOT_REQUIRED' | 'PENDING' | 'PAYMENT_UNVERIFIED',
            reconciliationStatus: status(c.reconciliationStatus),
          },
    paymentVerification:
      p === null
        ? null
        : {
            id: str(p.id),
            amount: str(p.amount),
            paymentDate: nullable(p.paymentDate),
            proofMaterialId: nullable(p.proofMaterialId),
            proofContentVersionId: nullable(p.proofContentVersionId),
            actorUserId: str(p.actorUserId),
            createdAt: str(p.createdAt),
          },
    refunds: r.refunds.map((x) => {
      const q = obj(x);
      return {
        id: str(q.id),
        amount: str(q.amount),
        refundDate: str(q.refundDate),
        proofMaterialId: nullable(q.proofMaterialId),
        proofContentVersionId: nullable(q.proofContentVersionId),
        actorUserId: str(q.actorUserId),
        createdAt: str(q.createdAt),
      };
    }),
    remainingVerifiedPayment: nullable(r.remainingVerifiedPayment),
  };
}
export async function listFeeCancellations(
  query: {
    businessNo?: string;
    type?: string;
    status?: string;
    direction?: string;
    caseId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {},
  options: RequestOptions = {},
): Promise<Page<CancelledFee>> {
  const params = new URLSearchParams({
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? 100),
  });
  for (const [k, v] of Object.entries(query))
    if (k !== 'page' && k !== 'pageSize' && v) params.set(k, String(v));
  return page(
    await getJson(`/fees/cancellations?${params}`, options),
    cancelled,
  );
}
export async function getFeeHistory(
  feeId: string,
  options: RequestOptions = {},
): Promise<FeeHistory> {
  return decodeFeeHistory(
    await getJson(`/fees/${encodeURIComponent(feeId)}/history`, options),
  );
}
export async function cancelFee(
  feeId: string,
  body: { expectedVersion: number; idempotencyKey: string; reason: string },
) {
  const r = obj(
    await requestJson(`/fees/${encodeURIComponent(feeId)}/cancel`, {
      method: 'POST',
      body,
    }),
  );
  return {
    id: str(r.id),
    version: int(r.version),
    cancellationId: str(r.cancellationId),
    outcome: outcome(r.outcome),
    refundReconciliationStatus: str(r.refundReconciliationStatus),
  };
}
export async function verifyCancelledFeePayment(
  feeId: string,
  body: {
    amount: string;
    paymentDate: string | null;
    proofMaterialId: string | null;
    proofContentVersionId: string | null;
    idempotencyKey: string;
  },
) {
  const r = obj(
    await requestJson(
      `/fees/${encodeURIComponent(feeId)}/payment-verification`,
      { method: 'POST', body },
    ),
  );
  return {
    id: str(r.id),
    cancellationId: str(r.cancellationId),
    amount: str(r.amount),
    paymentDate: nullable(r.paymentDate),
  };
}
export async function reconcileCancelledFeeRefund(
  feeId: string,
  body: {
    amount: string;
    refundDate: string;
    proofMaterialId: string | null;
    proofContentVersionId: string | null;
    idempotencyKey: string;
  },
) {
  const r = obj(
    await requestJson(
      `/fees/${encodeURIComponent(feeId)}/refund-reconciliations`,
      { method: 'POST', body },
    ),
  );
  return {
    id: str(r.id),
    cancellationId: str(r.cancellationId),
    amount: str(r.amount),
    refundDate: str(r.refundDate),
  };
}
