import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030080000_case_refund_status_draft/migration.sql',
  ),
  'utf8',
);

describe('refund inventory persistence draft (static contract only)', () => {
  it('blocks every mutation without importing application or fee history', () => {
    expect(sql).toContain(
      'refund inventory persistence is draft and not enabled',
    );
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_versions"',
    );
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_items"',
    );
    expect(sql).not.toMatch(
      /\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+"(?:cases|case_refund_applications|fee_refund_reconciliations)"/u,
    );
  });

  it('supports multiple stable items and prohibits court cost conversion', () => {
    expect(sql).toContain('PRIMARY KEY ("inventory_version_id","item_id")');
    expect(sql).toContain(
      'CHECK ("status"<>\'CONVERTED_TO_COST\' OR "party"=\'DEFENDANT\')',
    );
    expect(sql).toContain(
      "'UNKNOWN','PENDING','SUBMITTED','RETURNED_UNSETTLED','SETTLED','RECEIVED','CONVERTED_TO_COST'",
    );
    expect(sql).toContain(
      'FOREIGN KEY ("inventory_version_id","case_id","department_id")',
    );
  });

  it('preserves consecutive append-only snapshots and exact human audit', () => {
    expect(sql).toContain('refund inventory history is immutable');
    expect(sql).toContain('refund inventory items are immutable');
    expect(sql).toContain('UNIQUE ("case_id","revision")');
    expect(sql).toContain('"prior_version_id" uuid UNIQUE');
    expect(sql).toContain('previous."revision"+1<>NEW."revision"');
    expect(sql).toContain(
      'a."internal_actor_user_id"=NEW."recorded_by_user_id"',
    );
    expect(sql).toContain('a."resource_id"=NEW."id"');
    expect(sql).toContain('NEW."creation_xid" := pg_current_xact_id()');
    expect(sql).toContain('v."creation_xid"=pg_current_xact_id()');
  });

  it('requires explicit zero-item declarations and unchanged item scope', () => {
    expect(sql).toContain(
      'not applicable refund inventory must contain zero items',
    );
    expect(sql).toContain(
      'empty refund inventory needs explicit not applicable declaration',
    );
    expect(sql).toContain(
      "previous.\"declaration\" NOT IN ('UNKNOWN','COMPLETE')",
    );
    expect(sql).toContain(
      'inventory changes require a new UNKNOWN version before confirmation',
    );
    expect(
      sql.match(/EXCEPT SELECT "item_id","party","description"/gu),
    ).toHaveLength(2);
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain(
      '"case_refund_inventory_item_snapshot_check" AFTER INSERT ON "case_refund_inventory_items"',
    );
    expect(sql).toContain(
      'PERFORM "validate_case_refund_inventory_snapshot"(NEW."inventory_version_id")',
    );
  });

  it('preserves completeness for status-only revisions without recording a new confirmation', () => {
    expect(sql).not.toMatch(/EXCEPT SELECT[^\n]*"status"/u);
    expect(sql).toContain(
      "(NEW.\"declaration\"='COMPLETE' AND previous.\"declaration\"='COMPLETE') THEN 'CASE_REFUND_INVENTORY_RECORD'",
    );
    expect(sql).toContain('previous."revision"+1<>NEW."revision"');
  });

  it('only projects the latest declaration and retains unknown and unsettled states', () => {
    expect(sql).toContain(
      'WHERE NOT EXISTS (SELECT 1 FROM "case_refund_inventory_versions" n WHERE n."prior_version_id"=v."id")',
    );
    expect(sql).toContain("WHEN v.\"declaration\"='UNKNOWN' THEN 'UNKNOWN'");
    expect(sql).toContain(
      "i.\"status\" NOT IN ('UNKNOWN','RECEIVED','CONVERTED_TO_COST')",
    );
    expect(sql).toContain("AND i.\"status\"='UNKNOWN') THEN 'UNKNOWN'");
  });
});
