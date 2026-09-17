import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from './CustomerDetailPage.vue';

const api = vi.hoisted(() => ({ getCustomer: vi.fn() }));
vi.mock('../../api/customers', () => api);

const rightsHolderPanel = {
  props: ['customerId', 'customerVersion', 'canEdit'],
  emits: ['version-updated', 'refresh-requested', 'customer-not-found'],
  template:
    '<section data-test="rights-holder-panel" :data-version="customerVersion" :data-can-edit="canEdit" @click="$emit(\'version-updated\', 2)">权利主体面板<button data-test="refresh-requested" @click.stop="$emit(\'refresh-requested\')">刷新</button><button data-test="customer-not-found" @click.stop="$emit(\'customer-not-found\')">客户不存在</button></section>',
};

afterEach(() => vi.clearAllMocks());

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers', component: { template: '<div>客户列表</div>' } },
      { path: '/customers/:id', component: CustomerDetailPage },
    ],
  });
  await router.push('/customers/customer-1');
  await router.isReady();
  const wrapper = mount(CustomerDetailPage, {
    global: {
      plugins: [router],
      stubs: { CustomerRightsHolderPanel: rightsHolderPanel },
    },
  });
  return { router, wrapper };
}

describe('CustomerDetailPage', () => {
  it('shows the draft status and folded shared history', async () => {
    api.getCustomer.mockResolvedValue({
      id: 'customer-1',
      name: '客户甲',
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      category: null,
      region: null,
      admissionContactName: '张三',
      admissionContactPhone: '13800138000',
      admissionContactEmail: null,
      profileStatus: 'draft',
      departmentId: 'department-1',
      responsibleUserId: 'user-1',
      version: 1,
      updatedAt: '2026-09-17T01:00:00.000Z',
      capabilities: { editRoutine: true },
      history: [
        {
          action: 'customer.draft-created',
          actorUserId: 'user-1',
          occurredAt: '2026-09-17T00:59:00.000Z',
        },
      ],
    });
    const { wrapper } = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('草稿');
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.text()).toContain('创建客户草稿');
    expect(wrapper.text()).toContain('准入联系人');
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('13800138000');
    expect(wrapper.get('[data-test="edit-customer"]').text()).toContain(
      '编辑资料',
    );
    expect(
      wrapper.get('[data-test="rights-holder-panel"]').attributes(),
    ).toMatchObject({ 'data-version': '1', 'data-can-edit': 'true' });
    await wrapper.get('[data-test="rights-holder-panel"]').trigger('click');
    expect(
      wrapper
        .get('[data-test="rights-holder-panel"]')
        .attributes('data-version'),
    ).toBe('2');
  });

  it('shows a non-leaking unavailable state for 404', async () => {
    api.getCustomer.mockRejectedValue({ code: 'CUSTOMER_NOT_FOUND' });
    const { wrapper } = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('客户不存在或当前不可访问');
  });

  it('does not render the edit action without the server capability', async () => {
    api.getCustomer.mockResolvedValue({
      id: 'customer-1',
      name: '客户甲',
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      category: null,
      region: null,
      admissionContactName: null,
      admissionContactPhone: null,
      admissionContactEmail: null,
      profileStatus: 'draft',
      departmentId: 'department-1',
      responsibleUserId: 'user-1',
      version: 1,
      updatedAt: '2026-09-17T01:00:00.000Z',
      capabilities: { editRoutine: false },
      history: [],
    });
    const { wrapper } = await mountPage();
    await flushPromises();
    expect(wrapper.find('[data-test="edit-customer"]').exists()).toBe(false);
    expect(
      wrapper
        .get('[data-test="rights-holder-panel"]')
        .attributes('data-can-edit'),
    ).toBe('false');
  });

  it('returns to the customer list when the rights-holder panel loses its customer anchor', async () => {
    api.getCustomer.mockResolvedValue({
      id: 'customer-1',
      name: '客户甲',
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      category: null,
      region: null,
      admissionContactName: null,
      admissionContactPhone: null,
      admissionContactEmail: null,
      profileStatus: 'draft',
      departmentId: 'department-1',
      responsibleUserId: 'user-1',
      version: 1,
      updatedAt: '2026-09-17T01:00:00.000Z',
      capabilities: { editRoutine: true },
      history: [],
    });
    const { router, wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('[data-test="customer-not-found"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/customers');
  });

  it('returns to the customer list when a version-conflict refresh finds no customer', async () => {
    api.getCustomer
      .mockResolvedValueOnce({
        id: 'customer-1',
        name: '客户甲',
        customerType: null,
        identityType: null,
        identityNumber: null,
        issuingCountryOrRegion: null,
        category: null,
        region: null,
        admissionContactName: null,
        admissionContactPhone: null,
        admissionContactEmail: null,
        profileStatus: 'draft',
        departmentId: 'department-1',
        responsibleUserId: 'user-1',
        version: 1,
        updatedAt: '2026-09-17T01:00:00.000Z',
        capabilities: { editRoutine: true },
        history: [],
      })
      .mockRejectedValueOnce({ code: 'CUSTOMER_NOT_FOUND' });
    const { router, wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('[data-test="refresh-requested"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/customers');
  });
});
