import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readMigration = (name: string) =>
  readFileSync(
    resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'),
    'utf8',
  ).replace(/\r\n/gu, '\n');
const sql = readMigration(
  '20261030350000_payment_proof_supplement_reference_draft',
);
const original = readMigration(
  '20261030140000_case_payment_evidence_reference_draft',
);

describe('closed payment proof supplement reference draft', () => {
  it('normalizes only CRLF on both complete predecessor bodies and keeps other drift closed', () => {
    expect(sql).toContain(
      "replace(old_body,E'\\r\\n',E'\\n') IS DISTINCT FROM replace(expected_body,E'\\r\\n',E'\\n')",
    );
    expect(sql).toContain('IF function_oid IS NULL OR');
    const raw = (name: string) =>
      readFileSync(
        resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'),
        'utf8',
      );
    const priorBody = raw(
      '20261030140000_case_payment_evidence_reference_draft',
    ).match(
      /CREATE FUNCTION check_case_payment_evidence_reference\(\).*?AS \$\$([\s\S]*?)\$\$;/u,
    )?.[1];
    const expectedBody = raw(
      '20261030350000_payment_proof_supplement_reference_draft',
    ).match(/expected_body text := \$original\$([\s\S]*?)\$original\$/u)?.[1];
    expect(priorBody).toBeDefined();
    expect(expectedBody).toBeDefined();
    if (priorBody === undefined || expectedBody === undefined)
      throw new Error('Missing complete predecessor function body');
    const normalize = (body: string) => body.replaceAll('\r\n', '\n');
    const accepted = (actual: string | null, expected: string | null) =>
      actual !== null &&
      expected !== null &&
      normalize(actual) === normalize(expected);
    const actual = normalize(priorBody);
    const expected = normalize(expectedBody);
    for (const left of [actual, actual.replaceAll('\n', '\r\n')])
      for (const right of [expected, expected.replaceAll('\n', '\r\n')])
        expect(accepted(left, right)).toBe(true);
    expect(
      accepted(actual.replace('RETURN NEW;', 'RETURN OLD;'), expected),
    ).toBe(false);
    expect(accepted(actual, `${expected} `)).toBe(false);
    expect(accepted(actual.replace('\n', '\r'), expected)).toBe(false);
    expect(accepted(null, expected)).toBe(false);
    expect(accepted(actual, null)).toBe(false);
  });
  it('recognizes and preserves the complete original payment insert guard', () => {
    const body = original.match(
      /CREATE FUNCTION check_case_payment_evidence_reference\(\).*?AS \$\$([\s\S]*?)\$\$;/u,
    )?.[1];
    expect(body).toBeDefined();
    expect(
      sql.match(
        /expected_body text := \$original\$([\s\S]*?)\$original\$/u,
      )?.[1],
    ).toBe(body);
    expect(sql).toContain(
      "IS DISTINCT FROM replace(expected_body,E'\\r\\n',E'\\n')",
    );
    expect(sql).toContain("t.tgtype=7 AND t.tgenabled='O'");
    expect(sql).toContain(
      "replace(old_body,E'\\nBEGIN\\n',E'\\nBEGIN\\n'||branch)",
    );
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION reject_case_payment_evidence_reference_mutation',
    );
  });

  it('binds supplement audit, exact document, payment, case and department', () => {
    for (const fragment of [
      "r.resource_type<>'case-payment-proof-supplement'",
      "r.purpose<>'CASE_CLOSURE_PAYMENT_PROOF'",
      'r.asset_version_id IS NOT NULL OR r.action_event_id IS NULL',
      's.id=r.resource_id AND s.department_id=r.department_id',
      'd.material_id=r.material_id AND d.content_version_id=r.content_version_id',
      'd.payment_version_id=s.payment_version_id AND d.case_id=s.case_id',
      'p.case_id=s.case_id AND p.department_id=s.department_id',
      'a.id=r.action_event_id AND a.department_id=s.department_id',
      "a.resource_type='CASE_PAYMENT_PROOF_SUPPLEMENT' AND a.resource_id=s.id",
      "a.action='CASE_PAYMENT_PROOF_SUPPLEMENTED' AND a.actor_kind='HUMAN'",
      'a.actor_user_id=s.actor_user_id AND a.internal_actor_user_id=s.actor_user_id',
      'm.owner_id=s.case_id',
      'm.current_version_id=v.id',
      "v.status='AVAILABLE'",
    ])
      expect(sql).toContain(fragment);
    for (const alias of ['s', 'd', 'a']) {
      expect(sql).toContain(`${alias}.xmin=pg_current_xact_id()::text::xid`);
    }
  });

  it('requires complete references at commit and freezes either side of retargeting', () => {
    expect(sql).toContain(
      'r.action_event_id=s.audit_event_id AND r.asset_version_id IS NULL',
    );
    expect(sql).toContain('r.xmin=pg_current_xact_id()::text::xid');
    expect(sql.match(/DEFERRABLE INITIALLY DEFERRED/gu)).toHaveLength(2);
    expect(sql).toContain("OLD.resource_type='case-payment-proof-supplement'");
    expect(sql).toContain("NEW.resource_type='case-payment-proof-supplement'");
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|UPDATE case_closure_payment_documents|DROP INDEX/iu,
    );
    const source = readMigration(
      '20261030330000_case_payment_proof_supplement_draft',
    );
    expect(source).toContain(
      'payment_proof_supplement_draft_gate BEFORE INSERT OR UPDATE OR DELETE',
    );
    expect(source).toContain(
      'payment_proof_supplement_document_draft_gate BEFORE INSERT OR UPDATE OR DELETE',
    );
  });
});
