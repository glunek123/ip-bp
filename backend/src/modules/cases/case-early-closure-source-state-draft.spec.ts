import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029190000_early_closure_source_state_draft/migration.sql',
  ),
  'utf8',
);

describe('early closure source-state draft', () => {
  it('requires the two known state checks and keeps matched_on unchanged', () => {
    expect(sql).toContain(
      "'cases_matching_state_check', 'cases_complaint_state_check'",
    );
    expect(sql).toContain('count_checks <> 2');
    expect(sql).toContain("conname = 'cases_matched_on_state_check'");
    expect(sql).not.toMatch(
      /DROP CONSTRAINT %I[^\n]*cases_matched_on_state_check/iu,
    );
  });

  it('revalidates the original source stage and preserves old archive fallback', () => {
    expect(sql).toContain(
      'case_archive_source_checks(current_case, source_stage) IS NOT TRUE',
    );
    expect(sql).toContain('source_stage := early.from_stage');
    expect(sql).toContain('FROM case_early_archives');
    expect(sql).toContain('IF original_stage IS NULL THEN');
    expect(sql).toContain(
      'AFTER INSERT ON case_early_closures DEFERRABLE INITIALLY DEFERRED',
    );
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|case_early_closure_structure_guard/iu,
    );
  });
});
