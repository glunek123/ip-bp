export function clearCoreCaseJudgmentNextStepFixture(departmentIds: string[]): Promise<void>;
export function verifyCoreCaseJudgmentNextStepFixtureCleanup(
  coreLeadFixtures: { departmentA: string; admittedCustomer: string; holder: string; userA: string },
  resetCoreLeadE2eData: () => Promise<unknown>,
): Promise<{
  faultRejected: boolean;
  rollbackPreserved: boolean;
  guardsRestored: boolean;
  targetRemoved: boolean;
  guardsEnabledAfterSuccess: boolean;
}>;
export function verifyCaseJudgmentNextStepDatabase(): Promise<{
  checks: string[];
  stage: string;
  version: number;
}>;
import type { APIRequestContext } from '@playwright/test';
export function verifyCaseJudgmentNextStepWithRealJudgment(request: APIRequestContext): Promise<{
  choiceStage: string | null;
  revokedStage: string | null;
  correctedVersion: number | null;
  bytesPreserved: boolean;
}>;
export function verifyJudgmentChoiceCorrectionRace(): Promise<{
  oneWinner: boolean;
  atomic: boolean;
  loserCode: string | null;
}>;
