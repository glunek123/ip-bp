export function verifyCustomerAgreementMigration(): Promise<{
  checks: string[];
  migrationCount: number;
}>;
