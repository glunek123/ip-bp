import {
  prepareEvidenceRows,
  type EvidenceCurrentRow,
  type EvidenceStatus,
  type PaperStatus,
  type PreparedEvidenceRow,
} from './evidence-rules';
import type {
  BulkEvidenceStatusDto,
  SaveEvidenceGroupDto,
  CreateEvidenceSourceGroupDto,
} from './evidence.dto';

export type EvidenceSnapshotItem = EvidenceCurrentRow & {
  remark: string | null;
};
export type EvidenceSnapshotPaper = { id: string; status: PaperStatus };
export type EvidenceGroupSnapshot = {
  version: number;
  items: readonly EvidenceSnapshotItem[];
  paperCertificates: readonly EvidenceSnapshotPaper[];
};
export type EvidenceChangePlan = {
  removedIds: string[];
  created: Array<PreparedEvidenceRow & { remark: string | null }>;
  updated: Array<PreparedEvidenceRow & { id: string; remark: string | null }>;
  paperUpdates: EvidenceSnapshotPaper[];
  changed: boolean;
};

/** A virtual source has no server item IDs; an empty draft must not create a group. */
export function planEvidenceSourceCreation(
  input: CreateEvidenceSourceGroupDto,
): { created: EvidenceChangePlan['created']; changed: boolean } {
  if (input.rows.some((row) => row.id)) throw new Error('INVALID_EVIDENCE_ROW');
  const remark = input.remark?.trim() || null;
  const created = prepareEvidenceRows([], input.rows).map((row) => ({
    ...row,
    remark,
  }));
  return { created, changed: created.length > 0 };
}

/** Computes a diff only. The caller must authorize and lock the group first. */
export function planEvidenceGroupChange(
  snapshot: EvidenceGroupSnapshot,
  input: SaveEvidenceGroupDto,
): EvidenceChangePlan {
  if (snapshot.version !== input.expectedGroupVersion)
    throw new Error('EVIDENCE_VERSION_CONFLICT');
  const prepared = prepareEvidenceRows(snapshot.items, input.rows);
  const keptIds = new Set(prepared.flatMap((row) => (row.id ? [row.id] : [])));
  const removedIds = snapshot.items
    .filter((row) => !keptIds.has(row.id))
    .map((row) => row.id);
  const byId = new Map(snapshot.items.map((row) => [row.id, row]));
  const remark = input.remark?.trim() || undefined;
  const created: EvidenceChangePlan['created'] = [];
  const updated: EvidenceChangePlan['updated'] = [];
  for (const row of prepared) {
    if (!row.id) {
      created.push({
        ...row,
        remark: remark ?? snapshot.items[0]?.remark ?? null,
      });
      continue;
    }
    const old = byId.get(row.id);
    if (!old) throw new Error('INVALID_EVIDENCE_ROW');
    const next = { ...row, id: row.id, remark: remark ?? old.remark };
    if (
      old.displayCode !== next.displayCode ||
      old.shelfLocation !== next.shelfLocation ||
      old.status !== next.status ||
      old.remark !== next.remark
    )
      updated.push(next);
  }
  const paperById = new Map(
    snapshot.paperCertificates.map((paper) => [paper.id, paper]),
  );
  const seen = new Set<string>();
  const paperUpdates: EvidenceSnapshotPaper[] = [];
  for (const paper of input.paperCertificates ?? []) {
    const old = paperById.get(paper.id);
    if (!old || seen.has(paper.id))
      throw new Error('INVALID_PAPER_CERTIFICATE');
    seen.add(paper.id);
    if (old.status !== paper.status) paperUpdates.push({ ...paper });
  }
  return {
    removedIds,
    created,
    updated,
    paperUpdates,
    changed: Boolean(
      removedIds.length ||
      created.length ||
      updated.length ||
      paperUpdates.length,
    ),
  };
}

/** Every requested ID must exist in the caller's authorized snapshot. */
export function planEvidenceBulkStatus(
  currentItems: readonly { id: string; status: EvidenceStatus }[],
  currentPapers: readonly EvidenceSnapshotPaper[],
  input: BulkEvidenceStatusDto,
): {
  items: { id: string; status: EvidenceStatus }[];
  papers: EvidenceSnapshotPaper[];
} {
  const itemById = new Map(currentItems.map((item) => [item.id, item]));
  const paperById = new Map(currentPapers.map((paper) => [paper.id, paper]));
  if (
    !input.evidenceIds.length ||
    new Set(input.evidenceIds).size !== input.evidenceIds.length ||
    new Set(input.paperCertificateIds).size !==
      input.paperCertificateIds.length ||
    input.evidenceIds.some((id) => !itemById.has(id)) ||
    input.paperCertificateIds.some((id) => !paperById.has(id))
  )
    throw new Error('INVALID_EVIDENCE_SELECTION');
  if (input.paperStatus && !input.paperCertificateIds.length)
    throw new Error('PAPER_CERTIFICATE_SELECTION_REQUIRED');
  const items: { id: string; status: EvidenceStatus }[] = [];
  const papers: EvidenceSnapshotPaper[] = [];
  if (input.evidenceStatus)
    for (const id of input.evidenceIds) {
      if (itemById.get(id)?.status !== input.evidenceStatus)
        items.push({ id, status: input.evidenceStatus });
    }
  if (input.paperStatus)
    for (const id of input.paperCertificateIds) {
      if (paperById.get(id)?.status !== input.paperStatus)
        papers.push({ id, status: input.paperStatus });
    }
  return { items, papers };
}
