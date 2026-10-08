export type PendingCustomerDraftCommand = {
  action: 'delete-draft' | 'restore-draft';
  userId: string;
  departmentId: string;
  customerId: string;
  expectedVersion: number;
  reason?: string;
  key: string;
};

function storageKey(
  command: Pick<
    PendingCustomerDraftCommand,
    'action' | 'userId' | 'departmentId' | 'customerId'
  >,
): string {
  return `customer-draft-command:${command.userId}:${command.departmentId}:${command.customerId}:${command.action}`;
}

export function readPendingCustomerDraftCommand(
  identity: Pick<
    PendingCustomerDraftCommand,
    'action' | 'userId' | 'departmentId' | 'customerId'
  >,
): PendingCustomerDraftCommand | undefined {
  const raw = globalThis.sessionStorage.getItem(storageKey(identity));
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return undefined;
    const record = value as Record<string, unknown>;
    const expectedKeys = [
      'action',
      'userId',
      'departmentId',
      'customerId',
      'expectedVersion',
      'key',
      ...(record.reason === undefined ? [] : ['reason']),
    ].sort();
    if (
      Object.keys(record).sort().join('|') !== expectedKeys.join('|') ||
      record.action !== identity.action ||
      record.userId !== identity.userId ||
      record.departmentId !== identity.departmentId ||
      record.customerId !== identity.customerId ||
      !Number.isInteger(record.expectedVersion) ||
      Number(record.expectedVersion) < 1 ||
      typeof record.key !== 'string' ||
      record.key.length < 1 ||
      record.key.length > 128 ||
      (record.reason !== undefined &&
        (typeof record.reason !== 'string' ||
          record.reason.trim() !== record.reason ||
          record.reason.length < 1 ||
          record.reason.length > 500))
    )
      return undefined;
    return value as PendingCustomerDraftCommand;
  } catch {
    return undefined;
  }
}

export function savePendingCustomerDraftCommand(
  command: PendingCustomerDraftCommand,
): void {
  globalThis.sessionStorage.setItem(
    storageKey(command),
    JSON.stringify(command),
  );
}

export function clearPendingCustomerDraftCommand(
  command: PendingCustomerDraftCommand,
): void {
  globalThis.sessionStorage.removeItem(storageKey(command));
}

export function listPendingCustomerDraftCommands(
  actor: Pick<PendingCustomerDraftCommand, 'userId' | 'departmentId'>,
  action: PendingCustomerDraftCommand['action'],
): PendingCustomerDraftCommand[] {
  const prefix = `customer-draft-command:${actor.userId}:${actor.departmentId}:`;
  const commands: PendingCustomerDraftCommand[] = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    const key = globalThis.sessionStorage.key(index);
    if (!key?.startsWith(prefix) || !key.endsWith(`:${action}`)) continue;
    const customerId = key.slice(prefix.length, -action.length - 1);
    const command = readPendingCustomerDraftCommand({
      ...actor,
      action,
      customerId,
    });
    if (command) commands.push(command);
  }
  return commands;
}
