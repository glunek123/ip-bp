import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030220000_optional_closure_correction_reason_draft/migration.sql',
  ),
  'utf8',
);
describe('optional closure correction reason forward draft', () => {
  it('requires exact historical definition and one matching constraint', () => {
    expect(sql).toContain('candidate.definition IS DISTINCT FROM');
    expect(sql).toContain('candidate.convalidated IS DISTINCT FROM true');
    expect(sql).toContain('IF matched<>1');
    expect(sql).toContain("conrelid='case_closure_versions'::regclass");
  });
  it('locks before inspecting/replacing and does not revalidate or clean historical rows', () => {
    expect(
      sql.indexOf('LOCK TABLE case_closure_versions IN ACCESS EXCLUSIVE MODE'),
    ).toBeLessThan(sql.indexOf('FOR candidate IN SELECT'));
    expect(sql).toContain("NOT VALID',candidate.conname)");
    expect(sql).not.toMatch(
      /VALIDATE CONSTRAINT|DELETE FROM|UPDATE case_closure_versions/iu,
    );
  });
  it('preserves register/prior rules and validates supplied text without rewriting history', () => {
    expect(sql).toContain(
      "kind=''REGISTER'' AND prior_version_id IS NULL AND correction_reason IS NULL",
    );
    expect(sql).toContain("kind=''CORRECT'' AND prior_version_id IS NOT NULL");
    expect(sql).toContain('correction_reason IS NULL OR');
    expect(sql).toContain("correction_reason ~ ''[^[:space:]]''");
    expect(sql).not.toMatch(
      /UPDATE case_closure_versions|DROP TRIGGER|DISABLE TRIGGER/iu,
    );
  });
});
