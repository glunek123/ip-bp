import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = (name: string) =>
  readFileSync(
    resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'),
    'utf8',
  ).replace(/\r\n/gu, '\n');
const oldSql = migration(
  '20261030380000_payment_proof_housekeeping_gate_draft',
);
const sql = migration(
  '20261030400000_payment_proof_fence_gate_compatibility_draft',
);
const section = (source: string, tag: string) => {
  const match = source.match(
    new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'u'),
  );
  if (!match) throw new Error(`Missing migration section: ${tag}`);
  return match[1];
};

describe('closed proof fence gate compatibility (source checks only)', () => {
  it('recognizes the prior body and preserves its housekeeping and refusal paths', () => {
    expect(section(sql, 'original')).toBe(section(oldSql, 'original'));
    expect(section(sql, 'housekeeping')).toBe(section(oldSql, 'housekeeping'));
    expect(sql).toContain('replace(installed_body');
    expect(sql).toContain('IS DISTINCT FROM expected_body');
    expect(sql).not.toMatch(/DISABLE TRIGGER|DROP TRIGGER|DELETE FROM/iu);
    expect(sql.match(/t\.tgtype=5/gu)).toHaveLength(2);
    expect(
      sql.match(/NOT t\.tgdeferrable AND NOT t\.tginitdeferred/gu),
    ).toHaveLength(2);
    expect(
      sql.match(/p\.proname='freeze_payment_proof_document_metadata_draft'/gu),
    ).toHaveLength(2);
  });

  it('limits the exception to nested material updates with an exact local document', () => {
    const allowed = section(sql, 'fence');
    expect(allowed).toContain(
      "TG_RELID='materials'::regclass AND pg_trigger_depth()>=2",
    );
    expect(allowed).toContain('NEW.payment_proof_frozen IS TRUE');
    expect(allowed).toContain(
      "(to_jsonb(NEW)-'payment_proof_frozen')=(to_jsonb(OLD)-'payment_proof_frozen')",
    );
    expect(allowed).toContain('d.content_version_id=OLD.current_version_id');
    expect(allowed).toContain(
      'd.case_id=OLD.owner_id AND d.department_id=OLD.department_id',
    );
    expect(
      allowed.match(/d\.xmin=pg_current_xact_id\(\)::text::xid/gu),
    ).toHaveLength(2);
    expect(allowed).toContain('case_closure_payment_documents');
    expect(allowed).toContain('case_payment_proof_supplement_documents');
    expect(allowed).not.toContain('OLD.payment_proof_frozen IS FALSE');
  });
});
