export function setCaseExternalEntryGrant(
  roleId: string,
  action: 'case.external-entry.create' | 'case.external-entry.archive',
  scope: 'SELF' | 'TEAM' | 'DEPARTMENT',
  enabled: boolean,
): Promise<void>;
export function clearCaseExternalEntryFixture(): Promise<void>;
export function caseExternalEntrySnapshot(caseId: string): Promise<{
  case: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  finishFacts: Record<string, unknown>[];
  finishVersions: Record<string, unknown>[];
  finishReceipts: Record<string, unknown>[];
  closureFacts: Record<string, unknown>[];
  closureVersions: Record<string, unknown>[];
  closureDocuments: Record<string, unknown>[];
  closureReceipts: Record<string, unknown>[];
  archiveFacts: Record<string, unknown>[];
  archiveVersions: Record<string, unknown>[];
  archiveReceipts: Record<string, unknown>[];
}>;
