export function verifyBatch2UsernameMigration(): Promise<{
  migrationCount: number;
  legacyUsername: string;
  legacyLoginUsername: string;
  uniqueIndexRetained: boolean;
}>;
