export function verifyBatch2LeadImportUpgrade(): Promise<{
  migrationCount: number;
  oldReceiptPreserved: boolean;
  newResponsibleOwner: string;
  retryActor: string;
  forgedOwnerRejected: boolean;
  crossDepartmentRetryRejected: boolean;
  wrongProductRejected: boolean;
  faultRollbackAndRetry: boolean;
}>;
