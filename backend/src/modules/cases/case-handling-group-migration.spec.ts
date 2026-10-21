import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('case handling group migration syntax regression', () => {
  it('parenthesizes the CASE expression inside the receipt IF condition', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261020110100_case_handling_groups/migration.sql',
      ),
      'utf8',
    );

    // PL/pgSQL reads an IF condition up to the first THEN outside parentheses.
    // This source guard is not a PostgreSQL parser or migration execution test.
    expect(sql).toMatch(
      /OR\s+receipt\."command"\s*<>\s*\(CASE\s+WHEN\s+event\."revision"\s*=\s*1\s+THEN\s+'CREATE'\s+ELSE\s+'DISSOLVE'\s+END\)/u,
    );
  });
});
