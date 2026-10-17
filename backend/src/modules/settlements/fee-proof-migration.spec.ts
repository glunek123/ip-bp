import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = (name: string) =>
  readFileSync(
    resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'),
    'utf8',
  );
describe('fee source/proof migration source contract (not database execution)', () => {
  const sql = read('20261016120000_settlement_demo_alignment');
  it('prepares FEE_PROOF alone before any subsequent SQL uses it', () => {
    const prepare = read('20261016115000_fee_proof_category_prepare');
    expect(prepare.match(/ALTER TYPE/gu)).toHaveLength(1);
    expect(prepare).toContain(
      'ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS \'FEE_PROOF\';',
    );
    expect(prepare).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE TABLE)\b/iu);
    expect(sql).not.toContain('ALTER TYPE "material_category"');
  });
  it('only imports known actual case sources into new rows and retains stable source keys', () => {
    const projection = sql.slice(sql.lastIndexOf('-- One-time projection'));
    expect(
      [...projection.matchAll(/INSERT INTO "([a-z_]+)"/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(['fee_records', 'fee_records']);
    expect(projection).toContain('f."state"=\'KNOWN\'');
    expect(projection).toContain('e."sample_fee_state"=\'KNOWN\'');
    expect(projection).not.toMatch(/COALESCE|已支付|\bUPDATE\b|\bDELETE\b/iu);
    expect(sql).toContain('"fee_records_department_source_key"');
    expect(sql).toContain('automatic fee lacks exact known original source');
  });
  it('adds independent exact proof guards without replacing old classifiers or expanding grant ownership', () => {
    expect(sql).toContain(
      'fee proof lacks exact same-transaction internal source',
    );
    expect(sql).toContain('cv.case_section_record_upload_draft_id IS NULL');
    expect(sql).toContain('cv.execution_supplement_upload_draft_id IS NULL');
    expect(sql).toContain('a.xmin=pg_current_xact_id()::text::xid');
    expect(sql).toContain(
      'fee proof change lacks exact internal command audit',
    );
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).not.toContain('classify_case_record_material_reference');
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) "(?:role_grants|user_accounts|role_assignments)"/iu,
    );
  });
  it('retains fee, source, receipt and frozen file history', () => {
    for (const name of [
      'fee_source_identity_immutable',
      'financial_audit_receipt_immutable',
      'fee_batch_receipt_immutable',
      'fee_frozen_content_guard',
      'fee_frozen_material_guard',
    ])
      expect(sql).toContain(`"${name}"`);
    expect(sql).toContain('fee proof references are immutable');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE RESTRICT');
  });
});
