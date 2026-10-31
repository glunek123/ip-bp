import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030340000_early_closure_payment_actor_draft/migration.sql',
  ),
  'utf8',
);

describe('early closure initial payment actor draft', () => {
  it('adds checks without replacing ordinary authorization or opening any gate', () => {
    expect(sql).not.toMatch(
      /DROP |ALTER |CREATE OR REPLACE|DISABLE TRIGGER|INSERT INTO/iu,
    );
    expect(sql).toContain("v.kind<>'REGISTER'");
    expect(sql).toContain(
      'v.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid THEN RETURN NEW',
    );
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain("IF TG_OP<>'INSERT'");
  });

  it('binds current owner/read/revision authorization and source command permission', () => {
    expect(sql).toContain(
      'assert_case_financial_actor_draft(NEW.recorded_by_user_id',
    );
    expect(sql).toContain(
      "'CASE_CLOSURE_PAYMENT_RECORD',ARRAY['WAITING_ARCHIVE']",
    );
    expect(sql).toContain("'case.closure.record') IS NOT TRUE");
    expect(sql).toContain(
      'NEW.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id',
    );
    expect(sql).toContain(
      'v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id',
    );
  });

  it('requires both exact source transitions and transaction-local facts, audits and receipts', () => {
    for (const clause of [
      "NEW.revision<>1 OR NEW.state<>'ACTIVE' OR NEW.prior_version_id IS NOT NULL",
      'source_case.stage:=e.from_stage',
      'source_case.version:=e.from_version',
      'case_early_closure_transition(source_case,waiting_case) IS NOT TRUE',
      'case_early_closure_register_transition(waiting_case,final_case) IS NOT TRUE',
      'h.current_version_id=v.id',
      'r.payment_version_id=NEW.id',
      'r.audit_event_id=NEW.audit_event_id',
      'r.request_fingerprint=er.request_fingerprint',
      'r.xmin=pg_current_xact_id()::text::xid AND er.xmin=pg_current_xact_id()::text::xid',
    ])
      expect(sql).toContain(clause);
  });
});
