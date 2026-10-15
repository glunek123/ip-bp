export type SectionRecordUiActor = {
  userId: string;
  roleId: string;
  username: string;
  password: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
};
export class SectionRecordUiPermissionPending extends Error {
  code: 'NORMAL_SOURCE_PERMISSION_PENDING';
  finding: 'I-SECTION-UI-GRANT01';
  requiredActions: readonly string[];
}
export function assertSectionRecordUiSourceReady(): never;
export function assertSectionRecordUiBinding(
  environment?: NodeJS.ProcessEnv,
): string;
export type SectionRecordUiDatabaseProof = {
  capturedDatabaseUrl: string;
  validatedDatabaseUrl: string;
  migrations: Array<{ name: string; checksum: string }>;
  identity: Array<{ db: string; schema: string; username: string }>;
  applied: Array<{
    migration_name: string;
    checksum: string;
    finished_at: string | null;
    rolled_back_at: string | null;
  }>;
};
export function assertSectionRecordUiDatabaseProof(
  environment: NodeJS.ProcessEnv,
  proof: SectionRecordUiDatabaseProof,
): void;
export function withSectionRecordUiDatabase(): Promise<never>;
export function assertSectionRecordUiRunner(): Promise<void>;
export function createSectionRecordUiActor(): Promise<SectionRecordUiActor>;
export function sectionRecordUiFixture(): never;
export function ownSectionRecordUiCase(
  caseId: string,
  actorUserId: string,
): Promise<void>;
export function revokeSectionRecordUiActor(userId: string): Promise<void>;
export function sectionRecordUiBaselineSecurity(): Promise<unknown>;
export function sectionRecordUiUploads(caseId: string): Promise<
  Array<{
    versionId: string;
    draftId: string;
    targetId: string;
    revision: number;
    firstFreeze: boolean;
  }>
>;
export function sectionRecordUiSnapshot(caseId: string): Promise<{
  frozen: Record<string, unknown>;
  corrections: Record<string, Array<{ row: Record<string, unknown> }>>;
}>;
