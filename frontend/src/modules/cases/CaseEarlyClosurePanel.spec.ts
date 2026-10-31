import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CaseEarlyClosurePanel from './CaseEarlyClosurePanel.vue';
import CaseEarlyClosureForm, {
  type EarlyClosureDraft,
} from './CaseEarlyClosureForm.vue';
import { recordCaseEarlyClosure } from '../../api/case-closure-commands';
import { uploadMaterialFile } from '../../api/materials';
import {
  preparePaymentProofUpload,
  finalizePaymentProofUpload,
} from '../../api/payment-proof-upload';
import { ApiError } from '../../api/http';
import { createListWorkflowContext } from '../../app/list-workflow-context';
vi.mock('../../api/case-closure-commands', () => ({
  recordCaseEarlyClosure: vi.fn(),
}));
vi.mock('../../api/payment-proof-upload', () => ({
  preparePaymentProofUpload: vi.fn(),
  finalizePaymentProofUpload: vi.fn(),
}));
vi.mock('../../api/materials', () => ({ uploadMaterialFile: vi.fn() }));
const caseId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const draft = (): EarlyClosureDraft => ({
  closeAt: '2026-10-29',
  closeAmountState: 'KNOWN',
  closeAmt: '12.50',
  closeDocuments: [],
  paymentType: 'ONE_TIME',
  paymentRecords: [
    {
      id: 'local',
      paymentDate: '2026-10-28',
      amount: '12.50',
      payer: '甲',
      payee: '乙',
    },
  ],
});
let actorKey = '';
function mountPanel() {
  return mount(CaseEarlyClosurePanel, {
    props: { actorKey, caseId, stage: 'PENDING_MATCH', version: 3 },
  });
}
function submit(wrapper: ReturnType<typeof mountPanel>, value = draft()) {
  wrapper.getComponent(CaseEarlyClosureForm).vm.$emit('submit', value);
}
beforeEach(() => {
  vi.resetAllMocks();
  actorKey = crypto.randomUUID();
});
describe('CaseEarlyClosurePanel', () => {
  it.each([true, false])(
    'consumes confirmed recovery once when success before remount is %s',
    async (beforeRemount) => {
      const success = vi.fn();
      const workflow = createListWorkflowContext(
        async ({ context }) => ({ id: context.recordId }),
        { success },
      );
      const context = {
        actorKey,
        recordId: caseId,
        actionKey: 'early-closure',
        title: '提前结案',
      };
      await workflow.sync(context);
      const original = mountPanel();
      await original.setProps({ session: workflow.state.value.session! });
      let finish!: (
        value: Awaited<ReturnType<typeof recordCaseEarlyClosure>>,
      ) => void;
      vi.mocked(recordCaseEarlyClosure).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      submit(original);
      await flushPromises();
      expect(workflow.state.value.requestState).toBe('submitting');
      workflow.dispose();
      original.unmount();
      const result = { id: caseId } as Awaited<
        ReturnType<typeof recordCaseEarlyClosure>
      >;
      if (beforeRemount) {
        finish(result);
        await flushPromises();
      }
      await workflow.sync(context);
      const reopened = mountPanel();
      await reopened.setProps({ session: workflow.state.value.session! });
      if (!beforeRemount) {
        expect(workflow.state.value.requestState).toBe('unknown');
        finish(result);
      }
      await flushPromises();
      expect(recordCaseEarlyClosure).toHaveBeenCalledTimes(1);
      expect(success).toHaveBeenCalledTimes(1);
      expect(workflow.state.value.status).toBe('closed');
      expect(reopened.emitted('done')).toEqual([[result]]);
      expect(original.emitted('done')).toBeUndefined();
      await flushPromises();
      expect(success).toHaveBeenCalledTimes(1);
      reopened.unmount();
      await workflow.sync(context);
      const secondReopened = mountPanel();
      await secondReopened.setProps({ session: workflow.state.value.session! });
      await flushPromises();
      expect(success).toHaveBeenCalledTimes(1);
      expect(workflow.state.value.requestState).toBe('idle');
      expect(secondReopened.emitted('done')).toBeUndefined();
      expect(workflow.requestClose()).toBe(true);
      secondReopened.unmount();
      await workflow.sync({ ...context, actorKey: 'different-actor' });
      const otherActor = mountPanel();
      await otherActor.setProps({
        actorKey: 'different-actor',
        session: workflow.state.value.session!,
      });
      await flushPromises();
      expect(otherActor.text()).not.toContain('原请求已提交成功');
      expect(otherActor.find('[data-test="retry"]').exists()).toBe(false);
      expect(success).toHaveBeenCalledTimes(1);
    },
  );
  it('holds the shared session across upload and POST once, and restores an unknown original request', async () => {
    const success = vi.fn();
    const workflow = createListWorkflowContext(
      async ({ context }) => ({ id: context.recordId }),
      { success },
    );
    await workflow.sync({
      actorKey,
      recordId: caseId,
      actionKey: 'early-closure',
      title: '提前结案',
    });
    const session = workflow.state.value.session!;
    const begin = vi.fn(session.beginSubmit);
    const wrapper = mountPanel();
    await wrapper.setProps({ session: { ...session, beginSubmit: begin } });
    expect(wrapper.find('[data-test="cancel"]').exists()).toBe(false);
    let finish!: (
      value: Awaited<ReturnType<typeof uploadMaterialFile>>,
    ) => void;
    vi.mocked(uploadMaterialFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(recordCaseEarlyClosure).mockRejectedValueOnce(
      new ApiError('timeout', 0, 'TIMEOUT'),
    );
    const value = draft();
    value.closeDocuments = [new File(['a'], 'doc.pdf')];
    submit(wrapper, value);
    await flushPromises();
    expect(workflow.state.value.requestState).toBe('submitting');
    expect(workflow.requestClose()).toBe(false);
    finish({ contentVersionId: versionId } as Awaited<
      ReturnType<typeof uploadMaterialFile>
    >);
    await flushPromises();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(workflow.state.value.requestState).toBe('unknown');
    const original = vi.mocked(recordCaseEarlyClosure).mock.calls[0]!;
    wrapper.unmount();
    await workflow.sync({
      actorKey,
      recordId: caseId,
      actionKey: 'early-closure',
      title: '提前结案',
    });
    const restored = mountPanel();
    await restored.setProps({ session: workflow.state.value.session! });
    expect(workflow.state.value.requestState).toBe('unknown');
    vi.mocked(recordCaseEarlyClosure).mockResolvedValue({
      id: caseId,
    } as Awaited<ReturnType<typeof recordCaseEarlyClosure>>);
    await restored.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(vi.mocked(recordCaseEarlyClosure).mock.calls[1]).toEqual(original);
    expect(success).toHaveBeenCalledTimes(1);
    expect(workflow.state.value.status).toBe('closed');
  });
  it('stops uploads and cannot advance the next shared case after session invalidation', async () => {
    const success = vi.fn();
    const workflow = createListWorkflowContext(
      async ({ context }) => ({ id: context.recordId }),
      { success },
    );
    await workflow.sync({
      actorKey,
      recordId: caseId,
      actionKey: 'early-closure',
      title: '提前结案',
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ session: workflow.state.value.session! });
    let finish!: (
      value: Awaited<ReturnType<typeof uploadMaterialFile>>,
    ) => void;
    vi.mocked(uploadMaterialFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const value = draft();
    value.closeDocuments = [
      new File(['a'], 'one.pdf'),
      new File(['b'], 'two.pdf'),
    ];
    submit(wrapper, value);
    await flushPromises();
    await workflow.sync({
      actorKey,
      recordId: versionId,
      actionKey: 'early-closure',
      title: '下一案',
    });
    finish({ contentVersionId: versionId } as Awaited<
      ReturnType<typeof uploadMaterialFile>
    >);
    await flushPromises();
    expect(uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(workflow.state.value.context?.recordId).toBe(versionId);
    expect(workflow.state.value.requestState).toBe('idle');
    expect(wrapper.emitted('done')).toBeUndefined();
  });
  it('does not advance another shared case when an old POST returns success', async () => {
    const success = vi.fn();
    const workflow = createListWorkflowContext(
      async ({ context }) => ({ id: context.recordId }),
      { success },
    );
    await workflow.sync({
      actorKey,
      recordId: caseId,
      actionKey: 'early-closure',
      title: '提前结案',
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ session: workflow.state.value.session! });
    let finish!: (
      value: Awaited<ReturnType<typeof recordCaseEarlyClosure>>,
    ) => void;
    vi.mocked(recordCaseEarlyClosure).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    submit(wrapper);
    await flushPromises();
    await workflow.sync({
      actorKey,
      recordId: versionId,
      actionKey: 'early-closure',
      title: '下一案',
    });
    finish({ id: caseId } as Awaited<
      ReturnType<typeof recordCaseEarlyClosure>
    >);
    await flushPromises();
    expect(success).not.toHaveBeenCalled();
    expect(wrapper.emitted('done')).toBeUndefined();
    expect(workflow.state.value.context?.recordId).toBe(versionId);
    expect(workflow.state.value.requestState).toBe('idle');
  });
  it('maps the authorized context, date, decimal amount and payments; allows no files', async () => {
    const result = { id: caseId, version: 5, stage: 'WAITING_ARCHIVE' };
    vi.mocked(recordCaseEarlyClosure).mockResolvedValue(
      result as Awaited<ReturnType<typeof recordCaseEarlyClosure>>,
    );
    const wrapper = mountPanel();
    submit(wrapper);
    await flushPromises();
    expect(recordCaseEarlyClosure).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({
        expectedStage: 'PENDING_MATCH',
        expectedVersion: 3,
        closeAt: '2026-10-29',
        closeAmt: '12.50',
        closeContentVersionIds: [],
        paymentRecords: [
          {
            paidOn: '2026-10-28',
            amount: '12.50',
            payer: '甲',
            payee: '乙',
            screenshotContentVersionId: null,
          },
        ],
      }),
    );
    expect(uploadMaterialFile).not.toHaveBeenCalled();
    expect(wrapper.emitted('done')).toEqual([[result]]);
    submit(wrapper);
    expect(recordCaseEarlyClosure).toHaveBeenCalledTimes(1);
  });
  it('uses uploaded content version instead of material id', async () => {
    vi.mocked(uploadMaterialFile).mockResolvedValue({
      materialId: 'material-not-version',
      contentVersionId: versionId,
    } as Awaited<ReturnType<typeof uploadMaterialFile>>);
    const wrapper = mountPanel();
    const value = draft();
    value.closeDocuments = [
      new File(['a'], 'doc.pdf', { type: 'application/pdf' }),
    ];
    submit(wrapper, value);
    await flushPromises();
    expect(uploadMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: caseId,
        category: 'CASE_CLOSURE_DOCUMENT',
      }),
    );
    expect(recordCaseEarlyClosure).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({ closeContentVersionIds: [versionId] }),
    );
  });
  it('blocks an unsupported screenshot rather than silently discarding it', async () => {
    vi.mocked(preparePaymentProofUpload).mockRejectedValue(
      new ApiError('invalid', 400, 'VALIDATION_ERROR'),
    );
    const wrapper = mountPanel();
    const value = draft();
    value.paymentRecords[0]!.receiptFile = new File(['a'], 'shot.png');
    submit(wrapper, value);
    await flushPromises();
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    expect(uploadMaterialFile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('上传未完成');
  });
  it('binds each screenshot exactly and retries the original unknown upload', async () => {
    const handle = Object.freeze({
      actorKey,
      caseId,
      expectedVersion: 3,
      draftId: versionId,
    });
    vi.mocked(preparePaymentProofUpload).mockResolvedValue(handle);
    vi.mocked(finalizePaymentProofUpload)
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'))
      .mockResolvedValue(versionId);
    const wrapper = mountPanel();
    const value = draft();
    value.paymentRecords[0]!.receiptFile = new File(['a'], 'shot.png', {
      type: 'image/png',
    });
    value.paymentRecords.push({
      id: 'second',
      paymentDate: '2026-10-29',
      amount: '1.00',
      payer: 'other',
      payee: 'other',
    });
    submit(wrapper, value);
    await flushPromises();
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    expect(wrapper.getComponent(CaseEarlyClosureForm).props('disabled')).toBe(
      true,
    );
    await wrapper.get('[data-test="retry-upload"]').trigger('click');
    await flushPromises();
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    expect(wrapper.getComponent(CaseEarlyClosureForm).props('disabled')).toBe(
      true,
    );
    await wrapper.get('[data-test="retry-upload"]').trigger('click');
    await flushPromises();
    expect(preparePaymentProofUpload).toHaveBeenCalledTimes(1);
    expect(finalizePaymentProofUpload).toHaveBeenCalledTimes(3);
    expect(vi.mocked(finalizePaymentProofUpload).mock.calls[1]![0]).toBe(
      handle,
    );
    expect(recordCaseEarlyClosure).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({
        paymentRecords: [
          expect.objectContaining({ screenshotContentVersionId: versionId }),
          expect.objectContaining({ screenshotContentVersionId: null }),
        ],
      }),
    );
  });
  it.each([
    { actorKey: 'other' },
    { caseId: '00000000-0000-4000-8000-000000000009' },
    { version: 4 },
    { stage: 'WAITING_COMPLAINT' as const },
  ])(
    'blocks unknown upload retry after identity or version changes %j',
    async (change) => {
      const handle = Object.freeze({
        actorKey,
        caseId,
        expectedVersion: 3,
        draftId: versionId,
      });
      vi.mocked(preparePaymentProofUpload).mockResolvedValue(handle);
      vi.mocked(finalizePaymentProofUpload).mockRejectedValue(
        new ApiError('timeout', 0, 'TIMEOUT'),
      );
      const wrapper = mountPanel();
      const value = draft();
      value.paymentRecords[0]!.receiptFile = new File(['a'], 'shot.png', {
        type: 'image/png',
      });
      submit(wrapper, value);
      await flushPromises();
      await wrapper.setProps(change);
      await wrapper.get('[data-test="retry-upload"]').trigger('click');
      await flushPromises();
      expect(preparePaymentProofUpload).toHaveBeenCalledTimes(1);
      expect(finalizePaymentProofUpload).toHaveBeenCalledTimes(1);
      expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    },
  );
  it('does not submit or emit done after upload failure', async () => {
    vi.mocked(uploadMaterialFile).mockRejectedValue(new Error('network'));
    const wrapper = mountPanel();
    const value = draft();
    value.closeDocuments = [new File(['a'], 'doc.pdf')];
    submit(wrapper, value);
    await flushPromises();
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    expect(wrapper.emitted('done')).toBeUndefined();
    expect(wrapper.text()).toContain('上传未完成');
  });
  it.each(['actorKey', 'caseId'] as const)(
    'stops remaining file uploads when %s changes during an awaited upload',
    async (field) => {
      let finishUpload!: (
        value: Awaited<ReturnType<typeof uploadMaterialFile>>,
      ) => void;
      vi.mocked(uploadMaterialFile).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishUpload = resolve;
          }),
      );
      const wrapper = mountPanel();
      const value = draft();
      value.closeDocuments = [
        new File(['a'], 'first.pdf'),
        new File(['b'], 'second.pdf'),
      ];
      submit(wrapper, value);
      await flushPromises();
      expect(uploadMaterialFile).toHaveBeenCalledTimes(1);
      await wrapper.setProps(
        field === 'actorKey'
          ? { actorKey: 'another-actor' }
          : { caseId: versionId },
      );
      finishUpload({
        materialId: 'material',
        contentVersionId: versionId,
      } as Awaited<ReturnType<typeof uploadMaterialFile>>);
      await flushPromises();
      expect(uploadMaterialFile).toHaveBeenCalledTimes(1);
      expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
      expect(wrapper.emitted('done')).toBeUndefined();
      expect(wrapper.find('[data-test="retry"]').exists()).toBe(false);
      expect(wrapper.getComponent(CaseEarlyClosureForm).props('disabled')).toBe(
        false,
      );
    },
  );
  it('prevents concurrent submits and retries the exact request after an uncertain result', async () => {
    let rejectRequest!: (cause: Error) => void;
    vi.mocked(recordCaseEarlyClosure).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const wrapper = mountPanel();
    submit(wrapper);
    submit(wrapper);
    await flushPromises();
    expect(recordCaseEarlyClosure).toHaveBeenCalledTimes(1);
    rejectRequest(new ApiError('timeout', 0, 'TIMEOUT'));
    await flushPromises();
    const original = vi.mocked(recordCaseEarlyClosure).mock.calls[0]!;
    const changed = draft();
    changed.closeAmt = '999';
    submit(wrapper, changed);
    expect(recordCaseEarlyClosure).toHaveBeenCalledTimes(1);
    vi.mocked(recordCaseEarlyClosure).mockResolvedValue({
      id: caseId,
      earlyClosureId: versionId,
      closureId: versionId,
      closureVersionId: versionId,
      version: 5,
      stage: 'WAITING_ARCHIVE',
      recordedAt: '2026-10-29T00:00:00.000Z',
    });
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(vi.mocked(recordCaseEarlyClosure).mock.calls[1]).toEqual(original);
    expect(wrapper.emitted('done')).toHaveLength(1);
  });
  it('closes after props change and restores the original command on remount', async () => {
    vi.mocked(recordCaseEarlyClosure).mockRejectedValue(
      new ApiError('timeout', 0, 'TIMEOUT'),
    );
    const wrapper = mountPanel();
    submit(wrapper);
    await flushPromises();
    const original = vi.mocked(recordCaseEarlyClosure).mock.calls[0]!;
    await wrapper.setProps({ version: 4 });
    await wrapper.get('[data-test="cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    expect(wrapper.emitted('done')).toBeUndefined();
    wrapper.unmount();
    const reopened = mountPanel();
    await reopened.setProps({ version: 4 });
    await reopened.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(vi.mocked(recordCaseEarlyClosure).mock.calls[1]).toEqual(original);
    await reopened.setProps({ actorKey: 'another-actor' });
    expect(reopened.find('[data-test="retry"]').exists()).toBe(false);
    expect(reopened.getComponent(CaseEarlyClosureForm).props('disabled')).toBe(
      false,
    );
  });
  it('removes only the selected screenshot through the real form and submits retained payment fields', async () => {
    vi.mocked(preparePaymentProofUpload).mockResolvedValue(
      Object.freeze({
        actorKey,
        caseId,
        expectedVersion: 3,
        draftId: versionId,
      }),
    );
    vi.mocked(finalizePaymentProofUpload).mockRejectedValue(
      new ApiError('denied', 403, 'FORBIDDEN'),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="close-date"]').setValue('2026-10-29');
    await wrapper.get('[data-test="close-amount"]').setValue('12.50');
    await wrapper.get('[data-test="add-record"]').trigger('click');
    const row = wrapper.get('.payment-record');
    await row.get('input[type="date"]').setValue('2026-10-28');
    await row.get('[aria-label="金额"]').setValue('12.50');
    await row.get('[aria-label="付款人"]').setValue('甲');
    await row.get('[aria-label="收款人"]').setValue('乙');
    const picker = row.get('input[type="file"]');
    Object.defineProperty(picker.element, 'files', {
      configurable: true,
      value: [new File(['a'], 'shot.png', { type: 'image/png' })],
    });
    await picker.trigger('change');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    await row.get('[data-test^="clear-receipt-"]').trigger('click');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(recordCaseEarlyClosure).toHaveBeenCalledWith(
      caseId,
      expect.objectContaining({
        paymentRecords: [
          {
            paidOn: '2026-10-28',
            amount: '12.50',
            payer: '甲',
            payee: '乙',
            screenshotContentVersionId: null,
          },
        ],
      }),
    );
  });
  it('keeps an unknown original request recoverable when a later replay is denied', async () => {
    vi.mocked(recordCaseEarlyClosure)
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'));
    const wrapper = mountPanel();
    submit(wrapper);
    await flushPromises();
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="retry"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('提交结果尚未确认');
    expect(wrapper.emitted('done')).toBeUndefined();
  });
  it('cancels without a command and never reports a rejected record as success', async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-test="cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    expect(recordCaseEarlyClosure).not.toHaveBeenCalled();
    vi.mocked(recordCaseEarlyClosure).mockRejectedValue(
      new ApiError('denied', 403, 'FORBIDDEN'),
    );
    submit(wrapper);
    await flushPromises();
    expect(wrapper.emitted('done')).toBeUndefined();
    expect(wrapper.text()).toContain('提前结案未完成');
  });
});
