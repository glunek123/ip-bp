import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lead } from '../../api/leads';
import { ApiError } from '../../api/http';
import { savePendingLeadBatchPush } from './lead-batch-push-recovery';

const api = vi.hoisted(() => ({ pushLeadsBatch: vi.fn() }));
vi.mock('../../api/leads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/leads')>()),
  pushLeadsBatch: api.pushLeadsBatch,
}));
import LeadBatchPushPanel from './LeadBatchPushPanel.vue';

const lead = (
  id: string,
  customerName: string,
  customerId = customerName.toLowerCase(),
): Lead => ({
  id,
  businessNo: id,
  departmentId: 'dept',
  customerId,
  rightsHolderId: 'holder',
  responsibleUserId: 'actor',
  displayNames: {
    customerName,
    rightsHolderName: 'Holder',
    responsibleUserName: 'Operator',
  },
  teamId: null,
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-20T03:00:00Z',
  shopName: 'Shop',
  shopExternalId: null,
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
  createdAt: '2026-09-21T04:00:00Z',
  updatedAt: '2026-09-21T04:00:00Z',
  products: [],
});

describe('LeadBatchPushPanel', () => {
  beforeEach(() => {
    api.pushLeadsBatch.mockReset();
    globalThis.localStorage.clear();
  });

  it('shows safe failure indexes and codes for a rejected batch', async () => {
    globalThis.localStorage.clear();
    api.pushLeadsBatch.mockRejectedValueOnce(
      new ApiError('rejected', 409, 'BATCH_PUSH_REJECTED', undefined, {
        failures: [
          { index: 1, code: 'NOT_AVAILABLE' },
          { index: 0, code: 'VERSION_CONFLICT' },
          { index: 7, code: 'PRIVATE_DETAIL' },
        ],
      }),
    );
    const wrapper = mount(LeadBatchPushPanel, {
      props: {
        leads: [
          lead('33333333-3333-4333-8333-333333333333', 'Acme'),
          lead('44444444-4444-4444-8444-444444444444', 'Acme'),
        ],
        identity: 'actor:INTERNAL:dept',
        contextGeneration: '1',
      },
    });
    await wrapper.get('[data-test="batch-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('2');
    expect(wrapper.text()).toContain('NOT_AVAILABLE');
    expect(wrapper.text()).toContain('VERSION_CONFLICT');
    expect(wrapper.text()).not.toContain('PRIVATE_DETAIL');
  });

  it('keeps a recovered pre-send snapshot unknown after permission loss', async () => {
    globalThis.localStorage.clear();
    const pending = {
      identity: 'actor:INTERNAL:dept',
      idempotencyKey: 'the-original-key',
      items: [
        { leadId: '33333333-3333-4333-8333-333333333333', expectedVersion: 2 },
      ],
      uncertain: false,
    };
    expect(savePendingLeadBatchPush({ [pending.identity]: pending })).toBe(
      true,
    );
    api.pushLeadsBatch.mockRejectedValueOnce(
      new ApiError('unavailable', 409, 'BATCH_PUSH_REJECTED', undefined, {
        failures: [{ index: 0, code: 'NOT_AVAILABLE' }],
      }),
    );
    const wrapper = mount(LeadBatchPushPanel, {
      props: {
        leads: [lead('33333333-3333-4333-8333-333333333333', 'Acme')],
        identity: 'actor:INTERNAL:dept',
        contextGeneration: '1',
        pending,
      },
    });
    await wrapper.get('[data-test="batch-submit"]').trigger('click');
    await flushPromises();
    expect(api.pushLeadsBatch).toHaveBeenCalledWith(
      pending.items,
      'the-original-key',
    );
    expect(wrapper.emitted('pending')?.at(-1)?.[0]).toEqual({
      ...pending,
      uncertain: true,
    });
    expect(
      globalThis.localStorage.getItem('lead-batch-push-pending-v1'),
    ).toContain('the-original-key');
  });

  it('shows selected count and customer group counts and submits one frozen batch', async () => {
    api.pushLeadsBatch.mockResolvedValueOnce({ items: [] });
    const wrapper = mount(LeadBatchPushPanel, {
      props: {
        leads: [
          lead('33333333-3333-4333-8333-333333333333', 'Acme'),
          lead('44444444-4444-4444-8444-444444444444', 'Acme'),
          lead('55555555-5555-4555-8555-555555555555', 'Beta'),
        ],
        identity: 'actor:INTERNAL:dept',
        contextGeneration: '1',
      },
    });
    expect(wrapper.get('[data-test="batch-count"]').text()).toContain('3');
    expect(wrapper.text()).toContain('Acme：2 条');
    expect(wrapper.text()).toContain('Beta：1 条');
    await wrapper.get('[data-test="batch-submit"]').trigger('click');
    await flushPromises();
    expect(api.pushLeadsBatch).toHaveBeenCalledTimes(1);
    expect(api.pushLeadsBatch.mock.calls[0]![0]).toEqual([
      { leadId: '33333333-3333-4333-8333-333333333333', expectedVersion: 2 },
      { leadId: '44444444-4444-4444-8444-444444444444', expectedVersion: 2 },
      { leadId: '55555555-5555-4555-8555-555555555555', expectedVersion: 2 },
    ]);
    expect(wrapper.emitted('succeeded')).toHaveLength(1);
  });

  it('keeps same-name customers in separate groups by customer identity', () => {
    const wrapper = mount(LeadBatchPushPanel, {
      props: {
        leads: [
          lead(
            '66666666-6666-4666-8666-666666666666',
            'Same Name',
            'customer-a',
          ),
          lead(
            '77777777-7777-4777-8777-777777777777',
            'Same Name',
            'customer-b',
          ),
        ],
        identity: 'actor:INTERNAL:dept',
        contextGeneration: '1',
      },
    });
    expect(wrapper.findAll('[data-test="customer-group"]')).toHaveLength(2);
  });
});
