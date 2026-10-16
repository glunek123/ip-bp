export type ExecutionFilingFollowupActor = {
  userId: string;
  roleId: string;
  username: string;
  password: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
};
export type ExecutionFilingFollowupRow = Record<string, unknown>;
export type ExecutionFilingFollowupSnapshot = {
  original: Record<string, ExecutionFilingFollowupRow[]>;
  facts: Record<string, ExecutionFilingFollowupRow[]>;
};
export type MigrationSource = { name: string; checksum: string };
export function assertExecutionFilingFollowupR2Binding(
  environment: NodeJS.ProcessEnv,
): void;
export function assertExecutionFilingFollowupMigrationSource(
  source: readonly MigrationSource[],
): void;
export function assertExecutionFilingFollowupMigrationLedger(
  identity: readonly { db: string; schema: string; username: string }[],
  applied: readonly {
    migration_name: string;
    checksum: string;
    finished_at: Date | string | null;
    rolled_back_at: Date | string | null;
  }[],
  source: readonly MigrationSource[],
): void;
export function createExecutionFilingFollowupActor(
  kind?: 'source' | 'operator' | 'readOnly' | 'foreign',
): Promise<ExecutionFilingFollowupActor>;
export function executionFilingFollowupSource(actorUserId: string): string;
export function ownExecutionFilingFollowupCase(
  caseId: string,
  actorUserId: string,
): Promise<void>;
export function executionFilingFollowupSafetySnapshot(): Promise<
  Record<string, ExecutionFilingFollowupRow[]>
>;
export function executionFilingFollowupSnapshot(
  caseId: string,
): Promise<ExecutionFilingFollowupSnapshot>;
export function revokeExecutionFilingFollowupActor(
  userId: string,
): Promise<void>;
export function contendExecutionFilingFollowupRequests<T>(
  caseId: string,
  operation: () => Promise<T>,
): Promise<{ result: T; blockedPids: number[] }>;
export function withExecutionFilingFollowupFault<T>(
  caseId: string,
  kind: 'feedback' | 'supplement',
  phase: 'audit' | 'version' | 'document' | 'reference' | 'receipt',
  operation: () => Promise<T>,
): Promise<T>;
