export declare function clearCaseAcceptanceFault(): Promise<void>;
export declare function rejectCaseAcceptanceWrite(
  kind: 'audit' | 'fact' | 'freeze' | 'receipt',
): Promise<void>;
export declare function prepareCaseAcceptanceFixture(): Promise<void>;
export declare function revokeCaseAcceptanceGrant(): Promise<void>;
export declare function clearCaseAcceptanceFixture(): Promise<void>;
export declare function countCaseAcceptanceEffects(caseId: string): Promise<{
  stage: string;
  version: number;
  courtCaseNo: string | null;
  facts: number;
  versions: number;
  references: number;
  receipts: number;
  audits: number;
}>;
