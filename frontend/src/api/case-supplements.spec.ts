import { expect, it, vi } from 'vitest';
import { getCaseSupplementalWorkspace } from './case-supplements';

const request = vi.hoisted(() => vi.fn());
vi.mock('./http', async (importOriginal) => {
  const original = await importOriginal<typeof import('./http')>();
  return { ...original, requestJson: request };
});

it('rejects a response that omits the explicit trial-round source for a notice', async () => {
  request.mockResolvedValueOnce({
    canEdit: true,
    recorders: [],
    entries: [
      {
        id: 'entry',
        priorEntryId: null,
        kind: 'COURT_PREPAYMENT_NOTICE',
        trialRoundId: null,
        amount: '123.45',
        text: null,
        eventDate: null,
        courtCaseNo: null,
        sourceType: null,
        sourceId: null,
        inventoryVersionId: null,
        inventoryItemId: null,
        materialId: null,
        contentVersionId: null,
        reason: '通知',
        recordedByUserId: 'actor',
        recordedAt: '2026-11-05T00:00:00.000Z',
      },
    ],
    sources: {
      executionFiling: null,
      trialRounds: [],
      judgments: [],
      secondResults: [],
      refundItems: [],
      materials: [],
    },
  });
  await expect(getCaseSupplementalWorkspace('case-id')).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
