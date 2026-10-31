import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EARLY_CLOSURE_SOURCE_STAGES } from './case-early-closure.dto';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029160000_early_closure_transition_preconditions/migration.sql',
  ),
  'utf8',
);

describe('early closure transition preparation', () => {
  it('uses the exact permitted source stages and checks the full parent identity', () => {
    for (const stage of EARLY_CLOSURE_SOURCE_STAGES) {
      expect(sql).toContain(`'${stage}'`);
    }
    expect(sql).toContain("to_jsonb(new_case) - 'stage' - 'version'");
    expect(sql).toContain("to_jsonb(old_case) - 'stage' - 'version'");
    expect(sql).toContain('"case_early_archives"');
    expect(sql).toContain('"case_execution_finishes"');
    expect(sql).toContain('"case_archives"');
  });

  it('keeps the source disabled while terminal guards remain unextended', () => {
    const structure = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261029120000_early_closure_source_structure/migration.sql',
      ),
      'utf8',
    );
    expect(structure).toContain(
      "RAISE EXCEPTION 'early closure source is not enabled'",
    );
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|CREATE OR REPLACE FUNCTION "case_early_closure_structure_guard"/iu,
    );
    expect(sql).not.toMatch(
      /UPDATE "cases"|INSERT INTO "case_early_closures"/iu,
    );
  });
});
