import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CORE-NT-006 migration', () => {
  it('defines separate immutable archive and amount facts', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260929010000_add_notary_return_archive/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE "notary_return_archives"');
    expect(sql).toContain('CREATE TABLE "notary_return_amounts"');
    expect(sql).toContain('reject_notary_return_archive_mutation');
    expect(sql).toContain('reject_notary_return_amount_mutation');
  });

  it('upgrades empty and previous schemas and enforces return archive facts', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          resolve(
            process.cwd(),
            'src/modules/leads/core-nt-006-migration-probe.mjs',
          ),
        ],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
      ),
    ).not.toThrow();
  });
});
