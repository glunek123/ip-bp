import type { ActorContext } from '../../access-control/actor-context';
import type { Prisma } from '../../generated/prisma/client';
/** Internal verification only. No public DTO flag can create or authenticate a target.
 * Creation/finalize routing is not wired yet; ordinary upload authorization remains unchanged.
 */
export async function assertSettlementUploadContentTarget(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  input: {
    targetId: string;
    caseId: string;
    expectedClosureVersionId: string;
    contentVersionId: string;
  },
): Promise<void> {
  if (
    actor.clientCustomerId !== undefined ||
    actor.lawyerAccountId !== undefined ||
    actor.notaryOfficeId !== undefined
  )
    throw new Error('SETTLEMENT_UPLOAD_FORBIDDEN');
  if (
    !Number.isSafeInteger(actor.authorizationRevision) ||
    actor.authorizationRevision < 0
  )
    throw new Error('SETTLEMENT_UPLOAD_FORBIDDEN');
  await tx.$queryRawUnsafe(
    'SELECT lock_settlement_upload_actor_current($1::uuid,$2::uuid,$3::uuid,$4::integer)',
    actor.userId,
    actor.departmentId,
    input.caseId,
    actor.authorizationRevision,
  );
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT v.id FROM case_settlement_upload_targets t
    JOIN upload_drafts d ON d.id=t.upload_draft_id AND d.settlement_update_upload_target_id=t.id
    JOIN content_versions v ON v.source_upload_draft_id=d.id
    JOIN materials m ON m.id=v.material_id
    WHERE t.id=$1::uuid AND t.case_id=$2::uuid AND t.department_id=$3::uuid AND t.actor_user_id=$4::uuid
    AND t.authorization_revision=$7::integer AND t.expected_closure_version_id=$5::uuid AND v.id=$6::uuid AND t.purpose='CLOSURE_SETTLEMENT_UPDATE_DOCUMENT'
    AND d.owner_type='CASE' AND d.owner_id=t.case_id AND d.department_id=t.department_id AND d.actor_user_id=t.actor_user_id
    AND d.category='CASE_CLOSURE_DOCUMENT' AND d.purpose='CASE_CLOSURE_DOCUMENT' AND d.status='FINALIZED'
    AND m.owner_type='CASE' AND m.owner_id=t.case_id AND m.department_id=t.department_id AND m.status='ACTIVE' AND m.deleted_at IS NULL
    AND m.category='CASE_CLOSURE_DOCUMENT' AND m.purpose='CASE_CLOSURE_DOCUMENT' AND m.current_version_id=v.id
    AND v.status='AVAILABLE' AND v.mime_type IN ('application/pdf','image/jpeg','image/png') AND v.size_bytes BETWEEN 1 AND 52428800
    AND settlement_update_document_upload_eligible($4::uuid,t.case_id,t.department_id,t.expected_closure_version_id,$7::integer)
    FOR SHARE OF t,d,v,m`,
    input.targetId,
    input.caseId,
    actor.departmentId,
    actor.userId,
    input.expectedClosureVersionId,
    input.contentVersionId,
    actor.authorizationRevision,
  );
  if (rows.length !== 1) throw new Error('SETTLEMENT_UPLOAD_TARGET_CHANGED');
}
