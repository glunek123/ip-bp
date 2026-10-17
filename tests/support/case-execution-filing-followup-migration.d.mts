type Environment = Record<string, string | undefined>;
type Source = { name: string; sha256: string };
type EnumRow = { type: string; label: string; position: string };
import type { ExecutionFilingFollowupLedgerRow } from './case-execution-filing-followup-database.mjs';

export type ExecutionFilingFollowupMigrationResult = {
  fingerprint: string;
  source: Source[];
  checks: string[];
  enumStaging: Array<{ type: string; label: string }>;
  executionBoundary: {
    efPreparation: 'whole-script';
    efFacts: 'whole-script';
    legacy156: 'split-simulation';
    officialPrismaDeploy: 'runner-only-not-covered';
  };
  fixture: string;
  memoryFile?: { size: number; sha256: string };
  publicUnchanged: boolean;
  cleanedSchemas: number;
  publicDigests: { before?: string; beforeCleanup?: string; after?: string };
};

export function admitExecutionFilingFollowupMigration(
  environment: Environment,
): {
  connectionString: string;
  pnpmVersion: string;
};
export function executionFilingFollowupMigrationPlan(
  directory?: string,
): Promise<Array<Source & { sql: string }>>;
export function executionFilingFollowup160Prelude(sql: string): {
  prefix: string;
  transaction: string;
};
export function ownedExecutionFilingFollowupSchema(
  nonce: string,
  kind: string,
): string;
export function assertOwnedExecutionFilingFollowupSchema(
  name: string,
  nonce: string,
  created: Set<string>,
  actual: string,
  expected: string,
): void;
export function injectExecutionFilingFollowupFailure(
  transaction: string,
): string;
export function assertExecutionFilingFollowupFailure(error: unknown): void;
export function classifyExecutionFilingFollowupEnumStaging(
  before: EnumRow[],
  after: EnumRow[],
): Array<{ type: string; label: string }>;
export function expectedExecutionFilingFollowupClassifier(
  oldBody: string,
  sql: string,
): string;
export function assertExecutionFilingFollowupLedger(
  identity: Array<{ db: string; schema: string; username: string }>,
  applied: ExecutionFilingFollowupLedgerRow[],
  plan: Array<Source>,
): void;
export function replayExecutionFilingFollowupMigration(
  client: { query(sql: string): Promise<unknown> },
  entry: Source & { sql: string },
): Promise<void>;
export function verifyCaseExecutionFilingFollowupMigration(
  report?: (
    result: ExecutionFilingFollowupMigrationResult,
  ) => void | Promise<void>,
): Promise<ExecutionFilingFollowupMigrationResult>;
