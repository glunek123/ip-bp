import {
  ApiError,
  getJson,
  requestJson,
  type JsonValue,
  type RequestOptions,
} from './http';
import type {
  CustomerTypeCode,
  IdentityTypeCode,
  IdentityValidityModeCode,
} from '../modules/customers/customer-admission-options';

export type CustomerSummary = {
  id: string;
  name: string;
  customerType: string | null;
  identityType: string | null;
  identityNumber: string | null;
  issuingCountryOrRegion: string | null;
  identityValidFrom: string | null;
  identityValidTo: string | null;
  identityValidityMode: IdentityValidityModeCode | null;
  admittedAt: string | null;
  category: string | null;
  region: string | null;
  admissionContactName: string | null;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
  profileStatus: 'draft' | 'admitted';
  cooperationStatus: 'COOPERATING' | 'PAUSED' | 'TERMINATED';
  departmentId: string;
  responsibleUserId: string;
  version: number;
  updatedAt: string;
};

export type CustomerHistoryEvent = {
  action: string;
  actorUserId: string;
  occurredAt: string;
};

export type CustomerDetail = CustomerSummary & {
  primaryContactId: string | null;
  admissionContactSnapshot: {
    name: string;
    phone: string | null;
    email: string | null;
    source: 'RECEIPT' | 'FALLBACK_CURRENT' | 'NEW_ADMISSION';
    frozenAt: string;
  } | null;
  capabilities: {
    editRoutine: boolean;
    admit: boolean;
    deleteDraft?: boolean;
    agreement: { read: boolean; edit: boolean };
    invoice: { read: boolean; edit: boolean };
  };
  responsibleOperator: { id: string; displayName: string };
  cooperationCapabilities: {
    transfer: boolean;
    pause: boolean;
    terminate: boolean;
    resume: boolean;
  };
  history: CustomerHistoryEvent[];
};

export type DeletedCustomerDraft = CustomerSummary & {
  deletedAt: string;
  deletedByUserId: string;
  deletionReason: string | null;
  capabilities: { restoreDraft: true };
};

export type CustomerDraftLifecycleInput = {
  expectedVersion: number;
  reason?: string;
};

export type CustomerDraftInput = {
  expectedVersion: number;
  name?: string;
  customerType?: string;
  identityType?: string;
  identityNumber?: string;
  issuingCountryOrRegion?: string;
  category?: string;
  region?: string;
  admissionContactName?: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
  duplicateNameReason?: string;
};

export type AdmitCustomerInput = {
  expectedVersion: number;
  customerType: CustomerTypeCode;
  name: string;
  identityType: IdentityTypeCode;
  identityNumber: string;
  issuingCountryOrRegion?: string;
  identityValidFrom?: string;
  identityValidTo?: string;
  identityValidityMode: IdentityValidityModeCode;
  admissionContactId: string;
  identityDocumentContentVersionIds: string[];
};

export type CustomerContact = {
  id: string;
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  duty: string | null;
  isPrimary: boolean;
  endedAt: string | null;
  endReason: string | null;
  version: number;
  origin: 'LEGACY_BACKFILL' | 'LEGACY_CREATE' | 'ADMISSION_FREEFORM' | 'MANUAL';
  createdAt: string;
  updatedAt: string;
};
export type ContactVersionSnapshot = {
  name: string;
  phone: string | null;
  email: string | null;
  duty: string | null;
  isPrimary: boolean;
  endedAt: string | null;
  endReason: string | null;
};
export type CustomerContactVersion = {
  id: string;
  contactId: string;
  version: number;
  action: 'CREATED' | 'UPDATED' | 'PRIMARY_SET' | 'PRIMARY_UNSET' | 'ENDED';
  before: ContactVersionSnapshot | null;
  after: ContactVersionSnapshot;
  actor:
    | { kind: 'HUMAN'; userId: string }
    | { kind: 'LEGACY_MIGRATION'; userId: null };
  occurredAt: string;
};
export type CustomerContactPage = {
  items: CustomerContact[];
  total: number;
  page: number;
  pageSize: number;
  primaryContactId: string | null;
};
export type CustomerContactVersionPage = {
  items: CustomerContactVersion[];
  total: number;
  page: number;
  pageSize: number;
};
export type CustomerContactCommandResult = {
  contact: CustomerContact;
  customerVersion: number;
  primaryContactId: string | null;
};
export type ContactCommandBody = JsonValue;

export type CustomerDuplicateSummary = Pick<
  CustomerSummary,
  'id' | 'name' | 'category' | 'region'
>;

export type CustomerList = {
  items: CustomerSummary[];
  total: number;
  page: number;
  pageSize: number;
  capabilities: { createDraft: boolean };
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const contactOrigins = [
  'LEGACY_BACKFILL',
  'LEGACY_CREATE',
  'ADMISSION_FREEFORM',
  'MANUAL',
] as const;
const contactActions = [
  'CREATED',
  'UPDATED',
  'PRIMARY_SET',
  'PRIMARY_UNSET',
  'ENDED',
] as const;
const snapshotKeys = [
  'name',
  'phone',
  'email',
  'duty',
  'isPrimary',
  'endedAt',
  'endReason',
] as const;
function isContactSummary(value: unknown): value is CustomerContact {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'customerId',
      'name',
      'phone',
      'email',
      'duty',
      'isPrimary',
      'endedAt',
      'endReason',
      'version',
      'origin',
      'createdAt',
      'updatedAt',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.phone) &&
    isNullableString(value.email) &&
    isNullableString(value.duty) &&
    typeof value.isPrimary === 'boolean' &&
    isNullableString(value.endedAt) &&
    isNullableString(value.endReason) &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    (contactOrigins as readonly unknown[]).includes(value.origin) &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
  );
}
function isContactSnapshot(value: unknown): value is ContactVersionSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, snapshotKeys) &&
    typeof value.name === 'string' &&
    isNullableString(value.phone) &&
    isNullableString(value.email) &&
    isNullableString(value.duty) &&
    typeof value.isPrimary === 'boolean' &&
    isNullableString(value.endedAt) &&
    isNullableString(value.endReason)
  );
}
function isContactVersion(value: unknown): value is CustomerContactVersion {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'contactId',
      'version',
      'action',
      'before',
      'after',
      'actor',
      'occurredAt',
    ]) ||
    typeof value.id !== 'string' ||
    typeof value.contactId !== 'string' ||
    !Number.isInteger(value.version) ||
    Number(value.version) < 1 ||
    !(contactActions as readonly unknown[]).includes(value.action) ||
    !(value.before === null || isContactSnapshot(value.before)) ||
    !isContactSnapshot(value.after) ||
    typeof value.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(value.occurredAt)) ||
    !isRecord(value.actor) ||
    !hasExactKeys(value.actor, ['kind', 'userId'])
  )
    return false;
  return (
    (value.actor.kind === 'HUMAN' && typeof value.actor.userId === 'string') ||
    (value.actor.kind === 'LEGACY_MIGRATION' && value.actor.userId === null)
  );
}
function isContactPage(value: unknown): value is CustomerContactPage {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'items',
      'total',
      'page',
      'pageSize',
      'primaryContactId',
    ]) &&
    Array.isArray(value.items) &&
    value.items.every(isContactSummary) &&
    Number.isInteger(value.total) &&
    Number(value.total) >= 0 &&
    Number.isInteger(value.page) &&
    Number(value.page) >= 1 &&
    Number.isInteger(value.pageSize) &&
    Number(value.pageSize) >= 1 &&
    Number(value.pageSize) <= 100 &&
    (typeof value.primaryContactId === 'string' ||
      value.primaryContactId === null)
  );
}
function isContactVersionPage(
  value: unknown,
): value is CustomerContactVersionPage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['items', 'total', 'page', 'pageSize']) &&
    Array.isArray(value.items) &&
    value.items.every(isContactVersion) &&
    Number.isInteger(value.total) &&
    Number(value.total) >= 0 &&
    Number.isInteger(value.page) &&
    Number(value.page) >= 1 &&
    Number.isInteger(value.pageSize) &&
    Number(value.pageSize) >= 1 &&
    Number(value.pageSize) <= 100
  );
}
function isContactCommandResult(
  value: unknown,
  customerId: string,
): value is CustomerContactCommandResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['contact', 'customerVersion', 'primaryContactId']) &&
    isContactSummary(value.contact) &&
    value.contact.customerId === customerId &&
    Number.isInteger(value.customerVersion) &&
    Number(value.customerVersion) >= 1 &&
    (typeof value.primaryContactId === 'string' ||
      value.primaryContactId === null)
  );
}

function isIdentityValidityMode(
  value: unknown,
): value is IdentityValidityModeCode | null {
  return (
    value === null ||
    value === 'FIXED' ||
    value === 'LONG_TERM' ||
    value === 'NOT_STATED'
  );
}

function isCooperationStatus(
  value: unknown,
): value is CustomerSummary['cooperationStatus'] {
  return (
    value === 'COOPERATING' || value === 'PAUSED' || value === 'TERMINATED'
  );
}

function isCustomerSummary(value: unknown): value is CustomerSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.customerType) &&
    isNullableString(value.identityType) &&
    isNullableString(value.identityNumber) &&
    isNullableString(value.issuingCountryOrRegion) &&
    isNullableString(value.identityValidFrom) &&
    isNullableString(value.identityValidTo) &&
    isIdentityValidityMode(value.identityValidityMode) &&
    isNullableString(value.admittedAt) &&
    isNullableString(value.category) &&
    isNullableString(value.region) &&
    isNullableString(value.admissionContactName) &&
    isNullableString(value.admissionContactPhone) &&
    isNullableString(value.admissionContactEmail) &&
    (value.profileStatus === 'draft' || value.profileStatus === 'admitted') &&
    isCooperationStatus(value.cooperationStatus) &&
    typeof value.departmentId === 'string' &&
    typeof value.responsibleUserId === 'string' &&
    Number.isInteger(value.version) &&
    typeof value.updatedAt === 'string'
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户数据', 200, 'INVALID_RESPONSE');
}

export async function listCustomers(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerList> {
  const data = await getJson(
    `/customers?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isCustomerSummary) ||
    !Number.isInteger(data.total) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.pageSize) ||
    !isRecord(data.capabilities) ||
    typeof data.capabilities.createDraft !== 'boolean'
  ) {
    throw invalidResponse();
  }
  return {
    items: data.items,
    total: data.total as number,
    page: data.page as number,
    pageSize: data.pageSize as number,
    capabilities: { createDraft: data.capabilities.createDraft },
  };
}

export async function getCustomer(
  id: string,
  options: RequestOptions = {},
): Promise<CustomerDetail> {
  const data = await getJson(`/customers/${encodeURIComponent(id)}`, options);
  if (!isRecord(data)) {
    throw invalidResponse();
  }
  const history = data.history;
  const primaryContactId = data.primaryContactId;
  const admissionContactSnapshotValue = data.admissionContactSnapshot;
  const capabilities = data.capabilities;
  const responsibleOperator = data.responsibleOperator;
  const cooperationCapabilities = data.cooperationCapabilities;
  if (
    !isCustomerSummary(data) ||
    !(typeof primaryContactId === 'string' || primaryContactId === null) ||
    !(
      admissionContactSnapshotValue === null ||
      (isRecord(admissionContactSnapshotValue) &&
        hasExactKeys(admissionContactSnapshotValue, [
          'name',
          'phone',
          'email',
          'source',
          'frozenAt',
        ]) &&
        typeof admissionContactSnapshotValue.name === 'string' &&
        isNullableString(admissionContactSnapshotValue.phone) &&
        isNullableString(admissionContactSnapshotValue.email) &&
        ['RECEIPT', 'FALLBACK_CURRENT', 'NEW_ADMISSION'].includes(
          String(admissionContactSnapshotValue.source),
        ) &&
        typeof admissionContactSnapshotValue.frozenAt === 'string' &&
        Number.isFinite(Date.parse(admissionContactSnapshotValue.frozenAt)))
    ) ||
    !Array.isArray(history) ||
    !isRecord(capabilities) ||
    !isRecord(capabilities.agreement) ||
    !hasExactKeys(capabilities.agreement, ['read', 'edit']) ||
    typeof capabilities.agreement.read !== 'boolean' ||
    typeof capabilities.agreement.edit !== 'boolean' ||
    !isRecord(capabilities.invoice) ||
    !hasExactKeys(capabilities.invoice, ['read', 'edit']) ||
    typeof capabilities.invoice.read !== 'boolean' ||
    typeof capabilities.invoice.edit !== 'boolean' ||
    !isRecord(responsibleOperator) ||
    !hasExactKeys(responsibleOperator, ['id', 'displayName']) ||
    typeof responsibleOperator.id !== 'string' ||
    typeof responsibleOperator.displayName !== 'string' ||
    !isRecord(cooperationCapabilities) ||
    !hasExactKeys(cooperationCapabilities, [
      'transfer',
      'pause',
      'terminate',
      'resume',
    ]) ||
    typeof cooperationCapabilities.transfer !== 'boolean' ||
    typeof cooperationCapabilities.pause !== 'boolean' ||
    typeof cooperationCapabilities.terminate !== 'boolean' ||
    typeof cooperationCapabilities.resume !== 'boolean' ||
    typeof capabilities.editRoutine !== 'boolean' ||
    typeof capabilities.admit !== 'boolean' ||
    (capabilities.deleteDraft !== undefined &&
      typeof capabilities.deleteDraft !== 'boolean') ||
    !history.every(
      (event: unknown) =>
        isRecord(event) &&
        typeof event.action === 'string' &&
        typeof event.actorUserId === 'string' &&
        typeof event.occurredAt === 'string',
    )
  ) {
    throw invalidResponse();
  }
  return {
    ...data,
    primaryContactId,
    admissionContactSnapshot:
      admissionContactSnapshotValue as CustomerDetail['admissionContactSnapshot'],
    capabilities: {
      editRoutine: capabilities.editRoutine,
      admit: capabilities.admit,
      deleteDraft: capabilities.deleteDraft === true,
      agreement: {
        read: capabilities.agreement.read,
        edit: capabilities.agreement.edit,
      },
      invoice: {
        read: capabilities.invoice.read,
        edit: capabilities.invoice.edit,
      },
    },
    responsibleOperator: {
      id: responsibleOperator.id,
      displayName: responsibleOperator.displayName,
    },
    cooperationCapabilities: {
      transfer: cooperationCapabilities.transfer,
      pause: cooperationCapabilities.pause,
      terminate: cooperationCapabilities.terminate,
      resume: cooperationCapabilities.resume,
    },
    history: history as CustomerHistoryEvent[],
  };
}

export async function listDeletedCustomerDrafts(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<{
  items: DeletedCustomerDraft[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const data = await getJson(
    `/customers/deleted-drafts?page=${page}&pageSize=${pageSize}`,
    options,
  );
  const valid = (value: unknown): value is DeletedCustomerDraft => {
    if (!isRecord(value)) return false;
    const extra: Record<string, unknown> = value;
    return (
      isCustomerSummary(value) &&
      typeof extra.deletedAt === 'string' &&
      typeof extra.deletedByUserId === 'string' &&
      isNullableString(extra.deletionReason) &&
      isRecord(extra.capabilities) &&
      extra.capabilities.restoreDraft === true
    );
  };
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(valid) ||
    !Number.isInteger(data.total) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.pageSize)
  )
    throw invalidResponse();
  return data as {
    items: DeletedCustomerDraft[];
    total: number;
    page: number;
    pageSize: number;
  };
}

async function lifecycleCommand(
  id: string,
  action: 'delete-draft' | 'restore-draft',
  input: CustomerDraftLifecycleInput,
  idempotencyKey: string,
): Promise<CustomerSummary> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    },
  );
  if (
    !isCustomerSummary(data) ||
    data.id !== id ||
    data.version !== input.expectedVersion + 1 ||
    data.profileStatus !== 'draft'
  )
    throw invalidResponse();
  return data;
}

export function deleteCustomerDraft(
  id: string,
  input: CustomerDraftLifecycleInput,
  idempotencyKey: string,
) {
  return lifecycleCommand(id, 'delete-draft', input, idempotencyKey);
}

export function restoreCustomerDraft(
  id: string,
  input: CustomerDraftLifecycleInput,
  idempotencyKey: string,
) {
  return lifecycleCommand(id, 'restore-draft', input, idempotencyKey);
}

export async function createCustomerDraft(input: {
  name: string;
  category?: string;
  region?: string;
  admissionContactName?: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
  duplicateNameReason?: string;
}): Promise<CustomerSummary> {
  const data = await requestJson('/customers', {
    method: 'POST',
    body: input,
  });
  if (!isCustomerSummary(data)) {
    throw invalidResponse();
  }
  return data;
}

export async function updateCustomerDraft(
  id: string,
  input: CustomerDraftInput,
): Promise<CustomerSummary> {
  const data = await requestJson(`/customers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
  if (!isCustomerSummary(data)) throw invalidResponse();
  return data;
}

export async function admitCustomer(
  id: string,
  input: AdmitCustomerInput,
  idempotencyKey: string,
): Promise<CustomerSummary> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(id)}/admission`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    },
  );
  if (
    !isCustomerSummary(data) ||
    data.id !== id ||
    data.profileStatus !== 'admitted' ||
    data.admittedAt === null ||
    data.customerType !== input.customerType ||
    data.identityType !== input.identityType ||
    data.identityNumber === null ||
    data.identityValidityMode !== input.identityValidityMode ||
    data.admissionContactName === null ||
    (data.admissionContactPhone === null && data.admissionContactEmail === null)
  ) {
    throw invalidResponse();
  }
  return data;
}

export async function listCustomerContacts(
  id: string,
  status: 'ACTIVE' | 'ENDED' = 'ACTIVE',
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerContactPage> {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new RangeError('联系人分页参数无效');
  const data = await getJson(
    `/customers/${encodeURIComponent(id)}/contacts?status=${status}&page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (!isContactPage(data) || data.page !== page || data.pageSize !== pageSize)
    throw invalidResponse();
  return data;
}

export async function listCustomerContactVersions(
  id: string,
  contactId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerContactVersionPage> {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new RangeError('联系人历史分页参数无效');
  const data = await getJson(
    `/customers/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}/versions?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !isContactVersionPage(data) ||
    data.page !== page ||
    data.pageSize !== pageSize ||
    data.items.some((item) => item.contactId !== contactId)
  )
    throw invalidResponse();
  return data;
}

async function customerContactCommand(
  customerId: string,
  path: string,
  method: 'POST' | 'PATCH',
  body: JsonValue,
  key: string,
): Promise<CustomerContactCommandResult> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(customerId)}/contacts${path}`,
    {
      method,
      headers: { 'Idempotency-Key': key },
      body,
    },
  );
  if (!isContactCommandResult(data, customerId)) throw invalidResponse();
  return data;
}
export function createCustomerContact(
  id: string,
  body: ContactCommandBody,
  key: string,
) {
  return customerContactCommand(id, '', 'POST', body, key);
}
export function updateCustomerContact(
  id: string,
  contactId: string,
  body: ContactCommandBody,
  key: string,
) {
  return customerContactCommand(
    id,
    `/${encodeURIComponent(contactId)}`,
    'PATCH',
    body,
    key,
  );
}
export function setCustomerContactPrimary(
  id: string,
  contactId: string,
  body: ContactCommandBody,
  key: string,
) {
  return customerContactCommand(
    id,
    `/${encodeURIComponent(contactId)}/primary`,
    'POST',
    body,
    key,
  );
}
export function endCustomerContact(
  id: string,
  contactId: string,
  body: ContactCommandBody,
  key: string,
) {
  return customerContactCommand(
    id,
    `/${encodeURIComponent(contactId)}/end`,
    'POST',
    body,
    key,
  );
}

export async function findCustomerDuplicates(
  query: {
    name?: string;
    identityType?: string;
    identityNumber?: string;
    excludeCustomerId?: string;
  },
  options: RequestOptions = {},
): Promise<{
  exactIdentity: CustomerDuplicateSummary[];
  sameName: CustomerDuplicateSummary[];
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const data = await getJson(`/customers/duplicates?${params}`, options);
  const validSummary = (value: unknown): value is CustomerDuplicateSummary =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.category) &&
    isNullableString(value.region);
  if (
    !isRecord(data) ||
    !Array.isArray(data.exactIdentity) ||
    !data.exactIdentity.every(validSummary) ||
    !Array.isArray(data.sameName) ||
    !data.sameName.every(validSummary)
  ) {
    throw invalidResponse();
  }
  return {
    exactIdentity: data.exactIdentity,
    sameName: data.sameName,
  };
}
