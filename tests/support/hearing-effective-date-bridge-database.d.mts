export function verifyHearingEffectiveDateBridge(): Promise<{
  head: string;
  tree: string;
  fingerprint: string;
  migrationCount: number;
  cases: string[];
  races: string[];
  lockProofs: Array<{ race: string; events: string[] }>;
  caseIds: string[];
}>;
