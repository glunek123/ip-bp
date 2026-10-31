import { ApiError, requestJson, type RequestOptions } from './http';

/** Explicit actual facts. A settlement bill or request is not proof of receipt/invoice. */
export type RegisterCaseSettlementActualInput = {
  caseId: string;
  amount: string;
  occurredOn: string;
  sourceReference?: string | null;
  note?: string;
  idempotencyKey: string;
} & (
  { side: 'CUSTOMER'; lawyerId?: never } | { side: 'LAWYER'; lawyerId: string }
);
export type CaseSettlementActualRegistrationResult = {
  id: string;
  amount: string;
  allocatedAmount: string;
  allocationId: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
const positiveMoney =
  /^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/u;
function validDay(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    !value.startsWith('0000-') &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}
function validInput(
  value: unknown,
): value is RegisterCaseSettlementActualInput {
  if (!record(value)) return false;
  const required = ['caseId', 'side', 'amount', 'occurredOn', 'idempotencyKey'];
  const optional = ['lawyerId', 'sourceReference', 'note'];
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    ) &&
    uuid(value.caseId) &&
    (value.side === 'CUSTOMER'
      ? value.lawyerId === undefined
      : value.side === 'LAWYER' && uuid(value.lawyerId)) &&
    typeof value.amount === 'string' &&
    positiveMoney.test(value.amount) &&
    validDay(value.occurredOn) &&
    typeof value.idempotencyKey === 'string' &&
    value.idempotencyKey.length <= 128 &&
    value.idempotencyKey.trim().length > 0 &&
    (value.sourceReference === undefined ||
      value.sourceReference === null ||
      (typeof value.sourceReference === 'string' &&
        value.sourceReference.length >= 1 &&
        value.sourceReference.length <= 200)) &&
    (value.note === undefined ||
      (typeof value.note === 'string' && value.note.length <= 500))
  );
}
/** Both first registration and idempotent replay return the full same-case allocation. */
function decodeCaseSettlementActualRegistration(
  value: unknown,
  expectedAmount: string,
): CaseSettlementActualRegistrationResult {
  const canonicalAmount = expectedAmount.includes('.')
    ? `${expectedAmount.split('.')[0]}.${expectedAmount.split('.')[1].padEnd(2, '0')}`
    : `${expectedAmount}.00`;
  if (
    !record(value) ||
    Object.keys(value).length !== 4 ||
    !['id', 'amount', 'allocatedAmount', 'allocationId'].every((key) =>
      Object.hasOwn(value, key),
    ) ||
    !uuid(value.id) ||
    !uuid(value.allocationId) ||
    typeof value.amount !== 'string' ||
    !/^(?:0|[1-9]\d{0,15})\.\d{2}$/u.test(value.amount) ||
    !positiveMoney.test(value.amount) ||
    value.amount !== canonicalAmount ||
    value.allocatedAmount !== value.amount
  ) {
    throw new ApiError(
      '服务返回了无效的实际结算登记回执',
      200,
      'INVALID_RESPONSE',
    );
  }
  return {
    id: value.id,
    amount: value.amount,
    allocatedAmount: value.amount,
    allocationId: value.allocationId,
  };
}

export async function registerCaseSettlementActual(
  input: RegisterCaseSettlementActualInput,
  options: RequestOptions = {},
): Promise<CaseSettlementActualRegistrationResult> {
  if (!validInput(input))
    throw new ApiError('实际结算登记输入无效', 400, 'VALIDATION_ERROR');
  const response = await requestJson('/settlements/actual-registrations', {
    ...options,
    method: 'POST',
    body: {
      caseId: input.caseId,
      side: input.side,
      amount: input.amount,
      occurredOn: input.occurredOn,
      idempotencyKey: input.idempotencyKey,
      ...(input.side === 'LAWYER' ? { lawyerId: input.lawyerId } : {}),
      ...(input.sourceReference !== undefined
        ? { sourceReference: input.sourceReference }
        : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
  return decodeCaseSettlementActualRegistration(response, input.amount);
}

export type SettlementActualCandidate = {
  id: string;
  side: 'CUSTOMER' | 'LAWYER';
  amount: string;
  remainingAmount: string;
  occurredOn: string;
  sourceReference: string | null;
};
export type AllocateSettlementActualInput = {
  factId: string;
  caseId: string;
  amount: string;
  idempotencyKey: string;
};
export type SettlementActualCommand =
  | { kind: 'register'; input: RegisterCaseSettlementActualInput }
  | { kind: 'create'; input: RegisterCaseSettlementActualInput }
  | { kind: 'allocate'; input: AllocateSettlementActualInput };
export type SettlementActualCommandResult = {
  id: string;
  amount: string;
  allocatedAmount?: string | null;
  allocationId?: string;
  factId?: string;
  caseId?: string;
};
export async function settlementActualCandidates(
  caseId: string,
  options: RequestOptions = {},
): Promise<SettlementActualCandidate[]> {
  if (!uuid(caseId))
    throw new ApiError('案件信息无效', 400, 'VALIDATION_ERROR');
  const result = await requestJson(
    `/settlements/actual-registrations/candidates?caseId=${encodeURIComponent(caseId)}`,
    options,
  );
  if (
    !Array.isArray(result) ||
    !result.every(
      (row) =>
        record(row) &&
        Object.keys(row).length === 6 &&
        uuid(row.id) &&
        (row.side === 'CUSTOMER' || row.side === 'LAWYER') &&
        typeof row.amount === 'string' &&
        positiveMoney.test(row.amount) &&
        typeof row.remainingAmount === 'string' &&
        positiveMoney.test(row.remainingAmount) &&
        validDay(row.occurredOn) &&
        (row.sourceReference === null ||
          typeof row.sourceReference === 'string'),
    )
  )
    throw new ApiError('可分配款项返回无效', 200, 'INVALID_RESPONSE');
  return result as SettlementActualCandidate[];
}
function canonicalMoney(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}
export async function sendSettlementActualCommand(
  command: SettlementActualCommand,
): Promise<SettlementActualCommandResult> {
  if (command.kind === 'register')
    return registerCaseSettlementActual(command.input);
  if (command.kind === 'create') {
    const input = command.input;
    if (!validInput(input))
      throw new ApiError('实际款项输入无效', 400, 'VALIDATION_ERROR');
    const result = await requestJson(
      '/settlements/actual-registrations/facts',
      {
        method: 'POST',
        body: {
          caseId: input.caseId,
          side: input.side,
          amount: input.amount,
          occurredOn: input.occurredOn,
          idempotencyKey: input.idempotencyKey,
          ...(input.side === 'LAWYER' ? { lawyerId: input.lawyerId } : {}),
          ...(input.sourceReference !== undefined
            ? { sourceReference: input.sourceReference }
            : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      },
    );
    if (
      !record(result) ||
      Object.keys(result).length !== 3 ||
      !uuid(result.id) ||
      result.allocatedAmount !== null ||
      typeof result.amount !== 'string' ||
      !positiveMoney.test(result.amount) ||
      result.amount !== canonicalMoney(input.amount)
    )
      throw new ApiError('款项登记回执无效', 200, 'INVALID_RESPONSE');
    return { id: result.id, amount: result.amount, allocatedAmount: null };
  }
  const input = command.input;
  if (
    !record(input) ||
    !uuid(input.factId) ||
    !uuid(input.caseId) ||
    typeof input.amount !== 'string' ||
    !positiveMoney.test(input.amount) ||
    typeof input.idempotencyKey !== 'string' ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    Object.keys(input).length !== 4
  )
    throw new ApiError('分配输入无效', 400, 'VALIDATION_ERROR');
  const result = await requestJson(
    '/settlements/actual-registrations/allocations',
    { method: 'POST', body: input },
  );
  if (
    !record(result) ||
    Object.keys(result).length !== 4 ||
    !uuid(result.id) ||
    result.factId !== input.factId ||
    result.caseId !== input.caseId ||
    typeof result.amount !== 'string' ||
    !positiveMoney.test(result.amount) ||
    result.amount !== canonicalMoney(input.amount)
  )
    throw new ApiError('分配回执无效', 200, 'INVALID_RESPONSE');
  return {
    id: result.id,
    factId: input.factId,
    caseId: input.caseId,
    amount: result.amount,
  };
}
