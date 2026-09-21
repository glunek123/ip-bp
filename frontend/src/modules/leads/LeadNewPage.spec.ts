import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeadNewPage from './LeadNewPage.vue';

const leadApi = vi.hoisted(() => ({
  getLeadFormContext: vi.fn(),
  createLead: vi.fn(),
}));
const materialApi = vi.hoisted(() => ({ uploadMaterialFile: vi.fn() }));
vi.mock('../../api/leads', () => leadApi);
vi.mock('../../api/materials', () => materialApi);

const context = {
  customers: [
    {
      id: 'customer-1',
      name: '客户甲',
      rightsHolders: [{ id: 'holder-1', name: '主体甲' }],
    },
  ],
  dictionaries: {
    caseTypes: [{ value: 'CIVIL', label: '民事' }],
    infringementTypes: [{ value: 'TRADEMARK', label: '商标权' }],
    sources: [{ value: 'ONLINE', label: '线上' }],
    platforms: { ONLINE: [{ value: 'TAOBAO', label: '淘宝' }], OFFLINE: [] },
  },
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads/new', component: LeadNewPage },
      { path: '/leads/:id', component: { template: '<div>详情</div>' } },
      { path: '/leads', component: { template: '<div>列表</div>' } },
    ],
  });
  await router.push('/leads/new');
  await router.isReady();
  const wrapper = mount(LeadNewPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

async function submitValid(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('select[name="customerId"]').setValue('customer-1');
  await wrapper.get('select[name="rightsHolderId"]').setValue('holder-1');
  await wrapper.get('select[name="caseType"]').setValue('CIVIL');
  await wrapper.get('input[value="TRADEMARK"]').setValue(true);
  await wrapper.get('select[name="source"]').setValue('ONLINE');
  await wrapper.get('select[name="platform"]').setValue('TAOBAO');
  await wrapper.get('input[name="foundAt"]').setValue('2026-09-21T12:00');
  await wrapper.get('input[name="shopName"]').setValue('测试店铺');
  await wrapper.get('input[name="productTitle-0"]').setValue('商品甲');
  await wrapper.get('input[name="quantity-0"]').setValue('1');
  await wrapper.get('input[name="unitPrice-0"]').setValue('1.00');
  await wrapper.get('input[name="commentCount-0"]').setValue('0');
  await wrapper.get('form').trigger('submit');
}

beforeEach(() => {
  vi.resetAllMocks();
  leadApi.getLeadFormContext.mockResolvedValue(context);
});

describe('LeadNewPage', () => {
  it('prevents duplicate submits and reuses one idempotency key', async () => {
    let reject!: (reason?: unknown) => void;
    leadApi.createLead.mockImplementation(
      () => new Promise((_resolve, fail) => (reject = fail)),
    );
    const { wrapper } = await mountPage();
    await submitValid(wrapper);
    await wrapper.get('form').trigger('submit');
    expect(leadApi.createLead).toHaveBeenCalledTimes(1);
    reject(new Error('failed'));
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    expect(leadApi.createLead).toHaveBeenCalledTimes(2);
    expect(leadApi.createLead.mock.calls[1]?.[1]).toBe(
      leadApi.createLead.mock.calls[0]?.[1],
    );
  });

  it('reuses the reserved owner and does not upload successful files again on retry', async () => {
    const first = new File(['a'], 'a.png', { type: 'image/png' });
    const second = new File(['b'], 'b.png', { type: 'image/png' });
    materialApi.uploadMaterialFile
      .mockResolvedValueOnce({
        contentVersionId: 'version-a',
        reservedOwnerId: 'reserved-lead',
        materialId: 'm-a',
        originalFilename: 'a.png',
        purpose: 'LEAD_SCREENSHOT',
        mimeType: 'image/png',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      })
      .mockRejectedValueOnce(new Error('storage'))
      .mockResolvedValueOnce({
        contentVersionId: 'version-b',
        reservedOwnerId: 'reserved-lead',
        materialId: 'm-b',
        originalFilename: 'b.png',
        purpose: 'LEAD_SCREENSHOT',
        mimeType: 'image/png',
        sizeBytes: 1,
        sha256: 'b'.repeat(64),
      });
    leadApi.createLead.mockResolvedValue({ id: 'lead-1' });
    const { wrapper, router } = await mountPage();
    const input = wrapper.get('input[name="screenshots"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [first, second],
    });
    await input.trigger('change');
    await submitValid(wrapper);
    await flushPromises();
    expect(leadApi.createLead).not.toHaveBeenCalled();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(materialApi.uploadMaterialFile).toHaveBeenCalledTimes(3);
    expect(materialApi.uploadMaterialFile.mock.calls[1]?.[0]).toMatchObject({
      ownerId: 'reserved-lead',
    });
    expect(materialApi.uploadMaterialFile.mock.calls[2]?.[0]).toMatchObject({
      ownerId: 'reserved-lead',
    });
    expect(leadApi.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        reservedLeadId: 'reserved-lead',
        leadScreenshotContentVersionIds: ['version-a', 'version-b'],
      }),
      expect.any(String),
    );
    expect(router.currentRoute.value.path).toBe('/leads/lead-1');
  });
});
