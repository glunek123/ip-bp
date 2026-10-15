import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { LeadDetail } from '../../api/leads';
import LeadQuickActionsPanel, {
  type FrozenLeadPush,
} from './LeadQuickActionsPanel.vue';

const api = vi.hoisted(() => ({ getLead: vi.fn(), pushLead: vi.fn() }));
vi.mock('../../api/leads', () => api);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  responsibleUserId: 'operator-1',
  teamId: null,
  shopName: '店铺',
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  needDisclose: false,
  remark: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
  leadScreenshotContentVersionIds: [],
  version: 2,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  foundAt: '2026-10-14T00:00:00.000Z',
  shopExternalId: null,
  displayNames: {
    customerName: '客户',
    rightsHolderName: '权利主体',
    responsibleUserName: '经办人',
  },
  products: [],
  capabilities: {
    edit: true,
    push: true,
    withdrawApply: false,
    evidenceDecide: false,
    transferToNotary: false,
    createEvidenceBatch: false,
  },
  evidenceDecision: null,
  pendingWithdrawalApplication: null,
  history: [],
  notaryMatters: [],
} satisfies LeadDetail;

const frozen: FrozenLeadPush = {
  leadId: 'lead-1',
  expectedVersion: 2,
  idempotencyKey: 'same-key',
  identity: 'operator-1:INTERNAL:department-1:1',
};

async function mountPanel(
  options: {
    identity?: string;
    pendingPush?: FrozenLeadPush | null;
  } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads', component: { template: '<div />' } },
      { path: '/leads/:id/edit', component: { template: '<div />' } },
      { path: '/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/leads?page=3&status=WAITING_PUSH');
  await router.isReady();
  const wrapper = mount(LeadQuickActionsPanel, {
    props: {
      leadId: 'lead-1',
      identity: options.identity ?? frozen.identity,
      pendingPush: options.pendingPush ?? null,
    },
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getLead.mockResolvedValue(lead);
  api.pushLead.mockResolvedValue({
    id: 'push-1',
    businessNo: 'LD-1',
    status: 'WAITING_REVIEW',
    version: 3,
    pushedAt: '2026-10-15T00:00:00.000Z',
    pushedByUserId: 'operator-1',
    pushedByDisplayName: '经办人',
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('LeadQuickActionsPanel', () => {
  it('reads fresh capabilities before exposing actions and keeps list page/filter on edit', async () => {
    const { wrapper } = await mountPanel();
    expect(api.getLead).toHaveBeenCalledOnce();
    const editUrl = new URL(
      wrapper.get('[data-test="quick-edit-lead"]').attributes('href')!,
      'https://internal.invalid',
    );
    expect(editUrl.searchParams.get('returnTo')).toBe(
      '/leads?page=3&status=WAITING_PUSH',
    );
    expect(wrapper.findAll('[data-test="quick-push-lead"]')).toHaveLength(1);
  });

  it('rechecks capability/version before push and sends one request on a double click', async () => {
    api.getLead
      .mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ ...lead, version: 4 });
    const { wrapper } = await mountPanel();
    const button = wrapper.get('[data-test="quick-push-lead"]');
    await Promise.all([button.trigger('click'), button.trigger('click')]);
    await flushPromises();
    expect(api.getLead).toHaveBeenCalledTimes(2);
    expect(api.pushLead).toHaveBeenCalledOnce();
    expect(api.pushLead).toHaveBeenCalledWith('lead-1', 4, expect.any(String));
    expect(wrapper.emitted('succeeded')).toHaveLength(1);
  });

  it('freezes an unknown push and retries with the exact same version and key', async () => {
    api.pushLead
      .mockRejectedValueOnce(new ApiError('network', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({
        id: 'push-1',
        businessNo: 'LD-1',
        status: 'WAITING_REVIEW',
        version: 3,
        pushedAt: '2026-10-15T00:00:00.000Z',
        pushedByUserId: 'operator-1',
        pushedByDisplayName: '经办人',
      });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    const attempt = wrapper.emitted('pending')?.[0]?.[0] as FrozenLeadPush;
    await wrapper.setProps({ pendingPush: attempt });
    expect(attempt).toEqual({
      leadId: 'lead-1',
      expectedVersion: 2,
      idempotencyKey: expect.any(String),
      identity: frozen.identity,
    });
    expect(
      wrapper.get('[data-test="close-quick-actions"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.findAll('[data-test="retry-unknown-push"]')).toHaveLength(1);
    await wrapper.get('[data-test="retry-unknown-push"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).toHaveBeenNthCalledWith(
      1,
      'lead-1',
      2,
      attempt.idempotencyKey,
    );
    expect(api.pushLead).toHaveBeenNthCalledWith(
      2,
      'lead-1',
      2,
      attempt.idempotencyKey,
    );
    expect(wrapper.emitted('pending')?.at(-1)?.[0]).toBeNull();
  });

  it('does not expose stale details or retry a frozen request under another identity', async () => {
    const { wrapper } = await mountPanel({
      identity: 'operator-2:INTERNAL:department-2:1',
      pendingPush: frozen,
    });
    expect(api.getLead).not.toHaveBeenCalled();
    expect(
      wrapper.get('[data-test="retry-unknown-push"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.findAll('[data-test="quick-edit-lead"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-test="quick-push-lead"]')).toHaveLength(0);
  });

  it('ignores a late detail response after switching the active case', async () => {
    let resolveOld!: (value: LeadDetail) => void;
    api.getLead
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...lead, id: 'lead-2', businessNo: 'LD-2' });
    const { wrapper } = await mountPanel();
    await wrapper.setProps({ leadId: 'lead-2' });
    await flushPromises();
    expect(wrapper.text()).toContain('LD-2');
    resolveOld(lead);
    await flushPromises();
    expect(wrapper.text()).toContain('LD-2');
    expect(wrapper.text()).not.toContain('LD-1');
  });

  it('does not offer push after the fresh capability check revokes it', async () => {
    api.getLead.mockResolvedValueOnce(lead).mockResolvedValueOnce({
      ...lead,
      version: 3,
      capabilities: { ...lead.capabilities, push: false },
    });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    expect(api.getLead).toHaveBeenCalledTimes(2);
    expect(api.pushLead).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前线索已不能推送');
  });

  it('does not submit when it cannot persist the retry identity first', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="quick-push-lead"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('尚未发起推送');
    expect(wrapper.emitted('pending')).toBeUndefined();
  });
});
