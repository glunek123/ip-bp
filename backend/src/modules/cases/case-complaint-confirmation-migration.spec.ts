import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CA-003 complaint confirmation migration contract', () => {
  const schemaSql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20261002020000_add_case_complaint_confirmation/migration.sql',
    ),
    'utf8',
  );
  const grantsSql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20261002021000_add_case_complaint_confirmation_grants/migration.sql',
    ),
    'utf8',
  );

  it('preserves original submitted fields while adding the stamp stage', () => {
    expect(schemaSql).toContain("'WAITING_COMPLAINT_STAMP'");
    expect(schemaSql).toContain('"complaint_submitted_at" IS NOT NULL');
    expect(schemaSql).toContain('"complaint_amount_state" IS NOT NULL');
    expect(schemaSql).not.toMatch(/DROP TABLE "case_complaint_receipts"/u);
  });

  it('rejects malformed or mutable confirmation facts at the SQL boundary', () => {
    expect(schemaSql).toContain('"case_complaint_confirmations_amount_check"');
    expect(schemaSql).toContain(
      '"case_complaint_confirmations_change_note_check"',
    );
    expect(schemaSql).toContain('"case_complaint_confirmations_immutable"');
    expect(schemaSql).toContain('"case_complaint_confirmations_stage_guard"');
  });

  it('copies submit grants without broadening scope and invalidates only affected members', () => {
    expect(grantsSql).toContain(
      '\'case.complaint.submit\'::"permission_action"',
    );
    expect(grantsSql).toContain('"grant"."scope"');
    expect(grantsSql).toContain('RETURNING "role_template_id"');
    expect(grantsSql).toContain('WHERE "assignment"."active"');
  });
});
