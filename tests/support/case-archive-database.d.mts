import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { CaseClosureSource } from './case-closure-database.mjs';
export type CaseArchiveSource = CaseClosureSource & {
  closureResult: {
    id: string;
    closureId: string;
    closureVersionId: string;
    finishId: string;
    stage: 'WAITING_ARCHIVE';
    version: number;
    recordedAt: string;
  };
  closureInput: {
    expectedVersion: number;
    idempotencyKey: string;
    expectedFinishId: string;
    closeAt: null;
    closeAmountState: 'PENDING' | 'KNOWN';
    closeAmt: null | '0.00';
    note: null;
    closeContentVersionIds: string[];
  };
  file: null | {
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
    mimeType: string;
  };
};
export function createClosedCaseArchiveSourceThroughApi(
  request: APIRequestContext,
  options?: { bytes?: Uint8Array; realZero?: boolean },
): Promise<CaseArchiveSource>;
export function setCaseArchiveFixtureGrant(
  roleId: string,
  action: 'case.archive' | 'case.archive.correct',
  scope: 'SELF' | 'TEAM' | 'DEPARTMENT',
  enabled?: boolean,
): Promise<void>;
export function clearCaseArchiveFixture(): Promise<void>;
export function caseArchiveSqlRejection(
  caseId: string,
  probe:
    | 'case-version-only'
    | 'version-update'
    | 'version-delete'
    | 'receipt-update'
    | 'receipt-delete'
    | 'audit-delete'
    | 'head-foreign-current'
    | 'head-change-closure'
    | 'prior-closure-update'
    | 'prior-document-delete'
    | 'stage-reopen',
): Promise<{ code: string | null; unchanged: boolean }>;
export function withCaseArchiveFault(
  caseId: string,
  phase: 'audit' | 'head' | 'version' | 'case' | 'receipt',
  command: () => Promise<APIResponse>,
): Promise<{ status: number; reached: boolean; unchanged: boolean }>;
