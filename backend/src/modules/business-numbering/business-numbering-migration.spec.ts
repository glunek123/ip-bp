import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../prisma/migrations/20261026100000_v6_business_numbering/migration.sql',
  ),
  'utf8',
);
const cutover = readFileSync(
  join(
    __dirname,
    '../../../../docs/superpowers/plans/2026-10-26-v6-numbering-cutover.draft.sql',
  ),
  'utf8',
);

describe('v6 numbering migration boundary (static only)', () => {
  it('keeps the customer sequence unready until the authorized cutover', () => {
    expect(migration).toContain('VALUES (1, -1)');
    expect(migration).toContain('AFTER INSERT OR UPDATE ON customers');
    expect(migration).toContain('NEW.business_id IS NULL');
    expect(migration).toContain(
      'last_value FROM customer_business_number_counters WHERE singleton_id = 1) >= 0',
    );
    expect(cutover).toContain('<> -1');
    expect(
      cutover.indexOf(
        'UPDATE customer_business_number_counters\nSET last_value = (SELECT count(*) FROM customers)',
      ),
    ).toBeGreaterThan(cutover.indexOf('numbering order verification failed'));
  });

  it('keeps the historical data rewrite outside the routine migration chain', () => {
    expect(migration).not.toMatch(
      /UPDATE\s+(?:"?customers"?|"?leads"?|"?cases"?)\s+SET/iu,
    );
    expect(cutover).toContain('INSERT INTO business_number_aliases');
    expect(cutover).toContain("created_at AT TIME ZONE 'Asia/Shanghai'");
    expect(cutover).toContain(
      'PARTITION BY source_lead_id ORDER BY created_at, id',
    );
  });

  it('temporarily isolates only the deleted-draft guard around the customer id update', () => {
    const disable = cutover.indexOf(
      'ALTER TABLE customers DISABLE TRIGGER customers_draft_deletion_guard;',
    );
    const update = cutover.indexOf('UPDATE customers c\nSET business_id =');
    const enable = cutover.indexOf(
      'ALTER TABLE customers ENABLE TRIGGER customers_draft_deletion_guard;',
    );
    const leadUpdate = cutover.indexOf('UPDATE leads l SET business_no');
    expect(cutover).toContain(
      "tgfoid = 'customer_draft_deletion_guard()'::regprocedure",
    );
    expect(cutover).toContain("tgenabled = 'O' AND tgtype = 19");
    expect(disable).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(disable);
    expect(enable).toBeGreaterThan(update);
    expect(leadUpdate).toBeGreaterThan(enable);
    expect(cutover).not.toMatch(/DISABLE TRIGGER ALL/iu);
  });
});
