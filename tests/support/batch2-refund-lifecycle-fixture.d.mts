type SyntheticAccount = { id: string; username: string; password: string };
export function grantBatch2RefundLifecycleActions(fixture: {
  operator: SyntheticAccount;
  departmentId: string;
  suffix: string;
}): Promise<{ courtId: string }>;
export function readBatch2RefundLedger(
  caseId: string,
  departmentId: string,
  sourceId: string,
): Promise<{
  applications: number;
  reads: number;
  refund_fees: number;
  actual_refunds: number;
}>;
export function readBatch2RoundRevokedAt(
  roundId: string,
  caseId: string,
  departmentId: string,
): Promise<Date | null>;
export function verifyBatch2RefundBoundaryAndRead(
  fixture: { operator: SyntheticAccount; departmentId: string },
  source: { caseId: string; resultId: string; recordedAt: string },
): Promise<{
  dueAt: string;
  beforeAbsent: boolean;
  atPresent: boolean;
  readStable: boolean;
  persisted: number;
  afterRead: string | null;
}>;
