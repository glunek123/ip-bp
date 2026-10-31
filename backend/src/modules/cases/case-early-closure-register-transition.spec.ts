import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030020000_early_closure_register_transition/migration.sql',
  ),
  'utf8',
);
describe('early closure atomic register transition draft', () => {
  it('binds both versions, sources, same-transaction facts and complete-command receipts', () => {
    for (const value of [
      'new_case.version IS DISTINCT FROM old_case.version+1',
      'case_early_closure_transition(source_case,old_case)',
      'v.early_closure_id IS DISTINCT FROM e.id',
      "v.kind<>'REGISTER'",
      'idempotency_key=er.idempotency_key',
      'request_fingerprint=er.request_fingerprint',
      "command='RECORD'",
      'xmin=pg_current_xact_id()::text::xid',
      'cr.result_snapshot IS DISTINCT FROM jsonb_build_object',
    ])
      expect(sql).toContain(value);
  });
  it('preserves full closure, archive, followup and source guards and rejects unknown inventory', () => {
    expect(sql).toContain(
      "'check_case_closure_final','check_case_archive_final','check_execution_followup_case_final'",
    );
    expect(sql).toContain(
      "'case_early_archive_final','case_archive_source_checks_final','case_early_closure_source_checks_final'",
    );
    expect(sql).toContain('changed<>12 OR preserved<>6');
    expect(sql).toContain('unreviewed register parent guard');
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|CREATE OR REPLACE FUNCTION.*case_early_closure_structure_guard/iu,
    );
  });
});
