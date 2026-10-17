import type { APIResponse } from '@playwright/test';
export type HistoricalRecordActor = {
  userId: string;
  roleId: string;
  departmentId: string;
  username: string;
  password: string;
};
export type HistoricalRecordActorBinding = {
  manifestSha256: string;
  creationDeltaSha256: string;
  fourGrantManifestSha256: string;
  threeCorrectionManifestSha256: string;
  credentialFileSha256: string;
  userId: string;
  roleId: string;
  departmentId: string;
  assignmentId: string;
  membershipId: string;
  credentialId: string;
};
export type HistoricalRecordActorRecovery = {
  binding: HistoricalRecordActorBinding;
  credential: Pick<HistoricalRecordActor, 'username' | 'password'>;
  // The unique runner must verify these separate creation manifests before supplying them.
  foreign: { manifestSha256: string; actor: HistoricalRecordActor };
  readOnly: { manifestSha256: string; actor: HistoricalRecordActor };
};
// Runner verifies manifest/private-file bytes before loading. Credentials stay out of config/report data.
export type HistoricalRecordActorRecoverySource = {
  load(): Promise<HistoricalRecordActorRecovery>;
};
export function restoreHistoricalRecordActor(
  binding: HistoricalRecordActorBinding,
  credential: Pick<HistoricalRecordActor, 'username' | 'password'>,
): Promise<HistoricalRecordActor>;
export function assertHistoricalRecordR2Binding(
  environment?: Record<string, string | undefined>,
): { connectionString: string; port: number };
export function createHistoricalRecordActor(options?: {
  readOnly?: boolean;
  foreign?: boolean;
}): Promise<HistoricalRecordActor>;
export function ownHistoricalRecordCase(
  caseId: string,
  actorUserId: string,
): Promise<void>;
export function historicalBaselineSecuritySnapshot(): Promise<unknown>;
export function historicalRecordFrozenSnapshot(
  caseId: string,
): Promise<unknown>;
export function historicalRecordSectionSnapshot(
  caseId: string,
): Promise<unknown>;
export function historicalRecordMutationProbe(
  caseId: string,
  correctionId: string,
  kind: 'hearing' | 'judgment' | 'closure',
): Promise<{ code: string | null; unchanged: boolean }>;
export function withHistoricalRecordFault(
  caseId: string,
  kind: 'hearing' | 'judgment' | 'closure',
  phase: 'audit' | 'fact' | 'receipt' | 'document' | 'reference',
  command: () => Promise<APIResponse>,
): Promise<{ status: number; reached: boolean; unchanged: boolean }>;
