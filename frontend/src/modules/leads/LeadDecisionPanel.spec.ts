import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { readPendingLeadDecision } from './lead-decision-recovery';
import LeadDecisionPanel from './LeadDecisionPanel.vue';

const api = vi.hoisted(() => ({ getLead: vi.fn(), post: vi.fn() }));
vi.mock('../../api/leads', () => ({ getLead: api.getLead }));
vi.mock('../../api/lead-decisions', async (load) => ({
  ...(await load<typeof import('../../api/lead-decisions')>()),
  postLeadDecision: api.post,
}));

const lead = {
  id: '10000000-0000-4000-8000-000000000001',
  businessNo: 'CASE-001',
  status: 'WAITING_REVIEW',
  capabilities: { proxyReview: true },
  version: 7,
  shopName: '店铺甲',
  source: 'ONLINE',
  platform: 'TAOBAO',
  infringementTypes: ['TRADEMARK'],
  pushedAt: '2026-11-07T18:00:00Z',
};
const identity = 'user:INTERNAL:department:1';
const mountPanel = (key = identity) =>
  mount(LeadDecisionPanel, {
    props: { leads: [lead], identity: key, kind: 'review' },
    global: {
      stubs: { ElDialog: { template: '<section><slot /></section>' } },
    },
  });

afterEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

it('retains the exact unknown request across reload and a subsequent 403', async () => {
  api.getLead.mockResolvedValue(lead);
  api.post
    .mockRejectedValueOnce(new Error('lost response'))
    .mockRejectedValueOnce(
      new ApiError('当前无权办理', 403, 'ACTION_FORBIDDEN'),
    )
    .mockResolvedValueOnce({});
  const original = mountPanel();
  await flushPromises();
  await original.get('select').setValue('INFRINGEMENT');
  await original.get('form').trigger('submit');
  await flushPromises();
  expect(original.text()).toContain('结果尚未确认');
  const attempt = readPendingLeadDecision(identity);
  expect(attempt).toMatchObject({
    body: { result: 'INFRINGEMENT', expectedVersion: 7 },
  });
  original.unmount();

  const restored = mountPanel('user:INTERNAL:department:2');
  const retry = restored
    .findAll('button')
    .find((button) => button.text() === '按原请求核对')!;
  await retry.trigger('click');
  await flushPromises();
  expect(restored.text()).toContain('原请求已保留');
  expect(readPendingLeadDecision(identity)).toEqual(attempt);
  await retry.trigger('click');
  await flushPromises();
  expect(api.post.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [
      attempt!.path,
      attempt!.body,
      attempt!.key,
    ]),
  );
  expect(readPendingLeadDecision(identity)).toBeUndefined();
  expect(restored.emitted('completed')).toHaveLength(1);
  restored.unmount();
});
