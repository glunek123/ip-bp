import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030520000_zero_closure_archive_gate_candidate/migration.sql',
  ),
  'utf8',
);
describe('zero closure archive gate candidate', () => {
  it('binds early inserts to deferred same-transaction known zero closure and rejects existing payments', () => {
    for (const x of [
      'DEFERRABLE INITIALLY DEFERRED',
      "v.close_amount_state='KNOWN' AND v.close_amt=0",
      'v.xmin=pg_current_xact_id()',
      'case_closure_payment_versions p',
      "TG_OP<>'INSERT'",
    ])
      expect(sql).toContain(x);
  });
  it('retains snapshot updates and deletes rejection and limits inserts to zero', () => {
    for (const x of [
      'NEW.closure_amount IS DISTINCT FROM 0',
      'NEW.creation_xid IS DISTINCT FROM pg_current_xact_id()',
      's.closure_amount IS DISTINCT FROM 0',
      'archive evidence snapshot persistence is immutable',
    ])
      expect(sql).toContain(x);
  });
});
it('binds typed and snapshot paths to the exact early source and receipt', () => {
  for (const x of [
    "NEW.kind='REGISTER'",
    'NEW.prior_version_id IS NULL',
    'e.recorded_by_user_id=NEW.recorded_by_user_id',
    'e.to_version=NEW.from_version',
    'r.actor_user_id=NEW.recorded_by_user_id',
    'r.xmin=pg_current_xact_id()',
    'h.current_version_id=v.id',
  ])
    expect(sql).toContain(x);
});
it('guards receipt-only fields in a separate table branch', () => {
  expect(sql).toContain(
    "IF TG_RELID='case_early_closure_receipts'::regclass THEN IF NOT EXISTS",
  );
  expect(sql).not.toContain(
    "TG_TABLE_NAME='case_early_closure_receipts' AND NOT EXISTS",
  );
});
