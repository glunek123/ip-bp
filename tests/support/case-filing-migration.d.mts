export function verifyCaseFilingMigration(): Promise<{
  empty: Record<string, unknown>;
  upgrade: Record<string, unknown>;
  constraints: Record<string, unknown>;
  failure: Record<string, unknown>;
}>;
