import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Panel from './CasePaymentProofSupplementPanel.vue';
import { ApiError } from '../../api/http';
import { createListWorkflowContext } from '../../app/list-workflow-context';
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  finalize: vi.fn(),
  supplement: vi.fn(),
}));
vi.mock('../../api/payment-proof-upload', () => ({
  preparePaymentProofUpload: mocks.prepare,
  finalizePaymentProofUpload: mocks.finalize,
}));
vi.mock('../../api/case-closure-commands', () => ({
  supplementCasePaymentProof: mocks.supplement,
}));
const caseId = '10000000-0000-4000-8000-000000000001';
const content = '20000000-0000-4000-8000-000000000002';
const handle = Object.freeze({ draftId: 'draft' });
const result = { id: 'receipt' };
let sequence = 0;
function panel(extra = {}) {
  return mount(Panel, {
    props: {
      actorKey: `proof-${++sequence}`,
      caseId,
      caseVersion: 10,
      stage: 'WAITING_ARCHIVE',
      expectedClosureVersionId: caseId,
      paymentId: content,
      expectedPaymentVersionId: caseId,
      ...extra,
    },
  });
}
async function choose(
  wrapper: ReturnType<typeof panel>,
  file = new File(['image'], 'proof.png', { type: 'image/png' }),
) {
  Object.defineProperty(wrapper.get('input').element, 'files', {
    value: [file],
    configurable: true,
  });
  await wrapper.get('input').trigger('change');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  return file;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
beforeEach(() => {
  mocks.prepare.mockReset().mockResolvedValue(handle);
  mocks.finalize.mockReset().mockResolvedValue(content);
  mocks.supplement.mockReset().mockResolvedValue(result);
});
describe('independent payment proof supplement', () => {
  it.each([false, true])(
    'does not clear a synchronously switched identity or its preparation (existing=%s)',
    async (existing) => {
      const actorA = `abandon-switch-a-${++sequence}`;
      const actorB = `abandon-switch-b-${++sequence}`;
      const workflowA = createListWorkflowContext(async () => ({ id: caseId }));
      const workflowB = createListWorkflowContext(async () => ({ id: caseId }));
      await workflowA.sync({
        recordId: caseId,
        actorKey: actorA,
        actionKey: 'settlement',
        title: '结算',
      });
      await workflowB.sync({
        recordId: caseId,
        actorKey: actorB,
        actionKey: 'settlement',
        title: '结算',
      });
      const sessionA = workflowA.state.value.session!;
      const sessionB = workflowB.state.value.session!;
      if (existing) {
        const other = panel({ actorKey: actorB, session: sessionB });
        mocks.finalize.mockRejectedValueOnce(
          new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
        );
        await choose(other);
        other.unmount();
      }
      const wrapper = panel({
        actorKey: actorA,
        session: {
          ...sessionA,
          endSubmit(outcome: Parameters<typeof sessionA.endSubmit>[0]) {
            const accepted = sessionA.endSubmit(outcome);
            if (outcome === 'failed') {
              // Deliberately trigger synchronous reactive props updates from the
              // completion callback, before abandonPreparation regains control.
              wrapper.vm.$.props.actorKey = actorB;
              wrapper.vm.$.props.session = sessionB;
            }
            return accepted;
          },
        },
      });
      mocks.finalize.mockRejectedValueOnce(
        new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
      );
      await choose(wrapper);
      await wrapper.get('[data-test="abandon-preparation"]').trigger('click');
      expect(wrapper.text()).not.toContain('已放弃本地上传准备');
      expect(wrapper.find('form').exists()).toBe(!existing);
      if (existing)
        expect(wrapper.find('[data-test="retry"]').exists()).toBe(true);
      wrapper.unmount();
      const restoredB = panel({ actorKey: actorB });
      expect(restoredB.find('form').exists()).toBe(!existing);
      restoredB.unmount();
      const restoredA = panel({ actorKey: actorA });
      expect(restoredA.find('[data-test="retry"]').exists()).toBe(true);
      restoredA.unmount();
    },
  );
  it('abandons only local preparation after version drift and releases the session', async () => {
    const actorKey = `abandon-${++sequence}`;
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    await workflow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'settlement',
      title: '结算',
    });
    const wrapper = panel({ actorKey, session: workflow.state.value.session! });
    mocks.finalize.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
    );
    await choose(wrapper);
    await wrapper.setProps({ caseVersion: 11 });
    await wrapper.get('[data-test="abandon-preparation"]').trigger('click');
    expect(workflow.state.value.requestState).toBe('idle');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('[data-test="close-recovery"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('未删除服务端文件或历史记录');
    expect(wrapper.emitted('supplemented')).toBeUndefined();
    expect(mocks.supplement).not.toHaveBeenCalled();
    // A refreshed workspace supplies the next version for new preparation.
    await wrapper.setProps({ caseVersion: 12 });
    await choose(wrapper);
    expect(mocks.prepare.mock.calls[1]![0].expectedVersion).toBe(12);
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    wrapper.unmount();
  });
  it('offers no abandon action during an in-flight upload or for an unknown business command', async () => {
    const upload = deferred<typeof handle>();
    mocks.prepare.mockReturnValueOnce(upload.promise);
    const wrapper = panel();
    await choose(wrapper);
    expect(wrapper.find('[data-test="abandon-preparation"]').exists()).toBe(
      false,
    );
    mocks.supplement.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'NETWORK_ERROR'),
    );
    upload.resolve(handle);
    await flushPromises();
    expect(wrapper.find('[data-test="abandon-preparation"]').exists()).toBe(
      false,
    );
    await wrapper.setProps({ caseVersion: 11 });
    expect(wrapper.find('[data-test="abandon-preparation"]').exists()).toBe(
      false,
    );
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.supplement.mock.calls[1]![1]).toBe(
      mocks.supplement.mock.calls[0]![1],
    );
    wrapper.unmount();
  });
  it('treats UUID casing changes as the same upload target', async () => {
    const id = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
    const actorKey = `casing-${++sequence}`;
    let wrapper = panel({
      actorKey,
      caseId: id,
      paymentId: id,
      expectedClosureVersionId: id,
      expectedPaymentVersionId: id,
    });
    mocks.finalize.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
    );
    await choose(wrapper);
    wrapper.unmount();
    wrapper = panel({
      actorKey,
      caseId: id.toUpperCase(),
      paymentId: id.toUpperCase(),
      expectedClosureVersionId: id.toUpperCase(),
      expectedPaymentVersionId: id.toUpperCase(),
    });
    expect(wrapper.find('[data-test="retry"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('版本已变化');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.finalize.mock.calls[1]![1].caseId).toBe(id);
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each([
    { caseVersion: 11 },
    { stage: 'ARCHIVED' as const },
    { expectedClosureVersionId: content },
    { expectedPaymentVersionId: content },
  ])(
    'keeps unknown uploads visible and blocks new targets after refresh %j',
    async (changed) => {
      const actorKey = `version-upload-${++sequence}`;
      mocks.finalize.mockRejectedValueOnce(
        new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
      );
      let wrapper = panel({ actorKey });
      await choose(wrapper);
      await wrapper.setProps(changed);
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.find('[data-test="retry"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('不能继续旧目标上传或创建新后补');
      wrapper.unmount();
      wrapper = panel({ actorKey, ...changed });
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.find('[data-test="retry"]').exists()).toBe(false);
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
      expect(mocks.finalize).toHaveBeenCalledTimes(1);
      expect(mocks.supplement).not.toHaveBeenCalled();
      wrapper.unmount();
    },
  );
  it('replays only the original sent command after real version changes and remount', async () => {
    const actorKey = `version-command-${++sequence}`;
    mocks.supplement.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'NETWORK_ERROR'),
    );
    let wrapper = panel({ actorKey });
    await choose(wrapper);
    const original = mocks.supplement.mock.calls[0]![1];
    const changed = {
      caseVersion: 11,
      stage: 'ARCHIVED' as const,
      expectedClosureVersionId: content,
      expectedPaymentVersionId: content,
    };
    await wrapper.setProps(changed);
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount();
    wrapper = panel({ actorKey, ...changed });
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.supplement.mock.calls[1]![1]).toBe(original);
    expect(original.expectedClosureVersionId).toBe(caseId);
    expect(original.expectedPaymentVersionId).toBe(caseId);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    wrapper.unmount();
  });
  it('does not overwrite an unresolved upload from an already mounted second panel', async () => {
    const actorKey = `duplicate-${++sequence}`;
    const upload = deferred<typeof handle>();
    mocks.prepare.mockReturnValueOnce(upload.promise);
    const first = panel({ actorKey });
    const second = panel({ actorKey, caseVersion: 11 });
    await choose(first);
    await choose(second);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(second.find('form').exists()).toBe(false);
    first.unmount();
    upload.resolve(handle);
    await flushPromises();
    expect(second.find('[data-test="retry"]').exists()).toBe(false);
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.supplement).not.toHaveBeenCalled();
    second.unmount();
  });
  it('delivers a retained confirmed receipt after remount without reposting', async () => {
    const actorKey = `confirmed-${++sequence}`;
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    const context = {
      recordId: caseId,
      actorKey,
      actionKey: 'settlement',
      title: '结算',
    };
    await workflow.sync(context);
    const session = workflow.state.value.session!;
    let wrapper = panel({
      actorKey,
      session: {
        ...session,
        endSubmit: () => {
          workflow.dispose();
          return false;
        },
      },
    });
    await choose(wrapper);
    expect(wrapper.emitted('supplemented')).toBeUndefined();
    wrapper.unmount();
    await workflow.sync(context);
    wrapper = panel({ actorKey, session: workflow.state.value.session! });
    await flushPromises();
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    expect(mocks.supplement).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    wrapper = panel({ actorKey });
    expect(wrapper.emitted('supplemented')).toBeUndefined();
    wrapper.unmount();
  });
  it('sends exact content versions and completes the independent session once', async () => {
    const actorKey = `session-${++sequence}`;
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    await workflow.sync({
      recordId: caseId,
      actorKey,
      actionKey: 'settlement',
      title: '结算',
    });
    const wrapper = panel({ actorKey, session: workflow.state.value.session! });
    const file = await choose(wrapper);
    expect(mocks.prepare).toHaveBeenCalledWith(
      { actorKey, caseId, expectedVersion: 10 },
      file,
    );
    expect(mocks.finalize).toHaveBeenCalledWith(handle, {
      actorKey,
      caseId,
      expectedVersion: 10,
    });
    expect(mocks.supplement.mock.calls[0]![1]).toMatchObject({
      contentVersionIds: [content],
      paymentId: content,
      expectedPaymentVersionId: caseId,
    });
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    expect(workflow.state.value.status).toBe('ready');
    expect(workflow.state.value.requestState).toBe('idle');
    wrapper.unmount();
  });
  it('retries original draft and File after unknown upload', async () => {
    mocks.finalize.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
    );
    const wrapper = panel();
    await choose(wrapper);
    expect(mocks.supplement).not.toHaveBeenCalled();
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.finalize.mock.calls[0]![0]).toBe(
      mocks.finalize.mock.calls[1]![0],
    );
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    wrapper.unmount();
  });
  it('preserves exact command and key after unknown command and subsequent rejection', async () => {
    mocks.supplement
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'NETWORK_ERROR'))
      .mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'));
    const wrapper = panel();
    await choose(wrapper);
    const input = mocks.supplement.mock.calls[0]![1];
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.supplement.mock.calls.every((call) => call[1] === input)).toBe(
      true,
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it.each([
    'actorKey',
    'caseId',
    'caseVersion',
    'stage',
    'expectedClosureVersionId',
    'paymentId',
    'expectedPaymentVersionId',
  ])('stops after target change: %s', async (field) => {
    const upload = deferred<typeof handle>();
    mocks.prepare.mockReturnValueOnce(upload.promise);
    const wrapper = panel();
    await choose(wrapper);
    await wrapper.setProps({
      [field]:
        field === 'caseVersion'
          ? 11
          : field === 'stage'
            ? 'ARCHIVED'
            : 'changed',
    });
    upload.resolve(handle);
    await flushPromises();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.supplement).not.toHaveBeenCalled();
    expect(wrapper.emitted('supplemented')).toBeUndefined();
    wrapper.unmount();
  });
  it('blocks recreation when draft creation is unknown', async () => {
    mocks.prepare.mockRejectedValue(
      new ApiError('unknown', 0, 'NETWORK_ERROR'),
    );
    const wrapper = panel();
    await choose(wrapper);
    expect(wrapper.text()).toContain('不能再次创建');
    expect(wrapper.find('[data-test="retry"]').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount();
  });
  it('retains an unknown upload across remounts without leaking to another actor', async () => {
    const actorKey = `recover-${++sequence}`;
    mocks.finalize.mockRejectedValueOnce(
      new ApiError('unknown', 0, 'UPLOAD_RESULT_UNKNOWN'),
    );
    let wrapper = panel({ actorKey });
    await choose(wrapper);
    wrapper.unmount();
    const other = panel();
    expect(other.find('form').exists()).toBe(true);
    expect(other.find('[data-test="retry"]').exists()).toBe(false);
    other.unmount();
    wrapper = panel({ actorKey });
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    wrapper.unmount();
  });
  it('stops after a session change while upload preparation is pending', async () => {
    const actorKey = `switch-session-${++sequence}`;
    const workflow = createListWorkflowContext(async () => ({ id: caseId }));
    const context = {
      recordId: caseId,
      actorKey,
      actionKey: 'settlement',
      title: '结算',
    };
    await workflow.sync(context);
    const upload = deferred<typeof handle>();
    mocks.prepare.mockReturnValueOnce(upload.promise);
    const wrapper = panel({ actorKey, session: workflow.state.value.session! });
    await choose(wrapper);
    await workflow.sync(context);
    await wrapper.setProps({ session: workflow.state.value.session! });
    upload.resolve(handle);
    await flushPromises();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.supplement).not.toHaveBeenCalled();
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('supplemented')).toHaveLength(1);
    wrapper.unmount();
  });
  it('allows editing after a definite rejection and validates explicit image choice', async () => {
    const wrapper = panel();
    await choose(
      wrapper,
      new File(['pdf'], 'bad.pdf', { type: 'application/pdf' }),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.supplement.mockRejectedValueOnce(
      new ApiError('denied', 403, 'FORBIDDEN'),
    );
    await choose(wrapper);
    expect(wrapper.find('form').exists()).toBe(true);
    wrapper.unmount();
  });
});
