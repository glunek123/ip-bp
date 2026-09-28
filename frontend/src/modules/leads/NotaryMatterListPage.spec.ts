import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotaryMatterListPage from './NotaryMatterListPage.vue';

const api = vi.hoisted(() => ({ listNotaryMatters: vi.fn() }));
vi.mock('../../api/notary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/notary')>()),
  listNotaryMatters: api.listNotaryMatters,
}));

const result = {
  items: [
    {
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'PENDING_EVIDENCE',
      createdAt: '2026-09-24T01:00:00.000Z',
      sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
      notaryOffice: { id: 'office-1', name: '测试公证处' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  counts: {
    PENDING_EVIDENCE: 1,
    WAITING_UNBOX: 0,
    UNBOX_REVIEW: 0,
    ISSUANCE_DECISION: 0,
    ARCHIVED: 0,
  },
};

async function mountPage(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-matters', component: NotaryMatterListPage },
      { path: '/notary-matters/:id', component: { template: '<div />' } },
      { path: '/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(NotaryMatterListPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrapper, router };
}

afterEach(() => vi.resetAllMocks());

describe('NotaryMatterListPage', () => {
  it('shows each matter separately and preserves its source lead link', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'PENDING_EVIDENCE',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('NT-001');
    expect(wrapper.get('[data-test="matter-link"]').attributes('href')).toBe(
      '/notary-matters/matter-1',
    );
    expect(
      wrapper.get('[data-test="source-lead-link"]').attributes('href'),
    ).toBe('/leads/lead-1');
  });

  it('does not disguise a failed query as an empty list', async () => {
    api.listNotaryMatters
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result);
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.text()).toContain('公证事项列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="matter-row"]')).toHaveLength(1);
  });

  it('keeps the stage filter while paging through matters', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, total: 21, page: 1 });
    const { wrapper, router } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      stage: 'PENDING_EVIDENCE',
      page: '2',
    });
    expect(api.listNotaryMatters).toHaveBeenLastCalledWith(
      2,
      20,
      expect.any(Object),
      'PENDING_EVIDENCE',
    );
  });

  it('filters and labels the newly added archived stage', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], stage: 'ARCHIVED' }],
      counts: { ...result.counts, ARCHIVED: 1 },
    });
    const { wrapper } = await mountPage('/notary-matters?stage=ARCHIVED');
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'ARCHIVED',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('已归档');
  });
});
