import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReportDistributionsPanel, {
  type ReportDistributionsView,
} from './ReportDistributionsPanel.vue';

const sample = (): ReportDistributionsView => ({
  totalCases: 10,
  types: [
    { value: 'CIVIL', count: 7 },
    { value: null, count: 3 },
  ],
  platforms: [
    { value: 'JD', count: 6 },
    { value: null, count: 4 },
  ],
  courts: [
    { id: 'court-1', name: '合成法院', count: 5 },
    { id: 'court-2', name: '合成法院', count: 3 },
  ],
  unrecordedCourtCases: 2,
});
const mountView = (view: ReportDistributionsView | null = sample()) =>
  mount(ReportDistributionsPanel, { props: { view } });

describe('pure report distributions', () => {
  it('renders formal platform codes with existing Chinese labels', () => {
    const view = sample();
    view.platforms = [
      { value: 'JD', count: 6 },
      { value: 'TMALL', count: 4 },
    ];
    const wrapper = mountView(view);
    expect(
      wrapper
        .get('[data-test="report-distribution-platforms"]')
        .findAll('li')
        .map((row) => row.text()),
    ).toEqual(['京东6 件', '天猫4 件']);
    expect(wrapper.text()).not.toContain('JD');
    expect(wrapper.text()).not.toContain('TMALL');
  });
  it('renders the three approved bar lists with exact counts and explicit unknown groups', () => {
    const wrapper = mountView();
    expect(wrapper.findAll('h2').map((item) => item.text())).toEqual([
      '平台分布',
      '案件类型分布',
      '立案法院 TOP 5',
    ]);
    const platforms = wrapper.get(
      '[data-test="report-distribution-platforms"]',
    );
    expect(platforms.findAll('li').map((row) => row.text())).toEqual([
      '京东6 件',
      '未登记4 件',
    ]);
    const types = wrapper.get('[data-test="report-distribution-types"]');
    expect(types.findAll('li').map((row) => row.text())).toEqual([
      '民事7 件',
      '未登记3 件',
    ]);
    expect(wrapper.findAll('.distribution-track')).toHaveLength(6);
    expect(
      platforms.findAll('.distribution-track span')[0]?.attributes('style'),
    ).toBe('width: 100%;');
    expect(
      platforms.findAll('.distribution-track span')[1]?.attributes('style'),
    ).toContain('66.666');
    expect(wrapper.text()).toContain('不表示占全部案件的比例');
    expect(
      wrapper
        .findAll('.distribution-track')
        .every((item) => item.attributes('aria-hidden') === 'true'),
    ).toBe(true);
  });
  it('retains different court IDs with identical names and reports limited coverage', () => {
    const wrapper = mountView();
    const courts = wrapper.get('[data-test="report-distribution-courts"]');
    expect(
      courts
        .findAll('li')
        .map((row) => row.attributes('data-distribution-key')),
    ).toEqual(['court-1', 'court-2']);
    expect(courts.findAll('li').map((row) => row.text())).toEqual([
      '合成法院5 件',
      '合成法院3 件',
    ]);
    expect(wrapper.get('[data-test="report-court-coverage"]').text()).toContain(
      '未登记法院 2 件',
    );
    expect(wrapper.get('[data-test="report-court-coverage"]').text()).toContain(
      '前 5 项不代表全部法院',
    );
  });
  it('distinguishes unread projection from a real empty department without fabricated zero rows', () => {
    const unread = mountView(null);
    expect(
      unread.findAll('[role="status"]').map((item) => item.text()),
    ).toEqual(['统计未读取', '统计未读取', '统计未读取']);
    expect(unread.findAll('li')).toHaveLength(0);
    const empty = mountView({
      totalCases: 0,
      types: [],
      platforms: [],
      courts: [],
      unrecordedCourtCases: 0,
    });
    expect(empty.findAll('[role="status"]').map((item) => item.text())).toEqual(
      ['暂无数据', '暂无数据', '暂无数据'],
    );
    expect(empty.findAll('li')).toHaveLength(0);
    expect(empty.findAll('.distribution-track')).toHaveLength(0);
  });
  it('shows all-unknown cases as unknown counts rather than an empty department', () => {
    const wrapper = mountView({
      totalCases: 3,
      types: [{ value: null, count: 3 }],
      platforms: [{ value: null, count: 3 }],
      courts: [],
      unrecordedCourtCases: 3,
    });
    expect(wrapper.findAll('li').map((row) => row.text())).toEqual([
      '未登记3 件',
      '未登记3 件',
    ]);
    expect(wrapper.text()).toContain('暂无已登记法院');
    expect(wrapper.text()).not.toContain('暂无数据');
    expect(wrapper.get('[data-test="report-court-coverage"]').text()).toContain(
      '未登记法院 3 件',
    );
  });
  it('escapes server labels and keeps long labels as plain text', () => {
    const view = sample();
    view.platforms = [{ value: 'JD', count: 10 }];
    view.courts = [
      {
        id: 'court-1',
        name:
          '<img src=x onerror=alert(1)>' +
          '<script>synthetic</script>'.repeat(20),
        count: 8,
      },
    ];
    const wrapper = mountView(view);
    expect(wrapper.findAll('img,script')).toHaveLength(0);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.text()).toContain('<script>synthetic</script>'.repeat(20));
  });
  it('keeps formal OTHER separate from the unrecorded null group', () => {
    const view = sample();
    view.platforms = [
      { value: 'OTHER', count: 7 },
      { value: null, count: 3 },
    ];
    const rows = mountView(view)
      .get('[data-test="report-distribution-platforms"]')
      .findAll('li');
    expect(rows.map((row) => row.attributes('data-distribution-key'))).toEqual([
      '"OTHER"',
      'null',
    ]);
  });
  it('replaces all rows immediately when the host clears or switches the projection', async () => {
    const wrapper = mountView();
    await wrapper.setProps({ view: null });
    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('京东');
    await wrapper.setProps({
      view: {
        totalCases: 1,
        types: [{ value: 'NOTARIZATION', count: 1 }],
        platforms: [{ value: 'TMALL', count: 1 }],
        courts: [],
        unrecordedCourtCases: 1,
      },
    });
    expect(wrapper.text()).toContain('公证');
    expect(wrapper.text()).toContain('天猫');
    expect(wrapper.text()).not.toContain('合成法院');
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'does not render unsafe count %s as a number or bar',
    (count) => {
      const view = sample();
      view.platforms = [{ value: 'JD', count }];
      const wrapper = mountView(view);
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(3);
      expect(wrapper.findAll('li')).toHaveLength(0);
      expect(wrapper.findAll('[style]')).toHaveLength(0);
    },
  );
  it.each([
    { platforms: [{ value: '', count: 10 }] },
    { platforms: [{ value: '   ', count: 10 }] },
    { types: [{ value: 'OTHER', count: 10 }] },
    {
      types: [
        { value: null, count: 7 },
        { value: null, count: 3 },
      ],
    },
    {
      courts: [
        { id: 'same', name: '甲', count: 1 },
        { id: 'same', name: '乙', count: 1 },
      ],
    },
    {
      courts: Array.from({ length: 6 }, (_, i) => ({
        id: String(i),
        name: '合成法院',
        count: 1,
      })),
    },
    { courts: [{ id: 'court', name: '', count: 8 }] },
    { unrecordedCourtCases: -1 },
  ])(
    'rejects invalid labels and group projections %# without zero fallbacks',
    (patch) => {
      const wrapper = mountView({
        ...sample(),
        ...patch,
      } as ReportDistributionsView);
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(3);
      expect(wrapper.findAll('li')).toHaveLength(0);
    },
  );
});
