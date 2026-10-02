import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CA-002 complaint migration integrity', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260930010000_add_case_complaint_submission/migration.sql',
    ),
    'utf8',
  );
  const schema = readFileSync(
    resolve(process.cwd(), 'prisma/schema.prisma'),
    'utf8',
  );

  it('rejects UNKNOWN amount predicates for a submitted case at the database boundary', () => {
    const check = migration.match(
      /ADD CONSTRAINT "cases_complaint_state_check" CHECK \(([\s\S]*?)\);/u,
    )?.[1];
    expect(check).toBeDefined();
    expect(check).toMatch(/"complaint_amount_state" IS NOT NULL/u);
    expect(check).toMatch(
      /"complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0/u,
    );
    expect(check).toMatch(
      /"complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL/u,
    );
    expect(schema).toMatch(
      /complaintAmountState\s+CaseComplaintAmountState\?/u,
    );
  });
});
