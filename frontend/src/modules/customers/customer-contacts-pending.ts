export type ContactAction = 'create' | 'update' | 'primary' | 'end';
export type PendingCustomerContact = {
  action: ContactAction;
  userId: string;
  departmentId: string;
  customerId: string;
  contactId: string | null;
  expectedCustomerVersion: number;
  expectedContactVersion: number | null;
  body: Record<string, unknown>;
  key: string;
};
type Identity = Pick<
  PendingCustomerContact,
  'action' | 'userId' | 'departmentId' | 'customerId' | 'contactId'
>;
const actions: readonly ContactAction[] = [
  'create',
  'update',
  'primary',
  'end',
];
function storageKey(value: Identity): string {
  return `customer-contacts:${value.userId}:${value.departmentId}:${value.customerId}:${value.action}:${value.contactId ?? 'new'}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function validBody(
  value: unknown,
  command: PendingCustomerContact,
): value is Record<string, unknown> {
  if (
    !record(value) ||
    value.expectedCustomerVersion !== command.expectedCustomerVersion
  )
    return false;
  const contactVersion = command.expectedContactVersion;
  if (command.action === 'create') {
    return (
      contactVersion === null &&
      exactKeys(value, [
        'expectedCustomerVersion',
        'name',
        ...(value.phone === undefined ? [] : ['phone']),
        ...(value.email === undefined ? [] : ['email']),
        ...(value.duty === undefined ? [] : ['duty']),
        ...(value.isPrimary === undefined ? [] : ['isPrimary']),
      ]) &&
      typeof value.name === 'string' &&
      value.name.trim() === value.name &&
      value.name.length >= 1 &&
      value.name.length <= 100 &&
      (typeof value.phone === 'string' || typeof value.email === 'string') &&
      (value.phone === undefined ||
        (typeof value.phone === 'string' &&
          value.phone.length <= 30 &&
          /^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u.test(value.phone))) &&
      (value.email === undefined ||
        (typeof value.email === 'string' &&
          value.email.length <= 254 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email))) &&
      (value.duty === undefined ||
        (typeof value.duty === 'string' &&
          value.duty.trim() === value.duty &&
          value.duty.length > 0 &&
          value.duty.length <= 500)) &&
      (value.isPrimary === undefined || typeof value.isPrimary === 'boolean')
    );
  }
  if (
    typeof command.contactId !== 'string' ||
    !Number.isInteger(contactVersion) ||
    value.expectedContactVersion !== contactVersion
  )
    return false;
  if (command.action === 'update') {
    return (
      exactKeys(value, [
        'expectedCustomerVersion',
        'expectedContactVersion',
        ...(value.name === undefined ? [] : ['name']),
        ...(value.phone === undefined ? [] : ['phone']),
        ...(value.email === undefined ? [] : ['email']),
        ...(value.duty === undefined ? [] : ['duty']),
      ]) &&
      ['name', 'phone', 'email', 'duty'].some(
        (key) => value[key] !== undefined,
      ) &&
      (value.name === undefined || typeof value.name === 'string') &&
      ['phone', 'email', 'duty'].every(
        (key) =>
          value[key] === undefined ||
          value[key] === null ||
          typeof value[key] === 'string',
      )
    );
  }
  if (command.action === 'primary')
    return (
      exactKeys(value, [
        'expectedCustomerVersion',
        'expectedContactVersion',
        'primary',
      ]) && typeof value.primary === 'boolean'
    );
  return (
    exactKeys(value, [
      'expectedCustomerVersion',
      'expectedContactVersion',
      ...(value.reason === undefined ? [] : ['reason']),
    ]) &&
    (value.reason === undefined ||
      (typeof value.reason === 'string' &&
        value.reason.trim() === value.reason &&
        value.reason.length >= 1 &&
        value.reason.length <= 500))
  );
}
function decode(
  value: unknown,
  identity: Identity,
): PendingCustomerContact | undefined {
  if (
    !record(value) ||
    !exactKeys(value, [
      'action',
      'userId',
      'departmentId',
      'customerId',
      'contactId',
      'expectedCustomerVersion',
      'expectedContactVersion',
      'body',
      'key',
    ]) ||
    value.action !== identity.action ||
    value.userId !== identity.userId ||
    value.departmentId !== identity.departmentId ||
    value.customerId !== identity.customerId ||
    value.contactId !== identity.contactId ||
    !(value.contactId === null || typeof value.contactId === 'string') ||
    !Number.isInteger(value.expectedCustomerVersion) ||
    Number(value.expectedCustomerVersion) < 1 ||
    !(
      value.expectedContactVersion === null ||
      (Number.isInteger(value.expectedContactVersion) &&
        Number(value.expectedContactVersion) >= 1)
    ) ||
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 128
  )
    return undefined;
  const command = value as PendingCustomerContact;
  return validBody(value.body, command) ? command : undefined;
}
export function readPendingCustomerContact(
  identity: Identity,
): PendingCustomerContact | undefined {
  const raw = globalThis.sessionStorage.getItem(storageKey(identity));
  if (raw === null) return undefined;
  try {
    return decode(JSON.parse(raw), identity);
  } catch {
    return undefined;
  }
}
export function savePendingCustomerContact(
  command: PendingCustomerContact,
): void {
  if (!validBody(command.body, command))
    throw new TypeError('联系人请求内容无效');
  globalThis.sessionStorage.setItem(
    storageKey(command),
    JSON.stringify(command),
  );
}
export function clearPendingCustomerContact(
  command: PendingCustomerContact,
): void {
  globalThis.sessionStorage.removeItem(storageKey(command));
}
export function listPendingCustomerContacts(
  actor: Pick<PendingCustomerContact, 'userId' | 'departmentId'>,
  customerId: string,
): PendingCustomerContact[] {
  const prefix = `customer-contacts:${actor.userId}:${actor.departmentId}:${customerId}:`;
  const found: PendingCustomerContact[] = [];
  for (let i = 0; i < globalThis.sessionStorage.length; i += 1) {
    const key = globalThis.sessionStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    for (const action of actions) {
      const suffix = `${action}:`;
      const at = key.indexOf(suffix, prefix.length);
      if (at < 0) continue;
      const contactId = key.slice(at + suffix.length);
      const identity: Identity = {
        ...actor,
        customerId,
        action,
        contactId: contactId === 'new' ? null : contactId,
      };
      const command = readPendingCustomerContact(identity);
      if (command) found.push(command);
      break;
    }
  }
  return found;
}
