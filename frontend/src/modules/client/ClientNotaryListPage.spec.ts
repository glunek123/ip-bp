import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import ClientNotaryListPage from './ClientNotaryListPage.vue';

const api = vi.hoisted(() => ({ listClientNotaryMatters: vi.fn() }));
vi.mock('../../api/client-notary', () => api);

describe('ClientNotaryListPage', () => {
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
      ],
    });
    await router.push('/client/notary-matters');
    const wrapper = mount(ClientNotaryListPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('待出证');
    expect(wrapper.text()).toContain('待退货');
  });
});
