import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseSummary } from '../../api/cases';
import { readFilingBatch } from './case-filing-batch-recovery';
import CaseFilingBatchPanel from './CaseFilingBatchPanel.vue';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  submitCaseFiling: vi.fn(),
  notifyWorkflowChanged: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getCase: api.getCase,
  submitCaseFiling: api.submitCaseFiling,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: api.notifyWorkflowChanged,
}));
const caseId = '44444444-4444-4444-8444-444444444444';
const input = {
  expectedVersion: 3,
  idempotencyKey: 'key-1',
  courtId: '11111111-1111-4111-8111-111111111111',
  submittedAt: '2026-11-04',
  filingEvidenceContentVersionIds: ['22222222-2222-4222-8222-222222222222'],
};
const selectedCases = [
  {
    id: caseId,
    businessNo: 'A-1',
    stage: 'WAITING_FILING',
    version: 3,
    canSubmitFiling: true,
  },
] as CaseSummary[];
const actorKey = 'user-1:INTERNAL:department-1:1';
function panel(cases: CaseSummary[] = selectedCases) {
  return mount(CaseFilingBatchPanel, {
    props: { selectedCases: cases, actorKey },
    global: {
      stubs: {
        CaseFilingPanel: {
          name: 'CaseFilingPanel',
          props: ['item', 'contextKey', 'prepareOnly'],
          emits: ['prepared'],
          template:
            "<button data-test=\"prepare-stub\" @click=\"$emit('prepared', { expectedVersion: 3, idempotencyKey: item.id === '44444444-4444-4444-8444-444444444444' ? 'key-1' : 'key-2', courtId: item.id === '44444444-4444-4444-8444-444444444444' ? '11111111-1111-4111-8111-111111111111' : '33333333-3333-4333-8333-333333333333', submittedAt: item.id === '44444444-4444-4444-8444-444444444444' ? '2026-11-04' : '2026-12-05', filingEvidenceContentVersionIds: [item.id === '44444444-4444-4444-8444-444444444444' ? '22222222-2222-4222-8222-222222222222' : '44444444-4444-4444-8444-444444444444'] }, { courtName: item.id === '44444444-4444-4444-8444-444444444444' ? '甲法院' : '乙法院', evidenceFiles: [{ materialId: item.id === '44444444-4444-4444-8444-444444444444' ? '55555555-5555-4555-8555-555555555555' : '66666666-6666-4666-8666-666666666666', contentVersionId: item.id === '44444444-4444-4444-8444-444444444444' ? '22222222-2222-4222-8222-222222222222' : '44444444-4444-4444-8444-444444444444', originalFilename: item.id === '44444444-4444-4444-8444-444444444444' ? '甲诉状.pdf' : '乙诉状.pdf', mimeType: 'application/pdf' }], screenshotFiles: [] })\">准备</button>",
        },
      },
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  globalThis.localStorage.clear();
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn((_name, _options, callback) => callback({ name: 'lock' })),
    },
  });
  api.getCase.mockResolvedValue({
    id: caseId,
    stage: 'WAITING_FILING',
    version: 3,
    canSubmitFiling: true,
    filingSubmission: null,
  });
  api.submitCaseFiling.mockResolvedValue({
    id: caseId,
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 4,
    submittedAt: '2026-11-04',
    recordedAt: '2026-11-04T01:00:00Z',
  });
});

describe('CaseFilingBatchPanel', () => {
  it('persists the exact prepared body before sending and retains a committed result', async () => {
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="prepare-stub"]').trigger('click');
    expect(api.submitCaseFiling).not.toHaveBeenCalled();
    expect(
      readFilingBatch('user-1:INTERNAL:department-1')?.items[0]?.input,
    ).toEqual(input);
    expect(wrapper.get('[data-test="filing-batch-preview"]').text()).toContain(
      '甲法院',
    );
    expect(wrapper.get('[data-test="filing-batch-preview"]').text()).toContain(
      '诉状.pdf',
    );
    expect(wrapper.get('[data-test="filing-batch-preview"]').text()).toContain(
      '待确认',
    );
    expect(
      wrapper.get('[data-test="filing-batch-preview"]').text(),
    ).not.toContain('PREPARED');
    await wrapper.get('[data-test="filing-batch-confirm"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseFiling).toHaveBeenCalledWith(caseId, input);
    expect(
      readFilingBatch('user-1:INTERNAL:department-1')?.items[0],
    ).toMatchObject({ state: 'COMMITTED', result: { id: caseId } });
    expect(wrapper.get('[data-test="filing-batch-preview"]').text()).toContain(
      '已成功',
    );
    expect(
      wrapper.get('[data-test="filing-batch-preview"]').text(),
    ).not.toContain('COMMITTED');
    expect(wrapper.text()).toContain('办理结果见逐案列表');
    expect(wrapper.text()).not.toContain('本案资料已保存为准备态');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });

  it('locks an unknown request and recovers only with its original body and key', async () => {
    api.submitCaseFiling.mockRejectedValueOnce(new Error('network'));
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="prepare-stub"]').trigger('click');
    await wrapper.get('[data-test="filing-batch-confirm"]').trigger('click');
    await flushPromises();
    expect(
      readFilingBatch('user-1:INTERNAL:department-1')?.items[0]?.state,
    ).toBe('UNKNOWN');
    expect(wrapper.get('[data-test="filing-batch-preview"]').text()).toContain(
      '待核对',
    );
    expect(
      wrapper.get('[data-test="filing-batch-preview"]').text(),
    ).not.toContain('UNKNOWN');
    expect(wrapper.find('[data-test="prepare-stub"]').exists()).toBe(false);
    api.getCase.mockResolvedValue({
      id: caseId,
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 4,
      canSubmitFiling: false,
      filingSubmission: {
        court: { id: input.courtId },
        submittedAt: input.submittedAt,
        mediationNo: null,
        evidenceFiles: [
          { contentVersionId: input.filingEvidenceContentVersionIds[0] },
        ],
        screenshotFiles: [],
      },
    });
    await wrapper.get('[data-test="filing-batch-recover"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseFiling).toHaveBeenLastCalledWith(caseId, input);
    expect(
      readFilingBatch('user-1:INTERNAL:department-1')?.items[0]?.state,
    ).toBe('COMMITTED');
    expect(wrapper.get('[data-test="filing-batch-preview"]').text()).toContain(
      '已成功',
    );
    wrapper.unmount();
  });
  it('blocks uploads when this actor has a damaged recovery record', async () => {
    globalThis.localStorage.setItem(
      `case-filing-batch-v2:${encodeURIComponent('user-1:INTERNAL:department-1')}`,
      '{bad',
    );
    const wrapper = panel();
    await flushPromises();
    expect(wrapper.find('[data-test="prepare-stub"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('恢复记录无法读取或无效');
    expect(api.submitCaseFiling).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('restores a prepared case even when the new selection is empty', async () => {
    const first = panel();
    await flushPromises();
    await first.get('[data-test="prepare-stub"]').trigger('click');
    first.unmount();
    const resumed = mount(CaseFilingBatchPanel, {
      props: { selectedCases: [], actorKey },
      global: {
        stubs: {
          CaseFilingPanel: {
            name: 'CaseFilingPanel',
            props: ['preparedInput'],
            emits: ['prepared'],
            template:
              "<button data-test=\"resumed-filing-form\" @click=\"$emit('prepared', preparedInput, { courtName: '甲法院', evidenceFiles: [{ materialId: '55555555-5555-4555-8555-555555555555', contentVersionId: '22222222-2222-4222-8222-222222222222', originalFilename: '诉状.pdf', mimeType: 'application/pdf' }], screenshotFiles: [] })\">原案准备资料</button>",
          },
        },
      },
    });
    await flushPromises();
    expect(resumed.get('nav').text()).toContain('A-1');
    expect(resumed.find('[data-test="resumed-filing-form"]').exists()).toBe(
      true,
    );
    await resumed.get('[data-test="resumed-filing-form"]').trigger('click');
    expect(
      readFilingBatch('user-1:INTERNAL:department-1')?.items[0],
    ).toMatchObject({
      state: 'PREPARED',
      input,
    });
    expect(api.getCase).toHaveBeenLastCalledWith(caseId, expect.anything());
    resumed.unmount();
  });
  it('shows detailed saved filing data for every restored case with no current selection', async () => {
    const firstCase = selectedCases[0]!;
    const secondCase = {
      ...firstCase,
      id: '77777777-7777-4777-8777-777777777777',
      businessNo: 'A-2',
    };
    api.getCase.mockImplementation(async (id: string) => ({
      id,
      stage: 'WAITING_FILING',
      version: 3,
      canSubmitFiling: true,
      filingSubmission: null,
    }));
    const initial = panel([firstCase, secondCase]);
    await flushPromises();
    await initial.get('[data-test="prepare-stub"]').trigger('click');
    await initial.get('nav').findAll('button')[1]!.trigger('click');
    await flushPromises();
    await initial.get('[data-test="prepare-stub"]').trigger('click');
    expect(readFilingBatch('user-1:INTERNAL:department-1')?.items).toHaveLength(
      2,
    );
    initial.unmount();

    const resumed = panel([]);
    await flushPromises();
    const preview = resumed.get('[data-test="filing-batch-preview"]');
    expect(preview.findAll('li')).toHaveLength(2);
    for (const detail of [
      '甲法院',
      '2026-11-04',
      '甲诉状.pdf',
      '乙法院',
      '2026-12-05',
      '乙诉状.pdf',
    ])
      expect(preview.text()).toContain(detail);
    resumed.unmount();
  });
  it('does not let a late old lock callback release the new actor lock', async () => {
    let oldCallback: ((lock: { name: string }) => Promise<void>) | undefined;
    let newReleased = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn((name: string, _options, callback) => {
          if (name.endsWith('user-1:INTERNAL:department-1')) {
            oldCallback = callback;
            return Promise.resolve();
          }
          return callback({ name: 'new' }).then(() => {
            newReleased = true;
          });
        }),
      },
    });
    const wrapper = panel();
    await wrapper.setProps({ actorKey: 'user-2:INTERNAL:department-1:1' });
    await flushPromises();
    expect(wrapper.find('[data-test="prepare-stub"]').exists()).toBe(true);
    void oldCallback?.({ name: 'old' });
    await flushPromises();
    expect(newReleased).toBe(false);
    expect(wrapper.find('[data-test="prepare-stub"]').exists()).toBe(true);
    wrapper.unmount();
    await flushPromises();
    expect(newReleased).toBe(true);
  });
  it('releases an old lock when the actor identity becomes invalid', async () => {
    let released = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn((_name, _options, callback) =>
          callback({ name: 'old' }).then(() => {
            released = true;
          }),
        ),
      },
    });
    const wrapper = panel();
    await flushPromises();
    await wrapper.setProps({ actorKey: 'invalid' });
    await flushPromises();
    expect(released).toBe(true);
    expect(wrapper.find('[data-test="prepare-stub"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
