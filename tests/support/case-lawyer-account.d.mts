import type { APIRequestContext } from '@playwright/test';

export function createLawyerAccountThroughApi(
  request: APIRequestContext,
  profile?: { fullName?: string; lawFirm?: string; phone?: string },
  headers?: Record<string, string>,
): Promise<{
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  authorizationRevision: number;
  profiles: Array<{ bindingId: string; profileId: string; fullName: string }>;
  password: string;
}>;
