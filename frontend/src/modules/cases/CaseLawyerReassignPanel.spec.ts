import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as assignment from '../../api/case-lawyer-assignment';
import * as cases from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseLawyerReassignPanel from './CaseLawyerReassignPanel.vue';

vi.mock('../../api/cases', () => ({
  listLawyerMatchCandidates: vi.fn(),
}));
vi.mock('../../api/case-lawyer-assignment', () => ({
  assignCaseLawyer: vi.fn(),
}));

const caseId = '11111111-1111-4111-8111-111111111111';
const first = {
  lawyerAccountId: '22222222-2222-4222-8222-222222222222',
  username: 'lvshi',
  displayName: '顾言',
  lawyerProfileId: '33333333-3333-4333-8333-333333333333',
  phone: null,
  lawFirm: '远泽律师事务所',
  address: null,
};
const second = {
  ...first,
  lawyerAccountId: '44444444-4444-4444-8444-444444444444',
  displayName: '林岸',
  lawyerProfileId: '55555555-5555-4555-8555-555555555555',
  lawFirm: '海城律师事务所',
};

function receipt(lawyerAccountId: string) {
  return {
    id: caseId,
    stage: 'WAITING_COMPLAINT_CONFIRMATION' as const,
    version: 6,
    outcome: 'REASSIGNED' as const,
    requestedLawyerAccountId: lawyerAccountId,
    previousAssignment: {
      id: '66666666-6666-4666-8666-666666666666',
      lawyerProfileId: first.lawyerProfileId,
      lawyerAccountId: first.lawyerAccountId,
      assignedAt: '2026-11-10T01:44:15.810Z',
    },
    currentAssignment: {
      id: '77777777-7777-4777-8777-777777777777',
      lawyerProfileId: second.lawyerProfileId,
      lawyerAccountId: second.lawyerAccountId,
      assignedAt: '2026-11-11T05:00:00.000Z',
    },
  };
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(CaseLawyerReassignPanel, {
    props: {
      caseId,
      caseVersion: 5,
      currentLawyerNames: ['顾言'],
      ...overrides,
    },
  });
}

describe('CaseLawyerReassignPanel', () => {
  beforeEach(() => {
    vi.mocked(cases.listLawyerMatchCandidates).mockReset();
    vi.mocked(assignment.assignCaseLawyer).mockReset();
  });

  it('lists assignable lawyers and submits the chosen one', async () => {
    vi.mocked(cases.listLawyerMatchCandidates).mockResolvedValue([
      first,
      second,
    ]);
    vi.mocked(assignment.assignCaseLawyer).mockResolvedValue(
      receipt(second.lawyerAccountId),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain('顾言');
    expect(wrapper.text()).toContain('林岸');

    await wrapper
      .get(`[data-test="reassign-lawyer-${second.lawyerAccountId}"]`)
      .setValue(true);
    await wrapper.get('[data-test="reassign-submit"]').trigger('click');
    await flushPromises();

    expect(assignment.assignCaseLawyer).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({
        expectedVersion: 5,
        lawyerAccountId: second.lawyerAccountId,
        idempotencyKey: expect.any(String) as unknown as string,
      }),
    );
    expect(wrapper.emitted('completed')).toHaveLength(1);
  });

  it('reuses the same request key after an unknown result', async () => {
    vi.mocked(cases.listLawyerMatchCandidates).mockResolvedValue([second]);
    vi.mocked(assignment.assignCaseLawyer)
      .mockRejectedValueOnce(new ApiError('网络中断', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce(receipt(second.lawyerAccountId));
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper
      .get(`[data-test="reassign-lawyer-${second.lawyerAccountId}"]`)
      .setValue(true);
    await wrapper.get('[data-test="reassign-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('原请求键已保留');
    await wrapper.get('[data-test="reassign-submit"]').trigger('click');
    await flushPromises();
    const keys = vi
      .mocked(assignment.assignCaseLawyer)
      .mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('assigns a lawyer to a case that has none, with assignment copy', async () => {
    vi.mocked(cases.listLawyerMatchCandidates).mockResolvedValue([first]);
    vi.mocked(assignment.assignCaseLawyer).mockResolvedValue({
      id: caseId,
      stage: 'WAITING_COMPLAINT',
      version: 6,
      outcome: 'ASSIGNED',
      requestedLawyerAccountId: first.lawyerAccountId,
      previousAssignment: null,
      currentAssignment: {
        id: '99999999-9999-4999-8999-999999999999',
        lawyerProfileId: first.lawyerProfileId,
        lawyerAccountId: first.lawyerAccountId,
        assignedAt: '2026-11-23T05:00:00.000Z',
      },
    });
    const wrapper = mountPanel({ mode: 'assign', currentLawyerNames: [] });
    await flushPromises();
    expect(wrapper.text()).toContain('指派承办律师');
    expect(wrapper.text()).toContain('本案尚未指派承办律师');
    expect(wrapper.text()).not.toContain('仅替换承办人');
    expect(wrapper.get('[data-test="reassign-submit"]').text()).toBe(
      '确认指派',
    );

    await wrapper
      .get(`[data-test="reassign-lawyer-${first.lawyerAccountId}"]`)
      .setValue(true);
    await wrapper.get('[data-test="reassign-submit"]').trigger('click');
    await flushPromises();

    expect(assignment.assignCaseLawyer).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({
        expectedVersion: 5,
        lawyerAccountId: first.lawyerAccountId,
      }),
    );
    expect(wrapper.emitted('completed')?.[0]?.[0]).toMatchObject({
      outcome: 'ASSIGNED',
    });
  });

  it('shows the server reason when the candidate list is refused', async () => {
    vi.mocked(cases.listLawyerMatchCandidates).mockRejectedValue(
      new ApiError('律师账号或档案不存在或不可访问', 404, 'RESOURCE_NOT_FOUND'),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain('律师账号或档案不存在或不可访问');
  });
});
