import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030030000_case_closure_payment_draft/migration.sql',
  ),
  'utf8',
);
describe('closure payment persistence draft', () => {
  it('keeps writes closed until the complete command invariants exist', () => {
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_versions"',
    );
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_documents"',
    );
    expect(sql).toContain('persistence is draft and not enabled');
  });
  it('binds payment lineage and evidence to the same case and department', () => {
    expect(sql).toContain(
      'FOREIGN KEY ("prior_version_id","payment_id","case_id","department_id")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("closure_version_id","case_id","department_id")',
    );
    expect(sql).toContain('FOREIGN KEY ("material_id","content_version_id")');
    expect(sql).toContain(
      'm."owner_type"=\'CASE\' AND m."owner_id"=NEW."case_id"',
    );
  });
  it('does not import historical ledger records or mutate existing facts', () => {
    expect(sql).not.toMatch(
      /\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+"(?:cases|settlements|case_closures)"/u,
    );
  });
});

it('allows optional correction reasons while preserving revision provenance', () => {
  expect(sql).not.toContain('length(btrim("reason"))>0');
  expect(sql).not.toContain('"reason" IS NOT NULL');
  expect(sql).toContain('"recorded_by_user_id" uuid NOT NULL');
  expect(sql).toContain('"recorded_at" timestamptz(3) NOT NULL');
  expect(sql).toContain('"revision">1 AND "prior_version_id" IS NOT NULL');
});

it('retains append-only chain and exact actor audit guards beyond the draft gate', () => {
  expect(sql).toContain('previous."revision"+1<>NEW."revision"');
  expect(sql).toContain('previous."state"<>\'ACTIVE\'');
  expect(sql).toContain('WHERE n."prior_version_id"=previous."id"');
  expect(sql).toContain('payment versions are immutable');
  expect(sql).toContain('payment evidence links are immutable');
  expect(sql).toContain('a."resource_id"=NEW."id"');
  expect(sql).toContain('a."internal_actor_user_id"=NEW."recorded_by_user_id"');
});
