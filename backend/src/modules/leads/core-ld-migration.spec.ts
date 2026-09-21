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

    const actionSql = readMigration(actionMigrationName);
    const schemaSql = readMigration(schemaMigrationName);

    expect(actionSql).toContain("ADD VALUE 'customer.admit'");
    expect(actionSql).toContain("ADD VALUE 'lead.read'");
    expect(actionSql).toContain("ADD VALUE 'lead.create'");
    expect(actionSql).toContain("ADD VALUE 'lead.edit'");
    expect(schemaSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
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
});
