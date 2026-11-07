import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportLitigationRefunds,
  listLitigationRefunds,
  refundStatuses,
} from './litigation-refunds';

afterEach(() => vi.unstubAllGlobals());

const row = {
  caseId: 'case-1',
  itemId: 'item-1',
  inventoryVersionId: 'inv-1',
  caseNo: '案号',
  plaintiff: '原告',
  defendant: '被告',
  courtNo: null,
  lawyer: null,
  party: 'COURT',
  amount: null,
  status: 'UNKNOWN',
  description: '说明',
  remark: null,
  archived: false,
  archiveStatus: null,
  canFollow: true,
  canRecord: true,
  source: null,
};
const list = {
  items: [row],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: {
    unrefundedAmount: '0.00',
    unrefundedCount: 0,
    pendingSettlementAmount: '0.00',
    filteredAmount: '0.00',
    unknownAmountCount: 1,
  },
  asOf: '2026-11-06T00:00:00.000Z',
};

describe('litigation refunds API', () => {
  it('decodes exact list data and keeps null amounts distinct from zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(list))),
    );
    const result = await listLitigationRefunds({
      plaintiff: ' 原告 ',
      status: 'UNKNOWN',
    });
    expect(result.items[0]?.amount).toBeNull();
    expect(result.summary.unknownAmountCount).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('plaintiff=%E5%8E%9F%E5%91%8A'),
      expect.anything(),
    );
  });

  it('rejects unknown fields and unknown status values in response rows', async () => {
    for (const badRow of [
      { ...row, unexpected: true },
      { ...row, status: 'FUTURE_STATUS' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ...list, items: [badRow] })),
          ),
      );
      await expect(listLitigationRefunds()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('exports the server filtered set without pagination or selection parameters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('xlsx', {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }),
      ),
    );
    await exportLitigationRefunds({
      plaintiff: '甲',
      status: 'RECEIVED',
      page: 9,
      pageSize: 20,
    });
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain('plaintiff=%E7%94%B2');
    expect(url).toContain('status=RECEIVED');
    expect(url).not.toContain('page=');
    expect(url).not.toContain('selection');
  });

  it('exposes the seven supported states', () => {
    expect(refundStatuses).toHaveLength(7);
    expect(refundStatuses).toContain('UNKNOWN');
    expect(refundStatuses).toContain('CONVERTED_TO_COST');
    expect(refundStatuses).not.toContain('CANCELLED');
  });
});
