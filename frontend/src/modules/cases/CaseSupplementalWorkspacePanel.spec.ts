import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import CaseSupplementalWorkspacePanel from './CaseSupplementalWorkspacePanel.vue';
import type { CaseSupplementWorkspace } from '../../api/case-supplements';

const mocks = vi.hoisted(() => ({ create: vi.fn(), request: vi.fn() }));
vi.mock('../../api/case-supplements', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/case-supplements')>();
  return {
    ...original,
    createCaseSupplement: mocks.create,
    getCaseSupplementRequest: mocks.request,
  };
});

const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roundId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const workspace: CaseSupplementWorkspace = {
  canEdit: true,
  entries: [],
  recorders: [],
  sources: {
    executionFiling: null,
    trialRounds: [{ id: roundId, sequence: 1 }],
    judgments: [],
    secondResults: [],
    refundItems: [],
    materials: [],
  },
};
afterEach(() => {
  localStorage.clear();
  mocks.create.mockReset();
  mocks.request.mockReset();
});

it('recovers a committed request after response failure and component reload without a second POST', async () => {
  mocks.create.mockRejectedValueOnce(new Error('response lost'));
  mocks.request
    .mockRejectedValueOnce(new Error('not found yet'))
    .mockResolvedValueOnce({ id: 'confirmed' });
  const props = { caseId, actorKey: 'user-a:revision-1', workspace };
  const first = mount(CaseSupplementalWorkspacePanel, { props });
  const select = first.findAll('select');
  await select[1]!.setValue(roundId);
  await first.find('input[inputmode="decimal"]').setValue('123.45');
  await first.find('textarea').setValue('收到法院通知');
  await first.find('button').trigger('click');
  await flushPromises();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  const body = mocks.create.mock.calls[0]![1];
  expect(body).toMatchObject({
    kind: 'COURT_PREPAYMENT_NOTICE',
    trialRoundId: roundId,
    amount: '123.45',
  });
  first.unmount();
  const second = mount(CaseSupplementalWorkspacePanel, { props });
  await flushPromises();
  expect(mocks.request).toHaveBeenLastCalledWith(caseId, body.idempotencyKey);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(second.emitted('changed')).toHaveLength(1);
  second.unmount();
});
