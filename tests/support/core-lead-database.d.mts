export const coreLeadFixtures: Readonly<{
  departmentA: string;
  departmentB: string;
  userA: string;
  userB: string;
  userSelf: string;
  roleA: string;
  roleB: string;
  roleSelf: string;
  teamA: string;
  teamSelf: string;
  draftCustomer: string;
  admittedCustomer: string;
  foreignCustomer: string;
  selfCustomer: string;
  holder: string;
  unlinkedHolder: string;
  foreignHolder: string;
  selfHolder: string;
  tokenA: string;
  tokenB: string;
  tokenSelf: string;
  operatorUsername: string;
  operatorPassword: string;
}>;

export function resetCoreLeadE2eData(): Promise<void>;
export function getCustomer(id: string): Promise<{
  profileStatus: string;
  version: number;
} | null>;
export function getLead(id: string): Promise<{
  version: number;
  shopName: string;
  products: Array<{
    id: string;
    estimatedAmount: { toFixed(scale: number): string };
  }>;
} | null>;
export function countLeads(): Promise<number>;
export function countAdmissionReceipts(): Promise<number>;
export function countLeadReceipts(): Promise<number>;
export function countLeadPushReceipts(leadId: string): Promise<number>;
export function countLeadPushAudits(leadId: string): Promise<number>;
export function getLeadEvidenceDecision(leadId: string): Promise<{
  id: string;
  leadId: string;
  result: string;
  reason: string;
  archiveType: string;
  decidedAt: Date;
  actorUserId: string;
  fromVersion: number;
  toVersion: number;
} | null>;
export function countLeadEvidenceDecisions(leadId: string): Promise<number>;
export function countLeadEvidenceReceipts(leadId: string): Promise<number>;
export function countLeadEvidenceAudits(leadId: string): Promise<number>;
export function countNotaryMatters(leadId: string): Promise<number>;
export function countNotaryHandoffReceipts(leadId: string): Promise<number>;
export function countNotaryHandoffAudits(leadId: string): Promise<number>;
export function countNotaryEvidence(matterId: string): Promise<number>;
export function countNotaryLogistics(matterId: string): Promise<number>;
export function countNotaryEvidenceReceipts(matterId: string): Promise<number>;
export function countNotaryEvidenceAudits(matterId: string): Promise<number>;
export function countNotaryOpenings(matterId: string): Promise<number>;
export function countNotaryOpeningReceipts(matterId: string): Promise<number>;
export function countNotaryOpeningAudits(matterId: string): Promise<number>;
export function countNotaryOpeningReferences(matterId: string): Promise<number>;
export function getLeadReviewDecision(leadId: string): Promise<{
  id: string;
  leadId: string;
  result: string;
  reason: string | null;
  archiveType: 'NO_INFRINGEMENT' | null;
  archivedAt: Date | null;
  reviewerDisplayNameSnapshot: string;
  decidedAt: Date;
  fromVersion: number;
  toVersion: number;
} | null>;
export function countLeadReviewDecisions(leadId: string): Promise<number>;
export function countClientLeadReviewReceipts(leadId: string): Promise<number>;
export function getLeadReviewDecisions(leadId: string): Promise<
  Array<{
    id: string;
    leadId: string;
    result: string;
    reason: string | null;
    archiveType: 'NO_INFRINGEMENT' | null;
    archivedAt: Date | null;
    fromVersion: number;
    toVersion: number;
    receipt: { id: string; resultSnapshot: unknown } | null;
  }>
>;
export function getLeadWithdrawalApplication(leadId: string): Promise<{
  id: string;
  originalDecisionId: string;
  leadId: string;
  customerId: string;
  departmentId: string;
  applicantUserId: string;
  reason: string;
  appliedAt: Date;
  fromVersion: number;
  toVersion: number;
  idempotencyKey: string;
  requestFingerprint: string;
  resultSnapshot: unknown;
  confirmation: {
    id: string;
    actorUserId: string;
    customerAccountBindingId: string;
    fromVersion: number;
    toVersion: number;
    resultSnapshot: unknown;
  } | null;
} | null>;
export function countLeadWithdrawalApplications(
  leadId: string,
): Promise<number>;
export function countLeadWithdrawalConfirmations(
  leadId: string,
): Promise<number>;
export function countLeadWithdrawalAudits(leadId: string): Promise<number>;
export function setClientBindingActive(
  customerId: string,
  active: boolean,
): Promise<unknown>;
export function setClientUserActive(
  customerId: string,
  active: boolean,
): Promise<unknown>;
export function setGrant(action: string, enabled: boolean): Promise<unknown>;
export function setTeamActive(
  teamId: string,
  active: boolean,
): Promise<unknown>;
export function setCustomerStatus(
  customerId: string,
  profileStatus: 'DRAFT' | 'ADMITTED',
): Promise<unknown>;
export function setClientAccountActive(
  customerId: string,
  active: boolean,
): Promise<{ id: string; userId: string }>;
export function removeLeadProducts(leadId: string): Promise<unknown>;
export function markContentVersion(
  versionId: string,
  status: 'AVAILABLE' | 'DELETED' | 'PURGED',
): Promise<unknown>;
export function rejectAuditWrites(action: string): Promise<void>;
export function rejectLeadPushReceiptWrites(): Promise<void>;
export function rejectLeadEvidenceDecisionWrites(): Promise<void>;
export function rejectLeadEvidenceReceiptWrites(): Promise<void>;
export function rejectNotaryHandoffReceiptWrites(): Promise<void>;
export function rejectNotaryEvidenceWrites(): Promise<void>;
export function rejectNotaryEvidenceReceiptWrites(): Promise<void>;
export function rejectNotaryOpeningWrites(): Promise<void>;
export function rejectNotaryOpeningReferenceWrites(): Promise<void>;
export function rejectLeadReviewDecisionWrites(): Promise<void>;
export function rejectClientLeadReviewReceiptWrites(): Promise<void>;
export function rejectWithdrawalApplicationWrites(): Promise<void>;
export function rejectWithdrawalConfirmationWrites(): Promise<void>;
export function rejectLeadProductWrites(): Promise<void>;
export function rejectMaterialMetadataWrites(): Promise<void>;
export function allowInjectedFailures(): Promise<void>;
export function countStoredFiles(): Promise<number>;
export function setLeadCounter(value: number): Promise<void>;
export function databaseCounts(): Promise<{
  leads: number;
  products: number;
  audits: number;
  materials: number;
  versions: number;
  references: number;
}>;
export function getMaterialByVersion(versionId: string): Promise<{
  materialId: string;
  material: { id: string };
} | null>;
export function installMaterialStatusBarrier(
  materialId: string,
  status: 'ACTIVE' | 'DELETED',
): Promise<{ wait(): Promise<void>; release(): Promise<void> }>;
export function setMaterialDeletedAt(
  materialId: string,
  deletedAt: Date,
): Promise<void>;
export function getMaterialLifecycle(materialId: string): Promise<{
  status: string;
  version: number;
  contentVersions: Array<{ status: string }>;
} | null>;
export function getMaterialAuditActions(materialId: string): Promise<string[]>;
export function startMaterialCleanup(now: Date): {
  deleteStarted: Promise<void>;
  allowDelete(): void;
  result: Promise<void>;
};
export function verifyCoreLeadMigration(): Promise<{
  empty: { tables: string[] };
  reviewIntegrity: {
    wrongCustomer: string | null;
    wrongReviewer: string | null;
    wrongBindingCustomer: string | null;
    wrongActor: string | null;
    wrongReceiptBinding: string | null;
    wrongLead: string | null;
    wrongVersion: string | null;
    invalidVersionPair: string | null;
    nonReviewAction: string | null;
    decisionUpdate: string | null;
    decisionDelete: string | null;
    receiptUpdate: string | null;
    receiptDelete: string | null;
    leadIdentityUpdate: string | null;
    bindingIdentityUpdate: string | null;
  };
  reviewUpgrade: {
    rowsPreserved: boolean;
    leadFactsPreserved: boolean;
    receiptReplayable: boolean;
    decisionCount: number;
    receiptCount: number;
  };
  archiveUpgrade: {
    oldFactsNull: boolean;
    oldSnapshotPreserved: boolean;
    oldFingerprintPreserved: boolean;
    oldReceiptLinked: boolean;
  };
  archiveConstraints: {
    valid: string | null;
    blank: string | null;
    overlong: string | null;
    missingType: string | null;
    missingTime: string | null;
    mismatchedFacts: string | null;
    decisionUpdate: string | null;
    decisionDelete: string | null;
  };
  archiveFailure: {
    code: string | null;
    originalColumnPreserved: number;
    addedColumns: number;
    archiveTypes: number;
    addedConstraints: number;
  };
  reviewActionRecovery: { actionCount: number };
  reviewSchemaFailure: {
    code: string | null;
    originalDecisionColumns: number;
    receiptTables: number;
    mutationTriggers: number;
    reviewEnumTypes: number;
  };
  reviewIntegrityFailure: {
    code: string | null;
    addedConstraints: number;
    receiptTriggers: number;
  };
  upgrade: {
    known: {
      customer_type: string;
      identity_type: string;
      profile_status: string;
    };
    unknown: {
      customer_type: string;
      identity_type: string;
      profile_status: string;
    };
    invalidAdmittedCode: string | null;
    compatibleAdmittedStatus: string | null;
    grantCounts: Record<string, number>;
    pushGrantCounts: Record<string, number>;
    revisions: Record<string, number>;
    identityIsolation: {
      unboundClientCode: string | null;
      clientMembershipCode: string | null;
      clientRoleCode: string | null;
      internalBindingCode: string | null;
      lastBindingDeleteCode: string | null;
      pushedAtOnlyCode: string | null;
      pushedByOnlyCode: string | null;
    };
  };
  clientActionRecovery: {
    pushActionCount: number;
    accountTypeExists: boolean;
  };
  clientSchemaFailure: {
    code: string | null;
    addedColumns: number;
  };
  schemaFailure: {
    code: string | null;
    createdTables: number;
    addedColumns: number;
    addedConstraints: number;
  };
  backfillFailure: {
    code: string | null;
    grantCount: number;
    revision: number;
    grantInsertAttempts: number;
    revisionUpdateAttempts: number;
  };
}>;
export function disconnectCoreLeadTestDatabase(): Promise<void>;
