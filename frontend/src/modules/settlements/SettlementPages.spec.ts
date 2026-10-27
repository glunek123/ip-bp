import {
  flushPromises,
  mount,
  RouterLinkStub,
  type VueWrapper,
  type DOMWrapper,
} from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { Component } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs';
import {
  ElOption,
  ElSelect,
} from 'element-plus/es/components/select/index.mjs';
import { ApiError } from '../../api/http';
import type {
  CaseSettlement,
  SettlementCapabilities,
} from '../../api/settlements';
const api = vi.hoisted(() => ({
  getCaseSettlement: vi.fn(),
  updateCaseSettlementTerms: vi.fn(),
  launchSettlement: vi.fn(),
  getSettlementContext: vi.fn(),
  listSettlementLaunches: vi.fn(),
  listSettlementBills: vi.fn(),
  createSettlementBill: vi.fn(),
  cancelSettlementBill: vi.fn(),
  getSettlementBill: vi.fn(),
  previewSettlementBillNumber: vi.fn(),
  createCaseFeeEntries: vi.fn(),
  listFees: vi.fn(),
  updateFee: vi.fn(),
  updateFeeProof: vi.fn(),
  batchFees: vi.fn(),
}));
vi.mock('../../api/settlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/settlements')>()),
  ...api,
}));
import CaseSettlementPanel from './CaseSettlementPanel.vue';
import SettlementCenterPage from './SettlementCenterPage.vue';
import CaseFeeEntryDialog from './CaseFeeEntryDialog.vue';
import FeeCenterPanel from './FeeCenterPanel.vue';

const current: CaseSettlement = {
  caseId: 'case',
  businessNo: '案件001',
  stage: 'WAITING_ARCHIVE',
  customer: { id: 'real-customer', name: '客户甲' },
  lawyers: [{ id: 'real-lawyer', name: '主办律师', firm: '真实律所' }],
  termsVersion: 1,
  terms: {
    customerFormula: '70%',
    lawyerMode: 'FULL_RISK',
    lawyerBaseFee: '0.00',
    lawyerSplitPercent: '30',
    customerManualAmount: null,
    lawyerManualAmount: null,
  },
  figures: {
    basis: '100.00',
    customerPercent: '70',
    customerAutomaticAmount: '70.00',
    customerAmount: '70.00',
    customerSource: 'AUTOMATIC',
    lawyerAutomaticAmount: '30.00',
    lawyerAmount: '30.00',
    lawyerSource: 'AUTOMATIC',
  },
  customerBalance: {
    launched: '0.00',
    remaining: '70.00',
    overLaunched: false,
  },
  lawyerBalance: { launched: '0.00', remaining: '30.00', overLaunched: false },
  launches: [],
};
const capabilities: SettlementCapabilities = {
  read: true,
  termsUpdate: true,
  launch: true,
  billCreate: true,
  billCancel: true,
  feeRead: false,
  feeCreate: false,
  feeUpdate: false,
  feeLaunch: false,
  feeDelete: false,
};
const wrappers: VueWrapper[] = [];
function render(component: Component, props: Record<string, unknown> = {}) {
  const wrapper = mount(component, {
    props,
    global: { plugins: [createPinia()], stubs: { RouterLink: RouterLinkStub } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
function input(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAll('label')
    .find((item) => item.text().startsWith(label));
  if (!field) throw new Error(`missing ${label}`);
  return field.get('input');
}
function button(wrapper: VueWrapper | DOMWrapper<Element>, label: string) {
  const result = wrapper
    .findAll('button')
    .find((item) => item.text().includes(label));
  if (!result) throw new Error(`missing button ${label}`);
  return result;
}
beforeEach(() => {
  globalThis.sessionStorage.clear();
  setActivePinia(createPinia());
  vi.resetAllMocks();
  api.getCaseSettlement.mockResolvedValue(structuredClone(current));
  api.updateCaseSettlementTerms.mockResolvedValue({
    caseId: 'case',
    termsVersion: 2,
  });
  api.launchSettlement.mockResolvedValue({
    id: 'launch',
    nth: 1,
    amount: '70.00',
  });
  api.getSettlementContext.mockResolvedValue({ ...capabilities });
  api.previewSettlementBillNumber.mockResolvedValue('2026101700001');
  api.listSettlementLaunches.mockResolvedValue({
    items: [
      {
        id: 'launch-page-1',
        caseId: 'case',
        businessNo: '案件001',
        side: 'CUSTOMER',
        nth: 1,
        amount: '10.00',
        billId: null,
        launchDate: '2026-10-17',
        payeeName: '客户甲',
      },
    ],
    total: 200,
    page: 1,
    pageSize: 100,
    matchingIds: ['launch-page-1', 'launch-off-page'],
    summary: {
      launchedAmount: '2000.00',
      billedAmount: '0.00',
      unbilledAmount: '2000.00',
      unbilledCount: 200,
      launchCount: 200,
      billedCount: 0,
      invoiceAmount: null,
      receivedAmount: null,
      paidAmount: null,
      cooperatingPayeeCount: 1,
      knownLawFirmCount: 0,
    },
  });
  api.createCaseFeeEntries.mockResolvedValue({
    createdIds: ['fee-a', 'fee-b'],
    createdCount: 2,
  });
  api.listSettlementBills.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  api.createSettlementBill.mockResolvedValue({
    id: 'bill',
    billNo: '2026101700001',
    amount: '20.00',
  });
});
afterEach(() => {
  globalThis.sessionStorage.clear();
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
describe('settlement page behavior (mounted components, not real browser)', () => {
  it('hides both settlement pagers when the first page is the only page', async () => {
    api.listSettlementLaunches.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      matchingIds: [],
      summary: {
        launchedAmount: '0.00',
        billedAmount: '0.00',
        unbilledAmount: '0.00',
        unbilledCount: 0,
        launchCount: 0,
        billedCount: 0,
        invoiceAmount: null,
        receivedAmount: null,
        paidAmount: null,
        cooperatingPayeeCount: 0,
        knownLawFirmCount: 0,
      },
    });
    api.listSettlementBills.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    const wrapper = render(SettlementCenterPage);
    await flushPromises();

    expect(
      wrapper
        .find('.settlement-center__detail .settlement-center__pager')
        .exists(),
    ).toBe(false);
    expect(
      wrapper
        .find('.settlement-center__bills .settlement-center__pager')
        .exists(),
    ).toBe(false);
  });

  it('keeps previous-page controls when page two reports a shrunken total', async () => {
    const launchPage = await api.listSettlementLaunches();
    const billPage = await api.listSettlementBills();
    api.listSettlementLaunches.mockImplementation(
      (_side: string, requestedPage: number) =>
        Promise.resolve({
          ...launchPage,
          total: requestedPage === 1 ? 200 : 1,
          page: requestedPage,
          items: requestedPage === 1 ? launchPage.items : [],
        }),
    );
    api.listSettlementBills.mockImplementation(
      (_side: string, requestedPage: number) =>
        Promise.resolve({
          ...billPage,
          total: requestedPage === 1 ? 200 : 1,
          page: requestedPage,
          items: requestedPage === 1 ? billPage.items : [],
        }),
    );
    const wrapper = render(SettlementCenterPage);
    await flushPromises();

    await wrapper
      .get(
        '.settlement-center__detail .settlement-center__pager button:last-child',
      )
      .trigger('click');
    await wrapper
      .get(
        '.settlement-center__bills .settlement-center__pager button:last-child',
      )
      .trigger('click');
    await flushPromises();

    const launchPager = wrapper.get(
      '.settlement-center__detail .settlement-center__pager',
    );
    const billPager = wrapper.get(
      '.settlement-center__bills .settlement-center__pager',
    );
    expect(launchPager.text()).toContain('2 / 1');
    expect(launchPager.findAll('button')[0]!.attributes('disabled')).toBe(
      undefined,
    );
    expect(
      launchPager.findAll('button')[1]!.attributes('disabled'),
    ).toBeDefined();
    expect(billPager.text()).toContain('2 / 1');
    expect(billPager.findAll('button')[0]!.attributes('disabled')).toBe(
      undefined,
    );
    expect(
      billPager.findAll('button')[1]!.attributes('disabled'),
    ).toBeDefined();
    await launchPager.get('button').trigger('click');
    await billPager.get('button').trigger('click');
    await flushPromises();
    expect(api.listSettlementLaunches).toHaveBeenLastCalledWith(
      'CUSTOMER',
      1,
      expect.anything(),
      expect.anything(),
    );
    expect(api.listSettlementBills).toHaveBeenLastCalledWith(
      'CUSTOMER',
      1,
      expect.anything(),
      expect.anything(),
    );
  });

  it('keeps settlement detail and bills distinct, with pending facts and right-aligned money', async () => {
    const wrapper = render(SettlementCenterPage);
    await flushPromises();

    const sections = wrapper.findAll('section');
    expect(sections.map((section) => section.classes())).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['settlement-center__detail']),
        expect.arrayContaining(['settlement-center__bills']),
      ]),
    );
    expect(
      sections.findIndex((section) =>
        section.classes().includes('settlement-center__detail'),
      ),
    ).toBeLessThan(
      sections.findIndex((section) =>
        section.classes().includes('settlement-center__bills'),
      ),
    );
    expect(wrapper.get('.kpis').findAll('dd.money')).toHaveLength(5);
    expect(wrapper.get('.kpis').text()).toContain('待财务回填');
    expect(wrapper.get('.settlement-center__bill-create').element).toBeTruthy();
    expect(wrapper.find('.settlement-center__bill-filters').exists()).toBe(
      true,
    );
  });

  it('refreshes a new closure basis and recalculates without replacing the formula draft', async () => {
    const pendingBasis = structuredClone(current);
    pendingBasis.figures = {
      basis: null,
      customerPercent: null,
      customerAutomaticAmount: null,
      customerAmount: null,
      customerSource: 'AUTOMATIC',
      lawyerAutomaticAmount: null,
      lawyerAmount: null,
      lawyerSource: 'AUTOMATIC',
    };
    pendingBasis.customerBalance.remaining = null;
    pendingBasis.lawyerBalance.remaining = null;
    const recordedBasis = {
      ...structuredClone(current),
      figures: {
        ...current.figures,
        basis: '2.00',
        customerAutomaticAmount: '1.00',
        customerAmount: '1.00',
      },
      customerBalance: { ...current.customerBalance, remaining: '1.00' },
    };
    api.getCaseSettlement
      .mockResolvedValueOnce(pendingBasis)
      .mockResolvedValueOnce(recordedBasis);
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      closureVersionId: null,
      canUpdate: true,
    });
    await flushPromises();
    await input(wrapper, '结算条件').setValue('结案金额×50%');
    expect(wrapper.text()).toContain('试算金额：待定');

    await wrapper.setProps({ closureVersionId: 'closure-v1' });
    await flushPromises();

    expect(api.getCaseSettlement).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('结案基数：2.00 元');
    expect((input(wrapper, '结算条件').element as HTMLInputElement).value).toBe(
      '结案金额×50%',
    );
    expect(
      (input(wrapper, '客户结算金额').element as HTMLInputElement).value,
    ).toBe('1.00');
  });

  it('keeps an explicit manual amount when the closure basis refreshes', async () => {
    api.getCaseSettlement
      .mockResolvedValueOnce(structuredClone(current))
      .mockResolvedValueOnce({
        ...structuredClone(current),
        figures: {
          ...current.figures,
          basis: '2.00',
          customerAutomaticAmount: '1.00',
          customerAmount: '1.00',
        },
        customerBalance: { ...current.customerBalance, remaining: '1.00' },
      });
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      closureVersionId: null,
      canUpdate: true,
    });
    await flushPromises();
    await input(wrapper, '结算条件').setValue('结案金额×50%');
    await input(wrapper, '客户结算金额').setValue('12.34');

    await wrapper.setProps({ closureVersionId: 'closure-v2' });
    await flushPromises();

    expect(wrapper.text()).toContain('结案基数：2.00 元');
    expect((input(wrapper, '结算条件').element as HTMLInputElement).value).toBe(
      '结案金额×50%',
    );
    expect(
      (input(wrapper, '客户结算金额').element as HTMLInputElement).value,
    ).toBe('12.34');
    expect(wrapper.text()).toContain('将按手工调整值保存');
  });

  it('keeps lawyer-side drafts when the closure basis refreshes', async () => {
    api.getCaseSettlement
      .mockResolvedValueOnce(structuredClone(current))
      .mockResolvedValueOnce({
        ...structuredClone(current),
        figures: { ...current.figures, basis: '2.00' },
      });
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      closureVersionId: null,
      canUpdate: true,
    });
    await flushPromises();
    await button(wrapper, '律师结算').trigger('click');
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'HALF_RISK');
    await flushPromises();
    expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe(
      'HALF_RISK',
    );
    await input(wrapper, '基础费').setValue('123.45');
    await input(wrapper, '分成比例（%）').setValue('45');
    await input(wrapper, '律师结算金额').setValue('7.89');

    await wrapper.setProps({ closureVersionId: 'closure-v2' });
    await flushPromises();

    expect(wrapper.text()).toContain('结案基数：2.00 元');
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe(
      '律师结算',
    );
    expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe(
      'HALF_RISK',
    );
    expect((input(wrapper, '基础费').element as HTMLInputElement).value).toBe(
      '123.45',
    );
    expect(
      (input(wrapper, '分成比例（%）').element as HTMLInputElement).value,
    ).toBe('45');
    expect(
      (input(wrapper, '律师结算金额').element as HTMLInputElement).value,
    ).toBe('7.89');
  });

  it('keeps an unknown terms request unchanged through a closure basis refresh', async () => {
    api.updateCaseSettlementTerms.mockRejectedValueOnce(
      new ApiError('响应丢失', 0, 'NETWORK_ERROR'),
    );
    api.getCaseSettlement
      .mockResolvedValueOnce(structuredClone(current))
      .mockResolvedValueOnce({
        ...structuredClone(current),
        figures: { ...current.figures, basis: '2.00' },
      });
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      closureVersionId: null,
      canUpdate: true,
    });
    await flushPromises();
    await input(wrapper, '结算条件').setValue('结案金额×50%');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const original = structuredClone(
      api.updateCaseSettlementTerms.mock.calls[0]![1],
    );

    await wrapper.setProps({ closureVersionId: 'closure-v3' });
    await flushPromises();
    expect(wrapper.text()).toContain('用原请求重试保存');
    expect(api.updateCaseSettlementTerms).toHaveBeenCalledTimes(1);

    await button(wrapper, '用原请求重试保存').trigger('click');
    await flushPromises();
    expect(api.updateCaseSettlementTerms.mock.calls[1]![1]).toEqual(original);
  });

  it('keeps an unknown launch request unchanged through a closure basis refresh', async () => {
    api.launchSettlement.mockRejectedValueOnce(
      new ApiError('响应丢失', 0, 'NETWORK_ERROR'),
    );
    api.getCaseSettlement
      .mockResolvedValueOnce(structuredClone(current))
      .mockResolvedValueOnce({
        ...structuredClone(current),
        figures: { ...current.figures, basis: '2.00' },
      });
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      closureVersionId: null,
      canLaunch: true,
    });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const original = structuredClone(api.launchSettlement.mock.calls[0]![1]);

    await wrapper.setProps({ closureVersionId: 'closure-v4' });
    await flushPromises();
    expect(wrapper.text()).toContain('用原请求重试发起');
    expect(api.launchSettlement).toHaveBeenCalledTimes(1);

    await button(wrapper, '用原请求重试发起').trigger('click');
    await flushPromises();
    expect(api.launchSettlement.mock.calls[1]![1]).toEqual(original);
  });

  it('ignores an older closure refresh response after the case identity changes', async () => {
    let resolveOld!: (value: CaseSettlement) => void;
    const oldResponse = new Promise<CaseSettlement>((resolve) => {
      resolveOld = resolve;
    });
    const other = {
      ...structuredClone(current),
      caseId: 'next-case',
      businessNo: 'NEXT-CASE',
      figures: { ...current.figures, basis: '9.00' },
    };
    api.getCaseSettlement
      .mockResolvedValueOnce(structuredClone(current))
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(other);
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      closureVersionId: null,
    });
    await flushPromises();

    await wrapper.setProps({ closureVersionId: 'closure-v5' });
    await flushPromises();
    await wrapper.setProps({ caseId: 'next-case', closureVersionId: null });
    await flushPromises();
    expect(wrapper.text()).toContain('NEXT-CASE');
    expect(wrapper.text()).toContain('结案基数：9.00 元');

    resolveOld({
      ...structuredClone(current),
      businessNo: 'STALE-CASE',
      figures: { ...current.figures, basis: '500.00' },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('NEXT-CASE');
    expect(wrapper.text()).toContain('结案基数：9.00 元');
  });

  it.each([false, true])(
    'shows bill item source facts with legacy=%s',
    async (legacy) => {
      const bill = {
        id: 'bill',
        billNo: '2026101900001',
        side: 'CUSTOMER',
        billDate: '2026-10-19',
        amount: '20.00',
        note: null,
        cancelledAt: null,
        cancellationReason: null,
        payees: ['客户甲'],
        count: 1,
      };
      api.listSettlementBills.mockResolvedValue({
        items: [bill],
        total: 1,
        page: 1,
        pageSize: 100,
      });
      api.getSettlementBill.mockResolvedValue({
        ...bill,
        items: [
          {
            id: 'stable-item',
            launchId: 'launch',
            caseId: 'case-uuid',
            payeeName: '客户甲',
            payeeId: 'customer',
            nth: 2,
            amount: '20.00',
            ...(legacy
              ? {}
              : {
                  caseBusinessNo: 'CASE-2026-完整单号',
                  launchDate: '2026-10-17',
                }),
          },
        ],
      });
      const wrapper = render(SettlementCenterPage);
      await flushPromises();
      await button(wrapper, '查看').trigger('click');
      await flushPromises();
      const detail = wrapper.get('[aria-label="账单详情"]');
      expect(detail.findAll('th').map((cell) => cell.text())).toEqual([
        '收付方',
        '案件单号',
        '发起结算日期',
        '次数',
        '金额（元）',
      ]);
      expect(detail.getComponent(RouterLinkStub).props('to')).toBe(
        '/cases/case-uuid',
      );
      expect(detail.getComponent(RouterLinkStub).text()).toBe(
        legacy ? '历史信息未提供' : 'CASE-2026-完整单号',
      );
      expect(detail.findAll('tbody td')[2]!.text()).toBe(
        legacy ? '历史信息未提供' : '2026-10-17',
      );
      expect(detail.text()).not.toContain('case-uuid');
    },
  );
  it('recalculates the draft immediately and saves a rounded manual value for this case only', async () => {
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      canUpdate: true,
      canLaunch: true,
    });
    await flushPromises();
    await input(wrapper, '结算条件').setValue('结案金额×80%');
    expect(
      (input(wrapper, '客户结算金额').element as HTMLInputElement).value,
    ).toBe('80.00');
    await input(wrapper, '客户结算金额').setValue('45.50');
    await wrapper.findAll('form')[0]!.trigger('submit');
    await flushPromises();
    expect(api.updateCaseSettlementTerms).toHaveBeenCalledWith(
      'case',
      expect.objectContaining({
        side: 'CUSTOMER',
        customerFormula: '结案金额×80%',
        manualAmount: '46.00',
        expectedTermsVersion: 1,
        idempotencyKey: expect.any(String),
      }),
    );
    expect(api.updateCaseSettlementTerms.mock.calls[0]![1]).not.toHaveProperty(
      'lawyerMode',
    );
  });
  it('retries an unknown terms result with exactly the original body/key and disables editing', async () => {
    api.updateCaseSettlementTerms.mockRejectedValueOnce(
      new ApiError('响应丢失', 0, 'NETWORK_ERROR'),
    );
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      canUpdate: true,
    });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const original = structuredClone(
      api.updateCaseSettlementTerms.mock.calls[0]![1],
    );
    expect(input(wrapper, '结算条件').attributes('disabled')).toBeDefined();
    await button(wrapper, '用原请求重试保存').trigger('click');
    await flushPromises();
    expect(api.updateCaseSettlementTerms.mock.calls[1]![1]).toEqual(original);
  });
  it('uses only the actual assigned lawyer and the independent lawyer remaining balance', async () => {
    const wrapper = render(CaseSettlementPanel, {
      caseId: 'case',
      canLaunch: true,
    });
    await flushPromises();
    await button(wrapper, '律师结算').trigger('click');
    await flushPromises();
    expect(
      (input(wrapper, '本次金额（元）').element as HTMLInputElement).value,
    ).toBe('30.00');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.launchSettlement).toHaveBeenCalledWith(
      'case',
      expect.objectContaining({
        side: 'LAWYER',
        lawyerId: 'real-lawyer',
        amount: '30.00',
        expectedTermsVersion: 1,
      }),
    );
  });

  it('recovers an unknown terms command after remount and reuses the exact saved request', async () => {
    api.updateCaseSettlementTerms.mockRejectedValueOnce(
      new ApiError('响应丢失', 0, 'NETWORK_ERROR'),
    );
    const first = render(CaseSettlementPanel, {
      caseId: 'case',
      canUpdate: true,
    });
    await flushPromises();
    await first.get('form').trigger('submit');
    await flushPromises();
    const original = structuredClone(
      api.updateCaseSettlementTerms.mock.calls[0]![1],
    );
    wrappers.splice(wrappers.indexOf(first), 1);
    first.unmount();
    const second = render(CaseSettlementPanel, {
      caseId: 'case',
      canUpdate: true,
    });
    await flushPromises();
    expect(second.text()).toContain('用原请求重试保存');
    await second.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCaseSettlementTerms.mock.calls[1]![1]).toEqual(original);
    expect(globalThis.sessionStorage.length).toBe(0);
  });
  it('shows financial facts while withholding all write forms from a read-only actor', async () => {
    const wrapper = render(CaseSettlementPanel, { caseId: 'case' });
    await flushPromises();
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('70.00');
  });
  it('selects the entire filtered set including IDs beyond the visible page and uses full-set KPI', async () => {
    const wrapper = render(SettlementCenterPage);
    await flushPromises();
    expect(wrapper.text()).toContain('2000.00');
    await wrapper.findComponent(ElCheckbox).get('input').setValue(true);
    await wrapper.get('.settlement-center__bill-create').trigger('submit');
    await flushPromises();
    expect(api.createSettlementBill).toHaveBeenCalledWith(
      expect.objectContaining({
        launchIds: ['launch-page-1', 'launch-off-page'],
      }),
    );
  });
  it('renders a clear empty permission state without fetching either ledger', async () => {
    api.getSettlementContext.mockResolvedValue({
      ...capabilities,
      read: false,
      feeRead: false,
    });
    const wrapper = render(SettlementCenterPage);
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号未获结算与费用中心读取权限');
    expect(api.listSettlementLaunches).not.toHaveBeenCalled();
    expect(api.listSettlementBills).not.toHaveBeenCalled();
  });
});

describe('case fee entry and same-source note editing', () => {
  it('submits all positive rows once while leaving an empty draft row out', async () => {
    const wrapper = render(CaseFeeEntryDialog, {
      caseId: 'case',
      canCreate: true,
      open: true,
      teleported: false,
    });
    await flushPromises();
    await wrapper.get('input[inputmode="decimal"]').setValue('10.10');
    await button(wrapper, '再添加一笔').trigger('click');
    await flushPromises();
    await wrapper.findAll('input[inputmode="decimal"]')[1]!.setValue('20.20');
    await button(wrapper, '再添加一笔').trigger('click');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const body = api.createCaseFeeEntries.mock.calls[0]![0];
    expect(body.caseId).toBe('case');
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map((row: { amount: string }) => row.amount)).toEqual([
      '10.10',
      '20.20',
    ]);
    expect(
      new Set(
        body.rows.map((row: { idempotencyKey: string }) => row.idempotencyKey),
      ).size,
    ).toBe(2);
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
  it('writes a note to the exact shared fee ID/version and reloads the current source', async () => {
    const fee = {
      id: 'fee-a',
      caseId: 'case',
      businessNo: '案件001',
      type: '诉讼费',
      direction: '支出',
      status: '未发起',
      amount: '20.00',
      feeDate: '2026-10-17',
      note: '',
      version: 2,
      proofMaterialId: null,
      proofContentVersionId: null,
      defendantNames: [],
      platform: 'TAOBAO',
      shopName: null,
      courtCaseNo: null,
    };
    api.listFees.mockImplementation(async () => ({
      items: [{ ...fee }],
      total: 1,
      page: 1,
      pageSize: 100,
      matchingIds: ['fee-a'],
      summary: {
        expense: '20.00',
        income: '0.00',
        pending: '20.00',
        pendingCount: 1,
      },
    }));
    api.updateFee.mockImplementation(
      async (_id: string, body: { note: string }) => {
        fee.note = body.note;
        fee.version = 3;
        return { id: 'fee-a', version: 3 };
      },
    );
    const wrapper = render(FeeCenterPanel, { caseId: 'case', canUpdate: true });
    await flushPromises();
    await wrapper
      .get('input[aria-label="案件001 诉讼费备注"]')
      .setValue(' 同源备注 ');
    await flushPromises();
    expect(api.updateFee).toHaveBeenCalledWith('fee-a', {
      expectedVersion: 2,
      note: '同源备注',
    });
    expect(
      (
        wrapper.get('input[aria-label="案件001 诉讼费备注"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('同源备注');
    expect(api.listFees).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case' }),
      expect.anything(),
    );
    expect(wrapper.text()).toContain('淘宝');
    expect(wrapper.text()).not.toContain('TAOBAO');
  });
});

describe('zero amount fee launch handling', () => {
  const zeroFee = {
    id: 'fee-zero',
    caseId: 'case',
    businessNo: 'CASE-ZERO',
    type: '样品费',
    direction: '支出',
    status: '未发起',
    amount: '0.00',
    feeDate: '2026-10-24',
    source: 'auto',
    note: null,
    version: 1,
    proofMaterialId: null,
    proofContentVersionId: null,
    proofOriginalFilename: null,
    defendantNames: [],
    platform: null,
    shopName: null,
    courtCaseNo: null,
  };
  function listResult(items: (typeof zeroFee)[]) {
    const amount = items.some((row) => row.amount !== '0.00')
      ? '12.30'
      : '0.00';
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: 100,
      matchingIds: items.map((row) => row.id),
      matchingSources: items,
      summary: {
        expense: amount,
        income: '0.00',
        pending: amount,
        pendingCount: items.filter((row) => row.status === '未发起').length,
      },
    };
  }

  it('disables batch launch and explains zero-only selection while retaining the row', async () => {
    api.listFees.mockResolvedValue(listResult([zeroFee]));
    const wrapper = render(FeeCenterPanel, { canLaunch: true });
    await flushPromises();

    await wrapper.get('tbody input[type="checkbox"]').setValue(true);

    expect(button(wrapper, '批量发起').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('零元费用仅保留记录，不可发起');
    expect(wrapper.text()).toContain('0.00');
    expect(api.batchFees).not.toHaveBeenCalled();
  });

  it('keeps a mixed request intact, explains skipped zero rows, and disables inline zero launch', async () => {
    const positiveFee = {
      ...zeroFee,
      id: 'fee-positive',
      businessNo: 'CASE-POSITIVE',
      amount: '12.30',
    };
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    api.listFees.mockResolvedValue(listResult([zeroFee, positiveFee]));
    api.batchFees.mockResolvedValue({
      processedIds: ['fee-positive'],
      processedCount: 1,
      amount: '12.30',
    });
    const wrapper = render(FeeCenterPanel, {
      canLaunch: true,
      canUpdate: true,
    });
    await flushPromises();

    const zeroRow = wrapper.findAll('tbody tr')[0]!;
    const zeroStatus = zeroRow.findComponent(ElSelect);
    const launchOption = zeroStatus
      .findAllComponents(ElOption)
      .find((option) => option.props('value') === '发起');
    expect(launchOption?.props('disabled')).toBe(true);
    zeroStatus.vm.$emit('change', '发起');
    await flushPromises();
    expect(api.updateFee).not.toHaveBeenCalled();

    await wrapper.get('thead input[type="checkbox"]').setValue(true);
    await button(wrapper, '批量发起').trigger('click');
    await flushPromises();

    expect(confirm.mock.calls[0]?.[0]).toContain('零元费用将跳过');
    expect(api.batchFees).toHaveBeenCalledWith(
      'launch',
      expect.objectContaining({
        ids: ['fee-zero', 'fee-positive'],
        idempotencyKey: expect.any(String),
      }),
    );
    expect(wrapper.text()).toContain('已选 1 条');
  });
});

describe('stable single fee removal', () => {
  it.each(['single row', 'selected batch'] as const)(
    'does not submit or persist a pending removal when cancelling %s',
    async (entryPoint) => {
      const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      const fee = {
        id: 'cancel-fee',
        caseId: 'case',
        businessNo: 'CASE-CANCEL',
        type: '诉讼费',
        direction: '支出',
        status: '未发起',
        amount: '2.34',
        feeDate: '2026-10-24',
        source: 'manual',
        note: null,
        version: 1,
        proofMaterialId: null,
        proofContentVersionId: null,
        proofOriginalFilename: null,
        defendantNames: [],
        platform: null,
        shopName: null,
        courtCaseNo: null,
      };
      api.listFees.mockResolvedValue({
        items: [fee],
        total: 1,
        page: 1,
        pageSize: 100,
        matchingIds: [fee.id],
        matchingSources: [fee],
        summary: {
          expense: '2.34',
          income: '0.00',
          pending: '0.00',
          pendingCount: 0,
        },
      });
      const wrapper = render(FeeCenterPanel, {
        caseId: 'case',
        canDelete: true,
      });
      await flushPromises();
      await wrapper.get('thead input[type="checkbox"]').setValue(true);
      const storageBefore = { ...globalThis.sessionStorage };
      const removal = button(
        wrapper,
        entryPoint === 'single row' ? '移除费用' : '删除',
      );

      await removal.trigger('click');
      await flushPromises();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0]?.[0]).toContain('诉讼费：2.34 元（未发起）');
      expect(api.batchFees).not.toHaveBeenCalled();
      expect(api.listFees).toHaveBeenCalledTimes(1);
      expect({ ...globalThis.sessionStorage }).toEqual(storageBefore);
      expect(wrapper.text()).toContain('已选 1 条');
      expect(wrapper.get('tbody tr').text()).toContain('2.34');
      expect(wrapper.text()).not.toContain('费用已移除');

      await removal.trigger('click');
      await flushPromises();
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(api.batchFees).not.toHaveBeenCalled();
      expect({ ...globalThis.sessionStorage }).toEqual(storageBefore);
    },
  );
  it('makes the net read-only and confirms each real amount before sending exact original IDs', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const sample = {
      id: 'sample',
      caseId: 'case',
      businessNo: 'CASE-1',
      type: '样品费',
      direction: '支出',
      status: '未发起',
      amount: '100.00',
      feeDate: '2026-10-17',
      source: 'manual',
      note: null,
      version: 1,
      proofMaterialId: 'm1',
      proofContentVersionId: 'cv1',
      proofOriginalFilename: '样品.pdf',
      defendantNames: [],
      platform: null,
      shopName: null,
      courtCaseNo: null,
    };
    const refund = {
      ...sample,
      id: 'refund',
      type: '样品费退款',
      amount: '20.00',
      proofMaterialId: 'm2',
      proofContentVersionId: 'cv2',
      proofOriginalFilename: '退款.pdf',
    };
    const offPage = {
      ...sample,
      id: 'off-page',
      businessNo: 'CASE-2',
      type: '公证费',
      amount: '5.00',
    };
    api.listFees.mockResolvedValue({
      items: [
        {
          ...sample,
          amount: '80.00',
          proofMaterialId: null,
          proofContentVersionId: null,
          proofOriginalFilename: null,
          mergeTypes: ['样品费', '样品费退款'],
          sourceRows: [sample, refund],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
      matchingIds: ['sample', 'refund', 'off-page'],
      matchingSources: [sample, refund, offPage],
      summary: {
        expense: '80.00',
        income: '0.00',
        pending: '0.00',
        pendingCount: 0,
      },
    });
    api.batchFees.mockResolvedValue({
      processedIds: ['sample', 'refund', 'off-page'],
      processedCount: 3,
      amount: '125.00',
    });
    const wrapper = render(FeeCenterPanel, {
      canUpdate: true,
      canLaunch: true,
      canDelete: true,
    });
    await flushPromises();
    const netRow = wrapper.get('tbody tr');
    expect(netRow.text()).toContain('80.00');
    expect(netRow.find('input[type="checkbox"]').exists()).toBe(false);
    expect(netRow.find('input').exists()).toBe(false);
    expect(netRow.text()).not.toContain('移除费用');
    expect(netRow.text()).not.toContain('样品.pdf');
    await button(wrapper, '展开原始费用').trigger('click');
    await flushPromises();
    const originals = wrapper.findAll('tbody tr').slice(1);
    expect(originals).toHaveLength(2);
    expect(originals[0]!.text()).toContain('100.00');
    expect(originals[0]!.text()).toContain('样品.pdf');
    expect(originals[1]!.text()).toContain('20.00');
    expect(originals[1]!.text()).toContain('退款.pdf');
    await wrapper.get('thead input[type="checkbox"]').setValue(true);
    await button(wrapper, '批量发起').trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[0]![0]).toContain('样品费：100.00 元');
    expect(confirm.mock.calls[0]![0]).toContain('样品费退款：20.00 元');
    expect(confirm.mock.calls[0]![0]).toContain('CASE-2 · 公证费：5.00 元');
    expect(api.batchFees).toHaveBeenCalledWith(
      'launch',
      expect.objectContaining({ ids: ['sample', 'refund', 'off-page'] }),
    );
    api.updateFee.mockResolvedValue({ id: 'refund', version: 2 });
    await wrapper
      .get('input[aria-label="CASE-1 样品费退款备注"]')
      .setValue('退款原行备注');
    await flushPromises();
    expect(api.updateFee).toHaveBeenCalledWith('refund', {
      expectedVersion: 1,
      note: '退款原行备注',
    });
    api.updateFeeProof.mockResolvedValue({ id: 'refund', version: 2 });
    const refundRow = () => wrapper.findAll('tbody tr')[2]!;
    await button(refundRow(), '移除凭证').trigger('click');
    await flushPromises();
    expect(api.updateFeeProof).toHaveBeenCalledWith(
      'refund',
      expect.objectContaining({
        expectedVersion: 1,
        materialId: null,
        contentVersionId: null,
      }),
    );
    api.batchFees.mockResolvedValue({
      processedIds: ['refund'],
      processedCount: 1,
      amount: '20.00',
    });
    await button(refundRow(), '移除费用').trigger('click');
    await flushPromises();
    expect(api.batchFees).toHaveBeenLastCalledWith(
      'delete',
      expect.objectContaining({ ids: ['refund'] }),
    );
  });
  it('removes exactly the clicked fee while preserving other selected IDs', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const fee = {
      id: 'fee-a',
      caseId: 'case',
      businessNo: 'CASE-1',
      type: '诉讼费',
      direction: '支出',
      status: '未发起',
      amount: '20.00',
      feeDate: '2026-10-17',
      source: 'manual',
      note: null,
      version: 1,
      proofMaterialId: null,
      proofContentVersionId: null,
      proofOriginalFilename: null,
      defendantNames: [],
      platform: null,
      shopName: null,
      courtCaseNo: null,
    };
    api.listFees.mockResolvedValue({
      items: [fee],
      total: 2,
      page: 1,
      pageSize: 100,
      matchingIds: ['fee-a', 'fee-off-page'],
      matchingSources: [fee, { ...fee, id: 'fee-off-page' }],
      summary: {
        expense: '40.00',
        income: '0.00',
        pending: '0.00',
        pendingCount: 0,
      },
    });
    api.batchFees.mockResolvedValue({
      processedIds: ['fee-a'],
      processedCount: 1,
      amount: '20.00',
    });
    const wrapper = render(FeeCenterPanel, { caseId: 'case', canDelete: true });
    await flushPromises();
    await wrapper.get('thead input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain('已选 2 条');
    await button(wrapper, '移除费用').trigger('click');
    await flushPromises();
    expect(api.batchFees).toHaveBeenCalledWith(
      'delete',
      expect.objectContaining({
        ids: ['fee-a'],
        idempotencyKey: expect.any(String),
      }),
    );
    expect(wrapper.text()).toContain('已选 1 条');
  });
});
