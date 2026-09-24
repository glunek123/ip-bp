import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type { LeadProduct } from './leads';

export type NotaryOffice = {
  id: string;
  name: string;
  status: 'ACTIVE';
};

export type NotaryOfficeList = {
  items: NotaryOffice[];
  capabilities: { create: boolean };
};

export type CreateNotaryMatterInput = {
  selectedProductIds: string[];
  selectedContentVersionIds: string[];
  notaryOfficeId: string;
  evidenceMode: 'ONLINE_PURCHASE';
  batchPurpose: string;
  expectedVersion: number;
  createNewBatch?: boolean;
};

export type NotaryMatterResult = {
  id: string;
  businessNo: string;
  leadId: string;
  leadStatus: 'TRANSFERRED_TO_NOTARY';
  leadVersion: number;
  stage: 'PENDING_EVIDENCE';
  notaryOffice: { id: string; name: string };
  selectedProductIds: string[];
  selectedContentVersionIds: string[];
  evidenceMode: 'ONLINE_PURCHASE';
  batchPurpose: string;
  createdAt: string;
};

export type NotaryMatterDetail = NotaryMatterResult & {
  sourceLead: { id: string; businessNo: string };
  selectedProducts: LeadProduct[];
  selectedMaterials: Array<{
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
    mimeType: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的公证事项数据', 200, 'INVALID_RESPONSE');
}

function isOffice(value: unknown): value is NotaryOffice {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.status === 'ACTIVE'
  );
}

function isMatterResult(value: unknown): value is NotaryMatterResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    typeof value.leadId === 'string' &&
    value.leadStatus === 'TRANSFERRED_TO_NOTARY' &&
    Number.isInteger(value.leadVersion) &&
    (value.leadVersion as number) >= 1 &&
    value.stage === 'PENDING_EVIDENCE' &&
    isRecord(value.notaryOffice) &&
    typeof value.notaryOffice.id === 'string' &&
    typeof value.notaryOffice.name === 'string' &&
    Array.isArray(value.selectedProductIds) &&
    value.selectedProductIds.length >= 1 &&
    value.selectedProductIds.every((id) => typeof id === 'string') &&
    new Set(value.selectedProductIds).size ===
      value.selectedProductIds.length &&
    Array.isArray(value.selectedContentVersionIds) &&
    value.selectedContentVersionIds.every((id) => typeof id === 'string') &&
    new Set(value.selectedContentVersionIds).size ===
      value.selectedContentVersionIds.length &&
    value.evidenceMode === 'ONLINE_PURCHASE' &&
    typeof value.batchPurpose === 'string' &&
    value.batchPurpose.trim().length > 0 &&
    [...value.batchPurpose].length <= 500 &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(value);
}

function isProductSnapshot(value: unknown): value is LeadProduct {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Number.isInteger(value.position) &&
    (value.position as number) >= 1 &&
    (value.url === null || typeof value.url === 'string') &&
    (value.title === null || typeof value.title === 'string') &&
    (value.url !== null || value.title !== null) &&
    Number.isInteger(value.quantity) &&
    (value.quantity as number) >= 1 &&
    isMoney(value.unitPrice) &&
    Number.isInteger(value.commentCount) &&
    (value.commentCount as number) >= 0 &&
    isMoney(value.estimatedAmount)
  );
}

function sameIds(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.every((id) => typeof id === 'string') &&
    left.length === right.length &&
    new Set(left).size === left.length &&
    right.every((id) => left.includes(id))
  );
}

function isMatterDetail(value: unknown): value is NotaryMatterDetail {
  if (!isMatterResult(value)) return false;
  const detail = value as Record<string, unknown>;
  const sourceLead = detail.sourceLead;
  const selectedProducts = detail.selectedProducts;
  const selectedMaterials = detail.selectedMaterials;
  return (
    isRecord(sourceLead) &&
    typeof sourceLead.id === 'string' &&
    typeof sourceLead.businessNo === 'string' &&
    Array.isArray(selectedProducts) &&
    selectedProducts.every(isProductSnapshot) &&
    Array.isArray(selectedMaterials) &&
    selectedMaterials.every(
      (material) =>
        isRecord(material) &&
        typeof material.materialId === 'string' &&
        typeof material.contentVersionId === 'string' &&
        typeof material.originalFilename === 'string' &&
        typeof material.mimeType === 'string',
    ) &&
    (selectedProducts as LeadProduct[]).length ===
      value.selectedProductIds.length &&
    value.selectedProductIds.every((id) =>
      (selectedProducts as LeadProduct[]).some((product) => product.id === id),
    ) &&
    (selectedMaterials as Array<Record<string, unknown>>).length ===
      value.selectedContentVersionIds.length &&
    value.selectedContentVersionIds.every((id) =>
      (selectedMaterials as Array<Record<string, unknown>>).some(
        (material) => material.contentVersionId === id,
      ),
    )
  );
}

export async function listNotaryOffices(
  options: RequestOptions = {},
): Promise<NotaryOfficeList> {
  const data = await getJson('/notary-offices', options);
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isOffice) ||
    !isRecord(data.capabilities) ||
    typeof data.capabilities.create !== 'boolean'
  )
    throw invalidResponse();
  return data as NotaryOfficeList;
}

export async function getNotaryMatter(
  id: string,
  options: RequestOptions = {},
): Promise<NotaryMatterDetail> {
  const data = await getJson(
    `/notary-matters/${encodeURIComponent(id)}`,
    options,
  );
  if (!isMatterDetail(data)) throw invalidResponse();
  return data;
}

export async function createNotaryOffice(name: string): Promise<NotaryOffice> {
  const data = await requestJson('/notary-offices', {
    method: 'POST',
    body: { name: name.trim() },
  });
  if (!isOffice(data)) throw invalidResponse();
  return data;
}

export async function createNotaryMatter(
  leadId: string,
  input: CreateNotaryMatterInput,
  idempotencyKey: string,
): Promise<NotaryMatterResult> {
  const data = await requestJson(
    `/leads/${encodeURIComponent(leadId)}/notary-matters`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        ...input,
        selectedProductIds: [...input.selectedProductIds],
        selectedContentVersionIds: [...input.selectedContentVersionIds],
        batchPurpose: input.batchPurpose.trim(),
      },
    },
  );
  if (
    !isMatterResult(data) ||
    data.leadId !== leadId ||
    data.leadVersion !== input.expectedVersion + 1 ||
    !sameIds(data.selectedProductIds, input.selectedProductIds) ||
    !sameIds(data.selectedContentVersionIds, input.selectedContentVersionIds) ||
    data.batchPurpose !== input.batchPurpose.trim()
  )
    throw invalidResponse();
  return data;
}
