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
export type ExecutionFilingFollowupLedgerRow = {
  id: string;
  migration_name: string;
  checksum: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  rolled_back_at: string | null;
  applied_steps_count: number;
  logs_is_null: boolean;
};
export type ExecutionFilingFollowupRollbackReceipt = {
  protocol: 'EF001_PRISMA_ROLLBACK_V1';
  failedMigrationId: string;
  migrationName: string;
  checksum: string;
  originalStartedAt: string;
  rolledBackAt: string;
  command: readonly string[];
  cwd: 'backend';
  exitCode: 0;
  commandStartedAt: string;
  commandFinishedAt: string;
  stdoutSha256: string;
  stderrSha256: string;
};
export function assertExecutionFilingFollowupHistoricalFailure(
  row: ExecutionFilingFollowupLedgerRow,
  state: 'UNRESOLVED' | 'RESOLVED',
  receipt?: ExecutionFilingFollowupRollbackReceipt,
): void;
export function assertExecutionFilingFollowupResolveArtifacts(
  receipt: ExecutionFilingFollowupRollbackReceipt,
  stdout: Buffer,
  stderr: Buffer,
): void;
export function assertExecutionFilingFollowupR2Binding(
  environment: NodeJS.ProcessEnv,
): void;
export function assertExecutionFilingFollowupMigrationSource(
  source: readonly MigrationSource[],
): void;
export function assertExecutionFilingFollowupMigrationLedger(
  identity: readonly { db: string; schema: string; username: string }[],
  applied: readonly ExecutionFilingFollowupLedgerRow[],
  source: readonly MigrationSource[],
  rollbackReceipt: ExecutionFilingFollowupRollbackReceipt,
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
