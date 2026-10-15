type Environment = Record<string, string | undefined>;
type Replacement = { before: string; after: string };
type EnumRow = { type: string; label: string; position: string };
type Source = { name: string; sha256: string };
export type SectionMigrationResult = {
  fingerprint: string;
  source: Source[];
  checks: string[];
  enumStaging: Array<{
    migration: string;
    labels: string[];
    execution: string;
  }>;
  fixture: string;
  reusedSuites: string[];
  publicUnchanged: boolean;
  cleanedSchemas: number;
  publicDigests: { before?: string; beforeCleanup?: string; after?: string };
  memoryFile?: { size: number; sha256: string };
};
export function admitSectionMigration(environment: Environment): {
  connectionString: string;
  pnpmVersion: string;
};
export function assertMigrationIsolation(sql: string): void;
export function sectionMigrationPlan(
  directory?: string,
): Promise<Array<Source & { sql: string }>>;
export function ownedSectionSchema(nonce: string, kind: string): string;
export function assertOwnedSectionSchema(
  name: string,
  nonce: string,
  created: Set<string>,
  actualComment: string,
  expectedComment: string,
): void;
export function injectSectionMigrationFailure(sql: string): string;
export function assertSectionMigrationFailure(error: unknown): void;
export function section156Prelude(sql: string): {
  prelude: string;
  transaction: string;
};
export function sectionCompatibilityReplacements(sql: string): Array<{
  name: string;
  replacements: Replacement[];
}>;
export function applySectionCompatibility(
  definition: string,
  replacements: Replacement[],
): string;
export function classifySectionEnumStaging(
  before: EnumRow[],
  after: EnumRow[],
  allow156: boolean,
): string[];
export function verifyCaseSectionRecordMigration(
  report?: (result: SectionMigrationResult) => void | Promise<void>,
): Promise<SectionMigrationResult>;
