import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ archiveCaseBatch: vi.fn() }));
vi.mock('../../api/case-batches', () => ({
  archiveCaseBatch: api.archiveCaseBatch,
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
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
import CaseBatchArchivePanel from './CaseBatchArchivePanel.vue';
const first = {
  id: '11111111-1111-4111-8111-111111111111',
  businessNo: 'CA-1',
  stage: 'WAITING_HEARING' as const,
  version: 7,
  canEarlyArchive: true,
};
const second = {
  id: '22222222-2222-4222-8222-222222222222',
  businessNo: 'CA-2',
  stage: 'WAITING_ARCHIVE' as const,
  version: 9,
  canEarlyArchive: true,
};
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.resetAllMocks();
});
function panel() {
  const wrapper = mount(CaseBatchArchivePanel, {
    props: {
      open: true,
      items: [first, second],
      contextKey: 'page-1:u:d',
      identityKey: 'u:d',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
describe('case batch early archive panel', () => {
  it('shows the exact selected case count and per-case results', async () => {
    api.archiveCaseBatch.mockResolvedValue({
      items: [
        { id: first.id, status: 'SUCCEEDED', result: {} },
        { id: second.id, status: 'FAILED', code: 'VERSION_CONFLICT' },
      ],
    });
    const wrapper = panel();
    expect(wrapper.get('[data-test="batch-archive-review"]').text()).toContain(
      'CA-1',
    );
    await wrapper.get('textarea').setValue('停止诉讼');
    await wrapper.get('.batch-archive-confirm input').setValue(true);
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    await flushPromises();
    expect(api.archiveCaseBatch.mock.calls[0]?.[0]).toMatchObject({
      archiveAt: '2026-10-26',
      reason: '停止诉讼',
      items: [
        { id: first.id, expectedVersion: first.version },
        { id: second.id, expectedVersion: second.version },
      ],
    });
    expect(wrapper.text()).toContain('CA-1：已归档');
    expect(wrapper.text()).toContain('CA-2：失败');
  });
  it('retains the exact idempotency key after an unknown outcome', async () => {
    api.archiveCaseBatch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        items: [
          { id: first.id, status: 'UNKNOWN' },
          { id: second.id, status: 'UNKNOWN' },
        ],
      });
    const wrapper = panel();
    await wrapper.get('textarea').setValue('停止诉讼');
    await wrapper.get('.batch-archive-confirm input').setValue(true);
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    await flushPromises();
    const original = api.archiveCaseBatch.mock.calls[0]?.[0];
    await wrapper.setProps({ contextKey: 'page-2:u:d' });
    const verifyButton = wrapper.get(
      '[data-test="submit-batch-early-archive"]',
    );
    expect(verifyButton.text()).toContain('核实原批次');
    expect((verifyButton.element as HTMLButtonElement).disabled).toBe(false);
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    await flushPromises();
    expect(api.archiveCaseBatch.mock.calls[1]?.[0]).toEqual(original);
    expect(original.idempotencyKey).toBeTruthy();
    expect(original).toMatchObject({
      archiveAt: '2026-10-26',
      reason: '停止诉讼',
      items: [
        { id: first.id, expectedVersion: first.version },
        { id: second.id, expectedVersion: second.version },
      ],
    });
  });
  it('hides the original batch after an identity change and resumes only for its owner', async () => {
    let resolveFirst!: (value: { items: [] }) => void;
    api.archiveCaseBatch
      .mockImplementationOnce(
        () =>
          new Promise<{ items: [] }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [] });
    const wrapper = panel();
    await wrapper.get('textarea').setValue('停止诉讼');
    await wrapper.get('.batch-archive-confirm input').setValue(true);
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    const original = api.archiveCaseBatch.mock.calls[0]?.[0];

    await wrapper.setProps({
      contextKey: 'page-2:other:department',
      identityKey: 'other:department',
      items: [second],
    });
    expect(wrapper.find('.batch-archive-panel').exists()).toBe(false);
    expect(wrapper.get('.pending-owner-notice').text()).toContain(
      '请返回原账号核实',
    );
    expect(wrapper.text()).not.toContain('CA-1');
    expect(
      wrapper.find('[data-test="submit-batch-early-archive"]').exists(),
    ).toBe(false);
    resolveFirst({ items: [] });
    await flushPromises();
    expect(wrapper.emitted('completed')).toBeUndefined();
    expect(api.archiveCaseBatch).toHaveBeenCalledTimes(1);

    await wrapper.setProps({
      contextKey: 'page-3:u:d',
      identityKey: 'u:d',
      items: [first],
    });
    expect(
      wrapper.get('[data-test="submit-batch-early-archive"]').text(),
    ).toContain('核实原批次');
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    await flushPromises();
    expect(api.archiveCaseBatch.mock.calls[1]?.[0]).toEqual(original);
  });
  it('does not expose an unknown batch to another identity', async () => {
    api.archiveCaseBatch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [] });
    const wrapper = panel();
    await wrapper.get('textarea').setValue('停止诉讼');
    await wrapper.get('.batch-archive-confirm input').setValue(true);
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    await flushPromises();
    const original = api.archiveCaseBatch.mock.calls[0]?.[0];

    await wrapper.setProps({
      contextKey: 'page-2:other:department',
      identityKey: 'other:department',
      items: [second],
    });
    expect(wrapper.find('.batch-archive-panel').exists()).toBe(false);
    await wrapper
      .get('[data-test="close-batch-early-archive"]')
      .trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(api.archiveCaseBatch).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ contextKey: 'page-3:u:d', identityKey: 'u:d' });
    await wrapper
      .get('[data-test="submit-batch-early-archive"]')
      .trigger('click');
    await flushPromises();
    expect(api.archiveCaseBatch.mock.calls[1]?.[0]).toEqual(original);
  });
});
