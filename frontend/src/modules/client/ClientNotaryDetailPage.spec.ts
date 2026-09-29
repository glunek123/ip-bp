import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import ClientNotaryDetailPage from './ClientNotaryDetailPage.vue';

const api = vi.hoisted(() => ({ getClientNotaryMatter: vi.fn() }));
vi.mock('../../api/client-notary', () => api);
vi.mock('../../api/materials', () => ({ downloadMaterialVersion: vi.fn() }));

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/notary-matters/:id', component: ClientNotaryDetailPage },
      { path: '/client/notary-matters', component: { template: '<div />' } },
    ],
  });
  await router.push('/client/notary-matters/matter-1');
  const wrapper = mount(ClientNotaryDetailPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe('ClientNotaryDetailPage issuance history', () => {
  it('shows the minimal return archive summary without internal amount fields', async () => {
    api.getClientNotaryMatter.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'ARCHIVED',
      version: 6,
      createdAt: '2026-09-24T01:00:00.000Z',
      sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
      selectedProducts: [],
      opening: {
        recordedAt: '2026-09-24T02:00:00.000Z',
        photos: [
          {
            materialId: 'photo-1',
            contentVersionId: 'photo-v1',
            originalFilename: '开箱.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
      issuanceDecision: {
        decision: 'NO_ISSUE',
        decidedAt: '2026-09-25T04:00:00.000Z',
      },
      returnArchive: {
        returnChoice: 'REFUND_ONLY',
        archiveReason: '商家同意退款，无需寄回',
        archivedAt: '2026-09-25T05:00:00.000Z',
      },
      capabilities: { reviewOpening: false },
    });
    const wrapper = await mountPage();
    const record = wrapper.get('[data-test="client-return-archive-record"]');
    expect(record.text()).toContain('不寄回商品，只退款');
    expect(record.text()).toContain('商家同意退款，无需寄回');
    expect(record.text()).toContain('归档时间');
    expect(record.text()).not.toContain('收款方');
    expect(record.text()).not.toContain('金额');
    expect(wrapper.find('[data-test="return-archive-submit"]').exists()).toBe(
      false,
    );
  });

  it('shows only the safe historical issuance summary without offering issuance actions', async () => {
    api.getClientNotaryMatter.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'WAITING_CERTIFICATE',
      version: 5,
      createdAt: '2026-09-24T01:00:00.000Z',
      sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
      selectedProducts: [],
      opening: {
        recordedAt: '2026-09-24T02:00:00.000Z',
        photos: [
          {
            materialId: 'photo-1',
            contentVersionId: 'photo-v1',
            originalFilename: '开箱.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
      issuanceDecision: {
        decision: 'ISSUE',
        decidedAt: '2026-09-24T04:00:00.000Z',
      },
      capabilities: { reviewOpening: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('待出证');
    expect(
      wrapper.get('[data-test="client-issuance-decision-record"]').text(),
    ).toContain('ISSUE');
    expect(
      wrapper.get('[data-test="client-issuance-decision-record"]').text(),
    ).not.toContain('决定人');
    expect(
      wrapper.find('[data-test="issuance-decision-submit"]').exists(),
    ).toBe(false);
  });
});
