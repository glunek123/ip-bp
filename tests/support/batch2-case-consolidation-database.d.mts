export declare function prepareBatch2CaseConsolidationFixture(): Promise<{
  run: string;
  businessTag: string;
  shopExternalId: string;
  departmentId: string;
  userId: string;
  customerId: string;
  holderId: string;
  lawyerUserId: string;
  lawyerProfileId: string;
  username: string;
  password: string;
  cases: Array<{ id: string; businessNo: string; feeId: string | null }>;
}>;
export declare function inspectBatch2CaseConsolidationFixture(
  departmentId: string,
  caseIds: string[],
): Promise<{
  feeRows: Array<{ id: string; case_id: string; amount: string }>;
  relations: Array<{ case_id: string; is_main: boolean }>;
}>;
export declare function assertBatch2CaseConsolidationTarget(): string;
export declare function addBatch2OriginalCaseFees(
  departmentId: string,
  userId: string,
  cases: Array<{ id: string }>,
): Promise<string[]>;
