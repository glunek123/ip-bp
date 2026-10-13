export function verifyConfirmedPublicCaseUpgrade(caseId: string): Promise<{
  fullOldChain: boolean;
  oldForeignKeys: number;
  confirmedVersion: number;
  exactVersions: number;
}>;
export function copyOldTables(client: object, schema: string): Promise<void>;
export function assertNoOrphanedOldForeignKeys(
  client: object,
  schema: string,
): Promise<number>;
