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

const detail = (
  id: string,
  fee: string | null = '10.00',
  stage = 'WAITING_RETURN',
) => ({
  id,
  stage,
  version: 5,
  capabilities: {
    recordEvidence: false,
    recordOpening: false,
    reviewOpening: false,
    decideIssuance: false,
    archiveReturn: stage === 'WAITING_RETURN',
    archiveMatter: stage !== 'ARCHIVED',
  },
  evidence: {
    sampleFeeState: fee ? 'KNOWN' : 'PENDING',
    sampleFeeAmount: fee,
  },
  fees: { notary: { state: 'KNOWN', amount: '10.00' } },
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

async function mountPanel(
  ids = ['matter-1', 'matter-2'],
  stage = 'WAITING_RETURN',
) {
  const auth = prepareAuth();
  api.get.mockImplementation((id: string) =>
    Promise.resolve(detail(id, id === 'matter-1' ? '10.00' : null, stage)),
  );
  const wrapper = mount(NotaryReturnArchiveBatchPanel, {
    props: {
      matterIds: ids,
      scopeKey: `user-1:department-1:${stage}`,
    },
  });
  await flushPromises();
  return { wrapper, auth };
}

async function fillArchive(
  wrapper: ReturnType<typeof mount>,
  id: string,
  type = 'NO_EVIDENCE',
  reason = `归档 ${id}`,
  notaryFee = '120.00',
  sampleFee = '35.00',
) {
  await wrapper.get(`[data-test="notary-fee-${id}"]`).setValue(notaryFee);
  await wrapper.get(`[data-test="sample-fee-${id}"]`).setValue(sampleFee);
  await wrapper.get(`[data-test="archive-type-${id}"]`).setValue(type);
  await wrapper.get(`[data-test="reason-${id}"]`).setValue(reason);
}

afterEach(() => vi.resetAllMocks());

describe('NotaryReturnArchiveBatchPanel', () => {
  it('reads each selected matter and requires its own fees, date, type, and reason', async () => {
    const { wrapper } = await mountPanel();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('NT-matter-1');
    expect(wrapper.text()).toContain('样品费事实：10.00 元');
    expect(wrapper.text()).toContain('样品费事实：待定');
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(0);
    expect(
      wrapper.get('[data-test="batch-submit"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.find('[data-test="archive-date-matter-1"]').exists()).toBe(
      true,
    );
  });

  it('fills blank reasons while keeping each matter editable', async () => {
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="reason-matter-1"]').setValue('已填写原因');
    await wrapper.get('[data-test="shared-reason"]').setValue('共用原因');
    await wrapper.get('[data-test="fill-blank-reasons"]').trigger('click');
    expect(
      (
        wrapper.get('[data-test="reason-matter-1"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe('已填写原因');
    expect(
      (
        wrapper.get('[data-test="reason-matter-2"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe('共用原因');
    await wrapper.get('[data-test="reason-matter-2"]').setValue('逐项改写');
    expect(
      (
        wrapper.get('[data-test="reason-matter-2"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe('逐项改写');
  });

  it('aborts detail reads when the stage changes or the panel closes', async () => {
    const signals: AbortSignal[] = [];
    api.get.mockImplementation(
      (_id: string, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        return new Promise(() => undefined);
      },
    );
    prepareAuth();
    const wrapper = mount(NotaryReturnArchiveBatchPanel, {
      props: {
        matterIds: ['matter-1'],
        scopeKey: 'user-1:department-1:WAITING_RETURN',
      },
    });
    await flushPromises();
    await wrapper.setProps({
      scopeKey: 'user-1:department-1:ISSUANCE_DECISION',
    });
    expect(signals[0]?.aborted).toBe(true);
    wrapper.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('keeps each matter fee and archive fact separate in the request', async () => {
    const { wrapper } = await mountPanel();
    await fillArchive(
      wrapper,
      'matter-1',
      'LINK_REMOVED',
      '链接已下架',
      '120.00',
      '35.00',
    );
    await fillArchive(
      wrapper,
      'matter-2',
      'RECEIVED_KEEP',
      '实际收货留存',
      '230.00',
      '48.00',
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const [items] = api.archive.mock.calls[0] as [
      Array<Record<string, unknown>>,
      string,
    ];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      matterId: 'matter-1',
      returnChoice: 'KEEP',
      archiveType: 'LINK_REMOVED',
      archiveReason: '链接已下架',
      notaryFeeAmount: '120.00',
      sampleFeeAmount: '35.00',
      expectedVersion: 5,
    });
    expect(items[1]).toMatchObject({
      matterId: 'matter-2',
      returnChoice: 'KEEP',
      archiveType: 'RECEIVED_KEEP',
      archiveReason: '实际收货留存',
      notaryFeeAmount: '230.00',
      sampleFeeAmount: '48.00',
      expectedVersion: 5,
    });
    expect(items[0]?.archiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(workflow.notify).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('completed')).toHaveLength(1);
  });

  it('records the applicable refund separately and does not invent freight for refund-only', async () => {
    const { wrapper } = await mountPanel(['matter-1']);
    await fillArchive(
      wrapper,
      'matter-1',
      'NOT_SHIPPED_REFUND_ONLY',
      '未发货退款',
    );
    await wrapper.get('[data-test="refund-amount-matter-1"]').setValue('20');
    await wrapper
      .get('[data-test="refund-party-matter-1"]')
      .setValue('MERCHANT');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const [items] = api.archive.mock.calls[0] as [
      Array<Record<string, unknown>>,
      string,
    ];
    expect(items[0]).toMatchObject({
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'KNOWN', amount: '20.00', partyKind: 'MERCHANT' },
    });
    expect(items[0]).not.toHaveProperty('freight');
  });

  it('does not submit a partial batch when an item fails validation', async () => {
    const { wrapper } = await mountPanel(['matter-1']);
    await wrapper.get('[data-test="notary-fee-matter-1"]').setValue('');
    await wrapper.get('[data-test="sample-fee-matter-1"]').setValue('');
    await wrapper
      .get('[data-test="archive-type-matter-1"]')
      .setValue('NO_EVIDENCE');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('归档原因');
    await wrapper.get('form').trigger('submit');
    expect(api.archive).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请输入有效公证费');
    expect(wrapper.text()).toContain('请输入有效样品费');
  });

  it('submits early archive without a return choice', async () => {
    const { wrapper } = await mountPanel(['matter-1'], 'ISSUANCE_DECISION');
    await fillArchive(
      wrapper,
      'matter-1',
      'NO_INFRINGEMENT_INFORMATION',
      '复核后归档',
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const [items] = api.archive.mock.calls[0] as [
      Array<Record<string, unknown>>,
      string,
    ];
    expect(items[0]).toMatchObject({
      matterId: 'matter-1',
      archiveType: 'NO_INFRINGEMENT_INFORMATION',
      archiveReason: '复核后归档',
    });
    expect(items[0]).not.toHaveProperty('returnChoice');
  });

  it('freezes an unknown result and retries the same body and idempotency key', async () => {
    api.archive
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockResolvedValueOnce({ batchId: 'batch-1', items: [] });
    const { wrapper } = await mountPanel(['matter-1']);
    await fillArchive(wrapper, 'matter-1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('结果尚未确认');
    const firstCall = api.archive.mock.calls[0];
    await wrapper.get('[data-test="batch-retry"]').trigger('click');
    await flushPromises();
    expect(api.archive).toHaveBeenCalledTimes(2);
    expect(api.archive.mock.calls[1]).toEqual(firstCall);
    expect(workflow.notify).toHaveBeenCalledTimes(1);
  });

  it('keeps deterministic business rejections outside the unknown retry path', async () => {
    api.archive.mockRejectedValueOnce(
      new ApiError('事项已变化', 409, 'VERSION_CONFLICT'),
    );
    const { wrapper } = await mountPanel(['matter-1']);
    await fillArchive(wrapper, 'matter-1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('整批未保存，请重新读取事项后修正');
    expect(wrapper.find('[data-test="batch-retry"]').exists()).toBe(false);
    expect(workflow.notify).not.toHaveBeenCalled();
  });
});
