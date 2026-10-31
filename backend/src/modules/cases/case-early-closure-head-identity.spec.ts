import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029200000_early_closure_head_identity/migration.sql',
  ),
  'utf8',
);

describe('closure head third-source identity', () => {
  it('prevents root reassignment and requires the advanced version to keep its root', () => {
    expect(sql).toContain(
      'NEW."early_closure_id" IS DISTINCT FROM OLD."early_closure_id"',
    );
    expect(sql).toContain(
      'v."early_closure_id" IS NOT DISTINCT FROM OLD."early_closure_id"',
    );
    expect(sql).toContain(
      'NEW."external_entry_id" IS DISTINCT FROM OLD."external_entry_id"',
    );
    expect(sql).toContain('closure head guard changed');
  });

  it('leaves the source write gate and receipt/final guards unchanged', () => {
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|case_early_closure_structure_guard|check_case_closure_final|check_case_closure_receipt/iu,
    );
  });
});
