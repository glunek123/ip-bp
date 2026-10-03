import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CaseStage =
  | 'PENDING_MATCH'
  | 'WAITING_COMPLAINT'
  | 'WAITING_COMPLAINT_CONFIRMATION'
  | 'WAITING_COMPLAINT_STAMP'
  | 'WAITING_FILING'
  | 'WAITING_FORMAL_ACCEPTANCE';
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
  canConfirmComplaint: boolean;
  canMailComplaint: boolean;
  canSubmitFiling: boolean;
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
  complaintConfirmation: ComplaintConfirmation | null;
  complaintMailing: CaseComplaintMailing | null;
  filingSubmission: CaseFilingSubmission | null;
};
export type FilingCourt = { id: string; name: string };
export type CaseFilingSubmission = {
  court: FilingCourt;
  submittedAt: string;
  recordedAt: string;
  recordedByUserId: string;
  mediationNo: string | null;
  evidenceFiles: CaseFile[];
  screenshotFiles: CaseFile[];
};
export type CaseComplaintMailing = {
  mailedAt: string;
  recordedAt: string;
  recordedByUserId: string;
  actorType: 'INTERNAL' | 'CLIENT';
  receiptFiles: CaseFile[];
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
export type ComplaintConfirmation = {
  confirmedComplaintContentVersionId: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  changeNote: string | null;
  confirmDisclose: boolean;
  confirmedAt: string;
  confirmedByUserId: string;
  complaintFile: CaseFile | null;
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
export type ConfirmCaseComplaintInput = {
  expectedVersion: number;
  idempotencyKey: string;
  confirmedComplaintContentVersionId: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  changeNote?: string;
  confirmDisclose: boolean;
};
export type MailCaseComplaintInput = {
  expectedVersion: number;
  idempotencyKey: string;
  mailedAt: string;
  mailReceiptContentVersionIds: string[];
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
    value === 'WAITING_COMPLAINT_CONFIRMATION' ||
    value === 'WAITING_COMPLAINT_STAMP' ||
    value === 'WAITING_FILING' ||
    value === 'WAITING_FORMAL_ACCEPTANCE'
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
      'canConfirmComplaint',
      'canMailComplaint',
      'canSubmitFiling',
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
    typeof value.canConfirmComplaint === 'boolean' &&
    typeof value.canMailComplaint === 'boolean' &&
    typeof value.canSubmitFiling === 'boolean' &&
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
      'canConfirmComplaint',
      'canMailComplaint',
      'canSubmitFiling',
      'complaintConfirmation',
      'complaintMailing',
      'filingSubmission',
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
      canConfirmComplaint: value.canConfirmComplaint,
      canMailComplaint: value.canMailComplaint,
      canSubmitFiling: value.canSubmitFiling,
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
    typeof value.canConfirmComplaint === 'boolean' &&
    typeof value.canMailComplaint === 'boolean' &&
    typeof value.canSubmitFiling === 'boolean' &&
    (value.complaint === null || validComplaint(value.complaint)) &&
    (value.complaintConfirmation === null ||
      validComplaintConfirmation(value.complaintConfirmation)) &&
    (value.complaintMailing === null ||
      validCaseComplaintMailing(value.complaintMailing)) &&
    (value.filingSubmission === null ||
      validCaseFilingSubmission(value.filingSubmission))
  );
}
function validFilingCourt(value: unknown): value is FilingCourt {
  return (
    record(value) &&
    exact(value, ['id', 'name']) &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.id,
    ) &&
    nonempty(value.name) &&
    value.name.trim() === value.name &&
    value.name.length <= 200
  );
}
function validCaseFilingSubmission(
  value: unknown,
): value is CaseFilingSubmission {
  return (
    record(value) &&
    exact(value, [
      'court',
      'submittedAt',
      'recordedAt',
      'recordedByUserId',
      'mediationNo',
      'evidenceFiles',
      'screenshotFiles',
    ]) &&
    validFilingCourt(value.court) &&
    businessDate(value.submittedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    typeof value.recordedByUserId === 'string' &&
    value.recordedByUserId.length > 0 &&
    (value.mediationNo === null ||
      (typeof value.mediationNo === 'string' &&
        value.mediationNo.length >= 1 &&
        value.mediationNo.length <= 100)) &&
    Array.isArray(value.evidenceFiles) &&
    value.evidenceFiles.length >= 1 &&
    value.evidenceFiles.length <= 50 &&
    value.evidenceFiles.every(caseFile) &&
    Array.isArray(value.screenshotFiles) &&
    value.screenshotFiles.length <= 10 &&
    value.screenshotFiles.every(caseFile)
  );
}
function validCaseComplaintMailing(
  value: unknown,
): value is CaseComplaintMailing {
  return (
    record(value) &&
    exact(value, [
      'mailedAt',
      'recordedAt',
      'recordedByUserId',
      'actorType',
      'receiptFiles',
    ]) &&
    businessDate(value.mailedAt) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    nonempty(value.recordedByUserId) &&
    (value.actorType === 'INTERNAL' || value.actorType === 'CLIENT') &&
    Array.isArray(value.receiptFiles) &&
    value.receiptFiles.length > 0 &&
    value.receiptFiles.every(caseFile)
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
function validComplaintConfirmation(
  value: unknown,
): value is ComplaintConfirmation {
  return (
    record(value) &&
    exact(value, [
      'confirmedComplaintContentVersionId',
      'amountState',
      'amount',
      'pendingReason',
      'changeNote',
      'confirmDisclose',
      'confirmedAt',
      'confirmedByUserId',
      'complaintFile',
    ]) &&
    nonempty(value.confirmedComplaintContentVersionId) &&
    (value.amountState === 'KNOWN' || value.amountState === 'PENDING') &&
    (value.amount === null ||
      (typeof value.amount === 'string' &&
        /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(value.amount))) &&
    (value.amountState === 'KNOWN'
      ? value.amount !== null && value.pendingReason === null
      : value.amount === null && nonempty(value.pendingReason)) &&
    (value.changeNote === null ||
      (typeof value.changeNote === 'string' &&
        value.changeNote.trim().length >= 1 &&
        value.changeNote.length <= 500)) &&
    typeof value.confirmDisclose === 'boolean' &&
    typeof value.confirmedAt === 'string' &&
    !Number.isNaN(Date.parse(value.confirmedAt)) &&
    nonempty(value.confirmedByUserId) &&
    (value.complaintFile === null || caseFile(value.complaintFile))
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
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'WAITING_FORMAL_ACCEPTANCE',
    ]) ||
    !Number.isInteger(response.counts.PENDING_MATCH) ||
    (response.counts.PENDING_MATCH as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT) ||
    (response.counts.WAITING_COMPLAINT as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT_CONFIRMATION) ||
    (response.counts.WAITING_COMPLAINT_CONFIRMATION as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_COMPLAINT_STAMP) ||
    (response.counts.WAITING_COMPLAINT_STAMP as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_FILING) ||
    (response.counts.WAITING_FILING as number) < 0 ||
    !Number.isInteger(response.counts.WAITING_FORMAL_ACCEPTANCE) ||
    (response.counts.WAITING_FORMAL_ACCEPTANCE as number) < 0
  )
    throw invalidResponse();
  return response as unknown as CaseList;
}

export type SubmitCaseFilingInput = {
  expectedVersion: number;
  idempotencyKey: string;
  courtId: string;
  submittedAt: string;
  filingEvidenceContentVersionIds: string[];
  filingScreenshotContentVersionIds?: string[];
  mediationNo?: string;
};
export type SubmitCaseFilingResult = {
  id: string;
  stage: 'WAITING_FORMAL_ACCEPTANCE';
  version: number;
  submittedAt: string;
  recordedAt: string;
};
function uuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
function uniqueVersions(values: string[], minimum: number, maximum: number) {
  return (
    values.length >= minimum &&
    values.length <= maximum &&
    new Set(values).size === values.length &&
    values.every(uuidV4)
  );
}
export async function listFilingCourts(id: string): Promise<FilingCourt[]> {
  const response = await getJson(
    `/cases/${encodeURIComponent(id)}/filing-courts`,
  );
  if (
    !record(response) ||
    !exact(response, ['items']) ||
    !Array.isArray(response.items) ||
    !response.items.every(validFilingCourt)
  )
    throw invalidResponse();
  return response.items;
}
export async function createFilingCourt(
  id: string,
  input: { name: string },
): Promise<FilingCourt> {
  const name = input.name.trim();
  if (!name || name.length > 200)
    throw new ApiError(
      '请输入真实法院名称（1～200 个字符）。',
      400,
      'VALIDATION_ERROR',
    );
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/filing-courts`,
    { method: 'POST', body: { name } },
  );
  if (!validFilingCourt(response) || response.name !== name)
    throw invalidResponse();
  return response;
}
export async function submitCaseFiling(
  id: string,
  input: SubmitCaseFilingInput,
): Promise<SubmitCaseFilingResult> {
  const screenshots = input.filingScreenshotContentVersionIds ?? [];
  const mediationNo = input.mediationNo?.trim();
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey !== input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    !uuidV4(input.courtId) ||
    !businessDate(input.submittedAt) ||
    input.submittedAt > todayShanghai() ||
    !uniqueVersions(input.filingEvidenceContentVersionIds, 1, 50) ||
    !uniqueVersions(screenshots, 0, 10) ||
    (input.mediationNo !== undefined &&
      (!mediationNo || mediationNo.length > 100))
  )
    throw new ApiError(
      '提交立案信息无效，请检查日期、法院和材料。',
      400,
      'VALIDATION_ERROR',
    );
  const body = {
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    courtId: input.courtId,
    submittedAt: input.submittedAt,
    filingEvidenceContentVersionIds: input.filingEvidenceContentVersionIds,
    ...(input.filingScreenshotContentVersionIds === undefined
      ? {}
      : { filingScreenshotContentVersionIds: screenshots }),
    ...(mediationNo === undefined ? {} : { mediationNo }),
  };
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/filing-submit`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body,
    },
  );
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'submittedAt', 'recordedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_FORMAL_ACCEPTANCE' ||
    response.version !== input.expectedVersion + 1 ||
    response.submittedAt !== input.submittedAt ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as SubmitCaseFilingResult;
}

export async function mailCaseComplaint(
  id: string,
  input: MailCaseComplaintInput,
  audience: 'internal' | 'client' = 'internal',
): Promise<{
  id: string;
  stage: 'WAITING_FILING';
  version: number;
  mailedAt: string;
  recordedAt: string;
}> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    !businessDate(input.mailedAt) ||
    input.mailedAt > todayShanghai() ||
    input.mailReceiptContentVersionIds.length < 1 ||
    input.mailReceiptContentVersionIds.length > 10 ||
    new Set(input.mailReceiptContentVersionIds).size !==
      input.mailReceiptContentVersionIds.length ||
    input.mailReceiptContentVersionIds.some((versionId) => !nonempty(versionId))
  ) {
    throw new ApiError(
      '邮寄信息无效，请检查日期和凭证',
      400,
      'VALIDATION_ERROR',
    );
  }
  const path =
    audience === 'client'
      ? `/client/cases/${encodeURIComponent(id)}/complaint-mail`
      : `/cases/${encodeURIComponent(id)}/complaint-mail`;
  const response = await requestJson(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body: input,
  });
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'mailedAt', 'recordedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_FILING' ||
    response.version !== input.expectedVersion + 1 ||
    response.mailedAt !== input.mailedAt ||
    typeof response.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(response.recordedAt))
  )
    throw invalidResponse();
  return response as {
    id: string;
    stage: 'WAITING_FILING';
    version: number;
    mailedAt: string;
    recordedAt: string;
  };
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

export async function confirmCaseComplaint(
  id: string,
  input: ConfirmCaseComplaintInput,
): Promise<{
  id: string;
  stage: 'WAITING_COMPLAINT_STAMP';
  version: number;
  confirmedAt: string;
}> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    input.idempotencyKey.length > 128 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.confirmedComplaintContentVersionId,
    ) ||
    typeof input.confirmDisclose !== 'boolean' ||
    (input.amountState === 'KNOWN'
      ? input.amount === null ||
        !/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(input.amount) ||
        input.pendingReason !== null
      : input.amount !== null ||
        typeof input.pendingReason !== 'string' ||
        !input.pendingReason ||
        input.pendingReason.trim() !== input.pendingReason ||
        input.pendingReason.length > 500) ||
    (input.changeNote !== undefined &&
      (!input.changeNote ||
        input.changeNote.trim() !== input.changeNote ||
        input.changeNote.length > 500))
  ) {
    throw new ApiError('诉状确认信息无效', 400, 'VALIDATION_ERROR');
  }
  const response = await requestJson(
    `/cases/${encodeURIComponent(id)}/complaint-confirm`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: input,
    },
  );
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'confirmedAt']) ||
    response.id !== id ||
    response.stage !== 'WAITING_COMPLAINT_STAMP' ||
    response.version !== input.expectedVersion + 1 ||
    typeof response.confirmedAt !== 'string' ||
    Number.isNaN(Date.parse(response.confirmedAt))
  ) {
    throw invalidResponse();
  }
  return response as {
    id: string;
    stage: 'WAITING_COMPLAINT_STAMP';
    version: number;
    confirmedAt: string;
  };
}
