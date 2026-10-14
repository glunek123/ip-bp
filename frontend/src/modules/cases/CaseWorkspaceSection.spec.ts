import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, onUnmounted } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CaseWorkspaceSection from './CaseWorkspaceSection.vue';
import type { SectionAction, SectionKey } from './case-workspace-contract';

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

const action: SectionAction = { enabled: true, label: '编辑', hint: null };
function mountSection(
  overrides: { action?: SectionAction; actionLabel?: string } = {},
) {
  const wrapper = mount(CaseWorkspaceSection, {
    attachTo: document.body,
    props: {
      sectionKey: 'case-info',
      title: '案件信息',
      contextKey: 'case-1/user-1/revision-1',
      action,
      ...overrides,
    },
    slots: {
      default: '<input value="同案原资料" />',
      tools: '<button type="button" data-tool="view">查看记录</button>',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe('CaseWorkspaceSection', () => {
  it('starts collapsed with independent accessible toggle, action and tools', () => {
    const wrapper = mountSection();
    const toggle = wrapper.get('.case-workspace-section__toggle');
    const body = wrapper.get('.case-workspace-section__body');
    expect(toggle.attributes('type')).toBe('button');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe(body.attributes('id'));
    expect(body.attributes('role')).toBe('region');
    expect(body.attributes('aria-labelledby')).toBe(toggle.attributes('id'));
    expect(wrapper.find('.case-workspace-section__body').exists()).toBe(true);
    expect(body.isVisible()).toBe(false);
    expect(
      wrapper.get('.case-workspace-section__edit').attributes('aria-label'),
    ).toBe('案件信息：编辑');
    expect(wrapper.get('[data-tool="view"]').isVisible()).toBe(true);
    expect(wrapper.find('button button').exists()).toBe(false);
    expect(wrapper.emitted()).toEqual({});
  });

  it('opens and closes while retaining the body instance and local state', async () => {
    const unmounted = vi.fn();
    const Probe = defineComponent({
      setup() {
        onUnmounted(unmounted);
        return () => h('input', { value: 'pending-body-and-key' });
      },
    });
    const wrapper = mount(CaseWorkspaceSection, {
      attachTo: document.body,
      props: {
        sectionKey: 'execution',
        title: '执行信息',
        contextKey: 'case-1/user-1',
        action,
      },
      slots: { default: () => h(Probe) },
    });
    wrappers.push(wrapper);
    const instance = wrapper.getComponent(Probe).vm;
    const input = wrapper.get<HTMLInputElement>('input');
    await input.setValue('retained-body-and-key');
    const toggle = wrapper.get('.case-workspace-section__toggle');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(input.isVisible()).toBe(true);
    await toggle.trigger('click');
    expect(input.isVisible()).toBe(false);
    await toggle.trigger('click');
    expect(wrapper.getComponent(Probe).vm).toBe(instance);
    expect(input.element.value).toBe('retained-body-and-key');
    expect(unmounted).not.toHaveBeenCalled();
  });

  it('emits the exact section key without toggling on edit or tools', async () => {
    const wrapper = mountSection();
    await wrapper.get('.case-workspace-section__edit').trigger('click');
    await wrapper.get('[data-tool="view"]').trigger('click');
    expect(wrapper.emitted('edit')).toEqual([['case-info']]);
    expect(
      wrapper
        .get('.case-workspace-section__toggle')
        .attributes('aria-expanded'),
    ).toBe('false');
    await wrapper.get('.case-workspace-section__toggle').trigger('click');
    await wrapper.get('.case-workspace-section__edit').trigger('click');
    expect(wrapper.emitted('edit')).toEqual([['case-info'], ['case-info']]);
    expect(
      wrapper
        .get('.case-workspace-section__toggle')
        .attributes('aria-expanded'),
    ).toBe('true');
  });

  it('disables editing with an accessible local reason and guards dispatched clicks', async () => {
    const wrapper = mountSection({
      action: {
        enabled: false,
        label: '编辑',
        hint: '本栏没有可办理的登记命令，只读',
      },
    });
    const edit = wrapper.get<HTMLButtonElement>(
      '.case-workspace-section__edit',
    );
    expect(edit.element.disabled).toBe(true);
    expect(wrapper.get(`#${edit.attributes('aria-describedby')}`).text()).toBe(
      '本栏没有可办理的登记命令，只读',
    );
    edit.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.emitted('edit')).toBeUndefined();
    await wrapper.get('.case-workspace-section__toggle').trigger('click');
    expect(wrapper.get('.case-workspace-section__body').isVisible()).toBe(true);
  });

  it('uses the explicit timeline label without manufacturing a generic action', async () => {
    const wrapper = mountSection({ actionLabel: '登记／更正' });
    await wrapper.setProps({ sectionKey: 'timeline', title: '流程时间轴' });
    expect(wrapper.get('.case-workspace-section__edit').text()).toBe(
      '登记／更正',
    );
    expect(
      wrapper.get('.case-workspace-section__edit').attributes('aria-label'),
    ).toBe('流程时间轴：登记／更正');
    await wrapper.get('.case-workspace-section__edit').trigger('click');
    expect(wrapper.emitted('edit')).toEqual([['timeline']]);
  });

  it('retains expansion on a same-context refresh and resets for case or authorization changes', async () => {
    const wrapper = mountSection();
    const toggle = wrapper.get('.case-workspace-section__toggle');
    await toggle.trigger('click');
    await wrapper.setProps({
      title: '刷新后的案件信息',
      action: { ...action, hint: '使用已有表单' },
    });
    expect(toggle.attributes('aria-expanded')).toBe('true');
    for (const contextKey of [
      'case-2/user-1/revision-1',
      'case-2/user-2/revision-1',
      'case-2/user-2/revision-2',
    ]) {
      await wrapper.setProps({ contextKey });
      expect(toggle.attributes('aria-expanded')).toBe('false');
      expect(wrapper.get('.case-workspace-section__body').isVisible()).toBe(
        false,
      );
      expect(wrapper.emitted('edit')).toBeUndefined();
      await toggle.trigger('click');
    }
  });

  it('supports all seven contract sections with independent state and distinct ARIA references', async () => {
    const sections: { key: SectionKey; title: string }[] = [
      { key: 'case-info', title: '案件信息' },
      { key: 'lead-info', title: '线索信息' },
      { key: 'first-instance', title: '一审信息' },
      { key: 'second-instance', title: '二审信息' },
      { key: 'judgment', title: '判决信息' },
      { key: 'execution', title: '执行信息' },
      { key: 'timeline', title: '流程时间轴' },
    ];
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            'div',
            sections.map((section) =>
              h(
                CaseWorkspaceSection,
                {
                  sectionKey: section.key,
                  title: section.title,
                  contextKey: 'case-1/user-1',
                  action,
                },
                { default: () => h('p', section.title) },
              ),
            ),
          ),
      }),
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    expect(
      wrapper
        .findAll('[data-section]')
        .map((section) => section.attributes('data-section')),
    ).toEqual(sections.map((section) => section.key));
    const toggles = wrapper.findAll('.case-workspace-section__toggle');
    expect(toggles.map((toggle) => toggle.attributes('aria-expanded'))).toEqual(
      Array(7).fill('false'),
    );
    const ids = wrapper.findAll('[id]').map((node) => node.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    await toggles[0]?.trigger('click');
    await toggles[6]?.trigger('click');
    expect(toggles.map((toggle) => toggle.attributes('aria-expanded'))).toEqual(
      ['true', 'false', 'false', 'false', 'false', 'false', 'true'],
    );
  });
});
