import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { AuthSession } from '../../api/auth';
import { useAuthStore } from '../../stores/auth';

const api = vi.hoisted(() => ({
  getLitigationRefundCapabilities: vi.fn(),
  listLitigationRefunds: vi.fn(),
  exportLitigationRefunds: vi.fn(),
  followUpLitigationRefund: vi.fn(),
  getLitigationRefundRequest: vi.fn(),
}));
vi.mock('../../api/litigation-refunds', () => ({
  ...api,
  refundStatuses: [
    'UNKNOWN',
    'PENDING',
    'SUBMITTED',
    'RETURNED_UNSETTLED',
    'SETTLED',
    'RECEIVED',
    'CONVERTED_TO_COST',
  ],
}));
import LitigationRefundPanel from './LitigationRefundPanel.vue';

const row = {
  caseId: 'case-1',
  itemId: 'item-1',
  inventoryVersionId: 'inv-1',
  caseNo: '案件001',
  plaintiff: '原告甲',
  defendant: '被告乙',
  courtNo: '（2025）京01号',
  lawyer: '律师甲',
  party: 'COURT',
  amount: null,
  status: 'UNKNOWN',
  description: '诉讼费退费',
  remark: null,
  archived: false,
  archiveStatus: null,
  canFollow: true,
  canRecord: true,
  source: null,
};
const response = {
  items: [row],
  total: 41,
  page: 1,
  pageSize: 20,
  summary: {
    unrefundedAmount: '0.00',
    unrefundedCount: 1,
    pendingSettlementAmount: '0.00',
    filteredAmount: '0.00',
    unknownAmountCount: 1,
  },
  asOf: '2026-11-06T00:00:00.000Z',
};
function session(id: string, revision = 1): AuthSession {
  return {
    principalType: 'INTERNAL',
    user: { id, displayName: id, username: id },
    department: { id: 'dept-1', name: '知产部' },
    departments: [{ id: 'dept-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: revision,
    expiresAt: '2026-12-01T00:00:00.000Z',
    csrfToken: 'csrf',
  };
}
let testPinia: ReturnType<typeof createPinia>;
function render() {
  return mount(LitigationRefundPanel, { global: { plugins: [testPinia] } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('crypto', { randomUUID: () => 'refund-key-test' });
  sessionStorage.clear();
  testPinia = createPinia();
  setActivePinia(testPinia);
  useAuthStore().session = session('user-a');
  api.getLitigationRefundCapabilities.mockResolvedValue({
    read: true,
    record: false,
    follow: true,
    export: true,
  });
  api.listLitigationRefunds.mockResolvedValue(structuredClone(response));
  api.exportLitigationRefunds.mockResolvedValue({
    blob: new Blob(['xlsx']),
    filename: 'filtered.xlsx',
  });
  api.followUpLitigationRefund.mockResolvedValue({
    commandId: 'cmd-1',
    inventoryVersionId: 'inv-2',
    item: row,
  });
});
afterEach(() => vi.restoreAllMocks());

describe('LitigationRefundPanel', () => {
  it('shows unknown amounts distinctly and keeps the ninth data column as case number', async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain('金额待定');
    expect(wrapper.text()).toContain('另有 1 笔金额待定');
    expect(wrapper.findAll('.refund-panel__summary > div')).toHaveLength(2);
    expect(wrapper.get('.refund-panel__filtered-total').text()).toContain(
      '当前筛选应退金额',
    );
    const headers = wrapper.findAll('thead th').map((item) => item.text());
    expect(headers).toEqual([
      '',
      '操作',
      '案件单号',
      '原告',
      '被告',
      '案号',
      '律师',
      '退费方式',
      '退费金额',
      '退费状态',
      '退费备注',
    ]);
    expect(headers).not.toContain('来源');
    await wrapper.get('details summary').trigger('click');
    const defendantColumn = wrapper
      .findAll('.refund-panel__columns label')
      .find((label) => label.text().includes('被告'));
    if (!defendantColumn) throw new Error('defendant column setting missing');
    await defendantColumn.get('input').setValue(false);
    const defendantHeader = wrapper
      .findAll('thead th')
      .find((item) => item.text() === '被告');
    expect(defendantHeader?.isVisible()).toBe(false);
    const restore = wrapper
      .findAll('button')
      .find((button) => button.text() === '恢复默认');
    if (!restore) throw new Error('restore columns action missing');
    await restore.trigger('click');
    await flushPromises();
    expect(
      (defendantColumn.get('input').element as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('filters on the server, resets page selection, and exports all filtered matches', async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.get('input[aria-label="选择案件001"]').setValue(true);
    await wrapper.get('input[type="search"]').setValue('原告甲');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.listLitigationRefunds).toHaveBeenLastCalledWith(
      expect.objectContaining({ plaintiff: '原告甲', page: 1, pageSize: 20 }),
      expect.anything(),
    );
    expect(
      (
        wrapper.get('input[aria-label="选择案件001"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    const exportButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('导出全部筛选结果'));
    if (!exportButton) throw new Error('export action missing');
    await exportButton.trigger('click');
    await flushPromises();
    expect(api.exportLitigationRefunds).toHaveBeenCalledWith(
      expect.objectContaining({ plaintiff: '原告甲' }),
    );
    const exportedQuery = api.exportLitigationRefunds.mock.calls[0]?.[0];
    expect(exportedQuery).not.toHaveProperty('page');
  });

  it('does not offer the cost status for a court refund', async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.get('tbody tr button').trigger('click');
    await flushPromises();
    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.text()).toContain('（2025）京01号');
    expect(dialog.text()).toContain('原告甲');
    expect(dialog.text()).toContain('被告乙');
    expect(dialog.text()).toContain('法院退费');
    const costOption = dialog.find('option[value="CONVERTED_TO_COST"]');
    expect(costOption.exists()).toBe(false);
  });

  it.each(['cancel', 'close', 'backdrop', 'escape'] as const)(
    'closes the follow-up dialog by %s without submitting',
    async (action) => {
      const wrapper = render();
      await flushPromises();
      await wrapper.get('tbody tr button').trigger('click');
      const overlay = wrapper.get('[role="dialog"]');
      if (action === 'cancel')
        await wrapper
          .get(
            '.refund-panel__modal .refund-panel__actions button[type="button"]',
          )
          .trigger('click');
      if (action === 'close')
        await wrapper.get('[aria-label="关闭跟进对话框"]').trigger('click');
      if (action === 'backdrop') await overlay.trigger('click');
      if (action === 'escape')
        await overlay.trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(api.followUpLitigationRefund).not.toHaveBeenCalled();
      wrapper.unmount();
    },
  );

  it('formats large decimal amounts without floating-point rounding', async () => {
    api.listLitigationRefunds.mockResolvedValueOnce({
      ...structuredClone(response),
      items: [{ ...row, amount: '12345678901234.57' }],
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('¥12,345,678,901,234.57');
    const exported = await api.exportLitigationRefunds();
    expect(exported.blob).toBeInstanceOf(Blob);
  });

  it('keeps an unknown request in its owner scope when account identity changes before response', async () => {
    let resolveWrite: (() => void) | undefined;
    api.followUpLitigationRefund.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = () =>
            resolve({
              commandId: 'cmd-1',
              inventoryVersionId: 'inv-2',
              item: row,
            });
        }),
    );
    const wrapper = render();
    await flushPromises();
    await wrapper.get('tbody tr button').trigger('click');
    await wrapper.get('.refund-panel__modal').trigger('submit');
    await flushPromises();
    const keyA = 'litigation-refund-follow-pending:user-a:dept-1';
    const keyB = 'litigation-refund-follow-pending:user-b:dept-1';
    expect(sessionStorage.getItem(keyA)).toContain('idempotencyKey');
    useAuthStore().session = session('user-b');
    await flushPromises();
    resolveWrite?.();
    await flushPromises();
    expect(sessionStorage.getItem(keyA)).toContain('idempotencyKey');
    expect(sessionStorage.getItem(keyB)).toBeNull();
    expect(wrapper.find('.refund-panel__recovery').exists()).toBe(false);
  });

  it('treats a definite conflict as a business error, not an unknown result', async () => {
    api.followUpLitigationRefund.mockRejectedValueOnce(
      new ApiError('版本已变化', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = render();
    await flushPromises();
    await wrapper.get('tbody tr button').trigger('click');
    await wrapper.get('.refund-panel__modal').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('版本已变化');
    expect(wrapper.get('[role="alert"]').text()).not.toContain('结果未知');
    expect(
      sessionStorage.getItem('litigation-refund-follow-pending:user-a:dept-1'),
    ).toBeNull();
  });

  it('does not create a second key or send another save after an unknown result', async () => {
    api.followUpLitigationRefund.mockRejectedValueOnce(
      new ApiError('服务器错误', 500, 'INTERNAL_ERROR'),
    );
    const wrapper = render();
    await flushPromises();
    await wrapper.get('tbody tr button').trigger('click');
    await wrapper.get('.refund-panel__modal').trigger('submit');
    await flushPromises();
    const key = 'litigation-refund-follow-pending:user-a:dept-1';
    const original = sessionStorage.getItem(key);
    expect(original).toContain('idempotencyKey');
    expect(
      wrapper
        .get('.refund-panel__modal button[type="submit"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('.refund-panel__modal').trigger('submit');
    await flushPromises();
    expect(api.followUpLitigationRefund).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key)).toBe(original);
  });

  it('preserves the original body and key when recovery is denied or conflicts', async () => {
    api.followUpLitigationRefund
      .mockRejectedValueOnce(new ApiError('连接超时', 0, 'NETWORK_ERROR'))
      .mockRejectedValueOnce(
        new ApiError('版本已变化', 409, 'VERSION_CONFLICT'),
      );
    api.getLitigationRefundRequest
      .mockRejectedValueOnce(
        new ApiError('无权限查询', 403, 'ACTION_FORBIDDEN'),
      )
      .mockRejectedValueOnce(new ApiError('无回执', 404, 'NOT_FOUND'));
    const wrapper = render();
    await flushPromises();
    await wrapper.get('tbody tr button').trigger('click');
    await wrapper.get('.refund-panel__modal').trigger('submit');
    await flushPromises();
    const key = 'litigation-refund-follow-pending:user-a:dept-1';
    const original = sessionStorage.getItem(key);
    expect(original).toContain('idempotencyKey');
    await wrapper.get('.refund-panel__recovery button').trigger('click');
    await flushPromises();
    expect(sessionStorage.getItem(key)).toBe(original);
    expect(wrapper.get('[role="alert"]').text()).toContain('无权限查询');
    await wrapper
      .get('.refund-panel__recovery button:last-child')
      .trigger('click');
    await flushPromises();
    expect(sessionStorage.getItem(key)).toBe(original);
    expect(wrapper.get('[role="alert"]').text()).toContain('原请求仍待核查');
  });

  it('keeps the same owner key across authorization revisions and reloads capabilities', async () => {
    api.followUpLitigationRefund.mockRejectedValueOnce(
      new ApiError('连接超时', 0, 'NETWORK_ERROR'),
    );
    api.getLitigationRefundCapabilities
      .mockResolvedValueOnce({
        read: true,
        record: false,
        follow: true,
        export: true,
      })
      .mockResolvedValueOnce({
        read: true,
        record: false,
        follow: false,
        export: false,
      });
    const wrapper = render();
    await flushPromises();
    await wrapper.get('tbody tr button').trigger('click');
    await wrapper.get('.refund-panel__modal').trigger('submit');
    await flushPromises();
    const key = 'litigation-refund-follow-pending:user-a:dept-1';
    const savedBody = sessionStorage.getItem(key);
    useAuthStore().session = session('user-a', 2);
    await flushPromises();
    expect(api.getLitigationRefundCapabilities).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem(key)).toBe(savedBody);
    expect(wrapper.find('.refund-panel__recovery').exists()).toBe(true);
    expect(wrapper.find('tbody tr button').exists()).toBe(false);
  });
});
