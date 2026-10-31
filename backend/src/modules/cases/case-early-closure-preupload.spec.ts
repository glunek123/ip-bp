import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030000000_early_closure_preupload/migration.sql',
  ),
  'utf8',
);
describe('early closure preupload guard draft', () => {
  it('requires internal membership, responsibility and the record permission', () => {
    expect(sql).toContain('u."active" AND u."account_type"=\'INTERNAL\'');
    expect(sql).toContain('m."department_id"=c."department_id" AND m."active"');
    expect(sql).toContain('c."responsible_user_id"=target_actor');
    expect(sql).toContain(
      'case_closure_actor_authorized(target_actor,target_case,target_department,false)',
    );
    expect(sql).toContain('NEW."owner_type"=\'CASE\'');
    expect(sql).toContain('NEW."purpose"=\'CASE_CLOSURE_DOCUMENT\'');
    expect(sql).toContain('NEW."lawyer_account_binding_id" IS NULL');
  });
  it('preserves fail-closed migration matching and cannot advance cases or create closure facts', () => {
    expect(sql).toContain('closure preupload guard changed');
    expect(sql).toContain(
      "position('conflicting early source' IN definition)=0",
    );
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "case_early_closures"');
    expect(sql).not.toMatch(
      /UPDATE "cases"|INSERT INTO|DROP TRIGGER|DISABLE TRIGGER/iu,
    );
  });
});
