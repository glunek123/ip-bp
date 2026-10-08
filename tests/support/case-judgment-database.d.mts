export function verifyCaseJudgmentDatabase(): Promise<{
  stage: string;
  version: number;
  judgmentFacts: number;
  hearingAdvances: number;
  currentMatches: boolean;
  frozenVersions: number;
  frozenReferences: number;
  elevenSelected: string | null;
  replacementVersion: number;
  originalReferencesAfterReplacement: number;
  originalBytesPreserved: boolean;
  pendingPool: number;
  pendingExcess: string | null;
  bytesMatch: boolean;
  replaySame: boolean;
  hearingBlocked: string | null;
  stale: string | null;
  noFile: string | null;
  faultRaised: boolean;
  rollbackFacts: boolean;
  rollbackCase: boolean;
  correctedStage: string;
  correctedVersion: number;
  historyCount: number;
  priorMatches: boolean;
  immutableFact: string | null;
  reverseStage: string | null;
}>;

export function clearCoreCaseJudgmentFixture(
  departmentIds: string[],
): Promise<void>;
export function verifyCoreCaseJudgmentFixtureCleanup(
  coreLeadFixtures: {
    departmentA: string;
    departmentB: string;
    userA: string;
    admittedCustomer: string;
    holder: string;
  },
  resetCoreLeadE2eData: () => Promise<unknown>,
): Promise<{
  faultRejected: boolean;
  rollbackPreserved: boolean;
  guardsRestored: boolean;
  targetRemoved: boolean;
  otherDepartmentPreserved: boolean;
  unknownOwnerRejected: boolean;
  unknownOwnerPreserved: boolean;
  disabledGuardRejected: boolean;
  replicationRoleRestored: boolean;
}>;
