import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030310000_archive_required_financial_snapshot_draft/migration.sql',
  ),
  'utf8',
);

describe('new archive financial snapshot SQL contract (not PostgreSQL execution)', () => {
  it('checks only future inserts of ARCHIVE and leaves CORRECT and historical rows alone', () => {
    expect(sql).toContain(
      "IF NEW.kind IS DISTINCT FROM 'ARCHIVE' THEN RETURN NEW; END IF;",
    );
    expect(sql).toContain(
      'AFTER INSERT ON case_archive_versions DEFERRABLE INITIALLY DEFERRED',
    );
    expect(sql).not.toMatch(
      /DROP\s+(?:TRIGGER|CONSTRAINT)|DISABLE\s+TRIGGER|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+case_|DELETE\s+FROM/iu,
    );
  });

  it('binds an exact same-transaction snapshot and requires serializable isolation', () => {
    expect(sql).toContain(
      "current_setting('transaction_isolation')<>'serializable'",
    );
    expect(sql).toContain(
      'archive_version_id=NEW.id AND case_id=NEW.case_id AND department_id=NEW.department_id',
    );
    expect(sql).toContain('closure_version_id=NEW.closure_version_id');
    expect(sql).toContain(
      'creation_xid=pg_current_xact_id() AND xmin=pg_current_xact_id()::text::xid',
    );
    expect(sql).toContain('IF s.id IS NULL THEN');
  });

  it('calls the authoritative complete-set validator before accepting any readiness', () => {
    expect(sql).toContain('PERFORM validate_archive_snapshot_readiness(s.id);');
    expect(
      sql.indexOf('PERFORM validate_archive_snapshot_readiness(s.id);'),
    ).toBeLessThan(sql.indexOf('IF s.closure_amount=0 THEN'));
    expect(sql).not.toMatch(
      /stage\s*=\s*'ARCHIVED'|CREATE OR REPLACE FUNCTION validate_archive/iu,
    );
  });

  it('accepts only exact zero exemption or all four passed checks and rejects unknown amounts', () => {
    expect(sql).toContain('IF s.closure_amount=0 THEN');
    expect(sql).toContain(
      "ROW('EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar)",
    );
    expect(sql).toContain(
      'ELSIF s.closure_amount IS NULL OR s.closure_amount<0 OR',
    );
    expect(sql).toContain(
      "ROW('PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar)",
    );
    expect(sql.match(/IS DISTINCT FROM ROW\(/gu)).toHaveLength(2);
  });
});
