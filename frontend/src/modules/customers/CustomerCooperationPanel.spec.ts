import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerCooperationPanel from './CustomerCooperationPanel.vue';
import type { CustomerDetail } from '../../api/customers';
import { ApiError } from '../../api/http';

const api = vi.hoisted(() => ({
  changeCustomerCooperation: vi.fn(),
  transferCustomerResponsible: vi.fn(),
  listEligibleOperators: vi.fn(),
  getCustomer: vi.fn(),
}));
vi.mock('../../api/customer-cooperation', () => api);
vi.mock('../../api/customers', () => ({ getCustomer: api.getCustomer }));

const actor = { userId: 'user-a', departmentId: 'department-a' };
const customer = {
  id: 'customer-a',
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
  profileStatus: 'draft' as const,
  cooperationStatus: 'COOPERATING' as const,
  departmentId: actor.departmentId,
  responsibleUserId: actor.userId,
  version: 3,
  updatedAt: '2026-10-09T01:00:00.000Z',
  responsibleOperator: { id: actor.userId, displayName: '运营甲' },
  cooperationCapabilities: {
    transfer: false,
    pause: true,
    terminate: true,
    resume: false,
  },
  capabilities: { editRoutine: true, admit: true },
  history: [],
};

function mountPanel(
  current: CustomerDetail = customer,
  identity: typeof actor | null = actor,
) {
  return mount(CustomerCooperationPanel, {
    props: {
      customer: current,
      actor: identity,
      blockedByOtherMaintenance: false,
    },
  });
}

beforeEach(() => {
  globalThis.sessionStorage.clear();
  vi.resetAllMocks();
  vi.stubGlobal('crypto', { randomUUID: () => 'generated-key' });
});

describe('CustomerCooperationPanel', () => {
  it('shows only actions allowed by current capabilities and status', () => {
    const wrapper = mountPanel({
      ...customer,
      cooperationCapabilities: {
        transfer: false,
        pause: false,
        terminate: false,
        resume: true,
      },
    });
    expect(wrapper.find('[data-test="pause-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="transfer-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="resume-open"]').exists()).toBe(false);
    wrapper.unmount();
    const paused = mountPanel({
      ...customer,
      cooperationStatus: 'PAUSED',
      cooperationCapabilities: {
        transfer: false,
        pause: true,
        terminate: true,
        resume: true,
      },
    });
    expect(paused.find('[data-test="pause-open"]').exists()).toBe(false);
    expect(paused.find('[data-test="resume-open"]').exists()).toBe(true);
    expect(paused.find('[data-test="terminate-open"]').exists()).toBe(true);
  });

  it('blocks maintenance when another customer write is unresolved', () => {
    const wrapper = mount(CustomerCooperationPanel, {
      props: {
        customer,
        actor,
        blockedByOtherMaintenance: true,
      },
    });
    expect(wrapper.text()).toContain('其他客户维护结果尚未确认');
    expect(wrapper.find('[data-test="maintenance-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="pause-open"]').exists()).toBe(false);
  });

  it('keeps a BUSY result under its original body and key, then leaves after success without read access', async () => {
    api.changeCustomerCooperation
      .mockRejectedValueOnce({ status: 409, code: 'CUSTOMER_MAINTENANCE_BUSY' })
      .mockResolvedValueOnce({
        customerId: 'customer-a',
        action: 'pause',
        resultVersion: 4,
        occurredAt: '2026-10-09T02:00:00.000Z',
        canReadAfter: false,
      });
    const wrapper = mountPanel();
    await wrapper.get('[data-test="pause-open"]').trigger('click');
    await wrapper.get('[data-test="maintenance-reason"]').setValue('暂停原因');
    await wrapper.get('[data-test="maintenance-submit"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('原请求已保留');
    const frozen = JSON.parse(
      globalThis.sessionStorage.getItem(
        'customer-maintenance:user-a:department-a:customer-a:pause',
      ) ?? 'null',
    ) as { key: string; body: unknown };
    expect(frozen.key).toBe('generated-key');
    expect(frozen.body).toEqual({
      expectedVersion: 3,
      action: 'pause',
      reason: '暂停原因',
    });
    await wrapper.get('[data-test="maintenance-submit"]').trigger('submit');
    await flushPromises();
    expect(api.changeCustomerCooperation).toHaveBeenNthCalledWith(
      2,
      'customer-a',
      { expectedVersion: 3, action: 'pause', reason: '暂停原因' },
      'generated-key',
    );
    expect(api.getCustomer).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前账号已无法继续查看客户资料');
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('reports write success when the current detail refresh fails and allows read-only retry', async () => {
    api.changeCustomerCooperation.mockResolvedValue({
      customerId: 'customer-a',
      action: 'pause',
      resultVersion: 4,
      occurredAt: '2026-10-09T02:00:00.000Z',
      canReadAfter: true,
    });
    api.getCustomer
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...customer,
        version: 4,
        cooperationStatus: 'PAUSED',
      });
    const wrapper = mountPanel();
    await wrapper.get('[data-test="pause-open"]').trigger('click');
    await wrapper.get('[data-test="maintenance-reason"]').setValue('暂停原因');
    await wrapper.get('[data-test="maintenance-submit"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('维护已成功，当前资料刷新失败');
    expect(
      wrapper.find('[data-test="maintenance-refresh-readonly"]').exists(),
    ).toBe(true);
    expect(api.changeCustomerCooperation).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="maintenance-refresh-readonly"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('客户维护已成功，资料已刷新');
  });

  it('restores an unknown request only for the matching actor and freezes the input', async () => {
    const record = {
      action: 'pause',
      userId: actor.userId,
      departmentId: actor.departmentId,
      customerId: customer.id,
      expectedVersion: 2,
      body: { expectedVersion: 2, action: 'pause', reason: '原原因' },
      key: 'saved-key',
    };
    globalThis.sessionStorage.setItem(
      'customer-maintenance:user-a:department-a:customer-a:pause',
      JSON.stringify(record),
    );
    const wrapper = mountPanel({ ...customer, version: 9 });
    expect(wrapper.text()).toContain('原请求已保留');
    expect(
      wrapper.get('[data-test="maintenance-reason"]').element,
    ).toHaveProperty('disabled', true);
    api.changeCustomerCooperation.mockRejectedValue({
      status: 404,
      code: 'CUSTOMER_NOT_FOUND',
    });
    await wrapper.get('[data-test="maintenance-submit"]').trigger('submit');
    await flushPromises();
    expect(api.changeCustomerCooperation).toHaveBeenCalledWith(
      customer.id,
      record.body,
      'saved-key',
    );
    expect(globalThis.sessionStorage.length).toBe(1);
  });

  it('does not send when session storage cannot save the exact request', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });
    const wrapper = mountPanel();
    await wrapper.get('[data-test="pause-open"]').trigger('click');
    await wrapper.get('[data-test="maintenance-reason"]').setValue('暂停原因');
    await wrapper.get('[data-test="maintenance-submit"]').trigger('submit');
    await flushPromises();
    expect(api.changeCustomerCooperation).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('无法保存维护请求');
  });

  it('retains the original request after a forbidden replay', async () => {
    globalThis.sessionStorage.setItem(
      'customer-maintenance:user-a:department-a:customer-a:pause',
      JSON.stringify({
        action: 'pause',
        userId: actor.userId,
        departmentId: actor.departmentId,
        customerId: customer.id,
        expectedVersion: 3,
        body: { expectedVersion: 3, action: 'pause', reason: '暂停原因' },
        key: 'saved-key',
      }),
    );
    api.changeCustomerCooperation.mockRejectedValue(
      new ApiError('forbidden', 403, 'FORBIDDEN'),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="maintenance-submit"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('原请求已保留');
    expect(globalThis.sessionStorage.length).toBe(1);
    expect(wrapper.emitted('accessUncertain')).toEqual([[customer.id]]);
    expect(api.changeCustomerCooperation).toHaveBeenCalledWith(
      customer.id,
      { expectedVersion: 3, action: 'pause', reason: '暂停原因' },
      'saved-key',
    );
  });

  it('drops a late candidate response after the actor changes', async () => {
    let resolveCandidates!: (value: unknown) => void;
    api.listEligibleOperators.mockReturnValue(
      new Promise((resolve) => {
        resolveCandidates = resolve;
      }),
    );
    const wrapper = mountPanel({
      ...customer,
      cooperationCapabilities: {
        ...customer.cooperationCapabilities,
        transfer: true,
      },
    });
    await wrapper.get('[data-test="transfer-open"]').trigger('click');
    await wrapper.setProps({
      actor: { userId: 'user-b', departmentId: 'department-b' },
    });
    resolveCandidates({
      items: [{ id: 'operator-a', displayName: 'A账号候选', teamName: null }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('A账号候选');
  });
});
