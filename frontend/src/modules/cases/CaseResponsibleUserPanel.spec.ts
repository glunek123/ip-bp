import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';

const listCandidates = vi.hoisted(() => vi.fn());
const changeResponsible = vi.hoisted(() => vi.fn());

vi.mock('../../api/cases', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/cases')>('../../api/cases');
  return {
    ...actual,
    listResponsibleCandidates: listCandidates,
    changeCaseResponsibleUser: changeResponsible,
  };
});

vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: vi.fn(),
}));

import CaseResponsibleUserPanel from './CaseResponsibleUserPanel.vue';

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  owner: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: '当前负责人',
  },
} as unknown as CaseDetail;

describe('CaseResponsibleUserPanel', () => {
  beforeEach(() => {
    listCandidates.mockReset();
    changeResponsible.mockReset();
    vi.unstubAllGlobals();
  });

  it('warns when the target cannot open cases', async () => {
    listCandidates.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        displayName: '无权限运营',
        canReadCases: false,
      },
    ]);
    const wrapper = mount(CaseResponsibleUserPanel, {
      props: { item, contextKey: 'ctx' },
    });
    await flushPromises();
    await wrapper
      .get('[data-test="responsible-target"]')
      .setValue('33333333-3333-4333-8333-333333333333');
    expect(
      wrapper.find('[data-test="responsible-permission-warning"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain('case.read');
  });

  it('asks again before handing over to a reader-less operator', async () => {
    listCandidates.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        displayName: '无权限运营',
        canReadCases: false,
      },
    ]);
    const confirm = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.stubGlobal('confirm', confirm);
    const wrapper = mount(CaseResponsibleUserPanel, {
      props: { item, contextKey: 'ctx' },
    });
    await flushPromises();
    await wrapper
      .get('[data-test="responsible-target"]')
      .setValue('33333333-3333-4333-8333-333333333333');
    await wrapper.get('[data-test="responsible-submit"]').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(changeResponsible).not.toHaveBeenCalled();
  });
});
