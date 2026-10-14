export type DatabaseClient = {
  query(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};
export function createSecondInstanceAcceptanceAppealSource(
  request: import('@playwright/test').APIRequestContext,
): Promise<{
  caseId: string;
  choiceId: string;
  trialRoundId: string;
  date: string;
}>;
export function withSecondInstanceAcceptanceDatabase<T>(
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T>;
export function setSecondInstanceAcceptanceGrant(
  roleId: string,
  scope: 'SELF' | 'TEAM' | 'DEPARTMENT',
  enabled: boolean,
): Promise<void>;
export function grantSecondInstanceAcceptancePredecessors(): Promise<void>;
export function secondInstanceAcceptanceSnapshot(caseId: string): Promise<{
  case: Record<string, unknown>[];
  choices: Record<string, unknown>[];
  changes: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  oldReceipts: Record<string, unknown>[];
  acceptances: Record<string, unknown>[];
  matchingReceipts: Record<string, unknown>[];
  acceptanceReceipts: Record<string, unknown>[];
  judgmentChoiceReceipts: Record<string, unknown>[];
  secondInstanceReceipts: Record<string, unknown>[];
  secondProgress: Record<string, unknown>[];
  secondResults: Record<string, unknown>[];
  archive: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  audits: Record<string, unknown>[];
}>;
export function clearSecondInstanceAcceptanceFault(): Promise<void>;
export function rejectSecondInstanceAcceptanceWrite(): Promise<void>;
export function clearSecondInstanceAcceptanceFixture(): Promise<void>;
