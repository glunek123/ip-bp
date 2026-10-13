import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { createCaseExecutionFilingSourceThroughApi } from './case-execution-filing-database.mjs';
export type CaseClosureSource = Awaited<
  ReturnType<typeof createCaseExecutionFilingSourceThroughApi>
> & {
  finished: {
    id: string;
    finishId: string;
    filingId: string;
    stage: 'WAITING_ARCHIVE';
    version: number;
    finishedAt: string;
    recordedAt: string;
  };
  finishInput: {
    expectedVersion: number;
    idempotencyKey: string;
    expectedFilingId: string;
    finishedAt: string;
    reason: string;
    basisNote: string;
    basisContentVersionIds: string[];
  };
};
export function setCaseClosureFixtureGrant(
  roleId: string,
  action:
    | 'case.closure.record'
    | 'case.closure.correct'
    | 'case.execution.finish'
    | 'case.judgment.register'
    | 'case.judgment.next_step'
    | 'case.execution.submit',
  scope: 'SELF' | 'TEAM' | 'DEPARTMENT',
  enabled?: boolean,
): Promise<void>;
export function createFinishedCaseClosureSourceThroughApi(
  request: APIRequestContext,
): Promise<CaseClosureSource>;
export function caseClosureSqlRejection(
  caseId: string,
  probe:
    | 'case-version-only'
    | 'version-update'
    | 'version-delete'
    | 'document-delete'
    | 'receipt-update'
    | 'receipt-delete'
    | 'audit-delete'
    | 'head-foreign-current',
): Promise<{ code: string | null; unchanged: boolean }>;
export function withCaseClosureFault(
  caseId: string,
  phase:
    | 'audit'
    | 'head'
    | 'version'
    | 'document'
    | 'reference'
    | 'case'
    | 'receipt',
  command: () => Promise<APIResponse>,
): Promise<{ status: number; reached: boolean; unchanged: boolean }>;
export function clearCaseClosureFixture(): Promise<void>;
