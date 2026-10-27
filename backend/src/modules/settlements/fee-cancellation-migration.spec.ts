import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261026150000_v6_fee_cancellation/migration.sql',
  ),
  'utf8',
);
const installedProofSql = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261016120000_settlement_demo_alignment/migration.sql',
  ),
  'utf8',
);

describe('184 fee cancellation migration source guards (not PostgreSQL execution)', () => {
  it('wraps the complete forward migration in a transaction', () => {
    expect(sql.trimStart()).toMatch(/^--[^\n]*\nBEGIN;/u);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql.match(/^BEGIN;$/gmu)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gmu)).toHaveLength(1);
  });

  it('rejects unavailable proof material, unavailable exact versions and missing frozen references at both insert boundaries', () => {
    const proofGuard = sql.slice(
      sql.indexOf('CREATE FUNCTION "assert_fee_reconciliation_proof"'),
      sql.indexOf('CREATE FUNCTION "guard_fee_payment_verification_insert"'),
    );
    expect(proofGuard).toContain('"status"::text <> \'ACTIVE\'');
    expect(proofGuard).toContain('"deleted_at" IS NOT NULL');
    expect(proofGuard).toContain("version_status <> 'AVAILABLE'");
    expect(proofGuard).toContain('"purpose" = \'FEE_PROOF\'');
    expect(proofGuard).toContain('"content_version_id" = p_content_version_id');
    expect(proofGuard).toContain('"action_event_id" = p_action_event_id');
    expect(proofGuard).toContain('"resource_type" = p_resource_type');
    expect(proofGuard).toContain('"resource_id" = p_resource_id');
    expect(proofGuard.match(/FOR UPDATE/gu)).toHaveLength(3);
    expect(sql).toContain('\'fee-payment-verification\', NEW."id"');
    expect(sql).toContain('\'fee-refund-reconciliation\', NEW."id"');
    expect(sql).toContain('fee reconciliation proof reference is immutable');
    expect(proofGuard).not.toContain('current_version_id');
  });

  it('preserves the installed fee proof path while admitting only exact current internal reconciliation sources', () => {
    const revisedGuard = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "check_fee_proof_reference"'),
      sql.indexOf('CREATE FUNCTION "check_fee_reconciliation_reference_final"'),
    );
    const originalGuard = installedProofSql.slice(
      installedProofSql.indexOf('CREATE FUNCTION "check_fee_proof_reference"'),
      installedProofSql.indexOf('CREATE TRIGGER "fee_proof_reference_guard"'),
    );
    const legacyPath = (source: string) =>
      source.slice(
        source.indexOf("  IF NEW.resource_type<>'fee'"),
        source.indexOf(
          'END; $$;',
          source.indexOf("  IF NEW.resource_type<>'fee'"),
        ) + 'END; $$;'.length,
      );
    expect(legacyPath(revisedGuard).trim()).toBe(
      legacyPath(originalGuard).trim(),
    );
    expect(revisedGuard).toContain(
      "NEW.resource_type IN ('fee-payment-verification', 'fee-refund-reconciliation')",
    );
    expect(revisedGuard).toContain("cancellation.outcome='VOIDED'");
    expect(revisedGuard).toContain('membership.active=true');
    expect(revisedGuard).toContain("account.account_type='INTERNAL'");
    expect(revisedGuard).toContain('account.active=true');
    expect(revisedGuard).toContain("material.status='ACTIVE'");
    expect(revisedGuard).toContain("version.status='AVAILABLE'");
    expect(revisedGuard).toContain(
      'audit.internal_actor_user_id=audit.actor_user_id',
    );
    expect(revisedGuard).toContain(
      'audit.xmin=pg_current_xact_id()::text::xid',
    );
    expect(revisedGuard).toContain(
      "audit.details->>'proofContentVersionId'=version.id::text",
    );
  });

  it('requires every new frozen proof to be consumed by its exact same-transaction immutable fact at commit', () => {
    const finalGuard = sql.slice(
      sql.indexOf('CREATE FUNCTION "check_fee_reconciliation_reference_final"'),
      sql.indexOf('COMMIT;'),
    );
    expect(finalGuard).toContain('fee_cancellation_payments fact');
    expect(finalGuard).toContain('fee_refund_reconciliations fact');
    expect(finalGuard).toContain('fact.proof_material_id=NEW.material_id');
    expect(finalGuard).toContain(
      'fact.proof_content_version_id=NEW.content_version_id',
    );
    expect(finalGuard).toContain('fact.action_event_id=NEW.action_event_id');
    expect(finalGuard).toContain('fact.xmin=pg_current_xact_id()::text::xid');
    expect(finalGuard).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
});
