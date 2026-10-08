export function verifyCustomerRightAssetMigration(): Promise<{
  oldMigrations: number;
  emptyChain: boolean;
  upgradePreserved: boolean;
  rollbackRetry: boolean;
  crossDepartmentRejected: boolean;
}>;
export function setRightAssetWithdrawGrant(
  roleId: string,
  enabled: boolean,
): Promise<void>;
export function setRightAssetRoutineGrant(
  roleId: string,
  enabled: boolean,
): Promise<void>;
export function clearCustomerRightAssetFixture(
  customerId: string,
  departmentId: string,
): Promise<void>;
export function rightAssetDatabaseSnapshot(
  customerId: string,
): Promise<{ customerVersion: number; assets: number }>;
export function rejectRightAssetAuditWrites(enabled: boolean): Promise<void>;
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
