import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030370000_financial_audit_seal_draft/migration.sql',
  ),
  'utf8',
);

describe('financial source audit seal draft (static contract only)', () => {
  it('adds an independent mutation seal and preserves existing gates and history', () => {
    expect(sql).not.toMatch(
      /\b(?:DROP|ALTER|TRUNCATE|CREATE OR REPLACE|INSERT INTO)\b/iu,
    );
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON audit_events');
    expect(sql).toContain('is_case_financial_source_audit_draft(OLD)');
    expect(sql).toContain(
      "IF TG_OP='UPDATE' THEN\n  IF is_case_financial_source_audit_draft(NEW)",
    );
    expect(sql).not.toContain('BEFORE INSERT');
  });

  it('requires actual linked objects and matching departments, not action names alone', () => {
    for (const alias of ['e', 'p', 'i', 'r']) {
      expect(sql).toContain(
        `${alias}.audit_event_id=a.id AND a.department_id=${alias}.department_id`,
      );
      expect(sql).toContain(
        `c.id=${alias}.case_id AND c.department_id=${alias}.department_id`,
      );
    }
    for (const resource of [
      "'CASE' AND a.resource_id=e.case_id",
      "'CASE_CLOSURE_PAYMENT_VERSION' AND a.resource_id=p.id",
      "'CASE_REFUND_INVENTORY_VERSION' AND a.resource_id=i.id",
      "'CASE_CLOSURE_SETTLEMENT_UPDATE' AND a.resource_id=r.id",
    ])
      expect(sql).toContain(resource);
    expect(sql).toContain('v.audit_event_id=r.closure_audit_event_id');
    expect(sql).not.toMatch(/current_version_id|c\.stage/u);
  });

  it('uses the source guards’ exact payment and refund action rules', () => {
    for (const action of [
      'case.early_closed',
      'CASE_CLOSURE_PAYMENT_RECORD',
      'CASE_CLOSURE_PAYMENT_CORRECT',
      'CASE_CLOSURE_PAYMENT_VOID',
      'CASE_REFUND_INVENTORY_RECORD',
      'CASE_REFUND_INVENTORY_CONFIRM',
      'CASE_CLOSURE_SETTLEMENT_UPDATED',
    ])
      expect(sql).toContain(`'${action}'`);
    expect(sql).toContain(
      "WHEN p.revision=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'",
    );
    expect(sql).toContain(
      "WHEN p.state='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID'",
    );
    expect(sql).toContain(
      "(i.declaration='COMPLETE' AND prior.declaration='COMPLETE')",
    );
    expect(sql).toContain(
      'prior.case_id=i.case_id AND prior.department_id=i.department_id',
    );
  });
});
