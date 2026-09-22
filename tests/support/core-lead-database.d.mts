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
  products: Array<{ estimatedAmount: { toFixed(scale: number): string } }>;
} | null>;
export function countLeads(): Promise<number>;
export function countAdmissionReceipts(): Promise<number>;
export function countLeadReceipts(): Promise<number>;
export function countLeadPushReceipts(leadId: string): Promise<number>;
export function countLeadPushAudits(leadId: string): Promise<number>;
export function setGrant(action: string, enabled: boolean): Promise<unknown>;
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
