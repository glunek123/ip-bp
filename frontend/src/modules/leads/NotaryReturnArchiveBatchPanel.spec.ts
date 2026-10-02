import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';

const api = vi.hoisted(() => ({ get: vi.fn(), archive: vi.fn() }));
const workflow = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../../api/notary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/notary')>()),
  getNotaryMatter: api.get,
}));
vi.mock('../../api/notary-return-archive-batch', () => ({
  archiveNotaryReturnBatch: api.archive,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: workflow.notify,
}));

import NotaryReturnArchiveBatchPanel from './NotaryReturnArchiveBatchPanel.vue';

const detail = (id: string, fee: string | null = '10.00') => ({
  id,
  stage: 'WAITING_RETURN',
  version: 5,
  capabilities: {
    recordEvidence: false,
    recordOpening: false,
    reviewOpening: false,
    decideIssuance: false,
    archiveReturn: true,
  },
  evidence: {
    sampleFeeState: fee ? 'KNOWN' : 'PENDING',
    sampleFeeAmount: fee,
  },
  issuanceDecision: { decision: 'NO_ISSUE' },
  businessNo: `NT-${id}`,
});

function prepareAuth() {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'user-1', displayName: '运营', username: 'operator' },
    department: { id: 'department-1', name: '知产部' },
    departments: [{ id: 'department-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00.000Z',
    csrfToken: 'csrf-token',
  };
  auth.restored = true;
  return auth;
}

async function mountPanel(ids = ['matter-1', 'matter-2']) {
  const auth = prepareAuth();
  api.get.mockImplementation((id: string) =>
    Promise.resolve(detail(id, id === 'matter-1' ? '10.00' : null)),
  );
  const wrapper = mount(NotaryReturnArchiveBatchPanel, {
    props: { matterIds: ids, scopeKey: 'user-1:department-1:WAITING_RETURN' },
  });
  await flushPromises();
  return { wrapper, auth };
}

afterEach(() => vi.resetAllMocks());

describe('NotaryReturnArchiveBatchPanel', () => {
  it('reads every selected matter and shows its own known or pending fee', async () => {
    const { wrapper } = await mountPanel();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain('NT-matter-1');
    expect(wrapper.text()).toContain('样品费事实：10.00 元');
    expect(wrapper.text()).toContain('样品费事实：待定');
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(0);
    expect(
      wrapper.get('[data-test="batch-submit"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('freezes and explicitly retries an unknown result with the same body and key', async () => {
    api.archive
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockResolvedValueOnce({ batchId: 'batch-1', items: [] });
    const { wrapper } = await mountPanel();
    for (const id of ['matter-1', 'matter-2']) {
      await wrapper.get(`[data-test="choice-${id}"]`).setValue('KEEP');
      await wrapper.get(`[data-test="reason-${id}"]`).setValue(`保留${id}`);
    }
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('结果尚未确认');
    expect(
      wrapper
        .get('[data-test="reason-matter-1"]')
        .element.closest('fieldset')
        ?.hasAttribute('disabled'),
    ).toBe(true);
    const [firstItems, firstKey] = api.archive.mock.calls[0] as [
      unknown,
      string,
    ];
    await wrapper.get('[data-test="batch-retry"]').trigger('click');
    await flushPromises();
    expect(api.archive).toHaveBeenCalledTimes(2);
    expect(api.archive.mock.calls[1]).toEqual([firstItems, firstKey]);
    expect(workflow.notify).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('completed')).toHaveLength(1);
  });

  it.each([400, 403, 404, 409])(
    'keeps deterministic HTTP %i rejections outside the unknown retry path',
    async (status) => {
      api.archive.mockRejectedValue(
        new ApiError('拒绝', status, 'VERSION_CONFLICT'),
      );
      const { wrapper } = await mountPanel(['matter-1']);
      await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
      await wrapper.get('[data-test="reason-matter-1"]').setValue('完成');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.text()).toContain('请重新读取事项后再提交');
      expect(wrapper.find('[data-test="batch-retry"]').exists()).toBe(false);
      expect(workflow.notify).not.toHaveBeenCalled();
    },
  );

  it('submits distinct per-matter amounts, payees, and pending freight facts', async () => {
    api.archive.mockRejectedValueOnce(new TypeError('network disconnected'));
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="choice-matter-1"]').setValue('RETURN');
    await wrapper.get('[data-test="refund-state-matter-1"]').setValue('KNOWN');
    await wrapper.get('[data-test="refund-amount-matter-1"]').setValue('55.25');
    await wrapper
      .get('[data-test="refund-party-matter-1"]')
      .setValue('MERCHANT');
    await wrapper
      .get('[data-test="freight-state-matter-1"]')
      .setValue('PENDING');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('退回样品');
    await wrapper.get('[data-test="choice-matter-2"]').setValue('REFUND_ONLY');
    await wrapper.get('[data-test="refund-state-matter-2"]').setValue('KNOWN');
    await wrapper.get('[data-test="refund-amount-matter-2"]').setValue('60.00');
    await wrapper.get('[data-test="refund-party-matter-2"]').setValue('OTHER');
    await wrapper
      .get('[data-test="refund-party-name-matter-2"]')
      .setValue('客户乙');
    await wrapper.get('[data-test="reason-matter-2"]').setValue('仅退款');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.archive.mock.calls[0]?.[0]).toEqual([
      {
        matterId: 'matter-1',
        returnChoice: 'RETURN',
        refund: { state: 'KNOWN', amount: '55.25', partyKind: 'MERCHANT' },
        freight: { state: 'PENDING' },
        archiveReason: '退回样品',
        expectedVersion: 5,
      },
      {
        matterId: 'matter-2',
        returnChoice: 'REFUND_ONLY',
        refund: {
          state: 'KNOWN',
          amount: '60.00',
          partyKind: 'OTHER',
          partyName: '客户乙',
        },
        archiveReason: '仅退款',
        expectedVersion: 5,
      },
    ]);
    expect(workflow.notify).not.toHaveBeenCalled();
  });

  it('requires each applicable amount state and does not prefill a zero amount', async () => {
    const { wrapper } = await mountPanel(['matter-1']);
    await wrapper.get('[data-test="choice-matter-1"]').setValue('RETURN');
    expect(
      (
        wrapper.get('[data-test="refund-state-matter-1"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe('');
    expect(wrapper.text()).toContain('请选择退款金额状态');
    await wrapper.get('[data-test="refund-state-matter-1"]').setValue('KNOWN');
    expect(
      wrapper.get('[data-test="refund-amount-matter-1"]').element,
    ).toHaveProperty('value', '');
    expect(
      wrapper.get('[data-test="batch-submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="reason-matter-1"]').setValue('退回');
    await wrapper.get('form').trigger('submit');
    expect(api.archive).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('退款金额请输入非负且保留两位小数的金额');
    expect(wrapper.text()).toContain('请选择运费状态');
  });

  it('blocks an empty selection, a selection above 50, and an item without archive capability', async () => {
    api.get.mockClear();
    const emptySelection = await mountPanel([]);
    expect(emptySelection.wrapper.text()).toContain('选择1至50项');
    expect(api.get).not.toHaveBeenCalled();
    emptySelection.wrapper.unmount();

    const tooMany = await mountPanel(
      Array.from({ length: 51 }, (_, i) => `id-${i}`),
    );
    expect(tooMany.wrapper.text()).toContain('最多归档50项');
    expect(api.get).not.toHaveBeenCalled();
    tooMany.wrapper.unmount();

    api.get.mockResolvedValueOnce({
      ...detail('matter-1'),
      capabilities: {
        ...detail('matter-1').capabilities,
        archiveReturn: false,
      },
    });
    const unavailable = await mountPanel(['matter-1']);
    expect(unavailable.wrapper.text()).toContain('无权归档');
    expect(
      unavailable.wrapper.find('[data-test="batch-submit"]').exists(),
    ).toBe(false);
    expect(api.archive).not.toHaveBeenCalled();
  });

  it('aborts detail reads on unmount and discards reads from a changed stage', async () => {
    prepareAuth();
    let resolveFirst!: (value: ReturnType<typeof detail>) => void;
    let resolveSecond!: (value: ReturnType<typeof detail>) => void;
    api.get
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      );
    const wrapper = mount(NotaryReturnArchiveBatchPanel, {
      props: {
        matterIds: ['matter-1'],
        scopeKey: 'user-1:department-1:WAITING_RETURN',
      },
    });
    const firstSignal = (api.get.mock.calls[0]?.[1] as { signal: AbortSignal })
      .signal;
    await wrapper.setProps({
      matterIds: ['matter-2'],
      scopeKey: 'user-1:department-1:ARCHIVED',
    });
    expect(firstSignal.aborted).toBe(true);
    resolveSecond(detail('matter-2'));
    await flushPromises();
    resolveFirst(detail('matter-1'));
    await flushPromises();
    expect(wrapper.text()).toContain('NT-matter-2');
    expect(wrapper.text()).not.toContain('NT-matter-1');
    wrapper.unmount();

    api.get.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const removed = mount(NotaryReturnArchiveBatchPanel, {
      props: {
        matterIds: ['matter-3'],
        scopeKey: 'user-1:department-1:WAITING_RETURN',
      },
    });
    const unmountSignal = (
      api.get.mock.calls.at(-1)?.[1] as { signal: AbortSignal }
    ).signal;
    removed.unmount();
    expect(unmountSignal.aborted).toBe(true);
    resolveFirst(detail('matter-3'));
    await flushPromises();
  });

  it.each([
    ['user-2:department-1:WAITING_RETURN', '账号变化'],
    ['user-1:department-2:WAITING_RETURN', '部门变化'],
    ['user-1:department-1:ARCHIVED', '阶段变化'],
  ])('aborts and discards detail reads after %s', async (nextScope) => {
    prepareAuth();
    let resolveFirst!: (value: ReturnType<typeof detail>) => void;
    let resolveSecond!: (value: ReturnType<typeof detail>) => void;
    api.get
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      );
    const wrapper = mount(NotaryReturnArchiveBatchPanel, {
      props: {
        matterIds: ['matter-1'],
        scopeKey: 'user-1:department-1:WAITING_RETURN',
      },
    });
    const staleSignal = (api.get.mock.calls[0]?.[1] as { signal: AbortSignal })
      .signal;
    await wrapper.setProps({ scopeKey: nextScope });
    expect(staleSignal.aborted).toBe(true);
    resolveSecond(detail('matter-1'));
    await flushPromises();
    resolveFirst(detail('matter-1'));
    await flushPromises();
    expect(wrapper.find('[data-test="batch-submit"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps a server 500 result unknown for explicit same-key retry', async () => {
    api.archive.mockRejectedValueOnce(
      new ApiError('内部错误', 500, 'INTERNAL_ERROR'),
    );
    const { wrapper } = await mountPanel(['matter-1']);
    await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('完成');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('结果尚未确认');
    expect(wrapper.find('[data-test="batch-retry"]').exists()).toBe(true);
    expect(workflow.notify).not.toHaveBeenCalled();
  });

  it('drops a late successful submission after the identity or stage changes', async () => {
    let resolveArchive!: (value: { batchId: string; items: [] }) => void;
    api.archive.mockImplementation(
      () => new Promise((resolve) => (resolveArchive = resolve)),
    );
    const { wrapper } = await mountPanel(['matter-1']);
    await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('完成');
    await wrapper.get('form').trigger('submit');
    expect(api.archive).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ scopeKey: 'user-2:department-2:WAITING_RETURN' });
    resolveArchive({ batchId: 'batch-1', items: [] });
    await flushPromises();
    expect(workflow.notify).not.toHaveBeenCalled();
    expect(wrapper.emitted('completed')).toBeUndefined();
    expect(
      wrapper.get('[data-test="batch-retry"]').attributes('disabled'),
    ).toBeDefined();
  });
});
