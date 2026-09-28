import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type {
  RecordNotaryOpeningInput,
  RecordNotaryOpeningResult,
} from './notary';

export type NotaryPortalMatterSummary = {
  id: string;
  businessNo: string;
  stage: 'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED';
  version: number;
  createdAt: string;
};
export type NotaryPortalMatterList = {
  items: NotaryPortalMatterSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type NotaryPortalEvidence = {
  evidenceAt: string;
  sampleFeeState: 'KNOWN' | 'PENDING';
  sampleFeeAmount: string | null;
  logistics: Array<{
    id: string;
    companyState: 'PRESENT' | 'NONE';
    companyValue: string | null;
    trackingState: 'PRESENT' | 'NONE';
    trackingValue: string | null;
  }>;
};
export type NotaryPortalOpening = {
  senderName: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
  recordedAt: string;
  photos: Array<{
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
    mimeType: string;
  }>;
};
export type NotaryPortalMatter = Omit<NotaryPortalMatterSummary, 'stage'> & {
  stage: 'WAITING_UNBOX' | 'UNBOX_REVIEW' | 'WAITING_CERTIFICATE' | 'ARCHIVED';
  evidence: NotaryPortalEvidence | null;
  opening: NotaryPortalOpening | null;
  issuanceDecision: {
    decision: 'ISSUE';
    actorDisplayName: string;
    decidedAt: string;
  } | null;
  certificate: {
    certificateNo: string;
    certificateDate: string;
    issuedAt: string;
    files: NotaryPortalFile[];
    disclosureFiles: NotaryPortalFile[];
    needDisclose: boolean;
    caseId: string | null;
    caseBusinessNo: string | null;
  } | null;
  capabilities: { recordOpening: boolean; issueCertificate: boolean };
};
export type NotaryPortalFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};
export type NotaryPortalCertificateInput = {
  expectedVersion: number;
  certificateNo: string;
  certificateDate: string;
  contentVersionIds: string[];
  needDisclose: boolean;
  disclosureContentVersionIds: string[];
  fees: {
    notary: { state: 'KNOWN' | 'PENDING'; amount: string | null };
    investigation: { state: 'KNOWN' | 'PENDING'; amount: string | null };
    disclosure: { state: 'KNOWN' | 'PENDING'; amount: string | null };
  };
};
export type RecordNotaryPortalCertificateResult = {
  id: string;
  stage: 'ARCHIVED';
  version: number;
  certificate: {
    certificateNo: string;
    certificateDate: string;
    issuedAt: string;
    files: NotaryPortalFile[];
    needDisclose: boolean;
    disclosureFiles: NotaryPortalFile[];
  };
  case: { id: string; businessNo: string; stage: 'PENDING_MATCH' };
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
function dateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function summary(value: unknown): value is NotaryPortalMatterSummary {
  return (
    record(value) &&
    exact(value, ['id', 'businessNo', 'stage', 'version', 'createdAt']) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0 &&
    (value.stage === 'WAITING_UNBOX' ||
      value.stage === 'WAITING_CERTIFICATE' ||
      value.stage === 'ARCHIVED') &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    dateTime(value.createdAt)
  );
}
function validEvidence(value: unknown): value is NotaryPortalEvidence {
  return (
    record(value) &&
    exact(value, [
      'evidenceAt',
      'sampleFeeState',
      'sampleFeeAmount',
      'logistics',
    ]) &&
    typeof value.evidenceAt === 'string' &&
    (value.sampleFeeState === 'KNOWN' || value.sampleFeeState === 'PENDING') &&
    (value.sampleFeeState === 'KNOWN'
      ? typeof value.sampleFeeAmount === 'string' &&
        /^\d+\.\d{2}$/u.test(value.sampleFeeAmount)
      : value.sampleFeeAmount === null) &&
    Array.isArray(value.logistics) &&
    value.logistics.every(
      (row) =>
        record(row) &&
        exact(row, [
          'id',
          'companyState',
          'companyValue',
          'trackingState',
          'trackingValue',
        ]) &&
        typeof row.id === 'string' &&
        (row.companyState === 'PRESENT' || row.companyState === 'NONE') &&
        (row.companyValue === null || typeof row.companyValue === 'string') &&
        (row.trackingState === 'PRESENT' || row.trackingState === 'NONE') &&
        (row.trackingValue === null || typeof row.trackingValue === 'string'),
    )
  );
}
function validOpening(value: unknown): value is NotaryPortalOpening {
  return (
    record(value) &&
    exact(value, [
      'senderName',
      'senderPhone',
      'senderAddress',
      'recordedAt',
      'photos',
    ]) &&
    (value.senderName === null || typeof value.senderName === 'string') &&
    (value.senderPhone === null || typeof value.senderPhone === 'string') &&
    (value.senderAddress === null || typeof value.senderAddress === 'string') &&
    dateTime(value.recordedAt) &&
    Array.isArray(value.photos) &&
    value.photos.length > 0 &&
    value.photos.every(
      (photo) =>
        record(photo) &&
        exact(photo, [
          'materialId',
          'contentVersionId',
          'originalFilename',
          'mimeType',
        ]) &&
        [
          'materialId',
          'contentVersionId',
          'originalFilename',
          'mimeType',
        ].every(
          (key) =>
            typeof photo[key] === 'string' && (photo[key] as string).length > 0,
        ),
    )
  );
}
function validFile(value: unknown): value is NotaryPortalFile {
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
function validDecision(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ['decision', 'actorDisplayName', 'decidedAt']) &&
    value.decision === 'ISSUE' &&
    typeof value.actorDisplayName === 'string' &&
    value.actorDisplayName.length > 0 &&
    dateTime(value.decidedAt)
  );
}
function validCertificate(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      'certificateNo',
      'certificateDate',
      'issuedAt',
      'files',
      'disclosureFiles',
      'needDisclose',
      'caseId',
      'caseBusinessNo',
    ]) &&
    typeof value.certificateNo === 'string' &&
    value.certificateNo.length > 0 &&
    typeof value.certificateDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.certificateDate) &&
    dateTime(value.issuedAt) &&
    Array.isArray(value.files) &&
    value.files.length > 0 &&
    value.files.every(validFile) &&
    Array.isArray(value.disclosureFiles) &&
    value.disclosureFiles.every(validFile) &&
    typeof value.needDisclose === 'boolean' &&
    (value.caseId === null || typeof value.caseId === 'string') &&
    (value.caseBusinessNo === null ||
      typeof value.caseBusinessNo === 'string') &&
    (value.needDisclose
      ? value.disclosureFiles.length > 0
      : value.disclosureFiles.length === 0)
  );
}
function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的公证处事项数据',
    200,
    'INVALID_RESPONSE',
  );
}
const path = '/notary-portal/matters';

export async function listNotaryPortalMatters(
  page = 1,
  pageSize = 20,
  options: RequestOptions & {
    stage?: 'WAITING_CERTIFICATE' | 'ARCHIVED';
  } = {},
): Promise<NotaryPortalMatterList> {
  const { stage, ...requestOptions } = options;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (stage) query.set('stage', stage);
  const response = await getJson(`${path}?${query}`, requestOptions);
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
  return response as unknown as NotaryPortalMatterList;
}

export async function getNotaryPortalMatter(
  id: string,
  options: RequestOptions = {},
): Promise<NotaryPortalMatter> {
  const response = await getJson(`${path}/${encodeURIComponent(id)}`, options);
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'businessNo',
      'stage',
      'version',
      'createdAt',
      'evidence',
      'opening',
      'issuanceDecision',
      'certificate',
      'capabilities',
    ]) ||
    typeof response.id !== 'string' ||
    response.id !== id ||
    typeof response.businessNo !== 'string' ||
    response.businessNo.length === 0 ||
    ![
      'WAITING_UNBOX',
      'UNBOX_REVIEW',
      'WAITING_CERTIFICATE',
      'ARCHIVED',
    ].includes(String(response.stage)) ||
    !Number.isInteger(response.version) ||
    (response.version as number) < 1 ||
    !dateTime(response.createdAt) ||
    !(response.evidence === null || validEvidence(response.evidence)) ||
    !(response.opening === null || validOpening(response.opening)) ||
    !(
      response.issuanceDecision === null ||
      validDecision(response.issuanceDecision)
    ) ||
    !(
      response.certificate === null || validCertificate(response.certificate)
    ) ||
    !record(response.capabilities) ||
    !exact(response.capabilities, ['recordOpening', 'issueCertificate']) ||
    typeof response.capabilities.recordOpening !== 'boolean' ||
    typeof response.capabilities.issueCertificate !== 'boolean' ||
    response.capabilities.recordOpening !==
      (response.stage === 'WAITING_UNBOX') ||
    response.capabilities.issueCertificate !==
      (response.stage === 'WAITING_CERTIFICATE') ||
    (response.stage === 'WAITING_UNBOX' &&
      (response.evidence === null ||
        response.opening !== null ||
        response.issuanceDecision !== null ||
        response.certificate !== null)) ||
    (response.stage === 'UNBOX_REVIEW' &&
      (response.evidence === null ||
        response.opening === null ||
        response.issuanceDecision !== null ||
        response.certificate !== null)) ||
    (response.stage === 'WAITING_CERTIFICATE' &&
      (response.issuanceDecision === null || response.certificate !== null)) ||
    (response.stage === 'ARCHIVED' &&
      (response.evidence !== null ||
        response.opening !== null ||
        response.issuanceDecision !== null ||
        response.certificate === null))
  )
    throw invalidResponse();
  return response as unknown as NotaryPortalMatter;
}

export async function recordNotaryPortalCertificate(
  id: string,
  input: NotaryPortalCertificateInput,
  idempotencyKey: string,
): Promise<RecordNotaryPortalCertificateResult> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.certificateNo.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(input.certificateDate) ||
    input.contentVersionIds.length < 1 ||
    input.contentVersionIds.length > 50 ||
    new Set(input.contentVersionIds).size !== input.contentVersionIds.length ||
    input.contentVersionIds.some((item) => !item) ||
    input.disclosureContentVersionIds.length > 50 ||
    new Set(input.disclosureContentVersionIds).size !==
      input.disclosureContentVersionIds.length ||
    input.disclosureContentVersionIds.some((item) => !item) ||
    (input.needDisclose && input.disclosureContentVersionIds.length < 1) ||
    (!input.needDisclose && input.disclosureContentVersionIds.length > 0) ||
    ![input.fees.notary, input.fees.investigation, input.fees.disclosure].every(
      (fee) =>
        fee.state === 'KNOWN'
          ? typeof fee.amount === 'string' && /^\d+\.\d{2}$/u.test(fee.amount)
          : fee.amount === null,
    ) ||
    !idempotencyKey.trim()
  )
    throw new ApiError('公证书信息无效', 400, 'VALIDATION_ERROR');
  const response = await requestJson(
    `${path}/${encodeURIComponent(id)}/certificate`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    },
  );
  if (!record(response)) throw invalidResponse();
  const responseCertificate = response.certificate;
  const responseCase = response.case;
  if (!record(responseCertificate) || !record(responseCase))
    throw invalidResponse();
  const responseFiles = responseCertificate.files;
  const responseDisclosureFiles = responseCertificate.disclosureFiles;
  if (!Array.isArray(responseFiles) || !Array.isArray(responseDisclosureFiles))
    throw invalidResponse();
  if (
    !exact(response, ['id', 'stage', 'version', 'certificate', 'case']) ||
    response.id !== id ||
    response.stage !== 'ARCHIVED' ||
    response.version !== input.expectedVersion + 1 ||
    !exact(responseCertificate, [
      'certificateNo',
      'certificateDate',
      'issuedAt',
      'files',
      'needDisclose',
      'disclosureFiles',
    ]) ||
    responseCertificate.certificateNo !== input.certificateNo.trim() ||
    responseCertificate.certificateDate !== input.certificateDate ||
    !dateTime(responseCertificate.issuedAt) ||
    responseFiles.length !== input.contentVersionIds.length ||
    !responseFiles.every(validFile) ||
    !input.contentVersionIds.every((versionId) =>
      responseFiles.some(
        (file: unknown) => record(file) && file.contentVersionId === versionId,
      ),
    ) ||
    responseCertificate.needDisclose !== input.needDisclose ||
    !responseDisclosureFiles.every(validFile) ||
    responseDisclosureFiles.length !==
      input.disclosureContentVersionIds.length ||
    !input.disclosureContentVersionIds.every((versionId) =>
      responseDisclosureFiles.some(
        (file: unknown) => record(file) && file.contentVersionId === versionId,
      ),
    ) ||
    (input.needDisclose && responseDisclosureFiles.length === 0) ||
    !exact(responseCase, ['id', 'businessNo', 'stage']) ||
    typeof responseCase.id !== 'string' ||
    typeof responseCase.businessNo !== 'string' ||
    responseCase.stage !== 'PENDING_MATCH'
  )
    throw invalidResponse();
  return response as unknown as RecordNotaryPortalCertificateResult;
}

export async function recordNotaryPortalOpening(
  id: string,
  input: RecordNotaryOpeningInput,
  idempotencyKey: string,
): Promise<RecordNotaryOpeningResult> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.contentVersionIds.length < 1 ||
    input.contentVersionIds.length > 50 ||
    new Set(input.contentVersionIds).size !== input.contentVersionIds.length ||
    input.contentVersionIds.some((item) => !item) ||
    !idempotencyKey.trim()
  ) {
    throw new ApiError('开箱照片信息无效', 400, 'VALIDATION_ERROR');
  }
  const response = await requestJson(
    `${path}/${encodeURIComponent(id)}/opening`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...input, contentVersionIds: [...input.contentVersionIds] },
    },
  );
  const responseOpening = record(response) ? response.opening : undefined;
  const responsePhotos = record(responseOpening)
    ? responseOpening.photos
    : undefined;
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'opening']) ||
    response.id !== id ||
    response.stage !== 'UNBOX_REVIEW' ||
    response.version !== input.expectedVersion + 1 ||
    !record(responseOpening) ||
    !exact(responseOpening, [
      'senderName',
      'senderPhone',
      'senderAddress',
      'recordedAt',
      'recordedByUserId',
      'photos',
    ]) ||
    ![
      responseOpening.senderName,
      responseOpening.senderPhone,
      responseOpening.senderAddress,
    ].every((value) => value === null || typeof value === 'string') ||
    !dateTime(responseOpening.recordedAt) ||
    typeof responseOpening.recordedByUserId !== 'string' ||
    responseOpening.recordedByUserId.length === 0 ||
    !Array.isArray(responsePhotos) ||
    responsePhotos.length !== input.contentVersionIds.length ||
    !responsePhotos.every(
      (photo) =>
        record(photo) &&
        exact(photo, ['materialId', 'contentVersionId']) &&
        typeof photo.materialId === 'string' &&
        photo.materialId.length > 0 &&
        typeof photo.contentVersionId === 'string' &&
        photo.contentVersionId.length > 0,
    ) ||
    new Set(
      responsePhotos.map((photo) =>
        record(photo) ? photo.contentVersionId : null,
      ),
    ).size !== input.contentVersionIds.length ||
    !input.contentVersionIds.every(
      (versionId) =>
        Array.isArray(responsePhotos) &&
        responsePhotos.some(
          (photo) => record(photo) && photo.contentVersionId === versionId,
        ),
    )
  )
    throw invalidResponse();
  return response as unknown as RecordNotaryOpeningResult;
}
