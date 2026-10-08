import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from './CustomerDetailPage.vue';

const api = vi.hoisted(() => ({ getCustomer: vi.fn() }));
vi.mock('../../api/customers', () => api);

const rightsHolderPanel = {
  name: 'CustomerRightsHolderPanel',
  props: ['customerId', 'customerVersion', 'canEdit'],
  emits: ['version-updated', 'refresh-requested', 'customer-not-found'],
  template:
    '<section data-test="rights-holder-panel" :data-version="customerVersion" :data-can-edit="canEdit" @click="$emit(\'version-updated\', customerId, 2)">权利主体面板<button data-test="refresh-requested" @click.stop="$emit(\'refresh-requested\', customerId)">刷新</button><button data-test="customer-not-found" @click.stop="$emit(\'customer-not-found\', customerId)">客户不存在</button></section>',
};

const admissionPanel = {
  props: ['customer'],
  emits: ['admitted', 'customer-refreshed', 'customer-not-found'],
  template:
    '<section data-test="admission-panel" :data-version="customer.version"><button data-test="admitted" @click="$emit(\'admitted\', { ...customer, profileStatus: \'admitted\', admittedAt: \'2026-09-21T03:00:00.000Z\', version: customer.version + 1, capabilities: { ...customer.capabilities, admit: false } })">准入完成</button></section>',
};

const accountPanel = {
  template:
    '<section data-test="account-panel"><label>账号草稿<input data-test="account-draft" /></label></section>',
};

afterEach(() => vi.resetAllMocks());

async function mountPage(customerId = 'customer-1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers', component: { template: '<div>客户列表</div>' } },
      { path: '/customers/:id', component: CustomerDetailPage },
    ],
  });
  await router.push(`/customers/${customerId}`);
  await router.isReady();
  const wrapper = mount(CustomerDetailPage, {
    global: {
      plugins: [router],
      stubs: {
        CustomerRightsHolderPanel: rightsHolderPanel,
        CustomerAdmissionPanel: admissionPanel,
        CustomerAccountPanel: accountPanel,
      },
    },
  });
  return { router, wrapper };
}

function customerRecord(id: string, name: string) {
  return {
    id,
    name,
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
    capabilities: { editRoutine: true, admit: true },
    history: [],
  };
}

describe('CustomerDetailPage', () => {
  it('organizes customer details into accessible tabs and preserves basic-info drafts', async () => {
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
      admissionContactPhone: null,
      admissionContactEmail: null,
      profileStatus: 'draft',
      departmentId: 'department-1',
      responsibleUserId: 'user-1',
      version: 1,
      updatedAt: '2026-09-17T01:00:00.000Z',
      capabilities: { editRoutine: true, admit: true },
      history: [],
    });
    const { wrapper } = await mountPage();
    await flushPromises();

    const basicTab = wrapper.get(
      '[role="tab"][aria-controls="customer-tab-basic"]',
    );
    const assetsTab = wrapper.get(
      '[role="tab"][aria-controls="customer-tab-assets"]',
    );
    const settlementTab = wrapper.get(
      '[role="tab"][aria-controls="customer-tab-settlements"]',
    );
    expect(basicTab.text()).toBe('基本信息');
    expect(basicTab.attributes('aria-selected')).toBe('true');
    expect(
      wrapper.get('[role="tabpanel"][id="customer-tab-basic"]').text(),
    ).toContain('客户资料');

    await wrapper.get('[data-test="account-draft"]').setValue('未提交草稿');
    await assetsTab.trigger('click');
    expect(assetsTab.attributes('aria-selected')).toBe('true');
    expect(
      wrapper.get('[role="tabpanel"][id="customer-tab-assets"]').text(),
    ).toContain('权利资产功能尚未交付');
    expect(
      wrapper.get('[role="tabpanel"][id="customer-tab-basic"]').isVisible(),
    ).toBe(false);

    await settlementTab.trigger('click');
    const settlementPanel = wrapper.get(
      '[role="tabpanel"][id="customer-tab-settlements"]',
    );
    expect(settlementPanel.text()).toContain('结算记录尚未接通人工台账');
    expect(settlementPanel.text()).not.toMatch(/[¥￥]\s*\d|\d+(?:\.\d+)?\s*元/);
    expect(settlementPanel.find('button').exists()).toBe(false);

    await basicTab.trigger('click');
    expect(
      (wrapper.get('[data-test="account-draft"]').element as HTMLInputElement)
        .value,
    ).toBe('未提交草稿');
  });

  it('ignores a late response after switching from customer A to customer B', async () => {
    let resolveCustomerA!: (customer: { id: string; name: string }) => void;
    api.getCustomer.mockImplementation((id: string) => {
      if (id === 'customer-a') {
        return new Promise((resolve) => {
          resolveCustomerA = resolve;
        });
      }
      return Promise.resolve({
        id: 'customer-b',
        name: '客户乙',
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
        capabilities: { editRoutine: true, admit: true },
        history: [],
      });
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/customers/:id', component: CustomerDetailPage }],
    });
    await router.push('/customers/customer-a');
    await router.isReady();
    const wrapper = mount(CustomerDetailPage, {
      global: {
        plugins: [router],
        stubs: {
          CustomerRightsHolderPanel: rightsHolderPanel,
          CustomerAdmissionPanel: admissionPanel,
          CustomerAccountPanel: accountPanel,
        },
      },
    });

    await router.push('/customers/customer-b');
    await flushPromises();
    expect(wrapper.text()).toContain('客户乙');
    resolveCustomerA({ id: 'customer-a', name: '迟到的客户甲' });
    await flushPromises();

    expect(wrapper.text()).toContain('客户乙');
    expect(wrapper.text()).not.toContain('迟到的客户甲');
  });

  it('ignores a late admission refresh after switching customers', async () => {
    let resolveAdmissionRefresh!: (
      customer: ReturnType<typeof customerRecord>,
    ) => void;
    api.getCustomer
      .mockResolvedValueOnce(customerRecord('customer-a', '客户甲'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAdmissionRefresh = resolve;
          }),
      )
      .mockResolvedValueOnce(customerRecord('customer-b', '客户乙'));
    const { router, wrapper } = await mountPage('customer-a');
    await flushPromises();

    await wrapper.get('[data-test="admitted"]').trigger('click');
    await router.push('/customers/customer-b');
    await flushPromises();
    const admittedCustomer = {
      ...customerRecord('customer-a', '客户甲的迟到准入刷新'),
      profileStatus: 'admitted',
      admittedAt: '2026-09-21T03:00:00.000Z',
      version: 2,
      capabilities: { editRoutine: true, admit: false },
    };
    resolveAdmissionRefresh(admittedCustomer);
    await flushPromises();

    expect(wrapper.text()).toContain('客户乙');
    expect(wrapper.text()).not.toContain('客户甲的迟到准入刷新');
  });

  it('ignores a late version refresh after switching customers', async () => {
    let resolveVersionRefresh!: (
      customer: ReturnType<typeof customerRecord>,
    ) => void;
    api.getCustomer
      .mockResolvedValueOnce(customerRecord('customer-a', '客户甲'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveVersionRefresh = resolve;
          }),
      )
      .mockResolvedValueOnce(customerRecord('customer-b', '客户乙'));
    const { router, wrapper } = await mountPage('customer-a');
    await flushPromises();

    await wrapper.get('[data-test="account-draft"]').setValue('客户甲草稿');
    await wrapper.get('[data-test="refresh-requested"]').trigger('click');
    await wrapper
      .get('[role="tab"][aria-controls="customer-tab-assets"]')
      .trigger('click');
    await router.push('/customers/customer-b');
    await flushPromises();
    resolveVersionRefresh(customerRecord('customer-a', '客户甲的迟到版本刷新'));
    await flushPromises();

    expect(wrapper.text()).toContain('客户乙');
    expect(wrapper.text()).not.toContain('客户甲的迟到版本刷新');
    expect(
      wrapper
        .get('[role="tab"][aria-controls="customer-tab-basic"]')
        .attributes('aria-selected'),
    ).toBe('true');
    expect(
      (wrapper.get('[data-test="account-draft"]').element as HTMLInputElement)
        .value,
    ).toBe('');
  });

  it('ignores events emitted by a panel after its customer has changed', async () => {
    api.getCustomer
      .mockResolvedValueOnce(customerRecord('customer-a', '客户甲'))
      .mockResolvedValueOnce(customerRecord('customer-b', '客户乙'));
    const { router, wrapper } = await mountPage('customer-a');
    await flushPromises();
    const previousPanel = wrapper.getComponent(rightsHolderPanel);
    const oldVersionHandler = previousPanel.vm.$.vnode.props?.onVersionUpdated;
    const oldNotFoundHandler =
      previousPanel.vm.$.vnode.props?.onCustomerNotFound;

    await router.push('/customers/customer-b');
    await flushPromises();
    if (typeof oldVersionHandler === 'function') {
      (oldVersionHandler as (customerId: string, version: number) => void)(
        'customer-a',
        2,
      );
    }
    if (typeof oldNotFoundHandler === 'function') {
      (oldNotFoundHandler as (customerId: string) => void)('customer-a');
    }
    await flushPromises();

    expect(
      wrapper
        .get('[data-test="rights-holder-panel"]')
        .attributes('data-version'),
    ).toBe('1');
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-b');
  });

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
      capabilities: { editRoutine: true, admit: true },
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
    expect(
      wrapper.get('[data-test="admission-panel"]').attributes(),
    ).toMatchObject({ 'data-version': '2' });
  });

  it('replaces the draft admission panel with the admitted state after success', async () => {
    const draft = {
      id: 'customer-1',
      name: '客户甲',
      customerType: 'ENTERPRISE',
      identityType: 'BUSINESS_LICENSE',
      identityNumber: '91310000ABC123',
      issuingCountryOrRegion: null,
      identityValidFrom: null,
      identityValidTo: null,
      identityValidityMode: 'LONG_TERM',
      admittedAt: null,
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
      capabilities: { editRoutine: true, admit: true },
      history: [],
    };
    api.getCustomer.mockResolvedValueOnce(draft).mockResolvedValueOnce({
      ...draft,
      profileStatus: 'admitted',
      admittedAt: '2026-09-21T03:00:00.000Z',
      version: 2,
      capabilities: { editRoutine: true, admit: false },
    });
    const { wrapper } = await mountPage();
    await flushPromises();

    await wrapper.get('[data-test="admitted"]').trigger('click');

    expect(wrapper.text()).toContain('已准入');
    expect(wrapper.text()).toContain('客户组织类型');
    expect(wrapper.text()).toContain('企业');
    expect(wrapper.text()).toContain('身份证明类型');
    expect(wrapper.text()).toContain('营业执照');
    expect(wrapper.text()).not.toContain('ENTERPRISE');
    expect(wrapper.text()).not.toContain('BUSINESS_LICENSE');
    expect(wrapper.find('[data-test="admission-panel"]').exists()).toBe(true);
    expect(
      wrapper.get('[data-test="admission-panel"]').attributes('data-version'),
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
      capabilities: { editRoutine: false, admit: false },
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
    expect(wrapper.find('[data-test="admission-panel"]').exists()).toBe(true);
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
      capabilities: { editRoutine: true, admit: true },
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
        capabilities: { editRoutine: true, admit: true },
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
