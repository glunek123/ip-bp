import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type { LeadProduct } from './leads';

export type CaseRoutineProfile = {
  revision: number;
  canEdit: boolean;
  shopName: string | null;
  shopExternalId: string | null;
  remark: string | null;
  products: LeadProduct[];
};
export type CaseRoutineEditInput = {
  expectedRevision: number;
  shopName: string;
  remark: string | null;
  products: Array<{
    id: string;
    title: string | null;
    url: string | null;
    quantity: number;
    unitPrice: string;
  }>;
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function product(value: unknown): value is LeadProduct {
  if (!record(value)) return false;
  return (
    typeof value.id === 'string' &&
    Number.isSafeInteger(value.position) &&
    (value.position as number) > 0 &&
    nullableString(value.title) &&
    nullableString(value.url) &&
    (value.title !== null || value.url !== null) &&
    Number.isSafeInteger(value.quantity) &&
    (value.quantity as number) >= 0 &&
    Number.isSafeInteger(value.commentCount) &&
    (value.commentCount as number) >= 0 &&
    typeof value.unitPrice === 'string' &&
    /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(value.unitPrice) &&
    typeof value.estimatedAmount === 'string' &&
    /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(value.estimatedAmount)
  );
}
function invalidResponse() {
  return new ApiError('案件资料返回无效，请刷新核对', 500, 'INVALID_RESPONSE');
}
export async function getCaseRoutineProfile(
  id: string,
  options: RequestOptions = {},
): Promise<CaseRoutineProfile> {
  const data = await getJson(
    `/cases/${encodeURIComponent(id)}/routine-profile`,
    options,
  );
  if (
    !record(data) ||
    !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 0 ||
    typeof data.canEdit !== 'boolean' ||
    !nullableString(data.shopName) ||
    !nullableString(data.shopExternalId) ||
    !nullableString(data.remark) ||
    !Array.isArray(data.products) ||
    !data.products.every(product) ||
    new Set(data.products.map((item: LeadProduct) => item.id)).size !==
      data.products.length
  )
    throw invalidResponse();
  return data as CaseRoutineProfile;
}
export async function updateCaseRoutineProfile(
  id: string,
  input: CaseRoutineEditInput,
  options: RequestOptions = {},
): Promise<void> {
  const data = await requestJson(
    `/cases/${encodeURIComponent(id)}/routine-profile`,
    { method: 'PATCH', ...options, body: input },
  );
  if (
    !record(data) ||
    data.revision !== input.expectedRevision + 1 ||
    data.shopName !== input.shopName.trim() ||
    data.remark !== (input.remark?.trim() || null) ||
    !nullableString(data.shopExternalId) ||
    !Array.isArray(data.products) ||
    !data.products.every(product) ||
    data.products.length !== input.products.length ||
    new Set((data.products as LeadProduct[]).map((item) => item.id)).size !==
      data.products.length ||
    !input.products.every((item) =>
      (data.products as LeadProduct[]).some((value) => value.id === item.id),
    )
  )
    throw invalidResponse();
}
