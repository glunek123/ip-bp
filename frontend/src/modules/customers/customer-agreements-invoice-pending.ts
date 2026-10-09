import type {
  CreateCustomerAgreementInput,
  CreateCustomerInvoiceProfileInput,
  ReviseCustomerAgreementInput,
  ReviseCustomerInvoiceProfileInput,
} from '../../api/customer-agreements-invoice';

export type CustomerDocumentKind = 'agreement' | 'invoice';
export type CustomerDocumentCommandBody =
  | CreateCustomerAgreementInput
  | ReviseCustomerAgreementInput
  | CreateCustomerInvoiceProfileInput
  | ReviseCustomerInvoiceProfileInput;

export type PendingCustomerDocumentCommand = {
  userId: string;
  departmentId: string;
  customerId: string;
  kind: CustomerDocumentKind;
  action: 'create' | 'revise';
  body: CustomerDocumentCommandBody;
  key: string;
};

export type PendingCustomerAgreementUpload = {
  userId: string;
  departmentId: string;
  customerId: string;
  kind: 'agreement-upload';
  createdAt: string;
};

export type CustomerDocumentPendingIdentity = Pick<
  PendingCustomerDocumentCommand,
  'userId' | 'departmentId' | 'customerId' | 'kind'
>;

type CustomerAgreementUploadIdentity = Omit<
  CustomerDocumentPendingIdentity,
  'kind'
>;

function commandStorageKey(identity: CustomerDocumentPendingIdentity): string {
  return `customer-agreement-invoice:${identity.userId}:${identity.departmentId}:${identity.customerId}:${identity.kind}`;
}

function uploadStorageKey(identity: CustomerAgreementUploadIdentity): string {
  return `customer-agreement-invoice:${identity.userId}:${identity.departmentId}:${identity.customerId}:agreement-upload`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.every((key) => allowed.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function validNullableText(value: unknown, maxLength: number): boolean {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.trim() === value &&
      value.length <= maxLength)
  );
}

function validAgreementBody(
  body: unknown,
  action: PendingCustomerDocumentCommand['action'],
): body is CreateCustomerAgreementInput | ReviseCustomerAgreementInput {
  if (!isRecord(body)) return false;
  const required =
    action === 'create'
      ? ['expectedCustomerVersion', 'title', 'validityMode']
      : ['expectedCustomerVersion', 'expectedAgreementVersion'];
  const allowed = [
    ...required,
    'title',
    'model',
    'settlementMethod',
    'validityMode',
    'effectiveFrom',
    'effectiveTo',
    'contentVersionIds',
  ];
  return (
    hasExactKeys(body, allowed, required) &&
    validVersion(body.expectedCustomerVersion) &&
    (action === 'create' || validVersion(body.expectedAgreementVersion)) &&
    (body.title === undefined ||
      (typeof body.title === 'string' &&
        body.title.trim() === body.title &&
        body.title.length > 0 &&
        body.title.length <= 200)) &&
    (action !== 'create' ||
      (typeof body.title === 'string' &&
        body.title.length > 0 &&
        typeof body.validityMode === 'string')) &&
    (body.model === undefined || validNullableText(body.model, 100)) &&
    (body.settlementMethod === undefined ||
      validNullableText(body.settlementMethod, 200)) &&
    (body.validityMode === undefined ||
      body.validityMode === 'FIXED' ||
      body.validityMode === 'LONG_TERM' ||
      body.validityMode === 'UNKNOWN') &&
    (body.effectiveFrom === undefined ||
      body.effectiveFrom === null ||
      (typeof body.effectiveFrom === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/u.test(body.effectiveFrom))) &&
    (body.effectiveTo === undefined ||
      body.effectiveTo === null ||
      (typeof body.effectiveTo === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/u.test(body.effectiveTo))) &&
    (body.contentVersionIds === undefined ||
      (Array.isArray(body.contentVersionIds) &&
        body.contentVersionIds.length <= 10 &&
        body.contentVersionIds.every((id) => typeof id === 'string') &&
        new Set(body.contentVersionIds).size === body.contentVersionIds.length))
  );
}

function validInvoiceBody(
  body: unknown,
  action: PendingCustomerDocumentCommand['action'],
): body is
  CreateCustomerInvoiceProfileInput | ReviseCustomerInvoiceProfileInput {
  if (!isRecord(body)) return false;
  const required =
    action === 'create'
      ? ['expectedCustomerVersion']
      : ['expectedCustomerVersion', 'expectedInvoiceVersion'];
  const allowed = [
    ...required,
    'invoiceType',
    'invoiceSubject',
    'taxNo',
    'bank',
  ];
  return (
    hasExactKeys(body, allowed, required) &&
    validVersion(body.expectedCustomerVersion) &&
    (action === 'create' || validVersion(body.expectedInvoiceVersion)) &&
    (body.invoiceType === undefined ||
      validNullableText(body.invoiceType, 100)) &&
    (body.invoiceSubject === undefined ||
      validNullableText(body.invoiceSubject, 200)) &&
    (body.taxNo === undefined || validNullableText(body.taxNo, 100)) &&
    (body.bank === undefined || validNullableText(body.bank, 500))
  );
}

function validCommandBody(
  command: Pick<PendingCustomerDocumentCommand, 'kind' | 'action' | 'body'>,
): boolean {
  return command.kind === 'agreement'
    ? validAgreementBody(command.body, command.action)
    : validInvoiceBody(command.body, command.action);
}

function decodePendingCommand(
  value: unknown,
  identity: CustomerDocumentPendingIdentity,
): PendingCustomerDocumentCommand | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ['userId', 'departmentId', 'customerId', 'kind', 'action', 'body', 'key'],
      ['userId', 'departmentId', 'customerId', 'kind', 'action', 'body', 'key'],
    ) ||
    value.userId !== identity.userId ||
    value.departmentId !== identity.departmentId ||
    value.customerId !== identity.customerId ||
    value.kind !== identity.kind ||
    (value.action !== 'create' && value.action !== 'revise') ||
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 200
  ) {
    return undefined;
  }
  const command = value as unknown as PendingCustomerDocumentCommand;
  return validCommandBody(command) ? command : undefined;
}

export function readPendingCustomerDocumentCommand(
  identity: CustomerDocumentPendingIdentity,
): PendingCustomerDocumentCommand | undefined {
  try {
    const raw = globalThis.sessionStorage.getItem(commandStorageKey(identity));
    if (raw === null) return undefined;
    return decodePendingCommand(JSON.parse(raw), identity);
  } catch {
    return undefined;
  }
}

export function savePendingCustomerDocumentCommand(
  command: PendingCustomerDocumentCommand,
): void {
  if (
    !command.userId ||
    !command.departmentId ||
    !command.customerId ||
    !validCommandBody(command) ||
    command.key.length < 1 ||
    command.key.length > 200
  ) {
    throw new TypeError('协议或开票维护请求无效');
  }
  globalThis.sessionStorage.setItem(
    commandStorageKey(command),
    JSON.stringify(command),
  );
}

export function clearPendingCustomerDocumentCommand(
  command: CustomerDocumentPendingIdentity,
): void {
  globalThis.sessionStorage.removeItem(commandStorageKey(command));
}

export function readPendingCustomerAgreementUpload(
  identity: CustomerAgreementUploadIdentity,
): PendingCustomerAgreementUpload | undefined {
  try {
    const raw = globalThis.sessionStorage.getItem(uploadStorageKey(identity));
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      !hasExactKeys(
        value,
        ['userId', 'departmentId', 'customerId', 'kind', 'createdAt'],
        ['userId', 'departmentId', 'customerId', 'kind', 'createdAt'],
      ) ||
      value.userId !== identity.userId ||
      value.departmentId !== identity.departmentId ||
      value.customerId !== identity.customerId ||
      value.kind !== 'agreement-upload' ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt))
    ) {
      return undefined;
    }
    return value as unknown as PendingCustomerAgreementUpload;
  } catch {
    return undefined;
  }
}

export function savePendingCustomerAgreementUpload(
  marker: PendingCustomerAgreementUpload,
): void {
  if (
    marker.kind !== 'agreement-upload' ||
    !marker.userId ||
    !marker.departmentId ||
    !marker.customerId ||
    !Number.isFinite(Date.parse(marker.createdAt))
  ) {
    throw new TypeError('协议上传恢复标记无效');
  }
  globalThis.sessionStorage.setItem(
    uploadStorageKey(marker),
    JSON.stringify(marker),
  );
}

export function clearPendingCustomerAgreementUpload(
  identity: CustomerAgreementUploadIdentity,
): void {
  const key = uploadStorageKey(identity);
  try {
    globalThis.sessionStorage.removeItem(key);
    unclearedAgreementUploads.delete(key);
  } catch (error) {
    unclearedAgreementUploads.add(key);
    throw error;
  }
}

type ActiveAgreementUpload = {
  finished: Promise<void>;
  finish: () => void;
};
const activeAgreementUploads = new Map<string, ActiveAgreementUpload>();
const unclearedAgreementUploads = new Set<string>();

export function hasUnclearedCustomerAgreementUpload(
  identity: CustomerAgreementUploadIdentity,
): boolean {
  return unclearedAgreementUploads.has(uploadStorageKey(identity));
}

export function beginCustomerAgreementUpload(
  identity: CustomerAgreementUploadIdentity,
): ActiveAgreementUpload {
  const key = uploadStorageKey(identity);
  if (activeAgreementUploads.has(key)) throw new Error('协议上传仍在进行');
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const active: ActiveAgreementUpload = {
    finished,
    finish: () => {
      if (activeAgreementUploads.get(key) === active)
        activeAgreementUploads.delete(key);
      resolveFinished();
    },
  };
  activeAgreementUploads.set(key, active);
  return active;
}

export function currentCustomerAgreementUpload(
  identity: CustomerAgreementUploadIdentity,
): Promise<void> | undefined {
  return activeAgreementUploads.get(uploadStorageKey(identity))?.finished;
}

export function hasPendingCustomerAgreementInvoice(
  actor: Pick<PendingCustomerDocumentCommand, 'userId' | 'departmentId'>,
  customerId: string,
): boolean {
  if (unclearedAgreementUploads.has(uploadStorageKey({ ...actor, customerId })))
    return true;
  try {
    return (
      globalThis.sessionStorage.getItem(
        commandStorageKey({
          userId: actor.userId,
          departmentId: actor.departmentId,
          customerId,
          kind: 'agreement',
        }),
      ) !== null ||
      globalThis.sessionStorage.getItem(
        commandStorageKey({
          userId: actor.userId,
          departmentId: actor.departmentId,
          customerId,
          kind: 'invoice',
        }),
      ) !== null ||
      globalThis.sessionStorage.getItem(
        uploadStorageKey({
          userId: actor.userId,
          departmentId: actor.departmentId,
          customerId,
        }),
      ) !== null
    );
  } catch {
    return true;
  }
}
