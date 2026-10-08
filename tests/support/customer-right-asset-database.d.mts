export function verifyCustomerRightAssetMigration(): Promise<{
  oldMigrations: number;
  emptyChain: boolean;
  upgradePreserved: boolean;
  rollbackRetry: boolean;
  crossDepartmentRejected: boolean;
  sameCustomerMismatchRejected: boolean;
}>;
export function setRightAssetWithdrawGrant(
  roleId: string,
  enabled: boolean,
): Promise<void>;
export function setRightAssetRoutineGrant(
  roleId: string,
  enabled: boolean,
): Promise<void>;
export function setRightAssetReadGrant(
  roleId: string,
  enabled: boolean,
): Promise<void>;
export function setRightAssetAdmitGrant(
  roleId: string,
  enabled: boolean,
): Promise<void>;
export function countRightEvidenceReferences(
  customerId: string,
): Promise<number>;
export function rightAssetReceiptFingerprint(
  customerId: string,
  key: string,
): Promise<string | null>;
export function clearCustomerRightAssetFixture(
  customerId: string,
  departmentId: string,
): Promise<void>;
export function ensureRightAssetRealLogin(): Promise<{
  username: string;
  password: string;
}>;
export function clearRightAssetRealLogin(): Promise<void>;
export function rightAssetDatabaseSnapshot(
  customerId: string,
): Promise<{ customerVersion: number; assets: number }>;
export function rightAssetEvidenceSnapshot(customerId: string): Promise<{
  customerVersion: number;
  assets: number;
  versions: number;
  receipts: number;
  audits: number;
}>;
export function rejectRightAssetAuditWrites(enabled: boolean): Promise<void>;
export function rejectRightEvidenceReferenceWrites(
  enabled: boolean,
): Promise<void>;
export function rejectRightAssetReceiptWrites(enabled: boolean): Promise<void>;
export function verifyRightAssetDatabaseGuards(
  customerId: string,
  assetId: string,
  departmentId: string,
  otherAssetId: string,
): Promise<{
  immutable: boolean;
  pointerRejected: boolean;
  missingPointerRejected: boolean;
  badVersionRejected: boolean;
  auditImmutable: boolean;
  dateRejected: boolean;
}>;
