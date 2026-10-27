import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import { notaryListStages, type NotaryListStage } from './notary';

export type LeadCaseType =
  | 'CIVIL'
  | 'CRIMINAL'
  | 'ADMINISTRATIVE'
  | 'INVESTIGATION'
  | 'NOTARIZATION'
  | 'HEARING_REPRESENTATION';
export type InfringementType =
  | 'TRADEMARK'
  | 'SOFTWARE_COPYRIGHT'
  | 'ART_COPYRIGHT'
  | 'AUDIOVISUAL_COPYRIGHT'
  | 'TEXT_COPYRIGHT'
  | 'INVENTION_PATENT'
  | 'DESIGN_PATENT'
  | 'UTILITY_MODEL_PATENT'
  | 'UNFAIR_COMPETITION'
  | 'NETWORK_DISSEMINATION'
  | 'PORTRAIT_RIGHT'
  | 'OTHER';
export type LeadSource = 'ONLINE' | 'OFFLINE';
export type LeadPlatform =
  | 'TAOBAO'
  | 'TMALL'
  | 'PINDUODUO'
  | 'JD'
  | 'DOUYIN'
  | 'ALIBABA_1688'
  | 'XIAOHONGSHU'
  | 'KUAISHOU'
  | 'XIANYU'
  | 'WECHAT'
  | 'MEITUAN'
  | 'DIANPING'
  | 'MAP'
  | 'OTHER';
export type LeadStatus =
  | 'WAITING_PUSH'
  | 'WAITING_REVIEW'
  | 'WAITING_EVIDENCE_DECISION'
  | 'TRANSFERRED_TO_NOTARY'
  | 'ARCHIVED';

export type LeadOption<T extends string = string> = {
  value: T;
  label: string;
};
export type LeadFormContext = {
  customers: ReadonlyArray<{
    id: string;
    name: string;
    rightsHolders: ReadonlyArray<{ id: string; name: string }>;
  }>;
  dictionaries: {
    caseTypes: ReadonlyArray<LeadOption<LeadCaseType>>;
    infringementTypes: ReadonlyArray<LeadOption<InfringementType>>;
    sources: ReadonlyArray<LeadOption<LeadSource>>;
    platforms: Readonly<
      Record<LeadSource, ReadonlyArray<LeadOption<LeadPlatform>>>
    >;
  };
};

export type LeadProductInput = {
  id?: string;
  screenshotContentVersionIds?: readonly string[];
  url?: string;
  title?: string;
  quantity: number;
  unitPrice: string;
  commentCount: number;
};
export type LeadMutableBusinessInput = {
  caseType: LeadCaseType;
  infringementTypes: readonly InfringementType[];
  source: LeadSource;
  platform: LeadPlatform;
  foundAt: string;
  shopName: string;
  shopExternalId?: string;
  needDisclose: boolean;
  remark?: string;
  products: readonly LeadProductInput[];
  leadScreenshotContentVersionIds: readonly string[];
};
export type LeadBusinessInput = LeadMutableBusinessInput & {
  rightsHolderId: string;
};
export type CreateLeadInput = LeadBusinessInput & {
  customerId: string;
  reservedLeadId?: string;
};
export type LeadCsvImportInput = Omit<
  CreateLeadInput,
  'reservedLeadId' | 'leadScreenshotContentVersionIds' | 'products'
> & {
  products: readonly Omit<
    LeadProductInput,
    'id' | 'screenshotContentVersionIds'
  >[];
  leadScreenshotContentVersionIds: readonly [];
};
export type LeadCsvImportItem = Readonly<{
  rowNumber: number;
  input: LeadCsvImportInput;
}>;
export type UpdateLeadInput = LeadMutableBusinessInput & {
  expectedVersion: number;
};

export type LeadProduct = {
  id: string;
  position: number;
  url: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string;
  commentCount: number;
  estimatedAmount: string;
  screenshotContentVersionIds?: string[];
};
export type LeadReviewDecision =
  | {
      result: 'INFRINGEMENT';
      reviewerDisplayName: string;
      decidedAt: string;
    }
  | {
      result: 'NO_INFRINGEMENT';
      reason: string;
      reviewerDisplayName: string;
      decidedAt: string;
      archiveType: 'NO_INFRINGEMENT';
      archivedAt: string;
    };
export type LeadEvidenceDecision = {
  result: 'NO_EVIDENCE';
  reason: string;
  decidedAt: string;
  decidedByDisplayName: string;
  archiveType: 'NO_EVIDENCE';
  archivedAt: string;
};
export type LeadBusinessResult = {
  id: string;
  businessNo: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  responsibleUserId: string;
  teamId: string | null;
  status: LeadStatus;
  caseType: LeadCaseType;
  infringementTypes: InfringementType[];
  source: LeadSource;
  platform: LeadPlatform;
  foundAt: string;
  shopName: string;
  shopExternalId: string | null;
  needDisclose: boolean;
  remark: string | null;
  creationChannel: string;
  externalSourceRef: string | null;
  products: LeadProduct[];
  leadScreenshotContentVersionIds: string[];
  version: number;
  pushedAt: string | null;
  pushedByUserId: string | null;
  pushedByDisplayName: string | null;
  reviewDecision: LeadReviewDecision | null;
  createdAt: string;
  updatedAt: string;
};
export type LeadCsvImportResult = {
  items: Array<{
    rowNumber: number;
    lead: LeadBusinessResult & { evidenceDecision: null };
  }>;
};
export type Lead = LeadBusinessResult & {
  displayNames: {
    customerName: string;
    rightsHolderName: string;
    responsibleUserName: string;
  };
};
export type LeadDetail = Lead & {
  capabilities: {
    edit: boolean;
    push: boolean;
    withdrawApply: boolean;
    evidenceDecide: boolean;
    transferToNotary: boolean;
    createEvidenceBatch: boolean;
    proxyReview?: boolean;
    proxyConfirmWithdrawal?: boolean;
    productScreenshotsEdit?: boolean;
  };
  evidenceDecision: LeadEvidenceDecision | null;
  pendingWithdrawalApplication: LeadWithdrawalApplication | null;
  history: LeadHistory[];
  notaryMatters: NotaryMatterSummary[];
};
export type NotaryMatterSummary = {
  id: string;
  businessNo: string;
  stage: NotaryListStage;
  notaryOfficeName: string;
  batchPurpose: string;
  createdAt: string;
};
export type LeadWithdrawalApplication = {
  id: string;
  reason: string;
  applicantDisplayName: string;
  appliedAt: string;
};
export type LeadHistory = {
  kind:
    | 'REVIEW_DECISION'
    | 'WITHDRAWAL_APPLICATION'
    | 'WITHDRAWAL_CONFIRMATION'
    | 'EVIDENCE_DECISION';
  id: string;
  fromVersion: number;
  toVersion: number;
  occurredAt: string;
  result?: string;
  reason?: string | null;
  reviewerDisplayName?: string;
  decidedByDisplayName?: string;
  applicantDisplayName?: string;
  applicationId?: string;
  archiveType?: string | null;
  archivedAt?: string | null;
};
export type LeadWithdrawalApplicationResult = {
  id: string;
  leadId: string;
  status: 'ARCHIVED';
  version: number;
  reason: string;
  applicantDisplayName: string;
  appliedAt: string;
};
export type LeadEvidenceDecisionResult = {
  id: string;
  leadId: string;
  status: 'ARCHIVED';
  version: number;
  result: 'NO_EVIDENCE';
  reason: string;
  decidedByDisplayName: string;
  decidedAt: string;
  archiveType: 'NO_EVIDENCE';
  archivedAt: string;
};
export type LeadPushResult = {
  id: string;
  businessNo: string;
  status: 'WAITING_REVIEW';
  version: number;
  pushedAt: string;
  pushedByUserId: string;
  pushedByDisplayName: string;
};
export type LeadBatchPushItem = { leadId: string; expectedVersion: number };
export type LeadBatchPushResult = { items: LeadPushResult[] };
export type LeadList = {
  items: Lead[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<LeadStatus, number>;
  capabilities: { create: boolean };
};

const caseTypes: readonly LeadCaseType[] = [
  'CIVIL',
  'CRIMINAL',
  'ADMINISTRATIVE',
  'INVESTIGATION',
  'NOTARIZATION',
  'HEARING_REPRESENTATION',
];
const infringementTypes: readonly InfringementType[] = [
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
];
const sources: readonly LeadSource[] = ['ONLINE', 'OFFLINE'];
const onlinePlatforms: readonly LeadPlatform[] = [
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
];
const offlinePlatforms: readonly LeadPlatform[] = [
  'MEITUAN',
  'DIANPING',
  'MAP',
  'OTHER',
];
const statuses: readonly LeadStatus[] = [
  'WAITING_PUSH',
  'WAITING_REVIEW',
  'WAITING_EVIDENCE_DECISION',
  'TRANSFERRED_TO_NOTARY',
  'ARCHIVED',
];
const moneyPattern = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isCount(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 2_147_483_647
  );
}
function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function member<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
function isOption<T extends string>(
  values: readonly T[],
  value: unknown,
): value is LeadOption<T> {
  return (
    isRecord(value) &&
    member(values, value.value) &&
    typeof value.label === 'string'
  );
}
function isProduct(value: unknown): value is LeadProduct {
  const screenshotIds = isRecord(value)
    ? value.screenshotContentVersionIds
    : undefined;
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Number.isInteger(value.position) &&
    (value.position as number) >= 1 &&
    isNullableString(value.url) &&
    isNullableString(value.title) &&
    (value.url !== null || value.title !== null) &&
    isCount(value.quantity) &&
    typeof value.unitPrice === 'string' &&
    moneyPattern.test(value.unitPrice) &&
    isCount(value.commentCount) &&
    typeof value.estimatedAmount === 'string' &&
    moneyPattern.test(value.estimatedAmount) &&
    Array.isArray(screenshotIds) &&
    screenshotIds.length <= 20 &&
    new Set(screenshotIds).size === screenshotIds.length &&
    screenshotIds.every((id) => typeof id === 'string')
  );
}
function isReviewDecision(value: unknown): value is LeadReviewDecision {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length === 3 &&
    keys.every((key) =>
      ['result', 'reviewerDisplayName', 'decidedAt'].includes(key),
    ) &&
    value.result === 'INFRINGEMENT' &&
    typeof value.reviewerDisplayName === 'string' &&
    isDateTime(value.decidedAt)
  )
    return true;
  return (
    keys.length === 6 &&
    keys.every((key) =>
      [
        'result',
        'reason',
        'reviewerDisplayName',
        'decidedAt',
        'archiveType',
        'archivedAt',
      ].includes(key),
    ) &&
    value.result === 'NO_INFRINGEMENT' &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    [...value.reason].length <= 5000 &&
    typeof value.reviewerDisplayName === 'string' &&
    isDateTime(value.decidedAt) &&
    value.archiveType === 'NO_INFRINGEMENT' &&
    isDateTime(value.archivedAt)
  );
}
function isEvidenceDecision(value: unknown): value is LeadEvidenceDecision {
  const keys = [
    'result',
    'reason',
    'decidedAt',
    'decidedByDisplayName',
    'archiveType',
    'archivedAt',
  ];
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key)) &&
    value.result === 'NO_EVIDENCE' &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    [...value.reason].length <= 5000 &&
    typeof value.decidedByDisplayName === 'string' &&
    isDateTime(value.decidedAt) &&
    value.archiveType === 'NO_EVIDENCE' &&
    isDateTime(value.archivedAt)
  );
}
function isLeadBusinessResult(value: unknown): value is LeadBusinessResult {
  if (!isRecord(value)) return false;
  const source = value.source;
  const platform = value.platform;
  const infringements = value.infringementTypes;
  const products = value.products;
  const screenshotIds = value.leadScreenshotContentVersionIds;
  const productScreenshotIds = Array.isArray(products)
    ? products.flatMap((product) =>
        isRecord(product) && Array.isArray(product.screenshotContentVersionIds)
          ? product.screenshotContentVersionIds
          : [],
      )
    : [];
  return (
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    typeof value.departmentId === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.rightsHolderId === 'string' &&
    typeof value.responsibleUserId === 'string' &&
    isNullableString(value.teamId) &&
    member(statuses, value.status) &&
    member(caseTypes, value.caseType) &&
    Array.isArray(infringements) &&
    infringements.length >= 1 &&
    infringements.length <= 12 &&
    new Set(infringements).size === infringements.length &&
    infringements.every((item) => member(infringementTypes, item)) &&
    member(sources, source) &&
    member(
      source === 'ONLINE' ? onlinePlatforms : offlinePlatforms,
      platform,
    ) &&
    isDateTime(value.foundAt) &&
    typeof value.shopName === 'string' &&
    value.shopName.length >= 1 &&
    value.shopName.length <= 200 &&
    isNullableString(value.shopExternalId) &&
    typeof value.needDisclose === 'boolean' &&
    isNullableString(value.remark) &&
    typeof value.creationChannel === 'string' &&
    isNullableString(value.externalSourceRef) &&
    Array.isArray(products) &&
    products.length >= 1 &&
    products.length <= 100 &&
    products.every(
      (product, index) => isProduct(product) && product.position === index + 1,
    ) &&
    products.reduce(
      (total, product) =>
        total + (product.screenshotContentVersionIds?.length ?? 0),
      0,
    ) <= 20 &&
    new Set(productScreenshotIds).size === productScreenshotIds.length &&
    Array.isArray(screenshotIds) &&
    screenshotIds.length <= 20 &&
    new Set(screenshotIds).size === screenshotIds.length &&
    screenshotIds.every((id) => typeof id === 'string') &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    (value.pushedAt === null || isDateTime(value.pushedAt)) &&
    isNullableString(value.pushedByUserId) &&
    isNullableString(value.pushedByDisplayName) &&
    ((value.pushedAt === null &&
      value.pushedByUserId === null &&
      value.pushedByDisplayName === null) ||
      (value.pushedAt !== null &&
        value.pushedByUserId !== null &&
        value.pushedByDisplayName !== null)) &&
    (value.reviewDecision === null || isReviewDecision(value.reviewDecision)) &&
    isDateTime(value.createdAt) &&
    isDateTime(value.updatedAt)
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的线索数据', 200, 'INVALID_RESPONSE');
}

function invalidCsvImportRequest(): ApiError {
  return new ApiError('CSV批量导入请求无效', 400, 'VALIDATION_ERROR');
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  );
}

const csvImportInputKeys = [
  'customerId',
  'rightsHolderId',
  'caseType',
  'infringementTypes',
  'source',
  'platform',
  'foundAt',
  'shopName',
  'shopExternalId',
  'needDisclose',
  'remark',
  'products',
  'leadScreenshotContentVersionIds',
];
const csvImportProductKeys = [
  'url',
  'title',
  'quantity',
  'unitPrice',
  'commentCount',
];
const csvImportRequiredInputKeys = [
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
];

function isLeadCsvImportProduct(value: unknown): value is LeadProductInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.every((key) => csvImportProductKeys.includes(key)) &&
    ['quantity', 'unitPrice', 'commentCount'].every((key) =>
      keys.includes(key),
    ) &&
    (value.url === undefined || typeof value.url === 'string') &&
    (value.title === undefined || typeof value.title === 'string') &&
    ((typeof value.url === 'string' && value.url.trim().length > 0) ||
      (typeof value.title === 'string' && value.title.trim().length > 0)) &&
    isCount(value.quantity) &&
    typeof value.unitPrice === 'string' &&
    moneyPattern.test(value.unitPrice) &&
    isCount(value.commentCount)
  );
}

function isLeadCsvImportInput(value: unknown): value is LeadCsvImportInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const screenshots = value.leadScreenshotContentVersionIds;
  const infringementValues = value.infringementTypes;
  const products = value.products;
  return (
    keys.every((key) => csvImportInputKeys.includes(key)) &&
    csvImportRequiredInputKeys.every((key) => keys.includes(key)) &&
    typeof value.customerId === 'string' &&
    value.customerId.trim().length > 0 &&
    typeof value.rightsHolderId === 'string' &&
    value.rightsHolderId.trim().length > 0 &&
    member(caseTypes, value.caseType) &&
    Array.isArray(infringementValues) &&
    infringementValues.length >= 1 &&
    infringementValues.length <= 12 &&
    new Set(infringementValues).size === infringementValues.length &&
    infringementValues.every((item) => member(infringementTypes, item)) &&
    member(sources, value.source) &&
    member(
      value.source === 'ONLINE' ? onlinePlatforms : offlinePlatforms,
      value.platform,
    ) &&
    isDateTime(value.foundAt) &&
    typeof value.shopName === 'string' &&
    value.shopName.trim().length > 0 &&
    value.shopName.length <= 200 &&
    (value.shopExternalId === undefined ||
      typeof value.shopExternalId === 'string') &&
    typeof value.needDisclose === 'boolean' &&
    (value.remark === undefined || typeof value.remark === 'string') &&
    Array.isArray(products) &&
    products.length >= 1 &&
    products.length <= 100 &&
    products.every(isLeadCsvImportProduct) &&
    Array.isArray(screenshots) &&
    screenshots.length === 0
  );
}

function isLeadCsvImportItem(value: unknown): value is LeadCsvImportItem {
  return (
    hasExactKeys(value, ['rowNumber', 'input']) &&
    Number.isInteger(value.rowNumber) &&
    (value.rowNumber as number) >= 2 &&
    (value.rowNumber as number) <= 2_097_153 &&
    isLeadCsvImportInput(value.input)
  );
}

function isLeadCsvImportItems(
  value: unknown,
): value is readonly LeadCsvImportItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20)
    return false;
  const rowNumbers = new Set<number>();
  for (const item of value) {
    if (!isLeadCsvImportItem(item) || rowNumbers.has(item.rowNumber))
      return false;
    rowNumbers.add(item.rowNumber);
  }
  return true;
}

const csvImportLeadKeys = [
  'id',
  'businessNo',
  'departmentId',
  'customerId',
  'rightsHolderId',
  'responsibleUserId',
  'teamId',
  'status',
  'caseType',
  'infringementTypes',
  'source',
  'platform',
  'foundAt',
  'shopName',
  'shopExternalId',
  'needDisclose',
  'remark',
  'creationChannel',
  'externalSourceRef',
  'products',
  'leadScreenshotContentVersionIds',
  'version',
  'pushedAt',
  'pushedByUserId',
  'pushedByDisplayName',
  'reviewDecision',
  'evidenceDecision',
  'createdAt',
  'updatedAt',
];
const csvImportProductResultKeys = [
  'id',
  'position',
  'url',
  'title',
  'quantity',
  'unitPrice',
  'commentCount',
  'estimatedAmount',
  'screenshotContentVersionIds',
];

function isStrictCsvLeadResult(
  value: unknown,
): value is LeadBusinessResult & { evidenceDecision: null } {
  if (
    !hasExactKeys(value, csvImportLeadKeys) ||
    value.evidenceDecision !== null ||
    !isLeadBusinessResult(value)
  )
    return false;
  return (
    value.products.every(
      (product) =>
        hasExactKeys(product, csvImportProductResultKeys) && isProduct(product),
    ) &&
    value.id.trim().length > 0 &&
    value.businessNo.trim().length > 0 &&
    value.creationChannel === 'CSV' &&
    value.status === 'WAITING_PUSH' &&
    value.version === 1 &&
    value.leadScreenshotContentVersionIds.length === 0 &&
    value.pushedAt === null &&
    value.pushedByUserId === null &&
    value.pushedByDisplayName === null &&
    value.reviewDecision === null &&
    value.externalSourceRef === null
  );
}

function matchesCsvImportInput(
  lead: LeadBusinessResult,
  input: LeadCsvImportInput,
): boolean {
  const submittedInfringementTypes = new Set(input.infringementTypes);
  const returnedInfringementTypes = new Set(lead.infringementTypes);
  return (
    lead.customerId === input.customerId &&
    lead.rightsHolderId === input.rightsHolderId &&
    lead.caseType === input.caseType &&
    lead.infringementTypes.length === input.infringementTypes.length &&
    returnedInfringementTypes.size === lead.infringementTypes.length &&
    lead.infringementTypes.every((infringementType) =>
      submittedInfringementTypes.has(infringementType),
    ) &&
    lead.source === input.source &&
    lead.platform === input.platform &&
    lead.foundAt === new Date(input.foundAt).toISOString() &&
    lead.shopName === normalizeLeadText(input.shopName) &&
    lead.shopExternalId === normalizeOptionalLeadText(input.shopExternalId) &&
    lead.needDisclose === input.needDisclose &&
    lead.remark === normalizeOptionalLeadText(input.remark) &&
    lead.products.length === input.products.length &&
    lead.products.every((product, index) => {
      const submitted = input.products[index];
      return (
        submitted !== undefined &&
        product.position === index + 1 &&
        product.url === normalizeOptionalLeadText(submitted.url) &&
        product.title === normalizeOptionalLeadText(submitted.title) &&
        product.quantity === submitted.quantity &&
        moneyInCents(product.unitPrice) === moneyInCents(submitted.unitPrice) &&
        product.commentCount === submitted.commentCount
      );
    })
  );
}

function moneyInCents(value: string): bigint {
  const decimalIndex = value.indexOf('.');
  const whole = decimalIndex < 0 ? value : value.slice(0, decimalIndex);
  const fraction = decimalIndex < 0 ? '' : value.slice(decimalIndex + 1);
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function normalizeLeadText(value: string): string {
  return value.normalize('NFKC').trim();
}

function normalizeOptionalLeadText(value: string | undefined): string | null {
  return value === undefined ? null : normalizeLeadText(value);
}

function isLead(value: unknown): value is Lead {
  if (!isLeadBusinessResult(value) || !('displayNames' in value)) return false;
  const names = value.displayNames;
  return (
    isRecord(names) &&
    Object.keys(names).length === 3 &&
    ['customerName', 'rightsHolderName', 'responsibleUserName'].every(
      (key) => typeof names[key] === 'string' && names[key].trim().length > 0,
    )
  );
}

function decodeLeadFormContext(data: unknown): LeadFormContext {
  if (
    !isRecord(data) ||
    !Array.isArray(data.customers) ||
    !isRecord(data.dictionaries)
  )
    throw invalidResponse();
  const dictionaries = data.dictionaries;
  if (
    !data.customers.every(
      (customer) =>
        isRecord(customer) &&
        typeof customer.id === 'string' &&
        typeof customer.name === 'string' &&
        Array.isArray(customer.rightsHolders) &&
        customer.rightsHolders.every(
          (holder) =>
            isRecord(holder) &&
            typeof holder.id === 'string' &&
            typeof holder.name === 'string',
        ),
    ) ||
    !Array.isArray(dictionaries.caseTypes) ||
    !dictionaries.caseTypes.every((item) => isOption(caseTypes, item)) ||
    !Array.isArray(dictionaries.infringementTypes) ||
    !dictionaries.infringementTypes.every((item) =>
      isOption(infringementTypes, item),
    ) ||
    !Array.isArray(dictionaries.sources) ||
    !dictionaries.sources.every((item) => isOption(sources, item)) ||
    !isRecord(dictionaries.platforms) ||
    !Array.isArray(dictionaries.platforms.ONLINE) ||
    !dictionaries.platforms.ONLINE.every((item) =>
      isOption(onlinePlatforms, item),
    ) ||
    !Array.isArray(dictionaries.platforms.OFFLINE) ||
    !dictionaries.platforms.OFFLINE.every((item) =>
      isOption(offlinePlatforms, item),
    )
  )
    throw invalidResponse();
  return data as LeadFormContext;
}

export async function getLeadFormContext(
  options: RequestOptions = {},
): Promise<LeadFormContext> {
  return decodeLeadFormContext(await getJson('/leads/form-context', options));
}

export async function getLeadEditContext(
  id: string,
  options: RequestOptions = {},
): Promise<LeadFormContext> {
  return decodeLeadFormContext(
    await getJson(`/leads/${encodeURIComponent(id)}/edit-context`, options),
  );
}

export async function listLeadFilterOptions(
  kind: 'customer' | 'rightsHolder',
  q: string,
  options: RequestOptions = {},
  scope: {
    view?: 'LIBRARY';
    status?: LeadStatus;
    context?: 'NOTARY';
    notaryStage?: string;
  } = {},
): Promise<{ items: { id: string; name: string }[] }> {
  const query = new URLSearchParams({ kind, q });
  if (scope.view) query.set('view', scope.view);
  if (scope.status) query.set('status', scope.status);
  if (scope.context) query.set('context', scope.context);
  if (scope.notaryStage) query.set('notaryStage', scope.notaryStage);
  const result = await getJson(`/leads/filter-options?${query}`, options);
  if (
    !isRecord(result) ||
    !Array.isArray(result.items) ||
    !result.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string',
    )
  )
    throw invalidResponse();
  return { items: result.items as { id: string; name: string }[] };
}

export async function listLeads(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
  status?: LeadStatus,
  view?: 'LIBRARY',
  q?: string,
  filters: {
    customerId?: string;
    rightsHolderId?: string;
    shopName?: string;
  } = {},
): Promise<LeadList> {
  if (
    q !== undefined &&
    (typeof q !== 'string' || Array.from(q.trim()).length > 200)
  )
    throw new ApiError('线索关键词不能超过200字', 400, 'VALIDATION_ERROR');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status !== undefined) query.set('status', status);
  if (view !== undefined) query.set('view', view);
  if (q?.trim()) query.set('q', q.trim());
  if (filters.customerId) query.set('customerId', filters.customerId);
  if (filters.rightsHolderId)
    query.set('rightsHolderId', filters.rightsHolderId);
  if (filters.shopName?.trim()) query.set('shopName', filters.shopName.trim());
  const data = await getJson(`/leads?${query.toString()}`, options);
  const counts = isRecord(data) ? data.counts : undefined;
  const capabilities = isRecord(data) ? data.capabilities : undefined;
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isLead) ||
    !Number.isInteger(data.total) ||
    (data.total as number) < 0 ||
    !Number.isInteger(data.page) ||
    (data.page as number) < 1 ||
    !Number.isInteger(data.pageSize) ||
    (data.pageSize as number) < 1 ||
    (data.pageSize as number) > 100 ||
    !isRecord(counts) ||
    !statuses.every(
      (status) =>
        Number.isInteger(counts[status]) && (counts[status] as number) >= 0,
    ) ||
    Object.keys(counts).length !== statuses.length ||
    !isRecord(capabilities) ||
    typeof capabilities.create !== 'boolean'
  )
    throw invalidResponse();
  return data as LeadList;
}

export async function getLead(
  id: string,
  options: RequestOptions = {},
): Promise<LeadDetail> {
  const data = await getJson(`/leads/${encodeURIComponent(id)}`, options);
  if (!isRecord(data)) throw invalidResponse();
  const detail: Record<string, unknown> = data;
  const capabilities = detail.capabilities;
  const history = detail.history;
  const pendingWithdrawalApplication = detail.pendingWithdrawalApplication;
  if (
    !isLead(data) ||
    !isRecord(capabilities) ||
    typeof capabilities.edit !== 'boolean' ||
    typeof capabilities.push !== 'boolean' ||
    typeof capabilities.withdrawApply !== 'boolean' ||
    typeof capabilities.evidenceDecide !== 'boolean' ||
    typeof capabilities.transferToNotary !== 'boolean' ||
    typeof capabilities.createEvidenceBatch !== 'boolean' ||
    (capabilities.proxyReview !== undefined && typeof capabilities.proxyReview !== 'boolean') ||
    (capabilities.proxyConfirmWithdrawal !== undefined && typeof capabilities.proxyConfirmWithdrawal !== 'boolean') ||
    (capabilities.productScreenshotsEdit !== undefined &&
      typeof capabilities.productScreenshotsEdit !== 'boolean') ||
    (detail.evidenceDecision !== null &&
      !isEvidenceDecision(detail.evidenceDecision)) ||
    !isNotaryMatterSummaries(detail.notaryMatters) ||
    !isLeadHistory(history) ||
    !isPendingWithdrawalApplication(pendingWithdrawalApplication)
  )
    throw invalidResponse();
  return {
    ...data,
    pendingWithdrawalApplication,
    history,
    evidenceDecision: detail.evidenceDecision as LeadEvidenceDecision | null,
    capabilities: {
      edit: capabilities.edit,
      push: capabilities.push,
      withdrawApply: capabilities.withdrawApply,
      evidenceDecide: capabilities.evidenceDecide,
      transferToNotary: capabilities.transferToNotary,
      createEvidenceBatch: capabilities.createEvidenceBatch,
      proxyReview: capabilities.proxyReview === true,
      proxyConfirmWithdrawal: capabilities.proxyConfirmWithdrawal === true,
      productScreenshotsEdit: capabilities.productScreenshotsEdit === true,
    },
    notaryMatters: detail.notaryMatters,
  };
}

function isNotaryMatterSummaries(
  value: unknown,
): value is NotaryMatterSummary[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.businessNo === 'string' &&
        member(notaryListStages, item.stage) &&
        typeof item.notaryOfficeName === 'string' &&
        typeof item.batchPurpose === 'string' &&
        isDateTime(item.createdAt),
    )
  );
}

function isPendingWithdrawalApplication(
  value: unknown,
): value is LeadWithdrawalApplication | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.reason === 'string' &&
      [...value.reason].length >= 1 &&
      [...value.reason].length <= 5000 &&
      typeof value.applicantDisplayName === 'string' &&
      isDateTime(value.appliedAt))
  );
}

function isLeadHistory(value: unknown): value is LeadHistory[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        (item.kind === 'REVIEW_DECISION' ||
          item.kind === 'WITHDRAWAL_APPLICATION' ||
          item.kind === 'WITHDRAWAL_CONFIRMATION' ||
          item.kind === 'EVIDENCE_DECISION') &&
        typeof item.id === 'string' &&
        Number.isInteger(item.fromVersion) &&
        Number.isInteger(item.toVersion) &&
        (item.toVersion as number) > (item.fromVersion as number) &&
        isDateTime(item.occurredAt) &&
        (item.reason === undefined ||
          item.reason === null ||
          typeof item.reason === 'string') &&
        (item.applicantDisplayName === undefined ||
          typeof item.applicantDisplayName === 'string') &&
        (item.reviewerDisplayName === undefined ||
          typeof item.reviewerDisplayName === 'string') &&
        (item.decidedByDisplayName === undefined ||
          typeof item.decidedByDisplayName === 'string') &&
        (item.kind !== 'EVIDENCE_DECISION' ||
          (item.result === 'NO_EVIDENCE' &&
            typeof item.reason === 'string' &&
            item.reason.trim().length > 0 &&
            [...item.reason].length <= 5000 &&
            typeof item.decidedByDisplayName === 'string' &&
            item.archiveType === 'NO_EVIDENCE' &&
            isDateTime(item.archivedAt))) &&
        (item.applicationId === undefined ||
          typeof item.applicationId === 'string'),
    )
  );
}

export async function applyLeadWithdrawal(
  id: string,
  reason: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<LeadWithdrawalApplicationResult> {
  const data = await requestJson(
    `/leads/${encodeURIComponent(id)}/withdrawal-applications`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { reason, expectedVersion },
    },
  );
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    typeof data.leadId !== 'string' ||
    data.leadId !== id ||
    data.status !== 'ARCHIVED' ||
    data.version !== expectedVersion + 1 ||
    typeof data.reason !== 'string' ||
    typeof data.applicantDisplayName !== 'string' ||
    !isDateTime(data.appliedAt)
  )
    throw invalidResponse();
  return data as LeadWithdrawalApplicationResult;
}

export async function decideLeadNoEvidence(
  id: string,
  reason: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<LeadEvidenceDecisionResult> {
  const normalizedReason = reason.trim();
  const data = await requestJson(
    `/leads/${encodeURIComponent(id)}/evidence-decisions`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        result: 'NO_EVIDENCE',
        reason: normalizedReason,
        expectedVersion,
      },
    },
  );
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    data.leadId !== id ||
    data.status !== 'ARCHIVED' ||
    data.version !== expectedVersion + 1 ||
    data.result !== 'NO_EVIDENCE' ||
    data.reason !== normalizedReason ||
    typeof data.decidedByDisplayName !== 'string' ||
    !isDateTime(data.decidedAt) ||
    data.archiveType !== 'NO_EVIDENCE' ||
    !isDateTime(data.archivedAt)
  )
    throw invalidResponse();
  return data as LeadEvidenceDecisionResult;
}

export async function pushLead(
  id: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<LeadPushResult> {
  const data = await requestJson(`/leads/${encodeURIComponent(id)}/push`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { expectedVersion },
  });
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    typeof data.businessNo !== 'string' ||
    data.status !== 'WAITING_REVIEW' ||
    !Number.isInteger(data.version) ||
    (data.version as number) !== expectedVersion + 1 ||
    !isDateTime(data.pushedAt) ||
    typeof data.pushedByUserId !== 'string' ||
    typeof data.pushedByDisplayName !== 'string'
  )
    throw invalidResponse();
  return data as LeadPushResult;
}

export async function pushLeadsBatch(
  items: readonly LeadBatchPushItem[],
  idempotencyKey: string,
  options?: RequestOptions,
): Promise<LeadBatchPushResult> {
  const frozenItems = items.map((item) => ({ ...item }));
  const normalizedHeaders: Record<string, string> = {};
  new Headers(options?.headers).forEach((value, name) => {
    normalizedHeaders[name] = value;
  });
  delete normalizedHeaders['idempotency-key'];
  normalizedHeaders['Idempotency-Key'] = idempotencyKey;
  const data = await requestJson('/leads/batch-push', {
    ...options,
    method: 'POST',
    headers: normalizedHeaders,
    retryOnCsrfInvalid: false,
    body: { items: frozenItems },
  });
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    data.items.length !== frozenItems.length
  )
    throw invalidResponse();
  const resultItems = data.items.map((entry, index) => {
    const item = frozenItems[index]!;
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.id.toLowerCase() !== item.leadId.toLowerCase() ||
      typeof entry.businessNo !== 'string' ||
      entry.status !== 'WAITING_REVIEW' ||
      entry.version !== item.expectedVersion + 1 ||
      !isDateTime(entry.pushedAt) ||
      typeof entry.pushedByUserId !== 'string' ||
      typeof entry.pushedByDisplayName !== 'string'
    )
      throw invalidResponse();
    return entry as LeadPushResult;
  });
  return { items: resultItems };
}

const maxLeadCsvImportBodyBytes = 92_160;

export async function importLeadCsvBatch(
  items: readonly LeadCsvImportItem[],
  idempotencyKey: string,
  options?: RequestOptions,
): Promise<LeadCsvImportResult> {
  if (
    !isLeadCsvImportItems(items) ||
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length === 0
  )
    throw invalidCsvImportRequest();

  const capturedItems: LeadCsvImportItem[] = items.map((item) => ({
    rowNumber: item.rowNumber,
    input: {
      ...item.input,
      infringementTypes: [...item.input.infringementTypes],
      products: item.input.products.map((product) => ({ ...product })),
      leadScreenshotContentVersionIds: [],
    },
  }));
  const body = {
    items: capturedItems.map(({ rowNumber, input }) => ({
      rowNumber,
      input: {
        ...input,
        infringementTypes: [...input.infringementTypes],
        products: input.products.map((product) => ({ ...product })),
        leadScreenshotContentVersionIds: [],
      },
    })),
  };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).length;
  if (bodyBytes > maxLeadCsvImportBodyBytes)
    throw new ApiError(
      'CSV导入内容超过90KiB，请减少导入行数或文本内容后重试',
      400,
      'VALIDATION_ERROR',
    );

  const normalizedHeaders: Record<string, string> = {};
  new Headers(options?.headers).forEach((value, name) => {
    normalizedHeaders[name] = value;
  });
  delete normalizedHeaders['idempotency-key'];
  normalizedHeaders['Idempotency-Key'] = idempotencyKey;

  const data = await requestJson('/leads/csv-import', {
    ...options,
    method: 'POST',
    headers: normalizedHeaders,
    retryOnCsrfInvalid: false,
    body,
  });
  if (
    !hasExactKeys(data, ['items']) ||
    !Array.isArray(data.items) ||
    data.items.length !== capturedItems.length
  )
    throw invalidResponse();

  const responseItems: unknown[] = data.items;
  const resultItems: LeadCsvImportResult['items'] = [];
  const leadIds = new Set<string>();
  for (const [index, responseItem] of responseItems.entries()) {
    const submitted = capturedItems[index];
    if (
      !submitted ||
      !hasExactKeys(responseItem, ['rowNumber', 'lead']) ||
      responseItem.rowNumber !== submitted.rowNumber ||
      !isStrictCsvLeadResult(responseItem.lead) ||
      !matchesCsvImportInput(responseItem.lead, submitted.input) ||
      leadIds.has(responseItem.lead.id.toLowerCase())
    )
      throw invalidResponse();
    leadIds.add(responseItem.lead.id.toLowerCase());
    resultItems.push({
      rowNumber: submitted.rowNumber,
      lead: responseItem.lead,
    });
  }
  return { items: resultItems };
}

function requestBody(input: CreateLeadInput | UpdateLeadInput) {
  const {
    products,
    infringementTypes,
    leadScreenshotContentVersionIds,
    ...fields
  } = input;
  return {
    ...fields,
    infringementTypes: [...infringementTypes],
    products: products.map((product) => {
      const { id, screenshotContentVersionIds, ...business } = product;
      return {
        ...business,
        ...(id === undefined ? {} : { id }),
        ...(screenshotContentVersionIds === undefined
          ? {}
          : { screenshotContentVersionIds: [...screenshotContentVersionIds] }),
      };
    }),
    leadScreenshotContentVersionIds: [...leadScreenshotContentVersionIds],
  };
}

export async function createLead(
  input: CreateLeadInput,
  idempotencyKey: string,
): Promise<LeadBusinessResult> {
  const data = await requestJson('/leads', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: requestBody(input),
  });
  if (!isLeadBusinessResult(data)) throw invalidResponse();
  return data;
}

export async function updateLead(
  id: string,
  input: UpdateLeadInput,
): Promise<LeadBusinessResult> {
  const data = await requestJson(`/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: requestBody(input),
  });
  if (!isLeadBusinessResult(data)) throw invalidResponse();
  return data;
}

export async function updateLeadProductScreenshots(
  leadId: string,
  productId: string,
  input: {
    expectedVersion: number;
    screenshotContentVersionIds: readonly string[];
  },
): Promise<LeadBusinessResult> {
  const data = await requestJson(
    `/leads/${encodeURIComponent(leadId)}/products/${encodeURIComponent(productId)}/screenshots`,
    {
      method: 'PUT',
      body: {
        expectedVersion: input.expectedVersion,
        screenshotContentVersionIds: [...input.screenshotContentVersionIds],
      },
    },
  );
  if (!isRecord(data)) throw invalidResponse();
  if (!isLeadBusinessResult(data)) throw invalidResponse();
  return data;
}
