import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260929021000_reconcile_case_match_grants/migration.sql',
);

describe('CA-001 case match grant reconciliation migration', () => {
  it('adds a forward migration that reconciles only deterministic automatic grants by lead-edit scope', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("':case.match:' || LOWER");
    expect(sql).toContain('\'SELF\'::"permission_scope"');
    expect(sql).toContain('\'TEAM\'::"permission_scope"');
    expect(sql).toContain('\'DEPARTMENT\'::"permission_scope"');
    expect(sql).toContain('\'lead.edit\'::"permission_action"');
    expect(sql).toContain('authorization_revision');
  });
});
