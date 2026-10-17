export declare function recordMaterialGuardSources(): Promise<{
  oldFunctions: string[];
  repairSql: string;
  sourceSha256: string;
}>;

export declare function verifyRecordMaterialGuardRepair(): Promise<{
  checks: string[];
  ledgerCount: number;
  repairSha256: string;
  publicUnchanged: true;
  authorizationScope: string;
}>;
