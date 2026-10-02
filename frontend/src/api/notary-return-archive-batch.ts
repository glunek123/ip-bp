import { ApiError, requestJson } from './http';
import {
  isNotaryReturnArchiveSummary,
  isValidNotaryReturnAmountInput,
  type ArchiveNotaryReturnInput,
  type ArchiveNotaryReturnResponse,
} from './notary';

export type ArchiveNotaryReturnBatchInput = ArchiveNotaryReturnInput & {
  matterId: string;
};
export type ArchiveNotaryReturnBatchResponse = {
  batchId: string;
  items: ArchiveNotaryReturnResponse[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function invalidInput(): ApiError {
  return new ApiError('批量退货归档信息无效', 400, 'VALIDATION_ERROR');
}

function invalidResponse(): ApiError {
  return new ApiError('批次归档响应无效', 500, 'INTERNAL_ERROR');
}

function validInput(input: ArchiveNotaryReturnBatchInput): boolean {
  if (
    !isRecord(input) ||
    !uuidPattern.test(input.matterId) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !['RETURN', 'KEEP', 'REFUND_ONLY'].includes(input.returnChoice) ||
    typeof input.archiveReason !== 'string' ||
    !input.archiveReason.trim() ||
    [...input.archiveReason.trim()].length > 5000
  )
    return false;
  const keys = ['matterId', 'returnChoice', 'archiveReason', 'expectedVersion'];
  if (input.refund !== undefined) keys.push('refund');
  if (input.freight !== undefined) keys.push('freight');
  if (!exactKeys(input, keys)) return false;
  const validChoice =
    (input.returnChoice === 'RETURN' &&
      input.refund !== undefined &&
      input.freight !== undefined) ||
    (input.returnChoice === 'REFUND_ONLY' &&
      input.refund !== undefined &&
      input.freight === undefined) ||
    (input.returnChoice === 'KEEP' &&
      input.refund === undefined &&
      input.freight === undefined);
  return (
    validChoice &&
    (input.refund === undefined ||
      isValidNotaryReturnAmountInput(input.refund)) &&
    (input.freight === undefined ||
      isValidNotaryReturnAmountInput(input.freight))
  );
}

function sameAmount(
  summary: unknown,
  input: ArchiveNotaryReturnInput['refund'],
): boolean {
  if (input === undefined) return summary === null;
  if (!isRecord(summary)) return false;
  if (input.state === 'PENDING')
    return (
      summary.state === 'PENDING' &&
      summary.amount === null &&
      summary.partyKind === null &&
      summary.partyName === null
    );
  return (
    summary.state === 'KNOWN' &&
    summary.amount === input.amount &&
    summary.partyKind === (input.partyKind ?? null) &&
    summary.partyName === (input.partyName ?? null)
  );
}

function matchesInput(
  result: unknown,
  input: ArchiveNotaryReturnBatchInput,
): result is ArchiveNotaryReturnResponse {
  return (
    isRecord(result) &&
    exactKeys(result, ['id', 'stage', 'version', 'returnArchive']) &&
    result.id === input.matterId.toLowerCase() &&
    result.stage === 'ARCHIVED' &&
    result.version === input.expectedVersion + 1 &&
    isNotaryReturnArchiveSummary(result.returnArchive) &&
    result.returnArchive.returnChoice === input.returnChoice &&
    result.returnArchive.archiveReason === input.archiveReason.trim() &&
    sameAmount(result.returnArchive.refund, input.refund) &&
    sameAmount(result.returnArchive.freight, input.freight)
  );
}

export async function archiveNotaryReturnBatch(
  items: ArchiveNotaryReturnBatchInput[],
  idempotencyKey: string,
): Promise<ArchiveNotaryReturnBatchResponse> {
  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 50 ||
    items.some((item) => !validInput(item)) ||
    new Set(items.map((item) => item.matterId.toLowerCase())).size !==
      items.length ||
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length < 1 ||
    idempotencyKey.length > 128
  )
    throw invalidInput();

  const body = {
    items: items.map((item) => ({
      matterId: item.matterId.toLowerCase(),
      returnChoice: item.returnChoice,
      ...(item.refund ? { refund: { ...item.refund } } : {}),
      ...(item.freight ? { freight: { ...item.freight } } : {}),
      archiveReason: item.archiveReason.trim(),
      expectedVersion: item.expectedVersion,
    })),
  };
  const data: unknown = await requestJson(
    '/notary-matters/return-archive-batches',
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
      retryOnCsrfInvalid: false,
    },
  );
  const expected = [...items].sort((left, right) =>
    left.matterId.toLowerCase() < right.matterId.toLowerCase()
      ? -1
      : left.matterId.toLowerCase() > right.matterId.toLowerCase()
        ? 1
        : 0,
  );
  if (
    !isRecord(data) ||
    !exactKeys(data, ['batchId', 'items']) ||
    typeof data.batchId !== 'string' ||
    !uuidPattern.test(data.batchId) ||
    !Array.isArray(data.items) ||
    data.items.length !== expected.length ||
    !data.items.every((item, index) => matchesInput(item, expected[index]))
  )
    throw invalidResponse();
  return data as ArchiveNotaryReturnBatchResponse;
}
