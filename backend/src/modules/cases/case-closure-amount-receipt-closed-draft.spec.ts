import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030420000_closure_amount_receipt_closed_draft/migration.sql',
  ),
  'utf8',
);
describe('closed amount receipt draft', () => {
  it('keeps every gate closed and preserves legacy terms writes', () => {
    expect(sql).toContain(
      'closure_amount_receipt_closed_draft BEFORE INSERT OR UPDATE OR DELETE',
    );
    expect(sql).not.toMatch(/DROP |ALTER |DISABLE TRIGGER|CREATE OR REPLACE/iu);
    expect(sql).not.toMatch(
      /CREATE (?:CONSTRAINT )?TRIGGER[^;]+ ON case_settlement_terms/iu,
    );
  });
  it('requires immutable receipt and same transaction sources', () => {
    for (const clause of [
      'closure_amount_receipt_immutable_draft BEFORE UPDATE OR DELETE',
      'closure_amount_audit_seal_draft BEFORE UPDATE OR DELETE',
      'DEFERRABLE INITIALLY DEFERRED',
      'pg_current_xact_id()',
      'assert_case_financial_actor_draft',
      "'amount-assessment:'",
      "a.details->'before'",
      "a.details->'after'",
      'v.calculation_inputs',
    ])
      expect(sql).toContain(clause);
  });
});
