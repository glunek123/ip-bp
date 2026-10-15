import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, type PropType } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import ListWorkflowDrawer from './ListWorkflowDrawer.vue';
import type {
  ListWorkflowContext,
  ListWorkflowLoad,
  ListWorkflowSession,
} from './list-workflow-context';

const context: ListWorkflowContext = {
  recordId: 'record-1',
  actorKey: 'INTERNAL:user-1:dept-1:3',
  actionKey: 'register',
  title: '登记资料',
};
const DrawerStub = defineComponent({
  props: {
    modelValue: Boolean,
    beforeClose: Function as PropType<(done: () => void) => void>,
  },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h('section', [
            h(
              'button',
              {
                class: 'drawer-close',
                onClick: () => props.beforeClose?.(() => {}),
              },
              '关闭',
            ),
            slots.default?.(),
            slots.footer?.(),
          ])
        : null;
  },
});

function mountDrawer(
  loadDetail = vi.fn(async ({ context: item }: ListWorkflowLoad) => ({
    id: item.recordId,
  })),
) {
  let currentSession: ListWorkflowSession | null = null;
  const wrapper = mount(ListWorkflowDrawer, {
    props: { modelValue: true, context, loadDetail },
    slots: {
      default: ({
        detail,
        session,
      }: {
        detail: { id: string };
        session: ListWorkflowSession;
      }) => {
        currentSession = session;
        return h('div', { class: 'business-panel' }, detail.id);
      },
    },
    global: { stubs: { ElDrawer: DrawerStub } },
  });
  const session = () => {
    if (!currentSession) throw new Error('Panel not mounted');
    return currentSession;
  };
  return { wrapper, session, loadDetail };
}

describe('ListWorkflowDrawer', () => {
  it('loads before mounting a real module slot and cancels without a command/success', async () => {
    const { wrapper, loadDetail } = mountDrawer();
    expect(wrapper.text()).toContain('正在加载');
    expect(wrapper.find('.business-panel').exists()).toBe(false);
    await flushPromises();
    expect(wrapper.get('.business-panel').text()).toBe(context.recordId);
    expect(loadDetail.mock.calls[0]?.[0].context).toEqual(context);
    await wrapper.get('.drawer-close').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    expect(wrapper.emitted('closed')).toHaveLength(1);
    expect(wrapper.emitted('success')).toBeUndefined();
    wrapper.unmount();
  });

  it('blocks user close while submitting/unknown and closes once on confirmed success', async () => {
    const { wrapper, session } = mountDrawer();
    await flushPromises();
    const active = session();
    active.beginSubmit();
    await wrapper.get('.drawer-close').trigger('click');
    expect(wrapper.emitted('blocked')).toEqual([['submitting']]);
    active.endSubmit('unknown');
    await flushPromises();
    expect(wrapper.text()).toContain('请求结果尚未确认');
    expect(
      wrapper.get('button.el-button').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('.drawer-close').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(active.beginSubmit()).toBe(false);
    expect(active.beginSubmit({ recovery: true })).toBe(true);
    active.endSubmit('success');
    active.endSubmit('success');
    await flushPromises();
    expect(wrapper.emitted('success')).toHaveLength(1);
    expect(wrapper.emitted('closed')).toHaveLength(1);
    expect(wrapper.find('.business-panel').exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    { recordId: 'record-2' },
    { actorKey: 'INTERNAL:user-2:dept-1:3' },
    { actorKey: 'INTERNAL:user-1:dept-1:4' },
    { actionKey: 'other' },
  ])(
    'forced props invalidate unknown content/session immediately: %j',
    async (change) => {
      const { wrapper, session, loadDetail } = mountDrawer();
      await flushPromises();
      const old = session();
      old.restoreUnknown();
      loadDetail.mockImplementation(() => new Promise(() => {}));
      await wrapper.setProps({ context: { ...context, ...change } });
      expect(wrapper.find('.business-panel').exists()).toBe(false);
      expect(old.isCurrent()).toBe(false);
      expect(old.endSubmit('success')).toBe(false);
      expect(wrapper.emitted('success')).toBeUndefined();
      expect(wrapper.text()).toContain('正在加载');
      wrapper.unmount();
    },
  );

  it('forced model close destroys a busy panel and ignores its late POST completion', async () => {
    const { wrapper, session } = mountDrawer();
    await flushPromises();
    const old = session();
    old.beginSubmit();
    await wrapper.setProps({ modelValue: false });
    expect(wrapper.find('.business-panel').exists()).toBe(false);
    expect(old.endSubmit('success')).toBe(false);
    expect(wrapper.emitted('success')).toBeUndefined();
    wrapper.unmount();
  });

  it('shows failure/retry, then removes detail on module-reported withdrawal of access', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ id: context.recordId });
    const { wrapper, session } = mountDrawer(load);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('资料加载失败');
    await wrapper.get('button.el-button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.business-panel').exists()).toBe(true);
    session().deny();
    await flushPromises();
    expect(wrapper.find('.business-panel').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('核对权限');
    wrapper.unmount();
  });

  it('offers an inaccessible slot without rendering module data', async () => {
    const { wrapper } = mountDrawer(
      vi.fn().mockRejectedValue(new ApiError('denied', 403, 'FORBIDDEN')),
    );
    await flushPromises();
    expect(wrapper.find('.business-panel').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('核对权限');
    wrapper.unmount();
  });
});
