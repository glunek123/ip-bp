import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseSummary } from '../../api/cases';
import CaseConsolidationPanel from './CaseConsolidationPanel.vue';

const api = vi.hoisted(() => ({ preview: vi.fn(), create: vi.fn() }));
vi.mock('../../api/case-consolidation', () => ({
  previewCaseConsolidation: api.preview,
  createCaseConsolidation: api.create,
}));
const first = '33333333-3333-4333-8333-333333333333';
const second = '44444444-4444-4444-8444-444444444444';
const items = [first, second].map((id, index) => ({
  id,
  businessNo: `CASE-${index + 1}`,
  stage: 'PENDING_MATCH',
  version: 2,
  canConsolidate: true,
  displaySummary: {
    defendants: index === 0 ? [{ id: 'old', name: '已录被告' }] : [],
  },
})) as unknown as CaseSummary[];

describe('case consolidation confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', {
      randomUUID: () => '66666666-6666-4666-8666-666666666666',
    });
    api.preview.mockImplementation(async (input: { mainCaseId?: string }) => ({
      mainCaseId: input.mainCaseId ?? second,
      mainBusinessNo: input.mainCaseId === first ? 'CASE-1' : 'CASE-2',
      caseCount: 2,
      shop: { platform: 'TAOBAO', externalId: 'shop-1' },
      cases: [first, second].map((id, index) => ({
        id,
        businessNo: `CASE-${index + 1}`,
        version: 2,
        createdAt: '2026-10-27T00:00:00.000Z',
        isMain: id === (input.mainCaseId ?? second),
      })),
    }));
    api.create.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      mainCaseId: first,
      mainBusinessNo: 'CASE-1',
      caseCount: 2,
      caseIds: [first, second],
      createdAt: '2026-10-27T00:00:00.000Z',
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('enters one defendant identity, confirms each case and re-previews after changing the main', async () => {
    const wrapper = mount(CaseConsolidationPanel, {
      props: { items, contextKey: 'batch2' },
      global: { stubs: { RouterLink: true } },
    });
    expect(wrapper.text()).toContain('已录被告');
    expect(wrapper.text()).toContain('尚未录入');
    await wrapper.get('input[maxlength="200"]').setValue('同一被告');
    await wrapper.get('input[maxlength="100"]').setValue('110101200001011234');
    for (const checkbox of wrapper.findAll(
      '.consolidation-row input[type="checkbox"]',
    ))
      await checkbox.setValue(true);
    await wrapper.get('[data-test="preview-consolidation"]').trigger('click');
    await flushPromises();
    expect(api.preview).toHaveBeenCalledWith({
      members: [
        {
          caseId: first,
          expectedVersion: 2,
          confirmed: true,
          defendant: {
            kind: 'PERSON',
            name: '同一被告',
            idNo: '110101200001011234',
          },
        },
        {
          caseId: second,
          expectedVersion: 2,
          confirmed: true,
          defendant: {
            kind: 'PERSON',
            name: '同一被告',
            idNo: '110101200001011234',
          },
        },
      ],
    });
    await wrapper.get('[data-test="consolidation-main"]').setValue(first);
    expect(
      wrapper.get('[data-test="submit-consolidation"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="preview-consolidation"]').trigger('click');
    await flushPromises();
    expect(api.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ mainCaseId: first }),
    );
    await wrapper.get('[data-test="submit-consolidation"]').trigger('click');
    await flushPromises();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mainCaseId: first,
        members: expect.any(Array),
        idempotencyKey: expect.any(String),
      }),
    );
    expect(wrapper.emitted('completed')).toHaveLength(1);
    wrapper.unmount();
  });
});
