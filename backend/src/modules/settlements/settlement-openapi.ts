import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
const string: SchemaObject = { type: 'string' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const money: SchemaObject = {
  type: 'string',
  pattern: '^-?(0|[1-9][0-9]*)\\.[0-9]{2}$',
};
const count: SchemaObject = { type: 'integer', minimum: 0 };
const positive: SchemaObject = { type: 'integer', minimum: 1 };
const bool: SchemaObject = { type: 'boolean' };
const side: SchemaObject = { type: 'string', enum: ['CUSTOMER', 'LAWYER'] };
const day: SchemaObject = { type: 'string', format: 'date' };
const timestamp: SchemaObject = { type: 'string', format: 'date-time' };
const nullable = (value: SchemaObject): SchemaObject => ({
  ...value,
  nullable: true,
});
const array = (items: SchemaObject): SchemaObject => ({ type: 'array', items });
const object = (
  properties: Record<string, SchemaObject>,
  optional: string[] = [],
): SchemaObject => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
const balance = object({
  launched: money,
  remaining: nullable(money),
  overLaunched: bool,
});
const terms = object({
  customerFormula: nullable(string),
  lawyerMode: nullable({
    type: 'string',
    enum: ['FULL_RISK', 'HALF_RISK', 'FIXED_FEE'],
  }),
  lawyerBaseFee: nullable(money),
  lawyerSplitPercent: nullable(string),
  customerManualAmount: nullable(money),
  lawyerManualAmount: nullable(money),
});
const figures = object({
  basis: nullable(money),
  customerPercent: nullable(string),
  customerAutomaticAmount: nullable(money),
  customerAmount: nullable(money),
  customerSource: { type: 'string', enum: ['AUTOMATIC', 'MANUAL'] },
  lawyerAutomaticAmount: nullable(money),
  lawyerAmount: nullable(money),
  lawyerSource: { type: 'string', enum: ['AUTOMATIC', 'MANUAL'] },
});
const launchFields = {
  id: uuid,
  caseId: uuid,
  side,
  nth: positive,
  amount: money,
  launchDate: day,
  note: nullable(string),
  billId: nullable(uuid),
  customerId: nullable(uuid),
  lawyerId: nullable(uuid),
};
const centerLaunch = object({
  ...launchFields,
  businessNo: string,
  stage: string,
  payeeId: nullable(uuid),
  payeeName: nullable(string),
  lawFirm: nullable(string),
  invoiceAmount: nullable(money),
  receivedAmount: nullable(money),
  paidAmount: nullable(money),
  actualPaymentDate: nullable(day),
});
const billFields = {
  id: uuid,
  billNo: string,
  side,
  billDate: day,
  amount: money,
  note: nullable(string),
  cancelledAt: nullable(timestamp),
};
const billItem = object({
  id: uuid,
  launchId: uuid,
  caseId: uuid,
  payeeId: uuid,
  payeeName: string,
  nth: positive,
  amount: money,
});
const page = (
  items: SchemaObject,
  extra: Record<string, SchemaObject> = {},
): SchemaObject =>
  object({
    items: array(items),
    total: count,
    page: positive,
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    ...extra,
  });
/** JSON response contracts; monetary values remain exact decimal strings. */
const feeSourceFields = {
  id: uuid,
  caseId: uuid,
  businessNo: string,
  courtCaseNo: nullable(string),
  platform: nullable(string),
  shopName: nullable(string),
  defendantNames: array(string),
  stage: string,
  type: string,
  direction: { type: 'string', enum: ['收入', '支出'] } as SchemaObject,
  status: string,
  amount: money,
  feeDate: day,
  source: { type: 'string', enum: ['manual', 'auto'] } as SchemaObject,
  note: nullable(string),
  version: positive,
  proofMaterialId: nullable(uuid),
  proofContentVersionId: nullable(uuid),
  proofOriginalFilename: nullable(string),
};
const feeSourceRow: SchemaObject = {
  ...object(feeSourceFields),
  additionalProperties: false,
};
const feeNetRow: SchemaObject = {
  ...object({
    ...feeSourceFields,
    type: { type: 'string', enum: ['样品费'] },
    direction: { type: 'string', enum: ['支出'] },
    proofMaterialId: { ...nullable(uuid), enum: [null] },
    proofContentVersionId: { ...nullable(uuid), enum: [null] },
    proofOriginalFilename: { ...nullable(string), enum: [null] },
    mergeTypes: {
      ...array({ type: 'string', enum: ['样品费', '样品费退款'] }),
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
    },
    sourceRows: { ...array(feeSourceRow), minItems: 2 },
  }),
  additionalProperties: false,
  description:
    '样品净额只读投影。状态、日期保留代表记录；所有选择和动作使用sourceRows中的独立原始费用及原额。',
};
export const settlementResponses = {
  context: object({
    read: bool,
    termsUpdate: bool,
    launch: bool,
    billCreate: bool,
    billCancel: bool,
    feeRead: bool,
    feeCreate: bool,
    feeUpdate: bool,
    feeLaunch: bool,
    feeDelete: bool,
  }),
  caseDetail: object({
    caseId: uuid,
    businessNo: string,
    stage: string,
    customer: object({ id: uuid, name: string }),
    lawyers: array(
      object({
        assignmentId: uuid,
        id: uuid,
        name: string,
        firm: nullable(string),
      }),
    ),
    amountSource: object({
      rootId: nullable(uuid),
      sourceVersionId: nullable(uuid),
      revision: count,
      state: { type: 'string', enum: ['UNRECORDED', 'KNOWN', 'PENDING'] },
      amount: nullable(money),
    }),
    termsVersion: count,
    terms: nullable(terms),
    figures,
    customerBalance: balance,
    lawyerBalance: balance,
    launches: array(object(launchFields)),
  }),
  termsReceipt: object({ caseId: uuid, termsVersion: positive }),
  launchReceipt: object({ id: uuid, nth: positive, amount: money }),
  launches: page(centerLaunch, {
    matchingIds: array(uuid),
    summary: object({
      launchedAmount: money,
      billedAmount: money,
      unbilledAmount: money,
      unbilledCount: count,
      launchCount: count,
      billedCount: count,
      invoiceAmount: nullable(money),
      receivedAmount: nullable(money),
      paidAmount: nullable(money),
      cooperatingPayeeCount: count,
      knownLawFirmCount: count,
    }),
  }),
  bills: page(
    object({ ...billFields, payees: array(string), count: positive }),
  ),
  billReceipt: object({ id: uuid, billNo: string, amount: money }),
  billDetail: object({
    ...billFields,
    cancellationReason: nullable(string),
    items: array(billItem),
  }),
  billCancelReceipt: object({
    id: uuid,
    billNo: string,
    cancelledAt: timestamp,
  }),
  billPreview: object({
    billNo: string,
    reserved: { type: 'boolean', enum: [false] },
  }),
  fees: page(
    { oneOf: [feeSourceRow, feeNetRow] },
    {
      matchingIds: array(uuid),
      matchingSources: array(
        object({
          id: uuid,
          businessNo: string,
          type: string,
          amount: money,
          status: string,
        }),
      ),
      summary: object({
        expense: money,
        income: money,
        pending: money,
        pendingCount: count,
      }),
    },
  ),
  feeReceipt: {
    ...object({ id: uuid, version: positive }),
    additionalProperties: false,
  },
  feeBatchReceipt: {
    ...object({
      processedIds: array(uuid),
      amount: money,
      processedCount: positive,
    }),
    additionalProperties: false,
  },
  feeCaseOptions: {
    ...page(
      object({
        id: uuid,
        businessNo: string,
        courtCaseNo: nullable(string),
        customerName: string,
        rightsHolderName: string,
        shopName: nullable(string),
        defendantNames: array(string),
      }),
    ),
    additionalProperties: false,
  },
  caseFeeEntries: object({ createdIds: array(uuid), createdCount: positive }),
};
