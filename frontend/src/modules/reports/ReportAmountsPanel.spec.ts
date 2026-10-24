import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReportAmountsPanel, {
  type ReportAmountsView,
} from './ReportAmountsPanel.vue';

const sample = (): ReportAmountsView => ({
  totalCases: 10,
  archivedCases: 3,
  knownAmountCases: 7,
  unknownAmountCases: 3,
  cumulativeAmountText: '1700000.00',
  closureRatePercentText: '30',
  buckets: [
    { key: 'LT_100000', count: 2 },
    { key: '100000_TO_300000', count: 3 },
    { key: '300000_TO_500000', count: 1 },
    { key: 'GTE_500000', count: 1 },
  ],
});
const render = (view: ReportAmountsView | null = sample()) =>
  mount(ReportAmountsPanel, { props: { view } });

describe('approved money and closure presentation seam', () => {
  it('uses Demo names and exact host amount/rate strings without recomputing them', () => {
    const wrapper = render();
    expect(wrapper.findAll('h2').map((row) => row.text())).toEqual([
      '累计标的额',
      '结案率',
      '标的额区间分布',
    ]);
    expect(wrapper.get('[data-test="report-cumulative-decimal"]').text()).toBe(
      '1700000.00',
    );
    expect(wrapper.get('[data-test="report-closure-percent"]').text()).toBe(
      '30 %',
    );
    expect(wrapper.get('[data-test="report-closure-rate"]').text()).toContain(
      '已归档 3 / 全部 10 件',
    );
    expect(wrapper.text()).not.toContain('归档率');
    expect(wrapper.text()).toContain('未知金额不按 0 元计算');
    expect(wrapper.text()).toContain('条长比较件数，非占比。');
  });
  it.each(['0.00', '900719925474099312345678901234567890.01'])(
    'preserves precise total %s without Number conversion',
    (amount) => {
      const wrapper = render({ ...sample(), cumulativeAmountText: amount });
      expect(
        wrapper.get('[data-test="report-cumulative-decimal"]').text(),
      ).toBe(amount);
    },
  );
  it('retains host percentage precision without choosing a new rounding policy', () => {
    const wrapper = render({ ...sample(), closureRatePercentText: '30.0000' });
    expect(wrapper.get('[data-test="report-closure-percent"]').text()).toBe(
      '30.0000 %',
    );
  });
  it('renders fixed Demo bucket labels and exposes inclusive/exclusive boundaries', () => {
    const wrapper = render();
    expect(wrapper.findAll('li .bucket-row').map((row) => row.text())).toEqual([
      '10 万以下2 件',
      '10-30 万3 件',
      '30-50 万1 件',
      '50 万以上1 件',
    ]);
    expect(wrapper.findAll('li').map((row) => row.attributes('title'))).toEqual(
      [
        '0 元（含）至 10 万元（不含）',
        '10 万元（含）至 30 万元（不含）',
        '30 万元（含）至 50 万元（不含）',
        '50 万元（含）以上',
      ],
    );
    expect(
      wrapper.get('[data-test="report-amount-coverage"]').text(),
    ).toContain('已知金额 7 件；未知金额 3 件，未纳入分档');
    expect(wrapper.findAll('.bucket-track span')[1]?.attributes('style')).toBe(
      'width: 100%;',
    );
  });
  it('includes known zero in the first bucket while retaining other real zero counts', () => {
    const view = sample();
    view.totalCases = 1;
    view.archivedCases = 0;
    view.knownAmountCases = 1;
    view.unknownAmountCases = 0;
    view.cumulativeAmountText = '0.00';
    view.closureRatePercentText = '0';
    view.buckets = view.buckets.map((row, i) => ({
      ...row,
      count: i === 0 ? 1 : 0,
    }));
    const wrapper = render(view);
    expect(wrapper.get('[data-test="report-cumulative-decimal"]').text()).toBe(
      '0.00',
    );
    expect(
      wrapper.findAll('li .bucket-count').map((row) => row.text()),
    ).toEqual(['1 件', '0 件', '0 件', '0 件']);
    expect(wrapper.get('[data-test="report-closure-percent"]').text()).toBe(
      '0 %',
    );
  });
  it('distinguishes all-unknown amounts from no cases without fabricating total0 or first-bucket rows', () => {
    const view = sample();
    view.knownAmountCases = 0;
    view.unknownAmountCases = 10;
    view.cumulativeAmountText = null;
    view.buckets = view.buckets.map((row) => ({ ...row, count: 0 }));
    const wrapper = render(view);
    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(wrapper.text()).toContain('暂无已知标的额');
    expect(
      wrapper.get('[data-test="report-amount-coverage"]').text(),
    ).toContain('未知金额 10 件，未纳入分档');
    expect(
      wrapper.find('[data-test="report-cumulative-decimal"]').exists(),
    ).toBe(false);
    expect(wrapper.get('[data-test="report-closure-percent"]').text()).toBe(
      '30 %',
    );
  });
  it('shows no-data rate for zero cases and keeps unread separate', () => {
    const view = sample();
    Object.assign(view, {
      totalCases: 0,
      archivedCases: 0,
      knownAmountCases: 0,
      unknownAmountCases: 0,
      cumulativeAmountText: null,
      closureRatePercentText: null,
    });
    view.buckets = view.buckets.map((row) => ({ ...row, count: 0 }));
    const wrapper = render(view);
    expect(wrapper.findAll('[role="status"]').map((row) => row.text())).toEqual(
      ['暂无数据', '暂无数据', '暂无数据'],
    );
    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(
      render(null)
        .findAll('[role="status"]')
        .map((row) => row.text()),
    ).toEqual(['统计未读取', '统计未读取', '统计未读取']);
  });
  it('clears amounts/rate/counts when the host invalidates the snapshot', async () => {
    const wrapper = render();
    await wrapper.setProps({ view: null });
    expect(
      wrapper.find('[data-test="report-cumulative-decimal"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-test="report-closure-percent"]').exists()).toBe(
      false,
    );
    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('1700000.00');
  });
  it.each([
    { cumulativeAmountText: '1e6' },
    { cumulativeAmountText: '01.00' },
    { cumulativeAmountText: '-1.00' },
    { cumulativeAmountText: '<script>unsafe</script>' },
    { closureRatePercentText: '101' },
    { closureRatePercentText: '-1' },
    { closureRatePercentText: 'Infinity' },
    { closureRatePercentText: '<img src=x>' },
    { unknownAmountCases: 0 },
    { archivedCases: 11 },
    { totalCases: Number.MAX_SAFE_INTEGER + 1 },
    { buckets: [{ key: 'LT_100000', count: 7 }] },
  ])(
    'rejects malformed or inconsistent injected projection %# without fake numbers',
    (patch) => {
      const wrapper = render({ ...sample(), ...patch } as ReportAmountsView);
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(3);
      expect(wrapper.findAll('li')).toHaveLength(0);
      expect(
        wrapper.find('[data-test="report-cumulative-decimal"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="report-closure-percent"]').exists(),
      ).toBe(false);
      expect(wrapper.findAll('script,img')).toHaveLength(0);
    },
  );
});
