import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { assertBatch2ImportTarget } from './batch2-lead-import-target.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');

/** Owned synthetic PG acceptance only; caller first creates the lead through HTTP. */
export async function assertDistinctOperatorReceipt({
  leadId,
  key,
  actorId,
  ownerId,
  teamId,
}) {
  const connectionString = assertBatch2ImportTarget();
  if (actorId === ownerId)
    throw new Error('Expected distinct synthetic actor and owner');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const receipt = await client.query(
      `
      SELECT r."id", r."department_id", r."actor_user_id", r."idempotency_key",
        l."responsible_user_id", l."team_id"
      FROM "lead_csv_import_receipts" r
      JOIN "leads" l ON l."id" = $1::uuid
      WHERE r."idempotency_key" = $2 AND r."actor_user_id" = $3::uuid
        AND r."result_snapshot"->'items'->0->'lead'->>'id' = l."id"::text
    `,
      [leadId, key, actorId],
    );
    if (
      receipt.rowCount !== 1 ||
      receipt.rows[0].responsible_user_id !== ownerId ||
      receipt.rows[0].team_id !== teamId
    )
      throw new Error(
        'Distinct operator receipt did not persist expected actor/owner/team',
      );
    const audit = await client.query(
      `
      SELECT count(*)::integer AS count FROM "audit_events"
      WHERE "resource_type" = 'lead' AND "resource_id" = $1::uuid
        AND "actor_user_id" = $2::uuid AND "action" = 'lead.created'
    `,
      [leadId, actorId],
    );
    if (audit.rows[0].count !== 1)
      throw new Error(
        'Lead creation audit does not identify the real importer',
      );

    // A direct SQL caller cannot forge a different owner in a receipt snapshot.
    // Force the deferred trigger before ROLLBACK so this never persists test data.
    await client.query('BEGIN');
    let rejected = false;
    try {
      await client.query(
        `
        INSERT INTO "lead_csv_import_receipts"
          ("id", "department_id", "actor_user_id", "idempotency_key",
           "request_fingerprint", "remote_fingerprint", "original_request", "result_snapshot")
        SELECT $1::uuid, "department_id", "actor_user_id", $2,
          "request_fingerprint", "remote_fingerprint", "original_request",
          jsonb_set("result_snapshot", '{items,0,lead,responsibleUserId}', to_jsonb($3::text))
        FROM "lead_csv_import_receipts" WHERE "id" = $4::uuid
      `,
        [
          randomUUID(),
          `forged-owner-${randomUUID()}`,
          actorId,
          receipt.rows[0].id,
        ],
      );
      await client.query(
        'SET CONSTRAINTS "lead_csv_import_receipt_integrity" IMMEDIATE',
      );
    } catch (error) {
      if (error.code !== '23514') throw error;
      rejected = true;
    } finally {
      await client.query('ROLLBACK');
    }
    if (!rejected)
      throw new Error('Migration 190 accepted a forged owner snapshot');
  } finally {
    await client.end();
  }
}

export async function assertRetriedImageTaskIdentity({
  taskId,
  originalActorId,
  retryActorId,
}) {
  const connectionString = assertBatch2ImportTarget();
  if (originalActorId === retryActorId)
    throw new Error('Expected distinct synthetic image actors');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `
      SELECT "actor_user_id", "retry_actor_user_id", "generation", "lead_id"
      FROM "lead_image_import_tasks" WHERE "id" = $1::uuid
    `,
      [taskId],
    );
    const row = result.rows[0];
    if (
      result.rowCount !== 1 ||
      row.actor_user_id !== originalActorId ||
      row.retry_actor_user_id !== retryActorId ||
      row.generation < 1
    )
      throw new Error(
        'Image retry changed original actor or lost the new executor',
      );
    const audit = await client.query(
      `
      SELECT count(*)::integer AS count FROM "audit_events"
      WHERE "resource_type" = 'lead' AND "resource_id" = $1::uuid
        AND "actor_user_id" = $2::uuid AND "action" = 'lead.image_import.retry'
        AND "details"->>'taskId' = $3::text
    `,
      [row.lead_id, retryActorId, taskId],
    );
    if (audit.rows[0].count !== 1)
      throw new Error(
        'Image retry audit does not identify the actual executor',
      );
  } finally {
    await client.end();
  }
}
