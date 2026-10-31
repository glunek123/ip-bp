import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030130000_case_archive_evidence_snapshot_draft/migration.sql',
  ),
  'utf8',
);

describe('archive evidence snapshot draft (static contract only)', () => {
  it('keeps every write closed and never invents historical approval', () => {
    for (const table of [
      'case_archive_evidence_snapshots',
      'case_archive_snapshot_payments',
      'case_archive_snapshot_allocations',
    ]) {
      expect(sql).toContain(`BEFORE INSERT OR UPDATE OR DELETE ON "${table}"`);
    }
    expect(
      sql.match(/EXECUTE FUNCTION "guard_case_archive_snapshot_draft"\(\)/gu),
    ).toHaveLength(3);
    expect(sql).toContain('CHECK ("readiness"=\'UNKNOWN\')');
    expect(sql).not.toMatch(/\bINSERT INTO\b/iu);
    expect(sql).not.toMatch(/\bUPDATE\s+"cases"/iu);
  });
  it('requires the initial archive in this transaction and exact closure anchors', () => {
    expect(sql).toContain('a."kind"=\'ARCHIVE\'');
    expect(sql).toContain('a."prior_version_id" IS NULL');
    expect(sql).toContain('a."closure_version_id"=NEW."closure_version_id"');
    expect(sql).toContain('a.xmin=pg_current_xact_id()::text::xid');
    for (const field of [
      'archive_version_id',
      'closure_version_id',
      'refund_inventory_version_id',
      'settlement_assessment_version_id',
    ]) {
      expect(sql).toContain(
        `FOREIGN KEY ("${field}","case_id","department_id")`,
      );
    }
  });
  it('builds a complete set before sealing and prevents later evidence injection', () => {
    expect(sql).toContain('NEW."creation_xid":=pg_current_xact_id()');
    expect(sql).toContain('s."creation_xid"=pg_current_xact_id()');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('archive snapshot cannot receive later evidence');
    expect(sql).toContain('archive snapshot items are immutable');
    expect(sql).toContain('archive evidence snapshot is immutable');
    expect(sql).toContain(
      "current_setting('transaction_isolation')<>'serializable'",
    );
  });
  it('checks both directions of payment and allocation membership, not just totals', () => {
    expect(sql.match(/\bEXCEPT SELECT\b/gu)).toHaveLength(4);
    expect(sql).toContain('p."state"=\'ACTIVE\'');
    expect(sql).toContain('n."prior_version_id"=p."id"');
    expect(sql).toContain('PRIMARY KEY ("snapshot_id","allocation_id")');
    expect(sql).toContain('PRIMARY KEY ("snapshot_id","payment_version_id")');
    expect(sql).toContain(
      'snapshot."source_case_ids" IS DISTINCT FROM expected_cases',
    );
    expect(sql).toContain(
      'snapshot."consolidation_id" IS DISTINCT FROM actual_consolidation',
    );
    expect(sql).not.toMatch(/\bSUM\s*\(/iu);
  });
  it('selects latest financial sources and rejects a mismatched assessment closure', () => {
    expect(sql).toContain(
      'snapshot."refund_inventory_version_id" IS DISTINCT FROM refund_id',
    );
    expect(sql).toContain(
      'snapshot."settlement_assessment_version_id" IS DISTINCT FROM assessment_id',
    );
    expect(sql).toContain(
      'v."closure_version_id"<>snapshot."closure_version_id"',
    );
  });
  it('revalidates each child insert even after constraints become immediate', () => {
    for (const table of [
      'case_archive_snapshot_payments',
      'case_archive_snapshot_allocations',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE CONSTRAINT TRIGGER "[^"]+" AFTER INSERT ON "${table}" DEFERRABLE INITIALLY DEFERRED`,
        ),
      );
    }
    expect(sql).toContain(
      'PERFORM validate_case_archive_evidence_snapshot(NEW."snapshot_id")',
    );
    expect(sql).toContain(
      'SELECT * INTO snapshot FROM "case_archive_evidence_snapshots" WHERE "id"=snapshot_id',
    );
  });
  it('blocks source inserts after capture so an already checked set cannot become stale', () => {
    expect(sql).toContain('s."creation_xid"=pg_current_xact_id()');
    expect(sql).toContain(
      'archive sources cannot change after snapshot capture',
    );
    for (const table of [
      'settlement_actual_facts',
      'case_settlement_actual_allocations',
      'case_closure_payment_versions',
      'case_refund_inventory_versions',
      'case_refund_inventory_items',
      'case_settlement_assessment_versions',
      'case_settlement_terms',
      'case_consolidation_members',
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON %I');
  });
  it('requires deferred assembly then one full validation in independent case transactions', () => {
    expect(sql).toContain('process each case in its');
    expect(sql).toContain(
      'own transaction; keep snapshot completeness constraints DEFERRED while building',
    );
    expect(sql).toContain(
      'Prepare ALL source facts first, insert parent then ALL payment/allocation items',
    );
    expect(sql).toContain(
      'switch the related constraints to IMMEDIATE once to validate the full set',
    );
    expect(sql).toContain(
      'Building a nonempty snapshot row-by-row under IMMEDIATE is NOT supported',
    );
    expect(sql).toContain('transaction-wide, including OTHER cases');
    expect(sql).toContain(
      "preparing another case's sources after creating a snapshot",
    );
    expect(sql).toContain('guarantee this order, keep the write gate closed');
  });
});
