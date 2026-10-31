import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030410000_early_closure_actor_guard_draft/migration.sql',
  ),
  'utf8',
);

describe('early closure actor guard draft', () => {
  it('adds a source-level guard without opening or replacing gates', () => {
    expect(sql).toMatch(/BEFORE INSERT ON case_early_closures/u);
    expect(sql).not.toMatch(/DROP |ALTER |CREATE OR REPLACE|DISABLE TRIGGER/iu);
    expect(sql).not.toContain('case_closure_payment_versions');
  });
  it('checks current active responsible actor and both scoped permissions', () => {
    for (const clause of [
      'u.active IS NOT TRUE',
      "u.account_type <> 'INTERNAL'",
      'member.active IS NOT TRUE',
      'c.responsible_user_id IS DISTINCT FROM NEW.recorded_by_user_id',
      "'case.read') IS NOT TRUE",
      "'case.closure.record') IS NOT TRUE",
      "team.status='ACTIVE'",
    ])
      expect(sql).toContain(clause);
  });
  it('requires serializable locking of current authorization facts', () => {
    for (const clause of [
      "transaction_isolation') <> 'serializable'",
      'pg_try_advisory_xact_lock',
      'role_assignments',
      'role_templates',
      'role_grants',
      'FOR SHARE NOWAIT',
      'FOR UPDATE NOWAIT',
    ])
      expect(sql).toContain(clause);
  });
});
