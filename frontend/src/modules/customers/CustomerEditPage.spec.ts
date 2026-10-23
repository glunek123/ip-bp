import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerEditPage from './CustomerEditPage.vue';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';
import { savePendingCustomerContact } from './customer-contacts-pending';

const api = vi.hoisted(() => ({
  getCustomer: vi.fn(),
  updateCustomerDraft: vi.fn(),
  findCustomerDuplicates: vi.fn(),
}));
vi.mock('../../api/customers', () => api);

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  useAuthStore(pinia).session = null;
  globalThis.sessionStorage.clear();
});

const customer = {
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
  cooperationStatus: 'COOPERATING',
  profileStatus: 'draft',
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-17T01:00:00.000Z',
  capabilities: {
    editRoutine: true,
    admit: true,
    agreement: { read: false, edit: false },
    invoice: { read: false, edit: false },
    settlement: { read: false, register: false, correct: false },
  },
  history: [],
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/:id/edit', component: CustomerEditPage },
      { path: '/customers/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/customers/customer-1/edit');
  await router.isReady();
  return {
    wrapper: mount(RouterView, { global: { plugins: [router] } }),
    router,
  };
}

describe('CustomerEditPage', () => {
  it('sends only the edited manager through the real JSON transport and decoder', async () => {
    const actual = await vi.importActual<typeof import('../../api/customers')>(
      '../../api/customers',
    );
    const legacy = {
      ...customer,
      profileStatus: 'admitted',
      customerType: 'enterprise',
      identityType: 'CREDIT-CODE',
      identityNumber: 'CGMIN-LEGACY',
      version: 9,
    };
    api.getCustomer.mockResolvedValue(legacy);
    api.updateCustomerDraft.mockImplementation(actual.updateCustomerDraft);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...legacy,
          identityValidFrom: null,
          identityValidTo: null,
          identityValidityMode: null,
          admittedAt: '2026-09-17T00:00:00.000Z',
          customerManagerName: '经理乙',
          version: 10,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper, router } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="customerManagerName"]').setValue(' 经理乙 ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/customers/customer-1');
    expect(fetchMock.mock.calls[0]?.[1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      expectedVersion: 9,
      customerManagerName: '经理乙',
    });
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
    wrapper.unmount();
  });

  it('forwards an actual admitted identity edit and preserves its server rejection without retrying', async () => {
    api.getCustomer.mockResolvedValue({
      ...customer,
      profileStatus: 'admitted',
      version: 7,
    });
    api.updateCustomerDraft.mockRejectedValue(
      new ApiError('不可更改身份', 409, 'INVALID_STATE'),
    );
    const { wrapper, router } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('新的主体名称');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenCalledExactlyOnceWith(
      'customer-1',
      { expectedVersion: 7, name: '新的主体名称' },
    );
    expect(api.getCustomer).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/customers/customer-1/edit');
    expect(wrapper.text()).toContain('客户资料没有保存成功');
    wrapper.unmount();
  });

  it('updates and clears ordinary draft fields without resending untouched values', async () => {
    api.getCustomer.mockResolvedValue({
      ...customer,
      category: '旧类别',
      region: '旧地区',
    });
    api.updateCustomerDraft.mockResolvedValue(customer);
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="category"]').setValue(' 新类别 ');
    await wrapper.get('input[name="region"]').setValue(' ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenCalledExactlyOnceWith(
      'customer-1',
      { expectedVersion: 1, category: '新类别', region: '' },
    );
    wrapper.unmount();
  });

  it('resets the comparison baseline when the user adopts a newer conflict snapshot', async () => {
    api.getCustomer.mockResolvedValueOnce(customer).mockResolvedValueOnce({
      ...customer,
      name: '服务器新名',
      category: '服务器类别',
      version: 2,
    });
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [],
    });
    api.updateCustomerDraft
      .mockRejectedValueOnce(
        new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
      )
      .mockResolvedValue(customer);
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('已放弃的本地名称');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('button[name="useLatest"]').trigger('click');
    await wrapper.get('input[name="customerManagerName"]').setValue('新经理');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenLastCalledWith('customer-1', {
      expectedVersion: 2,
      customerManagerName: '新经理',
    });
    wrapper.unmount();
  });
  it.each(['新经理', ''])(
    'changes only the manager of an admitted legacy snapshot (%s), without resending frozen identity',
    async (manager) => {
      const legacy = {
        ...customer,
        profileStatus: 'admitted',
        name: 'Legacy Customer',
        customerType: 'enterprise',
        identityType: 'CREDIT-CODE',
        identityNumber: 'CGMIN-LEGACY',
        customerManagerName: '旧经理',
        version: 17,
      };
      api.getCustomer.mockResolvedValue(legacy);
      api.updateCustomerDraft.mockImplementation(
        async (_id: string, input: Record<string, unknown>) => {
          // The actual backend rejects explicitly supplied identity values that differ
          // from the stored identity/canonical caches of an admitted customer.
          if (
            ['name', 'customerType', 'identityType', 'identityNumber'].some(
              (key) => Object.hasOwn(input, key),
            )
          )
            throw new ApiError('主体信息不可日常修改', 409, 'INVALID_STATE');
          return {
            ...legacy,
            customerManagerName: manager || null,
            version: 18,
          };
        },
      );
      const { wrapper, router } = await mountPage();
      await flushPromises();
      await wrapper.get('input[name="customerManagerName"]').setValue(manager);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(api.updateCustomerDraft).toHaveBeenCalledExactlyOnceWith(
        'customer-1',
        { expectedVersion: 17, customerManagerName: manager || null },
      );
      expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
      wrapper.unmount();
    },
  );
  it.each([false, true])(
    'retains manager edit intent across a version conflict (changed=%s)',
    async (changed) => {
      api.getCustomer
        .mockResolvedValueOnce({ ...customer, customerManagerName: '经理甲' })
        .mockResolvedValueOnce({
          ...customer,
          version: 2,
          customerManagerName: '服务器经理',
          category: '服务器新类别',
        });
      api.findCustomerDuplicates.mockResolvedValue({
        exactIdentity: [],
        sameName: [],
      });
      api.updateCustomerDraft
        .mockRejectedValueOnce(
          new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
        )
        .mockResolvedValue(customer);
      const { wrapper } = await mountPage();
      await flushPromises();
      await wrapper.get('input[name="name"]').setValue('本地名称');
      if (changed)
        await wrapper
          .get('input[name="customerManagerName"]')
          .setValue('本地经理');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      await wrapper.get('button[name="retryLatest"]').trigger('click');
      await flushPromises();
      const body = api.updateCustomerDraft.mock.calls.at(-1)?.[1];
      expect(body.expectedVersion).toBe(2);
      expect(body).not.toHaveProperty('category');
      expect(body).not.toHaveProperty('identityType');
      if (changed) expect(body.customerManagerName).toBe('本地经理');
      else expect(body).not.toHaveProperty('customerManagerName');
      wrapper.unmount();
    },
  );
  it.each(['draft', 'admitted'])(
    'clears a manager in a %s profile without changing operator ownership',
    async (profileStatus) => {
      api.getCustomer.mockResolvedValue({
        ...customer,
        profileStatus,
        customerManagerName: '经理乙',
      });
      api.updateCustomerDraft.mockResolvedValue(customer);
      const { wrapper } = await mountPage();
      await flushPromises();
      expect(
        wrapper.get('input[name="customerManagerName"]').element,
      ).toHaveProperty('value', '经理乙');
      await wrapper.get('input[name="customerManagerName"]').setValue(' ');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(api.updateCustomerDraft).toHaveBeenCalledWith(
        'customer-1',
        expect.objectContaining({ customerManagerName: null }),
      );
      expect(api.updateCustomerDraft.mock.calls[0]?.[1]).not.toHaveProperty(
        'responsibleUserId',
      );
      wrapper.unmount();
    },
  );

  it('omits an unchanged manager and validates its maximum length', async () => {
    api.getCustomer.mockResolvedValue({
      ...customer,
      customerManagerName: '经理乙',
    });
    api.updateCustomerDraft.mockResolvedValue(customer);
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper
      .get('input[name="customerManagerName"]')
      .setValue('长'.repeat(101));
    await wrapper.get('form').trigger('submit');
    expect(api.updateCustomerDraft).not.toHaveBeenCalled();
    await wrapper.get('input[name="customerManagerName"]').setValue(' 经理乙 ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft.mock.calls[0]?.[1]).not.toHaveProperty(
      'customerManagerName',
    );
    wrapper.unmount();
  });
  it('blocks a direct edit route while a contact command is pending', async () => {
    useAuthStore(pinia).session = {
      principalType: 'INTERNAL',
      user: { id: 'user-1', displayName: '运营甲', username: 'operator-a' },
      department: { id: 'department-1', name: '甲部门' },
      departments: [{ id: 'department-1', name: '甲部门' }],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 1,
      expiresAt: '2026-10-09T10:00:00.000Z',
      csrfToken: 'csrf',
    };
    savePendingCustomerContact({
      action: 'create',
      userId: 'user-1',
      departmentId: 'department-1',
      customerId: 'customer-1',
      contactId: null,
      expectedCustomerVersion: 1,
      expectedContactVersion: null,
      body: {
        expectedCustomerVersion: 1,
        name: '新联系人',
        phone: '13800138000',
      },
      key: 'original-contact-key',
    });
    api.getCustomer.mockResolvedValue(customer);
    const { wrapper } = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('请先处理未确认的联系人请求');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('loads the current draft and saves only changed editable fields', async () => {
    api.getCustomer.mockResolvedValue(customer);
    api.updateCustomerDraft.mockResolvedValue({
      ...customer,
      name: '客户甲（更新）',
      version: 2,
    });
    const { wrapper, router } = await mountPage();
    await flushPromises();
    expect(wrapper.text()).not.toContain('准入联系人（可选）');
    expect(wrapper.find('input[name="admissionContactName"]').exists()).toBe(
      false,
    );
    await wrapper.get('input[name="name"]').setValue('客户甲（更新）');
    await wrapper.get('select[name="customerType"]').setValue('ENTERPRISE');
    await wrapper
      .get('select[name="identityType"]')
      .setValue('BUSINESS_LICENSE');
    await wrapper
      .get('input[name="identityNumber"]')
      .setValue('91310000abc123');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenCalledWith('customer-1', {
      expectedVersion: 1,
      name: '客户甲（更新）',
      customerType: 'ENTERPRISE',
      identityType: 'BUSINESS_LICENSE',
      identityNumber: '91310000abc123',
    });
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
  });

  it('uses controlled compatible type options and maps supported legacy values', async () => {
    api.getCustomer.mockResolvedValue({
      ...customer,
      customerType: 'enterprise',
      identityType: 'credit-code',
    });
    const { wrapper } = await mountPage();
    await flushPromises();

    expect(
      (wrapper.get('select[name="customerType"]').element as HTMLSelectElement)
        .value,
    ).toBe('ENTERPRISE');
    expect(
      (wrapper.get('select[name="identityType"]').element as HTMLSelectElement)
        .value,
    ).toBe('BUSINESS_LICENSE');

    await wrapper.get('select[name="customerType"]').setValue('NATURAL_PERSON');
    const identityOptions = wrapper
      .get('select[name="identityType"]')
      .findAll('option')
      .map((option) => option.attributes('value'));
    expect(identityOptions).toEqual([
      '',
      'NATIONAL_ID',
      'PASSPORT',
      'OTHER_VALID_ID',
    ]);
    expect(
      (wrapper.get('select[name="identityType"]').element as HTMLSelectElement)
        .value,
    ).toBe('');
  });

  it('shows one same-name reason field and retains input for retry', async () => {
    api.getCustomer.mockResolvedValue(customer);
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [
        {
          id: 'customer-2',
          name: '同名客户',
          category: '重点',
          region: '上海',
        },
      ],
    });
    api.updateCustomerDraft
      .mockRejectedValueOnce(
        new ApiError(
          '本部门已有同名客户，请说明继续原因',
          409,
          'CUSTOMER_NAME_REASON_REQUIRED',
        ),
      )
      .mockResolvedValueOnce({ ...customer, name: '同名客户', version: 2 });
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('同名客户');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('本部门已有同名客户');
    expect(api.findCustomerDuplicates).toHaveBeenCalledWith({
      name: '同名客户',
      excludeCustomerId: 'customer-1',
    });
    expect(wrapper.text()).toContain('重点 · 上海');
    expect(wrapper.text()).toContain('打开已有客户');
    await wrapper
      .get('textarea[name="duplicateNameReason"]')
      .setValue('不同业务主体，经核对后继续');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenLastCalledWith(
      'customer-1',
      expect.objectContaining({
        name: '同名客户',
        duplicateNameReason: '不同业务主体，经核对后继续',
      }),
    );
  });

  it('shows an actionable identity duplicate error', async () => {
    api.getCustomer.mockResolvedValue(customer);
    api.updateCustomerDraft.mockRejectedValue(
      new ApiError(
        '本部门已有相同证件号码的客户',
        409,
        'CUSTOMER_IDENTITY_DUPLICATE',
      ),
    );
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('本部门已有相同证件号码的客户');
    expect(
      (wrapper.get('input[name="name"]').element as HTMLInputElement).value,
    ).toBe('客户甲');
  });

  it('reloads the latest version, preserves the draft, and retries only after user choice', async () => {
    api.getCustomer
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce({ ...customer, name: '服务端新名称', version: 2 });
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [],
    });
    api.updateCustomerDraft
      .mockRejectedValueOnce(
        new ApiError('客户资料已被他人更新', 409, 'CUSTOMER_VERSION_CONFLICT'),
      )
      .mockResolvedValueOnce({ ...customer, name: '我的草稿', version: 3 });
    const { wrapper } = await mountPage();
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('我的草稿');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.getCustomer).toHaveBeenCalledTimes(2);
    expect(api.findCustomerDuplicates).toHaveBeenCalledWith({
      name: '我的草稿',
      identityType: '',
      identityNumber: '',
      excludeCustomerId: 'customer-1',
    });
    expect(wrapper.text()).toContain('已读取最新版本');
    expect(
      (wrapper.get('input[name="name"]').element as HTMLInputElement).value,
    ).toBe('我的草稿');
    expect(api.updateCustomerDraft).toHaveBeenCalledTimes(1);

    await wrapper.get('button[name="retryLatest"]').trigger('click');
    await flushPromises();
    expect(api.updateCustomerDraft).toHaveBeenLastCalledWith(
      'customer-1',
      expect.objectContaining({ expectedVersion: 2, name: '我的草稿' }),
    );
  });

  it('can discard the local draft and load the latest version after a conflict', async () => {
    api.getCustomer.mockResolvedValueOnce(customer).mockResolvedValueOnce({
      ...customer,
      name: '服务端新名称',
      category: '最新类别',
      region: '北京',
      admissionContactName: '李四',
      admissionContactPhone: null,
      admissionContactEmail: 'latest@example.com',
      version: 2,
    });
    api.findCustomerDuplicates.mockResolvedValue({
      exactIdentity: [],
      sameName: [],
    });
    api.updateCustomerDraft.mockRejectedValueOnce(
      new ApiError('客户资料已被他人更新', 409, 'CUSTOMER_VERSION_CONFLICT'),
    );
    const { wrapper, router } = await mountPage();
    const confirm = vi
      .spyOn(globalThis.window, 'confirm')
      .mockReturnValue(false);
    await flushPromises();
    await wrapper.get('input[name="name"]').setValue('我的草稿');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    await wrapper.get('button[name="useLatest"]').trigger('click');

    expect(
      (wrapper.get('input[name="name"]').element as HTMLInputElement).value,
    ).toBe('服务端新名称');
    expect(
      (wrapper.get('input[name="category"]').element as HTMLInputElement).value,
    ).toBe('最新类别');
    expect(
      (wrapper.get('input[name="region"]').element as HTMLInputElement).value,
    ).toBe('北京');
    expect(wrapper.find('input[name="admissionContactName"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('button[name="useLatest"]').exists()).toBe(false);
    expect(api.updateCustomerDraft).toHaveBeenCalledTimes(1);

    await router.push('/customers/customer-1');
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not show an editable form if capability is absent', async () => {
    api.getCustomer.mockResolvedValue({
      ...customer,
      capabilities: {
        editRoutine: false,
        agreement: { read: false, edit: false },
        invoice: { read: false, edit: false },
        settlement: { read: false, register: false, correct: false },
      },
    });
    const { wrapper } = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号没有编辑此客户的权限');
    expect(wrapper.find('form').exists()).toBe(false);
  });
});
