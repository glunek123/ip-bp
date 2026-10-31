import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029120000_early_closure_source_structure/migration.sql',
  ),
  'utf8',
);

describe('early closure source structure migration', () => {
  it('keeps the new source unusable until the historical source guards are extended', () => {
    expect(migration).toContain(
      "RAISE EXCEPTION 'early closure source is not enabled'",
    );
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_early_closures"',
    );
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_early_closure_receipts"',
    );
    expect(migration).not.toMatch(
      /\bDISABLE TRIGGER\b|\bDROP TRIGGER\b|\bUPDATE "cases"\b/iu,
    );
  });

  it('anchors the closure source to the same case and department', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("early_closure_id", "case_id", "department_id")',
    );
    expect(migration).toContain(
      '"early_closure_id" IS NULL OR ("finish_id" IS NULL AND "external_entry_id" IS NULL)',
    );
    expect(migration).toContain(
      "\"from_stage\" NOT IN ('WAITING_ARCHIVE', 'ARCHIVED')",
    );
    expect(migration).toContain('"to_version" = "from_version" + 1');
  });

  it('stores one receipt for the source and a scoped idempotency key', () => {
    expect(migration).toContain('UNIQUE ("early_closure_id")');
    expect(migration).toContain(
      'UNIQUE ("department_id", "actor_user_id", "idempotency_key")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("early_closure_id", "case_id", "department_id")',
    );
  });
});
