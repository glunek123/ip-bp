import { ApiError, getJson, requestJson } from './http';

export type ClientAccount = {
  id: string;
  displayName: string;
  username: string;
  accountActive: boolean;
  bindingActive: boolean;
  bindingVersion: number;
};

export type CreateClientAccountInput = {
  displayName: string;
  username: string;
  password: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClientAccount(value: unknown): value is ClientAccount {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.username === 'string' &&
    typeof value.accountActive === 'boolean' &&
    typeof value.bindingActive === 'boolean' &&
    Number.isInteger(value.bindingVersion) &&
    (value.bindingVersion as number) >= 1
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户账号数据', 200, 'INVALID_RESPONSE');
}

export async function listClientAccounts(
  customerId: string,
): Promise<ClientAccount[]> {
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/client-accounts`,
  );
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isClientAccount)
  )
    throw invalidResponse();
  return data.items;
}

export async function createClientAccount(
  customerId: string,
  input: CreateClientAccountInput,
): Promise<ClientAccount> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(customerId)}/client-accounts`,
    { method: 'POST', body: input },
  );
  if (!isClientAccount(data)) throw invalidResponse();
  return data;
}

export async function setClientAccountStatus(
  customerId: string,
  userId: string,
  active: boolean,
): Promise<ClientAccount> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(customerId)}/client-accounts/${encodeURIComponent(userId)}/status`,
    { method: 'PATCH', body: { active } },
  );
  if (!isClientAccount(data)) throw invalidResponse();
  return data;
}
