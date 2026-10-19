import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import { ApiError } from '../../api/http';
import type { NotaryMatterDetail } from '../../api/notary';
import NotaryMatterWorkflowPanel from './NotaryMatterWorkflowPanel.vue';
const api = vi.hoisted(() => ({
  recordNotaryEvidence: vi.fn(),
  recordNotaryOpening: vi.fn(),
  reviewNotaryOpening: vi.fn(),
  decideNotaryIssuance: vi.fn(),
  archiveNotaryReturn: vi.fn(),
}));
vi.mock('../../api/notary', () => api);
const download = vi.hoisted(() => vi.fn());
const materials = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(
    async (): Promise<{ items: Array<Record<string, unknown>> }> => ({
      items: [],
    }),
  ),
}));
vi.mock('../../api/materials', () => ({
  downloadMaterialVersion: download,
  deleteMaterial: vi.fn(),
  listOwnerMaterials: materials.listOwnerMaterials,
  uploadMaterialFile: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock('../../app/workflow-events', () => ({ notifyWorkflowChanged: notify }));
function detail(
  stage: NotaryMatterDetail['stage'] = 'ISSUANCE_DECISION',
): NotaryMatterDetail {
  return {
    id: 'matter-1',
    businessNo: 'NT-1',
    stage,
    version: 5,
    leadId: 'lead-1',
    leadStatus: 'TRANSFERRED_TO_NOTARY',
    leadVersion: 3,
    notaryOffice: { id: 'office-1', name: '测试公证处' },
    selectedProductIds: [],
    selectedContentVersionIds: [],
    evidenceMode: 'ONLINE_PURCHASE',
    batchPurpose: '测试',
    createdAt: '2026-10-15T00:00:00Z',
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    selectedProducts: [],
    selectedMaterials: [],
    evidence: null,
    opening: null,
    reviewDecision: null,
    issuanceDecision: null,
    returnArchive: null,
    certificateFiles: [],
    sourceSummary: {
      customer: { id: 'customer-1', name: '测试客户' },
      rightsHolder: { id: 'holder-1', name: '测试主体' },
      platform: 'TAOBAO',
      shopName: '测试店',
      shopExternalId: null,
    },
    transferredAt: '2026-10-15',
    evidenceAt: null,
    openingSummary: null,
    certificateSummary: null,
    fees: {
      notary: { state: 'UNRECORDED', amount: null },
      investigation: { state: 'UNRECORDED', amount: null },
      sample: { state: 'UNRECORDED', amount: null },
    },
    linkedCase: null,
    capabilities: {
      recordEvidence: stage === 'PENDING_EVIDENCE',
      recordOpening: stage === 'WAITING_UNBOX',
      reviewOpening: stage === 'UNBOX_REVIEW',
      decideIssuance: stage === 'ISSUANCE_DECISION',
      archiveReturn: stage === 'WAITING_RETURN',
    },
  };
}
async function open(
  current = detail(),
  actionKey = 'issuance-form',
  actorKey = 'user-1:INTERNAL:dept-1:7',
  onEndSubmit?: (outcome: 'failed' | 'unknown' | 'success') => void,
) {
  const success = vi.fn();
  const workflow = createListWorkflowContext(async () => current, { success });
  await workflow.sync({
    recordId: current.id,
    actorKey,
    actionKey,
    title: '公证办理',
  });
  const session = workflow.state.value.session;
  if (!session) throw new Error('Missing session');
  const panelSession = onEndSubmit
    ? {
        ...session,
        endSubmit(outcome: 'failed' | 'unknown' | 'success') {
          onEndSubmit(outcome);
          return session.endSubmit(outcome);
        },
      }
    : session;
  const wrapper = mount(NotaryMatterWorkflowPanel, {
    props: { detail: current, session: panelSession },
  });
  await flushPromises();
  return { wrapper, workflow, success, session };
}
function mockOpeningPhoto(current: NotaryMatterDetail) {
  materials.listOwnerMaterials.mockResolvedValueOnce({
    items: [
      {
        id: 'photo-1',
        ownerType: 'NOTARY_MATTER',
        ownerId: current.id,
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        currentVersionId: 'photo-v1',
        status: 'ACTIVE',
        version: 3,
        deletedAt: null,
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
        contentVersions: [
          {
            id: 'photo-v1',
            materialId: 'photo-1',
            originalFilename: 'opening.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 12,
            sha256: 'a'.repeat(64),
            status: 'AVAILABLE',
            createdAt: '2026-10-15T00:00:00Z',
          },
        ],
      },
    ],
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  globalThis.sessionStorage.clear();
});
describe('NotaryMatterWorkflowPanel request ownership', () => {
  it('shows the exact frozen opening material inside the list review form', async () => {
    const current = detail('UNBOX_REVIEW');
    current.opening = {
      senderName: '寄件人甲',
      senderPhone: null,
      senderAddress: null,
      recordedAt: '2026-10-15T00:00:00Z',
      recordedByUserId: 'user-1',
      photos: [
        {
          materialId: 'photo-1',
          contentVersionId: 'photo-v1',
          originalFilename: '审核照片.jpg',
          mimeType: 'image/jpeg',
        },
      ],
    };
    const { wrapper } = await open(current, 'review-form');
    expect(
      wrapper.get('[data-test="workflow-saved-opening"]').text(),
    ).toContain('审核照片.jpg');
    await wrapper
      .get('[data-test="workflow-download-photo-photo-v1"]')
      .trigger('click');
    await flushPromises();
    expect(download).toHaveBeenCalledWith(
      'photo-1',
      'photo-v1',
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });
  it('explains a stale row action instead of rendering another step that cannot submit', async () => {
    const { wrapper } = await open(detail('WAITING_UNBOX'), 'evidence-form');
    expect(wrapper.text()).toContain('当前步骤或办理权限已变化');
    expect(wrapper.find('[data-test="opening-form"]').exists()).toBe(false);
    expect(api.recordNotaryOpening).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('does not default issuance and describes its real chosen destination', async () => {
    const { wrapper, success } = await open();
    expect(wrapper.findAll('input[type=radio]:checked')).toHaveLength(0);
    await wrapper
      .get('[data-test="issuance-decision-section"] form')
      .trigger('submit');
    expect(api.decideNotaryIssuance).not.toHaveBeenCalled();
    await wrapper.get('[data-test="issuance-decision-no-issue"]').setValue();
    expect(
      wrapper.get('[data-test="issuance-decision-submit"]').text(),
    ).toContain('待退货');
    api.decideNotaryIssuance.mockResolvedValue({});
    await wrapper
      .get('[data-test="issuance-decision-section"] form')
      .trigger('submit');
    await flushPromises();
    expect(api.decideNotaryIssuance).toHaveBeenCalledWith(
      'matter-1',
      { decision: 'NO_ISSUE', expectedVersion: 5 },
      expect.any(String),
    );
    expect(success).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('persists before dispatch and restores an unknown request after reload with a changed stage', async () => {
    api.decideNotaryIssuance
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const first = await open();
    await first.wrapper
      .get('[data-test="issuance-decision-no-issue"]')
      .setValue();
    await first.wrapper
      .get('[data-test="issuance-decision-section"] form')
      .trigger('submit');
    await flushPromises();
    const original = api.decideNotaryIssuance.mock.calls[0];
    expect(globalThis.sessionStorage.length).toBe(1);
    first.workflow.dispose();
    first.wrapper.unmount();
    const recovered = await open(detail('WAITING_RETURN'));
    expect(recovered.workflow.state.value.requestState).toBe('unknown');
    await recovered.wrapper
      .get('[data-test="notary-workflow-retry"]')
      .trigger('click');
    await flushPromises();
    expect(api.decideNotaryIssuance.mock.calls[1]).toEqual(original);
    expect(recovered.success).toHaveBeenCalledTimes(1);
    expect(globalThis.sessionStorage.length).toBe(0);
    recovered.wrapper.unmount();
  });
  it('restores the same actor request across an authorization revision change', async () => {
    const oldActor = 'user-1:INTERNAL:dept-1:7';
    const newActor = 'user-1:INTERNAL:dept-1:8';
    const oldKey = `notary-list-request:${JSON.stringify([oldActor, 'matter-1', 'issuance-form'])}`;
    const frozen = {
      command: {
        kind: 'issuance',
        input: { decision: 'NO_ISSUE', expectedVersion: 5 },
      },
      key: 'original-key-rev7',
    };
    sessionStorage.setItem(oldKey, JSON.stringify(frozen));
    api.decideNotaryIssuance.mockResolvedValueOnce({});
    const recovered = await open(detail(), 'issuance-form', newActor);
    expect(recovered.workflow.state.value.requestState).toBe('unknown');
    await recovered.wrapper
      .get('[data-test="notary-workflow-retry"]')
      .trigger('click');
    await flushPromises();
    expect(api.decideNotaryIssuance).toHaveBeenCalledWith(
      'matter-1',
      frozen.command.input,
      frozen.key,
    );
    expect(sessionStorage.getItem(oldKey)).toBeNull();
    recovered.wrapper.unmount();
  });
  it('replays the original opening body and key after fresh authorization facts', async () => {
    const oldActor = 'user-1:INTERNAL:dept-1:7';
    const oldKey = `notary-list-request:${JSON.stringify([
      oldActor,
      'matter-1',
      'opening-form',
    ])}`;
    const frozen = {
      command: {
        kind: 'opening',
        input: {
          expectedVersion: 5,
          contentVersionIds: ['photo-original'],
          senderName: '原寄件人',
        },
      },
      key: 'opening-original-key',
    };
    sessionStorage.setItem(oldKey, JSON.stringify(frozen));
    api.recordNotaryOpening.mockResolvedValueOnce({});
    const recovered = await open(
      detail('WAITING_UNBOX'),
      'opening-form',
      'user-1:INTERNAL:dept-1:8',
    );
    expect(recovered.workflow.state.value.requestState).toBe('unknown');
    await recovered.wrapper
      .get('[data-test="notary-workflow-retry"]')
      .trigger('click');
    await flushPromises();
    expect(api.recordNotaryOpening).toHaveBeenCalledWith(
      'matter-1',
      frozen.command.input,
      frozen.key,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sessionStorage.getItem(oldKey)).toBeNull();
    recovered.wrapper.unmount();
  });
  it('clears a first rejected opening slot before notifying the batch session', async () => {
    const current = detail('WAITING_UNBOX');
    mockOpeningPhoto(current);
    api.recordNotaryOpening.mockRejectedValueOnce(
      new ApiError('stale', 409, 'VERSION_CONFLICT'),
    );
    const key =
      'notary-list-request:' +
      JSON.stringify(['user-1:INTERNAL:dept-1', 'matter-1', 'opening-form']);
    const observed: Array<{ outcome: string; slot: string | null }> = [];
    const opened = await open(
      current,
      'opening-form',
      'user-1:INTERNAL:dept-1:7',
      (outcome) =>
        observed.push({ outcome, slot: sessionStorage.getItem(key) }),
    );
    await opened.wrapper
      .get('[data-test="select-opening-photo-photo-v1"]')
      .setValue(true);
    await opened.wrapper.get('[data-test="record-opening"]').trigger('submit');
    await flushPromises();
    expect(observed).toEqual([{ outcome: 'failed', slot: null }]);
    expect(opened.workflow.state.value.requestState).toBe('idle');
    opened.wrapper.unmount();
  });
  it('retains the original opening slot before notifying the batch session of recovery denial', async () => {
    const frozen = {
      command: {
        kind: 'opening',
        input: { expectedVersion: 5, contentVersionIds: ['photo-original'] },
      },
      key: 'opening-original-key',
    };
    const key =
      'notary-list-request:' +
      JSON.stringify(['user-1:INTERNAL:dept-1', 'matter-1', 'opening-form']);
    sessionStorage.setItem(key, JSON.stringify(frozen));
    api.recordNotaryOpening.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const observed: Array<{ outcome: string; slot: string | null }> = [];
    const opened = await open(
      detail('WAITING_UNBOX'),
      'opening-form',
      'user-1:INTERNAL:dept-1:8',
      (outcome) =>
        observed.push({ outcome, slot: sessionStorage.getItem(key) }),
    );
    await opened.wrapper
      .get('[data-test="notary-workflow-retry"]')
      .trigger('click');
    await flushPromises();
    expect(observed).toEqual([
      { outcome: 'failed', slot: JSON.stringify(frozen) },
    ]);
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify(frozen));
    opened.wrapper.unmount();
  });
  it('aborts an opening POST on workflow context change and preserves the original request slot', async () => {
    const current = detail('WAITING_UNBOX');
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [
        {
          id: 'photo-1',
          ownerType: 'NOTARY_MATTER',
          ownerId: current.id,
          category: 'NOTARY_OPENING_PHOTO',
          purpose: 'NOTARY_OPENING_PHOTO',
          currentVersionId: 'photo-v1',
          status: 'ACTIVE',
          version: 3,
          deletedAt: null,
          createdAt: '2026-10-15T00:00:00Z',
          updatedAt: '2026-10-15T00:00:00Z',
          contentVersions: [
            {
              id: 'photo-v1',
              materialId: 'photo-1',
              originalFilename: '开箱.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 12,
              sha256: 'a'.repeat(64),
              status: 'AVAILABLE',
              createdAt: '2026-10-15T00:00:00Z',
            },
          ],
        },
      ],
    });
    let rejectPost: (error: Error) => void = () => {};
    api.recordNotaryOpening.mockReturnValue(
      new Promise((_, reject) => {
        rejectPost = reject;
      }),
    );
    const opened = await open(current, 'opening-form');
    await opened.wrapper
      .get('[data-test="select-opening-photo-photo-v1"]')
      .setValue(true);
    await opened.wrapper.get('[data-test="record-opening"]').trigger('submit');
    expect(api.recordNotaryOpening).toHaveBeenCalledTimes(1);
    const oldStorageKey =
      'notary-list-request:' +
      JSON.stringify(['user-1:INTERNAL:dept-1', 'matter-1', 'opening-form']);
    const frozen = sessionStorage.getItem(oldStorageKey);
    const signal = api.recordNotaryOpening.mock.calls[0]?.[3]
      ?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(frozen).not.toBeNull();

    await opened.workflow.sync({
      recordId: 'matter-1',
      actorKey: 'user-1:INTERNAL:dept-1:8',
      actionKey: 'opening-form',
      title: '公证办理',
    });
    const nextSession = opened.workflow.state.value.session;
    if (!nextSession) throw new Error('Missing next session');
    await opened.wrapper.setProps({
      detail: current,
      session: nextSession,
    });
    expect(signal.aborted).toBe(true);
    expect(sessionStorage.getItem(oldStorageKey)).toBe(frozen);
    rejectPost(new Error('aborted'));
    await flushPromises();
    expect(sessionStorage.getItem(oldStorageKey)).toBe(frozen);
    expect(opened.success).not.toHaveBeenCalled();
    opened.wrapper.unmount();
  });
  it('fails closed when multiple revision slots match the same workflow identity', async () => {
    const frozen = {
      command: {
        kind: 'issuance',
        input: { decision: 'NO_ISSUE', expectedVersion: 5 },
      },
      key: 'one-key',
    };
    sessionStorage.setItem(
      'notary-list-request:' +
        JSON.stringify([
          'user-1:INTERNAL:dept-1:7',
          'matter-1',
          'issuance-form',
        ]),
      JSON.stringify(frozen),
    );
    sessionStorage.setItem(
      'notary-list-request:' +
        JSON.stringify([
          'user-1:INTERNAL:dept-1:8',
          'matter-1',
          'issuance-form',
        ]),
      JSON.stringify({ ...frozen, key: 'other-key' }),
    );
    const current = await open();
    expect(current.wrapper.text()).toContain('原请求无法安全恢复');
    expect(current.workflow.state.value.requestState).toBe('idle');
    await current.wrapper
      .get('[data-test="issuance-decision-issue"]')
      .setValue();
    await current.wrapper.get('form').trigger('submit');
    expect(api.decideNotaryIssuance).not.toHaveBeenCalled();
    current.wrapper.unmount();
  });
  it('sends one POST on double submit and never refreshes a newer session for a late result', async () => {
    let finish: () => void = () => {};
    api.decideNotaryIssuance.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { wrapper, workflow, success } = await open();
    await wrapper.get('[data-test="issuance-decision-issue"]').setValue();
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    expect(api.decideNotaryIssuance).toHaveBeenCalledTimes(1);
    expect(workflow.requestClose()).toBe(false);
    workflow.dispose();
    finish();
    await flushPromises();
    expect(success).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('retains fields on a deterministic rejection and only allows the corrected command', async () => {
    api.decideNotaryIssuance
      .mockRejectedValueOnce(new ApiError('invalid', 400, 'VALIDATION_ERROR'))
      .mockResolvedValueOnce({});
    const { wrapper, success } = await open();
    await wrapper.get('[data-test="issuance-decision-issue"]').setValue();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(
      wrapper.get<HTMLInputElement>('[data-test="issuance-decision-issue"]')
        .element.checked,
    ).toBe(true);
    await wrapper.get('[data-test="issuance-decision-no-issue"]').setValue();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(success).toHaveBeenCalledTimes(1);
    expect(api.decideNotaryIssuance.mock.calls[0]?.[2]).not.toBe(
      api.decideNotaryIssuance.mock.calls[1]?.[2],
    );
    wrapper.unmount();
  });
  it('stops on permission rejection and does not report success', async () => {
    api.decideNotaryIssuance.mockRejectedValue(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const { wrapper, workflow, success } = await open();
    await wrapper.get('[data-test="issuance-decision-issue"]').setValue();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(workflow.state.value.status).toBe('denied');
    expect(success).not.toHaveBeenCalled();
    expect(wrapper.emitted('failed')?.[0]?.[0]).toContain('forbidden');
    expect(globalThis.sessionStorage.length).toBe(0);
    wrapper.unmount();
  });
  it('does not POST or pretend to save when the pending payload is corrupt', async () => {
    globalThis.sessionStorage.setItem(
      'notary-list-request:' +
        JSON.stringify([
          'user-1:INTERNAL:dept-1:7',
          'matter-1',
          'issuance-form',
        ]),
      '{"command":{"kind":"issuance","input":{}},"key":"old"}',
    );
    const { wrapper } = await open();
    expect(wrapper.text()).toContain('无法安全恢复');
    await wrapper.get('[data-test="issuance-decision-issue"]').setValue();
    await wrapper.get('form').trigger('submit');
    expect(api.decideNotaryIssuance).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('requires a reason for no-infringement and does not default return amounts', async () => {
    const review = await open(detail('UNBOX_REVIEW'), 'review-form');
    await review.wrapper
      .get('[data-test="opening-review-result-no-infringement"]')
      .setValue();
    await review.wrapper.get('form').trigger('submit');
    expect(api.reviewNotaryOpening).not.toHaveBeenCalled();
    expect(review.wrapper.text()).toContain('请填写不侵权原因');
    review.wrapper.unmount();
    const returned = await open(
      detail('WAITING_RETURN'),
      'return-archive-form',
    );
    expect(returned.wrapper.findAll('input[type=radio]:checked')).toHaveLength(
      0,
    );
    await returned.wrapper
      .get('[data-test="return-archive-return"]')
      .setValue();
    await returned.wrapper
      .get('[data-test="return-archive-reason"]')
      .setValue('实际退货');
    await returned.wrapper.get('form').trigger('submit');
    expect(api.archiveNotaryReturn).not.toHaveBeenCalled();
    expect(
      returned.wrapper.find('[data-test="return-freight-fields"]').exists(),
    ).toBe(true);
    await returned.wrapper.get('[data-test="return-archive-keep"]').setValue();
    expect(
      returned.wrapper.find('[data-test="return-freight-fields"]').exists(),
    ).toBe(false);
    returned.wrapper.unmount();
  });
});
