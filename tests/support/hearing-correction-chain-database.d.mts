export function verifyHearingCorrectionChain(): Promise<{
  head: string;
  tree: string;
  fingerprint: string;
  migrationCount: number;
  branches: Array<string | null>;
  races: string[];
  lockProofs: Array<{ race: string; events: string[] }>;
  scanStateChecks: string[];
  caseIds: string[];
  revokedReplayDenied: boolean;
}>;
