export const e2eFixtures: Readonly<{
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
  tokenA: string;
  tokenB: string;
  tokenSelf: string;
}>;

export function resetCustomerE2eData(): Promise<void>;
export function findCustomerId(
  departmentId: string,
  name: string,
): Promise<string>;
export function countCustomers(
  departmentId: string,
  name: string,
): Promise<number>;
export function countCustomerDraftAuditEvents(
  departmentId: string,
): Promise<number>;
export function countCustomerAuditEvents(
  departmentId: string,
  action: string,
): Promise<number>;
export function countCustomerResourceAuditEvents(
  resourceId: string,
  action: string,
): Promise<number>;
export function countCustomersByNormalizedIdentity(
  departmentId: string,
  identityType: string,
  value: string,
): Promise<number>;
export function getCustomer(
  departmentId: string,
  name: string,
): Promise<{ id: string; version: number }>;
export function getCustomerById(id: string): Promise<{
  id: string;
  name: string;
  category: string | null;
  identityType: string | null;
  identityNumber: string | null;
  version: number;
}>;
export function getLatestCustomerAudit(
  resourceId: string,
  action?: string,
): Promise<{ details: unknown }>;
export function getCustomerAuditEvents(
  resourceId: string,
  action?: string,
): Promise<Array<{ details: unknown }>>;
export function verifyRoleAssignmentMigrationRollback(): Promise<{
  rejected: boolean;
  constraintNames: string[];
}>;
export function disableDepartmentARoleAssignment(): Promise<unknown>;
export function assignDepartmentBRoleInsideDepartmentA(): Promise<void>;
export function duplicateDepartmentLevelRoleAssignment(): Promise<void>;
export function assignForeignDepartmentResponsibility(): Promise<void>;
export function assignForeignDepartmentAuditActor(): Promise<void>;
export function rejectCustomerDraftAuditWrites(): Promise<void>;
export function allowCustomerDraftAuditWrites(): Promise<void>;
export function rejectCustomerUpdateAuditWrites(): Promise<void>;
export function allowCustomerUpdateAuditWrites(): Promise<void>;
export function rejectNamedCustomerWrites(name: string): Promise<void>;
export function allowNamedCustomerWrites(): Promise<void>;
export function disconnectCustomerTestDatabase(): Promise<void>;
