import type { APIRequestContext } from '@playwright/test';
export function createSubmittedCaseThroughApi(
  request: APIRequestContext,
  options?: { submitAsLawyer?: boolean },
): Promise<{
  caseId: string;
  lawyer: {
    id: string;
    username: string;
    password: string;
    profiles: Array<{ bindingId: string; profileId: string }>;
  };
  lawyerSession: { csrfToken: string; principalType: string } | null;
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
  clientSession: { csrfToken: string; user: { username: string } };
  notarySession: { csrfToken: string; user: { username: string } };
}>;
export function uploadCaseConfirmationFile(
  request: APIRequestContext,
  caseId: string,
  purpose?: string,
  headers?: Record<string, string>,
): Promise<{ materialId: string; contentVersionId: string }>;
