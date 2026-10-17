import {
  canonicalEvidenceSource,
  evidenceSourceKey,
} from './evidence-source-rules';

describe('canonical evidence source', () => {
  it('resolves a transferred case and its original notary matter into exactly the same source', () => {
    const actualCase = { id: 'case-1', sourceNotaryMatterId: 'matter-1' };
    expect(canonicalEvidenceSource('CASE', 'case-1', actualCase)).toEqual(
      canonicalEvidenceSource('NOTARY_MATTER', 'matter-1', actualCase),
    );
  });
  it('keeps an external case as a case source and does not mix identical IDs from different source types', () => {
    expect(
      canonicalEvidenceSource('CASE', 'case-1', {
        id: 'case-1',
        sourceNotaryMatterId: null,
      }),
    ).toEqual({ sourceKind: 'CASE', sourceId: 'case-1', caseId: 'case-1' });
    expect(
      evidenceSourceKey({ sourceKind: 'CASE', sourceId: 'same-id' }),
    ).not.toBe(
      evidenceSourceKey({ sourceKind: 'NOTARY_MATTER', sourceId: 'same-id' }),
    );
    expect(() =>
      canonicalEvidenceSource('NOTARY_MATTER', 'wrong-matter', {
        id: 'case-1',
        sourceNotaryMatterId: 'matter-1',
      }),
    ).toThrow('EVIDENCE_SOURCE_MISMATCH');
  });
});
