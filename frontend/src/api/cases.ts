import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CaseStage =
  'PENDING_MATCH' | 'WAITING_COMPLAINT' | 'WAITING_COMPLAINT_CONFIRMATION';
export type CaseView = 'mine' | 'department';
export type CaseStageFilter = CaseStage | 'all';
export type CaseSummary = {
  id: string;
  businessNo: string;
  stage: CaseStage;
  createdAt: string;
  version: number;
  owner: { id: string; displayName: string };
  canMatch: boolean;
  canSubmitComplaint: boolean;
  sourceLead: { id: string; businessNo: string };
  sourceNotaryMatter: { id: string; businessNo: string };
};
export type CaseList = {
  items: CaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CaseStage, number>;
};
export type CaseDefendant = {
  id: string;
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string | null;
  phone: string | null;
  address: string | null;
};
export type CaseLawyer = {
  id: string;
  fullName: string;
  lawFirm: string | null;
  phone: string | null;
  role: 'PRIMARY';
  assignedAt: string;
};
export type CaseDetail = CaseSummary & {
  courtCaseNo: null;
  department: { id: string; name: string };
  customer: { id: string; name: string };
  rightsHolder: { id: string; name: string };
  certificate: {
    certificateNo: string;
    certificateDate: string;
    issuedAt: string;
    needDisclose: boolean;
    files: CaseFile[];
    disclosureFiles: CaseFile[];
  };
  fees: Array<{
    category: 'NOTARY' | 'SAMPLE' | 'INVESTIGATION' | 'DISCLOSURE';
    state: 'KNOWN' | 'PENDING';
    amount: string | null;
    sourceType: 'NOTARY_CERTIFICATE_FEE' | 'NOTARY_MATTER_EVIDENCE';
    sourceId: string;
  }>;
  defendants: CaseDefendant[];
  lawyers: CaseLawyer[];
  matchedAt: string | null;
  matchedOn: string | null;
  complaint: ComplaintSubmission | null;
};
export type ComplaintSubmission = {
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  submittedAt: string;
  submittedByUserId: string;
  complaintFiles: CaseFile[];
  authorizationFiles: CaseFile[];
};
export type CaseFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};
export type MatchCaseInput = {
  expectedVersion: number;
  idempotencyKey: string;
  matchedOn: string;
  defendants: Array<{
    kind: 'PERSON' | 'ORGANIZATION';
    name: string;
    idNo?: string;
    phone?: string;
    address?: string;
  }>;
  lawyer: { fullName: string; lawFirm?: string; phone?: string };
};
export type SubmitComplaintInput = {
  expectedVersion: number;
  idempotencyKey: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  complaintContentVersionIds: string[];
  authorizationContentVersionIds: string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function businessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function todayShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function validStage(value: unknown): value is CaseStage {
  return (
    value === 'PENDING_MATCH' ||
    value === 'WAITING_COMPLAINT' ||
    value === 'WAITING_COMPLAINT_CONFIRMATION'
  );
}
function source(value: unknown): value is { id: string; businessNo: string } {
  return (
    record(value) &&
    exact(value, ['id', 'businessNo']) &&
    nonempty(value.id) &&
    nonempty(value.businessNo)
  );
}
function named(value: unknown, lastKey: 'name' | 'displayName'): boolean {
  return (
    record(value) &&
    exact(value, ['id', lastKey]) &&
    nonempty(value.id) &&
    nonempty(value[lastKey])
  );
}
function summary(value: unknown): value is CaseSummary {
  return (
    record(value) &&
    exact(value, [
      'id',
      'businessNo',
      'stage',
      'createdAt',
      'version',
      'owner',
      'canMatch',
      'canSubmitComplaint',
      'sourceLead',
      'sourceNotaryMatter',
    ]) &&
    nonempty(value.id) &&
    nonempty(value.businessNo) &&
    validStage(value.stage) &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    named(value.owner, 'displayName') &&
    typeof value.canMatch === 'boolean' &&
    typeof value.canSubmitComplaint === 'boolean' &&
    source(value.sourceLead) &&
    source(value.sourceNotaryMatter)
  );
}
function caseFile(value: unknown): value is CaseFile {
  return (
    record(value) &&
    exact(value, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'mimeType',
    ]) &&
    ['materialId', 'contentVersionId', 'originalFilename', 'mimeType'].every(
      (key) => nonempty(value[key]),
    )
  );
}
function defendant(value: unknown): value is CaseDefendant {
  return (
    record(value) &&
    exact(value, ['id', 'kind', 'name', 'idNo', 'phone', 'address']) &&
    nonempty(value.id) &&
    (value.kind === 'PERSON' || value.kind === 'ORGANIZATION') &&
    nonempty(value.name) &&
    [value.idNo, value.phone, value.address].every(
      (field) => field === null || typeof field === 'string',
    )
  );
}
function lawyer(value: unknown): value is CaseLawyer {
  return (
    record(value) &&
    exact(value, [
      'id',
      'fullName',
      'lawFirm',
      'phone',
      'role',
      'assignedAt',
    ]) &&
    nonempty(value.id) &&
    nonempty(value.fullName) &&
    (value.lawFirm === null || nonempty(value.lawFirm)) &&
    (value.phone === null || typeof value.phone === 'string') &&
    value.role === 'PRIMARY' &&
    typeof value.assignedAt === 'string' &&
    !Number.isNaN(Date.parse(value.assignedAt))
  );
}
function validCaseDetail(value: unknown, id: string): value is CaseDetail {
  if (!record(value)) return false;
  return (
    exact(value, [
      'id',
      'businessNo',
      'stage',
      'createdAt',
      'version',
      'owner',
      'canMatch',
      'sourceLead',
      'sourceNotaryMatter',
      'courtCaseNo',
      'department',
      'customer',
      'rightsHolder',
      'certificate',
      'fees',
      'defendants',
      'lawyers',
      'matchedAt',
      'matchedOn',
      'canSubmitComplaint',
      'complaint',
    ]) &&
    value.id === id &&
    summary({
      id: value.id,
      businessNo: value.businessNo,
      stage: value.stage,
      createdAt: value.createdAt,
      version: value.version,
      owner: value.owner,
      canMatch: value.canMatch,
      canSubmitComplaint: value.canSubmitComplaint,
      sourceLead: value.sourceLead,
      sourceNotaryMatter: value.sourceNotaryMatter,
    }) &&
    value.courtCaseNo === null &&
    named(value.department, 'name') &&
    named(value.customer, 'name') &&
    named(value.rightsHolder, 'name') &&
    record(value.certificate) &&
    exact(value.certificate, [
      'certificateNo',
      'certificateDate',
      'issuedAt',
      'needDisclose',
      'files',
      'disclosureFiles',
    ]) &&
    nonempty(value.certificate.certificateNo) &&
    typeof value.certificate.certificateDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.certificate.certificateDate) &&
    typeof value.certificate.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(value.certificate.issuedAt)) &&
    typeof value.certificate.needDisclose === 'boolean' &&
    Array.isArray(value.certificate.files) &&
    value.certificate.files.length > 0 &&
    value.certificate.files.every(caseFile) &&
    Array.isArray(value.certificate.disclosureFiles) &&
    value.certificate.disclosureFiles.every(caseFile) &&
    (!value.certificate.needDisclose ||
      value.certificate.disclosureFiles.length > 0) &&
    Array.isArray(value.fees) &&
    value.fees.every(
      (fee) =>
        record(fee) &&
        exact(fee, ['category', 'state', 'amount', 'sourceType', 'sourceId']) &&
        ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].includes(
          String(fee.category),
        ) &&
        (fee.state === 'KNOWN' || fee.state === 'PENDING') &&
        (fee.amount === null ||
          (typeof fee.amount === 'string' &&
            /^\d+\.\d{2}$/u.test(fee.amount))) &&
        (fee.state === 'KNOWN' ? fee.amount !== null : fee.amount === null) &&
        ['NOTARY_CERTIFICATE_FEE', 'NOTARY_MATTER_EVIDENCE'].includes(
          String(fee.sourceType),
        ) &&
        nonempty(fee.sourceId),
    ) &&
    Array.isArray(value.defendants) &&
    value.defendants.every(defendant) &&
    Array.isArray(value.lawyers) &&
    value.lawyers.every(lawyer) &&
    (value.matchedAt === null ||
      (typeof value.matchedAt === 'string' &&
        !Number.isNaN(Date.parse(value.matchedAt)))) &&
    (value.matchedOn === null || businessDate(value.matchedOn)) &&
    typeof value.canSubmitComplaint === 'boolean' &&
    (value.complaint === null || validComplaint(value.complaint))
  );
}
function validComplaint(value: unknown): value is ComplaintSubmission {
  return (
    record(value) &&
    exact(value, [
      'amountState',
      'amount',
      'pendingReason',
      'submittedAt',
      'submittedByUserId',
      'complaintFiles',
      'authorizationFiles',
    ]) &&
    (value.amountState === 'KNOWN' || value.amountState === 'PENDING') &&
    (value.amount === null ||
      (typeof value.amount === 'string' &&
        /^\d+(\.\d+)?$/u.test(value.amount))) &&
    (value.amountState === 'KNOWN'
      ? value.amount !== null && value.pendingReason === null
      : value.amount === null && nonempty(value.pendingReason)) &&
    typeof value.submittedAt === 'string' &&
    !Number.isNaN(Date.parse(value.submittedAt)) &&
    nonempty(value.submittedByUserId) &&
    Array.isArray(value.complaintFiles) &&
    value.complaintFiles.every(caseFile) &&
    Array.isArray(value.authorizationFiles) &&
    value.authorizationFiles.every(caseFile)
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的案件数据', 200, 'INVALID_RESPONSE');
}

export async function listCases(
  page = 1,
  pageSize = 20,
  options: RequestOptions & { view?: CaseView; stage?: CaseStageFilter } = {},
): Promise<CaseList> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    view: options.view ?? 'mine',
  });
  if (options.stage && options.stage !== 'all')
    query.set('stage', options.stage);
  const response = await getJson(`/cases?${query}`, options);
  if (
    !record(response) ||
    !exact(response, ['items', 'total', 'page', 'pageSize', 'counts']) ||
    !Array.isArray(response.items) ||
    !response.items.every(summary) ||
    !Number.isInteger(response.total) ||
    (response.total as number) < 0 ||
    response.page !== page ||
    response.pageSize !== pageSize ||
    !record(response.counts) ||
    !exact(response.counts, [
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
    ]) ||
    !Number.isInteger(response.counts.PENDING_MATCH) ||
    (response.counts.PENDING_MATCH as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT) ||
    (response.counts.WAITING_COMPLAINT as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT_CONFIRMATION) ||
    (response.counts.WAITING_COMPLAINT_CONFIRMATION as number) < 0
  )
    throw invalidResponse();
  return response as unknown as CaseList;
}

export async function getCase(
  id: string,
  options: RequestOptions = {},
): Promise<CaseDetail> {
  const response = await getJson(`/cases/${encodeURIComponent(id)}`, options);
  if (!validCaseDetail(response, id)) throw invalidResponse();
  return response;
}

export async function matchCase(
  id: string,
  input: MatchCaseInput,
): Promise<void> {
  const body = {
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    matchedOn: input.matchedOn,
    defendants: input.defendants.map(
      ({ kind, name, idNo, phone, address }) => ({
        kind,
        name: name.trim(),
        ...(idNo?.trim() ? { idNo: idNo.trim() } : {}),
        ...(phone?.trim() ? { phone: phone.trim() } : {}),
        ...(address?.trim() ? { address: address.trim() } : {}),
      }),
    ),
    lawyer: {
      fullName: input.lawyer.fullName.trim(),
      ...(input.lawyer.lawFirm?.trim()
        ? { lawFirm: input.lawyer.lawFirm.trim() }
        : {}),
      ...(input.lawyer.phone?.trim()
        ? { phone: input.lawyer.phone.trim() }
        : {}),
    },
  };
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey.trim() ||
    !businessDate(input.matchedOn) ||
    input.matchedOn > todayShanghai() ||
    body.defendants.length === 0 ||
    body.defendants.length > 20 ||
    body.defendants.some((entry) => !entry.name) ||
    !body.lawyer.fullName
  )
    throw new ApiError('匹配信息无效', 400, 'VALIDATION_ERROR');
  const result = await requestJson(`/cases/${encodeURIComponent(id)}/match`, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body,
  });
  if (
    !record(result) ||
    !exact(result, ['id', 'stage', 'version', 'matchedAt', 'matchedOn']) ||
    result.id !== id ||
    result.stage !== 'WAITING_COMPLAINT' ||
    result.version !== input.expectedVersion + 1 ||
    typeof result.matchedAt !== 'string' ||
    Number.isNaN(Date.parse(result.matchedAt)) ||
    result.matchedOn !== input.matchedOn
  )
    throw invalidResponse();
}

export async function submitComplaint(
  id: string,
  input: SubmitComplaintInput,
): Promise<{
  id: string;
  stage: 'WAITING_COMPLAINT_CONFIRMATION';
  version: number;
  submittedAt: string;
}> {
  const idsValid = (ids: string[]) =>
    ids.length >= 1 && ids.length <= 10 && ids.every(nonempty);
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey.trim() ||
    !idsValid(input.complaintContentVersionIds) ||
    !idsValid(input.authorizationContentVersionIds) ||
    (input.amountState === 'KNOWN'
      ? input.amount === null ||
        !/^\d+(\.\d+)?$/u.test(input.amount) ||
        input.pendingReason !== null
      : input.amount !== null || !input.pendingReason?.trim())
  ) {
    throw new ApiError('起诉材料信息无效', 400, 'VALIDATION_ERROR');
  }
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/complaint-submit`,
    { method: 'POST', body: input },
  );
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'submittedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_COMPLAINT_CONFIRMATION' ||
    response.version !== input.expectedVersion + 1 ||
    typeof response.submittedAt !== 'string' ||
    Number.isNaN(Date.parse(response.submittedAt))
  ) {
    throw invalidResponse();
  }
  return response as unknown as {
    id: string;
    stage: 'WAITING_COMPLAINT_CONFIRMATION';
    version: number;
    submittedAt: string;
  };
}
