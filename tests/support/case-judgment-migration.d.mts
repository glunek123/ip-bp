export function verifyCaseJudgmentMigration(): Promise<{
  previous: number;
  total: number;
  emptyFacts: number;
  emptyReceipts: number;
  oldHearing: number;
  oldCaseStage: string;
  oldCaseVersion: number;
  oldJudgmentNull: boolean;
  registerGrant: number;
  correctGrant: number;
  failedCode: string | null;
  noPartialColumn: number;
  retryTable: number;
}>;
