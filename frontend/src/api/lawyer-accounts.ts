import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type LawyerAccountProfile = {
  bindingId: string;
  bindingActive: boolean;
  bindingVersion: number;
  profileId: string;
  fullName: string;
  lawFirm: string | null;
  phone: string | null;
};
export type LawyerAccount = {
  id: string;
  displayName: string;
  username: string;
  active: boolean;
  authorizationRevision: number;
  profiles: LawyerAccountProfile[];
};
export type LawyerAccountPage = {
  items: LawyerAccount[];
  total: number;
  page: number;
  pageSize: number;
};
export type UnboundLawyerProfile = {
  profileId: string;
  fullName: string;
  lawFirm: string | null;
  phone: string | null;
  caseBusinessNos: string[];
  historicalAssignmentCount: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((k, i) => k === expected[i])
  );
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的律师账号数据', 200, 'INVALID_RESPONSE');
}
function validProfile(value: unknown): value is LawyerAccountProfile {
  return (
    record(value) &&
    exact(value, [
      'bindingId',
      'bindingActive',
      'bindingVersion',
      'profileId',
      'fullName',
      'lawFirm',
      'phone',
    ]) &&
    typeof value.bindingId === 'string' &&
    typeof value.bindingActive === 'boolean' &&
    Number.isInteger(value.bindingVersion) &&
    typeof value.profileId === 'string' &&
    typeof value.fullName === 'string' &&
    nullableText(value.lawFirm) &&
    nullableText(value.phone)
  );
}
function validAccount(value: unknown): value is LawyerAccount {
  return (
    record(value) &&
    exact(value, [
      'id',
      'displayName',
      'username',
      'active',
      'authorizationRevision',
      'profiles',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.username === 'string' &&
    typeof value.active === 'boolean' &&
    Number.isInteger(value.authorizationRevision) &&
    Array.isArray(value.profiles) &&
    value.profiles.every(validProfile)
  );
}
function validUnboundProfile(value: unknown): value is UnboundLawyerProfile {
  return (
    record(value) &&
    exact(value, [
      'profileId',
      'fullName',
      'lawFirm',
      'phone',
      'caseBusinessNos',
      'historicalAssignmentCount',
    ]) &&
    typeof value.profileId === 'string' &&
    typeof value.fullName === 'string' &&
    nullableText(value.lawFirm) &&
    nullableText(value.phone) &&
    Array.isArray(value.caseBusinessNos) &&
    value.caseBusinessNos.every((item) => typeof item === 'string') &&
    Number.isInteger(value.historicalAssignmentCount) &&
    Number(value.historicalAssignmentCount) > 0
  );
}
function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

export async function listLawyerAccounts(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<LawyerAccountPage> {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new ApiError('律师账号分页参数无效', 400, 'VALIDATION_ERROR');
  const result = await getJson(
    `/lawyer-accounts?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !record(result) ||
    !exact(result, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(result.items) ||
    !result.items.every(validAccount) ||
    !Number.isInteger(result.total) ||
    Number(result.total) < 0 ||
    result.page !== page ||
    result.pageSize !== pageSize
  )
    throw invalidResponse();
  return result as LawyerAccountPage;
}

export async function listUnboundLawyerProfiles(
  q = '',
  options: RequestOptions = {},
): Promise<UnboundLawyerProfile[]> {
  const query = q.trim();
  const result = await getJson(
    `/lawyer-accounts/unbound-profiles?q=${encodeURIComponent(query)}`,
    options,
  );
  if (
    !record(result) ||
    !exact(result, ['items']) ||
    !Array.isArray(result.items) ||
    result.items.length > 50 ||
    !result.items.every(validUnboundProfile)
  )
    throw invalidResponse();
  return result.items;
}

export async function createLawyerAccount(input: {
  fullName: string;
  username: string;
  password: string;
  lawFirm?: string;
  phone?: string;
}): Promise<LawyerAccount> {
  const body = {
    fullName: input.fullName.trim(),
    username: input.username.trim(),
    password: input.password,
    ...(cleanOptional(input.lawFirm)
      ? { lawFirm: cleanOptional(input.lawFirm) }
      : {}),
    ...(cleanOptional(input.phone)
      ? { phone: cleanOptional(input.phone) }
      : {}),
  };
  if (!body.fullName || !body.username || !body.password)
    throw new ApiError('姓名、用户名和密码为必填项', 400, 'VALIDATION_ERROR');
  const result = await requestJson('/lawyer-accounts', {
    method: 'POST',
    body,
  });
  if (!validAccount(result)) throw invalidResponse();
  return result;
}

export async function bindLawyerProfile(
  id: string,
  input: { profileId: string; expectedAuthorizationRevision: number },
): Promise<LawyerAccount> {
  const result = await requestJson(
    `/lawyer-accounts/${encodeURIComponent(id)}/bindings`,
    { method: 'POST', body: input },
  );
  if (!validAccount(result)) throw invalidResponse();
  return result;
}

export async function setLawyerAccountStatus(
  id: string,
  active: boolean,
  expectedAuthorizationRevision: number,
): Promise<LawyerAccount> {
  const result = await requestJson(
    `/lawyer-accounts/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: { active, expectedAuthorizationRevision } },
  );
  if (!validAccount(result)) throw invalidResponse();
  return result;
}

export async function setLawyerBindingStatus(
  id: string,
  bindingId: string,
  active: boolean,
  expectedVersion: number,
): Promise<LawyerAccount> {
  const result = await requestJson(
    `/lawyer-accounts/${encodeURIComponent(id)}/bindings/${encodeURIComponent(bindingId)}/status`,
    { method: 'PATCH', body: { active, expectedVersion } },
  );
  if (!validAccount(result)) throw invalidResponse();
  return result;
}

export async function resetLawyerPassword(
  id: string,
  newPassword: string,
  expectedAuthorizationRevision: number,
): Promise<LawyerAccount> {
  if (!newPassword.trim())
    throw new ApiError('新密码为必填项', 400, 'VALIDATION_ERROR');
  const result = await requestJson(
    `/lawyer-accounts/${encodeURIComponent(id)}/password-reset`,
    { method: 'POST', body: { newPassword, expectedAuthorizationRevision } },
  );
  if (!validAccount(result)) throw invalidResponse();
  return result;
}
