import { ApiError, getJson, type RequestOptions } from './http';
import {
  mailCaseComplaint,
  mailCaseExecution,
  type MailCaseComplaintInput,
  type MailCaseExecutionInput,
  type CaseFile,
} from './cases';

export type ClientCaseStage =
  | 'WAITING_COMPLAINT_STAMP'
  | 'WAITING_FILING'
  | 'WAITING_FORMAL_ACCEPTANCE'
  | 'WAITING_HEARING'
  | 'WAITING_JUDGMENT'
  | 'SECOND_INSTANCE'
  | 'WAITING_EXECUTION_DOCUMENTS'
  | 'WAITING_EXECUTION_CONFIRMATION'
  | 'WAITING_EXECUTION_STAMP'
  | 'WAITING_EXECUTION_FILING'
  | 'EXECUTING'
  | 'WAITING_ARCHIVE';
export type ClientCase = {
  id: string;
  businessNo: string;
  stage: ClientCaseStage;
  version: number;
  canMailComplaint: boolean;
  canMailExecution: boolean;
  rightsHolderName: string;
  defendantNames: string[];
};
export type ClientCaseDetail = ClientCase & {
  executionConfirmationId: string | null;
  executionMailing: {
    id: string;
    mailedAt: string;
    recordedAt: string;
    files: CaseFile[];
  } | null;
  confirmedAmountState: 'KNOWN' | 'PENDING';
  confirmedAmount: string | null;
  confirmedAt: string;
  complaintFile: CaseFile | null;
  authorizationFiles: CaseFile[];
  pendingReceiptFiles: CaseFile[];
  complaintMailing: {
    mailedAt: string;
    recordedAt: string;
    receiptFiles: CaseFile[];
  } | null;
};
export type ClientCaseView = 'PENDING' | 'RECORDED';
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function uuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
function businessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function validFile(value: unknown): value is CaseFile {
  return (
    record(value) &&
    exact(value, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'mimeType',
    ]) &&
    Object.values(value).every(
      (field) => typeof field === 'string' && field.length > 0,
    )
  );
}
function validCase(value: unknown): value is ClientCase {
  return (
    record(value) &&
    exact(value, [
      'id',
      'businessNo',
      'stage',
      'version',
      'canMailComplaint',
      'canMailExecution',
      'rightsHolderName',
      'defendantNames',
    ]) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0 &&
    (value.stage === 'WAITING_COMPLAINT_STAMP' ||
      value.stage === 'WAITING_FILING' ||
      value.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
      value.stage === 'WAITING_HEARING' ||
      value.stage === 'WAITING_JUDGMENT' ||
      value.stage === 'SECOND_INSTANCE' ||
      value.stage === 'WAITING_EXECUTION_DOCUMENTS' ||
      value.stage === 'WAITING_EXECUTION_CONFIRMATION' ||
      value.stage === 'WAITING_EXECUTION_STAMP' ||
      value.stage === 'WAITING_EXECUTION_FILING' ||
      value.stage === 'EXECUTING' ||
      value.stage === 'WAITING_ARCHIVE') &&
    Number.isInteger(value.version) &&
    typeof value.canMailComplaint === 'boolean' &&
    typeof value.canMailExecution === 'boolean' &&
    typeof value.rightsHolderName === 'string' &&
    Array.isArray(value.defendantNames) &&
    value.defendantNames.every((name) => typeof name === 'string')
  );
}
function validDetail(value: unknown, id: string): value is ClientCaseDetail {
  if (
    !record(value) ||
    value.id !== id ||
    !exact(value, [
      'id',
      'businessNo',
      'stage',
      'version',
      'canMailComplaint',
      'canMailExecution',
      'rightsHolderName',
      'defendantNames',
      'confirmedAmountState',
      'confirmedAmount',
      'confirmedAt',
      'complaintFile',
      'authorizationFiles',
      'pendingReceiptFiles',
      'complaintMailing',
      'executionConfirmationId',
      'executionMailing',
    ])
  )
    return false;
  const base = {
    id: value.id,
    businessNo: value.businessNo,
    stage: value.stage,
    version: value.version,
    canMailComplaint: value.canMailComplaint,
    canMailExecution: value.canMailExecution,
    rightsHolderName: value.rightsHolderName,
    defendantNames: value.defendantNames,
  };
  return (
    validCase(base) &&
    (value.executionConfirmationId === null ||
      uuidV4(value.executionConfirmationId)) &&
    (value.executionMailing === null ||
      (record(value.executionMailing) &&
        exact(value.executionMailing, [
          'id',
          'mailedAt',
          'recordedAt',
          'files',
        ]) &&
        uuidV4(value.executionMailing.id) &&
        businessDate(value.executionMailing.mailedAt) &&
        typeof value.executionMailing.recordedAt === 'string' &&
        !Number.isNaN(Date.parse(value.executionMailing.recordedAt)) &&
        Array.isArray(value.executionMailing.files) &&
        value.executionMailing.files.length > 0 &&
        value.executionMailing.files.length <= 10 &&
        value.executionMailing.files.every(validFile))) &&
    (value.executionMailing === null ||
      value.executionConfirmationId !== null) &&
    (value.confirmedAmountState === 'KNOWN' ||
      value.confirmedAmountState === 'PENDING') &&
    (value.confirmedAmountState === 'KNOWN'
      ? typeof value.confirmedAmount === 'string' &&
        /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(value.confirmedAmount)
      : value.confirmedAmount === null) &&
    typeof value.confirmedAt === 'string' &&
    !Number.isNaN(Date.parse(value.confirmedAt)) &&
    (value.complaintFile === null || validFile(value.complaintFile)) &&
    Array.isArray(value.authorizationFiles) &&
    value.authorizationFiles.every(validFile) &&
    Array.isArray(value.pendingReceiptFiles) &&
    value.pendingReceiptFiles.every(validFile) &&
    (value.complaintMailing === null ||
      (record(value.complaintMailing) &&
        exact(value.complaintMailing, [
          'mailedAt',
          'recordedAt',
          'receiptFiles',
        ]) &&
        typeof value.complaintMailing.mailedAt === 'string' &&
        typeof value.complaintMailing.recordedAt === 'string' &&
        Array.isArray(value.complaintMailing.receiptFiles) &&
        value.complaintMailing.receiptFiles.every(validFile)))
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户案件数据', 200, 'INVALID_RESPONSE');
}
export async function listClientCases(
  page = 1,
  pageSize = 20,
  view: ClientCaseView = 'PENDING',
  options: RequestOptions = {},
): Promise<{
  items: ClientCase[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const query = new URLSearchParams({
    view,
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await getJson(`/client/cases?${query}`, options);
  if (
    !record(response) ||
    !exact(response, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(response.items) ||
    !response.items.every(validCase) ||
    typeof response.total !== 'number' ||
    !Number.isInteger(response.total) ||
    response.total < 0 ||
    response.page !== page ||
    response.pageSize !== pageSize
  )
    throw invalidResponse();
  return response as unknown as {
    items: ClientCase[];
    total: number;
    page: number;
    pageSize: number;
  };
}
export async function getClientCase(
  id: string,
  options: RequestOptions = {},
): Promise<ClientCaseDetail> {
  const response = await getJson(
    `/client/cases/${encodeURIComponent(id)}`,
    options,
  );
  if (!validDetail(response, id)) throw invalidResponse();
  return response;
}
export function mailClientCaseComplaint(
  id: string,
  input: MailCaseComplaintInput,
) {
  return mailCaseComplaint(id, input, 'client');
}
export function mailClientCaseExecution(
  id: string,
  input: MailCaseExecutionInput,
) {
  return mailCaseExecution(id, input, 'client');
}
