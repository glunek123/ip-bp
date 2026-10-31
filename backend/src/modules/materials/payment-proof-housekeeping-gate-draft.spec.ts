import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030380000_payment_proof_housekeeping_gate_draft/migration.sql',
  ),
  'utf8',
);
const oldSql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030060000_case_closure_payment_proof_gate/migration.sql',
  ),
  'utf8',
);
const housekeeping = sql.split('$housekeeping$')[1]!;

describe('closed payment proof housekeeping gate forward draft (static contract only)', () => {
  it('fails closed on changed original function or either gate identity and preserves the old gate body', () => {
    expect(sql.split('$original$')[1]!.replace(/\r\n/gu, '\n')).toBe(
      oldSql.split('AS $$')[1]!.split('$$;')[0]!.replace(/\r\n/gu, '\n'),
    );
    expect(sql).toContain(
      "replace(installed_body,E'\\r\\n',E'\\n') IS DISTINCT FROM replace(expected_body,E'\\r\\n',E'\\n')",
    );
    for (const table of ['upload_drafts', 'materials'])
      expect(sql).toContain(`t.tgrelid='${table}'::regclass`);
    expect(
      sql.match(/t\.tgtype=23 AND t\.tgenabled='O' AND NOT t\.tgisinternal/gu),
    ).toHaveLength(2);
    expect(sql).toContain(
      "replace(installed_body,E'\\nBEGIN\\n',E'\\nBEGIN\\n'||housekeeping)",
    );
    expect(sql).not.toMatch(
      /DROP\s|ALTER\s|DISABLE\s|INSERT INTO|DELETE FROM|UPDATE\s+\w+\s+SET/iu,
    );
  });
  it('admits only expired proof draft UPDATE housekeeping, never INSERT, finalize or material writes', () => {
    expect(housekeeping).toContain("IF TG_OP='UPDATE' THEN");
    expect(housekeeping).toContain(
      "IF OLD.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR OLD.purpose='CASE_CLOSURE_PAYMENT_PROOF' THEN",
    );
    expect(housekeeping).toContain(
      "IF TG_RELID='upload_drafts'::regclass THEN",
    );
    expect(housekeeping).toContain('OLD.expires_at<=CURRENT_TIMESTAMP');
    expect(housekeeping).toContain(
      'NEW.updated_at>=OLD.updated_at AND NEW.updated_at<=clock_timestamp()',
    );
    expect(housekeeping).toContain(
      "OLD.status='OPEN' AND NEW.status='EXPIRED'",
    );
    expect(housekeeping).toContain(
      "OLD.status='EXPIRED' AND NEW.status='EXPIRED' AND OLD.pending_storage_key IS NOT NULL",
    );
    expect(housekeeping.match(/RETURN NEW;/gu)).toHaveLength(1);
    expect(housekeeping).not.toMatch(
      /FINALIZED|TG_OP='INSERT'|TG_RELID='materials'/u,
    );
    expect(housekeeping).toContain(
      "RAISE EXCEPTION 'payment screenshot upload contract is draft and not enabled'",
    );
  });
  it('cannot smuggle key, classification, identity, owner, actor, target or upload metadata edits through housekeeping', () => {
    // Whole-row comparison includes future columns automatically. Only status
    // on expiry and updated_at on rotation can be excluded, never a key or ID.
    const excluded = [
      ...housekeeping.matchAll(/to_jsonb\((?:NEW|OLD)\)((?:-'[a-z_]+')+)/gu),
    ].map((m) => m[1]);
    expect(excluded).toEqual([
      "-'status'-'updated_at'",
      "-'status'-'updated_at'",
      "-'updated_at'",
      "-'updated_at'",
    ]);
    for (const field of [
      'pending_storage_key',
      'category',
      'purpose',
      'department_id',
      'owner_id',
      'owner_type',
      'actor_user_id',
      'internal_actor_user_id',
      'settlement_update_upload_target_id',
      'case_section_record_target_id',
      'original_filename',
      'declared_mime_type',
      'expires_at',
    ]) {
      expect(
        excluded.every((columns) => !columns!.includes(`-'${field}'`)),
      ).toBe(true);
    }
  });
});
