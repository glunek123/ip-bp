type SyntheticAccount = { id: string; username: string; password: string };
export function seedBatch2ProxyCalendarActors(): Promise<{
  departmentId: string;
  foreignDepartmentId: string;
  operator: SyntheticAccount;
  colleague: SyntheticAccount;
  foreign: SyntheticAccount;
  clientAccount: SyntheticAccount;
  customers: { withAccount: string; withoutAccount: string };
  rightsHolderId: string;
  suffix: string;
}>;
export function transferBatch2SyntheticCaseOwner(
  caseId: string,
  departmentId: string,
  expectedOwnerId: string,
  newOwnerId: string,
): Promise<number>;
