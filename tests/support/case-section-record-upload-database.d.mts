export type SectionUploadActor = {
  userId: string;
  roleId: string;
  username: string;
  password: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
};
export function assertSectionUploadRunner(): Promise<void>;
export function createSectionUploadActor(): Promise<SectionUploadActor>;
export function ownSectionUploadCase(
  caseId: string,
  actorUserId: string,
): Promise<void>;
export function sectionUploadFixture(): {
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  sourcePrefix: string;
};
export function revokeSectionUploadActor(userId: string): Promise<void>;
export function sectionUploadSnapshot(caseId: string): Promise<
  Array<{
    version_id: string;
    storage_key: string;
    draft_id: string;
    draft_status: string;
    command: string;
    target_id: string;
    revision: number;
    first_freeze: boolean;
  }>
>;
export function sectionUploadRollbackProbe(
  caseId: string,
  versionId: string,
  mutation:
    | 'rebind'
    | 'unlink'
    | 'material-scope'
    | 'material-purpose'
    | 'fake-reference'
    | 'workflow',
): Promise<boolean>;
export function sectionUploadLifecycleProbe(
  caseId: string,
  versionId: string,
): Promise<boolean>;
export function sectionUploadQuotaProofProbe(
  caseId: string,
  versionId: string,
): Promise<{ excludesOldFrozen: boolean }>;
