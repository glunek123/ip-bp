export type ReferenceReuseActor = {
  username: string;
  password: string;
  userId: string;
  customerId: string;
  rightsHolderId: string;
};
export type ReferenceReuseSnapshot = {
  references: Array<{
    purpose: string;
    material_id: string;
    content_version_id: string;
    action_event_id: string | null;
    is_repeatable_typed_reference: boolean;
    action: string | null;
  }>;
  corrections: Array<{ kind: string; n: number }>;
  receipts: Array<{ command: string; n: number }>;
};
export function assertReferenceReuseBinding(
  environment?: NodeJS.ProcessEnv,
): string;
export function assertReferenceReuseTransactionBoundary(sql: string): void;
export function assertApprovedReferenceReuseMigration(
  sourceBytes: Buffer,
  appliedChecksum?: string,
): string;
export function verifyReferenceReusePredeploy(): Promise<{
  head: string;
  tree: string;
  migrationSha256: string;
  failedMigrationRolledBack: true;
  compiled: { marker: number; functions: number; triggers: number };
  sixExemptPurposesPreserved: true;
  fourOriginalAndCorrectionBranches: true;
  publicUnchanged: true;
  scope: string;
}>;
export function assertReferenceReuseRunner(): Promise<{
  head: string;
  tree: string;
  migrationSha256: string;
}>;
export function referenceReuseActor(): ReferenceReuseActor;
export function ownReferenceReuseCase(
  caseId: string,
  source: string,
): Promise<void>;
export function referenceReuseSnapshot(
  caseId: string,
): Promise<ReferenceReuseSnapshot>;
export function referenceReuseSqlRejections(
  caseId: string,
  purpose: string,
): Promise<Array<{ name: string; code: string }>>;
