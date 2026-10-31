import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
const columnMigration = readFileSync(
  resolve(migrationRoot, '20261029100000_case_archive_note', 'migration.sql'),
  'utf8',
);
const auditGuardMigration = readFileSync(
  resolve(
    migrationRoot,
    '20261029110000_guard_case_archive_note_audit',
    'migration.sql',
  ),
  'utf8',
);
const originalArchiveGuard = readFileSync(
  resolve(migrationRoot, '20261014090100_guard_case_archive', 'migration.sql'),
  'utf8',
);

describe('case archive note migrations', () => {
  it('adds a nullable note column without rewriting historical versions', () => {
    expect(columnMigration).toMatch(
      /ALTER TABLE "case_archive_versions"\s+ADD COLUMN "archive_note" VARCHAR\(2000\);/u,
    );
    expect(columnMigration).not.toMatch(/\bUPDATE\b|\bDELETE\b/iu);
  });

  it('requires audit parity for stored notes and accepts legacy missing keys only for null notes', () => {
    expect(auditGuardMigration).toContain("'check_case_archive_final'");
    expect(auditGuardMigration).toContain('a."details" ? \'archiveNote\'');
    expect(auditGuardMigration).toContain(
      'a."details"->\'archiveNote\' IS DISTINCT FROM COALESCE(to_jsonb(v."archive_note"),\'null\'::jsonb)',
    );
    expect(auditGuardMigration).toContain(
      'NOT (a."details" ? \'archiveNote\') AND v."archive_note" IS NOT NULL',
    );
    expect(auditGuardMigration).toContain(
      "RAISE EXCEPTION 'unknown case archive audit guard'",
    );
    expect(auditGuardMigration).not.toMatch(
      /\bDROP\s+TRIGGER\b|\bUPDATE\s+"?case_archive_versions"?\b/iu,
    );
  });

  it('keeps the existing immutable-version trigger in place', () => {
    expect(originalArchiveGuard).toContain(
      'CREATE TRIGGER "case_archive_version_immutable" BEFORE UPDATE OR DELETE ON "case_archive_versions"',
    );
    expect(auditGuardMigration).not.toMatch(/\bDROP\s+TRIGGER\b/iu);
  });
});
