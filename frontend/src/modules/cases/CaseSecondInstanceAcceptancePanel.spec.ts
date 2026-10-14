import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CaseSecondInstanceAcceptancePanel from './CaseSecondInstanceAcceptancePanel.vue';

const api = vi.hoisted(() => ({ saveSecondInstanceAcceptance: vi.fn() }));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  saveSecondInstanceAcceptance: api.saveSecondInstanceAcceptance,
  todayShanghai: () => '2026-10-14',
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: vi.fn(),
}));

const caseId = '70000000-0000-4000-8000-000000000020';
const choiceId = '70000000-0000-4000-8000-000000000021';
const trialRoundId = '70000000-0000-4000-8000-000000000022';

function mountPanel() {
  return mount(CaseSecondInstanceAcceptancePanel, {
    props: {
      item: {
        id: caseId,
        judgmentNextStep: {
          current: {
            id: choiceId,
            trialRoundId,
            next: 'APPEAL',
            recordedAt: '2026-10-01T00:00:00.000Z',
          },
          history: [],
        },
        secondInstance: {
          rounds: [{ id: trialRoundId, sequence: 1 }],
          acceptances: [],
        },
        recordEdits: {
          canSaveSecondInstanceAcceptance: true,
          secondInstanceAcceptances: [
            {
              choiceId,
              trialRoundId,
              acceptanceRevision: 0,
              acceptedAt: null,
              courtCaseNo: null,
              canEdit: true,
              history: [],
            },
          ],
        },
      } as never,
      contextKey: 'internal:user-a:department-a',
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => 'second-acceptance-test-key'),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('CaseSecondInstanceAcceptancePanel', () => {
  it('posts the current true appeal choice and keeps the save separate from case version', async () => {
    api.saveSecondInstanceAcceptance.mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-acceptance-date"]')
      .setValue('2026-10-10');
    await wrapper
      .get('[data-test="second-instance-acceptance-case-no"]')
      .setValue(' CN-SECOND-1 ');
    const save = wrapper.get('[data-test="second-instance-acceptance-save"]');
    expect((save.element as HTMLButtonElement).disabled).toBe(false);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.saveSecondInstanceAcceptance).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({
        choiceId,
        trialRoundId,
        expectedAcceptanceRevision: 0,
        acceptedAt: '2026-10-10',
        courtCaseNo: 'CN-SECOND-1',
        reason: null,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('retries an uncertain save with the original request body and idempotency key', async () => {
    api.saveSecondInstanceAcceptance
      .mockRejectedValueOnce(
        new ApiError('network failure', 0, 'NETWORK_ERROR'),
      )
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="second-instance-acceptance-case-no"]')
      .setValue('CN-SECOND-1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(
      wrapper.find('[data-test="second-instance-acceptance-retry"]').exists(),
    ).toBe(true);
    await wrapper
      .get('[data-test="second-instance-acceptance-retry"]')
      .trigger('click');
    await flushPromises();

    const firstRequest = api.saveSecondInstanceAcceptance.mock.calls[0];
    const retryRequest = api.saveSecondInstanceAcceptance.mock.calls[1];
    expect(retryRequest?.[0]).toBe(firstRequest?.[0]);
    expect(retryRequest?.[1]).toEqual(firstRequest?.[1]);
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });
});
