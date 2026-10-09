import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CooperationAction = 'pause' | 'terminate' | 'resume';
export type MaintenanceAction = 'responsible-transfer' | CooperationAction;

export type EligibleOperator = {
  id: string;
  displayName: string;
  teamName: string | null;
};

export type EligibleOperatorPage = {
  items: EligibleOperator[];
  total: number;
  page: number;
  pageSize: number;
};

export type TransferResponsibleInput = {
  expectedVersion: number;
  targetUserId: string;
  reason: string;
};

export type ChangeCooperationInput = {
  expectedVersion: number;
  action: CooperationAction;
  reason?: string;
};

export type CustomerMaintenanceResult = {
  customerId: string;
  action: MaintenanceAction;
  resultVersion: number;
  occurredAt: string;
  canReadAfter: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户维护数据', 200, 'INVALID_RESPONSE');
}

function isOperator(value: unknown): value is EligibleOperator {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'displayName', 'teamName']) &&
    typeof value.id === 'string' &&
    typeof value.displayName === 'string' &&
    (typeof value.teamName === 'string' || value.teamName === null)
  );
}

export async function listEligibleOperators(
  customerId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<EligibleOperatorPage> {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new RangeError('运营候选分页参数无效');
  }
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/eligible-operators?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isOperator) ||
    !Number.isInteger(data.total) ||
    Number(data.total) < 0 ||
    data.page !== page ||
    data.pageSize !== pageSize
  ) {
    throw invalidResponse();
  }
  return {
    items: data.items,
    total: data.total as number,
    page: data.page as number,
    pageSize: data.pageSize as number,
  };
}

function isMaintenanceResult(
  value: unknown,
  customerId: string,
  expectedAction: MaintenanceAction,
): value is CustomerMaintenanceResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'customerId',
      'action',
      'resultVersion',
      'occurredAt',
      'canReadAfter',
    ]) &&
    value.customerId === customerId &&
    value.action === expectedAction &&
    Number.isInteger(value.resultVersion) &&
    Number(value.resultVersion) >= 2 &&
    typeof value.occurredAt === 'string' &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    typeof value.canReadAfter === 'boolean'
  );
}

async function postMaintenance(
  customerId: string,
  path: string,
  action: MaintenanceAction,
  body: TransferResponsibleInput | ChangeCooperationInput,
  idempotencyKey: string,
): Promise<CustomerMaintenanceResult> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(customerId)}/${path}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
    },
  );
  if (!isMaintenanceResult(data, customerId, action)) throw invalidResponse();
  return data;
}

export function transferCustomerResponsible(
  customerId: string,
  input: TransferResponsibleInput,
  idempotencyKey: string,
): Promise<CustomerMaintenanceResult> {
  return postMaintenance(
    customerId,
    'responsible-transfer',
    'responsible-transfer',
    input,
    idempotencyKey,
  );
}

export function changeCustomerCooperation(
  customerId: string,
  input: ChangeCooperationInput,
  idempotencyKey: string,
): Promise<CustomerMaintenanceResult> {
  return postMaintenance(
    customerId,
    'cooperation',
    input.action,
    input,
    idempotencyKey,
  );
}
