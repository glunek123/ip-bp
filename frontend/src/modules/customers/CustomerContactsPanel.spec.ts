import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail, CustomerContact } from '../../api/customers';
import { ApiError } from '../../api/http';
import CustomerContactsPanel from './CustomerContactsPanel.vue';
import {
  listPendingCustomerContacts,
  savePendingCustomerContact,
} from './customer-contacts-pending';

const api = vi.hoisted(() => ({
  createCustomerContact: vi.fn(),
  endCustomerContact: vi.fn(),
  getCustomer: vi.fn(),
  listCustomerContactVersions: vi.fn(),
  listCustomerContacts: vi.fn(),
  setCustomerContactPrimary: vi.fn(),
  updateCustomerContact: vi.fn(),
}));
vi.mock('../../api/customers', () => api);

const contact = (id: string, isPrimary = false): CustomerContact => ({
  id,
  customerId: 'customer-1',
  name: '同名联系人',
  phone: '13800138000',
  email: null,
  duty: null,
  isPrimary,
  endedAt: null,
  endReason: null,
  version: 1,
  origin: 'MANUAL',
  createdAt: '2026-10-09T01:00:00.000Z',
  updatedAt: '2026-10-09T01:00:00.000Z',
});
const customer: CustomerDetail = {
  id: 'customer-1',
  name: '客户甲',
  customerType: null,
  identityType: null,
  identityNumber: null,
  issuingCountryOrRegion: null,
  identityValidFrom: null,
  identityValidTo: null,
  identityValidityMode: null,
  admittedAt: null,
  category: null,
  region: null,
  admissionContactName: null,
  admissionContactPhone: null,
  admissionContactEmail: null,
  profileStatus: 'draft',
  cooperationStatus: 'COOPERATING',
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 3,
  updatedAt: '2026-10-09T01:00:00.000Z',
  primaryContactId: 'contact-1',
  admissionContactSnapshot: null,
  capabilities: { editRoutine: true, admit: true },
  responsibleOperator: { id: 'user-1', displayName: '运营甲' },
  cooperationCapabilities: {
    transfer: false,
    pause: true,
    terminate: true,
    resume: false,
  },
  history: [],
};
const admittedCustomer: CustomerDetail = {
  ...customer,
  profileStatus: 'admitted',
  admissionContactSnapshot: {
    name: '独特快照人',
    phone: '13800138099',
    email: 'snapshot@example.com',
    source: 'RECEIPT',
    frozenAt: '2026-10-09T01:00:00.000Z',
  },
};
const actor = { userId: 'user-1', departmentId: 'department-1' };
const page = (
  items: CustomerContact[],
  status: 'ACTIVE' | 'ENDED' = 'ACTIVE',
) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
  primaryContactId: status === 'ACTIVE' ? 'contact-1' : null,
});
function mountPanel(target: CustomerDetail = customer) {
  return mount(CustomerContactsPanel, {
    props: { customer: target, actor, blockedByOtherMaintenance: false },
  });
}
function mountPanelWithParentRefresh() {
  const parent = defineComponent({
    setup() {
      const currentCustomer = ref<CustomerDetail>(customer);
      return () =>
        h(CustomerContactsPanel, {
          customer: currentCustomer.value,
          actor,
          blockedByOtherMaintenance: false,
          onRefreshed: (customerId, _actorKey, latest) => {
            if (customerId === currentCustomer.value.id)
              currentCustomer.value = { ...latest };
          },
        });
    },
  });
  return mount(parent);
}

afterEach(() => {
  vi.resetAllMocks();
  globalThis.sessionStorage.clear();
});

describe('CustomerContactsPanel', () => {
  it('keeps same-name contacts separate and shows the ended view and unassigned primary state', async () => {
    api.listCustomerContacts.mockImplementation((_id: string, status: string) =>
      Promise.resolve(
        status === 'ACTIVE'
          ? page([contact('contact-1'), contact('contact-2')])
          : page(
              [
                {
                  ...contact('contact-3'),
                  endedAt: '2026-10-01T00:00:00.000Z',
                  endReason: '结束',
                },
              ],
              'ENDED',
            ),
      ),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findAll('li[data-test^="contact-"]')).toHaveLength(2);
    expect(wrapper.text()).toContain('同名联系人');
    await wrapper.get('button[aria-pressed="false"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="contact-contact-3"]').exists()).toBe(true);
    wrapper.unmount();

    const noPrimary = { ...customer, primaryContactId: null };
    api.listCustomerContacts.mockResolvedValue(page([contact('contact-1')]));
    const unassigned = mount(CustomerContactsPanel, {
      props: { customer: noPrimary, actor, blockedByOtherMaintenance: false },
    });
    await flushPromises();
    expect(unassigned.text()).toContain('当前未指定主要联系人');
    unassigned.unmount();
  });

  it('keeps the original key and body after BUSY and retries the same command', async () => {
    api.listCustomerContacts.mockResolvedValue(
      page([contact('contact-1', true)]),
    );
    api.listCustomerContactVersions.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    api.setCustomerContactPrimary
      .mockRejectedValueOnce(new ApiError('busy', 409, 'CUSTOMER_CONTACT_BUSY'))
      .mockResolvedValueOnce({});
    api.getCustomer.mockResolvedValue({ ...customer, version: 4 });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper
      .get('[data-test="contact-contact-1"] button')
      .trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="contact-contact-1"] .el-button')
      .trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('取消主要'))
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('联系人请求结果尚未确认');
    const saved = listPendingCustomerContacts(actor, customer.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.body).toMatchObject({
      expectedCustomerVersion: 3,
      expectedContactVersion: 1,
      primary: false,
    });
    const originalKey = saved[0]!.key;
    await wrapper.get('[data-test="contact-retry"]').trigger('click');
    await flushPromises();
    expect(api.setCustomerContactPrimary).toHaveBeenCalledTimes(2);
    expect(api.setCustomerContactPrimary.mock.calls[1]).toEqual(
      api.setCustomerContactPrimary.mock.calls[0],
    );
    expect(api.setCustomerContactPrimary.mock.calls[0]?.[3]).toBe(originalKey);
    expect(listPendingCustomerContacts(actor, customer.id)).toHaveLength(0);
    wrapper.unmount();
  });

  it('finishes the pending write when the parent replaces the refreshed customer', async () => {
    api.listCustomerContacts.mockResolvedValue(page([]));
    api.createCustomerContact.mockResolvedValue({});
    api.getCustomer.mockResolvedValue({ ...customer, version: 4 });
    const wrapper = mountPanelWithParentRefresh();
    await flushPromises();
    const fields = wrapper.findAll('form input');
    await fields[0]!.setValue('联系人甲');
    await fields[1]!.setValue('13800138000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerContact).toHaveBeenCalledTimes(1);
    expect(
      wrapper.find('[data-test="contact-refresh-readonly"]').exists(),
    ).toBe(false);
    expect(wrapper.find('form').exists()).toBe(true);
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBe(undefined);

    const nextFields = wrapper.findAll('form input');
    await nextFields[0]!.setValue('联系人乙');
    await nextFields[1]!.setValue('13800138001');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerContact).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it.each([
    ['forbidden', 403, 'ACTION_FORBIDDEN'],
    ['hidden', 404, 'RESOURCE_NOT_FOUND'],
  ])(
    'retains the original request after a %s response',
    async (_label, status, code) => {
      api.listCustomerContacts.mockResolvedValue(page([]));
      api.createCustomerContact
        .mockRejectedValueOnce(new ApiError('unknown', status, code))
        .mockResolvedValueOnce({});
      api.getCustomer.mockResolvedValue({ ...customer, version: 4 });
      const wrapper = mountPanel();
      await flushPromises();
      const fields = wrapper.findAll('form input');
      await fields[0]!.setValue('新增联系人');
      await fields[1]!.setValue('13800138000');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      const saved = listPendingCustomerContacts(actor, customer.id);
      expect(saved).toHaveLength(1);
      const originalCall = api.createCustomerContact.mock.calls[0];
      await wrapper.get('[data-test="contact-retry"]').trigger('click');
      await flushPromises();
      expect(api.createCustomerContact).toHaveBeenCalledTimes(2);
      expect(api.createCustomerContact.mock.calls[1]).toEqual(originalCall);
      expect(listPendingCustomerContacts(actor, customer.id)).toHaveLength(0);
      wrapper.unmount();
    },
  );

  it('does not send a write when pending storage fails', async () => {
    api.listCustomerContacts.mockResolvedValue(page([]));
    const originalStorage = globalThis.sessionStorage;
    const brokenStorage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      }),
    } as unknown as Storage;
    vi.stubGlobal('sessionStorage', brokenStorage);
    const wrapper = mountPanel();
    await flushPromises();
    const fields = wrapper.findAll('form input');
    await fields[0]!.setValue('新增联系人');
    await fields[1]!.setValue('13800138000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerContact).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('未发送请求');
    vi.stubGlobal('sessionStorage', originalStorage);
    wrapper.unmount();
  });

  it('aborts and ignores contact reads from a previous customer or actor', async () => {
    let resolveCustomerA!: (value: ReturnType<typeof page>) => void;
    let resolveOldActor!: (value: ReturnType<typeof page>) => void;
    let calls = 0;
    let deferNextRead = false;
    let actorSwitched = false;
    api.listCustomerContacts.mockImplementation((id: string) => {
      calls += 1;
      if (calls === 1)
        return new Promise((resolve) => {
          resolveCustomerA = resolve;
        });
      if (deferNextRead) {
        deferNextRead = false;
        return new Promise((resolve) => {
          resolveOldActor = resolve;
        });
      }
      return Promise.resolve(
        page([
          {
            ...contact('contact-b'),
            customerId: id,
            name: actorSwitched ? '新actor联系人' : '客户乙联系人',
          },
        ]),
      );
    });
    const wrapper = mountPanel();
    const customerASignal = api.listCustomerContacts.mock.calls[0]?.[4]
      ?.signal as AbortSignal;
    await wrapper.setProps({
      customer: { ...customer, id: 'customer-2', name: '客户乙' },
    });
    await flushPromises();
    expect(customerASignal.aborted).toBe(true);
    resolveCustomerA(page([contact('late-customer')]));
    await flushPromises();
    expect(wrapper.find('[data-test="contact-contact-b"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('客户乙联系人');
    expect(wrapper.find('[data-test="contact-late-customer"]').exists()).toBe(
      false,
    );

    deferNextRead = true;
    await wrapper.get('button[aria-pressed="false"]').trigger('click');
    const actorSignal = api.listCustomerContacts.mock.calls[calls - 1]?.[4]
      ?.signal as AbortSignal;
    actorSwitched = true;
    await wrapper.setProps({ actor: { ...actor, userId: 'user-2' } });
    await flushPromises();
    expect(actorSignal.aborted).toBe(true);
    resolveOldActor(page([contact('late-actor')]));
    await flushPromises();
    expect(wrapper.find('[data-test="contact-late-actor"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain('新actor联系人');
    wrapper.unmount();
  });

  it('aborts contact and history reads when the panel unmounts', async () => {
    api.listCustomerContacts.mockResolvedValue(page([contact('contact-1')]));
    api.listCustomerContactVersions.mockImplementation(
      () => new Promise(() => {}),
    );
    const wrapper = mountPanel();
    await flushPromises();
    const listSignal = api.listCustomerContacts.mock.calls[0]?.[4]
      ?.signal as AbortSignal;
    await wrapper
      .get('[data-test="contact-contact-1"] button')
      .trigger('click');
    const historySignal = api.listCustomerContactVersions.mock.calls[0]?.[4]
      ?.signal as AbortSignal;
    wrapper.unmount();
    expect(listSignal.aborted).toBe(true);
    expect(historySignal.aborted).toBe(true);
  });

  it.each([403, 404])(
    'clears visible contact and history data after a %s read failure',
    async (status) => {
      api.listCustomerContacts.mockResolvedValue(page([contact('contact-1')]));
      const pending = {
        action: 'create' as const,
        userId: actor.userId,
        departmentId: actor.departmentId,
        customerId: customer.id,
        contactId: null,
        expectedCustomerVersion: customer.version,
        expectedContactVersion: null,
        body: {
          expectedCustomerVersion: customer.version,
          name: '待恢复联系人',
          phone: '13800138000',
        },
        key: 'preserved-unknown-key',
      };
      if (status === 403) savePendingCustomerContact(pending);
      api.listCustomerContactVersions.mockResolvedValue({
        items: [
          {
            id: 'version-1',
            customerId: 'customer-1',
            contactId: 'contact-1',
            action: 'CREATED',
            after: {
              name: '同名联系人',
              phone: '13800138000',
              email: null,
              duty: null,
              isPrimary: false,
            },
            actor: { kind: 'HUMAN', userId: 'user-1' },
            occurredAt: '2026-10-09T01:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const wrapper = mountPanel(admittedCustomer);
      await flushPromises();
      await wrapper
        .get('[data-test="contact-contact-1"] button')
        .trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('同名联系人');
      expect(wrapper.text()).toContain('snapshot@example.com');
      api.listCustomerContacts.mockRejectedValue(
        new ApiError('unavailable', status, 'RESOURCE_NOT_FOUND'),
      );
      await wrapper.setProps({ customer: { ...admittedCustomer, version: 4 } });
      await flushPromises();
      expect(wrapper.find('[data-test="contact-contact-1"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain('13800138000');
      expect(wrapper.text()).not.toContain('snapshot@example.com');
      expect(wrapper.emitted('unavailable')).toEqual([
        [customer.id, 'user-1:department-1:0'],
      ]);
      expect(wrapper.text()).toContain('联系人资料当前不可用');
      expect(wrapper.text()).not.toContain('暂无活动联系人');
      if (status === 403) {
        expect(listPendingCustomerContacts(actor, customer.id)).toEqual([
          pending,
        ]);
      }
      wrapper.unmount();
    },
  );

  it.each([403, 404])(
    'clears visible history and contacts after a %s history failure',
    async (status) => {
      api.listCustomerContacts.mockResolvedValue(page([contact('contact-1')]));
      const history = {
        items: [
          {
            id: 'version-1',
            customerId: customer.id,
            contactId: 'contact-1',
            action: 'CREATED',
            after: {
              name: '同名联系人',
              phone: '13800138000',
              email: null,
              duty: null,
              isPrimary: false,
            },
            actor: { kind: 'HUMAN', userId: actor.userId },
            occurredAt: '2026-10-09T01:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      api.listCustomerContactVersions.mockResolvedValue(history);
      const wrapper = mountPanel(admittedCustomer);
      await flushPromises();
      await wrapper
        .get('[data-test="contact-contact-1"] button')
        .trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('同名联系人');
      expect(wrapper.text()).toContain('snapshot@example.com');
      api.listCustomerContactVersions.mockRejectedValue(
        new ApiError('unavailable', status, 'RESOURCE_NOT_FOUND'),
      );
      await wrapper
        .get('[data-test="contact-contact-1"] button')
        .trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-test="contact-contact-1"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain('13800138000');
      expect(wrapper.text()).not.toContain('snapshot@example.com');
      expect(wrapper.emitted('unavailable')).toEqual([
        [customer.id, 'user-1:department-1:0'],
      ]);
      expect(wrapper.text()).toContain('联系人资料当前不可用');
      wrapper.unmount();
    },
  );

  it('keeps confirmed success read-only when the current GET fails', async () => {
    api.listCustomerContacts.mockResolvedValue(page([]));
    api.createCustomerContact.mockResolvedValue({});
    api.getCustomer
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...customer, version: 4 });
    const wrapper = mountPanel();
    await flushPromises();
    const fields = wrapper.findAll('form input');
    await fields[0]!.setValue('新增联系人');
    await fields[1]!.setValue('13800138000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerContact).toHaveBeenCalledTimes(1);
    expect(listPendingCustomerContacts(actor, customer.id)).toHaveLength(0);
    expect(
      wrapper.find('[data-test="contact-refresh-readonly"]').exists(),
    ).toBe(true);
    expect(wrapper.find('form').exists()).toBe(false);

    await wrapper
      .get('[data-test="contact-refresh-readonly"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="contact-refresh-readonly"]').exists(),
    ).toBe(false);
    expect(api.createCustomerContact).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('keeps the selected ended page after read-only recovery', async () => {
    const endedPage = (requestedPage: number) => ({
      items: [
        {
          ...contact(`ended-${requestedPage}`),
          name: `已结束联系人第${requestedPage}页`,
          endedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      total: 21,
      page: requestedPage,
      pageSize: 20,
      primaryContactId: null,
    });
    api.listCustomerContacts.mockImplementation(
      (_id: string, listStatus: string, requestedPage: number) =>
        Promise.resolve(
          listStatus === 'ENDED'
            ? endedPage(requestedPage)
            : { ...page([]), page: requestedPage },
        ),
    );
    api.createCustomerContact.mockResolvedValue({});
    api.getCustomer
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...customer, version: 4 });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('button[aria-pressed="false"]').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('下一页'))!
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已结束联系人第2页');
    expect(wrapper.text()).toContain('2 / 2');

    const fields = wrapper.findAll('form input');
    await fields[0]!.setValue('新增联系人');
    await fields[1]!.setValue('13800138000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(
      wrapper.find('[data-test="contact-refresh-readonly"]').exists(),
    ).toBe(true);
    await wrapper
      .get('[data-test="contact-refresh-readonly"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已结束联系人第2页');
    expect(wrapper.text()).not.toContain('已结束联系人第1页');
    expect(wrapper.text()).toContain('2 / 2');
    expect(api.listCustomerContacts.mock.calls.slice(-2)).toEqual([
      expect.arrayContaining(['customer-1', 'ACTIVE', 1]),
      expect.arrayContaining(['customer-1', 'ENDED', 2]),
    ]);
    wrapper.unmount();
  });

  it('stays read-only when the customer GET succeeds but contacts GET fails', async () => {
    let writeSucceeded = false;
    let customerReads = 0;
    api.listCustomerContacts.mockImplementation(() => {
      if (writeSucceeded && customerReads < 2) {
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(page([]));
    });
    api.createCustomerContact.mockImplementation(() => {
      writeSucceeded = true;
      return Promise.resolve({});
    });
    api.getCustomer.mockImplementation(() => {
      customerReads += 1;
      return Promise.resolve({ ...customer, version: 4 });
    });
    const wrapper = mountPanel();
    await flushPromises();
    const fields = wrapper.findAll('form input');
    await fields[0]!.setValue('新增联系人');
    await fields[1]!.setValue('13800138000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createCustomerContact).toHaveBeenCalledTimes(1);
    expect(
      wrapper.find('[data-test="contact-refresh-readonly"]').exists(),
    ).toBe(true);
    expect(wrapper.find('form').exists()).toBe(false);

    await wrapper
      .get('[data-test="contact-refresh-readonly"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="contact-refresh-readonly"]').exists(),
    ).toBe(false);
    expect(api.createCustomerContact).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
