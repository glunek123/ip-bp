import type { APIResponse } from '@playwright/test';
export function grantHistoricalRecordFixtureActions(): Promise<void>;
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
