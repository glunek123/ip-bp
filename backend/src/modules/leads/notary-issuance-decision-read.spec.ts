import { openingReviewMatchesStage } from './notary-opening-review-read';

const decidedAt = new Date('2026-09-28T01:00:00.000Z');
const review = {
  result: 'INFRINGEMENT' as const,
  reason: null,
  archivedAt: null,
  decidedAt,
};

describe('issuance stage read invariants', () => {
  it.each(['WAITING_CERTIFICATE', 'WAITING_RETURN'] as const)(
    '%s retains infringement opening review',
    (stage) => {
      expect(openingReviewMatchesStage(stage, review)).toBe(true);
      expect(openingReviewMatchesStage(stage, null)).toBe(false);
      expect(
        openingReviewMatchesStage(stage, {
          ...review,
          result: 'NO_INFRINGEMENT',
          reason: '否',
        }),
      ).toBe(false);
    },
  );
});
