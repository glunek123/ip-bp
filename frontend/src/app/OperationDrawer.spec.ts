import { shallowMount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs';
import OperationDrawer from './OperationDrawer.vue';

describe('operation drawer', () => {
  it('uses a real modal drawer with a labelled header and footer', async () => {
    const wrapper = shallowMount(OperationDrawer, {
      props: { open: true, title: '批量提前归档' },
      slots: { default: '操作内容', footer: '操作按钮' },
    });
    const drawer = wrapper.getComponent(ElDrawer);
    expect(drawer.props('modelValue')).toBe(true);
    expect(drawer.props('appendToBody')).toBe(true);
    expect(drawer.props('destroyOnClose')).toBe(true);
    expect(drawer.props('size')).toBe('min(720px, 100vw)');
    expect(drawer.attributes('aria-label')).toBe('批量提前归档');
    expect(drawer.vm.$slots.default).toBeDefined();
    expect(drawer.vm.$slots.footer).toBeDefined();
    await wrapper.setProps({ ariaLabel: '提前归档案件' });
    expect(drawer.attributes('aria-label')).toBe('提前归档案件');

    const done = vi.fn();
    (drawer.props('beforeClose') as (done: () => void) => void)(done);
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(done).toHaveBeenCalledOnce();
  });

  it('blocks user dismissal while a request is pending but accepts a forced close', async () => {
    const wrapper = shallowMount(OperationDrawer, {
      props: { open: true, title: 'CSV批量录入案件', locked: true },
    });
    const drawer = wrapper.getComponent(ElDrawer);
    const done = vi.fn();
    (drawer.props('beforeClose') as (done: () => void) => void)(done);
    expect(done).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(drawer.props('showClose')).toBe(false);
    expect(drawer.props('closeOnClickModal')).toBe(false);
    expect(drawer.props('closeOnPressEscape')).toBe(false);

    await wrapper.setProps({ open: false });
    expect(drawer.props('modelValue')).toBe(false);
  });
});
