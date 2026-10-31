import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const migration = (name: string) =>
  readFileSync(
    resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`),
    'utf8',
  );
describe('dedicated closure payment screenshot draft', () => {
  it('adds an independent category without changing document or fee semantics', () => {
    const sql = migration('20261030050000_case_closure_payment_proof_category');
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'CASE_CLOSURE_PAYMENT_PROOF'",
    );
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP/iu);
  });
  it('retains database refusal for both upload and material paths, including purpose spoofing', () => {
    const sql = migration('20261030060000_case_closure_payment_proof_gate');
    expect(sql).toContain(
      "NEW.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR NEW.purpose='CASE_CLOSURE_PAYMENT_PROOF'",
    );
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON upload_drafts');
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON materials');
    expect(sql).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER|UPDATE cases/iu);
  });
});
