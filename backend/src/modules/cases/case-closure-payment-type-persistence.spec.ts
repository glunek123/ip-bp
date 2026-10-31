import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030040000_case_closure_payment_type_draft/migration.sql',
  ),
  'utf8',
);
describe('payment type draft SQL contract', () => {
  it('preserves historical unknown types and gates newly selected types', () => {
    expect(sql).toContain('ADD COLUMN "payment_type" varchar(16)');
    expect(sql).not.toMatch(/UPDATE "case_closure_versions"/u);
    expect(sql).toContain(
      'typed closure payment command is draft and not enabled',
    );
  });
  it('checks the current head and effective latest records for both entry paths', () => {
    expect(sql).toContain('v."id"=c."current_version_id"');
    expect(sql).toContain('n."prior_version_id"=p."id"');
    expect(sql).toContain("selected_type='ONE_TIME' AND active_count>1");
    expect(sql).toContain('AFTER INSERT OR UPDATE ON "case_closures"');
    expect(sql).toContain('AFTER INSERT ON "case_closure_payment_versions"');
  });
  it('requires serializable retries and case locking before deferred validation', () => {
    expect(sql).toContain(
      "current_setting('transaction_isolation')<>'serializable'",
    );
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
});

it('rejects a null typed new head once any historical version selected a type', () => {
  expect(sql).toContain('IF selected_type IS NULL THEN');
  expect(sql).toContain(
    'known."case_id"=target_case AND known."department_id"=target_department',
  );
  expect(sql).toContain('known."payment_type" IS NOT NULL');
  expect(sql).toContain('known payment type cannot become unknown');
  expect(sql).not.toContain(
    'IF selected_type IS NULL THEN RETURN NEW; END IF;',
  );
});
