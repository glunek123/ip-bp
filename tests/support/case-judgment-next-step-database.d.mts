export function clearCoreCaseJudgmentNextStepFixture(departmentIds: string[]): Promise<void>;
export function verifyCaseJudgmentNextStepDatabase(): Promise<{
  checks: string[];
  stage: string;
  version: number;
}>;
