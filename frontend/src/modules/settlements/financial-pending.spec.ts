import { afterEach, describe, expect, it } from 'vitest';
import {
  loadFinancialPending,
  storeFinancialPending,
  clearFinancialPending,
  isPendingTerms,
  isPendingLaunch,
  isPendingFeeProof,
  isPendingCaseFees,
  isPendingFeeCancellation,
  isPendingFeePaymentVerification,
  isPendingFeeRefund,
} from './financial-pending';
const terms = {
  side: 'CUSTOMER' as const,
  expectedTermsVersion: 1,
  customerFormula: '70.1234567890123456%',
  manualAmount: null,
  idempotencyKey: 'original-key',
};
afterEach(() => globalThis.sessionStorage.clear());
describe('financial original command recovery', () => {
  it('restores the exact body/key after a page remount without sharing it with another account or department', () => {
    storeFinancialPending('user-a:department-a:case', 'terms', terms);
    expect(
      loadFinancialPending('user-a:department-a:case', 'terms', isPendingTerms),
    ).toEqual(terms);
    expect(
      loadFinancialPending('user-b:department-a:case', 'terms', isPendingTerms),
    ).toBeNull();
    expect(
      loadFinancialPending('user-a:department-b:case', 'terms', isPendingTerms),
    ).toBeNull();
  });
  it('never overwrites an unconfirmed body or clears it using a different request', () => {
    storeFinancialPending('scope', 'terms', terms);
    expect(() =>
      storeFinancialPending('scope', 'terms', {
        ...terms,
        customerFormula: '80%',
      }),
    ).toThrow('已有未确认');
    clearFinancialPending('scope', 'terms', {
      ...terms,
      idempotencyKey: 'other-key',
    });
    expect(loadFinancialPending('scope', 'terms', isPendingTerms)).toEqual(
      terms,
    );
    clearFinancialPending('scope', 'terms', terms);
    expect(loadFinancialPending('scope', 'terms', isPendingTerms)).toBeNull();
  });
  it('rejects mixed operations, missing versions and mismatched proof pairs', () => {
    expect(isPendingTerms({ ...terms, lawyerMode: 'FULL_RISK' })).toBe(false);
    expect(
      isPendingLaunch({
        side: 'CUSTOMER',
        amount: '10',
        launchDate: '2026-10-17',
        idempotencyKey: 'key',
      }),
    ).toBe(false);
    expect(
      isPendingFeeProof({
        feeId: 'fee',
        body: {
          materialId: null,
          contentVersionId: 'cv',
          expectedVersion: 1,
          idempotencyKey: 'key',
        },
      }),
    ).toBe(false);
  });
  it('requires every recovered entry to belong to the same case and retain a unique row key', () => {
    const row = {
      caseId: 'case',
      type: '诉讼费',
      direction: '支出',
      status: '未发起',
      amount: '20.00',
      feeDate: '2026-10-17',
      idempotencyKey: 'row-key',
    };
    expect(
      isPendingCaseFees({
        caseId: 'case',
        idempotencyKey: 'batch',
        rows: [row],
      }),
    ).toBe(true);
    expect(
      isPendingCaseFees({
        caseId: 'case',
        idempotencyKey: 'batch',
        rows: [row, { ...row, idempotencyKey: 'second', caseId: 'foreign' }],
      }),
    ).toBe(false);
    expect(
      isPendingCaseFees({
        caseId: 'case',
        idempotencyKey: 'batch',
        rows: [row, row],
      }),
    ).toBe(false);
  });
  it('recovers cancellation, verified payment, and each refund with exact keys and proof pairs', () => {
    expect(
      isPendingFeeCancellation({
        feeId: 'fee',
        body: {
          expectedVersion: 3,
          idempotencyKey: 'cancel-key',
          reason: '撤回',
        },
      }),
    ).toBe(true);
    expect(
      isPendingFeeCancellation({
        feeId: 'fee',
        body: { expectedVersion: 3, idempotencyKey: 'cancel-key', reason: ' ' },
      }),
    ).toBe(false);
    expect(
      isPendingFeePaymentVerification({
        feeId: 'fee',
        body: {
          amount: '0.00',
          paymentDate: null,
          proofMaterialId: null,
          proofContentVersionId: null,
          idempotencyKey: 'payment-key',
        },
      }),
    ).toBe(true);
    expect(
      isPendingFeePaymentVerification({
        feeId: 'fee',
        body: {
          amount: '20.00',
          paymentDate: null,
          proofMaterialId: null,
          proofContentVersionId: null,
          idempotencyKey: 'payment-key',
        },
      }),
    ).toBe(false);
    expect(
      isPendingFeeRefund({
        feeId: 'fee',
        body: {
          amount: '10.00',
          refundDate: '2026-10-26',
          proofMaterialId: 'material',
          proofContentVersionId: 'version',
          idempotencyKey: 'refund-key',
        },
      }),
    ).toBe(true);
    expect(
      isPendingFeeRefund({
        feeId: 'fee',
        body: {
          amount: '10.00',
          refundDate: '2026-10-26',
          proofMaterialId: 'material',
          proofContentVersionId: null,
          idempotencyKey: 'refund-key',
        },
      }),
    ).toBe(false);
  });
});
