import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type EvidenceStatus =
  'UNDELIVERED' | 'IN_STOCK' | 'MAILED_TO_LAWYER' | 'DESTROYED';
export type PaperStatus = 'NOT_ISSUED' | 'MAILED_TO_LAWYER';
export type EvidenceSourceKind = 'CASE' | 'NOTARY_MATTER';
export type EvidenceElectronicFile = {
  materialId: string;
  contentVersionId: string;
  filename: string;
};

export type EvidenceItem = {
  id: string;
  caseId: string | null;
  groupId: string;
  displayCode: string | null;
  shelfLocation: string | null;
  status: EvidenceStatus;
  remark: string | null;
  provenance: string | null;
  name: string | null;
  kind: string | null;
  collectedOn: string | null;
  keeperName: string | null;
  platform: string | null;
  shopName: string | null;
  caseNo: string | null;
  stage: string | null;
  lawyerName: string | null;
  hearingOn: string | null;
  closedOn: string | null;
  paperCertificates: EvidencePaperCertificate[];
};

export type EvidencePaperCertificate = {
  id: string;
  number: string | null;
  status: PaperStatus;
  issuedOn: string | null;
  officeName: string | null;
  pages: number | null;
  contentVersionId: string | null;
  contentMaterialId: string | null;
  electronicFiles: EvidenceElectronicFile[];
};

export type EvidenceFilter = {
  page?: number;
  pageSize?: number;
  status?: EvidenceStatus;
  stages?: string[];
  hearFrom?: string;
  hearTo?: string;
  closeFrom?: string;
  closeTo?: string;
  lawyerQuery?: string;
};

export type EvidencePage = {
  items: EvidenceItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    statuses: Record<EvidenceStatus | 'ALL', number>;
    stages: Record<string, number>;
    allStageCases: number;
  };
};

export type EvidenceGroup = {
  groupId: string | null;
  groupVersion: number;
  sourceKind: EvidenceSourceKind;
  sourceId: string;
  sourceVersion: number;
  case: {
    id: string | null;
    platform: string | null;
    shopName: string | null;
    caseNo: string | null;
    stage: string | null;
    lawyerName: string | null;
  };
  items: EvidenceItem[];
  paperCertificates: EvidencePaperCertificate[];
};

export type EvidenceGroupSummary = {
  groupId: string | null;
  groupVersion: number;
  sourceKind: EvidenceSourceKind;
  sourceId: string;
  sourceVersion: number;
  caseId: string | null;
  businessNo: string;
  shopName: string | null;
  activeItemCount: number;
};
export type EvidenceGroupPage = {
  items: EvidenceGroupSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type SaveEvidenceSourceGroup = {
  expectedSourceVersion: number;
  expectedGroupVersion: 0;
  rows: EvidenceDraftRow[];
  remark?: string;
};

export type EvidenceDraftRow = {
  id?: string;
  displayCode: string;
  shelfLocation: string;
  status: EvidenceStatus;
  manualStatus: boolean;
};

export type SaveEvidenceGroup = {
  expectedGroupVersion: number;
  rows: EvidenceDraftRow[];
  remark?: string;
  paperCertificates?: { id: string; status: PaperStatus }[];
};

export type BulkEvidenceStatus = {
  evidenceIds: string[];
  paperCertificateIds: string[];
  evidenceStatus?: EvidenceStatus;
  paperStatus?: PaperStatus;
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidResponse();
  return value as Record<string, unknown>;
}

function invalidResponse(): ApiError {
  return new ApiError('证物接口响应格式无效', 502, 'INVALID_RESPONSE');
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw invalidResponse();
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidResponse();
  return value;
}
function evidenceStatus(value: unknown): EvidenceStatus {
  if (
    value !== 'UNDELIVERED' &&
    value !== 'IN_STOCK' &&
    value !== 'MAILED_TO_LAWYER' &&
    value !== 'DESTROYED'
  )
    throw invalidResponse();
  return value;
}
function paperStatus(value: unknown): PaperStatus {
  if (value !== 'NOT_ISSUED' && value !== 'MAILED_TO_LAWYER')
    throw invalidResponse();
  return value;
}
function sourceKind(value: unknown): EvidenceSourceKind {
  if (value !== 'CASE' && value !== 'NOTARY_MATTER') throw invalidResponse();
  return value;
}
function parseElectronicFile(value: unknown): EvidenceElectronicFile {
  const file = record(value);
  return {
    materialId: text(file.materialId),
    contentVersionId: text(file.contentVersionId),
    filename: text(file.filename),
  };
}
function parsePaper(value: unknown): EvidencePaperCertificate {
  const row = record(value);
  return {
    id: text(row.id),
    number: nullableText(row.number),
    status: paperStatus(row.status),
    issuedOn: nullableText(row.issuedOn),
    officeName: nullableText(row.officeName),
    pages: row.pages === null ? null : count(row.pages),
    contentVersionId: nullableText(row.contentVersionId),
    contentMaterialId: nullableText(row.contentMaterialId),
    electronicFiles: array(row.electronicFiles, parseElectronicFile),
  };
}
function array<T>(value: unknown, decode: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map(decode);
}
function parseItem(value: unknown): EvidenceItem {
  const row = record(value);
  return {
    id: text(row.id),
    caseId: nullableText(row.caseId),
    groupId: text(row.groupId),
    displayCode: nullableText(row.displayCode),
    shelfLocation: nullableText(row.shelfLocation),
    status: evidenceStatus(row.status),
    remark: nullableText(row.remark),
    provenance: nullableText(row.provenance),
    name: nullableText(row.name),
    kind: nullableText(row.kind),
    collectedOn: nullableText(row.collectedOn),
    keeperName: nullableText(row.keeperName),
    platform: nullableText(row.platform),
    shopName: nullableText(row.shopName),
    caseNo: nullableText(row.caseNo),
    stage: nullableText(row.stage),
    lawyerName: nullableText(row.lawyerName),
    hearingOn: nullableText(row.hearingOn),
    closedOn: nullableText(row.closedOn),
    paperCertificates: array(row.paperCertificates, parsePaper),
  };
}
function parseGroup(value: unknown): EvidenceGroup {
  const result = record(value);
  const linkedCase = record(result.case);
  const groupVersion = count(result.groupVersion);
  const groupId = nullableText(result.groupId);
  const sourceVersion = count(result.sourceVersion);
  if (
    !sourceVersion ||
    (groupId === null ? groupVersion !== 0 : groupVersion < 1)
  )
    throw invalidResponse();
  return {
    groupId,
    groupVersion,
    sourceKind: sourceKind(result.sourceKind),
    sourceId: text(result.sourceId),
    sourceVersion,
    case: {
      id: nullableText(linkedCase.id),
      platform: nullableText(linkedCase.platform),
      shopName: nullableText(linkedCase.shopName),
      caseNo: nullableText(linkedCase.caseNo),
      stage: nullableText(linkedCase.stage),
      lawyerName: nullableText(linkedCase.lawyerName),
    },
    items: array(result.items, parseItem),
    paperCertificates: array(result.paperCertificates, parsePaper),
  };
}

function filterQuery(
  filter: EvidenceFilter | { page?: number; pageSize?: number; query?: string },
): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) value.forEach((part) => query.append(key, part));
    else query.set(key, String(value));
  }
  return query;
}

export async function listEvidence(
  filter: EvidenceFilter,
  options: RequestOptions = {},
): Promise<EvidencePage> {
  const result = record(
    await getJson(`/evidence?${filterQuery(filter)}`, options),
  );
  const counts = record(result.counts);
  const statuses = record(counts.statuses);
  const stages = record(counts.stages);
  const page = count(result.page);
  const pageSize = count(result.pageSize);
  if (!page || !pageSize || pageSize > 100) throw invalidResponse();
  return {
    items: array(result.items, parseItem),
    total: count(result.total),
    page,
    pageSize,
    counts: {
      allStageCases: count(counts.allStageCases),
      statuses: {
        ALL: count(statuses.ALL),
        UNDELIVERED: count(statuses.UNDELIVERED),
        IN_STOCK: count(statuses.IN_STOCK),
        MAILED_TO_LAWYER: count(statuses.MAILED_TO_LAWYER),
        DESTROYED: count(statuses.DESTROYED),
      },
      stages: Object.fromEntries(
        Object.entries(stages).map(([key, value]) => [key, count(value)]),
      ),
    },
  };
}

export async function matchingEvidenceIds(
  filter: EvidenceFilter,
  options: RequestOptions = {},
): Promise<string[]> {
  const query = filterQuery(filter);
  query.delete('page');
  query.delete('pageSize');
  const result = record(
    await getJson(`/evidence/matching-ids?${query}`, options),
  );
  const ids = array(result.ids, text);
  if (new Set(ids).size !== ids.length) throw invalidResponse();
  return ids;
}

export async function getEvidenceGroup(
  groupId: string,
  options: RequestOptions = {},
): Promise<EvidenceGroup> {
  return parseGroup(
    await getJson(`/evidence/groups/${encodeURIComponent(groupId)}`, options),
  );
}

export async function getEvidenceItemGroup(
  itemId: string,
): Promise<EvidenceGroup> {
  return parseGroup(
    await getJson(`/evidence/items/${encodeURIComponent(itemId)}/group`),
  );
}

export async function getEvidenceSourceGroup(
  kind: EvidenceSourceKind,
  sourceId: string,
): Promise<EvidenceGroup> {
  return parseGroup(
    await getJson(
      `/evidence/sources/${kind}/${encodeURIComponent(sourceId)}/group`,
    ),
  );
}

export async function listEvidenceGroups(query: {
  page?: number;
  pageSize?: number;
  query?: string;
}): Promise<EvidenceGroupPage> {
  const result = record(
    await getJson(`/evidence/groups?${filterQuery(query)}`),
  );
  return {
    items: array(result.items, (value) => {
      const row = record(value);
      return {
        groupId: nullableText(row.groupId),
        groupVersion: count(row.groupVersion),
        sourceKind: sourceKind(row.sourceKind),
        sourceId: text(row.sourceId),
        sourceVersion: count(row.sourceVersion),
        caseId: nullableText(row.caseId),
        businessNo: text(row.businessNo),
        shopName: nullableText(row.shopName),
        activeItemCount: count(row.activeItemCount),
      };
    }),
    total: count(result.total),
    page: count(result.page),
    pageSize: count(result.pageSize),
  };
}

export async function saveEvidenceGroup(
  groupId: string,
  input: SaveEvidenceGroup,
  idempotencyKey: string,
): Promise<{ changed: boolean; group: EvidenceGroup }> {
  const result = record(
    await requestJson(`/evidence/groups/${encodeURIComponent(groupId)}`, {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    }),
  );
  if (typeof result.changed !== 'boolean') throw invalidResponse();
  return { changed: result.changed, group: parseGroup(result.group) };
}

export async function saveEvidenceSourceGroup(
  kind: EvidenceSourceKind,
  sourceId: string,
  input: SaveEvidenceSourceGroup,
  idempotencyKey: string,
): Promise<{ changed: boolean; group: EvidenceGroup }> {
  const result = record(
    await requestJson(
      `/evidence/sources/${kind}/${encodeURIComponent(sourceId)}/group`,
      {
        method: 'PUT',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: input,
      },
    ),
  );
  if (typeof result.changed !== 'boolean') throw invalidResponse();
  return { changed: result.changed, group: parseGroup(result.group) };
}

export async function bulkEvidenceStatus(
  input: BulkEvidenceStatus,
  idempotencyKey: string,
): Promise<{ changedEvidence: number; changedPaperCertificates: number }> {
  const result = record(
    await requestJson('/evidence/bulk-status', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    }),
  );
  return {
    changedEvidence: count(result.changedEvidence),
    changedPaperCertificates: count(result.changedPaperCertificates),
  };
}

export async function exportSelectedEvidence(
  evidenceIds: string[],
): Promise<{ filename: string; csv: string }> {
  const result = record(
    await requestJson('/evidence/export', {
      method: 'POST',
      body: { evidenceIds },
    }),
  );
  if (
    typeof result.filename !== 'string' ||
    !result.filename.trim() ||
    typeof result.csv !== 'string' ||
    !result.csv.trim()
  )
    throw invalidResponse();
  return { filename: result.filename, csv: result.csv };
}
