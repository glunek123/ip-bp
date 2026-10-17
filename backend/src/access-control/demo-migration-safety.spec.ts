import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = (name: string): string =>
  readFileSync(
    resolve(__dirname, '../../prisma/migrations', name, 'migration.sql'),
    'utf8',
  );
const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

describe('Demo forward migration source boundaries (not database execution)', () => {
  it.each([
    '20261016120000_settlement_demo_alignment',
    '20261016130000_evidence_demo_alignment',
  ])('%s has an explicit transaction and never writes a Grant', (name) => {
    const sql = migration(name);
    expect(sql.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(?:role_grants|role_assignments|user_accounts|local_credentials)"/iu,
    );
  });

  it('writes only new evidence tables while converting real historical sources', () => {
    const sql = migration('20261016130000_evidence_demo_alignment');
    const targets = [
      ...sql.matchAll(
        /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"([a-z_]+)"/giu,
      ),
    ].map((match) => match[1]);
    expect(targets).toEqual([
      'evidence_group_versions',
      'evidence_items',
      'evidence_paper_certificates',
      'evidence_audit_events',
    ]);
    const conversion = sql.slice(
      sql.indexOf('CREATE TEMP TABLE "evidence_import_sources_1300"'),
    );
    expect(conversion).toContain('JOIN "notary_matter_evidence"');
    expect(conversion).toContain('JOIN "cases"');
    expect(conversion).toContain('FROM "material_references"');
    expect(conversion).toContain('jsonb_agg(jsonb_build_object(');
    expect(conversion).not.toMatch(/\bLIMIT\s+1\b|\bDISTINCT\s+ON\b/iu);
    expect(conversion).not.toContain(
      '"content_version_id", "content_material_id"',
    );
  });

  it('checks nullable group case alignment in both child collections at transaction end', () => {
    const sql = migration('20261016130000_evidence_demo_alignment');
    for (const table of [
      'evidence_group_versions',
      'evidence_items',
      'evidence_paper_certificates',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE CONSTRAINT TRIGGER "[a-z_]+" AFTER INSERT OR UPDATE ON "${table}" DEFERRABLE INITIALLY DEFERRED`,
          'u',
        ),
      );
    }
    const alignment = sql.slice(
      sql.indexOf('CREATE FUNCTION "assert_evidence_group_case_alignment"'),
      sql.indexOf('CREATE FUNCTION "guard_evidence_source_initialized"'),
    );
    expect(alignment).toContain('i.case_id IS DISTINCT FROM expected_case');
    expect(alignment).toContain('p.case_id IS DISTINCT FROM expected_case');
    expect(alignment).toContain('FOR SHARE');
    expect(alignment).not.toContain('removed_at');
    for (const name of [
      'evidence_item_group_case_fk',
      'evidence_paper_group_case_fk',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CONSTRAINT "${name}" FOREIGN KEY \\("group_id", "department_id", "case_id"\\)[^;]+ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;`,
          'u',
        ),
      );
      expect(schema).toContain(`onUpdate: NoAction, map: "${name}"`);
    }
    expect(sql).toContain(
      'OLD.case_id IS NOT NULL AND NEW.case_id IS DISTINCT FROM OLD.case_id',
    );
    expect(sql).toContain(
      'c.source_notary_matter_id = NEW.source_notary_matter_id',
    );
  });

  it.each([
    ['case_settlement_launches', 'settlement_launch'],
    ['settlement_bills', 'settlement_bill'],
    ['fee_records', 'fee_record'],
    ['fee_batch_receipts', 'fee_batch_receipt'],
  ])(
    '%s persists both real user and same-department actor relationships',
    (table, name) => {
      const sql = migration('20261016120000_settlement_demo_alignment');
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id")`,
      );
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}_actor_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id")`,
      );
      expect(schema).toContain(`map: "${name}_actor_user_fk"`);
      expect(schema).toContain(`map: "${name}_actor_membership_fk"`);
      expect(sql).toContain(
        '"source" = \'auto\' AND "actor_user_id" IS NULL AND "idempotency_key" IS NULL',
      );
    },
  );
});
