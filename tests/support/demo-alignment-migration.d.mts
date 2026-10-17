type Environment = Record<string, string | undefined>;
type Source = { name: string; sha256: string; sql: string };
export type DemoMigrationResult = {
  phase?: 'before-cleanup' | 'cleanup-transaction-verified';
  fingerprint: string;
  source: Array<Omit<Source, 'sql'>>;
  checks: string[];
  faults: Array<{
    name: string;
    code: string;
    marker: string;
    rolledBack: boolean;
    rawRetrySha256: string;
  }>;
  sends: number;
  rollbacks: number;
  retries: number;
  createdSchemas: string[];
  cleanedSchemas: number | null;
  cleanup: {
    state:
      | 'not-started'
      | 'transaction-open'
      | 'ready-to-commit'
      | 'rolled-back'
      | 'rollback-uncertain'
      | 'commit-uncertain'
      | 'committed';
    schemasRetained: boolean | null;
  };
  connectionEnd: 'pending' | 'confirmed' | 'uncertain';
  publicUnchanged: boolean;
  publicDigests: {
    before?: string;
    beforeCleanup?: string;
    afterDropInTransaction?: string;
  };
  projection?: {
    fees: number;
    groups: number;
    items: number;
    papers: number;
    audits: number;
    receipts: number;
  };
  catalogDelta?: CatalogMetrics;
  failure?: { phase: string; code: string | null };
};
type CatalogMetrics = {
  tables: number;
  enumTypes: number;
  functions: number;
  userTriggers: number;
  constraints: number;
  indexes: number;
  existingEnumLabels: number;
};
export function admitDemoMigration(environment: Environment): {
  connectionString: string;
  pnpmVersion: string;
};
export function demoMigrationPlan(directory?: string): Promise<Source[]>;
export function assertDemoPlan(plan: readonly Source[]): void;
export function assertDemoCatalogDelta(
  before: CatalogMetrics,
  after: CatalogMetrics,
): CatalogMetrics;
export function assertDemoImportedSources(
  rows: ReadonlyArray<{
    matter: string;
    caseId: string;
    department: string;
    itemCase: string;
    paperCase: string;
    certificate: string;
    actor: string;
    binding: string;
    originalAudits: string[];
    files: Array<{
      materialId: string;
      contentVersionId: string;
      filename: string;
    }>;
    sourceVersion: number;
    issuanceVersion: number;
    filename: string;
    size: string;
    sha256: string;
  }>,
): void;
export function assertDemoLedger(
  rows: ReadonlyArray<{
    id: string;
    migration_name: string;
    checksum: string;
    started_at: string;
    finished_at: string | null;
    rolled_back_at: string | null;
    applied_steps_count: number;
    logs: string | null;
  }>,
  plan: readonly Source[],
): void;
export function ownedDemoSchema(nonce: string, kind: string): string;
export function assertOwnedDemoSchema(
  name: string,
  nonce: string,
  created: Set<string>,
  comment: string,
): void;
export function injectDemoMigrationFailure(entry: Source): {
  sql: string;
  marker: string;
};
export function assertDemoFault(error: unknown, marker: string): void;
export function assertDemoMirror(
  source: readonly unknown[],
  mirrored: readonly unknown[],
): void;
export function cleanupDemoSchemas(
  client: { query(sql: string): Promise<unknown> },
  names: readonly string[],
  verify: (name: string) => Promise<void>,
  readPublic: () => Promise<string>,
  report: (result: DemoMigrationResult) => void | Promise<void>,
  result: DemoMigrationResult,
): Promise<void>;
export function endDemoConnection(
  client: { end(): Promise<void> },
  result: DemoMigrationResult,
  primaryFailure?: unknown,
): Promise<unknown>;
export function verifyDemoAlignmentMigration(
  report?: (result: DemoMigrationResult) => void | Promise<void>,
): Promise<DemoMigrationResult>;
