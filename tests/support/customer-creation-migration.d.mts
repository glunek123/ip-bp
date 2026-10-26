export function verifyCustomerCreationMigration(): Promise<{
  checks: string[];
  migrationCount: number;
  previousMigration: string;
}>;
