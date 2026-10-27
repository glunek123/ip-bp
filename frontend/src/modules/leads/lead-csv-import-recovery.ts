import type {
  CreateLeadInput,
  InfringementType,
  LeadBusinessResult,
  LeadCaseType,
  LeadPlatform,
} from '../../api/leads';

export type LeadCsvImportInput = Omit<
  CreateLeadInput,
  'reservedLeadId' | 'leadScreenshotContentVersionIds'
> & {
  readonly leadScreenshotContentVersionIds: readonly [];
};

export type LeadCsvImportItem = Readonly<{
  rowNumber: number;
  input: LeadCsvImportInput;
  remoteScreenshots?: readonly {
    productNumber: number;
    sourceGroupNumber: number;
    urls: readonly string[];
  }[];
  operatorText?: string;
}>;

export type LeadCsvImportAttempt = Readonly<{
  actorIdentity: string;
  idempotencyKey: string;
  items: readonly LeadCsvImportItem[];
}>;

export type FrozenLeadCsvImport = LeadCsvImportAttempt &
  Readonly<{
    uncertain: boolean;
  }>;

export type LeadCsvImportSubmissionContext = Readonly<{
  contextKey: string;
  authorizationGeneration: string;
  signal: AbortSignal;
}>;

export type LeadCsvImportSubmitOutcome =
  | {
      kind: 'created';
      result: {
        items: Array<{ rowNumber: number; lead: LeadBusinessResult }>;
      };
    }
  | { kind: 'rejected'; message: string }
  | { kind: 'unknown'; message: string };

const storageKey = 'lead-csv-import-pending-v1';
const caseTypes = new Set<LeadCaseType>([
  'CIVIL',
  'CRIMINAL',
  'ADMINISTRATIVE',
  'INVESTIGATION',
  'NOTARIZATION',
  'HEARING_REPRESENTATION',
]);
const infringementTypes = new Set<InfringementType>([
  'TRADEMARK',
  'SOFTWARE_COPYRIGHT',
  'ART_COPYRIGHT',
  'AUDIOVISUAL_COPYRIGHT',
  'TEXT_COPYRIGHT',
  'INVENTION_PATENT',
  'DESIGN_PATENT',
  'UTILITY_MODEL_PATENT',
  'UNFAIR_COMPETITION',
  'NETWORK_DISSEMINATION',
  'PORTRAIT_RIGHT',
  'OTHER',
]);
const onlinePlatforms = new Set<LeadPlatform>([
  'TAOBAO',
  'TMALL',
  'PINDUODUO',
  'JD',
  'DOUYIN',
  'ALIBABA_1688',
  'XIAOHONGSHU',
  'KUAISHOU',
  'XIANYU',
  'WECHAT',
  'OTHER',
]);
const offlinePlatforms = new Set<LeadPlatform>([
  'MEITUAN',
  'DIANPING',
  'MAP',
  'OTHER',
]);

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isStableActorIdentity(value: string): boolean {
  return /^[^:]+:INTERNAL:[^:]+$/u.test(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProduct(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      ['quantity', 'unitPrice', 'commentCount'],
      ['url', 'title'],
    )
  )
    return false;
  if (
    !Number.isSafeInteger(value.quantity) ||
    (value.quantity as number) < 0 ||
    (value.quantity as number) > 2_147_483_647 ||
    !Number.isSafeInteger(value.commentCount) ||
    (value.commentCount as number) < 0 ||
    (value.commentCount as number) > 2_147_483_647 ||
    typeof value.unitPrice !== 'string' ||
    !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(value.unitPrice)
  )
    return false;
  const url = value.url;
  const title = value.title;
  if (url !== undefined && typeof url !== 'string') return false;
  if (title !== undefined && typeof title !== 'string') return false;
  return isNonemptyString(url) || isNonemptyString(title);
}

function isImportInput(value: unknown): value is LeadCsvImportInput {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      [
        'customerId',
        'rightsHolderId',
        'caseType',
        'infringementTypes',
        'source',
        'platform',
        'foundAt',
        'shopName',
        'needDisclose',
        'products',
        'leadScreenshotContentVersionIds',
      ],
      ['shopExternalId', 'remark'],
    )
  )
    return false;
  if (
    !isNonemptyString(value.customerId) ||
    !isNonemptyString(value.rightsHolderId) ||
    typeof value.caseType !== 'string' ||
    !caseTypes.has(value.caseType as LeadCaseType) ||
    !Array.isArray(value.infringementTypes) ||
    value.infringementTypes.length === 0 ||
    !value.infringementTypes.every(
      (type) =>
        typeof type === 'string' &&
        infringementTypes.has(type as InfringementType),
    ) ||
    new Set(value.infringementTypes).size !== value.infringementTypes.length ||
    (value.source !== 'ONLINE' && value.source !== 'OFFLINE') ||
    typeof value.platform !== 'string' ||
    !(value.source === 'ONLINE' ? onlinePlatforms : offlinePlatforms).has(
      value.platform as LeadPlatform,
    ) ||
    typeof value.foundAt !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value.foundAt) ||
    !Number.isFinite(new Date(value.foundAt).getTime()) ||
    !isNonemptyString(value.shopName) ||
    typeof value.needDisclose !== 'boolean' ||
    !Array.isArray(value.products) ||
    value.products.length < 1 ||
    value.products.length > 100 ||
    !value.products.every(isProduct) ||
    !Array.isArray(value.leadScreenshotContentVersionIds) ||
    value.leadScreenshotContentVersionIds.length !== 0
  )
    return false;
  if (
    value.shopExternalId !== undefined &&
    typeof value.shopExternalId !== 'string'
  )
    return false;
  if (value.remark !== undefined && typeof value.remark !== 'string')
    return false;
  return true;
}

function isImportItem(value: unknown): value is LeadCsvImportItem {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      ['rowNumber', 'input'],
      ['remoteScreenshots', 'operatorText'],
    ) &&
    Number.isSafeInteger(value.rowNumber) &&
    (value.rowNumber as number) >= 2 &&
    (value.rowNumber as number) <= 2_097_153 &&
    isImportInput(value.input) &&
    (value.operatorText === undefined ||
      (typeof value.operatorText === 'string' &&
        value.operatorText.trim().length > 0 &&
        value.operatorText.length <= 200)) &&
    (value.remoteScreenshots === undefined ||
      (Array.isArray(value.remoteScreenshots) &&
        value.remoteScreenshots.every(
          (group: unknown) =>
            isRecord(group) &&
            hasExactKeys(group, [
              'productNumber',
              'sourceGroupNumber',
              'urls',
            ]) &&
            Number.isInteger(group.productNumber) &&
            Number(group.productNumber) >= 1 &&
            Number.isInteger(group.sourceGroupNumber) &&
            Number(group.sourceGroupNumber) >= 1 &&
            Array.isArray(group.urls) &&
            group.urls.every((url: unknown) => typeof url === 'string'),
        )))
  );
}

function isFrozenImport(
  value: unknown,
  storageIdentity: string,
): value is FrozenLeadCsvImport {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'actorIdentity',
      'idempotencyKey',
      'items',
      'uncertain',
    ]) ||
    value.actorIdentity !== storageIdentity ||
    !isStableActorIdentity(storageIdentity) ||
    !isNonemptyString(value.idempotencyKey) ||
    value.idempotencyKey.length > 128 ||
    typeof value.uncertain !== 'boolean' ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 20 ||
    !value.items.every(isImportItem)
  )
    return false;
  const rowNumbers = value.items.map(
    (item) => (item as LeadCsvImportItem).rowNumber,
  );
  return new Set(rowNumbers).size === rowNumbers.length;
}

function freezeItem(item: LeadCsvImportItem): LeadCsvImportItem {
  const input = {
    ...item.input,
    infringementTypes: [...item.input.infringementTypes],
    products: item.input.products.map((product) =>
      Object.freeze({ ...product }),
    ),
    leadScreenshotContentVersionIds: [] as const,
  };
  Object.freeze(input.infringementTypes);
  Object.freeze(input.products);
  Object.freeze(input.leadScreenshotContentVersionIds);
  Object.freeze(input);
  return Object.freeze({
    rowNumber: item.rowNumber,
    input,
    ...(item.operatorText ? { operatorText: item.operatorText } : {}),
    ...(item.remoteScreenshots
      ? {
          remoteScreenshots: Object.freeze(
            item.remoteScreenshots.map((group) =>
              Object.freeze({
                productNumber: group.productNumber,
                sourceGroupNumber: group.sourceGroupNumber,
                urls: Object.freeze([...group.urls]),
              }),
            ),
          ),
        }
      : {}),
  });
}

function freezeAttempt(attempt: FrozenLeadCsvImport): FrozenLeadCsvImport {
  return Object.freeze({
    actorIdentity: attempt.actorIdentity,
    idempotencyKey: attempt.idempotencyKey,
    items: Object.freeze(attempt.items.map(freezeItem)),
    uncertain: attempt.uncertain,
  });
}

export function readPendingLeadCsvImports(): Record<
  string,
  FrozenLeadCsvImport
> | null {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const pending: Record<string, FrozenLeadCsvImport> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      if (!isFrozenImport(value, identity)) return null;
      pending[identity] = freezeAttempt(value);
    }
    return pending;
  } catch {
    return null;
  }
}

export function savePendingLeadCsvImports(
  value: Record<string, FrozenLeadCsvImport>,
): boolean {
  try {
    if (
      !Object.entries(value).every(([identity, attempt]) =>
        isFrozenImport(attempt, identity),
      )
    )
      return false;
    globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingLeadCsvImport(
  attempt: FrozenLeadCsvImport,
): boolean {
  const pending = readPendingLeadCsvImports();
  if (pending === null) return false;
  const current = pending[attempt.actorIdentity];
  if (!current || !sameLeadCsvImport(current, attempt)) return false;
  delete pending[attempt.actorIdentity];
  return savePendingLeadCsvImports(pending);
}

export function sameLeadCsvImport(
  a: FrozenLeadCsvImport,
  b: FrozenLeadCsvImport,
): boolean {
  return (
    a.actorIdentity === b.actorIdentity &&
    a.idempotencyKey === b.idempotencyKey &&
    JSON.stringify(a.items) === JSON.stringify(b.items)
  );
}
