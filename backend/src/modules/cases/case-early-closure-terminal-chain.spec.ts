import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029210000_early_closure_terminal_chain/migration.sql',
  ),
  'utf8',
);

describe('early closure terminal chain draft', () => {
  it('anchors each version to the same source, case, department and exact predecessor', () => {
    expect(sql).toContain('finish_version IS DISTINCT FROM early."to_version"');
    expect(sql).toContain('h."early_closure_id" IS DISTINCT FROM early."id"');
    expect(sql).toContain('v."early_closure_id" IS DISTINCT FROM early."id"');
    expect(sql).toContain(
      '"case_id"=target_case AND "department_id"=target_department',
    );
    expect(sql).toContain(
      'v."prior_version_id" IS DISTINCT FROM expected_prior',
    );
    expect(sql).toContain(
      'expected_prior IS DISTINCT FROM h."current_version_id"',
    );
  });

  it('retains the existing branches and source insert gate', () => {
    expect(sql).toContain("needle text := 'IF target_finish IS NULL THEN'");
    expect(sql).toContain(
      "replace(definition,needle,branch || E'\\n ' || needle)",
    );
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|case_early_closure_structure_guard|check_case_closure_final/iu,
    );
  });
});
