export function verifyCaseComplaintMailingMigration(): Promise<{
  empty: {
    migrationCount: number;
    previousMigrationCount: number;
    stage: number;
    factTable: number;
    receiptTable: number;
  };
  upgrade: {
    preservedStage: string;
    oldSubmitReceipt: number;
    oldConfirmation: number;
    oldConfirmReceipt: number;
    copiedScope: string;
    authorizationRevision: number;
  };
  constraints: {
    badIdentity: string | null;
    badDate: string | null;
    badVersion: string | null;
    immutableFact: string | null;
    crossEnterprise: string | null;
    crossDepartment: string | null;
    wrongCategory: string | null;
    mixedActor: string | null;
    wrongAuditAction: string | null;
    revokedCleanup: string;
  };
  failure: {
    enumFailed: string | null;
    enumNoPartial: number;
    factsFailed: string | null;
    factsNoPartial: number;
    grantsFailed: string | null;
    grantsNoPartial: number;
    actorPathFailed: string | null;
    actorPathNoPartial: number;
    recoveredGrant: number;
    recoveredRevision: number;
  };
}>;
