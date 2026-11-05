import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Panel from './CaseClosureSettlementUpdatePanel.vue';
import Form from './CaseClosureSettlementUpdateForm.vue';
import ActualPanel from './CaseSettlementActualPanel.vue';
import ProofPanel from './CasePaymentProofSupplementPanel.vue';
import PaymentFields from './CaseClosurePaymentFields.vue';
import { ApiError } from '../../api/http';
import { createListWorkflowContext } from '../../app/list-workflow-context';
const read = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const saveAmounts = vi.hoisted(() => vi.fn());
const supplement = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const prepareProof = vi.hoisted(() => vi.fn());
const finalizeProof = vi.hoisted(() => vi.fn());
vi.mock('../../api/payment-proof-upload', () => ({
  preparePaymentProofUpload: prepareProof,
  finalizePaymentProofUpload: finalizeProof,
}));
const register = vi.hoisted(() => vi.fn());
vi.mock('../../api/settlement-actual-registration', () => ({
  registerCaseSettlementActual: register,
}));
vi.mock('../../api/case-closure-commands', () => ({
  updateCaseClosureSettlement: save,
  updateClosureAmounts: saveAmounts,
  supplementCasePaymentProof: supplement,
}));
vi.mock('../../api/settlement-document-upload', () => ({
  uploadSettlementUpdateDocumentFile: upload,
}));
vi.mock('../../api/case-closure-workspace', () => ({
  getCaseClosureWorkspace: read,
}));
const caseId = '10000000-0000-4000-8000-000000000001';
const closureId = '20000000-0000-4000-8000-000000000002';
function fixture() {
  return {
    stage: 'WAITING_ARCHIVE',
    caseVersion: 7,
    actualRegistrationLawyers: [],
    actual: {
      connection: 'CONNECTED',
      scope: 'CASE',
      customerReceiptState: 'UNKNOWN',
      lawyerInvoiceState: 'UNKNOWN',
      customerReceivedAmount: null,
      lawyerInvoicedAmount: null,
    },
    closure: {
      versionId: closureId,
      closeOn: '2026-10-29',
      amountState: 'KNOWN',
      amount: '100.01',
      paymentType: 'INSTALLMENTS',
    },
    documents: [
      { materialId: 'material', contentVersionId: 'historic-content' },
    ],
    effectivePayments: [
      {
        paymentId: 'payment',
        versionId: 'payment-version',
        paidOn: '2026-10-28',
        amount: '1.01',
        payer: '甲',
        payee: '乙',
        documents: [{ contentVersionId: 'receipt-version' }],
      },
    ],
    refund: { versionId: 'refund-version', declaration: 'COMPLETE', items: [] },
    assessment: {
      versionId: 'assessment-version',
      termsVersion: 2,
      declaration: 'APPLICABLE',
      customerAmount: '30.01',
      lawyerAmount: null,
    },
  };
}
beforeEach(() => {
  supplement.mockReset();
  prepareProof.mockReset();
  finalizeProof.mockReset();
  register.mockReset();
  save.mockReset();
  saveAmounts.mockReset();
  upload.mockReset();
  read.mockReset();
  read.mockResolvedValue(fixture());
});
async function setup(actorKey: string, canCorrectClosure?: boolean) {
  const wrapper = mount(Panel, {
    props: {
      actorKey,
      caseId,
      ...(canCorrectClosure === undefined ? {} : { canCorrectClosure }),
    },
  });
  await flushPromises();
  return wrapper;
}
async function seedPendingProof(actorKey: string, uploadUnknown = false) {
  prepareProof.mockResolvedValue({ draftId: 'retained' });
  finalizeProof.mockResolvedValue('retained-content');
  if (uploadUnknown)
    finalizeProof.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
    );
  else supplement.mockRejectedValueOnce(new Error('lost'));
  const child = mount(ProofPanel, {
    props: {
      actorKey,
      caseId,
      caseVersion: 7,
      stage: 'WAITING_ARCHIVE',
      expectedClosureVersionId: closureId,
      paymentId: 'payment',
      expectedPaymentVersionId: 'payment-version',
    },
  });
  const input = child.get('[data-test="files"]');
  Object.defineProperty(input.element, 'files', {
    value: [new File(['img'], 'proof.png', { type: 'image/png' })],
    configurable: true,
  });
  await input.trigger('change');
  await child.get('form').trigger('submit');
  await flushPromises();
  const original = supplement.mock.calls[0]?.[1];
  child.unmount();
  return original;
}
describe('settlement update panel safety', () => {
  it('does not offer a proof write when the owner-only workspace read is denied', async () => {
    read.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'CASE_ACTION_FORBIDDEN'),
    );
    const wrapper = await setup('readonly-proof-denied');
    expect(wrapper.find('[data-test="proof-payment"]').exists()).toBe(false);
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    expect(prepareProof).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('returns to settlement editing after abandoning a restored proof preparation without opening a new supplement', async () => {
    await seedPendingProof('settlement-abandon-proof', true);
    const wrapper = await setup('settlement-abandon-proof');
    const proofPanel = wrapper.getComponent(ProofPanel);
    await proofPanel.get('[data-test="abandon-preparation"]').trigger('click');
    await flushPromises();
    expect(proofPanel.find('form').exists()).toBe(false);
    expect(supplement).not.toHaveBeenCalled();
    await proofPanel.get('[data-test="close-recovery"]').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    expect(
      wrapper.get('[data-test="proof-payment"]').element.closest('fieldset')
        ?.disabled,
    ).toBe(false);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(prepareProof).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('opens an exact proof target without submitting or replacing the settlement form', async () => {
    const wrapper = await setup('closed-settlement-proof');
    await wrapper.get('[data-test="amount"]').setValue('456.78');
    expect(
      wrapper.get('[data-test="proof-payment"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('[data-test="proof-payment"]').trigger('click');
    expect(wrapper.getComponent(ProofPanel).props()).toMatchObject({
      paymentId: 'payment',
      expectedPaymentVersionId: 'payment-version',
      expectedClosureVersionId: closureId,
      caseVersion: 7,
      allowNew: true,
    });
    expect(wrapper.findComponent(Form).exists()).toBe(true);
    expect(wrapper.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '456.78',
    );
    expect(save).not.toHaveBeenCalled();
    expect(saveAmounts).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('does not show an unavailable message when the settlement form is ready', async () => {
    const wrapper = await setup('available-settlement-message');
    expect(wrapper.findComponent(Form).exists()).toBe(true);
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('当前阶段或结案资料不足，不能保存');
    wrapper.unmount();
  });
  it.each([false, true])(
    'routes amount edits with mixed=%s to exactly one command',
    async (mixed) => {
      const wrapper = await setup(`amount-route-${mixed}`);
      saveAmounts.mockResolvedValue({
        caseId,
        closureVersionId: closureId,
        assessmentVersionId: 'next',
        termsVersion: 3,
        change: {},
      });
      save.mockResolvedValue({ id: caseId });
      const form = wrapper.getComponent(Form);
      await form.get('[aria-label="customer-mode"]').setValue('MANUAL');
      await form.get('[aria-label="customer-amount"]').setValue('34.56');
      if (mixed) await form.get('[data-test="amount"]').setValue('200.00');
      await form.get('form').trigger('submit');
      await flushPromises();
      expect(saveAmounts).toHaveBeenCalledTimes(mixed ? 0 : 1);
      expect(save).toHaveBeenCalledTimes(mixed ? 1 : 0);
      if (!mixed)
        expect(saveAmounts.mock.calls[0]?.[1]).toMatchObject({
          expectedClosureVersionId: closureId,
          expectedTermsVersion: 2,
          expectedAssessmentVersionId: 'assessment-version',
          customerAmount: { mode: 'MANUAL', amount: '34.56' },
          lawyerAmount: { mode: 'KEEP' },
        });
      wrapper.unmount();
    },
  );
  it('retries an uncertain amount command with the same input', async () => {
    const wrapper = await setup('amount-retry');
    saveAmounts
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ caseId });
    const form = wrapper.getComponent(Form);
    await form.get('[aria-label="customer-mode"]').setValue('MANUAL');
    await form.get('[aria-label="customer-amount"]').setValue('34.56');
    await form.get('form').trigger('submit');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('重试原结算更新请求'))!
      .trigger('click');
    await flushPromises();
    expect(saveAmounts).toHaveBeenCalledTimes(2);
    expect(saveAmounts.mock.calls[1]?.[1]).toEqual(
      saveAmounts.mock.calls[0]?.[1],
    );
    expect(save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('preserves the draft and blocks stale submission when a payment changes after proof refresh', async () => {
    await seedPendingProof('proof-concurrent-change');
    const wrapper = await setup('proof-concurrent-change');
    await wrapper.get('[data-test="amount"]').setValue('456.78');
    const proofSession = wrapper.getComponent(ProofPanel).props('session')!;
    proofSession.beginSubmit({ recovery: true });
    proofSession.endSubmit('completed');
    const latest = fixture();
    latest.effectivePayments[0]!.versionId = 'corrected-version';
    read.mockResolvedValueOnce(latest);
    wrapper.getComponent(ProofPanel).vm.$emit('supplemented', {});
    await flushPromises();
    expect(wrapper.text()).toContain('案件或付款记录已变化');
    expect(wrapper.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '456.78',
    );
    expect(
      wrapper
        .get('[data-test="proof-payment"]')
        .element.closest('fieldset')
        ?.hasAttribute('disabled'),
    ).toBe(true);
    wrapper.getComponent(Form).vm.$emit('draft', {} as never);
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    wrapper.unmount();
  });
  it('does not turn an unsubmitted screenshot selection into a new archived command', async () => {
    let wrapper = await setup('unsubmitted-archive');
    await wrapper.get('[data-test="proof-payment"]').trigger('click');
    wrapper.unmount();
    read.mockResolvedValue({ ...fixture(), stage: 'ARCHIVED', caseVersion: 8 });
    wrapper = await setup('unsubmitted-archive');
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    expect(wrapper.findComponent(Form).exists()).toBe(false);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(supplement).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('replays the original historical proof request after archival without reopening settlement editing', async () => {
    const flow = createListWorkflowContext(async () => ({ id: caseId }));
    const context = {
      recordId: caseId,
      actorKey: 'proof-archived-recovery',
      actionKey: 'settlement',
      title: '更新',
    };
    const original = await seedPendingProof(context.actorKey);
    supplement.mockResolvedValueOnce({ id: caseId });
    await flow.sync(context);
    let wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    expect(flow.state.value.requestState).toBe('unknown');
    let panel = wrapper.getComponent(ProofPanel);
    wrapper.unmount();
    flow.dispose();
    const archived = { ...fixture(), stage: 'ARCHIVED', caseVersion: 8 };
    read.mockResolvedValue(archived);
    await flow.sync(context);
    wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    panel = wrapper.getComponent(ProofPanel);
    expect(panel.props('stage')).toBe('ARCHIVED');
    expect(wrapper.findComponent(Form).exists()).toBe(false);
    await panel.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(supplement).toHaveBeenCalledTimes(2);
    expect(supplement.mock.calls[1]?.[1]).toEqual(original);
    expect(prepareProof).toHaveBeenCalledTimes(1);
    expect(finalizeProof).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(flow.state.value.requestState).toBe('idle');
    expect(wrapper.findComponent(Form).exists()).toBe(false);
    wrapper.unmount();
  });
  it('submits historical proof independently, refreshes materials and preserves unsaved settlement fields', async () => {
    const actorKey = 'historical-proof-composition';
    await seedPendingProof(actorKey);
    supplement.mockResolvedValueOnce({ id: caseId });
    const flow = createListWorkflowContext(async () => ({ id: caseId }));
    await flow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'settlement',
      title: '更新',
    });
    const wrapper = mount(Panel, {
      props: { actorKey, caseId, session: flow.state.value.session! },
    });
    await flushPromises();
    await wrapper.get('[data-test="amount"]').setValue('456.78');
    const panel = wrapper.getComponent(ProofPanel);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    const updated = fixture();
    updated.effectivePayments[0]!.documents.push({
      contentVersionId: 'supplement-content',
    });
    read.mockResolvedValue(updated);
    await panel.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(supplement).toHaveBeenCalledTimes(2);
    expect(flow.state.value.status).toBe('ready');
    expect(flow.state.value.requestState).toBe('idle');
    expect(supplement.mock.calls[1]?.[1]).toEqual(
      supplement.mock.calls[0]?.[1],
    );
    expect(wrapper.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '456.78',
    );
    expect(wrapper.text()).toContain('supplement-content');
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    wrapper.unmount();
  });
  it('allows abandoning an unsent unknown preparation and returns shared workflow to idle', async () => {
    const flow = createListWorkflowContext(async () => ({ id: caseId }));
    await flow.sync({
      recordId: caseId,
      actorKey: 'shared-abandon-prep',
      actionKey: 'update',
      title: '更新',
    });
    prepareProof.mockResolvedValue({ draftId: 'abandoned' });
    finalizeProof.mockRejectedValue(
      new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
    );
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'shared-abandon-prep',
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    wrapper.getComponent(PaymentFields).vm.$emit('update:records', [
      {
        id: 'row',
        paymentDate: '2026-10-29',
        amount: '3.01',
        payer: '甲',
        payee: '乙',
        receiptFile: new File(['img'], 'a.png', { type: 'image/png' }),
      },
    ]);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(flow.state.value.requestState).toBe('unknown');
    await wrapper.get('[data-test="abandon-preparation"]').trigger('click');
    await flushPromises();
    expect(flow.state.value.requestState).toBe('idle');
    expect(flow.canLeave()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['case', 'closure'])(
    'retains unknown preparation but stops all uploads after %s version changes',
    async (version) => {
      const actor = `version-proof-${version}`;
      prepareProof.mockResolvedValue({ draftId: 'retained-draft' });
      finalizeProof.mockRejectedValue(
        new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
      );
      let wrapper = await setup(actor);
      wrapper.getComponent(PaymentFields).vm.$emit('update:records', [
        {
          id: 'row',
          paymentDate: '2026-10-29',
          amount: '3.01',
          payer: '甲',
          payee: '乙',
          receiptFile: new File(['img'], 'a.png', { type: 'image/png' }),
        },
      ]);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      wrapper.unmount();
      const value = fixture();
      if (version === 'case') value.caseVersion++;
      else value.closure.versionId = 'changed-closure-version';
      read.mockResolvedValue(value);
      wrapper = await setup(actor);
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('重试原付款截图'))!
        .trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('版本已变化');
      expect(prepareProof).toHaveBeenCalledTimes(1);
      expect(finalizeProof).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('a.png');
      await wrapper.get('[data-test="abandon-preparation"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('已上传候选不会自动关联案件');
      expect(wrapper.find('[data-test="abandon-preparation"]').exists()).toBe(
        false,
      );
      expect(wrapper.get('form').element.closest('fieldset')?.disabled).toBe(
        false,
      );
      save.mockResolvedValueOnce({ id: caseId });
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(save.mock.calls[0]?.[1]).toMatchObject({
        expectedVersion: value.caseVersion,
        expectedClosureVersionId: value.closure.versionId,
        paymentRecords: [],
      });
      expect(prepareProof).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );
  it('shares the preparation lock across remounts and reuses a late successful document upload', async () => {
    let resolve!: (value: unknown) => void;
    upload
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ contentVersionId: 'second-content' });
    save.mockResolvedValue({ id: caseId });
    let wrapper = await setup('shared-preparation-lock');
    prepareProof.mockResolvedValue({ draftId: 'locked-proof' });
    finalizeProof.mockResolvedValue('locked-proof-content');
    wrapper.getComponent(PaymentFields).vm.$emit('update:records', [
      {
        id: 'row',
        paymentDate: '2026-10-29',
        amount: '3.01',
        payer: '甲',
        payee: '乙',
        receiptFile: new File(['img'], 'a.png', { type: 'image/png' }),
      },
    ]);
    const input = wrapper.get('[aria-label="补充结案文书"]');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')],
      configurable: true,
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    wrapper.unmount();
    wrapper = await setup('shared-preparation-lock');
    const retry = wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原付款截图'))!;
    expect(retry.attributes('disabled')).toBeDefined();
    const abandon = wrapper.get('[data-test="abandon-preparation"]');
    expect(abandon.attributes('disabled')).toBeDefined();
    await abandon.trigger('click');
    expect(wrapper.find('[data-test="abandon-preparation"]').exists()).toBe(
      true,
    );
    await retry.trigger('click');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    resolve({ contentVersionId: 'first-content' });
    await flushPromises();
    expect(retry.attributes('disabled')).toBeUndefined();
    await retry.trigger('click');
    await flushPromises();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(prepareProof).toHaveBeenCalledTimes(1);
    expect(finalizeProof).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1].closeContentVersionIds).toEqual([
      'historic-content',
      'first-content',
      'second-content',
    ]);
    wrapper.unmount();
  });
  it('protects the shared session during unknown proof upload and replays only its original handle', async () => {
    const success = vi.fn();
    const flow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
    });
    const context = {
      recordId: caseId,
      actorKey: 'shared-proof-unknown',
      actionKey: 'update',
      title: '更新',
    };
    await flow.sync(context);
    const handle = {
      draftId: 'shared-proof',
      actorKey: context.actorKey,
      caseId,
      expectedVersion: 7,
    };
    prepareProof.mockResolvedValue(handle);
    finalizeProof
      .mockRejectedValueOnce(
        new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
      )
      .mockResolvedValueOnce('content');
    save.mockResolvedValue({ id: caseId });
    const wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    wrapper.getComponent(PaymentFields).vm.$emit('update:records', [
      {
        id: 'row',
        paymentDate: '2026-10-29',
        amount: '3.01',
        payer: '甲',
        payee: '乙',
        receiptFile: new File(['img'], 'a.png', { type: 'image/png' }),
      },
    ]);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(flow.state.value.requestState).toBe('unknown');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原付款截图'))!
      .trigger('click');
    await flushPromises();
    expect(prepareProof).toHaveBeenCalledTimes(1);
    expect(finalizeProof).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('stops proof finalization and the command after identity changes during draft preparation', async () => {
    const wrapper = await setup('proof-switch');
    let resolve!: (value: unknown) => void;
    prepareProof.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    wrapper.getComponent(PaymentFields).vm.$emit('update:records', [
      {
        id: 'row',
        paymentDate: '2026-10-29',
        amount: '3.01',
        payer: '甲',
        payee: '乙',
        receiptFile: new File(['img'], 'a.png', { type: 'image/png' }),
      },
    ]);
    await wrapper.get('form').trigger('submit');
    await wrapper.setProps({ actorKey: 'different-proof-actor' });
    resolve({ draftId: 'late-draft' });
    await flushPromises();
    expect(finalizeProof).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('recovers the original payment upload handle and file then binds its exact version in the atomic update', async () => {
    const handle = {
      draftId: 'proof-draft',
      actorKey: 'new-proof',
      caseId,
      expectedVersion: 7,
    };
    prepareProof.mockResolvedValue(handle);
    finalizeProof
      .mockRejectedValueOnce(
        new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
      )
      .mockResolvedValueOnce('proof-content');
    save
      .mockRejectedValueOnce(new Error('POST result lost'))
      .mockResolvedValueOnce({ id: caseId });
    let wrapper = await setup('new-proof');
    const file = new File(['image'], 'proof.png', { type: 'image/png' });
    wrapper.getComponent(PaymentFields).vm.$emit('update:records', [
      {
        id: 'new-row',
        paymentDate: '2026-10-29',
        amount: '2.01',
        payer: '付款人',
        payee: '收款人',
        receiptFile: file,
      },
    ]);
    await wrapper.get('[data-test="amount"]').setValue('234.56');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('付款截图上传结果未确认');
    expect(wrapper.get('form').element.closest('fieldset')?.disabled).toBe(
      true,
    );
    wrapper.unmount();
    wrapper = await setup('new-proof');
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原付款截图'))!
      .trigger('click');
    await flushPromises();
    expect(prepareProof).toHaveBeenCalledTimes(1);
    expect(prepareProof).toHaveBeenCalledWith(
      { actorKey: 'new-proof', caseId, expectedVersion: 7 },
      file,
    );
    expect(finalizeProof.mock.calls[0]?.[0]).toBe(handle);
    expect(finalizeProof.mock.calls[1]?.[0]).toBe(handle);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toMatchObject({
      closeAmt: '234.56',
      paymentRecords: [
        {
          paidOn: '2026-10-29',
          amount: '2.01',
          screenshotContentVersionId: 'proof-content',
        },
      ],
    });
    expect(wrapper.find('[data-test="abandon-preparation"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
    const changed = fixture();
    changed.caseVersion++;
    changed.closure.versionId = 'newer-closure';
    read.mockResolvedValue(changed);
    wrapper = await setup('new-proof');
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原结算更新'))!
      .trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1]).toEqual(save.mock.calls[0]?.[1]);
    expect(prepareProof).toHaveBeenCalledTimes(1);
    expect(finalizeProof).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  async function registerCustomer(wrapper: Awaited<ReturnType<typeof setup>>) {
    const actual = wrapper.getComponent(ActualPanel);
    await actual.get('[data-test="side"]').setValue('CUSTOMER');
    await actual.get('[data-test="occurred-on"]').setValue('2020-01-02');
    await actual.get('[data-test="amount"]').setValue('1.01');
    await actual.get('form').trigger('submit');
    await flushPromises();
  }
  const actualReceipt = {
    id: closureId,
    allocationId: caseId,
    amount: '1.01',
    allocatedAmount: '1.01',
  };
  it('shows unknown actual totals without inventing zero or archive clearance', async () => {
    const wrapper = await setup('actual-summary-unknown');
    expect(wrapper.get('[data-test="actual-summary"]').text()).toContain(
      '未登记／未知',
    );
    expect(wrapper.get('[data-test="actual-summary"]').text()).not.toContain(
      '0 元',
    );
    expect(wrapper.get('[data-test="actual-summary"]').text()).toContain(
      '不作为归档通过依据',
    );
    wrapper.unmount();
  });
  it('keeps unsaved settlement inputs and source identity while refreshing only actual totals and current lawyers', async () => {
    register.mockResolvedValue(actualReceipt);
    const wrapper = await setup('actual-preserve-draft');
    const form = wrapper.getComponent(Form);
    const initialSource = form.props('source');
    await form.get('[data-test="amount"]').setValue('123.45');
    await form.get('[aria-label="customer-mode"]').setValue('MANUAL');
    await form.get('[aria-label="customer-amount"]').setValue('34.56');
    const changed = fixture();
    read.mockResolvedValue({
      ...changed,
      caseVersion: 99,
      closure: { ...changed.closure, amount: '999.00' },
      actualRegistrationLawyers: [{ id: closureId, fullName: '新当前律师' }],
      actual: {
        ...changed.actual,
        customerReceiptState: 'RECORDED',
        customerReceivedAmount: '1.01',
      },
    });
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    expect(form.props('source')).toBe(initialSource);
    expect(form.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '123.45',
    );
    expect(form.get('[aria-label="customer-amount"]').element).toHaveProperty(
      'value',
      '34.56',
    );
    expect(wrapper.get('[data-test="actual-summary"]').text()).toContain(
      '1.01 元',
    );
    expect(
      wrapper.getComponent(ActualPanel).props('actualRegistrationLawyers'),
    ).toEqual([{ id: closureId, fullName: '新当前律师' }]);
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.emitted('done')).toBeUndefined();
    wrapper.unmount();
  });
  it('supports multiple independent receipts without completing the outer session', async () => {
    register.mockResolvedValue(actualReceipt);
    const success = vi.fn();
    const flow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
    });
    const actorKey = 'actual-multiple-session';
    await flow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'update',
      title: '更新',
    });
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'record-derived-key',
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    expect(wrapper.getComponent(ActualPanel).props('actorKey')).toBe(actorKey);
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    await registerCustomer(wrapper);
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[0][0].idempotencyKey).not.toBe(
      register.mock.calls[1][0].idempotencyKey,
    );
    expect(flow.state.value.status).toBe('ready');
    expect(flow.state.value.requestState).toBe('idle');
    expect(success).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
  it('blocks settlement writes and close while an independent receipt is unknown, then retries the original key', async () => {
    register
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(actualReceipt);
    const wrapper = await setup('actual-unknown-block');
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    const original = register.mock.calls[0][0];
    await wrapper.getComponent(Form).get('form').trigger('submit');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '关闭')!
      .trigger('click');
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.emitted('cancel')).toBeUndefined();
    await wrapper
      .getComponent(ActualPanel)
      .get('[data-test="retry"]')
      .trigger('click');
    await flushPromises();
    expect(register.mock.calls[1][0]).toBe(original);
    expect(read).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('preserves drafts and allows an explicit summary reload after confirmed registration but failed read', async () => {
    register.mockResolvedValue(actualReceipt);
    const wrapper = await setup('actual-refresh-failed');
    const form = wrapper.getComponent(Form);
    await form.get('[data-test="amount"]').setValue('76.54');
    read.mockRejectedValueOnce(new Error('read denied'));
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    expect(wrapper.text()).toContain('实际登记已确认，但最新汇总读取失败');
    expect(form.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '76.54',
    );
    expect(wrapper.find('[data-test="open-actual"]').exists()).toBe(false);
    read.mockResolvedValue(fixture());
    await wrapper.get('[data-test="refresh-actual"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="open-actual"]').exists()).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('does not refresh another identity after an old registration finishes', async () => {
    let resolve!: (value: typeof actualReceipt) => void;
    register.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const wrapper = await setup('actual-switch-old');
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    await wrapper.setProps({ actorKey: 'actual-switch-new' });
    await flushPromises();
    resolve(actualReceipt);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      wrapper.getComponent(Form).get('[data-test="amount"]').element,
    ).toHaveProperty('value', '100.01');
    expect(wrapper.getComponent(ActualPanel).props('actorKey')).toBe(
      'actual-switch-new',
    );
    expect(wrapper.emitted('done')).toBeUndefined();
    wrapper.unmount();
  });
  it('does not offer actual registration when the workspace read is denied', async () => {
    read.mockRejectedValueOnce(new Error('denied'));
    const wrapper = await setup('actual-denied');
    expect(wrapper.findComponent(ActualPanel).exists()).toBe(false);
    expect(wrapper.find('[data-test="open-actual"]').exists()).toBe(false);
    expect(register).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('restores an unknown actual command visibly after remount without an outer session', async () => {
    register
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(actualReceipt);
    let wrapper = await setup('actual-remount-independent');
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    const original = register.mock.calls[0][0];
    wrapper.unmount();
    wrapper = await setup('actual-remount-independent');
    expect(wrapper.getComponent(ActualPanel).isVisible()).toBe(true);
    await wrapper.getComponent(Form).get('form').trigger('submit');
    expect(save).not.toHaveBeenCalled();
    await wrapper
      .getComponent(ActualPanel)
      .get('[data-test="retry"]')
      .trigger('click');
    await flushPromises();
    expect(register.mock.calls[1][0]).toBe(original);
    expect(read).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
  it('keeps the settlement draft on a definite actual refusal and allows explicit return to it', async () => {
    register.mockRejectedValueOnce(
      new ApiError('invalid', 400, 'VALIDATION_ERROR'),
    );
    const wrapper = await setup('actual-definite-refusal');
    const form = wrapper.getComponent(Form);
    await form.get('[data-test="amount"]').setValue('45.67');
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    await registerCustomer(wrapper);
    expect(wrapper.getComponent(ActualPanel).text()).toContain('登记被拒绝');
    expect(read).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="open-actual"]').trigger('click');
    expect(form.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '45.67',
    );
    save.mockResolvedValueOnce({ id: caseId });
    await form.get('form').trigger('submit');
    await flushPromises();
    expect(save.mock.calls[0][1]).toMatchObject({ closeAmt: '45.67' });
    wrapper.unmount();
  });
  it.each([false, true])(
    'retains a receipt after endSubmit refusal (restored=%s)',
    async (restored) => {
      const success = vi.fn();
      const flow = createListWorkflowContext(async () => ({ id: caseId }), {
        success,
      });
      const context = {
        recordId: caseId,
        actorKey: `refused-completion-${restored}`,
        actionKey: 'update',
        title: '更新',
      };
      await flow.sync(context);
      const firstSession = flow.state.value.session!;
      const rejectingSession = {
        ...firstSession,
        endSubmit: vi.fn(() => {
          flow.dispose();
          return false;
        }),
      };
      let wrapper = mount(Panel, {
        props: {
          actorKey: context.actorKey,
          caseId,
          session: restored ? firstSession : rejectingSession,
        },
      });
      await flushPromises();
      let resolve!: (value: unknown) => void;
      save.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      await wrapper.get('form').trigger('submit');
      if (restored) {
        flow.dispose();
        wrapper.unmount();
        resolve({ id: caseId });
        await flushPromises();
        await flow.sync(context);
        wrapper = mount(Panel, {
          props: {
            actorKey: context.actorKey,
            caseId,
            session: {
              ...flow.state.value.session!,
              endSubmit: vi.fn(() => {
                flow.dispose();
                return false;
              }),
            },
          },
        });
        await flushPromises();
      } else {
        resolve({ id: caseId });
        await flushPromises();
      }
      expect(success).not.toHaveBeenCalled();
      wrapper.unmount();
      flow.dispose();
      await flow.sync(context);
      wrapper = mount(Panel, {
        props: {
          actorKey: context.actorKey,
          caseId,
          session: flow.state.value.session!,
        },
      });
      await flushPromises();
      expect(success).toHaveBeenCalledTimes(1);
      expect(flow.state.value.status).toBe('closed');
      expect(save).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );
  it('consumes a success received before successor mount once without advancing a later session again', async () => {
    const success = vi.fn();
    const flow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
    });
    const context = {
      recordId: caseId,
      actorKey: 'success-before-mount',
      actionKey: 'update',
      title: '更新',
    };
    await flow.sync(context);
    let wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    let resolve!: (value: unknown) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await wrapper.get('form').trigger('submit');
    flow.dispose();
    wrapper.unmount();
    resolve({ id: caseId });
    await flushPromises();
    expect(success).not.toHaveBeenCalled();
    await flow.sync(context);
    wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    expect(success).toHaveBeenCalledTimes(1);
    expect(flow.state.value.status).toBe('closed');
    wrapper.unmount();
    await flow.sync(context);
    wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    expect(flow.state.value.status).toBe('ready');
    expect(flow.state.value.requestState).toBe('idle');
    expect(success).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('does not complete another actor workflow when an old request succeeds', async () => {
    const success = vi.fn();
    const flow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
    });
    const context = {
      recordId: caseId,
      actorKey: 'old-late-actor',
      actionKey: 'update',
      title: '更新',
    };
    await flow.sync(context);
    const wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    let resolve!: (value: unknown) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await wrapper.get('form').trigger('submit');
    await flow.sync({ ...context, actorKey: 'different-late-actor' });
    await wrapper.setProps({
      actorKey: 'different-late-actor',
      session: flow.state.value.session!,
    });
    resolve({ id: caseId });
    await flushPromises();
    expect(flow.state.value.status).toBe('ready');
    expect(success).not.toHaveBeenCalled();
    expect(wrapper.find('form').exists()).toBe(true);
    wrapper.unmount();
  });
  it('settles a remounted shared session exactly once when the original in-flight request later succeeds', async () => {
    const success = vi.fn();
    const closed = vi.fn();
    const flow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
      closed,
    });
    const context = {
      recordId: caseId,
      actorKey: 'late-original-success',
      actionKey: 'update',
      title: '更新',
    };
    await flow.sync(context);
    let wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    let resolve!: (value: unknown) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await wrapper.get('form').trigger('submit');
    expect(flow.state.value.requestState).toBe('submitting');
    flow.dispose();
    wrapper.unmount();
    await flow.sync(context);
    wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    expect(flow.state.value.requestState).toBe('unknown');
    resolve({ id: caseId });
    await flushPromises();
    expect(flow.state.value.status).toBe('closed');
    expect(success).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('done')).toBeUndefined();
    await flushPromises();
    expect(success).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('coordinates upload and command as one shared submission, restores unknown and blocks direct exit', async () => {
    const success = vi.fn();
    const flow = createListWorkflowContext(async () => ({ id: caseId }), {
      success,
    });
    const context = {
      recordId: caseId,
      actorKey: 'shared-recovery',
      actionKey: 'update',
      title: '更新',
    };
    await flow.sync(context);
    let wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    save.mockRejectedValueOnce(new Error('lost'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(flow.state.value.requestState).toBe('unknown');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    const original = save.mock.calls[0]?.[1];
    wrapper.unmount();
    await flow.sync(context);
    wrapper = mount(Panel, {
      props: {
        actorKey: context.actorKey,
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    expect(flow.state.value.requestState).toBe('unknown');
    save.mockResolvedValueOnce({ id: caseId });
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原'))!
      .trigger('click');
    await flushPromises();
    expect(save.mock.calls[1]?.[1]).toEqual(original);
    expect(success).toHaveBeenCalledTimes(1);
    expect(flow.state.value.status).toBe('closed');
    expect(wrapper.emitted('done')).toBeUndefined();
    wrapper.unmount();
  });
  it('stops shared-session uploads when the owning workflow is invalidated', async () => {
    const flow = createListWorkflowContext(async () => ({ id: caseId }));
    await flow.sync({
      recordId: caseId,
      actorKey: 'shared-invalidate',
      actionKey: 'update',
      title: '更新',
    });
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'shared-invalidate',
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    let resolve!: (value: unknown) => void;
    upload.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const input = wrapper.get('[aria-label="补充结案文书"]');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')],
      configurable: true,
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    expect(flow.state.value.requestState).toBe('submitting');
    flow.dispose();
    resolve({ contentVersionId: 'late' });
    await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('returns a shared session to idle after definite rejection', async () => {
    const flow = createListWorkflowContext(async () => ({ id: caseId }));
    await flow.sync({
      recordId: caseId,
      actorKey: 'shared-reject',
      actionKey: 'update',
      title: '更新',
    });
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'shared-reject',
        caseId,
        session: flow.state.value.session!,
      },
    });
    await flushPromises();
    save.mockRejectedValueOnce(new ApiError('conflict', 409, 'CONFLICT'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(flow.state.value.requestState).toBe('idle');
    expect(wrapper.find('form').exists()).toBe(true);
    wrapper.unmount();
  });
  it.each(['0', '12.34', null])(
    'requires explicit historical UNKNOWN decisions and preserves amount %s',
    async (amount) => {
      const value = fixture();
      value.closure.amountState = 'UNKNOWN';
      value.closure.paymentType = 'UNKNOWN';
      read.mockResolvedValue({
        ...value,
        closure: { ...value.closure, amount: null },
      });
      save.mockResolvedValue({ id: caseId });
      const wrapper = await setup(`unknown-${amount}`);
      expect(wrapper.findComponent(Form).exists()).toBe(false);
      expect(
        wrapper.get('[aria-label="确认历史付款类型"]').element,
      ).toHaveProperty('value', '');
      await wrapper.get('[aria-label="确认历史金额待确认"]').setValue(true);
      expect(wrapper.findComponent(Form).exists()).toBe(false);
      expect(save).not.toHaveBeenCalled();
      await wrapper
        .get('[aria-label="确认历史付款类型"]')
        .setValue('INSTALLMENTS');
      expect(wrapper.get('[data-test="unknown"]').element).toHaveProperty(
        'checked',
        true,
      );
      if (amount !== null) {
        await wrapper.get('[data-test="unknown"]').setValue(false);
        await wrapper.get('[data-test="amount"]').setValue(amount);
      }
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(save.mock.calls[0]?.[1]).toMatchObject({
        closeAmountState: amount === null ? 'PENDING' : 'KNOWN',
        closeAmt: amount,
        paymentType: 'INSTALLMENTS',
      });
      wrapper.unmount();
    },
  );
  it('shows an existing PENDING amount without inventing a zero', async () => {
    const value = fixture();
    value.closure.amountState = 'PENDING';
    read.mockResolvedValue({
      ...value,
      closure: { ...value.closure, amount: null },
    });
    const wrapper = await setup('pending-amount');
    expect(wrapper.get('[data-test="unknown"]').element).toHaveProperty(
      'checked',
      true,
    );
    expect(wrapper.get('[data-test="amount"]').element).toHaveProperty(
      'value',
      '',
    );
    expect(wrapper.find('[aria-label="确认历史金额待确认"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
  it.each([400, 403, 409])(
    'unlocks a definitely rejected first request (%s)',
    async (status) => {
      save.mockRejectedValueOnce(new ApiError('rejected', status, 'REJECTED'));
      const wrapper = await setup(`rejected-${status}`);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.find('form').exists()).toBe(true);
      expect(wrapper.text()).toContain('保存被拒绝');
      save.mockResolvedValueOnce({ id: caseId });
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(save.mock.calls[1]?.[1].idempotencyKey).not.toEqual(
        save.mock.calls[0]?.[1].idempotencyKey,
      );
      wrapper.unmount();
    },
  );
  it('keeps an uncertain original request after a later forbidden response', async () => {
    save
      .mockRejectedValueOnce(new Error('lost'))
      .mockRejectedValueOnce(new ApiError('forbidden', 403, 'FORBIDDEN'));
    const wrapper = await setup('unknown-then-forbidden');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原'))!
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('form').exists()).toBe(false);
    expect(save.mock.calls[1]?.[1]).toEqual(save.mock.calls[0]?.[1]);
    expect(wrapper.text()).toContain('保存结果未确认');
    wrapper.unmount();
  });
  it('does not infer missing closure facts', async () => {
    read.mockResolvedValue({
      stage: 'WAITING_ARCHIVE',
      closure: { versionId: null },
    });
    const wrapper = mount(Panel, {
      props: { actorKey: 'unknown-reader', caseId: 'case' },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('当前阶段或结案资料不足');
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount();
  });
  it('shows read failures instead of an empty successful workspace', async () => {
    read.mockRejectedValue(new Error('forbidden'));
    const wrapper = mount(Panel, {
      props: { actorKey: 'denied-reader', caseId: 'case' },
    });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '无法读取授权结案工作区',
    );
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount();
  });
  it('maps the authorized workspace and real form changes without replaying existing payments', async () => {
    save.mockResolvedValue({ id: caseId, stage: 'WAITING_ARCHIVE' });
    const wrapper = await setup('mapping');
    const form = wrapper.getComponent(Form);
    expect(form.props('source')).toMatchObject({
      expectedClosureVersionId: closureId,
      documents: [{ id: 'historic-content' }],
      payments: [
        { versionId: 'payment-version', receiptIds: ['receipt-version'] },
      ],
      lawyerAmount: null,
    });
    form.getComponent(PaymentFields).vm.$emit('update:records', [
      {
        id: 'new',
        paymentDate: '2026-10-29',
        amount: '2.01',
        payer: '丙',
        payee: '丁',
      },
    ]);
    await form
      .get('[aria-label="退费操作"]')
      .setValue('DECLARE_NOT_APPLICABLE');
    await form.get('[aria-label="customer-mode"]').setValue('MANUAL');
    await form
      .get('[aria-label="customer-amount"]')
      .setValue('1234567890123456.45');
    await form.get('form').trigger('submit');
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: 7,
      expectedClosureVersionId: closureId,
      closeContentVersionIds: ['historic-content'],
      closeAmt: '100.01',
      paymentRecords: [
        {
          paidOn: '2026-10-29',
          amount: '2.01',
          payer: '丙',
          payee: '丁',
          screenshotContentVersionId: null,
        },
      ],
      refund: {
        expectedVersionId: 'refund-version',
        kind: 'DECLARE_NOT_APPLICABLE',
        items: [],
      },
      settlement: {
        expectedAssessmentVersionId: 'assessment-version',
        expectedTermsVersion: 2,
        declaration: 'APPLICABLE',
        customerAmount: { mode: 'MANUAL', amount: '1234567890123456.45' },
        lawyerAmount: { mode: 'KEEP' },
      },
    });
    expect(wrapper.emitted('done')).toHaveLength(1);
    expect(wrapper.text()).toContain('保存成功');
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关闭')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    wrapper.unmount();
  });
  it('associates the专用上传 content version rather than material id', async () => {
    const wrapper = await setup('upload');
    upload.mockResolvedValue({
      materialId: 'new-material',
      contentVersionId: 'new-content',
    });
    save.mockResolvedValue({ id: caseId });
    const input = wrapper.get('[aria-label="补充结案文书"]');
    const file = new File(['pdf'], 'a.pdf', { type: 'application/pdf' });
    Object.defineProperty(input.element, 'files', {
      value: [file],
      configurable: true,
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(upload).toHaveBeenCalledWith(caseId, closureId, file);
    expect(save.mock.calls[0]?.[1].closeContentVersionIds).toEqual([
      'historic-content',
      'new-content',
    ]);
    wrapper.unmount();
  });
  it('restores an uncertain request after closing and retries the same body and key only once', async () => {
    save.mockRejectedValueOnce(new Error('connection lost'));
    let wrapper = await setup('recovery');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const original = save.mock.calls[0]?.[1];
    expect(wrapper.text()).toContain('保存结果未确认');
    wrapper.unmount();
    wrapper = await setup('recovery', false);
    expect(wrapper.find('form').exists()).toBe(false);
    let resolve!: (value: unknown) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const button = wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试原'))!;
    await button.trigger('click');
    await button.trigger('click');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1]).toEqual(original);
    resolve({ id: caseId });
    await flushPromises();
    expect(wrapper.emitted('done')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['actor', 'case'])(
    'stops remaining uploads and command after switching %s',
    async (identity) => {
      const wrapper = await setup(`switch-${identity}`);
      let resolve!: (value: unknown) => void;
      upload.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      const input = wrapper.get('[aria-label="补充结案文书"]');
      Object.defineProperty(input.element, 'files', {
        value: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')],
        configurable: true,
      });
      await input.trigger('change');
      await wrapper.get('form').trigger('submit');
      await wrapper.setProps(
        identity === 'actor'
          ? { actorKey: 'changed' }
          : { caseId: 'other-case' },
      );
      resolve({ contentVersionId: 'late-content' });
      await flushPromises();
      expect(upload).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      expect(wrapper.emitted('done')).toBeUndefined();
      wrapper.unmount();
    },
  );
});

it('forwards saved refund amounts and preserves the exact amount/body/key after unknown and remount', async () => {
  const data = {
    ...fixture(),
    refund: {
      versionId: 'refund-version',
      declaration: 'COMPLETE',
      items: [
        {
          itemId: '50000000-0000-4000-8000-000000000005',
          party: 'COURT',
          status: 'PENDING',
          description: '退费',
          amount: '800.12',
        },
      ],
    },
  };
  read.mockResolvedValue(data);
  save.mockRejectedValueOnce(new Error('lost'));
  let wrapper = await setup('refund-amount-recovery');
  expect(
    wrapper.getComponent(Form).props('source').refund?.items[0]?.amount,
  ).toBe('800.12');
  await wrapper.get('[aria-label="退费操作"]').setValue('RECORD');
  await wrapper.get('[aria-label="退费金额"]').setValue('0.01');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  const original = save.mock.calls[0]![1];
  expect(original.refund.items[0].amount).toBe('0.01');
  wrapper.unmount();
  wrapper = await setup('refund-amount-recovery');
  save.mockResolvedValueOnce({ id: caseId });
  await wrapper
    .findAll('button')
    .find((b) => b.text().includes('重试原'))!
    .trigger('click');
  await flushPromises();
  expect(save.mock.calls[1]![1]).toEqual(original);
  wrapper.unmount();
});

it('opens settlement editing for a pending date and preserves null in the request', async () => {
  read.mockResolvedValue({
    ...fixture(),
    closure: { ...fixture().closure, closeOn: null },
  });
  const wrapper = await setup('pending-date-owner');
  const form = wrapper.getComponent(Form);
  expect(form.props('source').closeAt).toBeNull();
  await form.get('form').trigger('submit');
  await flushPromises();
  expect(save.mock.calls[0]?.[1]).toMatchObject({
    closeAt: null,
    closeAmt: '100.01',
  });
  wrapper.unmount();
});
