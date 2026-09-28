import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type NotaryOfficeAccount = {
  id: string;
  displayName: string;
  username: string;
  accountActive: boolean;
  bindingActive: boolean;
  bindingVersion: number;
};
export type CreateNotaryOfficeAccountInput = {
  displayName: string;
  username: string;
  password: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isAccount(value: unknown): value is NotaryOfficeAccount {
  return (
    isRecord(value) &&
    Object.keys(value).length === 6 &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    typeof value.username === 'string' &&
    value.username.length > 0 &&
    typeof value.accountActive === 'boolean' &&
    typeof value.bindingActive === 'boolean' &&
    Number.isInteger(value.bindingVersion) &&
    (value.bindingVersion as number) >= 1
  );
}
function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的公证处账号数据',
    200,
    'INVALID_RESPONSE',
  );
}
function accountPath(officeId: string): string {
  return `/notary-offices/${encodeURIComponent(officeId)}/accounts`;
}

export async function listNotaryOfficeAccounts(
  officeId: string,
  options: RequestOptions = {},
): Promise<NotaryOfficeAccount[]> {
  const response = await getJson(accountPath(officeId), options);
  if (
    !isRecord(response) ||
    Object.keys(response).length !== 1 ||
    !Array.isArray(response.items) ||
    !response.items.every(isAccount)
  )
    throw invalidResponse();
  return response.items;
}

export async function createNotaryOfficeAccount(
  officeId: string,
  input: CreateNotaryOfficeAccountInput,
): Promise<NotaryOfficeAccount> {
  const response = await requestJson(accountPath(officeId), {
    method: 'POST',
    body: {
      displayName: input.displayName.trim(),
      username: input.username.trim(),
      password: input.password,
    },
  });
  if (!isAccount(response)) throw invalidResponse();
  return response;
}

export async function setNotaryOfficeAccountActive(
  officeId: string,
  userId: string,
  active: boolean,
): Promise<NotaryOfficeAccount> {
  const response = await requestJson(
    `${accountPath(officeId)}/${encodeURIComponent(userId)}/status`,
    {
      method: 'PATCH',
      body: { active },
    },
  );
  if (!isAccount(response)) throw invalidResponse();
  return response;
}
