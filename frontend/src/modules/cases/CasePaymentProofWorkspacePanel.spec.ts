import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ApiError } from '../../api/http';
import Panel from './CasePaymentProofWorkspacePanel.vue';
import ProofPanel from './CasePaymentProofSupplementPanel.vue';
import CorrectionPanel from './CasePaymentCorrectionPanel.vue';
import { createListWorkflowContext } from '../../app/list-workflow-context';
const read = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const paymentHistory = vi.hoisted(() => vi.fn());
vi.mock('../../api/case-payment-correction', () => ({
  getCasePaymentHistory: paymentHistory,
  correctCasePayment: vi.fn(),
}));
const proof = vi.hoisted(() => ({
  prepare: vi.fn(),
  finalize: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('../../api/payment-proof-upload', () => ({
  preparePaymentProofUpload: proof.prepare,
  finalizePaymentProofUpload: proof.finalize,
}));
vi.mock('../../api/case-closure-commands', () => ({
  supplementCasePaymentProof: proof.submit,
}));
vi.mock('../../api/case-closure-workspace', () => ({
  getCaseClosureWorkspace: read,
}));
vi.mock('../../api/materials', () => ({ downloadMaterialVersion: download }));
const fixture = (stage = 'ARCHIVED') => ({
  caseId: 'case',
  caseVersion: 7,
  stage,
  closure: { versionId: 'closure-v' },
  effectivePayments: [
    {
      paymentId: 'first',
      versionId: 'payment-v',
      paidOn: '2026-10-29',
      amount: '10.01',
      payer: '甲',
      payee: '乙',
      documents: [
        {
          materialId: 'original-material',
          contentVersionId: 'original-version',
        },
        {
          materialId: 'supplement-material',
          contentVersionId: 'supplement-version',
        },
      ],
    },
    {
      paymentId: 'second',
      versionId: 'second-v',
      paidOn: '2026-10-28',
      amount: '2.00',
      payer: '丙',
      payee: '丁',
      documents: [],
    },
  ],
});
beforeEach(() => {
  paymentHistory.mockReset();
  read.mockReset().mockResolvedValue(fixture());
  download.mockReset().mockResolvedValue(undefined);
});
async function setup(actorKey: string) {
  const workflow = createListWorkflowContext(async () => ({ id: 'case' }));
  await workflow.sync({
    recordId: 'case',
    actorKey,
    actionKey: 'proof',
    title: '付款截图',
  });
  const session = workflow.state.value.session;
  if (!session) throw new Error('missing session');
  const wrapper = mount(Panel, {
    props: { actorKey, caseId: 'case', session },
    global: { stubs: { CasePaymentProofSupplementPanel: true } },
  });
  await flushPromises();
  return { wrapper, workflow };
}
describe('payment proof workspace', () => {
  it('uses the existing authorized payment entry for correction and rereads after save without altering archive status', async () => {
    const { wrapper } = await setup('correction-workspace');
    await wrapper.get('[data-test="correct-first"]').trigger('click');
    const child = wrapper.getComponent(CorrectionPanel);
    expect(child.props('payment')).toMatchObject({
      versionId: 'payment-v',
      amount: '10.01',
    });
    expect(
      wrapper.get('[data-test="supplement-first"]').attributes('disabled'),
    ).toBeDefined();
    read.mockResolvedValueOnce({ ...fixture(), effectivePayments: [] });
    child.vm.$emit('saved', {
      versionId: 'void-v',
      stage: 'ARCHIVED',
      reviewRequired: true,
    });
    await flushPromises();
    expect(wrapper.text()).toContain('案件仍保持归档');
    expect(wrapper.find('[data-test="payment-first"]').exists()).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('rejects stale history heads even when caseVersion and closure head have not changed', async () => {
    const { wrapper } = await setup('stale-payment-history');
    paymentHistory.mockResolvedValue({
      caseId: 'case',
      caseVersion: 7,
      stage: 'ARCHIVED',
      closureVersionId: 'closure-v',
      paymentHistory: [],
    });
    await wrapper.get('[data-test="history"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('付款版本已变化');
    expect(
      wrapper.get('[data-test="correct-first"]').attributes('disabled'),
    ).toBeDefined();
  });
  it.each(['network', 'forbidden'])(
    'blocks new proof after cancel reread fails with %s until a fresh authorized read succeeds',
    async (failure) => {
      const { wrapper } = await setup(`cancel-reread-${failure}`);
      await wrapper.get('[data-test="supplement-first"]').trigger('click');
      const child = wrapper.getComponent(ProofPanel);
      read.mockRejectedValueOnce(
        failure === 'forbidden'
          ? new ApiError('forbidden', 403, 'CASE_ACTION_FORBIDDEN')
          : new Error('offline'),
      );
      child.vm.$emit('cancel');
      await flushPromises();
      expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
      expect(wrapper.find('[data-test="supplement-first"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).toContain('无法读取授权付款工作区');
      const prepareCalls = proof.prepare.mock.calls.length;
      read.mockResolvedValueOnce(fixture());
      await wrapper.get('[data-test="reread"]').trigger('click');
      await flushPromises();
      expect(
        wrapper.get('[data-test="supplement-first"]').attributes('disabled'),
      ).toBeUndefined();
      expect(proof.prepare).toHaveBeenCalledTimes(prepareCalls);
      wrapper.unmount();
    },
  );

  it('ignores a late read after actor and case switch', async () => {
    let resolve: ((value: ReturnType<typeof fixture>) => void) | undefined;
    read.mockReturnValueOnce(
      new Promise<ReturnType<typeof fixture>>((done) => {
        resolve = done;
      }),
    );
    const { wrapper } = await setup('stale');
    read.mockResolvedValueOnce({ ...fixture(), effectivePayments: [] });
    await wrapper.setProps({
      actorKey: 'next',
      caseId: 'next-case',
      session: undefined,
    });
    await flushPromises();
    resolve?.(fixture());
    await flushPromises();
    expect(wrapper.text()).not.toContain('付款人：甲');
    wrapper.unmount();
  });
  it('cannot start a new supplement after abandoning an unknown upload preparation', async () => {
    proof.prepare.mockReset().mockResolvedValue({ draftId: 'draft' });
    proof.finalize.mockReset().mockRejectedValueOnce(new Error('lost'));
    proof.submit.mockReset();
    const child = mount(ProofPanel, {
      props: {
        actorKey: 'abandon-retained',
        caseId: 'case',
        caseVersion: 7,
        stage: 'ARCHIVED',
        expectedClosureVersionId: 'closure-v',
        paymentId: 'first',
        expectedPaymentVersionId: 'payment-v',
      },
    });
    const input = child.get('[data-test="files"]');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['image'], 'proof.png', { type: 'image/png' })],
      configurable: true,
    });
    await input.trigger('change');
    await child.get('form').trigger('submit');
    await flushPromises();
    child.unmount();
    const workflow = createListWorkflowContext(async () => ({ id: 'case' }));
    await workflow.sync({
      recordId: 'case',
      actorKey: 'abandon-retained',
      actionKey: 'proof',
      title: '付款截图',
    });
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'abandon-retained',
        caseId: 'case',
        session: workflow.state.value.session!,
      },
    });
    await flushPromises();
    const restored = wrapper.getComponent(ProofPanel);
    await restored.get('[data-test="abandon-preparation"]').trigger('click');
    await flushPromises();
    expect(restored.find('form').exists()).toBe(false);
    expect(proof.prepare).toHaveBeenCalledTimes(1);
    expect(proof.submit).not.toHaveBeenCalled();
    await restored.get('[data-test="close-recovery"]').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    expect(workflow.canLeave()).toBe(true);
    wrapper.unmount();
  });
  it('restores an existing unknown request and retries its original key while new supplements are disabled', async () => {
    proof.prepare.mockResolvedValue({ draftId: 'draft' });
    proof.finalize.mockResolvedValue('content');
    proof.submit
      .mockReset()
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ id: 'receipt' });
    const child = mount(ProofPanel, {
      props: {
        actorKey: 'retained',
        caseId: 'case',
        caseVersion: 7,
        stage: 'ARCHIVED',
        expectedClosureVersionId: 'closure-v',
        paymentId: 'first',
        expectedPaymentVersionId: 'payment-v',
      },
    });
    const input = child.get('[data-test="files"]');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['image'], 'proof.png', { type: 'image/png' })],
      configurable: true,
    });
    await input.trigger('change');
    await child.get('form').trigger('submit');
    await flushPromises();
    const original = proof.submit.mock.calls[0]?.[1];
    expect(original.idempotencyKey).toBeTruthy();
    child.unmount();
    const workflow = createListWorkflowContext(async () => ({ id: 'case' }));
    await workflow.sync({
      recordId: 'case',
      actorKey: 'retained',
      actionKey: 'proof',
      title: '付款截图',
    });
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'retained',
        caseId: 'case',
        session: workflow.state.value.session!,
      },
    });
    await flushPromises();
    expect(
      wrapper.get('[data-test="supplement-second"]').attributes('disabled'),
    ).toBeDefined();
    const restored = wrapper.getComponent(ProofPanel);
    expect(restored.props()).toMatchObject({
      actorKey: 'retained',
      caseId: 'case',
      caseVersion: 7,
      stage: 'ARCHIVED',
      expectedClosureVersionId: 'closure-v',
      paymentId: 'first',
      expectedPaymentVersionId: 'payment-v',
      allowNew: false,
    });
    expect(workflow.canLeave()).toBe(false);
    await wrapper.get('[data-test="close"]').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(restored.props('session')?.beginSubmit()).toBe(false);
    await restored.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(proof.submit).toHaveBeenCalledTimes(2);
    expect(proof.submit.mock.calls[1]?.[1]).toEqual(original);
    expect(workflow.canLeave()).toBe(true);
    expect(workflow.state.value.status).toBe('ready');
    await wrapper.get('[data-test="close"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['ARCHIVED', 'WAITING_ARCHIVE'])(
    'shows history and opens exact authorized supplement target in %s',
    async (stage) => {
      read.mockResolvedValue(fixture(stage));
      const { wrapper } = await setup(`closed-${stage}`);
      expect(wrapper.text()).toContain('当前负责人可独立后补');
      expect(wrapper.text()).toContain('10.01');
      expect(wrapper.text()).toContain('付款人：甲');
      expect(wrapper.text()).toContain('收款人：乙');
      expect(wrapper.text()).toContain('supplement-version');
      await wrapper.get('[data-test="download"]').trigger('click');
      expect(download).toHaveBeenCalledWith(
        'original-material',
        'original-version',
        expect.any(AbortSignal),
      );
      expect(
        wrapper.get('[data-test="supplement-first"]').attributes('disabled'),
      ).toBeUndefined();
      await wrapper.get('[data-test="supplement-first"]').trigger('click');
      expect(wrapper.getComponent(ProofPanel).props()).toMatchObject({
        paymentId: 'first',
        expectedPaymentVersionId: 'payment-v',
        expectedClosureVersionId: 'closure-v',
        caseVersion: 7,
        stage,
        allowNew: true,
      });
      wrapper.unmount();
    },
  );
  it('allows rereading after a read failure', async () => {
    read.mockRejectedValueOnce(new Error('forbidden'));
    const { wrapper } = await setup('denied');
    expect(wrapper.text()).toContain('无法读取授权付款工作区');
    expect(wrapper.find('[data-test="supplement-first"]').exists()).toBe(false);
    read.mockResolvedValueOnce(fixture());
    await wrapper.get('[data-test="reread"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="supplement-first"]').attributes('disabled'),
    ).toBeUndefined();
    wrapper.unmount();
  });
  it('does not enable supplementation for another stage', async () => {
    read.mockResolvedValueOnce(fixture('EXECUTING'));
    const { wrapper } = await setup('stage');
    expect(wrapper.find('[data-test="supplement-first"]').exists()).toBe(false);
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    wrapper.unmount();
  });
  it('refreshes only screenshot display after a recovered save and allows retrying a failed read without another write', async () => {
    proof.prepare.mockReset().mockResolvedValue({ draftId: 'refresh-draft' });
    proof.finalize.mockReset().mockResolvedValue('refresh-content');
    proof.submit
      .mockReset()
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ id: 'receipt' });
    const child = mount(ProofPanel, {
      props: {
        actorKey: 'refresh',
        caseId: 'case',
        caseVersion: 7,
        stage: 'ARCHIVED',
        expectedClosureVersionId: 'closure-v',
        paymentId: 'first',
        expectedPaymentVersionId: 'payment-v',
      },
    });
    const input = child.get('[data-test="files"]');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['image'], 'proof.png', { type: 'image/png' })],
      configurable: true,
    });
    await input.trigger('change');
    await child.get('form').trigger('submit');
    await flushPromises();
    child.unmount();
    const workflow = createListWorkflowContext(async () => ({ id: 'case' }));
    await workflow.sync({
      recordId: 'case',
      actorKey: 'refresh',
      actionKey: 'proof',
      title: '付款截图',
    });
    const wrapper = mount(Panel, {
      props: {
        actorKey: 'refresh',
        caseId: 'case',
        session: workflow.state.value.session!,
      },
    });
    await flushPromises();
    read.mockRejectedValueOnce(new Error('read unavailable'));
    await wrapper
      .getComponent(ProofPanel)
      .get('[data-test="retry"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('付款截图已保存，但展示刷新失败');
    expect(wrapper.findComponent(ProofPanel).exists()).toBe(false);
    expect(
      wrapper.get('[data-test="supplement-first"]').attributes('disabled'),
    ).toBeDefined();
    const newer = fixture();
    newer.effectivePayments[0]!.documents.push({
      materialId: 'new-material',
      contentVersionId: 'new-version',
    });
    newer.effectivePayments[0]!.amount = '999.00';
    read.mockResolvedValueOnce(newer);
    await wrapper.get('[data-test="refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('new-version');
    expect(wrapper.text()).toContain('10.01');
    expect(wrapper.text()).not.toContain('999.00');
    expect(proof.submit).toHaveBeenCalledTimes(2);
    expect(proof.submit.mock.calls[1]?.[1]).toEqual(
      proof.submit.mock.calls[0]?.[1],
    );
    expect(workflow.state.value.status).toBe('ready');
    wrapper.unmount();
  });
});
