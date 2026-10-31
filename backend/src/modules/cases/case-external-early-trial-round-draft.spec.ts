import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030470000_external_early_trial_round_draft/migration.sql',
  ),
  'utf8',
);
describe('external early trial round draft', () => {
  it('keeps existing round checks and narrows missing-round exception', () => {
    for (const s of [
      'replace(installed',
      'ec.source_stage_locked',
      'h.current_version_id',
      'v.early_closure_id=ec.id',
      'c."current_acceptance_id" IS NOT NULL',
      'external current round mismatch',
      'case_effective_acceptance_no',
    ])
      expect(sql).toContain(s);
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
