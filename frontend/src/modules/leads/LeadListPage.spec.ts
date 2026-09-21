import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LeadListPage from './LeadListPage.vue';

const api = vi.hoisted(() => ({ listLeads: vi.fn() }));
vi.mock('../../api/leads', () => api);

const result = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  counts: {
    WAITING_PUSH: 7,
    WAITING_REVIEW: 3,
    WAITING_EVIDENCE_DECISION: 2,
    ARCHIVED: 1,
  },
  capabilities: { create: true },
};

afterEach(() => vi.resetAllMocks());

describe('LeadListPage', () => {
  it('shows exactly four workflow counters and a separate empty state', async () => {
    api.listLeads.mockResolvedValue(result);
    const wrapper = mount(LeadListPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    expect(wrapper.findAll('[data-test="lead-counter"]')).toHaveLength(4);
    expect(wrapper.text()).toContain('待推送7');
    expect(wrapper.text()).toContain('线索待审核3');
    expect(wrapper.text()).toContain('线索待确认2');
    expect(wrapper.text()).toContain('线索已归档1');
    expect(wrapper.text()).toContain('还没有线索记录');
  });

  it('keeps failure distinct from empty and retries', async () => {
    api.listLeads
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...result,
        items: [
          {
            id: 'lead-1',
            businessNo: 'LD-20260921-001',
            shopName: '测试店铺',
            status: 'WAITING_PUSH',
            updatedAt: '2026-09-21T04:00:00Z',
          },
        ],
        total: 1,
      });
    const wrapper = mount(LeadListPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('线索列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('LD-20260921-001');
  });
});
