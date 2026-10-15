export function assertHearingCorrectionChainR2Binding(environment: {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DEV_COR_TEST_DATABASE_URL?: string;
  DEV_COR_TEST_DATABASE_PROJECT?: string;
  DEV_COR_TEST_DATABASE_CONTAINER_ID?: string;
}): void;

export function verifyHearingCorrectionChain(): Promise<{
  head: string;
  tree: string;
  fingerprint: string;
  migrationCount: number;
  branches: Array<string | null>;
  races: string[];
  lockProofs: Array<{
    race: string;
    events: string[];
    scanConflict: {
      participant: 'second';
      prismaCode: 'P2010';
      sqlState: '40001';
      driverKind: 'TransactionWriteConflict';
    } | null;
  }>;
  scanStateChecks: string[];
  caseIds: string[];
  revokedReplayDenied: boolean;
}>;
