import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerCaseSettlementActual,
  sendSettlementActualCommand,
  settlementActualCandidates,
  type RegisterCaseSettlementActualInput,
} from './settlement-actual-registration';

const caseId = '10000000-0000-4000-8000-000000000001';
const factId = '20000000-0000-4000-8000-000000000002';
const allocationId = '30000000-0000-4000-8000-000000000003';
const lawyerId = '40000000-0000-4000-8000-000000000004';
const input = (): RegisterCaseSettlementActualInput => ({
  caseId,
  side: 'CUSTOMER',
  amount: '0.1',
  occurredOn: '2026-10-29',
  sourceReference: '交易原始编号',
  note: '已实际到账',
  idempotencyKey: 'caller-key',
});
const result = (amount = '0.10') => ({
  id: factId,
  amount,
  allocatedAmount: amount,
  allocationId,
});
function mock(body: unknown, status = 201) {
  const fetch = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe('actual settlement registration', () => {
  it('records explicit customer receipts with original date, money and caller key', async () => {
    const fetch = mock(result());
    const body = input();
    await expect(registerCaseSettlementActual(body)).resolves.toEqual(result());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/settlements/actual-registrations');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(body);
    expect(new Headers(options.headers).has('Idempotency-Key')).toBe(false);
  });
  it.each(['中文登记键', '登记\n原始键'])(
    'sends the original Unicode or multiline key in JSON only',
    async (idempotencyKey) => {
      const fetch = mock(result());
      await registerCaseSettlementActual({ ...input(), idempotencyKey });
      expect(JSON.parse(fetch.mock.calls[0][1].body).idempotencyKey).toBe(
        idempotencyKey,
      );
      expect(
        new Headers(fetch.mock.calls[0][1].headers).has('Idempotency-Key'),
      ).toBe(false);
    },
  );
  it('records lawyer invoices with their explicit lawyer and exact maximum amount', async () => {
    const fetch = mock(result('9999999999999999.99'));
    const body: RegisterCaseSettlementActualInput = {
      ...input(),
      side: 'LAWYER',
      lawyerId,
      amount: '9999999999999999.99',
      sourceReference: null,
    };
    await expect(registerCaseSettlementActual(body)).resolves.toEqual(
      result(body.amount),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it.each(['0.01', '0.10', '1', '100.2'])(
    'preserves input amount %s without floating-point conversion',
    async (amount) => {
      const canonical = amount.includes('.')
        ? `${amount.split('.')[0]}.${amount.split('.')[1].padEnd(2, '0')}`
        : `${amount}.00`;
      const fetch = mock(result(canonical));
      await expect(
        registerCaseSettlementActual({ ...input(), amount }),
      ).resolves.toEqual(result(canonical));
      expect(JSON.parse(fetch.mock.calls[0][1].body).amount).toBe(amount);
    },
  );
  it.each([
    { amount: '0' },
    { amount: '0.00' },
    { amount: 0.1 },
    { amount: '-1' },
    { amount: '1.001' },
    { amount: '1e2' },
    { amount: '10000000000000000' },
    { occurredOn: '2026-02-30' },
    { occurredOn: '0000-01-01' },
    { occurredOn: '2026-10-29T01:00:00Z' },
    { side: 'BILL' },
    { side: 'LAWYER' },
    { lawyerId },
    { caseId: 'case-1' },
    { idempotencyKey: ' ' },
    { sourceReference: '' },
    { note: new File(['x'], 'x.png') },
    { billId: factId },
  ])('rejects invalid or inferred facts before requesting', async (change) => {
    const fetch = mock(result());
    await expect(
      registerCaseSettlementActual({
        ...input(),
        ...change,
      } as RegisterCaseSettlementActualInput),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { allocatedAmount: null },
    { allocatedAmount: '0.09' },
    { amount: '0.11' },
    { amount: 0.1 },
    { amount: '0.1' },
    { allocationId: undefined },
    { sourceCaseId: caseId },
    { id: 'bad' },
  ])(
    'rejects incomplete or inconsistent atomic allocation receipts',
    async (change) => {
      mock({ ...result(), ...change });
      await expect(registerCaseSettlementActual(input())).rejects.toMatchObject(
        { code: 'INVALID_RESPONSE' },
      );
    },
  );
  it('keeps absent source and note absent and retains the original key for replay', async () => {
    const body: RegisterCaseSettlementActualInput = {
      caseId,
      side: 'CUSTOMER',
      amount: '0.1',
      occurredOn: '2026-10-29',
      idempotencyKey: 'same-key',
    };
    const fetch = mock(result());
    await registerCaseSettlementActual(body);
    await registerCaseSettlementActual(body);
    for (const [, options] of fetch.mock.calls)
      expect(JSON.parse(options.body)).toEqual(body);
    expect(body).not.toHaveProperty('sourceReference');
  });
  it('preserves server failures without inventing successful facts or retrying conflicts', async () => {
    const fetch = mock(
      { code: 'ACTUAL_SETTLEMENT_CHANGED', message: '刷新', requestId: 'r1' },
      409,
    );
    await expect(registerCaseSettlementActual(input())).rejects.toMatchObject({
      status: 409,
      code: 'ACTUAL_SETTLEMENT_CHANGED',
      requestId: 'r1',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('separate actual fact and allocation commands', () => {
  it('creates one unallocated fact without a hidden allocation request', async () => {
    const fetch = mock({ id: factId, amount: '0.10', allocatedAmount: null });
    await expect(
      sendSettlementActualCommand({ kind: 'create', input: input() }),
    ).resolves.toEqual({ id: factId, amount: '0.10', allocatedAmount: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      '/api/v1/settlements/actual-registrations/facts',
    );
  });
  it('allocates a selected fact with the original amount and key only once', async () => {
    const body = {
      factId,
      caseId,
      amount: '100',
      idempotencyKey: 'original-allocation',
    };
    const fetch = mock({ id: allocationId, factId, caseId, amount: '100.00' });
    await sendSettlementActualCommand({ kind: 'allocate', input: body });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it.each(['create', 'allocate'] as const)(
    'rejects a mismatched amount in %s receipt as unknown',
    async (kind) => {
      mock(
        kind === 'create'
          ? { id: factId, amount: '200.00', allocatedAmount: null }
          : { id: allocationId, factId, caseId, amount: '200.00' },
      );
      await expect(
        sendSettlementActualCommand(
          kind === 'create'
            ? { kind, input: input() }
            : {
                kind,
                input: { factId, caseId, amount: '100', idempotencyKey: 'key' },
              },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );
  it('reads server authorized choices without a caller supplied source UUID', async () => {
    const rows = [
      {
        id: factId,
        side: 'CUSTOMER',
        amount: '200.00',
        remainingAmount: '100.00',
        occurredOn: '2020-01-02',
        sourceReference: null,
      },
    ];
    const fetch = mock(rows, 200);
    await expect(settlementActualCandidates(caseId)).resolves.toEqual(rows);
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/v1/settlements/actual-registrations/candidates?caseId=${caseId}`,
    );
  });
});
