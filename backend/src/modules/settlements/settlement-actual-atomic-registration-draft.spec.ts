import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030320000_settlement_actual_atomic_registration_draft/migration.sql',
  ),
  'utf8',
);

describe('atomic actual registration migration draft (static contract only)', () => {
  it('requires a marker for created allocation declarations before the ordinary-path early return', () => {
    const declaration = sql.indexOf(
      "NEW.action='settlement.actual.created' AND NEW.details ? 'allocationId'",
    );
    const earlyReturn = sql.indexOf(
      "IF NEW.details->>'command' IS DISTINCT FROM 'REGISTER_CASE_ACTUAL' THEN RETURN NULL",
    );
    expect(declaration).toBeGreaterThan(-1);
    expect(declaration).toBeLessThan(earlyReturn);
    expect(sql).toContain(
      'created allocation declaration requires atomic command marker',
    );
    expect(sql).toContain(
      "OR (NEW.action='settlement.actual.created' AND NEW.details ? 'allocationId') THEN",
    );
  });
  it('checks the explicit declaration after the whole transaction, including orphan audits', () => {
    expect(sql).toContain(
      "IF NEW.details->>'command' IS DISTINCT FROM 'REGISTER_CASE_ACTUAL' THEN RETURN NULL",
    );
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER[\s\S]*AFTER INSERT ON audit_events DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(sql).toContain('(NEW.id=fa.id OR NEW.id=va.id)');
    expect(sql).toContain(
      "NEW.action NOT IN ('settlement.actual.created','settlement.actual.allocated') OR NOT EXISTS",
    );
    for (const alias of ['f', 'v', 'fa', 'va']) {
      expect(sql).toContain(`${alias}.xmin=pg_current_xact_id()::text::xid`);
    }
  });

  it('binds both facts, both declarations and the exact full allocation', () => {
    for (const predicate of [
      'v.case_id=f.source_case_id',
      'v.department_id=f.department_id',
      'v.side=f.side AND v.amount=f.amount',
      'v.actor_user_id=f.actor_user_id',
      'v.idempotency_key=f.idempotency_key',
      'v.request_fingerprint=f.request_fingerprint',
      "fa.details->>'command'='REGISTER_CASE_ACTUAL'",
      "va.details->>'command'='REGISTER_CASE_ACTUAL'",
      "fa.details->>'allocationId'=v.id::text",
      "va.details->>'allocationId'=v.id::text",
      "va.details->>'factId'=f.id::text",
      "(fa.details->>'amount')::numeric=f.amount",
      "(va.details->>'amount')::numeric=v.amount",
    ]) {
      expect(sql).toContain(predicate);
    }
  });

  it('prevents adding, changing or deleting a declaration outside its insert check', () => {
    expect(sql).toContain("OLD.details->>'command'='REGISTER_CASE_ACTUAL'");
    expect(sql).toContain("NEW.details->>'command'='REGISTER_CASE_ACTUAL'");
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON audit_events');
  });

  it('adds guards without rewriting history or replacing the existing independent write guards', () => {
    expect(sql).not.toMatch(/\b(?:DROP|ALTER|TRUNCATE)\b/);
    expect(sql).not.toMatch(
      /^\s*(?:INSERT INTO|UPDATE|DELETE FROM|CREATE OR REPLACE)/m,
    );
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });
});
