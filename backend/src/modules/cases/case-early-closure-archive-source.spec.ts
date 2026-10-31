import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030010000_early_closure_archive_source/migration.sql',
  ),
  'utf8',
);

describe('early closure archive source draft', () => {
  it('requires the exact same-case exclusive third root and validates its closure chain', () => {
    expect(sql).toContain('"id"=closure_head."early_closure_id"');
    expect(sql).toContain(
      '"case_id"=closure_head."case_id" AND "department_id"=closure_head."department_id"',
    );
    expect(sql).toContain('closure_head."finish_id" IS NOT NULL');
    expect(sql).toContain('closure_head."external_entry_id" IS NOT NULL');
    expect(sql).toContain('FROM "case_execution_finishes"');
    expect(sql).toContain('FROM "case_early_archives"');
    expect(sql).toContain(
      'early."to_version" IS DISTINCT FROM early."from_version"+1',
    );
    expect(sql).toContain(
      'case_closure_source_terminal_version(closure_head."case_id",closure_head."department_id",NULL,early."to_version")',
    );
  });

  it('wraps only source selection in actor/final and retains historical bodies', () => {
    expect(sql).toContain(
      "ARRAY['check_case_archive_actor','check_case_archive_final']",
    );
    expect(sql).toContain('definition:=replace(definition,opening,branch)');
    expect(sql).toContain(
      "definition:=replace(definition,closing,closing || E'\\n END IF;')",
    );
    expect(sql).toContain('IF f."id" IS NULL THEN');
    expect(sql).toContain('archive source guard changed: %');
    expect(sql).toContain(
      "length(replace(definition,opening,'')))<>length(opening)",
    );
    expect(sql).toContain(
      "length(replace(definition,closing,'')))<>length(closing)",
    );
  });

  it('keeps source insertion disabled and does not change schema or neutral protocols', () => {
    expect(sql).not.toMatch(
      /DROP |DISABLE TRIGGER|ALTER TABLE|CREATE TABLE|UPDATE "|DELETE FROM|INSERT INTO|RETURN NEW/iu,
    );
    expect(sql).not.toContain('case_early_closure_structure_guard');
    expect(sql).not.toMatch(
      /proname\s*=\s*'case_archive_terminal_version'|proname\s*=\s*'check_case_archive_receipt'/u,
    );
    expect(sql).toMatch(/BEGIN;[\s\S]+COMMIT;/u);
  });
});
