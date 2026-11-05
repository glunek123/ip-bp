import { ApiError, requestJson } from './http';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () =>
  new ApiError('服务返回了无效的律师分配数据', 200, 'INVALID_RESPONSE');
export type AssignmentView = {
  id: string;
  lawyerProfileId: string;
  lawyerAccountId: string;
  assignedAt: string;
};
export type LawyerAssignmentCapability = {
  canAssign: boolean;
  reason?: 'INVALID_STATE' | 'LAWYER_ASSIGNMENT_CONFLICT';
  caseVersion: number;
  currentAssignment: AssignmentView | null;
};
export type AssignCaseLawyerInput = {
  expectedVersion: number;
  idempotencyKey: string;
  lawyerAccountId: string;
  lawyerProfileId?: string;
};
export type AssignCaseLawyerResult = {
  id: string;
  stage: 'PENDING_MATCH';
  version: number;
  outcome: 'ASSIGNED' | 'NO_CHANGE' | 'SKIPPED';
  requestedLawyerAccountId: string;
  previousAssignment: AssignmentView | null;
  currentAssignment: AssignmentView | null;
};
function assignment(value: unknown): value is AssignmentView {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    uuid.test(value.id) &&
    typeof value.lawyerProfileId === 'string' &&
    uuid.test(value.lawyerProfileId) &&
    typeof value.lawyerAccountId === 'string' &&
    uuid.test(value.lawyerAccountId) &&
    typeof value.assignedAt === 'string' &&
    !Number.isNaN(Date.parse(value.assignedAt))
  );
}
export function validAssignCaseLawyerResult(
  value: unknown,
  caseId: string,
  input: AssignCaseLawyerInput,
): value is AssignCaseLawyerResult {
  if (
    !record(value) ||
    value.id !== caseId ||
    value.stage !== 'PENDING_MATCH' ||
    !['ASSIGNED', 'NO_CHANGE', 'SKIPPED'].includes(String(value.outcome)) ||
    value.requestedLawyerAccountId !== input.lawyerAccountId ||
    !Number.isSafeInteger(value.version) ||
    !(
      value.previousAssignment === null || assignment(value.previousAssignment)
    ) ||
    !(value.currentAssignment === null || assignment(value.currentAssignment))
  )
    return false;
  if (value.outcome === 'ASSIGNED')
    return (
      value.version === input.expectedVersion + 1 &&
      value.previousAssignment === null &&
      assignment(value.currentAssignment) &&
      value.currentAssignment.lawyerAccountId === input.lawyerAccountId &&
      (input.lawyerProfileId === undefined ||
        value.currentAssignment.lawyerProfileId === input.lawyerProfileId)
    );
  return (
    value.version === input.expectedVersion &&
    assignment(value.currentAssignment) &&
    assignment(value.previousAssignment) &&
    JSON.stringify(value.previousAssignment) ===
      JSON.stringify(value.currentAssignment) &&
    (value.outcome === 'NO_CHANGE') ===
      (value.currentAssignment.lawyerAccountId === input.lawyerAccountId)
  );
}
export async function getLawyerAssignmentCapability(
  caseId: string,
): Promise<LawyerAssignmentCapability> {
  if (!uuid.test(caseId))
    throw new ApiError('案件编号无效', 400, 'VALIDATION_ERROR');
  const value = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/lawyer-assignment/capability`,
  );
  if (
    !record(value) ||
    typeof value.canAssign !== 'boolean' ||
    !Number.isSafeInteger(value.caseVersion) ||
    (value.caseVersion as number) < 1 ||
    !(
      value.currentAssignment === null || assignment(value.currentAssignment)
    ) ||
    (value.reason !== undefined &&
      !['INVALID_STATE', 'LAWYER_ASSIGNMENT_CONFLICT'].includes(
        String(value.reason),
      )) ||
    (value.canAssign && value.reason !== undefined) ||
    (!value.canAssign && value.reason === undefined)
  )
    throw invalid();
  return value as LawyerAssignmentCapability;
}
export async function assignCaseLawyer(
  caseId: string,
  input: AssignCaseLawyerInput,
): Promise<AssignCaseLawyerResult> {
  if (
    !uuid.test(caseId) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !input.idempotencyKey ||
    input.idempotencyKey.length > 128 ||
    input.idempotencyKey !== input.idempotencyKey.trim() ||
    !uuid.test(input.lawyerAccountId) ||
    (input.lawyerProfileId !== undefined && !uuid.test(input.lawyerProfileId))
  )
    throw new ApiError('律师分配请求无效', 400, 'VALIDATION_ERROR');
  const value = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/lawyer-assignment`,
    {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': input.idempotencyKey },
    },
  );
  if (!validAssignCaseLawyerResult(value, caseId, input)) throw invalid();
  return value;
}
