import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  ...http,
}));
import {
  createCaseFeeEntries,
  createSettlementBill,
  getSettlementContext,
  getSettlementBill,
  listSettlementLaunches,
  listFees,
  previewSettlementBillNumber,
  updateFeeProof,
} from './settlements';
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
describe('settlement API contracts', () => {
  const billItem = {
    id: 'item',
    launchId: 'launch',
    caseId: 'case-uuid',
    caseBusinessNo: 'CASE-2026-完整单号',
    launchDate: '2024-02-29',
    payeeId: 'customer',
    payeeName: '客户甲',
    nth: 2,
    amount: '20.00',
  };
  function billResponse(item: Record<string, unknown>) {
    return {
      id: 'bill',
      billNo: '2026101700001',
      side: 'CUSTOMER',
      billDate: '2026-10-17',
      amount: '20.00',
      note: null,
      cancelledAt: null,
      cancellationReason: null,
      items: [item],
    };
  }
  it('keeps the real business number and launch day from bill detail', async () => {
    http.getJson.mockResolvedValue(billResponse(billItem));
    await expect(getSettlementBill('bill')).resolves.toMatchObject({
      items: [billItem],
    });
    expect(http.getJson).toHaveBeenCalledWith('/settlements/bills/bill');
  });
  it('accepts missing historical fields without inventing values', async () => {
    const legacy: Record<string, unknown> = { ...billItem };
    delete legacy.caseBusinessNo;
    delete legacy.launchDate;
    http.getJson.mockResolvedValue(billResponse(legacy));
    const result = await getSettlementBill('bill');
    expect(result.items[0]).not.toHaveProperty('caseBusinessNo');
    expect(result.items[0]).not.toHaveProperty('launchDate');
  });
  it.each([
    ['caseBusinessNo', null],
    ['caseBusinessNo', 123],
    ['caseBusinessNo', ''],
    ['caseBusinessNo', '   '],
    ['launchDate', null],
    ['launchDate', 123],
    ['launchDate', '2026-02-29'],
    ['launchDate', '2026-04-31'],
    ['launchDate', '2026-10-17T00:00:00Z'],
    ['launchDate', '2026-1-7'],
  ])('rejects malformed present bill item %s: %s', async (field, value) => {
    http.getJson.mockResolvedValue(
      billResponse({ ...billItem, [field]: value }),
    );
    await expect(getSettlementBill('bill')).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_RESPONSE',
    });
  });
  it('keeps the exact proof filename and rejects names attached to an empty proof', async () => {
    const fee = {
      id: 'fee',
      caseId: 'case',
      businessNo: 'CASE-1',
      stage: 'WAITING_ARCHIVE',
      courtCaseNo: null,
      platform: null,
      shopName: null,
      defendantNames: [],
      type: '诉讼费',
      direction: '支出',
      status: '未发起',
      amount: '20.00',
      feeDate: '2026-10-17',
      source: 'manual',
      note: null,
      version: 1,
      proofMaterialId: 'material',
      proofContentVersionId: 'exact-old-cv',
      proofOriginalFilename: '实际精确版本.pdf',
    };
    const page = {
      items: [fee],
      total: 1,
      page: 1,
      pageSize: 100,
      matchingIds: ['fee'],
      matchingSources: [
        {
          id: 'fee',
          businessNo: 'CASE-1',
          type: '诉讼费',
          amount: '20.00',
          status: '未发起',
        },
      ],
      summary: {
        expense: '20.00',
        income: '0.00',
        pending: '0.00',
        pendingCount: 0,
      },
    };
    http.getJson.mockResolvedValue(page);
    await expect(listFees()).resolves.toMatchObject({
      items: [
        {
          proofContentVersionId: 'exact-old-cv',
          proofOriginalFilename: '实际精确版本.pdf',
        },
      ],
    });
    http.getJson.mockResolvedValue({
      ...page,
      items: [
        {
          ...fee,
          proofMaterialId: null,
          proofContentVersionId: null,
          proofOriginalFilename: null,
        },
      ],
    });
    await expect(listFees()).resolves.toMatchObject({
      items: [{ proofOriginalFilename: null }],
    });
    http.getJson.mockResolvedValue({
      ...page,
      items: [{ ...fee, proofMaterialId: null, proofContentVersionId: null }],
    });
    await expect(listFees()).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_RESPONSE',
    });
    const sample = { ...fee, type: '样品费', amount: '100.00' };
    const refund = {
      ...fee,
      id: 'refund',
      type: '样品费退款',
      amount: '20.00',
      proofContentVersionId: 'refund-cv',
      proofOriginalFilename: '退款.pdf',
    };
    const net = {
      ...sample,
      amount: '80.00',
      proofMaterialId: null,
      proofContentVersionId: null,
      proofOriginalFilename: null,
      mergeTypes: ['样品费', '样品费退款'],
      sourceRows: [sample, refund],
    };
    const netPage = {
      ...page,
      items: [net],
      matchingIds: ['fee', 'refund'],
      matchingSources: [sample, refund],
    };
    http.getJson.mockResolvedValue(netPage);
    await expect(listFees()).resolves.toMatchObject({
      items: [
        {
          amount: '80.00',
          sourceRows: [
            { id: 'fee', amount: '100.00' },
            {
              id: 'refund',
              amount: '20.00',
              proofOriginalFilename: '退款.pdf',
            },
          ],
        },
      ],
      matchingSources: [
        { id: 'fee', amount: '100.00' },
        { id: 'refund', amount: '20.00' },
      ],
    });
    for (const bad of [
      { ...net, sourceRows: [sample, sample] },
      { ...net, sourceRows: [sample, { ...refund, caseId: 'other-case' }] },
      { ...net, sourceRows: [net, refund] },
      { ...net, sourceRows: undefined },
      { ...net, amount: '100.00' },
      {
        ...net,
        proofContentVersionId: 'old-cv',
        proofMaterialId: 'material',
        proofOriginalFilename: '原.pdf',
      },
    ]) {
      http.getJson.mockResolvedValue({ ...netPage, items: [bad] });
      await expect(listFees()).rejects.toMatchObject({
        code: 'INVALID_SETTLEMENT_RESPONSE',
      });
    }
    for (const bad of [
      { ...netPage, matchingSources: [sample, sample] },
      { ...netPage, matchingSources: [sample, { ...refund, amount: '80.00' }] },
      { ...netPage, matchingSources: undefined },
      { ...netPage, matchingIds: ['fee'] },
    ]) {
      http.getJson.mockResolvedValue(bad);
      await expect(listFees()).rejects.toMatchObject({
        code: 'INVALID_SETTLEMENT_RESPONSE',
      });
    }
  });
  it('requires real capability booleans rather than treating absent/invalid fields as false', async () => {
    const value = {
      read: true,
      termsUpdate: false,
      launch: false,
      billCreate: false,
      billCancel: false,
      feeRead: true,
      feeCreate: false,
      feeUpdate: false,
      feeLaunch: false,
      feeDelete: false,
    };
    http.getJson.mockResolvedValue(value);
    await expect(getSettlementContext()).resolves.toEqual(value);
    http.getJson.mockResolvedValue({ ...value, feeRead: 'false' });
    await expect(getSettlementContext()).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_RESPONSE',
    });
  });
  it('sends all filters and decodes full-set selectable IDs and KPI independently from the visible page', async () => {
    http.getJson.mockResolvedValue({
      items: [],
      total: 120,
      page: 2,
      pageSize: 100,
      matchingIds: ['outside-page'],
      summary: {
        launchedAmount: '120.00',
        billedAmount: '20.00',
        unbilledAmount: '100.00',
        unbilledCount: 100,
        launchCount: 120,
        billedCount: 20,
        invoiceAmount: null,
        receivedAmount: null,
        paidAmount: null,
        cooperatingPayeeCount: 1,
        knownLawFirmCount: 0,
      },
    });
    const result = await listSettlementLaunches(
      'CUSTOMER',
      2,
      {},
      {
        keyword: '客户 甲',
        stage: 'WAITING_ARCHIVE',
        billed: 'UNBILLED',
        from: '2026-10-01',
        to: '2026-10-17',
      },
    );
    const request = String(http.getJson.mock.calls[0]![0]);
    const params = new URLSearchParams(request.split('?')[1]);
    expect(params.get('keyword')).toBe('客户 甲');
    expect(params.get('billed')).toBe('UNBILLED');
    expect(params.get('page')).toBe('2');
    expect(params.get('from')).toBe('2026-10-01');
    expect(result.matchingIds).toEqual(['outside-page']);
    expect(result.summary.unbilledAmount).toBe('100.00');
  });
  it('does not implicitly retry a failed bill creation or alter exact decimal strings', async () => {
    const body = {
      side: 'CUSTOMER' as const,
      billDate: '2026-10-17',
      launchIds: ['first', 'second'],
      idempotencyKey: 'original',
    };
    http.requestJson.mockRejectedValue(new Error('response lost'));
    await expect(createSettlementBill(body)).rejects.toThrow('response lost');
    expect(http.requestJson).toHaveBeenCalledTimes(1);
    expect(http.requestJson).toHaveBeenCalledWith('/settlements/bills', {
      method: 'POST',
      body,
    });
  });
  it('keeps the number preview explicitly unreserved', async () => {
    http.getJson.mockResolvedValue({
      billNo: '2026101700001',
      reserved: false,
    });
    await expect(previewSettlementBillNumber('2026-10-17')).resolves.toBe(
      '2026101700001',
    );
    http.getJson.mockResolvedValue({ billNo: '2026101700001', reserved: true });
    await expect(
      previewSettlementBillNumber('2026-10-17'),
    ).rejects.toMatchObject({ code: 'INVALID_SETTLEMENT_RESPONSE' });
  });
  it('sends exact proof pairs, clearing null pairs, CAS and the original key unchanged', async () => {
    http.requestJson.mockResolvedValue({ id: 'fee', version: 3 });
    const body = {
      expectedVersion: 2,
      materialId: null,
      contentVersionId: null,
      idempotencyKey: 'proof-key',
    };
    await updateFeeProof('fee', body);
    expect(http.requestJson).toHaveBeenCalledWith('/fees/fee/proof', {
      method: 'POST',
      body,
    });
  });
  it('rejects a partial batch receipt instead of announcing all rows were created', async () => {
    const row = {
      caseId: 'case',
      type: '诉讼费',
      direction: '支出' as const,
      status: '未发起',
      amount: '0.10',
      feeDate: '2026-10-17',
      idempotencyKey: 'row',
    };
    http.requestJson.mockResolvedValue({
      createdIds: ['fee-a'],
      createdCount: 1,
    });
    await expect(
      createCaseFeeEntries({
        caseId: 'case',
        idempotencyKey: 'batch',
        rows: [row, { ...row, idempotencyKey: 'row-b' }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTLEMENT_RESPONSE' });
  });
});
