import type { AdmitCustomerInput } from '../../api/customers';
import {
  identityCompatibility,
  identityValidityModeOptions,
  isCustomerTypeCode,
  isIdentityTypeCode,
} from './customer-admission-options';

export type AdmissionIdentity = {
  userId: string;
  departmentId: string;
  customerId: string;
};
export type PendingCustomerAdmission = AdmissionIdentity & {
  body: AdmitCustomerInput;
  key: string;
};

function storageKey(identity: AdmissionIdentity): string {
  return `customer-admission:${identity.userId}:${identity.departmentId}:${identity.customerId}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validBody(value: unknown): value is AdmitCustomerInput {
  if (!record(value)) return false;
  const required = [
    'expectedVersion',
    'customerType',
    'name',
    'identityType',
    'identityNumber',
    'identityValidityMode',
    'admissionContactId',
    'identityDocumentContentVersionIds',
  ];
  const optional = [
    'issuingCountryOrRegion',
    'identityValidFrom',
    'identityValidTo',
  ];
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    ) ||
    !Number.isInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    typeof value.customerType !== 'string' ||
    !isCustomerTypeCode(value.customerType) ||
    typeof value.identityType !== 'string' ||
    !isIdentityTypeCode(value.identityType) ||
    !identityCompatibility[value.customerType].includes(value.identityType) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.identityNumber !== 'string' ||
    !value.identityNumber.trim() ||
    typeof value.admissionContactId !== 'string' ||
    !value.admissionContactId ||
    !identityValidityModeOptions.some(
      (option) => option.value === value.identityValidityMode,
    ) ||
    !Array.isArray(value.identityDocumentContentVersionIds) ||
    value.identityDocumentContentVersionIds.length === 0 ||
    !value.identityDocumentContentVersionIds.every(
      (id: unknown) => typeof id === 'string' && id.length > 0,
    ) ||
    optional.some(
      (key) => value[key] !== undefined && typeof value[key] !== 'string',
    )
  )
    return false;
  return true;
}
function decode(
  value: unknown,
  identity: AdmissionIdentity,
): PendingCustomerAdmission | undefined {
  if (
    !record(value) ||
    Object.keys(value).sort().join('|') !==
      ['userId', 'departmentId', 'customerId', 'body', 'key']
        .sort()
        .join('|') ||
    value.userId !== identity.userId ||
    value.departmentId !== identity.departmentId ||
    value.customerId !== identity.customerId ||
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 128 ||
    !validBody(value.body)
  )
    return undefined;
  return value as PendingCustomerAdmission;
}
export function readPendingCustomerAdmission(
  identity: AdmissionIdentity,
): PendingCustomerAdmission | undefined {
  const raw = globalThis.sessionStorage.getItem(storageKey(identity));
  if (raw === null) return undefined;
  try {
    return decode(JSON.parse(raw), identity);
  } catch {
    return undefined;
  }
}
export function savePendingCustomerAdmission(
  command: PendingCustomerAdmission,
): void {
  if (!decode(command, command)) throw new TypeError('准入请求内容无效');
  globalThis.sessionStorage.setItem(
    storageKey(command),
    JSON.stringify(command),
  );
}
export function clearPendingCustomerAdmission(
  command: PendingCustomerAdmission,
): void {
  globalThis.sessionStorage.removeItem(storageKey(command));
}
