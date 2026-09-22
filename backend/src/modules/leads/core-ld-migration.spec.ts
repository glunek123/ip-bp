import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CORE-LD migrations', () => {
  const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const actionMigrationName = '20260921010000_add_core_ld_actions';
  const schemaMigrationName = '20260921011000_add_core_ld_schema';
  const backfillMigrationName =
    '20260921012000_backfill_core_ld_bootstrap_grants';
  const materialMetadataMigrationName =
    '20260921013000_add_material_upload_metadata';
  const pendingStorageMigrationName =
    '20260921014000_add_upload_draft_pending_storage_key';
  const admissionSnapshotMigrationName =
    '20260921015000_add_admission_receipt_snapshot';
  const leadSnapshotMigrationName = '20260921016000_add_lead_receipt_snapshot';
  const clientIdentityActionMigrationName =
    '20260922009000_add_client_identity_actions';
  const clientPushMigrationName =
    '20260922010000_add_client_accounts_and_lead_push';
  const clientReviewActionMigrationName =
    '20260922011000_add_client_lead_review_action';
  const clientReviewSchemaMigrationName =
    '20260922012000_add_client_lead_review';

  function readMigration(name: string): string {
    return readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
  }

  it('adds permission actions before schema and bootstrap backfill consume them', () => {
    const actionIndex = migrations.indexOf(actionMigrationName);
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(migrations.slice(actionIndex, actionIndex + 3)).toEqual([
      actionMigrationName,
      schemaMigrationName,
      backfillMigrationName,
    ]);
    expect(migrations.indexOf(materialMetadataMigrationName)).toBeGreaterThan(
      migrations.indexOf(backfillMigrationName),
    );
    expect(migrations.indexOf(pendingStorageMigrationName)).toBeGreaterThan(
      migrations.indexOf(materialMetadataMigrationName),
    );
    expect(migrations.indexOf(admissionSnapshotMigrationName)).toBeGreaterThan(
      migrations.indexOf(pendingStorageMigrationName),
    );
    expect(migrations.indexOf(leadSnapshotMigrationName)).toBeGreaterThan(
      migrations.indexOf(admissionSnapshotMigrationName),
    );

    const actionSql = readMigration(actionMigrationName);
    const schemaSql = readMigration(schemaMigrationName);

    expect(actionSql).toContain("ADD VALUE 'customer.admit'");
    expect(actionSql).toContain("ADD VALUE 'lead.read'");
    expect(actionSql).toContain("ADD VALUE 'lead.create'");
    expect(actionSql).toContain("ADD VALUE 'lead.edit'");
    expect(schemaSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('backfills lead receipt snapshots only from the exact current version', () => {
    const snapshotSql = readMigration(leadSnapshotMigrationName);
    expect(snapshotSql).toContain(
      'current lead version does not match receipt version',
    );
    expect(snapshotSql).toContain(
      'lead."version" <> receipt."result_lead_version"',
    );
    expect(snapshotSql).toContain('lead."id" IS NULL');
    expect(snapshotSql).toContain('jsonb_build_object');
    expect(snapshotSql).toContain("'leadScreenshotContentVersionIds'");
    expect(snapshotSql).toContain('reference."action_event_id" IS NULL');
    expect(snapshotSql).toContain(
      'ALTER COLUMN "result_snapshot" SET NOT NULL',
    );
    expect(snapshotSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('safely backfills immutable admission receipt snapshots before requiring them', () => {
    const snapshotSql = readMigration(admissionSnapshotMigrationName);
    const versionGuardIndex = snapshotSql.indexOf(
      'current customer version does not match receipt version',
    );
    const addSnapshotIndex = snapshotSql.indexOf(
      'ADD COLUMN "result_snapshot" JSONB',
    );

    expect(versionGuardIndex).toBeGreaterThanOrEqual(0);
    expect(versionGuardIndex).toBeLessThan(addSnapshotIndex);
    expect(snapshotSql).toContain(
      'customer."version" <> receipt."result_customer_version"',
    );
    expect(snapshotSql).toContain('customer."id" IS NULL');
    expect(snapshotSql).toContain('UPDATE "customer_admission_receipts"');
    expect(snapshotSql).toContain('jsonb_build_object');
    expect(snapshotSql).toContain('"result_customer_version"');
    expect(snapshotSql).toContain(
      'ALTER COLUMN "result_snapshot" SET NOT NULL',
    );
    expect(snapshotSql).toContain('normalized_identity_number');
    expect(snapshotSql).toContain('normalize("identity_number", NFKC)');
    expect(snapshotSql).toMatch(/regexp_replace[\s\S]*\[:space:\][\s\S]*-/i);
    expect(snapshotSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('persists a nullable orphan cleanup key before blob publication', () => {
    const pendingSql = readMigration(pendingStorageMigrationName);

    expect(pendingSql).toContain('"pending_storage_key" VARCHAR(500)');
    expect(pendingSql).toContain('CREATE UNIQUE INDEX');
    expect(pendingSql).toContain('NULLIF(BTRIM("pending_storage_key"), \'\')');
    expect(pendingSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('persists upload metadata before raw content is finalized', () => {
    const metadataSql = readMigration(materialMetadataMigrationName);

    expect(metadataSql).toContain('ALTER TABLE "upload_drafts"');
    expect(metadataSql).toContain('"purpose" VARCHAR(100) NOT NULL');
    expect(metadataSql).toContain('"original_filename" VARCHAR(200) NOT NULL');
    expect(metadataSql).toContain('"declared_mime_type" VARCHAR(100) NOT NULL');
    expect(metadataSql).toContain('ALTER TABLE "materials"');
    expect(metadataSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('backfills only the unique unshared bootstrap role and bumps authorization revision', () => {
    const backfillSql = readMigration(backfillMigrationName);

    expect(backfillSql).toContain('bootstrap_roles_to_upgrade');
    expect(backfillSql).toContain('shared_assignment');
    expect(backfillSql).toContain('authorization_revision');
    expect(backfillSql).not.toMatch(/role\."name"\s*=/i);
    expect(backfillSql).not.toMatch(/credential\."username"\s*=/i);
  });

  it('requires both classification fields before a customer can be ADMITTED', () => {
    const schemaSql = readMigration(schemaMigrationName);

    expect(schemaSql).toMatch(
      /"profile_status" <> 'ADMITTED'\s+OR \(\s+"customer_type" IS NOT NULL\s+AND "identity_type" IS NOT NULL\s+AND "customer_type" IN/,
    );
  });

  it('adds client actions in a retry-safe phase before the transactional schema migration', () => {
    const actionIndex = migrations.indexOf(clientIdentityActionMigrationName);
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(migrations.slice(actionIndex, actionIndex + 2)).toEqual([
      clientIdentityActionMigrationName,
      clientPushMigrationName,
    ]);
    const actionSql = readMigration(clientIdentityActionMigrationName);
    const schemaSql = readMigration(clientPushMigrationName);

    expect(actionSql).toContain("ADD VALUE IF NOT EXISTS 'lead.push'");
    expect(actionSql).toContain("ADD VALUE IF NOT EXISTS 'client.lead.read'");
    expect(actionSql).toContain("type.typname = 'user_account_type'");
    expect(actionSql).toContain("ARRAY['INTERNAL', 'CLIENT']::TEXT[]");
    expect(actionSql).toContain('existing user_account_type is incompatible');
    expect(schemaSql.trim().startsWith('BEGIN;')).toBe(true);
    expect(schemaSql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('adds enterprise client identity isolation and paired push facts transactionally', () => {
    expect(migrations.indexOf(clientPushMigrationName)).toBeGreaterThan(
      migrations.indexOf(clientIdentityActionMigrationName),
    );
    const sql = readMigration(clientPushMigrationName);

    expect(sql).toContain('CREATE TABLE "customer_account_bindings"');
    expect(sql).toContain('"user_id" UUID NOT NULL');
    expect(sql).toContain('"customer_id" UUID NOT NULL');
    expect(sql).toContain('"department_id" UUID NOT NULL');
    expect(sql).toContain('customer_account_bindings_user_id_key');
    expect(sql).toContain('customer_account_bindings_customer_department_fkey');
    expect(sql).toContain('reject_client_internal_membership');
    expect(sql).toContain('reject_internal_client_binding');
    expect(sql).toContain('assert_client_account_binding_cardinality');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('"pushed_at" TIMESTAMPTZ(3)');
    expect(sql).toContain('"pushed_by_user_id" UUID');
    expect(sql).toContain('leads_push_fields_paired_check');
    expect(sql).toContain('bootstrap_roles_to_upgrade');
    expect(sql).toContain('authorization_revision');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('adds client review action before the transactional review schema', () => {
    expect(migrations.slice(-2)).toEqual([
      clientReviewActionMigrationName,
      clientReviewSchemaMigrationName,
    ]);
    expect(readMigration(clientReviewActionMigrationName)).toContain(
      "ADD VALUE IF NOT EXISTS 'client.lead.review'",
    );
    const sql = readMigration(clientReviewSchemaMigrationName);
    expect(sql.trim().startsWith('BEGIN;')).toBe(true);
    expect(sql).toContain('CREATE TYPE "lead_review_result"');
    expect(sql).toContain('CREATE TABLE "lead_review_decisions"');
    expect(sql).toContain('CREATE TABLE "client_lead_review_receipts"');
    expect(sql).toContain('reject_lead_review_decision_mutation');
    expect(sql).toContain('client_lead_review_receipts_action_check');
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });
});
