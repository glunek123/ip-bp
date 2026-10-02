export function verifyCaseComplaintConfirmationMigration(): Promise<{
  empty: {
    migrationCount: number;
    previousMigrationCount: number;
    stage: number;
    factTable: number;
    receiptTable: number;
  };
  upgrade: {
    preserved: {
      stage: string;
      version: number;
      complaint_amount_state: string;
      complaint_amount: string;
      complaint_submitted_at: Date;
    };
    oldReceiptCount: number;
    grants: Array<{ role_template_id: string; scope: string }>;
    revisions: { active: number; inactive: number };
    beforeRevision: number;
    versions: Array<{ id: string; version: number }>;
    badAmountCode: string | null;
    badStageCode: string | null;
  };
  failure: {
    enum: {
      failedCode: string | null;
      noPartialAction: number;
      noPartialStage: number;
      recoveredAction: number;
      recoveredStage: number;
    };
    facts: {
      failedCode: string | null;
      noPartialStageCheck: number;
      noReceipt: number;
      recovered: number;
    };
    grants: {
      failedCode: string | null;
      noPartialGrant: number;
      unchangedTemplateVersion: number;
      unchangedAccountRevision: number;
      recoveredGrant: number;
      recoveredTemplateVersion: number;
      recoveredAccountRevision: number;
    };
  };
}>;
