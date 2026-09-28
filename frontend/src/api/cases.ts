import { ApiError, getJson, type RequestOptions } from './http';

export type CaseSummary = {
  id: string;
  businessNo: string;
  stage: 'PENDING_MATCH';
  createdAt: string;
  sourceLead: { id: string; businessNo: string };
  sourceNotaryMatter: { id: string; businessNo: string };
};
export type CaseList = {
  items: CaseSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type CaseDetail = CaseSummary & {
  courtCaseNo: null;
  department: { id: string; name: string };
  customer: { id: string; name: string };
  rightsHolder: { id: string; name: string };
  owner: { id: string; displayName: string };
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
};
export type CaseFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
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
function source(value: unknown): value is { id: string; businessNo: string } {
  return (
    record(value) &&
    exact(value, ['id', 'businessNo']) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0
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
      'sourceLead',
      'sourceNotaryMatter',
    ]) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0 &&
    value.stage === 'PENDING_MATCH' &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    source(value.sourceLead) &&
    source(value.sourceNotaryMatter)
  );
}
function named(value: unknown, lastKey: 'name' | 'displayName'): boolean {
  return (
    record(value) &&
    exact(value, ['id', lastKey]) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value[lastKey] === 'string' &&
    value[lastKey].length > 0
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
      (key) =>
        typeof value[key] === 'string' && (value[key] as string).length > 0,
    )
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
      'sourceLead',
      'sourceNotaryMatter',
      'courtCaseNo',
      'department',
      'customer',
      'rightsHolder',
      'owner',
      'certificate',
      'fees',
    ]) &&
    value.id === id &&
    summary({
      id: value.id,
      businessNo: value.businessNo,
      stage: value.stage,
      createdAt: value.createdAt,
      sourceLead: value.sourceLead,
      sourceNotaryMatter: value.sourceNotaryMatter,
    }) &&
    value.courtCaseNo === null &&
    named(value.department, 'name') &&
    named(value.customer, 'name') &&
    named(value.rightsHolder, 'name') &&
    named(value.owner, 'displayName') &&
    record(value.certificate) &&
    exact(value.certificate, [
      'certificateNo',
      'certificateDate',
      'issuedAt',
      'needDisclose',
      'files',
      'disclosureFiles',
    ]) &&
    typeof value.certificate.certificateNo === 'string' &&
    value.certificate.certificateNo.length > 0 &&
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
        typeof fee.sourceId === 'string' &&
        fee.sourceId.length > 0,
    )
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的案件数据', 200, 'INVALID_RESPONSE');
}

export async function listCases(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CaseList> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await getJson(`/cases?${query}`, options);
  if (
    !record(response) ||
    !exact(response, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(response.items) ||
    !response.items.every(summary) ||
    !Number.isInteger(response.total) ||
    (response.total as number) < 0 ||
    response.page !== page ||
    response.pageSize !== pageSize
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
