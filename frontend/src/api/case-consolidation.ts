import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type { CaseStage } from './cases';

export type ConsolidationDefendant = {
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string;
};
export type ConsolidationInputMember = {
  caseId: string;
  expectedVersion: number;
  confirmed: true;
  defendant: ConsolidationDefendant;
};
export type ConsolidationPreviewInput = {
  members: ConsolidationInputMember[];
  mainCaseId?: string;
};
export type ConsolidationPreview = {
  mainCaseId: string;
  mainBusinessNo: string;
  caseCount: number;
  shop: { platform: string; externalId: string; name: string };
  cases: {
    id: string;
    businessNo: string;
    version: number;
    createdAt: string;
    isMain: boolean;
  }[];
};
export type ConsolidationCreateInput = ConsolidationPreviewInput & {
  mainCaseId: string;
  idempotencyKey: string;
};
export type ConsolidationResult = {
  id: string;
  mainCaseId: string;
  mainBusinessNo: string;
  caseCount: number;
  caseIds: string[];
  createdAt: string;
};
export type ConsolidationTrace = {
  id: string;
  mainCaseId: string;
  createdAt: string;
  caseCount: number;
  cases: {
    caseId: string;
    businessNo: string;
    stage: CaseStage;
    isMain: boolean;
    originalVersion: number;
    defendant: ConsolidationDefendant;
    sourceLead: null | {
      id: string;
      businessNo: string;
      products: {
        id: string;
        position: number;
        title: string | null;
        url: string | null;
        screenshots: { materialId: string; contentVersionId: string }[];
      }[];
    };
    sourceNotaryMatter: null | { id: string; businessNo: string };
    certificateId: string | null;
    materials: {
      id: string;
      ownerType: string;
      ownerId: string;
      category: string;
      purpose: string;
      currentVersionId: string | null;
      contentVersions: { id: string; originalFilename: string }[];
    }[];
    selectedMaterialVersions: {
      materialId: string;
      contentVersionId: string;
      ownerType: string;
      ownerId: string;
    }[];
    filingReferences: {
      sourceCaseId: string;
      materialId: string;
      contentVersionId: string;
    }[];
    feeRecordIds: string[];
  }[];
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const bad = () => new ApiError('合案返回数据无效', 502, 'INVALID_RESPONSE');
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const validResult = (value: unknown): value is ConsolidationResult =>
  record(value) &&
  text(value.id) &&
  uuid.test(value.id) &&
  text(value.mainCaseId) &&
  uuid.test(value.mainCaseId) &&
  text(value.mainBusinessNo) &&
  Number.isInteger(value.caseCount) &&
  Array.isArray(value.caseIds) &&
  value.caseIds.length === value.caseCount &&
  value.caseIds.every((id) => typeof id === 'string' && uuid.test(id)) &&
  value.caseIds.includes(value.mainCaseId) &&
  text(value.createdAt) &&
  !Number.isNaN(Date.parse(value.createdAt));

export async function previewCaseConsolidation(
  input: ConsolidationPreviewInput,
  options: RequestOptions = {},
): Promise<ConsolidationPreview> {
  const value = await requestJson('/cases/consolidations/preview', {
    ...options,
    method: 'POST',
    body: input,
    retryOnCsrfInvalid: false,
  });
  if (
    !record(value) ||
    !text(value.mainCaseId) ||
    !uuid.test(value.mainCaseId) ||
    !text(value.mainBusinessNo) ||
    !Number.isInteger(value.caseCount) ||
    !record(value.shop) ||
    !text(value.shop.platform) ||
    !text(value.shop.externalId) ||
    !Array.isArray(value.cases) ||
    value.cases.length !== value.caseCount ||
    !value.cases.every(
      (item) =>
        record(item) &&
        text(item.id) &&
        uuid.test(item.id) &&
        text(item.businessNo) &&
        Number.isInteger(item.version) &&
        text(item.createdAt) &&
        typeof item.isMain === 'boolean',
    )
  )
    throw bad();
  return value as ConsolidationPreview;
}

export async function createCaseConsolidation(
  input: ConsolidationCreateInput,
  options: RequestOptions = {},
): Promise<ConsolidationResult> {
  const value = await requestJson('/cases/consolidations', {
    ...options,
    method: 'POST',
    body: input,
    retryOnCsrfInvalid: false,
  });
  if (
    !validResult(value) ||
    value.mainCaseId !== input.mainCaseId ||
    value.caseCount !== input.members.length
  )
    throw bad();
  return value;
}

export async function getCaseConsolidation(
  caseId: string,
  options: RequestOptions = {},
): Promise<ConsolidationTrace | null> {
  if (!uuid.test(caseId))
    throw new ApiError('案件编号无效', 400, 'VALIDATION_ERROR');
  const value = await getJson(
    `/cases/${encodeURIComponent(caseId)}/consolidation`,
    options,
  );
  if (value === null) return null;
  if (
    !record(value) ||
    !text(value.id) ||
    !uuid.test(value.id) ||
    !text(value.mainCaseId) ||
    !uuid.test(value.mainCaseId) ||
    !Number.isInteger(value.caseCount) ||
    !Array.isArray(value.cases) ||
    value.cases.length !== value.caseCount ||
    !value.cases.every(
      (item) =>
        record(item) &&
        text(item.caseId) &&
        uuid.test(item.caseId) &&
        text(item.businessNo) &&
        typeof item.isMain === 'boolean' &&
        Array.isArray(item.materials) &&
        Array.isArray(item.feeRecordIds) &&
        Array.isArray(item.selectedMaterialVersions),
    )
  )
    throw bad();
  return value as ConsolidationTrace;
}
