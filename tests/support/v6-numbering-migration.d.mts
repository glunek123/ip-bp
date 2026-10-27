export function verifyV6NumberingMigration(): Promise<{
  migrationCount: number;
  checks: string[];
}>;
