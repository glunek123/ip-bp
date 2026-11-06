export function withLitigationRefundCommitFault<T>(
  caseId: string,
  callback: () => Promise<T>,
): Promise<T>;
