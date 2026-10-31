import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030140000_case_payment_evidence_reference_draft/migration.sql',
  ),
  'utf8',
);
describe('payment evidence reference draft', () => {
  it('binds payment, audit, case ownership and exact active content version', () => {
    for (const value of [
      'p.id=NEW.resource_id',
      'd.material_id=NEW.material_id',
      'a.id=NEW.action_event_id',
      'm.owner_id=p.case_id',
      "m.category::text='CASE_CLOSURE_PAYMENT_PROOF'",
      'm.current_version_id=v.id',
      "v.status='AVAILABLE'",
      "v.mime_type IN ('image/png','image/jpeg')",
      'NEW.asset_version_id IS NOT NULL',
    ])
      expect(sql).toContain(value);
  });
  it('rejects retrospective links to an old payment, audit or document', () => {
    for (const alias of ['p', 'a', 'd'])
      expect(sql).toContain(`${alias}.xmin=pg_current_xact_id()::text::xid`);
  });
  it('preserves references and existing gates', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON material_references');
    expect(sql).toContain('NEW.resource_type');
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });
});
