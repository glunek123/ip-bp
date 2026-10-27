export function assertBatch2Admission(environment?: NodeJS.ProcessEnv): {
  databaseUrl: string;
  databaseName: string;
};
export function verifyBatch2EmptyMigrationAndEpoch(): Promise<{
  migrationCount: number;
  tables: string[];
  epoch: number[];
  invalidTypesRejected: boolean;
  proxyActorRejected: boolean;
  legacyExternalPreserved: boolean;
}>;
export function readBatch2ProxyAudit(
  kind: 'review' | 'withdrawal' | 'certificate',
  id: string,
): Promise<
  Array<{
    actor_kind: string;
    internal_actor_user_id: string | null;
    binding_id: string | null;
    actor_user_id: string;
    result: string;
    occurred_at: Date;
  }>
>;
export function readBatch2CertificateDownstream(
  matterId: string,
  caseId: string,
): Promise<{
  fees: number;
  evidence: number;
  feeRecords: number;
}>;
