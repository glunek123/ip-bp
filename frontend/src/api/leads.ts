import { ApiError, getJson, requestJson, type RequestOptions } from './http';

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
  'WAITING_PUSH' | 'WAITING_REVIEW' | 'WAITING_EVIDENCE_DECISION' | 'ARCHIVED';

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
};
export type Lead = {
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
  createdAt: string;
  updatedAt: string;
};
export type LeadDetail = Lead & {
  capabilities: { edit: boolean; push: boolean };
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
    moneyPattern.test(value.estimatedAmount)
  );
}
function isLead(value: unknown): value is Lead {
  if (!isRecord(value)) return false;
  const source = value.source;
  const platform = value.platform;
  const infringements = value.infringementTypes;
  const products = value.products;
  const screenshotIds = value.leadScreenshotContentVersionIds;
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
    isDateTime(value.createdAt) &&
    isDateTime(value.updatedAt)
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的线索数据', 200, 'INVALID_RESPONSE');
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

export async function listLeads(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
  status?: LeadStatus,
): Promise<LeadList> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status !== undefined) query.set('status', status);
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
  const capabilities = isRecord(data) ? data.capabilities : undefined;
  if (
    !isLead(data) ||
    !isRecord(capabilities) ||
    typeof capabilities.edit !== 'boolean' ||
    typeof capabilities.push !== 'boolean'
  )
    throw invalidResponse();
  return {
    ...data,
    capabilities: { edit: capabilities.edit, push: capabilities.push },
  };
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

function requestBody(input: CreateLeadInput | UpdateLeadInput) {
  return {
    ...input,
    infringementTypes: [...input.infringementTypes],
    products: input.products.map((product) => ({ ...product })),
    leadScreenshotContentVersionIds: [...input.leadScreenshotContentVersionIds],
  };
}

export async function createLead(
  input: CreateLeadInput,
  idempotencyKey: string,
): Promise<Lead> {
  const data = await requestJson('/leads', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: requestBody(input),
  });
  if (!isLead(data)) throw invalidResponse();
  return data;
}

export async function updateLead(
  id: string,
  input: UpdateLeadInput,
): Promise<Lead> {
  const data = await requestJson(`/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: requestBody(input),
  });
  if (!isLead(data)) throw invalidResponse();
  return data;
}
