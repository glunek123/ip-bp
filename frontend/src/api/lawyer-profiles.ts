import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type LawyerProfileStatus = 'ACTIVE' | 'INACTIVE';
export type LawyerProfileSource = 'MANUAL' | 'ACCOUNT_CREATE' | 'LEGACY_MATCH';
export type LawyerProfileAccount = {
  accountId: string;
  username: string | null;
  active: boolean;
};
export type LawyerProfile = {
  id: string;
  fullName: string;
  lawFirm: string | null;
  phone: string | null;
  email: string | null;
  barNumber: string | null;
  lawFirmCreditCode: string | null;
  region: string | null;
  address: string | null;
  status: LawyerProfileStatus;
  source: LawyerProfileSource;
  version: number;
  createdAt: string;
  updatedAt: string;
  assignmentCount: number;
  account: LawyerProfileAccount | null;
  hasAccount: boolean;
};
export type LawyerProfilePage = {
  items: LawyerProfile[];
  total: number;
  page: number;
  pageSize: number;
};
export type LawyerProfileQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  account?: 'ALL' | 'WITH_ACCOUNT' | 'WITHOUT_ACCOUNT';
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';
};
export type LawyerProfileInput = {
  fullName: string;
  lawFirm?: string | null;
  phone?: string | null;
  email?: string | null;
  barNumber?: string | null;
  lawFirmCreditCode?: string | null;
  region?: string | null;
  address?: string | null;
};
export type LawyerProfileUpdate = Partial<LawyerProfileInput> & {
  expectedVersion: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的律师档案数据', 200, 'INVALID_RESPONSE');
}
function validAccount(value: unknown): value is LawyerProfileAccount {
  return (
    record(value) &&
    exact(value, ['accountId', 'username', 'active']) &&
    typeof value.accountId === 'string' &&
    nullableText(value.username) &&
    typeof value.active === 'boolean'
  );
}
function validProfile(value: unknown): value is LawyerProfile {
  return (
    record(value) &&
    exact(value, [
      'id',
      'fullName',
      'lawFirm',
      'phone',
      'email',
      'barNumber',
      'lawFirmCreditCode',
      'region',
      'address',
      'status',
      'source',
      'version',
      'createdAt',
      'updatedAt',
      'assignmentCount',
      'account',
      'hasAccount',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.fullName === 'string' &&
    nullableText(value.lawFirm) &&
    nullableText(value.phone) &&
    nullableText(value.email) &&
    nullableText(value.barNumber) &&
    nullableText(value.lawFirmCreditCode) &&
    nullableText(value.region) &&
    nullableText(value.address) &&
    (value.status === 'ACTIVE' || value.status === 'INACTIVE') &&
    (value.source === 'MANUAL' ||
      value.source === 'ACCOUNT_CREATE' ||
      value.source === 'LEGACY_MATCH') &&
    Number.isInteger(value.version) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Number.isInteger(value.assignmentCount) &&
    (value.account === null || validAccount(value.account)) &&
    typeof value.hasAccount === 'boolean'
  );
}
export async function listLawyerProfiles(
  query: LawyerProfileQuery = {},
  options: RequestOptions = {},
): Promise<LawyerProfilePage> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined)
    params.set('pageSize', String(query.pageSize));
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.account && query.account !== 'ALL')
    params.set('account', query.account);
  if (query.status && query.status !== 'ALL')
    params.set('status', query.status);
  const suffix = params.toString();
  const result = await getJson(
    `/lawyer-profiles${suffix ? `?${suffix}` : ''}`,
    options,
  );
  if (
    !record(result) ||
    !exact(result, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(result.items) ||
    !result.items.every(validProfile) ||
    !Number.isInteger(result.total) ||
    !Number.isInteger(result.page) ||
    !Number.isInteger(result.pageSize)
  )
    throw invalidResponse();
  return result as LawyerProfilePage;
}
export async function getLawyerProfile(
  id: string,
  options: RequestOptions = {},
): Promise<LawyerProfile> {
  const result = await getJson(
    `/lawyer-profiles/${encodeURIComponent(id)}`,
    options,
  );
  if (!validProfile(result)) throw invalidResponse();
  return result;
}
export async function createLawyerProfile(
  input: LawyerProfileInput,
): Promise<LawyerProfile> {
  const result = await requestJson('/lawyer-profiles', {
    method: 'POST',
    body: input,
  });
  if (!validProfile(result)) throw invalidResponse();
  return result;
}
export async function updateLawyerProfile(
  id: string,
  input: LawyerProfileUpdate,
): Promise<LawyerProfile> {
  const result = await requestJson(
    `/lawyer-profiles/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: input },
  );
  if (!validProfile(result)) throw invalidResponse();
  return result;
}
export async function setLawyerProfileStatus(
  id: string,
  active: boolean,
  expectedVersion: number,
): Promise<LawyerProfile> {
  const result = await requestJson(
    `/lawyer-profiles/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: { active, expectedVersion } },
  );
  if (!validProfile(result)) throw invalidResponse();
  return result;
}
export async function openLawyerAccountForProfile(
  id: string,
  input: { username: string; password: string },
): Promise<void> {
  await requestJson(`/lawyer-profiles/${encodeURIComponent(id)}/account`, {
    method: 'POST',
    body: input,
  });
}
