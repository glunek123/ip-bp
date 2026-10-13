import type { APIRequestContext } from '@playwright/test';

export function createCaseExecutionFilingSourceThroughApi(
  request: APIRequestContext,
  options?: {
    onComplaintSubmitted?: (caseId: string) => Promise<void>;
    onExecutionPrepared?: (caseId: string) => Promise<void>;
  },
): Promise<{
  caseId: string;
  client: { username: string; password: string };
  lawyer: {
    id: string;
    username: string;
    password: string;
    profiles: Array<{ bindingId: string; profileId: string }>;
  };
  source: {
    caseId: string;
    client: { username: string; password: string };
    lawyer: {
      id: string;
      username: string;
      password: string;
      profiles: Array<{ bindingId: string; profileId: string }>;
    };
    complaint: { materialId: string; contentVersionId: string };
    authorization: { materialId: string; contentVersionId: string };
    submitted: {
      id: string;
      stage: string;
      version: number;
      submittedAt: string;
    };
  };
  stage: 'EXECUTING';
}>;
