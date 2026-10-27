import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ earlyArchiveCase: vi.fn() }));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  earlyArchiveCase: api.earlyArchiveCase,
  todayShanghai: () => '2026-10-26',
}));
vi.mock('../../app/OperationDrawer.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean, title: String, locked: Boolean },
      setup(props, { slots }) {
        return () =>
          props.open
            ? h('section', { role: 'dialog', 'aria-label': props.title }, [
                slots.default?.(),
                h('footer', slots.footer?.()),
              ])
            : null;
      },
    }),
  };
});
import CaseEarlyArchivePanel from './CaseEarlyArchivePanel.vue';
const item = {
  id: '11111111-1111-4111-8111-111111111111',
  businessNo: '00120261026001',
  stage: 'WAITING_HEARING' as const,
  version: 7,
  canEarlyArchive: true,
};
const result = {
  id: item.id,
  earlyArchiveId: '22222222-2222-4222-8222-222222222222',
  fromStage: item.stage,
  stage: 'ARCHIVED' as const,
  version: 8,
  recordedAt: '2026-10-26T00:00:00.000Z',
};
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.resetAllMocks();
});
function panel(allowed = true) {
  const wrapper = mount(CaseEarlyArchivePanel, {
    props: {
      item: { ...item, canEarlyArchive: allowed },
      contextKey: 'user-1:department-1',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
describe('case early archive panel', () => {
  it('requires server capability, date, reason and explicit confirmation', async () => {
    const wrapper = panel(false);
    expect(
      wrapper.find('[data-test="submit-early-archive"]').attributes('disabled'),
    ).toBeDefined();
    const allowed = panel();
    await allowed.get('textarea').setValue('客户停止诉讼');
    await allowed.get('input[type="checkbox"]').setValue(true);
    expect(
      allowed.find('[data-test="submit-early-archive"]').attributes('disabled'),
    ).toBeUndefined();
  });
  it('preserves and explicitly retries the same request after an unknown result', async () => {
    api.earlyArchiveCase
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(result);
    const wrapper = panel();
    await wrapper.get('textarea').setValue('客户停止诉讼');
    await wrapper.get('.early-archive-confirm input').setValue(true);
    await wrapper.get('[data-test="submit-early-archive"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('提交结果暂时未知');
    const firstInput = api.earlyArchiveCase.mock.calls[0]?.[1];
    await wrapper.get('[data-test="submit-early-archive"]').trigger('click');
    await flushPromises();
    expect(api.earlyArchiveCase).toHaveBeenLastCalledWith(item.id, firstInput);
    expect(wrapper.emitted('completed')).toHaveLength(1);
  });
  it('states that early archive does not create closure or payment facts', () => {
    expect(panel().text()).toContain('不会登记结案或款项');
  });
});
