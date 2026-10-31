import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030460000_external_early_closure_terminal_draft/migration.sql',
  ),
  'utf8',
);
describe('external early terminal draft', () => {
  it('binds new sources to locked database stage while retaining old strict branch', () => {
    for (const x of [
      'DEFAULT false',
      'NEW.source_stage_locked IS DISTINCT FROM false',
      'FOR UPDATE',
      'c.stage IS DISTINCT FROM NEW.from_stage',
      'c.version IS DISTINCT FROM NEW.from_version',
      'NEW.source_stage_locked:=true',
      'NOT early.source_stage_locked AND early.from_stage=phase AND early.from_version=terminal',
      'case_archive_terminal_version',
      'replace(installed',
    ])
      expect(sql).toContain(x);
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
