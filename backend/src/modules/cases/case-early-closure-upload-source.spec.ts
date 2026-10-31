import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029230000_early_closure_upload_source/migration.sql',
  ),
  'utf8',
);
const source = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261014170100_case_external_entry_foundation/migration.sql',
  ),
  'utf8',
);
const oldGuard = source
  .split('CREATE OR REPLACE FUNCTION "check_case_closure_upload_actor"')[1]
  .split('CREATE OR REPLACE FUNCTION "check_case_archive_actor"')[0];
describe('early closure supplementary upload draft', () => {
  it('compares complete predecessor bodies with CRLF-only normalization and rejects other drift', () => {
    expect(sql).toContain(
      "IF replace(actual,E'\\r\\n',E'\\n') IS DISTINCT FROM replace($expected$",
    );
    expect(sql).toContain("$expected$,E'\\r\\n',E'\\n') THEN");
    const actualBody = oldGuard.split('$$')[1];
    const expectedBody = sql.split('$expected$')[1];
    const normalize = (body: string) => body.replaceAll('\r\n', '\n');
    const accepted = (body: string | null) =>
      body !== null && normalize(body) === normalize(expectedBody);
    expect(accepted(actualBody)).toBe(true);
    const lf = normalize(actualBody);
    expect(accepted(lf)).toBe(true);
    expect(accepted(lf.replaceAll('\n', '\r\n'))).toBe(true);
    expect(accepted(lf.replace('RETURN NEW;', 'RETURN OLD;'))).toBe(false);
    expect(accepted(`${lf} `)).toBe(false);
    expect(accepted(lf.replace('\n', '\r'))).toBe(false);
    expect(accepted(null)).toBe(false);
  });
  it('retains every historical guard line and fails closed on source drift', () => {
    const replacement = sql.split(
      'CREATE OR REPLACE FUNCTION "check_case_closure_upload_actor"',
    )[1];
    for (const line of oldGuard.split('\n').filter((line) => line.trim())) {
      expect(replacement).toContain(line);
    }
    expect(sql).toContain(
      "replace(actual,E'\\r\\n',E'\\n') IS DISTINCT FROM replace($expected$",
    );
    expect(sql).toContain('closure upload guard changed');
  });
  it('requires an existing same-case same-department early fact and strict terminal chain', () => {
    expect(sql).toContain(
      'e."case_id"=NEW."owner_id" AND e."department_id"=NEW."department_id"',
    );
    expect(sql).toContain('c."id" IS NULL OR f."id" IS NOT NULL');
    expect(sql).toContain(
      'case_closure_source_terminal_version(c."id",c."department_id",NULL,expected_terminal)',
    );
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
