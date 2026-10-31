import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030440000_early_closure_receipt_order_draft/migration.sql',
  ),
  'utf8',
);
describe('early closure receipt ordering draft', () => {
  it('keeps existing gates and guards while requiring an exact prior function', () => {
    expect(sql).toContain('replace(installed');
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
  it('requires the same transaction source and receipt at deferred validation', () => {
    for (const s of [
      'AFTER INSERT ON case_early_closures DEFERRABLE INITIALLY DEFERRED',
      'idempotency_key=er.idempotency_key',
      'request_fingerprint=er.request_fingerprint',
      'cr.result_snapshot IS DISTINCT FROM',
      'case_early_closure_register_transition(waiting,c)',
      'pg_current_xact_id()',
    ])
      expect(sql).toContain(s);
  });
});
