import { beforeEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import Panel from './CasePaymentCorrectionPanel.vue';
import { ApiError } from '../../api/http';
import { createListWorkflowContext } from '../../app/list-workflow-context';
const submit = vi.hoisted(() => vi.fn());
vi.mock('../../api/case-payment-correction', () => ({
  correctCasePayment: submit,
}));
const payment = {
  paymentId: 'payment',
  versionId: 'v1',
  paidOn: '2026-10-31',
  amount: '12.34',
  payer: '甲',
  payee: '乙',
};
beforeEach(() => {
  submit.mockReset();
});
async function setup(actorKey: string) {
  const workflow = createListWorkflowContext(async () => ({ id: 'case' }));
  await workflow.sync({
    actorKey,
    recordId: 'case',
    actionKey: 'payment',
    title: '付款',
  });
  const wrapper = mount(Panel, {
    props: {
      actorKey,
      caseId: 'case',
      payment,
      session: workflow.state.value.session!,
    },
  });
  return { wrapper, workflow };
}
it('loads current values and appends CORRECT with optional reason without proof fields', async () => {
  const { wrapper, workflow } = await setup('correction-success');
  submit.mockResolvedValue({
    versionId: 'v2',
    stage: 'ARCHIVED',
    reviewRequired: true,
  });
  expect(
    (wrapper.get('[data-test="amount"]').element as HTMLInputElement).value,
  ).toBe('12.34');
  await wrapper.get('[data-test="amount"]').setValue('10.01');
  await wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(submit.mock.calls[0]?.[1]).toMatchObject({
    kind: 'CORRECT',
    paymentId: 'payment',
    expectedVersionId: 'v1',
    paidOn: '2026-10-31',
    amount: '10.01',
    payer: '甲',
    payee: '乙',
    reason: null,
  });
  expect(Object.keys(submit.mock.calls[0]?.[1])).not.toContain('documents');
  expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({
    reviewRequired: true,
  });
  expect(workflow.canLeave()).toBe(true);
});
it('VOID submits no replacement values and keeps optional reason', async () => {
  const { wrapper } = await setup('void-success');
  submit.mockResolvedValue({
    versionId: 'v2',
    stage: 'WAITING_ARCHIVE',
    reviewRequired: false,
  });
  await wrapper.get('[data-test="kind"]').setValue('VOID');
  await wrapper.get('[data-test="reason"]').setValue('重复记录');
  await wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(Object.keys(submit.mock.calls[0]?.[1]).sort()).toEqual(
    [
      'expectedVersionId',
      'idempotencyKey',
      'kind',
      'paymentId',
      'reason',
    ].sort(),
  );
});
it('retains original body/key after unknown and blocks leaving/new fields until replay', async () => {
  const { wrapper, workflow } = await setup('unknown-original');
  submit
    .mockRejectedValueOnce(new ApiError('unknown', 500, 'INTERNAL_ERROR'))
    .mockResolvedValueOnce({
      versionId: 'v2',
      stage: 'ARCHIVED',
      reviewRequired: true,
    });
  await wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(workflow.canLeave()).toBe(false);
  expect(
    wrapper.get('[data-test="cancel"]').attributes('disabled'),
  ).toBeDefined();
  expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
  await wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(submit.mock.calls[1]?.[1]).toBe(submit.mock.calls[0]?.[1]);
  expect(workflow.canLeave()).toBe(true);
});
it('retains an unknown command across unmount with changed payment head', async () => {
  const first = await setup('remount-original');
  submit
    .mockRejectedValueOnce(new ApiError('unknown', 0, 'NETWORK_ERROR'))
    .mockResolvedValueOnce({
      versionId: 'v2',
      stage: 'ARCHIVED',
      reviewRequired: false,
    });
  await first.wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  first.wrapper.unmount();
  const second = await setup('remount-original');
  await second.wrapper.setProps({ payment: { ...payment, versionId: 'v9' } });
  await second.wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(submit.mock.calls[1]?.[1]).toBe(submit.mock.calls[0]?.[1]);
  expect(submit.mock.calls[1]?.[1].expectedVersionId).toBe('v1');
});
it('keeps original body/key after unknown then retry 409 until receipt replay confirms after remount', async () => {
  submit
    .mockRejectedValueOnce(new ApiError('timeout', 0, 'NETWORK_ERROR'))
    .mockRejectedValueOnce(new ApiError('head changed', 409, 'PAYMENT_CHANGED'))
    .mockResolvedValueOnce({
      versionId: 'v2',
      stage: 'ARCHIVED',
      reviewRequired: true,
    });
  const first = await setup('unknown-409-remount');
  await first.wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  const original = submit.mock.calls[0]?.[1];
  await first.wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(first.workflow.canLeave()).toBe(false);
  expect(
    first.wrapper.get('[data-test="cancel"]').attributes('disabled'),
  ).toBeDefined();
  expect(submit.mock.calls[1]?.[1]).toBe(original);
  first.wrapper.unmount();
  const second = await setup('unknown-409-remount');
  await second.wrapper.setProps({ payment: { ...payment, versionId: 'v2' } });
  await second.wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(submit.mock.calls[2]?.[1]).toBe(original);
  expect(second.wrapper.emitted('saved')).toHaveLength(1);
  expect(second.workflow.canLeave()).toBe(true);
});
it('does not deliver a late response to another actor or case', async () => {
  let resolve!: (v: unknown) => void;
  submit.mockImplementation(() => new Promise((r) => (resolve = r)));
  const { wrapper } = await setup('late-old');
  await wrapper.get('[data-test="save"]').trigger('click');
  await wrapper.setProps({ actorKey: 'late-new', caseId: 'other' });
  resolve({ versionId: 'v2', stage: 'ARCHIVED', reviewRequired: true });
  await flushPromises();
  expect(wrapper.emitted('saved')).toBeUndefined();
  expect(wrapper.text()).not.toContain('结果待确认');
});
it('allows cancel before writing and handles forbidden without hiding it as success', async () => {
  const { wrapper, workflow } = await setup('forbidden');
  await wrapper.get('[data-test="cancel"]').trigger('click');
  expect(wrapper.emitted('cancel')).toHaveLength(1);
  submit.mockRejectedValue(new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'));
  await wrapper.get('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('无权');
  expect(wrapper.emitted('saved')).toBeUndefined();
  expect(workflow.canLeave()).toBe(true);
});
