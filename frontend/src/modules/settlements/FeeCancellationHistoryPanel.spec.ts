import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  listFeeCancellations: vi.fn(),
  getFeeHistory: vi.fn(),
  verifyCancelledFeePayment: vi.fn(),
  reconcileCancelledFeeRefund: vi.fn(),
}));
const materialsApi = vi.hoisted(() => ({ uploadMaterialFile: vi.fn() }));
vi.mock('../../api/fee-cancellations', () => api);
vi.mock('../../api/materials', async (original) => ({
  ...(await original<typeof import('../../api/materials')>()),
  uploadMaterialFile: materialsApi.uploadMaterialFile,
}));
import FeeCancellationHistoryPanel from './FeeCancellationHistoryPanel.vue';
afterEach(() => {
  globalThis.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('FeeCancellationHistoryPanel', () => {
  it('shows cancellation records, null balances as unknown, and supports business number filtering', async () => {
    api.listFeeCancellations.mockResolvedValue({
      items: [
        {
          id: 'fee',
          caseId: 'case',
          businessNo: '案件001',
          type: '诉讼费',
          status: '已支付',
          amount: '50.00',
          cancellation: {
            outcome: 'VOIDED',
            reason: '撤回',
            reconciliationStatus: 'PAYMENT_UNVERIFIED',
            remainingVerifiedPayment: null,
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    const wrapper = mount(FeeCancellationHistoryPanel, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('取消／作废记录');
    expect(wrapper.text()).toContain('待核对');
    await wrapper.get('input[placeholder="输入案件编号"]').setValue('案件001');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.listFeeCancellations).toHaveBeenLastCalledWith(
      expect.objectContaining({ businessNo: '案件001' }),
      expect.anything(),
    );
  });
  it('keeps the exact payment body and idempotency key after an unknown response', async () => {
    api.listFeeCancellations.mockResolvedValue({
      items: [
        {
          id: 'fee',
          caseId: 'case',
          businessNo: '案件001',
          type: '诉讼费',
          direction: '支出',
          status: '已支付',
          amount: '50.00',
          version: 2,
          cancellation: {
            outcome: 'VOIDED',
            reconciliationStatus: 'PAYMENT_UNVERIFIED',
            remainingVerifiedPayment: null,
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    api.getFeeHistory.mockResolvedValue({
      id: 'fee',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '已支付',
      amount: '50.00',
      version: 2,
      cancellation: { outcome: 'VOIDED' },
      paymentVerification: null,
      refunds: [],
      remainingVerifiedPayment: null,
    });
    api.verifyCancelledFeePayment
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({
        id: 'payment',
        cancellationId: 'cancel',
        amount: '40.00',
        paymentDate: '2026-10-26',
      });
    const wrapper = mount(FeeCancellationHistoryPanel, {
      props: { canUpdate: true },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看历史')!
      .trigger('click');
    await flushPromises();
    const amountField = wrapper
      .findAll('label')
      .find((label) => label.text().includes('实际付款金额'))
      ?.find('input');
    expect(amountField).toBeTruthy();
    await amountField!.setValue('40.00');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('保存收付核对'))!
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('核实收付结果／重试原请求');
    const first = api.verifyCancelledFeePayment.mock.calls[0]?.[1];
    await amountField!.setValue('99.00');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核实收付结果／重试原请求'))!
      .trigger('click');
    await flushPromises();
    expect(api.verifyCancelledFeePayment.mock.calls[1]?.[1]).toEqual(first);
    expect(wrapper.text()).not.toContain('核实收付结果／重试原请求');
  });

  it('restores and verifies the locked refund request after remount', async () => {
    const original = {
      feeId: 'fee',
      body: {
        amount: '25.00',
        refundDate: '2026-10-25',
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: 'refund-original-key',
      },
    };
    sessionStorage.setItem(
      'dev-cor.financial-pending.v1:::fee:center:fee-refund',
      JSON.stringify(original),
    );
    api.listFeeCancellations.mockResolvedValue({
      items: [
        {
          id: 'fee',
          caseId: 'case',
          businessNo: '案件001',
          type: '诉讼费',
          direction: '支出',
          status: '已支付',
          amount: '50.00',
          cancellation: { outcome: 'VOIDED' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    api.getFeeHistory.mockResolvedValue({
      id: 'fee',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '已支付',
      amount: '50.00',
      cancellation: { outcome: 'VOIDED' },
      paymentVerification: { amount: '50.00', paymentDate: '2026-10-20' },
      refunds: [],
      remainingVerifiedPayment: '50.00',
    });
    api.reconcileCancelledFeeRefund.mockResolvedValue({
      id: 'refund',
      cancellationId: 'cancel',
      amount: '25.00',
      refundDate: '2026-10-25',
    });
    const wrapper = mount(FeeCancellationHistoryPanel, {
      props: { canUpdate: true },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看历史')!
      .trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="locked-refund-request"]').text()).toContain(
      '25.00 元，退款日期 2026-10-25',
    );
    expect(wrapper.find('input').exists()).toBe(true);
    const button = wrapper
      .findAll('button')
      .find((candidate) =>
        candidate.text().includes('核实退款结果／重试原请求'),
      )!;
    expect((button.element as HTMLButtonElement).disabled).toBe(false);
    await button.trigger('click');
    await flushPromises();
    expect(api.reconcileCancelledFeeRefund).toHaveBeenCalledWith(
      'fee',
      original.body,
    );
    expect(
      sessionStorage.getItem(
        'dev-cor.financial-pending.v1:::fee:center:fee-refund',
      ),
    ).toBeNull();
  });

  it('keeps fee history open after payment and refund saves and refreshes proof and balances', async () => {
    const feeRow = (balance: string | null) => ({
      id: 'fee',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '已支付',
      amount: '50.00',
      cancellation: {
        outcome: 'VOIDED',
        reconciliationStatus:
          balance === null ? 'PAYMENT_UNVERIFIED' : 'PARTIAL_REFUND',
        remainingVerifiedPayment: balance,
      },
    });
    const history = (
      payment: Record<string, unknown> | null,
      refunds: unknown[],
      remaining: string | null,
    ) => ({
      id: 'fee',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '已支付',
      amount: '50.00',
      cancellation: { outcome: 'VOIDED' },
      paymentVerification: payment,
      refunds,
      remainingVerifiedPayment: remaining,
    });
    const listResponse = (row: ReturnType<typeof feeRow>) => ({
      items: [row],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    api.listFeeCancellations
      .mockResolvedValueOnce(listResponse(feeRow(null)))
      .mockResolvedValueOnce(listResponse(feeRow('6.00')))
      .mockResolvedValueOnce(listResponse(feeRow('4.00')));
    api.getFeeHistory
      .mockResolvedValueOnce(history(null, [], null))
      .mockResolvedValueOnce(
        history(
          {
            amount: '6.00',
            paymentDate: '2026-10-20',
            proofMaterialId: 'payment-proof',
            proofContentVersionId: 'payment-proof-v1',
          },
          [],
          '6.00',
        ),
      )
      .mockResolvedValueOnce(
        history(
          {
            amount: '6.00',
            paymentDate: '2026-10-20',
            proofMaterialId: 'payment-proof',
            proofContentVersionId: 'payment-proof-v1',
          },
          [
            {
              amount: '2.00',
              refundDate: '2026-10-25',
              proofMaterialId: 'refund-proof',
              proofContentVersionId: 'refund-proof-v1',
            },
          ],
          '4.00',
        ),
      );
    api.verifyCancelledFeePayment.mockResolvedValue({
      id: 'payment',
      cancellationId: 'cancel',
      amount: '6.00',
      paymentDate: '2026-10-20',
    });
    api.reconcileCancelledFeeRefund.mockResolvedValue({
      id: 'refund',
      cancellationId: 'cancel',
      amount: '2.00',
      refundDate: '2026-10-25',
    });
    materialsApi.uploadMaterialFile
      .mockResolvedValueOnce({
        materialId: 'payment-proof',
        contentVersionId: 'payment-proof-v1',
      })
      .mockResolvedValueOnce({
        materialId: 'refund-proof',
        contentVersionId: 'refund-proof-v1',
      });

    const wrapper = mount(FeeCancellationHistoryPanel, {
      props: { canUpdate: true },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看历史')!
      .trigger('click');
    await flushPromises();

    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('实际付款金额'))!
      .find('input')
      .setValue('6.00');
    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('收付日期'))!
      .find('input')
      .setValue('2026-10-20');
    const paymentFile = wrapper.findAll('input[type="file"]')[0]!;
    Object.defineProperty(paymentFile.element, 'files', {
      value: [
        new File(['payment'], 'payment.pdf', { type: 'application/pdf' }),
      ],
    });
    await paymentFile.trigger('change');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('保存收付核对'))!
      .trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('核实后剩余收付：6.00');
    expect(wrapper.text()).toContain('余额 6.00');
    expect(wrapper.text()).toContain('预览收付凭证');
    expect(api.verifyCancelledFeePayment).toHaveBeenCalledWith(
      'fee',
      expect.objectContaining({
        amount: '6.00',
        proofMaterialId: 'payment-proof',
        proofContentVersionId: 'payment-proof-v1',
      }),
    );

    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('退款金额'))!
      .find('input')
      .setValue('2.00');
    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('实际退款日期'))!
      .find('input')
      .setValue('2026-10-25');
    const refundFile = wrapper.findAll('input[type="file"]')[1]!;
    Object.defineProperty(refundFile.element, 'files', {
      value: [new File(['refund'], 'refund.pdf', { type: 'application/pdf' })],
    });
    await refundFile.trigger('change');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '记录退款')!
      .trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('核实后剩余收付：4.00');
    expect(wrapper.text()).toContain('余额 4.00');
    expect(wrapper.text()).toContain('2026-10-25 · 2.00 元');
    expect(wrapper.text()).toContain('预览收付凭证');
    expect(wrapper.text()).toContain('预览凭证');
    expect(api.reconcileCancelledFeeRefund).toHaveBeenCalledWith(
      'fee',
      expect.objectContaining({
        amount: '2.00',
        refundDate: '2026-10-25',
        proofMaterialId: 'refund-proof',
        proofContentVersionId: 'refund-proof-v1',
      }),
    );
  });

  it('does not reopen the saved fee when a newer same-identity filter supersedes its list refresh', async () => {
    const row = {
      id: 'fee',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '已支付',
      amount: '50.00',
      cancellation: {
        outcome: 'VOIDED',
        reconciliationStatus: 'PAYMENT_UNVERIFIED',
        remainingVerifiedPayment: null,
      },
    };
    const listResponse = (items: (typeof row)[]) => ({
      items,
      total: items.length,
      page: 1,
      pageSize: 50,
    });
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const staleRefresh = deferred<ReturnType<typeof listResponse>>();
    const newerFilter = deferred<ReturnType<typeof listResponse>>();
    api.listFeeCancellations
      .mockResolvedValueOnce(listResponse([row]))
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockImplementationOnce(() => newerFilter.promise);
    api.getFeeHistory.mockResolvedValue({
      id: 'fee',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '已支付',
      amount: '50.00',
      cancellation: { outcome: 'VOIDED' },
      paymentVerification: null,
      refunds: [],
      remainingVerifiedPayment: null,
    });
    api.verifyCancelledFeePayment.mockResolvedValue({
      id: 'payment',
      cancellationId: 'cancel',
      amount: '40.00',
      paymentDate: '2026-10-26',
    });

    const wrapper = mount(FeeCancellationHistoryPanel, {
      props: { canUpdate: true },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看历史')!
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('实际付款金额'))!
      .find('input')
      .setValue('40.00');
    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('收付日期'))!
      .find('input')
      .setValue('2026-10-26');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('保存收付核对'))!
      .trigger('click');
    await flushPromises();
    expect(api.listFeeCancellations).toHaveBeenCalledTimes(2);

    await wrapper.get('input[placeholder="输入案件编号"]').setValue('案件002');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.listFeeCancellations).toHaveBeenCalledTimes(3);

    staleRefresh.resolve(listResponse([row]));
    await flushPromises();
    expect(api.getFeeHistory).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('核实后剩余收付');

    newerFilter.resolve(listResponse([]));
    await flushPromises();
    expect(api.getFeeHistory).toHaveBeenCalledTimes(1);
  });
});
