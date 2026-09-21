import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('role template management migrations', () => {
  const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
  const actionMigrationName = '20260920030000_add_role_manage_action';
  const backfillMigrationName = '20260920040000_backfill_role_manage_grant';
  const subsequentCoreLdMigrations = [
    '20260921010000_add_core_ld_actions',
    '20260921011000_add_core_ld_schema',
    '20260921012000_backfill_core_ld_bootstrap_grants',
    '20260921013000_add_material_upload_metadata',
    '20260921014000_add_upload_draft_pending_storage_key',
  ];

  it('adds ROLE_MANAGE to the schema and uses two ordered forward migrations', () => {
    const schema = readFileSync(
      resolve(process.cwd(), 'prisma/schema.prisma'),
      'utf8',
    );
    const migrations = readdirSync(migrationRoot)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();

    expect(schema).toContain('ROLE_MANAGE');
    expect(schema).toContain('@map("role.manage")');
    const actionIndex = migrations.indexOf(actionMigrationName);
    expect(migrations.slice(actionIndex, actionIndex + 2)).toEqual([
      actionMigrationName,
      backfillMigrationName,
    ]);
    expect(migrations).toEqual(
      expect.arrayContaining(subsequentCoreLdMigrations),
    );
    expect(
      subsequentCoreLdMigrations.every(
        (name) => migrations.indexOf(name) > actionIndex + 1,
      ),
    ).toBe(true);
  });

  it('commits the enum value before the backfill transaction uses it', () => {
    const migrations = readdirSync(migrationRoot);
    expect(migrations).toContain(actionMigrationName);
    expect(migrations).toContain(backfillMigrationName);

    const actionMigration = readFileSync(
      resolve(migrationRoot, actionMigrationName, 'migration.sql'),
      'utf8',
    );
    const backfillMigration = readFileSync(
      resolve(migrationRoot, backfillMigrationName, 'migration.sql'),
      'utf8',
    );

    expect(actionMigration).toMatch(
      /BEGIN;[\s\S]*ALTER TYPE "permission_action" ADD VALUE 'role\.manage';[\s\S]*COMMIT;/,
    );
    expect(actionMigration).not.toContain('role_grants');

    expect(backfillMigration).toMatch(/^BEGIN;/);
    expect(backfillMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(backfillMigration).toContain(
      'LOCK TABLE "department_memberships", "role_assignments", "role_templates", "role_grants", "local_credentials", "user_accounts"',
    );
    expect(backfillMigration).toContain(
      'CREATE TEMP TABLE "bootstrap_roles_to_upgrade" ON COMMIT DROP',
    );
    expect(backfillMigration).toContain(
      '"shared_assignment"."user_id" <> "assignment"."user_id"',
    );
    expect(backfillMigration).toContain(`('role.manage'::"permission_action")`);
    expect(backfillMigration).toContain(
      'ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING',
    );
    expect(backfillMigration).toContain(
      'SET "authorization_revision" = "authorization_revision" + 1',
    );
    expect(backfillMigration).not.toMatch(/role\."name"\s*=/i);
    expect(backfillMigration).not.toMatch(/credential\."username"\s*=/i);
  });
});
