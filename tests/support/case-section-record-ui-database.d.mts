export type SectionRecordUiActor = {
  userId: string;
  roleId: string;
  username: string;
  password: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
};
export function assertSectionRecordUiBinding(
  environment?: NodeJS.ProcessEnv,
): string;
export function assertSectionRecordUiRunner(): Promise<void>;
export function createSectionRecordUiActor(): Promise<SectionRecordUiActor>;
export function sectionRecordUiFixture(): {
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  sourcePrefix: string;
};
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
