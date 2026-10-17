export const EVIDENCE_STATUSES = [
  'UNDELIVERED',
  'IN_STOCK',
  'MAILED_TO_LAWYER',
  'DESTROYED',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const PAPER_STATUSES = ['NOT_ISSUED', 'MAILED_TO_LAWYER'] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export type EvidenceDraftRow = {
  id?: string;
  displayCode: string;
  shelfLocation: string;
  status: EvidenceStatus;
  manualStatus: boolean;
};

export type EvidenceCurrentRow = {
  id: string;
  displayCode: string | null;
  shelfLocation: string | null;
  status: EvidenceStatus;
};

export type PreparedEvidenceRow = {
  id?: string;
  displayCode: string | null;
  shelfLocation: string | null;
  status: EvidenceStatus;
};

const trimmed = (value: string): string | null => value.trim() || null;

/** Resolve a submitted group without manufacturing a physical identifier or status. */
export function prepareEvidenceRows(
  current: readonly EvidenceCurrentRow[],
  draft: readonly EvidenceDraftRow[],
): PreparedEvidenceRow[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const prepared: PreparedEvidenceRow[] = [];
  for (const row of draft) {
    const old = row.id ? byId.get(row.id) : undefined;
    if (row.id && (!old || seen.has(row.id)))
      throw new Error('INVALID_EVIDENCE_ROW');
    if (row.id) seen.add(row.id);
    const submittedCode = trimmed(row.displayCode);
    const submittedShelf = trimmed(row.shelfLocation);
    if (!row.id && !submittedCode && !submittedShelf) continue;
    // Demo keeps existing values when a user leaves these inputs blank.
    const displayCode = submittedCode ?? old?.displayCode ?? null;
    const shelfLocation = submittedShelf ?? old?.shelfLocation ?? null;
    const filledNow = Boolean(submittedCode && submittedShelf);
    const missingBefore = !old?.displayCode || !old?.shelfLocation;
    const autoStock =
      !row.manualStatus &&
      row.status === 'UNDELIVERED' &&
      (old?.status ?? 'UNDELIVERED') === 'UNDELIVERED' &&
      filledNow &&
      missingBefore;
    prepared.push({
      ...(row.id ? { id: row.id } : {}),
      displayCode,
      shelfLocation,
      status: autoStock ? 'IN_STOCK' : row.status,
    });
  }
  return prepared;
}

export type EvidenceListRow = {
  id: string;
  caseId: string | null;
  status: EvidenceStatus;
  stage: string | null;
  hearingOn: string | null;
  secondHearingOn: string | null;
  closedOn: string | null;
  lawyerName: string | null;
};

/** Use the hearing date for the current stage; missing dates stay unknown. */
export function evidenceHearingOn(
  row: Pick<EvidenceListRow, 'stage' | 'hearingOn' | 'secondHearingOn'>,
): string | null {
  return row.stage === 'SECOND_INSTANCE' ? row.secondHearingOn : row.hearingOn;
}

export type EvidenceFilter = {
  status?: EvidenceStatus;
  stages?: readonly string[];
  hearFrom?: string;
  hearTo?: string;
  closeFrom?: string;
  closeTo?: string;
  lawyerQuery?: string;
};

export function assertEvidenceFilter(filter: EvidenceFilter): void {
  for (const value of [
    filter.hearFrom,
    filter.hearTo,
    filter.closeFrom,
    filter.closeTo,
  ]) {
    if (value === undefined) continue;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
      value.startsWith('0000-') ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw new Error('INVALID_EVIDENCE_DATE');
  }
  if (
    (filter.hearFrom && filter.hearTo && filter.hearFrom > filter.hearTo) ||
    (filter.closeFrom && filter.closeTo && filter.closeFrom > filter.closeTo)
  )
    throw new Error('INVALID_EVIDENCE_DATE_RANGE');
}

export function inDayRange(
  value: string | null,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const day = value.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

export function matchesEvidenceFilter(
  row: EvidenceListRow,
  filter: EvidenceFilter,
): boolean {
  if (filter.status && row.status !== filter.status) return false;
  if (
    filter.stages?.length &&
    (!row.stage || !filter.stages.includes(row.stage))
  )
    return false;
  if (
    !inDayRange(evidenceHearingOn(row), filter.hearFrom, filter.hearTo) ||
    !inDayRange(row.closedOn, filter.closeFrom, filter.closeTo)
  )
    return false;
  const query = filter.lawyerQuery?.trim().toLocaleLowerCase() ?? '';
  return !query || (row.lawyerName ?? '').toLocaleLowerCase().includes(query);
}

/** Stage counts apply all active dimensions except the selected stage set. */
export function evidenceCounts(
  rows: readonly EvidenceListRow[],
  filter: EvidenceFilter,
): {
  statuses: Record<EvidenceStatus | 'ALL', number>;
  stages: Record<string, number>;
  allStageCases: number;
} {
  const statuses = {
    ALL: 0,
    UNDELIVERED: 0,
    IN_STOCK: 0,
    MAILED_TO_LAWYER: 0,
    DESTROYED: 0,
  };
  const stageCases = new Map<string, Set<string>>();
  const allCases = new Set<string>();
  for (const row of rows) {
    if (matchesEvidenceFilter(row, { ...filter, status: undefined })) {
      statuses.ALL++;
      statuses[row.status]++;
    }
    if (!matchesEvidenceFilter(row, { ...filter, stages: undefined })) continue;
    if (!row.caseId) continue;
    allCases.add(row.caseId);
    if (row.stage) {
      if (!stageCases.has(row.stage)) stageCases.set(row.stage, new Set());
      stageCases.get(row.stage)?.add(row.caseId);
    }
  }
  return {
    statuses,
    stages: Object.fromEntries(
      [...stageCases].map(([stage, ids]) => [stage, ids.size]),
    ),
    allStageCases: allCases.size,
  };
}
