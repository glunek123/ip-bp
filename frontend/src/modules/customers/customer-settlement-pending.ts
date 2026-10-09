import type {
  CorrectCustomerSettlementInput,
  RegisterCustomerSettlementInput,
} from '../../api/customer-settlements';

export type SettlementPendingIdentity = {
  userId: string;
  departmentId: string;
  customerId: string;
  kind: 'settlement';
};

export type PendingSettlementCommand = SettlementPendingIdentity & {
  action: 'register' | 'correct';
  recordId?: string;
  expectedCustomerVersion: number;
  expectedRecordVersion?: number;
  body: RegisterCustomerSettlementInput | CorrectCustomerSettlementInput;
  key: string;
};

function storageKey(identity: SettlementPendingIdentity): string {
  return `customer-settlement:${identity.userId}:${identity.departmentId}:${identity.customerId}:${identity.kind}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
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

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function amount(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value)
  );
}

function dateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === 0) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1]
  );
}

function validBody(command: PendingSettlementCommand, body: unknown): boolean {
  if (
    !isRecord(body) ||
    body.expectedCustomerVersion !== command.expectedCustomerVersion ||
    !dateOnly(body.settlementDate) ||
    !amount(body.settlementAmount)
  )
    return false;
  if (command.action === 'register') {
    const optional = ['invoiceAmount', 'receivedAmount', 'receivedDate'];
    return (
      command.action === 'register' &&
      command.recordId === undefined &&
      command.expectedRecordVersion === undefined &&
      exactKeys(body, [
        'expectedCustomerVersion',
        'settlementDate',
        'settlementAmount',
        ...optional.filter((key) => body[key] !== undefined),
      ]) &&
      (body.invoiceAmount === undefined ||
        body.invoiceAmount === null ||
        amount(body.invoiceAmount)) &&
      (body.receivedAmount === undefined ||
        body.receivedAmount === null ||
        amount(body.receivedAmount)) &&
      (body.receivedDate === undefined ||
        body.receivedDate === null ||
        dateOnly(body.receivedDate))
    );
  }
  return (
    command.action === 'correct' &&
    typeof command.recordId === 'string' &&
    command.recordId.length > 0 &&
    positiveInteger(command.expectedRecordVersion) &&
    exactKeys(body, [
      'expectedCustomerVersion',
      'expectedRecordVersion',
      'settlementDate',
      'settlementAmount',
      'invoiceAmount',
      'receivedAmount',
      'receivedDate',
      'reason',
    ]) &&
    body.expectedRecordVersion === command.expectedRecordVersion &&
    (body.invoiceAmount === null || amount(body.invoiceAmount)) &&
    (body.receivedAmount === null || amount(body.receivedAmount)) &&
    (body.receivedDate === null || dateOnly(body.receivedDate)) &&
    typeof body.reason === 'string' &&
    body.reason.trim().length > 0 &&
    body.reason.trim().length <= 500
  );
}

function validCommand(
  value: unknown,
  identity: SettlementPendingIdentity,
): value is PendingSettlementCommand {
  if (
    !isRecord(value) ||
    !exactKeys(
      value,
      [
        'userId',
        'departmentId',
        'customerId',
        'kind',
        'action',
        'recordId',
        'expectedCustomerVersion',
        'expectedRecordVersion',
        'body',
        'key',
      ].filter((key) => value[key] !== undefined),
    ) ||
    value.userId !== identity.userId ||
    value.departmentId !== identity.departmentId ||
    value.customerId !== identity.customerId ||
    value.kind !== identity.kind ||
    !positiveInteger(value.expectedCustomerVersion) ||
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 200
  )
    return false;
  return validBody(value as unknown as PendingSettlementCommand, value.body);
}

export function savePendingSettlementCommand(
  command: PendingSettlementCommand,
): boolean {
  try {
    if (!validCommand(command, command)) return false;
    sessionStorage.setItem(storageKey(command), JSON.stringify(command));
    return true;
  } catch {
    return false;
  }
}

export function readPendingSettlementCommand(
  identity: SettlementPendingIdentity,
): PendingSettlementCommand | undefined {
  const encoded = sessionStorage.getItem(storageKey(identity));
  if (encoded === null) return undefined;
  try {
    const value: unknown = JSON.parse(encoded);
    return validCommand(value, identity) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function clearPendingSettlementCommand(
  command: PendingSettlementCommand,
): boolean {
  try {
    sessionStorage.removeItem(storageKey(command));
    return true;
  } catch {
    return false;
  }
}
