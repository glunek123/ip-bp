import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadDetail } from '../../api/leads';
import {
  readPendingLeadNoEvidenceBatches,
  savePendingLeadNoEvidenceBatches,
  type FrozenLeadNoEvidenceBatch,
} from './lead-no-evidence-batch-recovery';
const api = vi.hoisted(() => ({ getLead: vi.fn(), submit: vi.fn() }));
vi.mock('../../api/leads', async (original) => ({
  ...(await original<typeof import('../../api/leads')>()),
  getLead: api.getLead,
}));
vi.mock('../../api/lead-no-evidence-batch', async (original) => ({
  ...(await original<typeof import('../../api/lead-no-evidence-batch')>()),
  decideLeadNoEvidenceBatch: api.submit,
}));
import LeadNoEvidenceBatchPanel from './LeadNoEvidenceBatchPanel.vue';
const identity = 'actor:INTERNAL:department';
const id = '33333333-3333-4333-8333-333333333333';
function lead(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    id,
    businessNo: 'LD-合成001',
    departmentId: 'department',
    customerId: 'customer',
    rightsHolderId: 'holder',
    responsibleUserId: 'actor',
    teamId: null,
    status: 'WAITING_EVIDENCE_DECISION',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-10-01T00:00:00.000Z',
    shopName: '合成店铺',
    shopExternalId: null,
    needDisclose: false,
    remark: null,
    creationChannel: 'MANUAL',
    externalSourceRef: null,
    products: [],
    leadScreenshotContentVersionIds: [],
    version: 4,
    pushedAt: null,
    pushedByUserId: null,
    pushedByDisplayName: null,
    reviewDecision: {
      result: 'INFRINGEMENT',
      reviewerDisplayName: '客户甲',
      decidedAt: '2026-10-01T00:00:00.000Z',
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    displayNames: {
      customerName: '客户甲',
      rightsHolderName: '主体甲',
      responsibleUserName: '运营甲',
    },
    capabilities: {
      edit: false,
      push: false,
      evidenceDecide: true,
      withdrawApply: false,
      transferToNotary: false,
      createEvidenceBatch: false,
    },
    evidenceDecision: null,
    pendingWithdrawalApplication: null,
    history: [],
    notaryMatters: [],
    ...overrides,
  };
}
const wrappers: ReturnType<typeof mount>[] = [];
function panel(
  pending?: FrozenLeadNoEvidenceBatch,
  selected = [lead({ version: 1 })],
) {
  const wrapper = mount(LeadNoEvidenceBatchPanel, {
    props: {
      leads: selected,
      identity,
      contextGeneration: 'route:revision1',
      pending,
      beforeSubmit: () => true,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function confirm(
  wrapper: ReturnType<typeof mount>,
  reason = ' 原因原文 ',
) {
  await flushPromises();
  await wrapper.get('[data-test="no-evidence-reason-0"]').setValue(reason);
  await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
}
describe('LeadNoEvidenceBatchPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    api.getLead.mockResolvedValue(lead());
    api.submit.mockResolvedValue({ items: [] });
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.restoreAllMocks();
  });
  it('reads fresh permissions and version, persists before one atomic submit, and keeps raw reason', async () => {
    api.submit.mockImplementation(async (input, options) => {
      const saved = readPendingLeadNoEvidenceBatches()?.[identity];
      expect(saved?.input).toEqual(input);
      expect(saved?.idempotencyKey).toBe(options.headers['Idempotency-Key']);
      return { items: [] };
    });
    const wrapper = panel();
    await confirm(wrapper);
    expect(api.getLead).toHaveBeenCalledWith(id, {
      signal: expect.any(AbortSignal),
    });
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.submit).toHaveBeenCalledExactlyOnceWith(
      { items: [{ leadId: id, expectedVersion: 4, reason: ' 原因原文 ' }] },
      expect.objectContaining({
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    );
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.emitted('succeeded')).toHaveLength(1);
    expect(readPendingLeadNoEvidenceBatches()).toEqual({});
  });
  it('blocks the entire batch when any fresh detail is ineligible', async () => {
    const secondId = '44444444-4444-4444-8444-444444444444';
    api.getLead.mockImplementation(async (requestedId) =>
      lead({
        id: requestedId,
        capabilities: {
          ...lead().capabilities,
          evidenceDecide: requestedId !== secondId,
        },
      }),
    );
    const wrapper = panel(undefined, [lead(), lead({ id: secondId })]);
    await confirm(wrapper);
    expect(wrapper.text()).toContain('整批不可提交');
    expect(api.getLead).toHaveBeenCalledTimes(2);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('retains the original body/key after uncertainty and replays without a new key', async () => {
    api.submit.mockRejectedValueOnce(new Error('network'));
    const wrapper = panel();
    await confirm(wrapper);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    const saved = readPendingLeadNoEvidenceBatches()?.[identity];
    expect(saved).toBeDefined();
    expect(wrapper.text()).toContain('原始内容与请求键已保留');
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.submit.mock.calls[1]?.[0]).toEqual(saved?.input);
    expect(api.submit.mock.calls[1]?.[1].headers['Idempotency-Key']).toBe(
      saved?.idempotencyKey,
    );
  });
  it('recovery preserves old version/reason even if the first successful commit is now archived', async () => {
    const pending = {
      identity,
      idempotencyKey: 'original',
      input: { items: [{ leadId: id, expectedVersion: 2, reason: ' 原因 ' }] },
    };
    savePendingLeadNoEvidenceBatches({ [identity]: pending });
    api.getLead.mockResolvedValue(
      lead({
        status: 'ARCHIVED',
        version: 3,
        capabilities: { ...lead().capabilities, evidenceDecide: false },
      }),
    );
    const wrapper = panel(pending);
    await flushPromises();
    await wrapper.get('[data-test="no-evidence-confirm"]').setValue(true);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.submit).toHaveBeenCalledWith(
      pending.input,
      expect.objectContaining({ headers: { 'Idempotency-Key': 'original' } }),
    );
  });
  it('blocks submission if persistence fails', async () => {
    const wrapper = panel();
    await confirm(wrapper);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    expect(api.submit).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('批次未发送');
  });
  it('rechecks the host context before persistence and again before HTTP', async () => {
    const wrapper = panel();
    await confirm(wrapper);
    const guard = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    await wrapper.setProps({ beforeSubmit: guard });
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    expect(readPendingLeadNoEvidenceBatches()).toEqual({});
    expect(api.submit).not.toHaveBeenCalled();
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    expect(readPendingLeadNoEvidenceBatches()?.[identity]).toBeDefined();
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('guards duplicate clicks and preserves unknown after route/authorization change and late success', async () => {
    let resolve!: (value: unknown) => void;
    api.submit.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = panel();
    await confirm(wrapper);
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    await wrapper.get('[data-test="no-evidence-submit"]').trigger('click');
    expect(api.submit).toHaveBeenCalledTimes(1);
    const signal = api.submit.mock.calls[0]![1].signal;
    await wrapper.setProps({ contextGeneration: 'different-route' });
    expect(signal.aborted).toBe(true);
    resolve({ items: [] });
    await flushPromises();
    expect(wrapper.emitted('succeeded')).toBeUndefined();
    expect(readPendingLeadNoEvidenceBatches()?.[identity]).toBeDefined();
  });
  it('does not expose an old fresh detail after identity changes', async () => {
    let resolve!: (value: LeadDetail) => void;
    api.getLead.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = panel();
    const signal = api.getLead.mock.calls[0]![1].signal;
    api.getLead.mockRejectedValue(new Error('denied'));
    await wrapper.setProps({ identity: 'other:INTERNAL:department' });
    resolve(lead());
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('客户甲');
  });
  it('accepts 5000 emoji code points and rejects 5001', async () => {
    const wrapper = panel();
    await confirm(wrapper, '😀'.repeat(5000));
    expect(
      wrapper.get('[data-test="no-evidence-submit"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('textarea').setValue('😀'.repeat(5001));
    expect(
      wrapper.get('[data-test="no-evidence-submit"]').attributes('disabled'),
    ).toBeDefined();
  });
});
