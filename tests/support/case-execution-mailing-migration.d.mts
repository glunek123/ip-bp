export function verifyConfirmedPublicCaseUpgrade(caseId: string): Promise<{
  fullOldChain: boolean;
  oldForeignKeys: number;
  confirmedVersion: number;
  exactVersions: number;
}>;
