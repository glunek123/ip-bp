import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030480000_external_prehearing_empty_judgment_draft/migration.sql',
  ),
  'utf8',
).replaceAll('\r\n', '\n');
describe('prehearing empty judgment draft', () => {
  it('preserves all parent transition wrappers in old and new full bodies', () => {
    for (const tag of ['old', 'new']) {
      const bodies = [
        ...sql.matchAll(
          new RegExp('\\$' + tag + '\\$([\\s\\S]*?)\\$' + tag + '\\$', 'g'),
        ),
      ];
      expect(bodies).toHaveLength(3);
      for (const [, b] of bodies)
        for (const x of [
          'case_early_archive_transition(OLD, NEW)',
          'case_early_closure_transition(OLD, NEW)',
          'case_early_closure_register_transition(OLD, NEW)',
          'case_early_closure_correction_transition(OLD, NEW)',
        ])
          expect(b).toContain(x);
    }
  });
  it('requires empty facts and trusted same-case closure', () => {
    for (const x of [
      'ec.source_stage_locked',
      'v.early_closure_id=ec.id',
      'case_judgment_facts z',
      'case_judgment_next_steps z',
      'case_second_instance_progresses z',
      'case_second_instance_results z',
      "TG_TABLE_NAME='cases'",
      'replace(installed',
    ])
      expect(sql).toContain(x);
  });
  it('changes each complete function only by the narrow cases branch and retains normal-source guard', () => {
    const old = [...sql.matchAll(/\$old\$([\s\S]*?)\$old\$/g)];
    const updated = [...sql.matchAll(/\$new\$([\s\S]*?)\$new\$/g)];
    expect(old).toHaveLength(3);
    expect(updated).toHaveLength(3);
    const addition =
      '\n    IF TG_TABLE_NAME=\'cases\' AND external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") THEN RETURN NEW; END IF;';
    for (let i = 0; i < 3; i++) {
      expect(updated[i]![1].split(addition)).toHaveLength(2);
      expect(updated[i]![1].replace(addition, '')).toBe(old[i]![1]);
    }
    for (const body of [old[2]![1], updated[2]![1]]) {
      expect(body).toContain(
        'IF EXISTS (SELECT 1 FROM "case_external_entries" entry',
      );
      expect(body).toContain(
        'AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual',
      );
    }
  });
});
