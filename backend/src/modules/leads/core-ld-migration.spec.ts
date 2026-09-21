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

  function readMigration(name: string): string {
    return readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
  }

  it('adds permission actions before schema and bootstrap backfill consume them', () => {
    expect(migrations.slice(-3)).toEqual([
      actionMigrationName,
      schemaMigrationName,
      backfillMigrationName,
    ]);

    const actionSql = readMigration(actionMigrationName);
    const schemaSql = readMigration(schemaMigrationName);

    expect(actionSql).toContain("ADD VALUE 'customer.admit'");
    expect(actionSql).toContain("ADD VALUE 'lead.read'");
    expect(actionSql).toContain("ADD VALUE 'lead.create'");
    expect(actionSql).toContain("ADD VALUE 'lead.edit'");
    expect(schemaSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
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
