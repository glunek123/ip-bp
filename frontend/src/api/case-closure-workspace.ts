import { ApiError, getJson, type RequestOptions } from './http';

const invalid = (): never => {
  throw new ApiError('服务返回了无效的结案工作区数据', 200, 'INVALID_RESPONSE');
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return invalid();
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : invalid();
}
function id(value: unknown): string {
  const result = text(value);
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(result)
    ? result
    : invalid();
}
function positive(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : invalid();
}
function choice<const T extends string>(
  value: unknown,
  choices: readonly T[],
): T {
  for (const option of choices) if (value === option) return option;
  return invalid();
}
function nullable<T>(value: unknown, parse: (input: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function array<T>(value: unknown, parse: (input: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function money(value: unknown): string {
  const result = text(value);
  return /^(?:0|[1-9]\d*)\.\d{2}$/u.test(result) ? result : invalid();
}
function date(value: unknown): string {
  const result = text(value);
  return /^\d{4}-\d{2}-\d{2}$/u.test(result) &&
    !Number.isNaN(Date.parse(result)) &&
    new Date(result).toISOString().slice(0, 10) === result
    ? result
    : invalid();
}
function document(value: unknown) {
  const row = object(value, ['materialId', 'contentVersionId']);
  return {
    materialId: id(row.materialId),
    contentVersionId: id(row.contentVersionId),
  };
}

/** Display data only: these values never certify archive readiness or permit a write. */
export function decodeCaseClosureWorkspace(
  value: unknown,
  expectedCaseId: string,
) {
  const row = object(value, [
    'readPurpose',
    'caseId',
    'caseVersion',
    'stage',
    'actualRegistrationLawyers',
    'closure',
    'effectivePayments',
    'documents',
    'refund',
    'assessment',
    'actual',
  ]);
  const caseId = id(row.caseId);
  if (caseId.toLowerCase() !== expectedCaseId.toLowerCase()) return invalid();
  const closure = object(row.closure, [
    'versionId',
    'closeOn',
    'amountState',
    'amount',
    'paymentType',
  ]);
  const refund = object(row.refund, [
    'versionId',
    'revision',
    'declaration',
    'items',
  ]);
  const assessment = object(row.assessment, [
    'versionId',
    'revision',
    'closureVersionId',
    'termsVersion',
    'declaration',
    'matchesCurrent',
    'customerAmount',
    'lawyerAmount',
  ]);
  const actual = object(row.actual, [
    'connection',
    'scope',
    'customerReceiptState',
    'lawyerInvoiceState',
    'customerReceivedAmount',
    'lawyerInvoicedAmount',
  ]);
  const actualResult = {
    connection: choice(actual.connection, ['CONNECTED', 'NOT_CONNECTED']),
    scope: nullable(actual.scope, (v) => choice(v, ['CASE', 'CONSOLIDATION'])),
    customerReceiptState: choice(actual.customerReceiptState, [
      'RECORDED',
      'UNKNOWN',
    ]),
    lawyerInvoiceState: choice(actual.lawyerInvoiceState, [
      'RECORDED',
      'UNKNOWN',
    ]),
    customerReceivedAmount: nullable(actual.customerReceivedAmount, money),
    lawyerInvoicedAmount: nullable(actual.lawyerInvoicedAmount, money),
  };
  if (
    (actualResult.customerReceiptState === 'UNKNOWN') !==
      (actualResult.customerReceivedAmount === null) ||
    (actualResult.lawyerInvoiceState === 'UNKNOWN') !==
      (actualResult.lawyerInvoicedAmount === null) ||
    (actualResult.connection === 'CONNECTED') !==
      (actualResult.scope !== null) ||
    (actualResult.connection === 'NOT_CONNECTED' &&
      (actualResult.customerReceivedAmount !== null ||
        actualResult.lawyerInvoicedAmount !== null))
  )
    return invalid();
  return {
    readPurpose: choice(row.readPurpose, ['DISPLAY_ONLY']),
    caseId,
    caseVersion: positive(row.caseVersion),
    actualRegistrationLawyers: array(row.actualRegistrationLawyers, (value) => {
      const lawyer = object(value, ['id', 'fullName']);
      const fullName = text(lawyer.fullName);
      if (fullName.trim().length === 0 || fullName.length > 200)
        return invalid();
      return { id: id(lawyer.id), fullName };
    }),
    stage: choice(row.stage, [
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'WAITING_FORMAL_ACCEPTANCE',
      'WAITING_HEARING',
      'WAITING_JUDGMENT',
      'SECOND_INSTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
      'WAITING_EXECUTION_FILING',
      'EXECUTING',
      'WAITING_ARCHIVE',
      'ARCHIVED',
    ]),
    closure: {
      versionId: nullable(closure.versionId, id),
      closeOn: nullable(closure.closeOn, date),
      amountState: choice(closure.amountState, ['UNKNOWN', 'KNOWN', 'PENDING']),
      amount: nullable(closure.amount, money),
      paymentType: choice(closure.paymentType, [
        'UNKNOWN',
        'ONE_TIME',
        'INSTALLMENTS',
      ]),
    },
    effectivePayments: array(row.effectivePayments, (value) => {
      const p = object(value, [
        'versionId',
        'paymentId',
        'revision',
        'paidOn',
        'amount',
        'payer',
        'payee',
        'documents',
      ]);
      return {
        versionId: id(p.versionId),
        paymentId: id(p.paymentId),
        revision: positive(p.revision),
        paidOn: date(p.paidOn),
        amount: money(p.amount),
        payer: text(p.payer),
        payee: text(p.payee),
        documents: array(p.documents, document),
      };
    }),
    documents: array(row.documents, (value) => {
      const d = object(value, [
        'closureVersionId',
        'materialId',
        'contentVersionId',
      ]);
      return {
        closureVersionId: id(d.closureVersionId),
        materialId: id(d.materialId),
        contentVersionId: id(d.contentVersionId),
      };
    }),
    refund: {
      versionId: nullable(refund.versionId, id),
      revision: nullable(refund.revision, positive),
      declaration: choice(refund.declaration, [
        'UNKNOWN',
        'COMPLETE',
        'NOT_APPLICABLE',
      ]),
      items: array(refund.items, (value) => {
        const i = object(value, [
          'itemId',
          'party',
          'status',
          'description',
          'amount',
        ]);
        return {
          itemId: text(i.itemId),
          party: choice(i.party, ['COURT', 'DEFENDANT']),
          status: choice(i.status, [
            'UNKNOWN',
            'PENDING',
            'SUBMITTED',
            'RETURNED_UNSETTLED',
            'SETTLED',
            'RECEIVED',
            'CONVERTED_TO_COST',
          ]),
          description: text(i.description),
          amount: nullable(i.amount, (value) =>
            typeof value === 'string' &&
            /^(?:0|[1-9]\d{0,13})\.\d{2}$/u.test(value)
              ? value
              : invalid(),
          ),
        };
      }),
    },
    assessment: {
      versionId: nullable(assessment.versionId, id),
      revision: nullable(assessment.revision, positive),
      closureVersionId: nullable(assessment.closureVersionId, id),
      termsVersion: nullable(assessment.termsVersion, positive),
      declaration: choice(assessment.declaration, [
        'UNKNOWN',
        'APPLICABLE',
        'NOT_APPLICABLE',
      ]),
      matchesCurrent: nullable(assessment.matchesCurrent, (v) =>
        typeof v === 'boolean' ? v : invalid(),
      ),
      customerAmount: nullable(assessment.customerAmount, money),
      lawyerAmount: nullable(assessment.lawyerAmount, money),
    },
    actual: actualResult,
  };
}
export type CaseClosureWorkspace = ReturnType<
  typeof decodeCaseClosureWorkspace
>;

export async function getCaseClosureWorkspace(
  caseId: string,
  options: RequestOptions = {},
): Promise<CaseClosureWorkspace> {
  const response = await getJson(
    `/cases/${encodeURIComponent(caseId)}/closure-workspace`,
    options,
  );
  return decodeCaseClosureWorkspace(response, caseId);
}
