import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RoleTemplatePanel from './RoleTemplatePanel.vue';

const role = {
  id: 'role-1',
  name: '客户经办',
  version: 2,
  activeAssignmentCount: 3,
  grants: [{ action: 'CUSTOMER_READ' as const, scope: 'DEPARTMENT' as const }],
};
const permissionCatalog = [
  {
    action: 'CUSTOMER_READ' as const,
    label: '查看客户',
    scopes: ['SELF' as const, 'TEAM' as const, 'DEPARTMENT' as const],
  },
];

describe('RoleTemplatePanel', () => {
  it('shows concise template facts and opens the shared editor', async () => {
    const wrapper = mount(RoleTemplatePanel, {
      props: { roles: [role], permissionCatalog, canManage: true },
      global: {
        stubs: {
          RoleTemplateEditor: {
            props: ['mode', 'role'],
            template:
              '<div data-test="editor">{{ mode }}:{{ role.name }}</div>',
          },
        },
      },
    });

    expect(wrapper.text()).toContain('客户经办');
    expect(wrapper.text()).toContain('3 位人员');
    expect(wrapper.text()).toContain('查看客户 · 部门');
    await wrapper.get('[data-test="edit-role-role-1"]').trigger('click');
    expect(wrapper.get('[data-test="editor"]').text()).toBe('edit:客户经办');
  });

  it('keeps summaries readable without showing write actions', () => {
    const wrapper = mount(RoleTemplatePanel, {
      props: { roles: [role], permissionCatalog, canManage: false },
    });

    expect(wrapper.text()).toContain('客户经办');
    expect(wrapper.find('[data-test="edit-role-role-1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="copy-role-role-1"]').exists()).toBe(false);
  });
});
