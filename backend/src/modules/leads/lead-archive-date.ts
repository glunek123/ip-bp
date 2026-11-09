export const NO_EVIDENCE_ARCHIVE_TYPES = [
  'LINK_REMOVED',
  'NO_INFRINGEMENT_INFORMATION',
  'NO_EVIDENCE',
] as const;

export type NoEvidenceArchiveType = (typeof NO_EVIDENCE_ARCHIVE_TYPES)[number];

export function parseArchiveDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}
