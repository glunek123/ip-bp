export function verifyHearingCorrectionChain(): Promise<{
  head: string;
  tree: string;
  fingerprint: string;
  migrationCount: number;
  branches: Array<string | null>;
  races: string[];
  caseIds: string[];
  revokedReplayDenied: boolean;
}>;
