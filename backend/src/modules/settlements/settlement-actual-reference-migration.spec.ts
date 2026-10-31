import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'prisma/migrations');
const initial = readFileSync(
  resolve(root, '20261029140000_case_settlement_actual_facts/migration.sql'),
  'utf8',
);
const supplement = readFileSync(
  resolve(
    root,
    '20261029150000_settlement_actual_source_supplement/migration.sql',
  ),
  'utf8',
);

function canonicalCheck(sql: string, name: string) {
  const start = sql.indexOf(`CONSTRAINT "${name}" CHECK (`);
  expect(start).toBeGreaterThan(-1);
  const body = sql.slice(
    start,
    sql.indexOf('\n);', start) >= 0 ? sql.indexOf('\n);', start) : start + 350,
  );
  expect(body).toContain('"source_reference" = btrim("source_reference")');
  expect(body).toContain('length("source_reference") > 0');
  expect(body).toContain('"source_reference" !~');
}

describe('settlement actual source migrations', () => {
  it('rejects untrimmed direct-SQL numbers in facts, supplements and shared claims', () => {
    canonicalCheck(initial, 'settlement_actual_facts_source_canonical');
    canonicalCheck(
      supplement,
      'settlement_actual_source_supplements_canonical',
    );
    canonicalCheck(supplement, 'settlement_actual_source_claims_canonical');
  });

  it('uses the shared unique claim for both write paths', () => {
    expect(supplement).toContain(
      'CREATE UNIQUE INDEX "settlement_actual_source_claim_identity_key"',
    );
    expect(supplement).toContain(
      'CREATE TRIGGER settlement_actual_claim_before_fact',
    );
    expect(supplement).toContain(
      'CREATE TRIGGER settlement_actual_claim_before_supplement',
    );
  });
});
