import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029220000_early_closure_final_source/migration.sql',
  ),
  'utf8',
);

describe('early closure final source branch', () => {
  it('anchors the new source and retains old branch text', () => {
    expect(sql).toContain('"id"=h."early_closure_id"');
    expect(sql).toContain(
      '"case_id"=target_case AND "department_id"=target_department',
    );
    expect(sql).toContain('base_version:=early."to_version"');
    expect(sql).toContain('IF f."id" IS NULL THEN');
    expect(sql).toContain('base_version:=f."to_version"');
    expect(sql).toContain(
      'v."early_closure_id" IS DISTINCT FROM h."early_closure_id"',
    );
  });

  it('fails if the historical final guard shape changed and keeps source disabled', () => {
    expect(sql).toContain('closure final guard changed');
    expect(sql).toContain('position(old_version_source IN definition)=0');
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|case_early_closure_structure_guard/iu,
    );
  });
});
