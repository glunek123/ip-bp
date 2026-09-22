import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerListPage from './CustomerListPage.vue';

const api = vi.hoisted(() => ({ listCustomers: vi.fn() }));
vi.mock('../../api/customers', () => api);

afterEach(() => vi.clearAllMocks());

const summary = {
  id: 'customer-1',
  name: '客户甲',
  customerType: null,
  identityType: null,
  identityNumber: null,
  issuingCountryOrRegion: null,
  category: null,
  region: null,
  profileStatus: 'draft' as const,
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-17T01:00:00.000Z',
};

describe('CustomerListPage', () => {
  it('separates loading and empty states', async () => {
    let resolve!: (value: unknown) => void;
    api.listCustomers.mockReturnValue(new Promise((done) => (resolve = done)));
    const wrapper = mount(CustomerListPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(wrapper.text()).toContain('正在读取客户');
    resolve({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('还没有客户记录');
    expect(wrapper.find('.workspace-header').exists()).toBe(false);
    expect(wrapper.find('.workspace-shell').exists()).toBe(false);
    expect(wrapper.find('.page-view').exists()).toBe(true);
  });

  it('shows a readable failure and retries', async () => {
    api.listCustomers
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        items: [summary],
        total: 1,
        page: 1,
        pageSize: 20,
        capabilities: { createDraft: true },
      });
    const wrapper = mount(CustomerListPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('客户列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
  });

  it('hides creation when the server does not grant the action', async () => {
    api.listCustomers.mockResolvedValue({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const wrapper = mount(CustomerListPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.find('[data-test="create-customer"]').exists()).toBe(false);
  });

  it('shows the admitted status returned by the server', async () => {
    api.listCustomers.mockResolvedValue({
      items: [{ ...summary, profileStatus: 'admitted' }],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    const wrapper = mount(CustomerListPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    expect(wrapper.get('.status-chip').text()).toBe('已准入');
  });
});
