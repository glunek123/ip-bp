import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import ClientNotaryListPage from './ClientNotaryListPage.vue';

const api = vi.hoisted(() => ({ listClientNotaryMatters: vi.fn() }));
vi.mock('../../api/client-notary', () => api);

describe('ClientNotaryListPage', () => {
  it('shows a specific heading only when the source-lead scope adds context', async () => {
    api.listClientNotaryMatters.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/client/notary-matters', component: ClientNotaryListPage },
      ],
    });
    await router.push('/client/notary-matters?sourceLeadId=lead-1');
    const wrapper = mount(ClientNotaryListPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('该线索的公证批次');
    expect(wrapper.text()).toContain('查看该线索的全部公证批次及处理结果。');
    wrapper.unmount();
  });

  it('labels both issuance outcomes in historical list rows', async () => {
    api.listClientNotaryMatters.mockResolvedValue({
      items: [
        {
          id: 'matter-1',
          businessNo: 'NT-001',
          stage: 'WAITING_CERTIFICATE',
          version: 5,
          createdAt: '2026-09-24T01:00:00.000Z',
          sourceLeadBusinessNo: 'LD-001',
        },
        {
          id: 'matter-2',
          businessNo: 'NT-002',
          stage: 'WAITING_RETURN',
          version: 5,
          createdAt: '2026-09-24T01:00:00.000Z',
          sourceLeadBusinessNo: 'LD-002',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/client/notary-matters', component: ClientNotaryListPage },
        {
          path: '/client/notary-matters/:id',
          component: { template: '<div />' },
        },
      ],
    });
    await router.push('/client/notary-matters?page=2');
    const wrapper = mount(ClientNotaryListPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('待出证');
    expect(wrapper.text()).toContain('待退货');
    expect(wrapper.get('h1.sr-only').text()).toBe('公证审核');
    const href = wrapper.get('[data-test="client-notary-row"] a').attributes('href')!;
    expect(new URL(href, 'http://local').pathname).toBe('/client/notary-matters/matter-1');
    expect(new URL(href, 'http://local').searchParams.get('returnTo')).toBe('/client/notary-matters?page=2');
    await wrapper.get('[data-test="client-notary-row"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(
      '/client/notary-matters/matter-1',
    );
    expect(router.currentRoute.value.query.returnTo).toBe(
      '/client/notary-matters?page=2',
    );
    wrapper.unmount();
  });
});
