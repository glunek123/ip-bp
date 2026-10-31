import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030280000_settlement_update_default_actor_draft/migration.sql',
  ),
  'utf8',
);

describe('settlement default actor SQL draft contract (not PostgreSQL execution)', () => {
  it('keeps ordinary authorization and requires the locked financial boundary twice', () => {
    expect(
      sql.match(/PERFORM assert_case_financial_actor_draft/g),
    ).toHaveLength(2);
    expect(sql).toContain('case_closure_actor_authorized(');
    expect(sql).toContain("NEW.kind<>'CORRECT'");
    expect(sql).toContain("c.stage<>'WAITING_ARCHIVE'");
    expect(sql).toContain('case_consolidation_members');
  });
  it('requires an exact same-transaction composed receipt at commit', () => {
    for (const clause of [
      'DEFERRABLE INITIALLY DEFERRED',
      'r.closure_version_id=NEW.id',
      'r.closure_audit_event_id=NEW.audit_event_id',
      'r.case_id=NEW.case_id',
      'r.department_id=NEW.department_id',
      'r.actor_user_id=NEW.recorded_by_user_id',
      'r.xmin=pg_current_xact_id()::text::xid',
    ])
      expect(sql).toContain(clause);
    expect(sql).not.toMatch(
      /DROP\s+TRIGGER|UPDATE\s+role_|UPDATE\s+user_accounts/iu,
    );
  });
});
