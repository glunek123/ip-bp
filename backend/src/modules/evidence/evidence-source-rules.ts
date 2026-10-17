import type { EvidenceSourceKind } from './evidence-source-contract';

export type CanonicalEvidenceSource = {
  sourceKind: EvidenceSourceKind;
  sourceId: string;
  caseId: string | null;
};

/** The reader supplies an actual department-scoped Case projection. */
export function canonicalEvidenceSource(
  sourceKind: EvidenceSourceKind,
  sourceId: string,
  linkedCase: { id: string; sourceNotaryMatterId: string | null } | null,
): CanonicalEvidenceSource {
  if (sourceKind === 'CASE') {
    if (!linkedCase || linkedCase.id !== sourceId)
      throw new Error('EVIDENCE_SOURCE_NOT_FOUND');
    return {
      sourceKind: linkedCase.sourceNotaryMatterId ? 'NOTARY_MATTER' : 'CASE',
      sourceId: linkedCase.sourceNotaryMatterId ?? linkedCase.id,
      caseId: linkedCase.id,
    };
  }
  if (linkedCase && linkedCase.sourceNotaryMatterId !== sourceId)
    throw new Error('EVIDENCE_SOURCE_MISMATCH');
  return { sourceKind, sourceId, caseId: linkedCase?.id ?? null };
}

export function evidenceSourceKey(
  source: Pick<CanonicalEvidenceSource, 'sourceKind' | 'sourceId'>,
): string {
  return `${source.sourceKind}:${source.sourceId}`;
}
