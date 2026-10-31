import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030150000_case_payment_proof_authorization_draft/migration.sql',
  ),
  'utf8',
);
describe('payment screenshot authorization preparation', () => {
  it('requires active internal membership, own case and existing operating access', () => {
    for (const value of [
      'c.responsible_user_id IS DISTINCT FROM target_actor',
      "u.account_type='INTERNAL'",
      'u.active',
      'm.active',
      "case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS NOT TRUE",
      'case_early_closure_upload_authorized',
    ])
      expect(sql).toContain(value);
  });
  it('requires a real closure for supplements and archive anchor for archived corrections without enabling uploads', () => {
    expect(sql).toContain("c.stage NOT IN ('WAITING_ARCHIVE','ARCHIVED')");
    expect(sql).toContain('a.closure_version_id=h.current_version_id');
    expect(sql).not.toMatch(
      /CREATE TRIGGER|DROP TRIGGER|UPDATE cases|INSERT INTO/iu,
    );
  });
});
