import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, onMounted, onUnmounted, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CaseWorkspaceShell from './CaseWorkspaceShell.vue';
import type { WorkspaceTab } from './case-workspace-contract';

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

function mountShell(activeTab?: WorkspaceTab) {
  const wrapper = mount(CaseWorkspaceShell, {
    attachTo: document.body,
    props: {
      businessNo: 'CA-2026-001',
      subtitle: '法院案号未登记 · 客户甲 · 待匹配',
      contextKey: 'case-1/operator-1/revision-1',
      ...(activeTab ? { activeTab } : {}),
    },
    slots: {
      back: '<a href="/cases?page=2">返回案件列表</a>',
      actions: '<button type="button">匹配当事人</button>',
      details: '<p>只读案件详情</p>',
      files: '<p>真实文件列表</p>',
      fees: '<p>真实费用资料</p>',
      editors: '<p>同案编辑器</p>',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe('CaseWorkspaceShell', () => {
  it('renders the real title, subtitle and host slots with details selected by default', () => {
    const wrapper = mountShell();
    expect(wrapper.get('h1').text()).toBe('CA-2026-001');
    expect(wrapper.get('.case-workspace-subtitle').text()).toBe(
      '法院案号未登记 · 客户甲 · 待匹配',
    );
    expect(wrapper.get('.case-workspace-back a').attributes('href')).toBe(
      '/cases?page=2',
    );
    expect(wrapper.get('.case-workspace-actions').text()).toBe('匹配当事人');
    expect(wrapper.get('.case-workspace-editors').text()).toBe('同案编辑器');
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      '案件详情',
      '文件管理',
      '费用管理',
    ]);
    expect(wrapper.get('.case-workspace-details').isVisible()).toBe(true);
    expect(wrapper.get('.case-workspace-files').isVisible()).toBe(false);
    expect(wrapper.get('.case-workspace-fees').isVisible()).toBe(false);
    expect(wrapper.emitted()).toEqual({});
  });

  it('links each tab and panel with unique IDs and a single keyboard entry point', () => {
    const root = mount(
      defineComponent({
        setup: () => () =>
          h(
            'div',
            (['files', 'details'] as const).map((activeTab) =>
              h(CaseWorkspaceShell, {
                businessNo: 'CA-1',
                subtitle: '',
                activeTab,
                contextKey: 'case-1/user-1',
              }),
            ),
          ),
      }),
      { attachTo: document.body },
    );
    wrappers.push(root);
    const wrapper = root.getComponent(CaseWorkspaceShell);
    const ids = root.findAll('[id]').map((element) => element.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((tab) => tab.attributes('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
    ]);
    expect(tabs.map((tab) => tab.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    for (const tab of tabs) {
      const panel = wrapper.get(`#${tab.attributes('aria-controls')}`);
      expect(panel.attributes('role')).toBe('tabpanel');
      expect(panel.attributes('aria-labelledby')).toBe(tab.attributes('id'));
      expect(panel.attributes('tabindex')).toBe('0');
      expect(tab.attributes('type')).toBe('button');
    }
    expect(wrapper.get('[aria-selected="true"]').classes()).toContain(
      'case-workspace-tab--active',
    );
  });

  it('requests controlled tab updates without changing the host data or current tab itself', async () => {
    const wrapper = mountShell();
    await wrapper.get('[data-workspace-tab="files"]').trigger('click');
    expect(wrapper.emitted('update:activeTab')).toEqual([['files']]);
    expect(wrapper.get('.case-workspace-details').isVisible()).toBe(true);
    await wrapper.setProps({ activeTab: 'files' });
    expect(wrapper.get('.case-workspace-details').isVisible()).toBe(false);
    expect(wrapper.get('.case-workspace-files').isVisible()).toBe(true);
    await wrapper.get('[data-workspace-tab="files"]').trigger('click');
    expect(wrapper.emitted('update:activeTab')).toEqual([['files']]);
    expect(wrapper.get('h1').text()).toBe('CA-2026-001');
    expect(wrapper.get('.case-workspace-subtitle').text()).toContain('待匹配');
  });

  it.each([
    ['details', 'ArrowLeft', 'fees'],
    ['fees', 'ArrowRight', 'details'],
    ['details', 'ArrowRight', 'files'],
    ['fees', 'ArrowLeft', 'files'],
    ['files', 'Home', 'details'],
    ['files', 'End', 'fees'],
  ] as const)(
    'moves selection and focus from %s with %s to %s',
    async (from, key, to) => {
      const wrapper = mountShell(from);
      const tab = wrapper.get(`[data-workspace-tab="${from}"]`);
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      tab.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(wrapper.emitted('update:activeTab')).toEqual([[to]]);
      expect(document.activeElement).toBe(
        wrapper.get(`[data-workspace-tab="${to}"]`).element,
      );
      await wrapper.setProps({ activeTab: to });
      expect(
        wrapper.get(`[data-workspace-tab="${to}"]`).attributes('tabindex'),
      ).toBe('0');
    },
  );

  it('leaves Tab and unrelated keys to native keyboard navigation', () => {
    const wrapper = mountShell();
    const tab = wrapper.get('[role="tab"]');
    for (const key of ['Tab', 'ArrowDown', 'Escape']) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      tab.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(wrapper.emitted('update:activeTab')).toBeUndefined();
  });

  it('keeps all page and editor instances and their local intent when tabs change', async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const Probe = defineComponent({
      props: { name: { type: String, required: true } },
      setup(props) {
        const intent = ref('original-body-and-key');
        onMounted(() => mounted(props.name));
        onUnmounted(() => unmounted(props.name));
        return () =>
          h('input', {
            'data-probe': props.name,
            value: intent.value,
            onInput: (event: Event) => {
              if (event.target instanceof HTMLInputElement)
                intent.value = event.target.value;
            },
          });
      },
    });
    const wrapper = mount(CaseWorkspaceShell, {
      attachTo: document.body,
      props: {
        businessNo: 'CA-1',
        subtitle: '',
        activeTab: 'details',
        contextKey: 'case-1/user-1',
      },
      slots: Object.fromEntries(
        ['details', 'files', 'fees', 'editors'].map((name) => [
          name,
          () => h(Probe, { name }),
        ]),
      ),
    });
    wrappers.push(wrapper);
    const instances = wrapper.findAllComponents(Probe).map((probe) => probe.vm);
    const input = wrapper.get<HTMLInputElement>('[data-probe="editors"]');
    await input.setValue('pending-original-body-and-key');
    for (const activeTab of ['files', 'fees', 'details'] as const) {
      await wrapper.setProps({ activeTab });
      expect(wrapper.findAllComponents(Probe).map((probe) => probe.vm)).toEqual(
        instances,
      );
      expect(input.element.value).toBe('pending-original-body-and-key');
      expect(input.isVisible()).toBe(true);
    }
    expect(mounted).toHaveBeenCalledTimes(4);
    expect(unmounted).not.toHaveBeenCalled();
  });
});
