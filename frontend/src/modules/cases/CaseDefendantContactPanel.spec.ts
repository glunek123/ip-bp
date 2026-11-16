import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import CaseDefendantContactPanel from './CaseDefendantContactPanel.vue';

const addDefendant = vi.hoisted(() => vi.fn());
const updateContact = vi.hoisted(() => vi.fn());
const setDisabled = vi.hoisted(() => vi.fn());

vi.mock('../../api/cases', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/cases')>('../../api/cases');
  return {
    ...actual,
    addCaseDefendant: addDefendant,
    setCaseDefendantDisabled: setDisabled,
    updateCaseDefendantContact: updateContact,
  };
});

const item = {
  id: '33333333-3333-4333-8333-333333333333',
  version: 1,
  stage: 'PENDING_MATCH',
  defendants: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      kind: 'PERSON',
      name: '张三',
      idNo: null,
      phone: '111',
      address: '地址',
      legalRepresentative: null,
    },
  ],
  recordEdits: {
    canUpdateDefendantContact: true,
    defendantContacts: [
      {
        defendantId: '44444444-4444-4444-8444-444444444444',
        contactRevision: 0,
        history: [],
      },
    ],
  },
} as unknown as CaseDetail;

describe('CaseDefendantContactPanel add defendant', () => {
  beforeEach(() => {
    addDefendant.mockReset();
    updateContact.mockReset();
    setDisabled.mockReset();
    vi.stubGlobal('crypto', { randomUUID: () => 'key-1' });
  });

  it('requires a name before calling the api', async () => {
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item, contextKey: 'ctx' },
    });
    await wrapper.get('[data-test="defendant-add-toggle"]').trigger('click');
    await wrapper.get('[data-test="defendant-add-save"]').trigger('click');
    await flushPromises();
    expect(addDefendant).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('被告名称不能为空');
  });

  it('posts the trimmed defendant and asks the host to refresh', async () => {
    addDefendant.mockResolvedValue({
      caseId: item.id,
      defendantId: '55555555-5555-4555-8555-555555555555',
      contactRevision: 0,
      recordedAt: '2026-11-16T00:00:00Z',
    });
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item, contextKey: 'ctx' },
    });
    await wrapper.get('[data-test="defendant-add-toggle"]').trigger('click');
    await wrapper.get('[data-test="defendant-add-name"]').setValue(' 李四 ');
    await wrapper.get('[data-test="defendant-add-phone"]').setValue(' 139 ');
    await wrapper.get('[data-test="defendant-add-save"]').trigger('click');
    await flushPromises();
    expect(addDefendant).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({
        kind: 'PERSON',
        name: '李四',
        phone: '139',
        idNo: null,
        legalRepresentative: null,
        idempotencyKey: 'key-1',
      }),
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('disables the selected defendant after confirmation', async () => {
    setDisabled.mockResolvedValue({
      caseId: item.id,
      defendantId: '44444444-4444-4444-8444-444444444444',
      disabledAt: '2026-11-16T00:00:00Z',
    });
    vi.stubGlobal('confirm', () => true);
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item, contextKey: 'ctx' },
    });
    await wrapper.get('[data-test="defendant-disable"]').trigger('click');
    await flushPromises();
    expect(setDisabled).toHaveBeenCalledWith(
      item.id,
      '44444444-4444-4444-8444-444444444444',
      true,
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });
});
