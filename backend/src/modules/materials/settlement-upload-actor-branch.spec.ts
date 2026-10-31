import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030300000_settlement_upload_actor_branch_draft/migration.sql',
  ),
  'utf8',
);
describe('settlement target only upload actor preparation', () => {
  it('requires a persisted exact target before using operational upload authorization', () => {
    for (const value of [
      'NEW.settlement_update_upload_target_id IS NOT NULL',
      't.upload_draft_id=NEW.id',
      't.case_id=NEW.owner_id',
      't.department_id=NEW.department_id',
      't.actor_user_id=NEW.actor_user_id',
      'settlement_update_document_upload_eligible',
    ])
      expect(sql).toContain(value);
  });
  it('retains the historical actor body and fails on changed predecessor without removing gates', () => {
    expect(sql).toContain('EXECUTE replace(definition,needle,branch||needle)');
    expect(sql).toContain('settlement upload actor predecessor changed');
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|CREATE OR REPLACE FUNCTION guard_settlement_upload_target_draft/iu,
    );
  });
});
