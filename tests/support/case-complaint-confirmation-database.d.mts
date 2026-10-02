import type { APIRequestContext } from '@playwright/test';
export function createSubmittedCaseThroughApi(
  request: APIRequestContext,
): Promise<{
  caseId: string;
  complaint: { materialId: string; contentVersionId: string };
  authorization: { materialId: string; contentVersionId: string };
  submitted: {
    id: string;
    stage: string;
    version: number;
    submittedAt: string;
  };
  submitInput: {
    expectedVersion: number;
    idempotencyKey: string;
    amountState: string;
    amount: string;
    pendingReason: null;
    complaintContentVersionIds: string[];
    authorizationContentVersionIds: string[];
  };
  clientSession: { csrfToken: string };
  notarySession: { csrfToken: string };
}>;
export function uploadCaseConfirmationFile(
  request: APIRequestContext,
  caseId: string,
  purpose?: string,
  headers?: Record<string, string>,
): Promise<{ materialId: string; contentVersionId: string }>;
