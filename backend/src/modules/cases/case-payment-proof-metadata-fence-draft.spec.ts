import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030390000_payment_proof_metadata_fence_draft/migration.sql',
  ),
  'utf8',
);

describe('closed payment proof metadata fence draft (source contract only)', () => {
  it('retains all existing gates and refuses an implicit historical migration', () => {
    expect(sql).not.toMatch(
      /DROP |DISABLE TRIGGER|CREATE OR REPLACE|DELETE FROM/iu,
    );
    expect(sql).toContain(
      'EXISTS (SELECT 1 FROM case_closure_payment_documents)',
    );
    expect(sql).toContain(
      'EXISTS (SELECT 1 FROM case_payment_proof_supplement_documents)',
    );
    expect(sql).toContain('requires an explicit historical evidence plan');
    expect(
      sql.match(
        /ADD COLUMN payment_proof_frozen boolean NOT NULL DEFAULT false/gu,
      ),
    ).toHaveLength(2);
  });

  it('requires a local document trigger to raise the fence and rejects born-frozen rows', () => {
    expect(sql.match(/pg_trigger_depth\(\)<2/gu)).toHaveLength(2);
    expect(
      sql.match(/d.xmin=pg_current_xact_id\(\)::text::xid/gu),
    ).toHaveLength(2);
    expect(sql).toContain('LANGUAGE sql VOLATILE');
    expect(sql).toContain('OLD.material_id,OLD.id');
    expect(sql).toContain('OLD.id,NULL');
    expect(
      sql.match(/cannot be born with a payment proof fence/gu),
    ).toHaveLength(2);
    expect(
      sql.match(
        /AFTER INSERT ON case_(?:closure_payment|payment_proof_supplement)_documents/gu,
      ),
    ).toHaveLength(2);
  });

  it('takes separate ordered nonwaiting locks before real writes, including repeat freezes', () => {
    const materialLock = sql.indexOf(
      'FROM materials WHERE id=NEW.material_id FOR NO KEY UPDATE NOWAIT',
    );
    const contentLock = sql.indexOf(
      'FROM content_versions WHERE id=NEW.content_version_id FOR NO KEY UPDATE NOWAIT',
    );
    const materialWrite = sql.indexOf(
      'UPDATE materials SET payment_proof_frozen=true WHERE id=m.id;',
    );
    const contentWrite = sql.indexOf(
      'UPDATE content_versions SET payment_proof_frozen=true WHERE id=v.id;',
    );
    expect(materialLock).toBeGreaterThan(0);
    expect(contentLock).toBeGreaterThan(materialLock);
    expect(materialWrite).toBeGreaterThan(contentLock);
    expect(contentWrite).toBeGreaterThan(materialWrite);
    expect(sql.replace(/--[^\n]*/gu, '')).not.toMatch(
      /WHERE\s+payment_proof_frozen\s*=\s*false/iu,
    );
    expect(sql).toContain("v.status::text<>'AVAILABLE'");
    expect(sql).toContain(
      "m.status::text<>'ACTIVE' OR m.deleted_at IS NOT NULL",
    );
  });

  it('protects stored metadata and cleanup state without relying on a visible reference', () => {
    expect(
      sql.match(/OLD.payment_proof_frozen AND NOT NEW.payment_proof_frozen/gu),
    ).toHaveLength(2);
    expect(
      sql.match(/IF OLD.payment_proof_frozen THEN RAISE EXCEPTION/gu),
    ).toHaveLength(2);
    expect(sql).toContain(
      'NEW.id,NEW.department_id,NEW.owner_type,NEW.owner_id,NEW.category,NEW.purpose,NEW.status,NEW.deleted_at',
    );
    expect(sql).toContain(
      "(to_jsonb(NEW)-'payment_proof_frozen') IS DISTINCT FROM (to_jsonb(OLD)-'payment_proof_frozen')",
    );
    expect(sql).not.toContain('FROM material_references');
  });
});
