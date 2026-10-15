export function assertCaseListWorkflowTarget(
  environment: Record<string, string | undefined>,
): void;
export function prepareCaseListWorkflowActors(): Promise<{
  run: string;
  departmentId: string;
  operator: { id: string; username: string; password: string };
  reader: { id: string; username: string; password: string };
  environmentFingerprint: string;
}>;
export function captureCaseListWorkflowEnvironment(): string;
