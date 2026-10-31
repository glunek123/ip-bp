import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCaseClosureWorkspace,
  getCaseClosureWorkspace,
} from './case-closure-workspace';
import { ApiError } from './http';

const caseId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000002';
const materialId = '30000000-0000-4000-8000-000000000003';
function fixture() {
  return {
    readPurpose: 'DISPLAY_ONLY',
    caseId,
    caseVersion: 4,
    stage: 'WAITING_ARCHIVE',
    actualRegistrationLawyers: [],
    closure: {
      versionId: null,
      closeOn: null,
      amountState: 'UNKNOWN',
      amount: null,
      paymentType: 'UNKNOWN',
    },
    effectivePayments: [],
    documents: [],
    refund: {
      versionId: null,
      revision: null,
      declaration: 'UNKNOWN',
      items: [],
    },
    assessment: {
      versionId: null,
      revision: null,
      closureVersionId: null,
      termsVersion: null,
      declaration: 'UNKNOWN',
      matchesCurrent: null,
      customerAmount: null,
      lawyerAmount: null,
    },
    actual: {
      connection: 'NOT_CONNECTED',
      scope: null,
      customerReceiptState: 'UNKNOWN',
      lawyerInvoiceState: 'UNKNOWN',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('closure workspace read API', () => {
  it('preserves original and independently supplemented exact payment documents using the existing contract', () => {
    const documents = [
      { materialId, contentVersionId: versionId },
      { materialId, contentVersionId: '40000000-0000-4000-8000-000000000004' },
    ];
    const value = {
      ...fixture(),
      effectivePayments: [
        {
          versionId,
          paymentId: caseId,
          revision: 1,
          paidOn: '2026-10-29',
          amount: '10.01',
          payer: '付款方',
          payee: '收款方',
          documents,
        },
      ],
    };
    expect(
      decodeCaseClosureWorkspace(value, caseId).effectivePayments[0].documents,
    ).toEqual(documents);
    expect(() =>
      decodeCaseClosureWorkspace(
        {
          ...value,
          effectivePayments: [
            {
              ...value.effectivePayments[0],
              documents: [{ ...documents[1], supplementId: caseId }],
            },
          ],
        },
        caseId,
      ),
    ).toThrowError(ApiError);
  });
  it('preserves exact current lawyer profile identifiers and names', () => {
    const value = {
      ...fixture(),
      actualRegistrationLawyers: [{ id: versionId, fullName: '当前律师' }],
    };
    expect(decodeCaseClosureWorkspace(value, caseId)).toEqual(value);
  });
  it.each([
    undefined,
    null,
    {},
    [{ id: 'account-name', fullName: '律师' }],
    [{ id: versionId, fullName: '' }],
    [{ id: versionId, fullName: '  ' }],
    [{ id: versionId, fullName: '名'.repeat(201) }],
    [{ id: versionId, fullName: '律师', sourceCaseId: caseId }],
  ])('rejects invalid lawyer options or leaked source fields %#', (options) => {
    expect(() =>
      decodeCaseClosureWorkspace(
        { ...fixture(), actualRegistrationLawyers: options },
        caseId,
      ),
    ).toThrowError(ApiError);
  });
  it('preserves absent facts as UNKNOWN and null', () => {
    expect(decodeCaseClosureWorkspace(fixture(), caseId)).toEqual(fixture());
  });
  it('preserves historical assessment, exact document references and decimal strings', () => {
    const value = {
      ...fixture(),
      closure: {
        versionId,
        closeOn: '2026-10-29',
        amountState: 'KNOWN',
        amount: '9007199254740993.01',
        paymentType: 'INSTALLMENTS',
      },
      effectivePayments: [
        {
          versionId,
          paymentId: caseId,
          revision: 3,
          paidOn: '2026-10-28',
          amount: '0.01',
          payer: '付款方',
          payee: '收款方',
          documents: [{ materialId, contentVersionId: versionId }],
        },
      ],
      documents: [
        { closureVersionId: caseId, materialId, contentVersionId: versionId },
      ],
      assessment: {
        versionId,
        revision: 2,
        closureVersionId: caseId,
        termsVersion: 1,
        declaration: 'APPLICABLE',
        matchesCurrent: false,
        customerAmount: '1.01',
        lawyerAmount: '0.00',
      },
      actual: {
        connection: 'CONNECTED',
        scope: 'CONSOLIDATION',
        customerReceiptState: 'RECORDED',
        lawyerInvoiceState: 'UNKNOWN',
        customerReceivedAmount: '0.00',
        lawyerInvoicedAmount: null,
      },
    };
    expect(decodeCaseClosureWorkspace(value, caseId)).toEqual(value);
  });
  it.each([0, 1.01, '1', '1.001', '-0.01', '1e2', 'NaN', '01.00'])(
    'rejects invalid money %s',
    (amount) => {
      const value = fixture();
      expect(() =>
        decodeCaseClosureWorkspace(
          { ...value, closure: { ...value.closure, amount } },
          caseId,
        ),
      ).toThrowError(ApiError);
    },
  );
  it.each([
    { sourceCaseId: caseId },
    { allocationId: caseId },
    { customerId: caseId },
  ])('rejects leaked aggregate source identifiers %o', (extra) => {
    const value = fixture();
    expect(() =>
      decodeCaseClosureWorkspace(
        { ...value, actual: { ...value.actual, ...extra } },
        caseId,
      ),
    ).toThrowError(ApiError);
  });
  it('rejects unknown keys at nested document and root boundaries', () => {
    expect(() =>
      decodeCaseClosureWorkspace({ ...fixture(), ready: true }, caseId),
    ).toThrowError(ApiError);
    expect(() =>
      decodeCaseClosureWorkspace(
        {
          ...fixture(),
          documents: [
            {
              closureVersionId: caseId,
              materialId,
              contentVersionId: versionId,
              currentContentVersionId: caseId,
            },
          ],
        },
        caseId,
      ),
    ).toThrowError(ApiError);
  });
  it.each([
    { readPurpose: 'AUTHORITATIVE' },
    { caseVersion: 0 },
    { stage: 'NEW' },
    { caseId: versionId },
    { refund: {} },
    { assessment: null },
    { closure: { ...fixture().closure, closeOn: '2026-02-30' } },
    { actual: { ...fixture().actual, customerReceiptState: 'RECORDED' } },
    { actual: { ...fixture().actual, scope: 'CASE' } },
  ])('rejects invalid contracts %o', (change) => {
    expect(() =>
      decodeCaseClosureWorkspace({ ...fixture(), ...change }, caseId),
    ).toThrowError(ApiError);
  });
  it('uses GET with cancellation options and decodes the response', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    expect(
      await getCaseClosureWorkspace(caseId, { signal: controller.signal }),
    ).toEqual(fixture());
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/cases/${caseId}/closure-workspace`,
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('retains server errors rather than replacing them with empty facts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'CASE_ACTION_FORBIDDEN',
            message: '禁止',
            requestId: 'read-1',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(getCaseClosureWorkspace(caseId)).rejects.toMatchObject({
      code: 'CASE_ACTION_FORBIDDEN',
      status: 403,
      requestId: 'read-1',
    });
  });
});

it('decodes saved refund cents or explicit unknown without converting null to zero', () => {
  for (const amount of [null, '0.00', '800.12']) {
    const data = {
      ...fixture(),
      refund: {
        versionId,
        revision: 1,
        declaration: 'COMPLETE',
        items: [
          {
            itemId: materialId,
            party: 'COURT',
            status: 'PENDING',
            description: '退费',
            amount,
          },
        ],
      },
    };
    expect(
      decodeCaseClosureWorkspace(data, caseId).refund.items[0]!.amount,
    ).toBe(amount);
  }
});
it('rejects missing or malformed new workspace amount instead of silently filling zero', () => {
  for (const amount of [undefined, '', '-1.00', '1.001', 0]) {
    const data = {
      ...fixture(),
      refund: {
        versionId,
        revision: 1,
        declaration: 'COMPLETE',
        items: [
          {
            itemId: materialId,
            party: 'COURT',
            status: 'PENDING',
            description: '退费',
            ...(amount === undefined ? {} : { amount }),
          },
        ],
      },
    };
    expect(() => decodeCaseClosureWorkspace(data, caseId)).toThrow();
  }
});
