import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030450000_external_early_closure_source_draft/migration.sql',
  ),
  'utf8',
);
describe('external early closure source draft', () => {
  it('checks prior guard and exact deferred trigger identities', () => {
    for (const s of [
      'replace(installed',
      "'case_closures','case_closure_versions'",
      'tgfoid=f',
      'tgtype=21',
      'tgdeferrable AND tginitdeferred',
    ])
      expect(sql).toContain(s);
  });
  it('restricts exception to an existing same-case early source and keeps legacy branches', () => {
    for (const s of [
      'ec.case_id=NEW."case_id"',
      'ec.department_id=NEW."department_id"',
      'NEW."external_entry_id" IS NOT NULL',
      'e."initial_stage"=\'ARCHIVED\'',
      'normal fact has external root',
    ])
      expect(sql).toContain(s);
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
