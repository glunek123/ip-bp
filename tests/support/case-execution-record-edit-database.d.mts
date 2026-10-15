export type ExecutionRecordEditActor = {
  userId: string;
  roleId: string;
  username: string;
  password: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
};
export function assertExecutionRecordEditR2Binding(
  environment: NodeJS.ProcessEnv,
): void;
export function createExecutionRecordEditActor(options?: {
  foreign?: boolean;
  readOnly?: boolean;
}): Promise<ExecutionRecordEditActor>;
export function ownExecutionRecordEditCase(
  caseId: string,
  actorUserId: string,
): Promise<void>;
export function executionRecordEditSnapshot(caseId: string): Promise<{
  original: Record<string, unknown>;
  corrections: Record<string, Array<{ row: Record<string, unknown> }>>;
}>;
export function revokeExecutionRecordEditActor(userId: string): Promise<void>;
export function raceExecutionRecordEditRequests<T>(
  caseId: string,
  startRequests: () => Promise<T>,
): Promise<T>;
export function withExecutionRecordEditFault<T>(
  caseId: string,
  phase: 'audit' | 'correction' | 'document' | 'reference' | 'receipt',
  operation: () => Promise<T>,
): Promise<T>;
