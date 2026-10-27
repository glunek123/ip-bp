import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { prepareBatch2CaseConsolidationFixture } from '../support/batch2-case-consolidation-database.mjs';

test.use({ baseURL: 'http://127.0.0.1:5174' });
test.setTimeout(120_000);

const defendant = {
  kind: 'PERSON',
  name: '批次二财务合成被告',
  idNo: '110101200001011234',
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function read<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

type FinanceFixture = Awaited<
  ReturnType<typeof prepareBatch2CaseConsolidationFixture>
>;

async function externalCase(
  request: APIRequestContext,
  csrfToken: string,
  fixture: FinanceFixture,
  label: string,
) {
  return read<{ id: string; businessNo: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: today(),
        source: `Batch2 finance ${fixture.run} ${label}`,
        reason: '合成财务来源验收',
        customerId: fixture.customerId,
        rightsHolderId: fixture.holderId,
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: 'TAOBAO',
          shopName: fixture.businessTag,
          shopExternalId: fixture.shopExternalId,
          caseType: 'CIVIL',
          infringementTypes: null,
        },
      },
    }),
    201,
  );
}

type FeeHistory = {
  id: string;
  caseId: string;
  amount: string;
  status: string;
  cancellation: { id: string; originalAmount: string; outcome: string };
  paymentVerification: { id: string; amount: string };
  refunds: Array<{ id: string; amount: string }>;
  remainingVerifiedPayment: string;
};

test('a consolidated child keeps its paid ledger and accepts a later independent refund', async ({
  request,
}) => {
  const fixture = await prepareBatch2CaseConsolidationFixture();
  const login = await read<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: fixture.username, password: fixture.password },
    }),
    200,
  );
  const headers = { 'X-CSRF-Token': login.csrfToken };
  const main = await externalCase(request, login.csrfToken, fixture, 'main');
  const child = await externalCase(request, login.csrfToken, fixture, 'child');
  expect([main.version, child.version]).toEqual([1, 1]);

  // These are explicit synthetic financial facts, recorded through normal HTTP commands.
  const fee = await read<{ id: string; version: number }>(
    await request.post('/api/v1/fees', {
      headers,
      data: {
        caseId: child.id,
        type: '公证费',
        direction: '支出',
        amount: '10.00',
        status: '已支付',
        feeDate: today(),
        note: '批次二合成已付费用，仅供独立验收',
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const cancelled = await read<{
    cancellationId: string;
    outcome: string;
    refundReconciliationStatus: string;
  }>(
    await request.post(`/api/v1/fees/${fee.id}/cancel`, {
      headers,
      data: {
        expectedVersion: fee.version,
        idempotencyKey: randomUUID(),
        reason: '合成费用作废后核对原账',
      },
    }),
    201,
  );
  expect(cancelled).toMatchObject({
    outcome: 'VOIDED',
    refundReconciliationStatus: 'PENDING',
  });
  const payment = await read<{ id: string; amount: string }>(
    await request.post(`/api/v1/fees/${fee.id}/payment-verification`, {
      headers,
      data: {
        amount: '10.00',
        paymentDate: today(),
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const firstRefund = await read<{ id: string; amount: string }>(
    await request.post(`/api/v1/fees/${fee.id}/refund-reconciliations`, {
      headers,
      data: {
        amount: '2.00',
        refundDate: today(),
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const historyBefore = await read<FeeHistory>(
    await request.get(`/api/v1/fees/${fee.id}/history`),
    200,
  );
  expect(historyBefore).toMatchObject({
    id: fee.id,
    caseId: child.id,
    amount: '10.00',
    status: '已支付',
    cancellation: {
      id: cancelled.cancellationId,
      originalAmount: '10.00',
      outcome: 'VOIDED',
    },
    paymentVerification: { id: payment.id, amount: '10.00' },
    refunds: [{ id: firstRefund.id, amount: '2.00' }],
    remainingVerifiedPayment: '8.00',
  });

  const members = [main, child].map((item) => ({
    caseId: item.id,
    expectedVersion: item.version,
    confirmed: true,
    defendant,
  }));
  const merged = await read<{
    mainCaseId: string;
    caseCount: number;
    caseIds: string[];
  }>(
    await request.post('/api/v1/cases/consolidations', {
      headers,
      data: {
        mainCaseId: main.id,
        members,
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  expect(merged).toMatchObject({
    mainCaseId: main.id,
    caseCount: 2,
  });
  expect(new Set(merged.caseIds)).toEqual(new Set([main.id, child.id]));
  const trace = await read<{
    cases: Array<{ caseId: string; isMain: boolean; feeRecordIds: string[] }>;
  }>(await request.get(`/api/v1/cases/${main.id}/consolidation`), 200);
  expect(trace.cases.find((item) => item.caseId === main.id)).toMatchObject({
    isMain: true,
    feeRecordIds: [],
  });
  expect(trace.cases.find((item) => item.caseId === child.id)).toMatchObject({
    isMain: false,
    feeRecordIds: [fee.id],
  });
  expect(trace.cases.flatMap((item) => item.feeRecordIds)).toEqual([fee.id]);
  expect(
    await read<FeeHistory>(
      await request.get(`/api/v1/fees/${fee.id}/history`),
      200,
    ),
  ).toEqual(historyBefore);

  const secondRefund = await read<{ id: string; amount: string }>(
    await request.post(`/api/v1/fees/${fee.id}/refund-reconciliations`, {
      headers,
      data: {
        amount: '3.00',
        refundDate: today(),
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const historyAfter = await read<FeeHistory>(
    await request.get(`/api/v1/fees/${fee.id}/history`),
    200,
  );
  expect(historyAfter).toMatchObject({
    id: fee.id,
    caseId: child.id,
    amount: '10.00',
    cancellation: { id: cancelled.cancellationId },
    paymentVerification: { id: payment.id, amount: '10.00' },
    remainingVerifiedPayment: '5.00',
  });
  expect(historyAfter.refunds).toHaveLength(2);
  expect(
    historyAfter.refunds.map(({ id, amount }) => ({ id, amount })),
  ).toEqual(
    expect.arrayContaining([
      { id: firstRefund.id, amount: '2.00' },
      { id: secondRefund.id, amount: '3.00' },
    ]),
  );
  const childLedger = await read<{
    total: number;
    items: Array<{ id: string; caseId: string; amount: string }>;
  }>(await request.get(`/api/v1/fees/cancellations?caseId=${child.id}`), 200);
  const mainLedger = await read<{ total: number }>(
    await request.get(`/api/v1/fees/cancellations?caseId=${main.id}`),
    200,
  );
  expect(childLedger).toMatchObject({
    total: 1,
    items: [{ id: fee.id, caseId: child.id, amount: '10.00' }],
  });
  expect(mainLedger.total).toBe(0);
});
