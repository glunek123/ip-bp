import type {
  ChangeCooperationInput,
  CooperationAction,
  TransferResponsibleInput,
} from '../../api/customer-cooperation';

export type PendingCustomerMaintenance = {
  action: CooperationAction | 'responsible-transfer';
  userId: string;
  departmentId: string;
  customerId: string;
  expectedVersion: number;
  body: TransferResponsibleInput | ChangeCooperationInput;
  key: string;
};

type PendingIdentity = Pick<
  PendingCustomerMaintenance,
  'action' | 'userId' | 'departmentId' | 'customerId'
>;

function storageKey(identity: PendingIdentity): string {
  return `customer-maintenance:${identity.userId}:${identity.departmentId}:${identity.customerId}:${identity.action}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBody(
  action: PendingCustomerMaintenance['action'],
  body: unknown,
  expectedVersion: number,
): body is PendingCustomerMaintenance['body'] {
  if (!isRecord(body) || body.expectedVersion !== expectedVersion) return false;
  if (action === 'responsible-transfer') {
    return (
      Object.keys(body).sort().join('|') ===
        ['expectedVersion', 'reason', 'targetUserId'].sort().join('|') &&
      typeof body.targetUserId === 'string' &&
      typeof body.reason === 'string' &&
      body.reason.trim() === body.reason &&
      body.reason.length >= 1 &&
      body.reason.length <= 500
    );
  }
  const expectedKeys =
    action === 'resume'
      ? [
          'action',
          'expectedVersion',
          ...(body.reason === undefined ? [] : ['reason']),
        ]
      : ['action', 'expectedVersion', 'reason'];
  return (
    Object.keys(body).sort().join('|') === expectedKeys.sort().join('|') &&
    body.action === action &&
    (body.reason === undefined ||
      (typeof body.reason === 'string' &&
        body.reason.trim() === body.reason &&
        body.reason.length >= 1 &&
        body.reason.length <= 500))
  );
}

export function readPendingCustomerMaintenance(
  identity: PendingIdentity,
): PendingCustomerMaintenance | undefined {
  try {
    const raw = globalThis.sessionStorage.getItem(storageKey(identity));
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return undefined;
    const hasLegacyRevision = Object.prototype.hasOwnProperty.call(
      value,
      'authorizationRevision',
    );
    const expectedKeys = [
      'action',
      'userId',
      'departmentId',
      'customerId',
      'expectedVersion',
      'body',
      'key',
      ...(hasLegacyRevision ? ['authorizationRevision'] : []),
    ];
    if (
      Object.keys(value).sort().join('|') !== expectedKeys.sort().join('|') ||
      (hasLegacyRevision &&
        (!Number.isSafeInteger(value.authorizationRevision) ||
          Number(value.authorizationRevision) < 0)) ||
      value.action !== identity.action ||
      value.userId !== identity.userId ||
      value.departmentId !== identity.departmentId ||
      value.customerId !== identity.customerId ||
      !Number.isInteger(value.expectedVersion) ||
      Number(value.expectedVersion) < 1 ||
      typeof value.key !== 'string' ||
      value.key.length < 1 ||
      value.key.length > 128 ||
      !validBody(identity.action, value.body, Number(value.expectedVersion))
    ) {
      return undefined;
    }
    return {
      action: identity.action,
      userId: identity.userId,
      departmentId: identity.departmentId,
      customerId: identity.customerId,
      expectedVersion: Number(value.expectedVersion),
      body: value.body,
      key: value.key,
    };
  } catch {
    return undefined;
  }
}

export function savePendingCustomerMaintenance(
  command: PendingCustomerMaintenance,
): void {
  if (!validBody(command.action, command.body, command.expectedVersion)) {
    throw new TypeError('客户维护请求内容无效');
  }
  globalThis.sessionStorage.setItem(
    storageKey(command),
    JSON.stringify(command),
  );
}

export function clearPendingCustomerMaintenance(
  command: PendingCustomerMaintenance,
): void {
  globalThis.sessionStorage.removeItem(storageKey(command));
}

export function listPendingCustomerMaintenance(
  actor: Pick<PendingCustomerMaintenance, 'userId' | 'departmentId'>,
  customerId: string,
): PendingCustomerMaintenance[] {
  const commands: PendingCustomerMaintenance[] = [];
  for (const action of [
    'responsible-transfer',
    'pause',
    'terminate',
    'resume',
  ] as const) {
    const command = readPendingCustomerMaintenance({
      ...actor,
      customerId,
      action,
    });
    if (command) commands.push(command);
  }
  return commands;
}

export function hasPendingCustomerMaintenance(
  actor: Pick<PendingCustomerMaintenance, 'userId' | 'departmentId'>,
  customerId: string,
): boolean {
  return listPendingCustomerMaintenance(actor, customerId).length > 0;
}
