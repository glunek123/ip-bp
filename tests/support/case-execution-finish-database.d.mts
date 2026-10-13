export function clearCaseExecutionFinishFixture(): Promise<void>;
export function verifyCaseExecutionFinishDatabase(): Promise<{
  faults: Record<string, boolean>;
  immutable: Record<string, string | null>;
}>;
