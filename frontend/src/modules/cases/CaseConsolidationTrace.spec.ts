import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConsolidationTrace } from '../../api/case-consolidation';
import CaseConsolidationTrace from './CaseConsolidationTrace.vue';

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../api/case-consolidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/case-consolidation')>()),
  getCaseConsolidation: api.read,
}));
afterEach(() => vi.resetAllMocks());

const caseId = '046e1324-a2d4-4d4c-87e1-f88979d46e55';
const source = (
  id: string,
  isMain: boolean,
): ConsolidationTrace['cases'][number] => ({
  caseId: id,
  businessNo: isMain ? '01120261027022' : '01120261027023',
  stage: 'PENDING_MATCH',
  isMain,
  originalVersion: 1,
  defendant: { kind: 'PERSON', name: '合成被告', idNo: '110101200001011234' },
  sourceLead: null,
  sourceNotaryMatter: null,
  certificateId: null,
  materials: [],
  selectedMaterialVersions: [],
  filingReferences: [],
  feeRecordIds: [],
});

it('loads and displays source cases for a standard UUID', async () => {
  api.read.mockResolvedValue({
    id: 'f1021723-2369-4fda-8a38-01a840717dee',
    mainCaseId: caseId,
    createdAt: '2026-10-27T15:35:32.186Z',
    caseCount: 2,
    cases: [
      source(caseId, true),
      source('bcdcb2a4-bf65-4331-b3d2-d056f66c6e72', false),
    ],
  });
  const wrapper = mount(CaseConsolidationTrace, {
    props: { caseId, contextKey: 'owned-synthetic' },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  expect(api.read).toHaveBeenCalledWith(
    caseId,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(wrapper.text()).toContain('合案来源');
  expect(wrapper.text()).toContain('01120261027023');
  wrapper.unmount();
});
