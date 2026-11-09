import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaseSettlementActualForm from './CaseSettlementActualForm.vue';

const caseId = '10000000-0000-4000-8000-000000000001';
const lawyerId = '20000000-0000-4000-8000-000000000002';
const idempotencyKey = 'stable-caller-key';
function mountForm(lawyer: string | null = lawyerId) {
  return mount(CaseSettlementActualForm, {
    props: { caseId, lawyerId: lawyer, idempotencyKey },
  });
}
async function fill(
  wrapper: ReturnType<typeof mountForm>,
  side = 'CUSTOMER',
  amount = '9007199254740993.01',
) {
  await wrapper.get('[data-test="side"]').setValue(side);
  await wrapper.get('[data-test="occurred-on"]').setValue('2026-10-29');
  await wrapper.get('[data-test="actual-amount"]').setValue(amount);
}
describe('CaseSettlementActualForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());
  it('labels unallocated registration explicitly and preserves the original total as a single form command', async () => {
    const wrapper = mountForm();
    await wrapper.setProps({ unallocated: true });
    await fill(wrapper, 'CUSTOMER', '200');
    expect(wrapper.get('h3').text()).toBe('登记待分配款项');
    expect(wrapper.get('[data-test="submit"]').text()).toBe(
      '登记总额，稍后分配',
    );
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          caseId,
          idempotencyKey,
          side: 'CUSTOMER',
          amount: '200',
          occurredOn: '2026-10-29',
        },
      ],
    ]);
  });
  it.each([
    ['2026-10-29T15:59:59.999Z', '2026-10-29', '2026-10-30'],
    ['2026-10-29T16:00:00.000Z', '2026-10-30', '2026-10-31'],
  ])(
    'uses the Shanghai calendar boundary at %s and permits today',
    async (instant, today, future) => {
      vi.setSystemTime(new Date(instant));
      const wrapper = mountForm();
      await fill(wrapper);
      expect(wrapper.get('[data-test="occurred-on"]').attributes('max')).toBe(
        today,
      );
      await wrapper.get('[data-test="occurred-on"]').setValue(future);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')).toBeUndefined();
      expect(
        wrapper.get('[data-test="submit"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper.get('[data-test="occurred-on"]').setValue(today);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
        occurredOn: today,
      });
      wrapper.unmount();
    },
  );
  it('refreshes the Shanghai day when an already-open form crosses midnight', async () => {
    vi.setSystemTime(new Date('2026-10-29T15:59:59.999Z'));
    const wrapper = mountForm();
    await fill(wrapper);
    await wrapper.get('[data-test="occurred-on"]').setValue('2026-10-30');
    expect(
      wrapper.get('[data-test="submit"]').attributes('disabled'),
    ).toBeDefined();
    vi.setSystemTime(new Date('2026-10-29T16:00:00.000Z'));
    await wrapper.get('[data-test="occurred-on"]').trigger('focus');
    expect(wrapper.get('[data-test="occurred-on"]').attributes('max')).toBe(
      '2026-10-30',
    );
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      occurredOn: '2026-10-30',
    });
    wrapper.unmount();
  });
  it('starts without selected fact type, date or amount and cannot submit', async () => {
    const wrapper = mountForm();
    expect(
      (wrapper.get('[data-test="side"]').element as HTMLSelectElement).value,
    ).toBe('');
    expect(
      (wrapper.get('[data-test="occurred-on"]').element as HTMLInputElement)
        .value,
    ).toBe('');
    expect(
      (wrapper.get('[data-test="actual-amount"]').element as HTMLInputElement).value,
    ).toBe('');
    expect(
      wrapper.get('[data-test="submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    wrapper.unmount();
  });
  it('emits actual customer receipt with exact input and caller key, without lawyer or bill data', async () => {
    const wrapper = mountForm();
    await fill(wrapper);
    await wrapper.get('[data-test="source-reference"]').setValue(' 交易001 ');
    await wrapper.get('[data-test="note"]').setValue('真实到账');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')?.[0]).toEqual([
      {
        caseId,
        side: 'CUSTOMER',
        amount: '9007199254740993.01',
        occurredOn: '2026-10-29',
        sourceReference: ' 交易001 ',
        note: '真实到账',
        idempotencyKey,
      },
    ]);
    wrapper.unmount();
  });
  it('emits lawyer invoices only with the real supplied lawyer ID', async () => {
    const wrapper = mountForm();
    await fill(wrapper, 'LAWYER', '0.01');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')?.[0]).toEqual([
      {
        caseId,
        side: 'LAWYER',
        lawyerId,
        amount: '0.01',
        occurredOn: '2026-10-29',
        idempotencyKey,
      },
    ]);
    wrapper.unmount();
  });
  it.each([null, '', 'invented-lawyer'])(
    'blocks invoices without a valid supplied lawyer',
    async (lawyer) => {
      const wrapper = mountForm(lawyer);
      await fill(wrapper, 'LAWYER');
      expect(wrapper.get('[data-test="lawyer-unavailable"]').text()).toContain(
        '缺少当前承办律师编号',
      );
      expect(
        wrapper.get('[data-test="submit"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')).toBeUndefined();
      await wrapper.get('[data-test="side"]').setValue('CUSTOMER');
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')).toHaveLength(1);
      wrapper.unmount();
    },
  );
  it.each(['0', '0.00', '-1', '1.001', '1e2', '10000000000000000'])(
    'rejects invalid precise amount %s',
    async (amount) => {
      const wrapper = mountForm();
      await fill(wrapper, 'CUSTOMER', amount);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')).toBeUndefined();
      wrapper.unmount();
    },
  );
  it('blocks invalid dates, disabled submission and invalid request context', async () => {
    const wrapper = mountForm();
    await fill(wrapper);
    await wrapper.get('[data-test="occurred-on"]').setValue('2026-02-30');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    await fill(wrapper);
    await wrapper.setProps({ disabled: true });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    await wrapper.setProps({ disabled: false, idempotencyKey: '' });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    wrapper.unmount();
  });
  it('cancels without submitting and clears facts when changing cases', async () => {
    const wrapper = mountForm();
    await fill(wrapper);
    await wrapper.get('[data-test="cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('submit')).toBeUndefined();
    await wrapper.setProps({ caseId: lawyerId });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(
      (wrapper.get('[data-test="actual-amount"]').element as HTMLInputElement).value,
    ).toBe('');
    wrapper.unmount();
  });
});
