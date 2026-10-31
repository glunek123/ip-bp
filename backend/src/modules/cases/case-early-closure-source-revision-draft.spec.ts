import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030430000_early_closure_source_revision_draft/migration.sql',
  ),
  'utf8',
);
describe('early closure source revision draft', () => {
  it('keeps closed gates and checks exact prior transition function', () => {
    expect(sql).toContain(
      "IF replace(installed,E'\\r\\n',E'\\n') IS DISTINCT FROM replace(expected,E'\\r\\n',E'\\n') THEN RAISE EXCEPTION 'unexpected early closure transition function' USING ERRCODE='23514'; END IF;",
    );
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
    expect(sql).toContain('audit."details" - \'authorizationRevision\'');
  });
  it('requires new facts to bind current revision and same-transaction source audit', () => {
    for (const clause of [
      'BEFORE INSERT ON case_early_closures',
      'pg_current_xact_id()',
      "a.action IS DISTINCT FROM 'case.early_closed'",
      "jsonb_typeof(a.details->'authorizationRevision')",
      "a.details->'authorizationRevision' IS DISTINCT FROM to_jsonb(revision)",
      'revision <= 0',
    ])
      expect(sql).toContain(clause);
  });
});
