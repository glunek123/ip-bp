export declare function verifyCaseAcceptanceMigration(): Promise<{
  empty: {
    previous: number;
    total: number;
    enumValue: number;
    factTable: number;
  };
  upgrade: {
    oldFiling: number;
    oldReceipt: number;
    copiedGrant: number;
    revision: number;
  };
  constraints: {
    earlyDate: string | null;
    futureDate: string | null;
    wrongAudit: string | null;
    badVersion: string | null;
    immutableFact: string | null;
    lawyerNewAction: number;
    lawyerWrongStage: string | null;
    lawyerOldAction: number;
  };
  failure: {
    enumFailed: string | null;
    enumNoPartial: number;
    factsFailed: string | null;
    factsNoPartial: number;
    grantsFailed: string | null;
    grantsNoPartial: number;
    revisionNoPartial: number;
    recoveredGrant: number;
  };
}>;
