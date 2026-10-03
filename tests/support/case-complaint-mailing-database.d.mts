export function prepareCaseComplaintMailingFixture(): Promise<void>;
export function allowOtherEnterpriseAccountSetup(): Promise<void>;
export function revokeCaseComplaintMailGrant(): Promise<void>;
export function clearCaseComplaintMailingFixture(): Promise<void>;
export function clearCaseComplaintMailingFault(): Promise<void>;
export function expireRevokedClientDraft(
  draftId: string,
): Promise<string | undefined>;
export function rejectCaseComplaintMailingWrite(
  kind: 'audit' | 'fact' | 'freeze' | 'receipt',
): Promise<void>;
export function countCaseComplaintMailingEffects(caseId: string): Promise<{
  stage: string;
  version: number;
  facts: number;
  versions: number;
  references: number;
  receipts: number;
  audits: number;
}>;
