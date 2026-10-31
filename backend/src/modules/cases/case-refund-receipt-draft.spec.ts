import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030090000_case_refund_receipt_draft/migration.sql',
  ),
  'utf8',
);
describe('refund command receipt closed draft', () => {
  it('seals receipt snapshots immediately even when deferred constraints were forced early', () => {
    expect(sql).toContain('BEFORE INSERT ON "case_refund_inventory_items"');
    expect(sql).toContain(
      'r."inventory_version_id"=NEW."inventory_version_id"',
    );
    expect(sql).toContain('refund receipt seals inventory against later items');
    expect(sql).toContain('Construct parent, then all items, then receipt');
    expect(sql).toContain(
      '(a."details"->>\'requestFingerprint\') IS DISTINCT FROM NEW."request_fingerprint"::text',
    );
  });
  it('deduplicates actor command keys and binds exact inventory scope', () => {
    expect(sql).toContain(
      'UNIQUE ("department_id","actor_user_id","idempotency_key")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("inventory_version_id","case_id","department_id")',
    );
    expect(sql).toContain("'^[0-9a-f]{64}$'");
    expect(sql).not.toContain('INSERT INTO');
  });
  it('binds actor, audit, all items and computed readiness to the immutable version', () => {
    expect(sql).toContain('v."audit_event_id"<>NEW."audit_event_id"');
    expect(sql).toContain(
      'a."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"',
    );
    expect(sql).toContain('supplied_items IS DISTINCT FROM expected_items');
    expect(sql).toContain("'draft',true,'readiness',readiness");
    expect(sql).toContain('validate_case_refund_inventory_snapshot');
  });
  it('preserves immutable receipts behind the closed write gate', () => {
    expect(sql).toContain('refund receipts are immutable');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain(
      'EXECUTE FUNCTION "guard_case_refund_inventory_draft"()',
    );
  });
});
