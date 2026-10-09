export function verifyCustomerSettlementMigration(): Promise<{
  checks: string[];
  migrationCount: number;
}>;
