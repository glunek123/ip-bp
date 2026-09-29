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

describe('CA-001 actual match date and optional law firm migration', () => {
  it('adds a DATE without inventing old business dates and preserves valid known firms', () => {
    const path = resolve(
      process.cwd(),
      'prisma/migrations/20260929022000_correct_case_match_facts/migration.sql',
    );
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('ADD COLUMN "matched_on" DATE');
    expect(sql).toContain('ALTER COLUMN "law_firm" DROP NOT NULL');
    expect(sql).toContain('"law_firm" IS NULL OR');
    expect(sql).not.toMatch(/UPDATE\s+"cases"/iu);
  });
});
