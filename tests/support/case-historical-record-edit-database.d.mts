import type { APIResponse } from '@playwright/test';
export type HistoricalRecordActor = {
  userId: string;
  roleId: string;
  departmentId: string;
  username: string;
  password: string;
};
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
