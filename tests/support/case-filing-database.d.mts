export function prepareCaseFilingFixture(): Promise<void>;
export function revokeCaseFilingGrant(): Promise<void>;
export function clearCaseFilingFixture(): Promise<void>;
export function clearCaseFilingFault(): Promise<void>;
export function rejectCaseFilingWrite(
  kind: 'audit' | 'fact' | 'freeze' | 'receipt',
): Promise<void>;
export function countCaseFilingEffects(caseId: string): Promise<{
  stage: string;
  version: number;
  facts: number;
  versions: number;
  references: number;
  receipts: number;
  audits: number;
}>;
