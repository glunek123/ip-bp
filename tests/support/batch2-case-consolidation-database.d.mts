export declare function prepareBatch2CaseConsolidationFixture(): Promise<{
  run: string;
  businessTag: string;
  departmentId: string;
  userId: string;
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
export declare function prepareBatch2ConsolidatedFilingSource(
  departmentId: string,
  userId: string,
  mainCaseId: string,
  childCaseId: string,
): Promise<{ courtId: string; materialId: string; contentVersionId: string }>;
