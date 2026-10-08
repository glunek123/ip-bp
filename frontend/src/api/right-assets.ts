import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export const rightAssetTypes = [
  'TRADEMARK',
  'PATENT',
  'COPYRIGHT',
  'REPUTATION',
  'AUTHORIZATION',
  'OTHER',
] as const;
export type RightAssetType = (typeof rightAssetTypes)[number];
export type RightAssetValidityMode = 'FIXED' | 'LONG_TERM' | 'UNKNOWN';
export type RightAssetAction = 'CREATE' | 'REVISE' | 'WITHDRAW';
export type RightAssetFields = {
  type: RightAssetType;
  name: string;
  number: string | null;
  category: string;
  holderId: string;
  ownerText: string | null;
  trademarkClass: string | null;
  validFrom: string | null;
  validTo: string | null;
  validityMode: RightAssetValidityMode;
};
export type RightAssetVersion = RightAssetFields & {
  id: string;
  version: number;
  action: RightAssetAction;
  withdrawReason: string | null;
  recordedByUserId: string;
  recordedAt: string;
};
export type RightAssetSummary = {
  assetId: string;
  customerId: string;
  departmentId: string;
  version: number;
  withdrawn: boolean;
  fields: RightAssetVersion;
};
export type RightAssetDetail = RightAssetSummary & {
  history: RightAssetVersion[];
  capabilities: { revise: boolean; withdraw: boolean };
};
export type RightAssetList = {
  items: RightAssetSummary[];
  total: number;
  page: number;
  pageSize: number;
  capabilities: { create: boolean };
};
export type RightAssetCommandResult = RightAssetSummary & {
  customerVersion: number;
};
export type WriteRightAssetInput = RightAssetFields & {
  expectedCustomerVersion: number;
};
export type ReviseRightAssetInput = WriteRightAssetInput & {
  expectedAssetVersion: number;
};
export type WithdrawRightAssetInput = {
  expectedCustomerVersion: number;
  expectedAssetVersion: number;
  reason: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function version(value: unknown): value is RightAssetVersion {
  if (!record(value)) return false;
  return (
    exactKeys(value, [
      'action',
      'category',
      'holderId',
      'id',
      'name',
      'number',
      'ownerText',
      'recordedAt',
      'recordedByUserId',
      'trademarkClass',
      'type',
      'validFrom',
      'validTo',
      'validityMode',
      'version',
      'withdrawReason',
    ]) &&
    rightAssetTypes.some((type) => type === value.type) &&
    ['FIXED', 'LONG_TERM', 'UNKNOWN'].includes(String(value.validityMode)) &&
    ['CREATE', 'REVISE', 'WITHDRAW'].includes(String(value.action)) &&
    typeof value.id === 'string' &&
    Number.isInteger(value.version) &&
    typeof value.name === 'string' &&
    typeof value.category === 'string' &&
    typeof value.holderId === 'string' &&
    typeof value.recordedByUserId === 'string' &&
    typeof value.recordedAt === 'string' &&
    nullableString(value.number) &&
    nullableString(value.ownerText) &&
    nullableString(value.trademarkClass) &&
    nullableString(value.validFrom) &&
    nullableString(value.validTo) &&
    nullableString(value.withdrawReason)
  );
}
function summary(value: unknown): value is RightAssetSummary {
  return (
    record(value) &&
    exactKeys(value, [
      'assetId',
      'customerId',
      'departmentId',
      'fields',
      'version',
      'withdrawn',
    ]) &&
    typeof value.assetId === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.departmentId === 'string' &&
    Number.isInteger(value.version) &&
    typeof value.withdrawn === 'boolean' &&
    version(value.fields)
  );
}
function invalid(): ApiError {
  return new ApiError('服务返回了无效的权利资产数据', 200, 'INVALID_RESPONSE');
}

export async function listRightAssets(
  customerId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<RightAssetList> {
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/right-assets?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !record(data) ||
    !exactKeys(data, ['capabilities', 'items', 'page', 'pageSize', 'total']) ||
    !Array.isArray(data.items) ||
    !data.items.every(summary) ||
    !Number.isInteger(data.total) ||
    (data.total as number) < 0 ||
    !Number.isInteger(data.page) ||
    (data.page as number) < 1 ||
    !Number.isInteger(data.pageSize) ||
    (data.pageSize as number) < 1 ||
    (data.pageSize as number) > 100 ||
    !record(data.capabilities) ||
    !exactKeys(data.capabilities, ['create']) ||
    typeof data.capabilities.create !== 'boolean'
  )
    throw invalid();
  return data as RightAssetList;
}

export async function getRightAsset(
  customerId: string,
  assetId: string,
  options: RequestOptions = {},
): Promise<RightAssetDetail> {
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/right-assets/${encodeURIComponent(assetId)}`,
    options,
  );
  if (
    !record(data) ||
    !exactKeys(data, [
      'assetId',
      'customerId',
      'departmentId',
      'version',
      'withdrawn',
      'fields',
      'history',
      'capabilities',
    ]) ||
    !summary({
      assetId: data.assetId,
      customerId: data.customerId,
      departmentId: data.departmentId,
      version: data.version,
      withdrawn: data.withdrawn,
      fields: data.fields,
    }) ||
    !Array.isArray(data.history) ||
    !data.history.every(version) ||
    !record(data.capabilities) ||
    !exactKeys(data.capabilities, ['revise', 'withdraw']) ||
    typeof data.capabilities.revise !== 'boolean' ||
    typeof data.capabilities.withdraw !== 'boolean'
  )
    throw invalid();
  return data as RightAssetDetail;
}

function command(data: unknown): RightAssetCommandResult {
  if (
    !record(data) ||
    !exactKeys(data, [
      'assetId',
      'customerId',
      'departmentId',
      'version',
      'withdrawn',
      'fields',
      'customerVersion',
    ]) ||
    !summary({
      assetId: data.assetId,
      customerId: data.customerId,
      departmentId: data.departmentId,
      version: data.version,
      withdrawn: data.withdrawn,
      fields: data.fields,
    }) ||
    !Number.isInteger(data.customerVersion)
  )
    throw invalid();
  return data as RightAssetCommandResult;
}

export async function createRightAsset(
  customerId: string,
  input: WriteRightAssetInput,
  key: string,
): Promise<RightAssetCommandResult> {
  return command(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/right-assets`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: input,
      },
    ),
  );
}
export async function reviseRightAsset(
  customerId: string,
  assetId: string,
  input: ReviseRightAssetInput,
  key: string,
): Promise<RightAssetCommandResult> {
  return command(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/right-assets/${encodeURIComponent(assetId)}/revisions`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: input,
      },
    ),
  );
}
export async function withdrawRightAsset(
  customerId: string,
  assetId: string,
  input: WithdrawRightAssetInput,
  key: string,
): Promise<RightAssetCommandResult> {
  return command(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/right-assets/${encodeURIComponent(assetId)}/withdraw`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: input,
      },
    ),
  );
}
