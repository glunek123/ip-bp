export function verifyCaseHearingDatabase(): Promise<{
  initialVersion: number;
  lawyerScheduled: boolean;
  replaySame: boolean;
  revokedReplayDenied: boolean;
  rollbackSaveClean: boolean;
  beforeDue: number;
  failedAdvanceCount: number;
  rollbackAdvanceClean: boolean;
  startupAdvanced: number;
  secondStartupAdvanced: number;
  firstAdvanceCount: number;
  firstSystemAuditCount: number;
  firstSystemActorNull: boolean;
  rollbackCorrectionClean: boolean;
  overdueStage: string;
  overdueAdvanceSame: boolean;
  againOverdueStage: string;
  againAdvanceSame: boolean;
  futureStage: string;
  futureAdvanceNull: boolean;
  secondAdvanced: number;
  finalAdvanceCount: number;
  finalSystemAuditCount: number;
  historyArrangementCount: number;
  correctionCount: number;
  immutableArrangement: string | null;
  immutableAdvance: string | null;
  immutableAudit: string | null;
  earlyDateSQL: string | null;
  mismatchAuditSQL: string | null;
  duplicateAdvance: string | null;
  auditReasonMismatch: string | null;
  auditPriorArrangementMismatch: string | null;
  auditPriorAdvanceMismatch: string | null;
  auditResultStageMismatch: string | null;
  staleAdvanceChain: string | null;
  staleJudgmentChain: string | null;
}>;
export function verifyCaseHearingDetailSnapshot(): Promise<{
  racedStage: string;
  racedVersion: number;
  racedCurrentAdvance: string | null;
  racedAdvanceCount: number;
  nextStage: string;
  nextVersion: number;
  nextAdvanceCount: number;
  nextCurrentAdvanceMatches: boolean;
}>;

export function seedCoreCaseHearingFixture(
  departmentId: string,
): Promise<string>;
export function prepareCoreCaseHearingAdmin(): Promise<{
  username: string;
  password: string;
}>;
export function clearCoreCaseHearingAdmin(): Promise<void>;
export function clearCoreCaseHearingAdminSessions(): Promise<void>;
export function inspectCoreCaseHearingFixture(caseId: string): Promise<{
  arrangements: number;
  advances: number;
  corrections: number;
}>;
export function clearCoreCaseHearingFixture(
  departmentIds: string[],
): Promise<void>;
export function inspectCoreCaseHearingGuards(): Promise<
  Array<{ name: string; enabled: string }>
>;
export function withCoreCaseHearingCleanupFault<T>(
  operation: () => Promise<T>,
): Promise<T>;
