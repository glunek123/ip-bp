import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, reactive, type PropType } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { LeadDetail } from '../../api/leads';
import LeadQuickActionsPanel from './LeadQuickActionsPanel.vue';
import { readPendingLeadCommands } from './LeadListWorkflowPanel.vue';
const api = vi.hoisted(() => ({
  getLead: vi.fn(),
  pushLead: vi.fn(),
  applyLeadWithdrawal: vi.fn(),
  decideLeadNoEvidence: vi.fn(),
}));
vi.mock('../../api/leads', () => api);
const lead = {
  id: 'lead-1',
  businessNo: 'LD-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  responsibleUserId: 'operator-1',
  teamId: null,
  shopName: 'Test shop',
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
    customerName: 'Client',
    rightsHolderName: 'Holder',
    responsibleUserName: 'Operator',
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

const identity = 'operator-1:INTERNAL:department-1:1';
const DrawerStub = defineComponent({
  props: {
    modelValue: Boolean,
    beforeClose: Function as PropType<(done: () => void) => void>,
  },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h('section', { role: 'dialog' }, [
            h(
              'button',
              {
                'data-test': 'close-drawer',
                onClick: () => props.beforeClose?.(() => {}),
              },
              '关闭',
            ),
            slots.default?.(),
            slots.footer?.(),
          ])
        : null;
  },
});
const cleanups: Array<() => void> = [];
async function mountPanel() {
  const panelProps = reactive({ leadId: lead.id, identity, pendingPush: null });
  const succeeded = vi.fn(),
    closed = vi.fn();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/leads',
        component: defineComponent({
          setup: () => () =>
            h(LeadQuickActionsPanel, {
              ...panelProps,
              onSucceeded: succeeded,
              onClose: closed,
            }),
        }),
      },
      { path: '/leads/:id/edit', component: { template: '<p>Edit</p>' } },
      { path: '/other', component: { template: '<p>Other</p>' } },
    ],
  });
  await router.push('/other');
  await router.push('/leads?page=3&status=WAITING_PUSH');
  const wrapper = mount(
    { components: { RouterView }, template: '<RouterView />' },
    { global: { plugins: [router], stubs: { ElDrawer: DrawerStub } } },
  );
  cleanups.push(() => wrapper.unmount());
  await flushPromises();
  return { wrapper, router, panelProps, succeeded, closed };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.getLead.mockResolvedValue(lead);
  api.pushLead.mockResolvedValue({ id: 'receipt' });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
describe('LeadQuickActionsPanel drawer', () => {
  it('reads fresh capabilities and keeps exact list return query on independent edit', async () => {
    const { wrapper, router } = await mountPanel();
    expect(api.getLead).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-test="submit-lead-workflow"]').text()).toBe(
      '推送给客户审核',
    );
    const edit = wrapper.get('[data-test="quick-edit-lead"]');
    expect(
      new URL(
        edit.attributes('href')!,
        'https://internal.invalid',
      ).searchParams.get('returnTo'),
    ).toBe('/leads?page=3&status=WAITING_PUSH');
    await edit.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/leads/lead-1/edit');
    expect(api.pushLead).not.toHaveBeenCalled();
  });
  it('cancel closes without POST', async () => {
    const { wrapper, closed } = await mountPanel();
    await wrapper.get('[data-test="close-drawer"]').trigger('click');
    expect(closed).toHaveBeenCalledOnce();
    expect(api.pushLead).not.toHaveBeenCalled();
  });
  it('rechecks current capability/version and double click sends once', async () => {
    api.getLead
      .mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ ...lead, version: 4 });
    const { wrapper, succeeded } = await mountPanel();
    const button = wrapper.get('[data-test="submit-lead-workflow"]');
    await Promise.all([button.trigger('click'), button.trigger('click')]);
    await flushPromises();
    expect(api.pushLead).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      4,
      expect.any(String),
    );
    expect(succeeded).toHaveBeenCalledOnce();
    expect(readPendingLeadCommands()).toEqual({});
  });
  it('blocks POST after permission is withdrawn', async () => {
    api.getLead.mockResolvedValueOnce(lead).mockResolvedValueOnce({
      ...lead,
      capabilities: { ...lead.capabilities, push: false },
    });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('已不能执行此操作');
  });
  it('unknown freezes original request, blocks close and Back, restores after reload', async () => {
    api.pushLead
      .mockRejectedValueOnce(new ApiError('offline', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({ id: 'receipt' });
    const first = await mountPanel();
    await first.wrapper
      .get('[data-test="submit-lead-workflow"]')
      .trigger('click');
    await flushPromises();
    expect(readPendingLeadCommands()?.[identity]).toMatchObject({
      action: 'push',
      body: { expectedVersion: 2 },
    });
    await first.wrapper.get('[data-test="close-drawer"]').trigger('click');
    first.router.back();
    await flushPromises();
    expect(first.closed).not.toHaveBeenCalled();
    expect(first.router.currentRoute.value.path).toBe('/leads');
    first.wrapper.unmount();
    cleanups.pop();
    const second = await mountPanel();
    await second.wrapper
      .get('[data-test="retry-unknown-lead"]')
      .trigger('click');
    await flushPromises();
    expect(api.pushLead.mock.calls[1]).toEqual(api.pushLead.mock.calls[0]);
    expect(second.succeeded).toHaveBeenCalledOnce();
    expect(readPendingLeadCommands()).toEqual({});
  });
  it('restores B legacy request with original key/version after server stage already changed', async () => {
    sessionStorage.setItem(
      'dev-cor:lead-quick-actions:pending-push',
      JSON.stringify({
        [identity]: {
          identity,
          leadId: lead.id,
          expectedVersion: 1,
          idempotencyKey: 'B-key',
          status: 'PENDING',
        },
      }),
    );
    api.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_REVIEW',
      version: 7,
      capabilities: { ...lead.capabilities, push: false },
    });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="retry-unknown-lead"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).toHaveBeenCalledExactlyOnceWith(lead.id, 1, 'B-key');
    expect(readPendingLeadCommands()).toEqual({});
  });
  it.each(['identity', 'leadId'] as const)(
    'invalidates changed %s and ignores late POST success',
    async (field) => {
      let settle!: (value: unknown) => void;
      api.pushLead.mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      );
      const { wrapper, panelProps, succeeded } = await mountPanel();
      await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
      await flushPromises();
      api.getLead.mockImplementation(() => new Promise(() => {}));
      panelProps[field] = 'changed';
      await flushPromises();
      expect(wrapper.find('[data-test="lead-workflow-form"]').exists()).toBe(
        false,
      );
      settle({ id: 'receipt' });
      await flushPromises();
      expect(succeeded).not.toHaveBeenCalled();
      expect(readPendingLeadCommands()).toEqual({});
    },
  );
  it('ignores late GET after an object switch', async () => {
    let old!: (value: LeadDetail) => void;
    api.getLead
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            old = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...lead, id: 'lead-2', businessNo: 'LD-2' });
    const { wrapper, panelProps } = await mountPanel();
    const signal = api.getLead.mock.calls[0]![1].signal as AbortSignal;
    panelProps.leadId = 'lead-2';
    await flushPromises();
    old(lead);
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.text()).toContain('LD-2');
    expect(wrapper.text()).not.toContain('LD-1');
  });
  it.each([401, 403, 404])('stops on %s detail denial', async (status) => {
    api.getLead.mockRejectedValue(
      new ApiError('denied', status, 'ACTION_FORBIDDEN'),
    );
    const { wrapper } = await mountPanel();
    expect(wrapper.text()).toContain('当前无法访问');
    expect(wrapper.find('[data-test="submit-lead-workflow"]').exists()).toBe(
      false,
    );
  });
  it('does not settle a newer pending command on an older completion', async () => {
    let settle!: (value: unknown) => void;
    api.pushLead.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { wrapper, succeeded } = await mountPanel();
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    sessionStorage.setItem(
      'dev-cor:lead-workflow:pending',
      JSON.stringify({
        [identity]: {
          ...readPendingLeadCommands()![identity]!,
          idempotencyKey: 'newer-key',
        },
      }),
    );
    settle({ id: 'receipt' });
    await flushPromises();
    expect(readPendingLeadCommands()?.[identity]?.idempotencyKey).toBe(
      'newer-key',
    );
    expect(succeeded).not.toHaveBeenCalled();
  });
  it('stops before POST if durable storage fails', async () => {
    const { wrapper } = await mountPanel();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(api.pushLead).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('尚未提交');
  });
  it('recovers failed GET and permits Back/Forward when idle', async () => {
    api.getLead
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(lead);
    const { wrapper, router } = await mountPanel();
    expect(wrapper.text()).toContain('资料加载失败');
    await wrapper
      .findAll('.el-button')
      .find((button) => button.text() === '重新加载')!
      .trigger('click');
    await flushPromises();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/other');
    router.forward();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/leads');
    expect(api.pushLead).not.toHaveBeenCalled();
  });
});
