export const e2eFixtures: Readonly<{
  departmentA: string;
  departmentB: string;
  userA: string;
  userB: string;
  roleA: string;
  roleB: string;
  tokenA: string;
  tokenB: string;
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
export function disableDepartmentARoleAssignment(): Promise<unknown>;
export function assignDepartmentBRoleInsideDepartmentA(): Promise<void>;
export function rejectCustomerDraftAuditWrites(): Promise<void>;
export function allowCustomerDraftAuditWrites(): Promise<void>;
export function rejectNamedCustomerWrites(name: string): Promise<void>;
export function allowNamedCustomerWrites(): Promise<void>;
export function disconnectCustomerTestDatabase(): Promise<void>;
