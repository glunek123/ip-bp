import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030510000_external_prehearing_formal_round/migration.sql',
  ),
  'utf8',
).replaceAll('\r\n', '\n');
describe('external prehearing formal round', () => {
  it('retains source, head, common facts and the no-round branch', () => {
    const old = sql.match(/\$old\$([\s\S]*?)\$old\$/)![1]!;
    const updated = sql.match(/\$new\$([\s\S]*?)\$new\$/)![1]!;
    for (const c of [
      'ec.source_stage_locked',
      'v.early_closure_id=ec.id',
      'c.current_judgment_id IS NULL',
      'case_judgment_facts',
      'case_judgment_next_steps',
      'case_second_instance_progresses',
      'case_second_instance_results',
    ]) {
      expect(old).toContain(c);
      expect(updated).toContain(c);
    }
    expect(updated).toContain('c.current_trial_round_id IS NULL OR');
    expect(updated).toContain(
      'c.current_trial_round_id IS NOT NULL OR NOT EXISTS',
    );
    expect(updated).not.toContain('case_filing_submissions');
  });
  it('requires a single live same-entry external initial round and no acceptance or hearing', () => {
    for (const c of [
      "ec.from_stage='WAITING_FORMAL_ACCEPTANCE'",
      "e.initial_stage='WAITING_FORMAL_ACCEPTANCE'",
      'r.id=c.current_trial_round_id',
      'r.external_entry_id=e.id',
      "r.origin='EXTERNAL_CURRENT'",
      'r.sequence=1',
      'r.source_result_id IS NULL',
      'r.revoked_at IS NULL',
      ')=1',
      'case_acceptances',
      'case_hearing_arrangements',
      'case_hearing_advances',
      'replace(installed',
    ])
      expect(sql).toContain(c);
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
