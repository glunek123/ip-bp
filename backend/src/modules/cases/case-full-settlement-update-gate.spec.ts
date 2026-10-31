import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Offline contract coverage only. PostgreSQL behavior uses the owned-schema
// service fixture plus 3054-terms-audit-drain-probe.v1.sql.
const sql = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261030540000_full_settlement_update_gate_candidate/migration.sql',
  ),
  'utf8',
);
const body = (name: string) => {
  const match = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION ${name}\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    'u',
  ).exec(sql);
  if (!match) throw new Error(`Missing ${name}`);
  return match[1]!;
};
describe('3054 full settlement command migration v1 offline contract', () => {
  it('pins the reviewed candidate bytes', () => {
    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      'e899292ee5318a1810d4097b4e0bda7ab93341b39139b6c9328616adba4454f6',
    );
  });
  it('seals the permanent exact combined terms audit after later head changes', () => {
    const seal = body('seal_settlement_update_terms_audit');
    expect(seal).toContain(
      "r.result_snapshot#>>'{settlementTermsChange,auditEventId}'=OLD.id::text",
    );
    expect(seal).toContain('v.audit_event_id=r.closure_audit_event_id');
    expect(seal).toContain('av.closure_version_id=v.id');
    expect(seal).not.toMatch(
      /current_version_id|WAITING_ARCHIVE|pg_current_xact_id/,
    );
    expect(sql).toContain(
      'settlement_update_terms_audit_seal BEFORE UPDATE OR DELETE ON audit_events',
    );
  });
  it('blocks post-drain terms rewrites only within the checked transaction', () => {
    const seal = body('seal_current_command_settlement_terms');
    expect(seal).toContain('case_closure_settlement_update_receipts');
    expect(seal).toContain('case_closure_amount_update_receipts');
    expect(seal).toContain('AND r.assessment_included)');
    expect(
      seal.match(/r.xmin=pg_current_xact_id\(\)::text::xid/g),
    ).toHaveLength(2);
    expect(sql).toContain(
      'current_command_settlement_terms_seal BEFORE INSERT OR UPDATE OR DELETE ON case_settlement_terms',
    );
  });
  it('preserves independent money and screenshot write gates', () => {
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER|DROP FUNCTION/i);
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION (?:guard_case_closure_payment_proof_draft|guard_settlement_actual)/,
    );
    expect(sql).toContain(
      'PERFORM validate_settlement_update_payment_set(r.closure_version_id,r.case_id,r.department_id)',
    );
    expect(sql).toContain("IF version_kind='REGISTER'");
    expect(sql).toContain("ELSIF version_kind='CORRECT'");
  });
});
