import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { captureTestEnvironment } from '../../../../scripts/test-environment.mjs';
import { acquireE2eResourceLock } from '../../../../scripts/run-e2e.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const migration = readFileSync(
  resolve(
    root,
    'backend/prisma/migrations/20261028190000_restore_early_archive_origin_checks/migration.sql',
  ),
  'utf8',
)
  .replace(/^BEGIN;\s*$/mu, '')
  .replace(/^COMMIT;\s*$/mu, '');
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
const lock = acquireE2eResourceLock();
try {
  await client.connect();
  await client.query('BEGIN');
  const schema = `early_archive_origin_${randomBytes(8).toString('hex')}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE cases (
      id uuid PRIMARY KEY, department_id uuid NOT NULL, stage case_stage NOT NULL,
      version int NOT NULL, source_lead_id uuid, source_notary_matter_id uuid,
      certificate_id uuid, matched_at timestamptz,
      complaint_submitted_at timestamptz, complaint_submitted_by_user_id uuid,
      complaint_amount_state case_complaint_amount_state, complaint_amount numeric,
      complaint_pending_reason text,
      CONSTRAINT cases_matching_state_check CHECK (
        (source_lead_id IS NULL AND source_notary_matter_id IS NULL AND certificate_id IS NULL)
        OR (version >= 1 AND ((stage = 'PENDING_MATCH' AND matched_at IS NULL)
          OR (stage IN ('WAITING_COMPLAINT','WAITING_JUDGMENT','ARCHIVED') AND matched_at IS NOT NULL)))
      ),
      CONSTRAINT cases_complaint_state_check CHECK (
        (source_lead_id IS NULL AND source_notary_matter_id IS NULL AND certificate_id IS NULL)
        OR ((stage IN ('PENDING_MATCH','WAITING_COMPLAINT') AND complaint_submitted_at IS NULL
          AND complaint_submitted_by_user_id IS NULL AND complaint_amount_state IS NULL
          AND complaint_amount IS NULL AND complaint_pending_reason IS NULL)
        OR (stage IN ('WAITING_JUDGMENT','ARCHIVED') AND complaint_submitted_at IS NOT NULL
          AND complaint_submitted_by_user_id IS NOT NULL AND complaint_amount_state IS NOT NULL
          AND ((complaint_amount_state = 'KNOWN' AND complaint_amount >= 0 AND complaint_pending_reason IS NULL)
            OR (complaint_amount_state = 'PENDING' AND complaint_amount IS NULL AND length(btrim(complaint_pending_reason)) > 0))))
      )
    );
    CREATE TABLE case_early_archives (case_id uuid, department_id uuid, from_stage case_stage);
  `);
  await client.query(migration);
  const [caseId, departmentId, leadId, matterId, certificateId] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );
  await client.query(
    `INSERT INTO cases (id,department_id,stage,version,source_lead_id,source_notary_matter_id,certificate_id)
     VALUES ($1,$2,'PENDING_MATCH',1,$3,$4,$5)`,
    [caseId, departmentId, leadId, matterId, certificateId],
  );
  await client.query(
    `INSERT INTO case_early_archives VALUES ($1,$2,'PENDING_MATCH')`,
    [caseId, departmentId],
  );
  await client.query(
    `UPDATE cases SET stage='ARCHIVED', version=2 WHERE id=$1`,
    [caseId],
  );
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SAVEPOINT reject_invalid');
  await assert.rejects(
    client.query('UPDATE cases SET matched_at=now() WHERE id=$1', [caseId]),
    (error) => error.code === '23514',
  );
  await client.query('ROLLBACK TO SAVEPOINT reject_invalid');
  await client.query('SAVEPOINT reject_unarchived');
  await assert.rejects(
    client.query(
      `INSERT INTO cases (id,department_id,stage,version,source_lead_id,source_notary_matter_id,certificate_id,matched_at)
      VALUES ($1,$2,'PENDING_MATCH',1,$3,$4,$5,now())`,
      [randomUUID(), departmentId, leadId, matterId, certificateId],
    ),
    (error) => error.code === '23514',
  );
  await client.query('ROLLBACK TO SAVEPOINT reject_unarchived');
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
  lock.release();
}
