import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = (name: string) =>
  readFileSync(
    resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'),
    'utf8',
  );
const sql = migration('20261030240000_financial_actor_authorization_draft');

describe('financial actor database authorization draft', () => {
  it('binds real current internal actor, membership, own case, read scope and revision', () => {
    for (const clause of [
      'u.active IS NOT TRUE',
      "u.account_type<>'INTERNAL'",
      'member.active IS NOT TRUE',
      'c.responsible_user_id IS DISTINCT FROM target_actor',
      "'case.read') IS NOT TRUE",
      "jsonb_typeof(a.details->'authorizationRevision') IS DISTINCT FROM 'number'",
      "a.details->'authorizationRevision' IS DISTINCT FROM to_jsonb(u.authorization_revision)",
      'a.actor_user_id IS DISTINCT FROM target_actor',
      'a.internal_actor_user_id IS DISTINCT FROM target_actor',
      'a.department_id IS DISTINCT FROM target_department',
      'a.resource_id IS DISTINCT FROM target_version',
      'a.action IS DISTINCT FROM target_action',
      "team.status='ACTIVE'",
    ])
      expect(sql).toContain(clause);
    expect(sql).not.toContain('case.closure.correct');
  });

  it('keeps distinct command stages, audit actions and current same-case closure', () => {
    expect(sql).toContain("allowed := ARRAY['WAITING_ARCHIVE'];");
    expect(
      sql.match(/allowed := ARRAY\['WAITING_ARCHIVE','ARCHIVED'\]/gu),
    ).toHaveLength(2);
    for (const value of [
      'CASE_CLOSURE_PAYMENT_VOID',
      'CASE_CLOSURE_PAYMENT_CORRECT',
      'CASE_REFUND_INVENTORY_CONFIRM',
      'CASE_SETTLEMENT_ASSESSMENT_RECORD',
      'v.id=h.current_version_id',
      'v.closure_id=h.id',
      'v.case_id=h.case_id',
      "v.id::text=to_jsonb(NEW)->>'closure_version_id'",
    ])
      expect(sql).toContain(value);
  });

  it('serializes authorization facts and rejects unavailable facts without waiting', () => {
    expect(sql).toContain(
      "current_setting('transaction_isolation')<>'serializable'",
    );
    expect(sql).toContain(
      "pg_try_advisory_xact_lock(hashtextextended('organization:'",
    );
    expect(sql).toContain("USING ERRCODE='55P03'");
    for (const table of [
      'user_accounts',
      'department_memberships',
      'role_assignments',
      'role_templates',
      'role_grants',
      'teams',
    ]) {
      expect(sql).toMatch(
        new RegExp(`FROM ${table}[\\s\\S]*?FOR SHARE NOWAIT`, 'u'),
      );
    }
    expect(sql).toContain('FOR UPDATE NOWAIT');
  });

  it('adds three guards and preserves every existing closed-write gate and invariant', () => {
    expect(sql.match(/CREATE TRIGGER /gu)).toHaveLength(3);
    expect(sql).not.toMatch(
      /DROP |ALTER |CREATE OR REPLACE|INSERT INTO|UPDATE user_accounts|GRANT /iu,
    );
    for (const [directory, gate] of [
      [
        '20261030030000_case_closure_payment_draft',
        'case closure payment persistence is draft and not enabled',
      ],
      [
        '20261030080000_case_refund_status_draft',
        'refund inventory persistence is draft and not enabled',
      ],
      [
        '20261030100000_case_settlement_assessment_draft',
        'settlement assessment persistence is draft and not enabled',
      ],
    ])
      expect(migration(directory)).toContain(gate);
    expect(sql).toContain("IF TG_OP<>'INSERT'");
    expect(sql).toContain('Early-closure initial payment needs its');
  });
});
