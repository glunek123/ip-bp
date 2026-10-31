import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030180000_early_closure_correction_transition_draft/migration.sql',
  ),
  'utf8',
);
describe('early source settlement correction parent draft', () => {
  it('requires exact same-stage immutable-row CAS and complete old/new chain', () => {
    for (const value of [
      "old_case.stage<>'WAITING_ARCHIVE'",
      "v.kind<>'CORRECT'",
      'prior.to_version IS DISTINCT FROM old_case.version',
      'v.prior_version_id',
      'case_closure_source_terminal_version',
      'h.early_closure_id IS DISTINCT FROM e.id',
    ])
      expect(sql).toContain(value);
  });
  it('binds the same-transaction correction, main audit, total receipt and fingerprint', () => {
    for (const value of [
      'closure_audit_event_id=v.audit_event_id',
      'r.audit_event_id',
      'cr.request_fingerprint=r.request_fingerprint',
      'cr.xmin=pg_current_xact_id()::text::xid',
      "a.action IS DISTINCT FROM 'CASE_CLOSURE_SETTLEMENT_UPDATED'",
    ])
      expect(sql).toContain(value);
  });
  it('preserves six validators and rejects changed or unknown parent functions', () => {
    expect(sql).toContain(
      "'check_case_closure_final','check_case_archive_final','check_execution_followup_case_final'",
    );
    expect(sql).toContain('changed<>12 OR preserved<>6');
    expect(sql).toContain('unreviewed correction parent guard');
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
