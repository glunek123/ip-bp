import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type SettlementSide = 'CUSTOMER' | 'LAWYER';
export type SettlementCapabilities = {
  read: boolean;
  termsUpdate: boolean;
  launch: boolean;
  billCreate: boolean;
  billCancel: boolean;
  feeRead: boolean;
  feeCreate: boolean;
  feeUpdate: boolean;
  feeLaunch: boolean;
  feeDelete: boolean;
};
export type LawyerSettlementMode = 'FULL_RISK' | 'HALF_RISK' | 'FIXED_FEE';
export type SettlementFigures = {
  basis: string | null;
  customerPercent: string | null;
  customerAutomaticAmount: string | null;
  customerAmount: string | null;
  customerSource: 'AUTOMATIC' | 'MANUAL';
  lawyerAutomaticAmount: string | null;
  lawyerAmount: string | null;
  lawyerSource: 'AUTOMATIC' | 'MANUAL';
};
export type CaseSettlement = {
  caseId: string;
  businessNo: string;
  stage: string;
  customer: { id: string; name: string };
  lawyers: Array<{ id: string; name: string; firm: string | null }>;
  termsVersion: number;
  terms: null | {
    customerFormula: string | null;
    lawyerMode: LawyerSettlementMode | null;
    lawyerBaseFee: string | null;
    lawyerSplitPercent: string | null;
    customerManualAmount: string | null;
    lawyerManualAmount: string | null;
  };
  figures: SettlementFigures;
  customerBalance: {
    launched: string;
    remaining: string | null;
    overLaunched: boolean;
  };
  lawyerBalance: {
    launched: string;
    remaining: string | null;
    overLaunched: boolean;
  };
  launches: SettlementLaunch[];
};
export type SettlementLaunch = {
  id: string;
  caseId: string;
  side: SettlementSide;
  nth: number;
  amount: string;
  launchDate: string;
  note: string | null;
  billId: string | null;
  customerId: string | null;
  lawyerId: string | null;
};
export type CenterLaunch = SettlementLaunch & {
  businessNo: string;
  stage: string;
  payeeId: string | null;
  payeeName: string | null;
  lawFirm: string | null;
  invoiceAmount: string | null;
  receivedAmount: string | null;
  paidAmount: string | null;
  actualPaymentDate: string | null;
};
export type SettlementBill = {
  id: string;
  billNo: string;
  side: SettlementSide;
  billDate: string;
  amount: string;
  note: string | null;
  cancelledAt: string | null;
  payees: string[];
  count: number;
};
export type SettlementBillDetail = Omit<SettlementBill, 'payees' | 'count'> & {
  cancellationReason: string | null;
  items: Array<{
    id: string;
    launchId: string;
    caseId: string;
    caseBusinessNo?: string;
    launchDate?: string;
    payeeId: string;
    payeeName: string;
    nth: number;
    amount: string;
  }>;
};
export type FeeSourceRow = {
  id: string;
  caseId: string;
  businessNo: string;
  stage: string;
  type: string;
  direction: '收入' | '支出';
  status: string;
  amount: string;
  feeDate: string;
  source: string;
  note: string | null;
  version: number;
  proofMaterialId: string | null;
  proofContentVersionId: string | null;
  proofOriginalFilename: string | null;
  courtCaseNo: string | null;
  platform: string | null;
  shopName: string | null;
  defendantNames: string[];
};
export type FeeRow = FeeSourceRow & {
  mergeTypes?: string[];
  sourceRows?: FeeSourceRow[];
};
export type FeeSelectionSource = Pick<
  FeeSourceRow,
  'id' | 'businessNo' | 'type' | 'amount' | 'status'
>;
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}
function invalid(): ApiError {
  return new ApiError(
    '结算接口返回的数据无效',
    502,
    'INVALID_SETTLEMENT_RESPONSE',
  );
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  return value;
}
function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return string(value);
}
function businessNumber(value: unknown): string {
  const result = string(value);
  if (result.trim().length === 0) throw invalid();
  return result;
}
function financialDay(value: unknown): string {
  const result = string(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw invalid();
  const date = new Date(`${result}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== result
  )
    throw invalid();
  return result;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid();
  return value;
}
function side(value: unknown): SettlementSide {
  if (value !== 'CUSTOMER' && value !== 'LAWYER') throw invalid();
  return value;
}
function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(decode);
}
function page<T>(value: unknown, decode: (item: unknown) => T): Page<T> {
  const row = record(value);
  return {
    items: list(row.items, decode),
    total: number(row.total),
    page: number(row.page),
    pageSize: number(row.pageSize),
  };
}
function launch(value: unknown): SettlementLaunch {
  const row = record(value);
  return {
    id: string(row.id),
    caseId: string(row.caseId),
    side: side(row.side),
    nth: number(row.nth),
    amount: string(row.amount),
    launchDate: string(row.launchDate),
    note: nullableString(row.note),
    billId: nullableString(row.billId),
    customerId: nullableString(row.customerId),
    lawyerId: nullableString(row.lawyerId),
  };
}
function bill(value: unknown): SettlementBill {
  const row = record(value);
  return {
    id: string(row.id),
    billNo: string(row.billNo),
    side: side(row.side),
    billDate: string(row.billDate),
    amount: string(row.amount),
    note: nullableString(row.note),
    cancelledAt: nullableString(row.cancelledAt),
    payees: list(row.payees, string),
    count: number(row.count),
  };
}
export function parseFeeSourceRow(value: unknown): FeeSourceRow {
  const row = record(value);
  const direction = row.direction;
  if (direction !== '收入' && direction !== '支出') throw invalid();
  const result: FeeSourceRow = {
    id: string(row.id),
    caseId: string(row.caseId),
    businessNo: string(row.businessNo),
    stage: string(row.stage),
    courtCaseNo: nullableString(row.courtCaseNo),
    platform: nullableString(row.platform),
    shopName: nullableString(row.shopName),
    defendantNames: list(row.defendantNames, string),
    type: string(row.type),
    direction,
    status: string(row.status),
    amount: string(row.amount),
    feeDate: string(row.feeDate),
    source: string(row.source),
    note: nullableString(row.note),
    version: number(row.version),
    proofMaterialId: nullableString(row.proofMaterialId),
    proofContentVersionId: nullableString(row.proofContentVersionId),
    proofOriginalFilename: nullableString(row.proofOriginalFilename),
  };
  if (
    (result.proofMaterialId === null) !==
      (result.proofContentVersionId === null) ||
    (result.proofContentVersionId === null &&
      result.proofOriginalFilename !== null)
  )
    throw invalid();
  return result;
}
function fee(value: unknown): FeeRow {
  const row = record(value);
  const source = parseFeeSourceRow(row);
  if (row.mergeTypes === undefined && row.sourceRows === undefined)
    return source;
  const mergeTypes = list(row.mergeTypes, string);
  const sourceRows = list(row.sourceRows, (value) => {
    const original = record(value);
    if (original.mergeTypes !== undefined || original.sourceRows !== undefined)
      throw invalid();
    return parseFeeSourceRow(original);
  });
  if (
    mergeTypes.length !== 2 ||
    !mergeTypes.includes('样品费') ||
    !mergeTypes.includes('样品费退款') ||
    sourceRows.length < 2 ||
    new Set(sourceRows.map((row) => row.id)).size !== sourceRows.length ||
    sourceRows.some(
      (row) =>
        row.caseId !== source.caseId ||
        !mergeTypes.includes(row.type) ||
        !/^\d+\.\d{2}$/.test(row.amount),
    ) ||
    !sourceRows.some((row) => row.type === '样品费' && row.id === source.id) ||
    !sourceRows.some((row) => row.type === '样品费退款') ||
    source.proofMaterialId !== null ||
    source.proofContentVersionId !== null ||
    source.proofOriginalFilename !== null ||
    !/^-?\d+\.\d{2}$/.test(source.amount)
  )
    throw invalid();
  const cents = (amount: string) => BigInt(amount.replace('.', ''));
  const net = sourceRows.reduce(
    (sum, row) =>
      sum + (row.type === '样品费' ? cents(row.amount) : -cents(row.amount)),
    0n,
  );
  if (net === 0n || net !== cents(source.amount)) throw invalid();
  return { ...source, mergeTypes, sourceRows };
}

export async function getSettlementContext(
  options: RequestOptions = {},
): Promise<SettlementCapabilities> {
  const row = record(await getJson('/settlements/context', options));
  return {
    read: boolean(row.read),
    termsUpdate: boolean(row.termsUpdate),
    launch: boolean(row.launch),
    billCreate: boolean(row.billCreate),
    billCancel: boolean(row.billCancel),
    feeRead: boolean(row.feeRead),
    feeCreate: boolean(row.feeCreate),
    feeUpdate: boolean(row.feeUpdate),
    feeLaunch: boolean(row.feeLaunch),
    feeDelete: boolean(row.feeDelete),
  };
}

export async function getCaseSettlement(
  caseId: string,
  options: RequestOptions = {},
): Promise<CaseSettlement> {
  const row = record(
    await getJson(`/settlements/cases/${encodeURIComponent(caseId)}`, options),
  );
  const customer = record(row.customer);
  const figures = record(row.figures);
  const customerBalance = record(row.customerBalance);
  const lawyerBalance = record(row.lawyerBalance);
  const terms = row.terms === null ? null : record(row.terms);
  const mode = terms?.lawyerMode;
  if (
    mode !== undefined &&
    mode !== null &&
    mode !== 'FULL_RISK' &&
    mode !== 'HALF_RISK' &&
    mode !== 'FIXED_FEE'
  )
    throw invalid();
  const source = (value: unknown): 'AUTOMATIC' | 'MANUAL' => {
    if (value !== 'AUTOMATIC' && value !== 'MANUAL') throw invalid();
    return value;
  };
  const balance = (value: Record<string, unknown>) => ({
    launched: string(value.launched),
    remaining: nullableString(value.remaining),
    overLaunched: boolean(value.overLaunched),
  });
  return {
    caseId: string(row.caseId),
    businessNo: string(row.businessNo),
    stage: string(row.stage),
    customer: { id: string(customer.id), name: string(customer.name) },
    lawyers: list(row.lawyers, (value) => {
      const item = record(value);
      return {
        id: string(item.id),
        name: string(item.name),
        firm: nullableString(item.firm),
      };
    }),
    termsVersion: number(row.termsVersion),
    terms:
      terms === null
        ? null
        : {
            customerFormula: nullableString(terms.customerFormula),
            lawyerMode: mode as LawyerSettlementMode | null,
            lawyerBaseFee: nullableString(terms.lawyerBaseFee),
            lawyerSplitPercent: nullableString(terms.lawyerSplitPercent),
            customerManualAmount: nullableString(terms.customerManualAmount),
            lawyerManualAmount: nullableString(terms.lawyerManualAmount),
          },
    figures: {
      basis: nullableString(figures.basis),
      customerPercent: nullableString(figures.customerPercent),
      customerAutomaticAmount: nullableString(figures.customerAutomaticAmount),
      customerAmount: nullableString(figures.customerAmount),
      customerSource: source(figures.customerSource),
      lawyerAutomaticAmount: nullableString(figures.lawyerAutomaticAmount),
      lawyerAmount: nullableString(figures.lawyerAmount),
      lawyerSource: source(figures.lawyerSource),
    },
    customerBalance: balance(customerBalance),
    lawyerBalance: balance(lawyerBalance),
    launches: list(row.launches, launch),
  };
}

export async function updateCaseSettlementTerms(
  caseId: string,
  body: {
    expectedTermsVersion: number;
    idempotencyKey: string;
    side: SettlementSide;
    customerFormula?: string;
    lawyerMode?: LawyerSettlementMode;
    lawyerBaseFee?: string;
    lawyerSplitPercent?: string;
    manualAmount?: string | null;
  },
): Promise<{ caseId: string; termsVersion: number }> {
  const row = record(
    await requestJson(
      `/settlements/cases/${encodeURIComponent(caseId)}/terms`,
      { method: 'PUT', body },
    ),
  );
  return { caseId: string(row.caseId), termsVersion: number(row.termsVersion) };
}

export async function launchSettlement(
  caseId: string,
  body: {
    side: SettlementSide;
    amount: string;
    launchDate: string;
    note?: string;
    lawyerId?: string;
    expectedTermsVersion: number;
    idempotencyKey: string;
  },
): Promise<{ id: string; nth: number; amount: string }> {
  const row = record(
    await requestJson(
      `/settlements/cases/${encodeURIComponent(caseId)}/launches`,
      { method: 'POST', body },
    ),
  );
  return {
    id: string(row.id),
    nth: number(row.nth),
    amount: string(row.amount),
  };
}

export async function listSettlementLaunches(
  sideValue: SettlementSide,
  pageNumber = 1,
  options: RequestOptions = {},
  filters: {
    keyword?: string;
    stage?: string;
    billed?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<SettlementLaunchPage> {
  const params = new URLSearchParams({
    side: sideValue,
    page: String(pageNumber),
    pageSize: '100',
  });
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value);
  const response = record(
    await getJson(`/settlements/launches?${params}`, options),
  );
  const summary = record(response.summary);
  const result = page(response, (value) => {
    const row = record(value);
    return {
      ...launch(row),
      businessNo: string(row.businessNo),
      stage: string(row.stage),
      payeeId: nullableString(row.payeeId),
      payeeName: nullableString(row.payeeName),
      lawFirm: nullableString(row.lawFirm),
      invoiceAmount: nullableString(row.invoiceAmount),
      receivedAmount: nullableString(row.receivedAmount),
      paidAmount: nullableString(row.paidAmount),
      actualPaymentDate: nullableString(row.actualPaymentDate),
    };
  });
  return {
    ...result,
    matchingIds: list(response.matchingIds, string),
    summary: {
      launchedAmount: string(summary.launchedAmount),
      billedAmount: string(summary.billedAmount),
      unbilledAmount: string(summary.unbilledAmount),
      unbilledCount: number(summary.unbilledCount),
      launchCount: number(summary.launchCount),
      billedCount: number(summary.billedCount),
      invoiceAmount: nullableString(summary.invoiceAmount),
      receivedAmount: nullableString(summary.receivedAmount),
      paidAmount: nullableString(summary.paidAmount),
      cooperatingPayeeCount: number(summary.cooperatingPayeeCount),
      knownLawFirmCount: number(summary.knownLawFirmCount),
    },
  };
}

export type SettlementLaunchPage = Page<CenterLaunch> & {
  matchingIds: string[];
  summary: {
    launchedAmount: string;
    billedAmount: string;
    unbilledAmount: string;
    unbilledCount: number;
    launchCount: number;
    billedCount: number;
    invoiceAmount: string | null;
    receivedAmount: string | null;
    paidAmount: string | null;
    cooperatingPayeeCount: number;
    knownLawFirmCount: number;
  };
};

export async function listSettlementBills(
  sideValue: SettlementSide,
  pageNumber = 1,
  options: RequestOptions = {},
  filters: {
    keyword?: string;
    billState?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<Page<SettlementBill>> {
  const params = new URLSearchParams({
    side: sideValue,
    page: String(pageNumber),
    pageSize: '100',
  });
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value);
  return page(await getJson(`/settlements/bills?${params}`, options), bill);
}

export async function previewSettlementBillNumber(
  billDate: string,
  options: RequestOptions = {},
): Promise<string> {
  const row = record(
    await getJson(
      `/settlements/bill-number-preview?${new URLSearchParams({ billDate })}`,
      options,
    ),
  );
  if (row.reserved !== false) throw invalid();
  return string(row.billNo);
}

export async function getSettlementBill(
  billId: string,
): Promise<SettlementBillDetail> {
  const row = record(
    await getJson(`/settlements/bills/${encodeURIComponent(billId)}`),
  );
  return {
    id: string(row.id),
    billNo: string(row.billNo),
    side: side(row.side),
    billDate: string(row.billDate),
    amount: string(row.amount),
    note: nullableString(row.note),
    cancelledAt: nullableString(row.cancelledAt),
    cancellationReason: nullableString(row.cancellationReason),
    items: list(row.items, (value) => {
      const item = record(value);
      return {
        id: string(item.id),
        launchId: string(item.launchId),
        caseId: string(item.caseId),
        ...(Object.hasOwn(item, 'caseBusinessNo')
          ? { caseBusinessNo: businessNumber(item.caseBusinessNo) }
          : {}),
        ...(Object.hasOwn(item, 'launchDate')
          ? { launchDate: financialDay(item.launchDate) }
          : {}),
        payeeId: string(item.payeeId),
        payeeName: string(item.payeeName),
        nth: number(item.nth),
        amount: string(item.amount),
      };
    }),
  };
}

export async function createSettlementBill(body: {
  side: SettlementSide;
  billDate: string;
  launchIds: string[];
  note?: string;
  idempotencyKey: string;
}): Promise<{ id: string; billNo: string; amount: string }> {
  const row = record(
    await requestJson('/settlements/bills', { method: 'POST', body }),
  );
  return {
    id: string(row.id),
    billNo: string(row.billNo),
    amount: string(row.amount),
  };
}

export async function cancelSettlementBill(
  billId: string,
  body: { reason?: string; idempotencyKey: string },
): Promise<{ id: string; billNo: string; cancelledAt: string }> {
  const row = record(
    await requestJson(
      `/settlements/bills/${encodeURIComponent(billId)}/cancel`,
      { method: 'POST', body },
    ),
  );
  return {
    id: string(row.id),
    billNo: string(row.billNo),
    cancelledAt: string(row.cancelledAt),
  };
}

export async function listFees(
  query: {
    page?: number;
    caseId?: string;
    type?: string;
    status?: string;
    direction?: string;
    from?: string;
    to?: string;
  } = {},
  options: RequestOptions = {},
): Promise<
  Page<FeeRow> & {
    matchingIds: string[];
    matchingSources: FeeSelectionSource[];
    summary: {
      expense: string;
      income: string;
      pending: string;
      pendingCount: number;
    };
  }
> {
  const params = new URLSearchParams({
    page: String(query.page ?? 1),
    pageSize: '100',
  });
  for (const key of [
    'caseId',
    'type',
    'status',
    'direction',
    'from',
    'to',
  ] as const)
    if (query[key]) params.set(key, query[key]);
  const row = record(await getJson(`/fees?${params}`, options));
  const summary = record(row.summary);
  const result = page(row, fee);
  const matchingIds = list(row.matchingIds, string);
  const matchingSources = list(row.matchingSources, (value) => {
    const source = record(value);
    return {
      id: string(source.id),
      businessNo: string(source.businessNo),
      type: string(source.type),
      amount: string(source.amount),
      status: string(source.status),
    };
  });
  const byId = new Map(matchingSources.map((source) => [source.id, source]));
  if (
    byId.size !== matchingSources.length ||
    new Set(matchingIds).size !== matchingIds.length ||
    matchingIds.length !== byId.size ||
    matchingIds.some((id) => !byId.has(id))
  )
    throw invalid();
  for (const item of result.items)
    for (const source of item.sourceRows ?? [item]) {
      const match = byId.get(source.id);
      if (
        !match ||
        match.amount !== source.amount ||
        match.status !== source.status ||
        match.type !== source.type ||
        match.businessNo !== source.businessNo
      )
        throw invalid();
    }
  return {
    ...result,
    matchingIds,
    matchingSources,
    summary: {
      expense: string(summary.expense),
      income: string(summary.income),
      pending: string(summary.pending),
      pendingCount: number(summary.pendingCount),
    },
  };
}

export type FinancialCaseOption = {
  id: string;
  businessNo: string;
  courtCaseNo: string | null;
  customerName: string;
  rightsHolderName: string;
  shopName: string | null;
  defendantNames: string[];
};
export async function listFinancialCaseOptions(
  query = '',
  pageNumber = 1,
  options: RequestOptions = {},
): Promise<Page<FinancialCaseOption>> {
  const params = new URLSearchParams({
    query,
    page: String(pageNumber),
    pageSize: '20',
  });
  return page(
    await getJson(`/fees/case-options?${params}`, options),
    (value) => {
      const row = record(value);
      return {
        id: string(row.id),
        businessNo: string(row.businessNo),
        courtCaseNo: nullableString(row.courtCaseNo),
        customerName: string(row.customerName),
        rightsHolderName: string(row.rightsHolderName),
        shopName: nullableString(row.shopName),
        defendantNames: list(row.defendantNames, string),
      };
    },
  );
}

export async function createFee(body: {
  caseId: string;
  type: string;
  direction: '收入' | '支出';
  amount: string;
  status: string;
  feeDate: string;
  note?: string;
  idempotencyKey: string;
}): Promise<{ id: string; version: number }> {
  const row = record(await requestJson('/fees', { method: 'POST', body }));
  return { id: string(row.id), version: number(row.version) };
}

export async function updateFee(
  feeId: string,
  body: {
    expectedVersion: number;
    status?: string;
    direction?: '收入' | '支出';
    note?: string;
  },
): Promise<{ id: string; version: number }> {
  const row = record(
    await requestJson(`/fees/${encodeURIComponent(feeId)}`, {
      method: 'PATCH',
      body,
    }),
  );
  return { id: string(row.id), version: number(row.version) };
}

export async function batchFees(
  command: 'launch' | 'delete',
  body: { ids: string[]; idempotencyKey: string },
): Promise<{ processedIds: string[]; amount: string; processedCount: number }> {
  const row = record(
    await requestJson(`/fees/${command}`, { method: 'POST', body }),
  );
  return {
    processedIds: list(row.processedIds, string),
    amount: string(row.amount),
    processedCount: number(row.processedCount),
  };
}

export async function updateFeeProof(
  feeId: string,
  body: {
    expectedVersion: number;
    materialId: string | null;
    contentVersionId: string | null;
    idempotencyKey: string;
  },
): Promise<{ id: string; version: number }> {
  const row = record(
    await requestJson(`/fees/${encodeURIComponent(feeId)}/proof`, {
      method: 'POST',
      body,
    }),
  );
  return { id: string(row.id), version: number(row.version) };
}

export async function createCaseFeeEntries(body: {
  caseId: string;
  rows: Parameters<typeof createFee>[0][];
  idempotencyKey: string;
}): Promise<{ createdIds: string[]; createdCount: number }> {
  const result = record(
    await requestJson('/fees/case-entries', { method: 'POST', body }),
  );
  const createdIds = list(result.createdIds, string);
  const createdCount = number(result.createdCount);
  if (
    createdIds.length !== createdCount ||
    createdCount !== body.rows.length ||
    new Set(createdIds).size !== createdIds.length
  )
    throw invalid();
  return { createdIds, createdCount };
}
