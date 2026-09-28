import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('notary account migration', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260928030000_add_notary_accounts_and_opening_actor/migration.sql',
    ),
    'utf8',
  );

  it('adds an immutable office binding with department-matched office identity', () => {
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'NOTARY'");
    expect(migration).toContain(
      'notary_office_account_bindings_office_department_fkey',
    );
    expect(migration).toContain('notary account binding identity is immutable');
    expect(migration).toContain('user_accounts_notary_binding_cardinality');
    expect(migration).toContain(
      'external accounts cannot have internal memberships',
    );
  });

  it('backfills existing internal actors before requiring one of two durable FK paths', () => {
    for (const [table, actor] of [
      ['upload_drafts', 'actor_user_id'],
      ['notary_matter_opening', 'recorded_by_user_id'],
      ['notary_matter_command_receipts', 'actor_user_id'],
      ['audit_events', 'actor_user_id'],
    ]) {
      expect(migration).toContain(
        `UPDATE "${table}" SET "internal_actor_user_id" = "${actor}"`,
      );
    }
    expect(migration).toContain(
      'internal_actor_user_id IS NOT NULL) <> (notary_office_account_binding_id IS NOT NULL)',
    );
    expect(migration).toContain(
      'REFERENCES department_memberships(user_id, department_id)',
    );
    expect(migration).toContain(
      'REFERENCES notary_office_account_bindings(id, user_id, department_id)',
    );
  });

  it('temporarily lifts the immutable-opening trigger only around historical actor backfill', () => {
    const disable = migration.indexOf(
      'DISABLE TRIGGER reject_notary_opening_update_delete',
    );
    const backfill = migration.indexOf(
      'UPDATE "notary_matter_opening" SET "internal_actor_user_id"',
    );
    const enable = migration.indexOf(
      'ENABLE TRIGGER reject_notary_opening_update_delete',
    );
    expect(disable).toBeGreaterThan(migration.indexOf('BEGIN;'));
    expect(backfill).toBeGreaterThan(disable);
    expect(enable).toBeGreaterThan(backfill);
    expect(enable).toBeLessThan(
      migration.indexOf('CREATE FUNCTION enforce_dual_actor_path'),
    );
    expect(enable).toBeLessThan(migration.lastIndexOf('COMMIT;'));
  });
});
