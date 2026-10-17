import type {
  CorrectExecutionFilingFeedbackInput,
  CorrectExecutionFilingSupplementInput,
  RecordExecutionFilingFeedbackInput,
  SubmitExecutionFilingSupplementInput,
} from '../../api/cases';

export type FollowupCommand =
  | 'record-feedback'
  | 'correct-feedback'
  | 'submit-supplement'
  | 'correct-supplement';
export type FollowupBody =
  | RecordExecutionFilingFeedbackInput
  | CorrectExecutionFilingFeedbackInput
  | SubmitExecutionFilingSupplementInput
  | CorrectExecutionFilingSupplementInput;
export type FollowupIdentity = {
  actor: string;
  caseId: string;
  filingId: string;
  command: FollowupCommand;
  rootId: string;
};
export type FollowupPending = {
  identity: FollowupIdentity;
  body: FollowupBody;
};

const prefix = 'case-execution-filing-followup:v1:';
const key = (identity: FollowupIdentity) =>
  prefix +
  [
    identity.actor,
    identity.caseId.toLowerCase(),
    identity.filingId.toLowerCase(),
    identity.command,
    identity.rootId.toLowerCase(),
  ]
    .map(encodeURIComponent)
    .join(':');
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
const same = (left: unknown, right: unknown) =>
  typeof left === 'string' &&
  typeof right === 'string' &&
  left.toLowerCase() === right.toLowerCase();
const date = (value: unknown) => {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};
const optionalText = (value: unknown, max: number) => {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    text.length > 0 &&
    Array.from(text).length -
      (text.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/gu)?.length ?? 0) <=
      max
  );
};
const exact = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));

export function validFollowupPending(
  value: unknown,
  identity: FollowupIdentity,
): value is FollowupPending {
  if (
    !identity.actor ||
    !uuid(identity.caseId) ||
    !uuid(identity.filingId) ||
    !uuid(identity.rootId) ||
    ![
      'record-feedback',
      'correct-feedback',
      'submit-supplement',
      'correct-supplement',
    ].includes(identity.command)
  )
    return false;
  if (!record(value) || !exact(value, ['identity', 'body'])) return false;
  const stored = value.identity;
  const body = value.body;
  if (
    !record(stored) ||
    !exact(stored, ['actor', 'caseId', 'filingId', 'command', 'rootId']) ||
    stored.actor !== identity.actor ||
    !same(stored.caseId, identity.caseId) ||
    !same(stored.filingId, identity.filingId) ||
    stored.command !== identity.command ||
    !same(stored.rootId, identity.rootId) ||
    !record(body) ||
    typeof body.idempotencyKey !== 'string' ||
    body.idempotencyKey.trim().length === 0 ||
    body.idempotencyKey.length > 128 ||
    !Number.isSafeInteger(body.expectedRevision)
  )
    return false;
  const correcting = identity.command.startsWith('correct-');
  if (correcting) {
    if (
      !exact(body, [
        'idempotencyKey',
        'expectedRevision',
        'correctionReason',
        ...(identity.command === 'correct-feedback'
          ? ['feedbackOn', 'courtCaseNo', 'content']
          : ['submittedOn', 'note', 'contentVersionIds']),
      ]) ||
      typeof body.expectedRevision !== 'number' ||
      body.expectedRevision < 1 ||
      !optionalText(body.correctionReason, 500) ||
      body.correctionReason === null
    )
      return false;
  } else if (
    !exact(body, [
      'idempotencyKey',
      'expectedRevision',
      identity.command === 'record-feedback' ? 'feedbackId' : 'supplementId',
      ...(identity.command === 'record-feedback'
        ? ['feedbackOn', 'courtCaseNo', 'content']
        : ['submittedOn', 'note', 'contentVersionIds']),
    ]) ||
    body.expectedRevision !== 0 ||
    !same(
      body[
        identity.command === 'record-feedback' ? 'feedbackId' : 'supplementId'
      ],
      identity.rootId,
    )
  )
    return false;
  if (identity.command.endsWith('feedback'))
    return (
      date(body.feedbackOn) &&
      optionalText(body.courtCaseNo, 100) &&
      optionalText(body.content, 2000) &&
      body.content !== null
    );
  return (
    date(body.submittedOn) &&
    optionalText(body.note, 2000) &&
    Array.isArray(body.contentVersionIds) &&
    body.contentVersionIds.length >= 1 &&
    body.contentVersionIds.length <= 10 &&
    body.contentVersionIds.every(uuid) &&
    new Set(body.contentVersionIds.map((id: string) => id.toLowerCase()))
      .size === body.contentVersionIds.length
  );
}

export function readFollowupPending(
  identity: FollowupIdentity,
): FollowupPending | null | 'damaged' {
  try {
    const raw = sessionStorage.getItem(key(identity));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return validFollowupPending(parsed, identity) ? parsed : 'damaged';
  } catch {
    return 'damaged';
  }
}

export function saveFollowupPending(pending: FollowupPending): void {
  if (!validFollowupPending(pending, pending.identity))
    throw new Error('待核对请求无效');
  const existing = readFollowupPending(pending.identity);
  if (
    existing === 'damaged' ||
    (existing && JSON.stringify(existing) !== JSON.stringify(pending))
  )
    throw new Error('原请求仍待核对');
  sessionStorage.setItem(key(pending.identity), JSON.stringify(pending));
}

export function clearFollowupPending(pending: FollowupPending): void {
  const existing = readFollowupPending(pending.identity);
  if (existing === 'damaged') throw new Error('恢复记录已损坏');
  if (existing && JSON.stringify(existing) === JSON.stringify(pending))
    sessionStorage.removeItem(key(pending.identity));
}

export function findFollowupPending(
  actor: string,
  caseId: string,
  filingId: string,
): FollowupPending[] | 'damaged' {
  try {
    const results: FollowupPending[] = [];
    const scopePrefix = `${prefix}${[actor, caseId.toLowerCase(), filingId.toLowerCase()].map(encodeURIComponent).join(':')}:`;
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const entry = sessionStorage.key(index);
      if (!entry?.startsWith(scopePrefix)) continue;
      const parts = entry
        .slice(prefix.length)
        .split(':')
        .map(decodeURIComponent);
      if (
        parts.length !== 5 &&
        parts[0] === actor &&
        same(parts[1], caseId) &&
        same(parts[2], filingId)
      )
        return 'damaged';
      if (
        parts.length !== 5 ||
        parts[0] !== actor ||
        !same(parts[1], caseId) ||
        !same(parts[2], filingId)
      )
        continue;
      const command = parts[3];
      if (
        command !== 'record-feedback' &&
        command !== 'correct-feedback' &&
        command !== 'submit-supplement' &&
        command !== 'correct-supplement'
      )
        return 'damaged';
      const identity: FollowupIdentity = {
        actor,
        caseId,
        filingId,
        command,
        rootId: parts[4]!,
      };
      const pending = readFollowupPending(identity);
      if (pending === 'damaged') return 'damaged';
      if (pending) results.push(pending);
    }
    return results;
  } catch {
    return 'damaged';
  }
}
