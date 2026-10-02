export type BatchSeed = {
  matterId: string;
  sourceLeadId: string;
  departmentId: string;
  sampleFeeState: string;
  sampleFeeAmount: string | null;
};
export function createBatchWaitingReturnMatter(options?: {
  departmentId?: string;
  actorUserId?: string;
  responsibleUserId?: string;
  sampleFeeState?: 'KNOWN' | 'PENDING';
  sampleFeeAmount?: string;
  stage?: 'WAITING_RETURN' | 'WAITING_CERTIFICATE' | 'ARCHIVED';
  decision?: 'NO_ISSUE' | 'ISSUE';
}): Promise<BatchSeed>;
export function batchMatterState(matterId: string): Promise<{
  matter: { stage: string; version: number } | null;
  archives: number;
  amounts: Array<{
    kind: string;
    state: string;
    amount: { toString(): string } | null;
    partyKind: string | null;
    partyName: string | null;
    sourceEvidenceMatterId: string | null;
  }>;
  audits: number;
  evidence: {
    sampleFeeState: string;
    sampleFeeAmount: { toString(): string } | null;
  } | null;
}>;
export function batchReceiptCount(): Promise<number>;
export function batchAuditCount(): Promise<number>;
export function corruptBatchReceipt(batchId: string): Promise<void>;
export function rejectBatchReceiptWrites(): Promise<void>;
export function rejectBatchAuditWrites(): Promise<void>;
export function allowBatchInjectedFailures(): Promise<void>;
export function disconnectBatchDatabase(): Promise<void>;
