import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030170000_refund_composition_binding_draft/migration.sql',
  ),
  'utf8',
);
describe('shared settlement update child binding draft', () => {
  it('requires same-transaction parent, exact child kind/version, actor, scope, key and hash', () => {
    expect(sql).toContain("CHECK(kind IN ('REFUND','ASSESSMENT'))");
    expect(sql).toContain(
      'child.child_version_id=NEW.child_version_id AND child.kind=NEW.kind',
    );
    expect(sql).toContain('parent.actor_user_id=NEW.actor_user_id');
    expect(sql).toContain('parent.idempotency_key=NEW.parent_key');
    expect(sql).toContain('parent.request_fingerprint=NEW.request_fingerprint');
    expect(sql).toContain(
      'child.creation_xmin=pg_current_xact_id()::text::xid',
    );
    expect(sql).toContain(
      "encode(sha256(convert_to(NEW.parent_key,'UTF8')),'hex')",
    );
    expect(sql).toContain('parent.xmin=pg_current_xact_id()::text::xid');
    expect(sql).toContain("'result',parent.result_snapshot");
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
  it('keeps mutations closed and preserves immutable links independently', () => {
    expect(sql).toContain("IF TG_OP<>'INSERT'");
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE');
    expect(sql).toContain('guard_case_refund_inventory_draft()');
  });
});
