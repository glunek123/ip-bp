import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = process.cwd();
const backend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = backend('pg');
const { validateIsolatedTestDatabaseUrl } = backend(
  '../scripts/test-environment.mjs',
);
const directory = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(directory)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const suffix = [
  '20261012030000_add_execution_mailing_filing_enums',
  '20261012031000_guard_execution_mailing_filing',
];
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const sql = (name) =>
  readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');

async function snapshot(client, schema, caseId) {
  const table = (name) => `${quote(schema)}.${quote(name)}`;
  return (
    await client.query(
      `SELECT
    (SELECT jsonb_build_object('stage',stage,'version',version,
      'currentSubmissionId',current_execution_submission_id,
      'currentChoiceId',current_judgment_next_step_id,
      'currentRoundId',current_trial_round_id)
      FROM ${table('cases')} WHERE id=$1) AS head,
    (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.to_version),'[]'::jsonb)
      FROM ${table('case_execution_submissions')} s WHERE s.case_id=$1) AS submissions,
    (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.submission_id,v.content_version_id),'[]'::jsonb)
      FROM ${table('case_execution_submission_versions')} v WHERE v.case_id=$1) AS versions,
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb)
      FROM ${table('case_execution_submission_receipts')} r WHERE r.case_id=$1) AS submission_receipts,
    (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]'::jsonb)
      FROM ${table('case_execution_confirmations')} f WHERE f.case_id=$1) AS confirmations,
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb)
      FROM ${table('case_execution_confirmation_receipts')} r WHERE r.case_id=$1) AS confirmation_receipts,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',cv.id,'sha256',cv.sha256,
      'sizeBytes',cv.size_bytes,'storageKey',cv.storage_key) ORDER BY cv.id),'[]'::jsonb)
      FROM ${table('content_versions')} cv JOIN ${table('case_execution_submission_versions')} v
        ON v.content_version_id=cv.id WHERE v.case_id=$1) AS exact_content,
    (SELECT coalesce(jsonb_agg(to_jsonb(ref) ORDER BY ref.id),'[]'::jsonb)
      FROM ${table('material_references')} ref WHERE ref.resource_type='case'
      AND ref.resource_id=$1 AND ref.purpose='EXECUTION_APPLICATION') AS frozen_references,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)
      FROM ${table('audit_events')} a WHERE a.resource_type='CASE' AND a.resource_id=$1
      AND a.action IN ('case.execution.submitted','case.execution.confirmed')) AS audit_events`,
      [caseId],
    )
  ).rows[0];
}

async function copyOldTables(client, schema) {
  const tables = (
    await client.query(
      `SELECT table_name FROM information_schema.tables
    WHERE table_schema=$1 AND table_type='BASE TABLE'
      AND table_name <> '_prisma_migrations' ORDER BY table_name`,
      [schema],
    )
  ).rows;
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL session_replication_role = replica');
    for (const { table_name: name } of tables) {
      const exists = (
        await client.query(`SELECT to_regclass($1) IS NOT NULL AS yes`, [
          `public.${quote(name)}`,
        ])
      ).rows[0].yes;
      if (!exists) throw new Error(`Missing public source table ${name}`);
      const enumColumns = (
        await client.query(
          `SELECT a.attname AS name,
        array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_type t ON t.oid=a.atttypid
        JOIN pg_enum e ON e.enumtypid=t.oid
        WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped
        GROUP BY a.attname ORDER BY a.attname`,
          [schema, name],
        )
      ).rows;
      const where = enumColumns
        .map(
          ({ name: column }, index) =>
            `(p.${quote(column)} IS NULL OR p.${quote(column)}::text = ANY($${index + 1}::text[]))`,
        )
        .join(' AND ');
      await client.query(
        `INSERT INTO ${quote(schema)}.${quote(name)}
        SELECT (json_populate_record(NULL::${quote(schema)}.${quote(name)},to_json(p))).*
        FROM public.${quote(name)} p${where ? ` WHERE ${where}` : ''}`,
        enumColumns.map(({ labels }) => labels),
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function assertNoOrphanedOldForeignKeys(client, schema) {
  const keys = (
    await client.query(
      `SELECT k.conname,
    format('%I.%I',n.nspname,c.relname) AS child,
    format('%I.%I',pn.nspname,pc.relname) AS parent,
    array(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY i(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=i.attnum
      ORDER BY i.ord) AS child_columns,
    array(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY i(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=i.attnum
      ORDER BY i.ord) AS parent_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class pc ON pc.oid=k.confrelid
    JOIN pg_namespace pn ON pn.oid=pc.relnamespace
    WHERE n.nspname=$1 AND k.contype='f' ORDER BY k.conname`,
      [schema],
    )
  ).rows;
  for (const key of keys) {
    if (
      !key.child.startsWith(`${schema}.`) ||
      !key.parent.startsWith(`${schema}.`)
    )
      throw new Error(`Unexpected external FK ${key.conname}`);
    const present = key.child_columns
      .map((column) => `c.${quote(column)} IS NOT NULL`)
      .join(' AND ');
    const match = key.child_columns
      .map(
        (column, index) =>
          `p.${quote(key.parent_columns[index])}=c.${quote(column)}`,
      )
      .join(' AND ');
    const result =
      await client.query(`SELECT count(*)::int AS n FROM ${key.child} c
      WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${key.parent} p WHERE ${match})`);
    if (result.rows[0].n !== 0)
      throw new Error(`Orphaned old FK ${key.conname}: ${result.rows[0].n}`);
  }
  return keys.length;
}

export async function verifyConfirmedPublicCaseUpgrade(caseId) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (
    names.length < 138 ||
    suffix.some((name, index) => names[136 + index] !== name)
  )
    throw new Error('Unexpected CA013/014 migration suffix');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `ca013_upgrade_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.connect();
    const location = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('CA013 upgrade requires isolated public test database');
    const original = await snapshot(client, 'public', caseId);
    if (
      original.head?.stage !== 'WAITING_EXECUTION_STAMP' ||
      original.submissions.length < 1 ||
      original.versions.length < 1 ||
      original.confirmations.length !== 1 ||
      original.confirmation_receipts.length !== 1 ||
      original.submission_receipts.length < 1 ||
      original.exact_content.length < 1
    )
      throw new Error(
        'A complete, API-confirmed execution source case is required',
      );
    await client.query(`CREATE SCHEMA ${quote(schema)}`);
    await client.query(`SET search_path TO ${quote(schema)}`);
    for (const name of names.slice(0, 136)) await client.query(sql(name));
    await copyOldTables(client, schema);
    const fkCount = await assertNoOrphanedOldForeignKeys(client, schema);
    if (fkCount === 0) throw new Error('Expected old foreign keys to verify');
    const copied = await snapshot(client, schema, caseId);
    if (JSON.stringify(copied) !== JSON.stringify(original))
      throw new Error('API-confirmed old case differed before migration');
    for (const name of suffix) await client.query(sql(name));
    const upgraded = await snapshot(client, schema, caseId);
    if (JSON.stringify(upgraded) !== JSON.stringify(original))
      throw new Error('CA013/014 migration changed prior confirmed facts');
    return {
      fullOldChain: true,
      oldForeignKeys: fkCount,
      confirmedVersion: upgraded.head.version,
      exactVersions: upgraded.versions.length,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    await client
      .query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
      .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
